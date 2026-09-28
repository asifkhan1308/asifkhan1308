// Launches the real Electron app (desktop/main.cjs) and checks the security
// posture and a real import. Requires `npm --prefix desktop install` and a
// display (xvfb-run on Linux CI).

import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { ensureFixtures, ffmpeg, FIXTURES } from '../e2e/fixtures';

const here = dirname(fileURLToPath(import.meta.url));
const desktopDir = join(here, '..', '..', 'desktop');
// Electron is a dependency of desktop/, not of the web app.
const electronPath = createRequire(join(desktopDir, 'package.json'))('electron') as unknown as string;
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
  await page.waitForLoadState('domcontentloaded');
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
  expect(page.url()).toBe('kaatchat://app/index.html');
  await expect(page).toHaveTitle('Kaatchat');
  const probe = await page.evaluate(() => ({
    bridge: typeof window.kaatchat,
    desktop: window.kaatchat?.desktop,
    version: window.kaatchat?.version,
    require: typeof (window as unknown as { require?: unknown }).require,
    process: typeof (window as unknown as { process?: unknown }).process,
    keyGetter: 'get' in (window.kaatchat?.keys ?? {}),
  }));
  expect(probe).toEqual({ bridge: 'object', desktop: true, version: '2.0.0-alpha.1', require: 'undefined', process: 'undefined', keyGetter: false });
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
