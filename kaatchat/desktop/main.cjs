// Kaatchat desktop — Electron main process.
//
// Security posture (audited against the v0.1 build):
//  * the renderer is sandboxed, context-isolated, with no Node integration
//  * files are served from a privileged kaatchat:// origin, confined to dist/
//    (the v0.1 prefix check let "dist-other/" through; fixed with a separator)
//  * the window cannot navigate away or open windows; http(s) links open in
//    the system browser; every permission request is denied
//  * IPC handlers check the sender is our own page
//  * API keys are encrypted with the OS credential store (safeStorage) and are
//    never returned to the renderer; AI requests are made here, only to the
//    selected provider's own host, with the key added at the last moment

'use strict';

const { app, BrowserWindow, protocol, net, shell, dialog, Menu, ipcMain, safeStorage, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { resolveInsideRoot, PROVIDERS, isProvider, checkProviderUrl, sanitizeHeaders, RELEASES_API, RELEASE_MANIFEST, updateFromManifest, pickUpdate, isAllowedDownload, sumFor } = require('./policy.cjs');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');

const APP_SCHEME = 'kaatchat';
const APP_ORIGIN = `${APP_SCHEME}://app`;
const ROOT = path.join(__dirname, 'dist');
const VERSION = app.getVersion();

protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
}
app.on('second-instance', () => {
  const [win] = BrowserWindow.getAllWindows();
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

// ---------------------------------------------------------------------------
// Static files
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// API keys (OS credential store)
// ---------------------------------------------------------------------------

const keyFile = () => path.join(app.getPath('userData'), 'provider-keys.json');

function readKeys() {
  try {
    return JSON.parse(fs.readFileSync(keyFile(), 'utf8'));
  } catch {
    return {};
  }
}
function writeKeys(obj) {
  fs.mkdirSync(path.dirname(keyFile()), { recursive: true });
  fs.writeFileSync(keyFile(), JSON.stringify(obj), { mode: 0o600 });
}
function getKey(provider) {
  const enc = readKeys()[provider];
  if (!enc || !safeStorage.isEncryptionAvailable()) return null;
  try {
    return safeStorage.decryptString(Buffer.from(enc, 'base64'));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Updates
// ---------------------------------------------------------------------------
// Checks this app's own GitHub releases. Installing downloads the new installer,
// verifies it against the release's SHA256SUMS.txt, then runs it and quits; the
// one-click installer replaces this version and starts the new one. Nothing is
// downloaded or run without the person choosing "Install".

let pendingUpdate = null;
let installing = false;

async function getJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': `Kaatchat/${VERSION}` }, signal: AbortSignal.timeout(15_000) });
  if (res.status === 403 || res.status === 429) throw new Error('GitHub is rate-limiting update checks. Try again in a while.');
  if (!res.ok) throw new Error(`GitHub answered ${res.status} to the update check.`);
  return res.json();
}

async function checkForUpdate() {
  // Primary: the published release manifest. It says "no update" by returning null too,
  // so the releases API is only asked when the manifest cannot be read at all.
  let update;
  try {
    const m = await getJson(RELEASE_MANIFEST);
    update = updateFromManifest(m, VERSION);
  } catch (manifestError) {
    try {
      update = pickUpdate(await getJson(RELEASES_API), VERSION);
    } catch {
      throw manifestError;
    }
  }
  pendingUpdate = update;
  return update
    ? { status: 'available', current: VERSION, version: update.version, page: update.page, notes: update.notes, size: update.installer.size, canInstall: canSelfInstall() }
    : { status: 'current', current: VERSION };
}

/** Only a packaged Windows build can replace itself with the NSIS installer. */
function canSelfInstall() {
  return process.platform === 'win32' && app.isPackaged;
}

function sendProgress(p) {
  mainWindow?.webContents.send('kaatchat:update-progress', p);
}

async function downloadTo(url, file, expectedSize) {
  if (!isAllowedDownload(url)) throw new Error('Refusing to download from outside Kaatchat’s releases.');
  const res = await fetch(url, { headers: { 'user-agent': `Kaatchat/${VERSION}` }, signal: AbortSignal.timeout(30 * 60_000) });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}).`);
  const total = Number(res.headers.get('content-length')) || expectedSize || 0;
  const hash = createHash('sha256');
  const out = fs.createWriteStream(file);
  let got = 0;
  let last = 0;
  try {
    for await (const chunk of res.body) {
      hash.update(chunk);
      got += chunk.length;
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
      const now = Date.now();
      if (total && now - last > 200) {
        last = now;
        sendProgress(got / total);
      }
    }
  } finally {
    await new Promise((r) => out.end(r));
  }
  return hash.digest('hex');
}

async function installUpdate() {
  const u = pendingUpdate;
  if (!u) throw new Error('Check for updates first.');
  if (!canSelfInstall()) {
    await shell.openExternal(u.page);
    return { status: 'opened-page' };
  }
  if (installing) throw new Error('An update is already downloading.');
  installing = true;
  try {
    let expected = u.sha256 ?? null;
    if (!expected) {
      const sumsRes = await fetch(u.sumsUrl, { headers: { 'user-agent': `Kaatchat/${VERSION}` }, signal: AbortSignal.timeout(30_000) });
      if (!sumsRes.ok) throw new Error(`Could not read the release checksums (${sumsRes.status}).`);
      expected = sumFor(await sumsRes.text(), u.installer.name);
    }
    if (!expected) throw new Error('The release does not list a checksum for its installer, so it was not installed.');
    const dir = fs.mkdtempSync(path.join(app.getPath('temp'), 'kaatchat-update-'));
    const file = path.join(dir, u.installer.name);
    sendProgress(0);
    const actual = await downloadTo(u.installer.url, file, u.installer.size);
    if (actual !== expected) {
      fs.rmSync(dir, { recursive: true, force: true });
      throw new Error('The downloaded installer did not match its published checksum, so it was deleted and not run.');
    }
    sendProgress(1);
    spawn(file, [], { detached: true, stdio: 'ignore' }).unref();
    setTimeout(() => app.quit(), 500);
    return { status: 'installing' };
  } finally {
    installing = false;
  }
}

async function checkFromMenu() {
  try {
    const r = await checkForUpdate();
    if (r.status === 'current') {
      await dialog.showMessageBox(mainWindow, { type: 'info', title: 'Kaatchat', message: 'Kaatchat is up to date.', detail: `You have version ${VERSION}.`, buttons: ['OK'] });
      return;
    }
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update available',
      message: `Kaatchat ${r.version} is available.`,
      detail: `You have ${VERSION}.${r.canInstall ? ' Kaatchat will download it, check it against its published checksum, then close and install it. Save your work first.' : ''}`,
      buttons: [r.canInstall ? 'Install now' : 'Open download page', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) await installUpdate();
  } catch (e) {
    await dialog.showMessageBox(mainWindow, { type: 'warning', title: 'Kaatchat', message: 'Could not check for updates.', detail: String(e?.message || e), buttons: ['OK'] });
  }
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

function fromApp(event) {
  const url = event.senderFrame?.url ?? '';
  return url.startsWith(APP_ORIGIN + '/');
}
function handle(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!fromApp(event)) throw new Error('Rejected: not from the Kaatchat page.');
    return fn(...args);
  });
}

const inflight = new Map();
const MAX_BODY = 4 * 1024 * 1024;

function registerIpc() {
  ipcMain.on('kaatchat:version', (event) => {
    event.returnValue = fromApp(event) ? VERSION : '';
  });

  handle('kaatchat:open-external', (url) => {
    if (typeof url === 'string' && /^https?:\/\//.test(url)) return shell.openExternal(url);
  });

  handle('kaatchat:keys-secure', () => safeStorage.isEncryptionAvailable());
  handle('kaatchat:keys-has', (p) => isProvider(p) && !!readKeys()[p]);
  handle('kaatchat:keys-set', (p, key) => {
    if (!isProvider(p) || !PROVIDERS[p].needsKey) throw new Error('Unknown provider.');
    if (typeof key !== 'string' || !key.trim() || key.length > 512) throw new Error('That does not look like an API key.');
    if (!safeStorage.isEncryptionAvailable()) throw new Error('No OS credential store is available, so the key was not saved.');
    const all = readKeys();
    all[p] = safeStorage.encryptString(key.trim()).toString('base64');
    writeKeys(all);
  });
  handle('kaatchat:keys-clear', (p) => {
    if (!isProvider(p)) return;
    const all = readKeys();
    delete all[p];
    writeKeys(all);
  });

  handle('kaatchat:ai-fetch', async (requestId, provider, req) => {
    if (typeof requestId !== 'string' || !isProvider(provider) || !req || typeof req.url !== 'string') throw new Error('Bad request.');
    const spec = PROVIDERS[provider];
    const url = checkProviderUrl(provider, req.url);
    const method = req.method === 'POST' ? 'POST' : 'GET';
    if (req.body != null && (typeof req.body !== 'string' || req.body.length > MAX_BODY)) throw new Error('Request too large.');
    const headers = sanitizeHeaders(req.headers);
    if (spec.header) {
      const key = getKey(provider);
      if (!key) return { status: 401, statusText: 'No key', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ error: { message: 'No API key is saved for this provider.' } }) };
      headers[spec.header] = spec.prefix + key;
    }

    const ac = new AbortController();
    inflight.set(requestId, ac);
    // Backstop only: the renderer times out first (150 s cloud, 300 s local) with a clearer message.
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ac.abort();
    }, 330_000);
    try {
      const res = await fetch(url, { method, headers, body: method === 'POST' ? req.body : undefined, signal: ac.signal, redirect: 'error' });
      const text = await res.text();
      const outHeaders = {};
      const ct = res.headers.get('content-type');
      if (ct) outHeaders['content-type'] = ct;
      const rid = res.headers.get('request-id') || res.headers.get('x-request-id');
      if (rid) outHeaders['request-id'] = rid;
      return { status: res.status, statusText: res.statusText, headers: outHeaders, body: text.slice(0, 8 * 1024 * 1024) };
    } catch (e) {
      if (timedOut) return { status: 504, statusText: 'Timed out', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ error: { message: `${url.hostname} did not respond in time.` } }) };
      if (ac.signal.aborted) return { status: 499, statusText: 'Cancelled', headers: {}, body: '{"error":{"message":"Cancelled"}}' };
      return { status: 502, statusText: 'Network error', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ error: { message: `Could not reach ${url.hostname}: ${e.message}` } }) };
    } finally {
      clearTimeout(timer);
      inflight.delete(requestId);
    }
  });

  handle('kaatchat:ai-cancel', (requestId) => {
    inflight.get(requestId)?.abort();
  });

  handle('kaatchat:update-check', () => checkForUpdate());
  handle('kaatchat:update-install', () => installUpdate());
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#F2F2F4',
    show: false,
    title: 'Kaatchat',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (process.argv.includes('--maximized')) mainWindow.maximize();
  });

  const wc = mainWindow.webContents;
  // A crashed or killed renderer leaves a blank window; say why in the log.
  wc.on('render-process-gone', (_e, d) => console.error(`[kaatchat] renderer gone: ${d.reason} (exit ${d.exitCode})`));
  app.on('child-process-gone', (_e, d) => console.error(`[kaatchat] ${d.type} process gone: ${d.reason} (exit ${d.exitCode})`));
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, url) => {
    if (!url.startsWith(APP_ORIGIN + '/')) {
      e.preventDefault();
      if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    }
  });
  wc.on('will-attach-webview', (e) => e.preventDefault());

  wc.session.on('will-download', (_event, item) => {
    const target = dialog.showSaveDialogSync(mainWindow, {
      title: 'Save video',
      defaultPath: path.join(app.getPath('videos'), item.getFilename()),
      filters: [
        { name: 'Video', extensions: ['mp4', 'webm'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    if (!target) {
      item.cancel();
      return;
    }
    item.setSavePath(target);
    item.once('done', (_e, state) => {
      if (state === 'completed') shell.showItemInFolder(target);
    });
  });

  void mainWindow.loadURL(`${APP_ORIGIN}/index.html`);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function buildMenu() {
  const go = (hash) => mainWindow?.webContents.executeJavaScript(`location.hash = ${JSON.stringify(hash)}`);
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'Projects', accelerator: 'CmdOrCtrl+O', click: () => go('#/') },
        { label: 'Settings', accelerator: 'CmdOrCtrl+,', click: () => go('#/settings') },
        { type: 'separator' },
        { role: 'quit', label: 'Exit' },
      ],
    },
    { label: 'Edit', submenu: [{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }]),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Check for updates…', click: () => void checkFromMenu() },
        { type: 'separator' },
        { label: 'Privacy', click: () => go('#/privacy') },
        {
          label: `About Kaatchat ${VERSION}`,
          click: () =>
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Kaatchat',
              message: `Kaatchat ${VERSION}`,
              detail:
                'A local-first, AI-native video editor.\n\nYour footage is processed on this computer and never uploaded. AI providers, when you enable them, receive only your request, timings and transcript text.\n\nMPL-2.0 · Asif Khan. Built on Mediabunny (MPL-2.0) and Electron; with thanks to the WolfCut project.',
              buttons: ['Close'],
            }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  // Deny every permission request (camera, microphone, geolocation, …).
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);

  protocol.handle(APP_SCHEME, (request) => {
    const url = new URL(request.url);
    if (url.host !== 'app') return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(resolveInsideRoot(ROOT, url.pathname)).toString());
  });

  registerIpc();
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

