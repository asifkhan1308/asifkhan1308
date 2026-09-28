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
const { resolveInsideRoot, PROVIDERS, isProvider, checkProviderUrl, sanitizeHeaders } = require('./policy.cjs');

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
    const timer = setTimeout(() => ac.abort(), 180_000);
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

