// Launches the real Electron app (desktop/main.cjs) and checks the security
// posture and a real import. Requires `npm --prefix desktop install` and a
// display (xvfb-run on Linux CI).

import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { ensureFixtures, ffmpeg, FIXTURES, probe } from '../e2e/fixtures';

const here = dirname(fileURLToPath(import.meta.url));
const desktopDir = join(here, '..', '..', 'desktop');
// Electron is a dependency of desktop/, not of the web app.
const electronPath = createRequire(join(desktopDir, 'package.json'))('electron') as unknown as string;
const VERSION = (JSON.parse(readFileSync(join(desktopDir, 'package.json'), 'utf8')) as { version: string }).version;
let app: ElectronApplication;
let page: Page;
// Electron's stderr, renderer crashes and console errors, printed when a test fails
// so CI failures can be diagnosed from the log alone.
const log: string[] = [];

test.beforeAll(async () => {
  ensureFixtures();
  const mp4 = join(FIXTURES, 'talk.mp4');
  if (!existsSync(mp4))
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-i', join(FIXTURES, 'talk.webm'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', mp4]);
  app = await electron.launch({ executablePath: electronPath, args: [desktopDir, ...(process.getuid?.() === 0 ? ['--no-sandbox'] : [])], env: { ...process.env, ELECTRON_ENABLE_LOGGING: '0' } });
  app.process().stderr?.on('data', (d) => log.push(String(d)));
  // Record external opens instead of launching the system browser: a real xdg-open
  // outlives the app, keeps its stdio open and stalls the test runner's shutdown.
  await app.evaluate(({ shell }) => {
    const opened: string[] = [];
    (globalThis as unknown as { __opened: string[] }).__opened = opened;
    shell.openExternal = async (url: string) => {
      opened.push(url);
    };
  });
  page = await app.firstWindow();
  page.on('crash', () => log.push('[renderer crashed]\n'));
  page.on('console', (m) => {
    if (m.type() === 'error') log.push(`[console] ${m.text()}\n`);
  });
  page.on('pageerror', (e) => log.push(`[pageerror] ${e.message}\n`));
  // firstWindow() can resolve while the window is still on its initial blank page,
  // before the app URL commits; wait for the app itself, not just any load.
  await page.waitForURL('kaatchat://app/**', { waitUntil: 'domcontentloaded' });
});

// eslint-disable-next-line no-empty-pattern -- Playwright hooks need a fixtures object first.
test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus) console.log(`--- Electron log (${info.title}) ---\n${log.slice(-120).join('')}--- end ---`);
});

test.afterAll(async () => {
  if (!app) return;
  // Never let a wedged app hold the job for the whole hook timeout.
  const closed = await Promise.race([app.close().then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 15_000))]);
  if (!closed) app.process().kill('SIGKILL');
});

test('loads from the kaatchat:// origin with a sandboxed, isolated renderer', async () => {
  await expect(page).toHaveURL('kaatchat://app/index.html');
  await expect(page).toHaveTitle('Kaatchat');
  const probe = await page.evaluate(() => ({
    bridge: typeof window.kaatchat,
    desktop: window.kaatchat?.desktop,
    version: window.kaatchat?.version,
    require: typeof (window as unknown as { require?: unknown }).require,
    process: typeof (window as unknown as { process?: unknown }).process,
    keyGetter: 'get' in (window.kaatchat?.keys ?? {}),
  }));
  expect(probe).toEqual({ bridge: 'object', desktop: true, version: VERSION, require: 'undefined', process: 'undefined', keyGetter: false });
});

