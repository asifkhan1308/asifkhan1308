// Runs against the INSTALLED app (Windows CI: the NSIS installer, silently
// installed). Checks what only a real install can show: the packaged app
// starts from Program Files-style paths, uses the per-user data folder, has
// the OS credential store, decodes and encodes H.264/AAC with the system
// codecs, and exports a file that plays.

import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureFixtures, ffmpeg, FIXTURES, probe } from '../e2e/fixtures';

const exe = process.env.KAATCHAT_EXE ?? '';
const VERSION = (JSON.parse(readFileSync(join(process.cwd(), 'desktop', 'package.json'), 'utf8')) as { version: string }).version;
let app: ElectronApplication;
let page: Page;
const log: string[] = [];

test.skip(!exe || !existsSync(exe), 'KAATCHAT_EXE is not set to an installed Kaatchat.exe');

test.beforeAll(async () => {
  ensureFixtures();
  const mp4 = join(FIXTURES, 'talk.mp4');
  if (!existsSync(mp4))
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-i', join(FIXTURES, 'talk.webm'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', mp4]);
  app = await electron.launch({ executablePath: exe, args: [] });
  app.process().stderr?.on('data', (d) => log.push(String(d)));
  page = await app.firstWindow();
  page.on('pageerror', (e) => log.push(`[pageerror] ${e.message}\n`));
  await page.waitForURL('kaatchat://app/**', { waitUntil: 'domcontentloaded' });
});

// eslint-disable-next-line no-empty-pattern -- Playwright hooks need a fixtures object first.
test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus) console.log(`--- app log (${info.title}) ---\n${log.slice(-120).join('')}--- end ---`);
});

test.afterAll(async () => {
  if (!app) return;
  const closed = await Promise.race([app.close().then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 15_000))]);
  if (!closed) app.process().kill();
});

test('the installed app starts as a packaged, sandboxed Windows app', async () => {
  const info = await app.evaluate(({ app: a, safeStorage }) => ({
    packaged: a.isPackaged,
    version: a.getVersion(),
    name: a.getName(),
    exe: a.getPath('exe'),
    userData: a.getPath('userData'),
    secure: safeStorage.isEncryptionAvailable(),
    platform: process.platform,
  }));
  expect(info.platform).toBe('win32');
  expect(info.packaged).toBe(true);
  expect(info.version).toBe(VERSION);
  expect(info.exe.toLowerCase()).toBe(exe.toLowerCase());
  // Per-user install: data lives in the user's roaming profile, not next to the program.
  expect(info.userData).toMatch(/\\AppData\\Roaming\\Kaatchat$/i);
  // DPAPI: API keys are encrypted by Windows.
  expect(info.secure).toBe(true);
  await expect(page).toHaveTitle('Kaatchat');
  expect(await page.evaluate(() => ({ desktop: window.kaatchat?.desktop, version: window.kaatchat?.version, require: typeof (window as unknown as { require?: unknown }).require })))
    .toEqual({ desktop: true, version: VERSION, require: 'undefined' });
});

test('an API key is stored encrypted and never readable by the page', async () => {
  await page.evaluate(() => window.kaatchat!.keys.set('openai', 'sk-test-installed-1234567890'));
  expect(await page.evaluate(() => window.kaatchat!.keys.has('openai'))).toBe(true);
  const file = join(await app.evaluate(({ app: a }) => a.getPath('userData')), 'provider-keys.json');
  const raw = readFileSync(file, 'utf8');
  expect(raw).not.toContain('sk-test-installed');
  await page.evaluate(() => window.kaatchat!.keys.clear('openai'));
  expect(await page.evaluate(() => window.kaatchat!.keys.has('openai'))).toBe(false);
});

test('imports H.264/AAC and exports an MP4 that is H.264 + AAC with the right duration', async () => {
  await page.evaluate(() => (location.hash = '#/'));
  await page.locator('input[type=file]').first().setInputFiles(join(FIXTURES, 'talk.mp4'));
  await expect(page.locator('.asset').first().getByText('Loudness')).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('.asset').first().getByText('Framing')).toBeVisible({ timeout: 90_000 });
  await page.getByRole('button', { name: 'Export' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Export' });
  await dialog.getByRole('button', { name: /^Export \d/ }).click();
  const save = dialog.getByRole('link', { name: 'Save file' });
  await expect(save).toBeVisible({ timeout: 150_000 });
  await expect(dialog.locator('[data-fact="codecs"]')).toHaveText('H.264 + AAC');
  const href = (await save.getAttribute('href'))!;
  const b64 = await page.evaluate(async (u) => {
    const bytes = new Uint8Array(await (await fetch(u)).arrayBuffer());
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }, href);
  const out = test.info().outputPath('installed.mp4');
  writeFileSync(out, Buffer.from(b64, 'base64'));
  const info = probe(out);
  expect(info.video).toMatch(/^h264/);
  expect(info.audio).toMatch(/^aac/);
  expect(info.duration).toBeGreaterThan(9.5);
  expect(info.duration).toBeLessThan(10.5);
});

test('the update check answers from the installed app', async () => {
  const r = await page.evaluate(() => window.kaatchat!.updates!.check().then((x) => x, (e: Error) => ({ error: e.message })));
  if ('status' in r) {
    expect(['current', 'available']).toContain(r.status);
    // A packaged Windows build is the one build that installs updates itself.
    if (r.status === 'available') expect(r.canInstall).toBe(true);
  } else expect(r.error).toMatch(/rate-limiting|answered|fetch failed/);
});