test('cannot read files outside dist/ or navigate away', async () => {
  const body = await page.evaluate(async () => (await fetch('kaatchat://app/..%2f..%2fpackage.json')).text());
  expect(body).toContain('<div id="root">'); // fell back to index.html
  await page.evaluate(() => (location.href = 'https://example.com/'));
  await page.waitForTimeout(500);
  expect(page.url()).toMatch(/^kaatchat:\/\/app\//);
  // …and the link went to the system browser instead.
  expect(await app.evaluate(() => (globalThis as unknown as { __opened: string[] }).__opened)).toContain('https://example.com/');
});

test('AI proxy refuses other hosts and never exposes keys', async () => {
  const err = await page.evaluate(() =>
    window.kaatchat!.aiFetch('t1', 'openai', { url: 'https://evil.example.com/steal', method: 'GET', headers: {} }).then(
      () => 'allowed',
      (e: Error) => e.message,
    ),
  );
  expect(err).toMatch(/only sends openai requests to api\.openai\.com/);
  const noKey = await page.evaluate(() => window.kaatchat!.aiFetch('t2', 'claude', { url: 'https://api.anthropic.com/v1/models', method: 'GET', headers: { 'x-api-key': 'page-supplied' } }));
  expect(noKey.status).toBe(401); // no stored key; the page-supplied header was stripped, nothing was sent
});

test('imports an H.264/AAC MP4 (proprietary codecs work in Electron)', async () => {
  await page.evaluate(() => (location.hash = '#/'));
  await page.locator('input[type=file]').first().setInputFiles(join(FIXTURES, 'talk.mp4'));
  await expect(page.locator('.asset').first().getByText('Loudness')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.asset').first().getByText('Framing')).toBeVisible({ timeout: 60_000 });
});

test('exports MP4 as H.264 + AAC with the real duration reported', async () => {
  await expect(page.locator('.asset').first().getByText('Framing')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Export' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Export' });
  await dialog.getByRole('button', { name: /^Export \d/ }).click();
  const save = dialog.getByRole('link', { name: 'Save file' });
  await expect(save).toBeVisible({ timeout: 180_000 });
  const facts = dialog.locator('.export-facts');
  await expect(facts.locator('[data-fact="codecs"]')).toHaveText('H.264 + AAC');
  await expect(facts.locator('[data-fact="duration"]')).toHaveText(/^0:(09\.[5-9]|10\.[0-4])$/);

  // Read the exported file back out of the page and check it with ffmpeg.
  const href = (await save.getAttribute('href'))!;
  const b64 = await page.evaluate(async (u) => {
    const bytes = new Uint8Array(await (await fetch(u)).arrayBuffer());
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }, href);
  const out = test.info().outputPath('desktop.mp4');
  writeFileSync(out, Buffer.from(b64, 'base64'));
  const info = probe(out);
  expect(info.video).toMatch(/^h264/);
  expect(info.audio).toMatch(/^aac \(LC\)/);
  expect(info.duration).toBeGreaterThan(9.5);
  expect(info.duration).toBeLessThan(10.5);
});

test('local AI is found through the main process, with no CORS setup', async () => {
  // A stand-in for LM Studio's server: a real HTTP server on its default port, no CORS headers.
  const { createServer } = await import('node:http');
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/v1/models') res.end(JSON.stringify({ data: [{ id: 'qwen2.5-7b-instruct' }] }));
    else res.writeHead(404).end('{}');
  });
  await new Promise<void>((r) => server.listen(1234, '127.0.0.1', r));
  try {
    await page.evaluate(() => (location.hash = '#/settings'));
    const card = page.locator('.provider', { has: page.getByRole('heading', { name: /Local AI/ }) });
    await card.getByLabel('Enabled').check();
    await card.getByRole('button', { name: 'Find local AI' }).click();
    await expect(card.getByRole('list', { name: 'Local AI servers found' }).getByRole('button', { name: 'LM Studio' })).toBeVisible();
    await expect(card.getByLabel('Model')).toHaveValue('qwen2.5-7b-instruct');
    // The browser-only CORS advice is not shown on desktop.
    await expect(card.getByText(/Enable CORS/)).toHaveCount(0);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('updates: Settings shows the version, and the check reads the published release manifest', async () => {
  await page.evaluate(() => (location.hash = '#/settings'));
  const updates = page.getByRole('region', { name: 'Updates' });
  await expect(updates.getByText(`You have Kaatchat ${VERSION}.`)).toBeVisible();
  await expect(updates.getByRole('checkbox', { name: /Check for updates when Kaatchat starts/ })).toBeChecked();
  await updates.getByRole('button', { name: 'Check for updates' }).click();
  // Whatever main currently publishes, the answer is a clear state, never a hang or a crash.
  await expect(updates.getByText(/Kaatchat is up to date\.|is available|rate-limiting|answered|fetch failed/)).toBeVisible({ timeout: 30_000 });
  const r = await page.evaluate(() => window.kaatchat!.updates!.check().then((x) => x, (e: Error) => ({ error: e.message })));
  if ('status' in r) {
    expect(['current', 'available']).toContain(r.status);
    expect(r.current).toBe(VERSION);
    // Only a packaged Windows build installs by itself; elsewhere "install" opens the release page.
    if (r.status === 'available') expect(r.canInstall).toBe(false);
  }
});
