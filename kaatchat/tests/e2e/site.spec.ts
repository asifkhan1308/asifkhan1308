import { test, expect } from '@playwright/test';

const SITE = 'http://localhost:4174/';

test('marketing site: self-contained, responsive, no dead links', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (r) => {
    if (!r.url().startsWith(SITE)) external.push(r.url());
  });
  // The unreleased state, whatever release.json currently holds.
  await page.route('**/release.json', (r) =>
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: '2.0.0', windowsUrl: null, sha256: null }) }),
  );
  await page.goto(SITE);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Shoot once\.\s*Edit intelligently\.\s*Create more\./);
  await page.waitForLoadState('networkidle');
  expect(external).toEqual([]);
  // Nothing configured yet → no download / app buttons, and the page says why.
  await expect(page.getByRole('link', { name: /Download for (Windows|Apple Silicon|Intel)/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Open (the web app|Kaatchat)/ })).toHaveCount(0);
  await expect(page.locator('#win-pending')).toBeVisible();
  await expect(page.locator('#mac-pending')).toBeVisible();
  for (const w of [390, 768, 1440]) {
    await page.setViewportSize({ width: w, height: 900 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `overflow at ${w}px`).toBeLessThanOrEqual(0);
  }
});

test('marketing site: the committed release manifest points at a real installer', async ({ page }) => {
  const rel = await (await page.request.get(`${SITE}release.json`)).json();
  if (rel.windowsUrl === null) return; // not released yet
  expect(rel.windowsUrl).toMatch(/^https:\/\/github\.com\/.+\/releases\/download\/.+\.exe$/);
  expect(rel.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(rel.size).toBeGreaterThan(10_000_000);
});

test('marketing site: a real release turns the download on, with its checksum', async ({ page }) => {
  await page.route('**/release.json', (r) =>
    r.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ version: '2.0.0', windowsUrl: 'https://github.com/x/y/releases/download/v2/Kaatchat-Setup-2.0.0.exe', sha256: 'a'.repeat(64), size: 110000000, signed: false }),
    }),
  );
  await page.goto(SITE);
  const dl = page.locator('#win-link');
  await expect(dl).toBeVisible();
  await expect(dl).toHaveAttribute('href', /Kaatchat-Setup-2\.0\.0\.exe$/);
  await expect(page.getByText(`SHA-256 ${'a'.repeat(64)}`)).toBeVisible();
  await expect(page.getByText(/not code-signed yet/)).toBeVisible();
  // No macOS build in this release: its card still says so.
  await expect(page.locator('#mac-pending')).toBeVisible();
});

test('marketing site: a release with the macOS app offers both Macs, with checksums and the Gatekeeper step', async ({ page }) => {
  const mac = (arch: string, c: string) => ({ url: `https://github.com/x/y/releases/download/v2/Kaatchat-2.0.0-mac-${arch}.dmg`, sha256: c.repeat(64), size: 125000000 });
  await page.route('**/release.json', (r) =>
    r.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        version: '2.0.0',
        windowsUrl: 'https://github.com/x/y/releases/download/v2/Kaatchat-Setup-2.0.0.exe',
        sha256: 'a'.repeat(64),
        mac: { version: '2.0.0', arm64: mac('arm64', 'b'), x64: mac('x64', 'c'), signed: false },
      }),
    }),
  );
  await page.goto(SITE);
  await expect(page.getByRole('link', { name: 'Download for Apple Silicon' })).toHaveAttribute('href', /mac-arm64\.dmg$/);
  await expect(page.getByRole('link', { name: 'Download for Intel' })).toHaveAttribute('href', /mac-x64\.dmg$/);
  await expect(page.locator('#mac-sha')).toContainText('b'.repeat(64));
  await expect(page.locator('#mac-sha')).toContainText('c'.repeat(64));
  await expect(page.getByText(/Open Anyway/)).toBeVisible();
  await expect(page.locator('#mac-pending')).toBeHidden();
});

test('marketing site: support the artist — QR, UPI link, share, GitHub', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: SITE.replace(/\/$/, '') });
  await page.goto(SITE);
  await expect(page.getByRole('link', { name: 'GitHub', exact: true })).toHaveAttribute('href', 'https://github.com/asifkhan1308/asifkhan1308/tree/main/kaatchat');

  await page.locator('header').getByRole('button', { name: 'Support' }).click();
  const dlg = page.getByRole('dialog', { name: 'Support the artist' });
  await expect(dlg).toBeVisible();
  const qr = dlg.getByRole('img', { name: /UPI QR code/ });
  await expect(qr).toBeVisible();
  expect(await qr.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
  // The button pays exactly what the QR encodes.
  await expect(dlg.getByRole('link', { name: 'Open UPI app' })).toHaveAttribute('href', 'upi://pay?pa=aafatkhan666-1@okicici&pn=Asif%20Khan&aid=uGICAgMD70qePNQ');

  await dlg.getByRole('button', { name: 'Copy UPI ID' }).click();
  await expect(dlg.getByText('UPI ID copied.')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('aafatkhan666-1@okicici');

  // Without the Web Share API, Share copies a link that opens this dialog.
  await page.evaluate(() => Object.defineProperty(navigator, 'share', { value: undefined }));
  await dlg.getByRole('button', { name: 'Share' }).click();
  await expect(dlg.getByText(/Link copied/)).toBeVisible();
  const shared = await page.evaluate(() => navigator.clipboard.readText());
  expect(shared).toBe(`${SITE}#support`);

  await dlg.getByRole('button', { name: 'Close' }).click();
  await expect(dlg).toBeHidden();
  const fresh = await context.newPage();
  await fresh.goto(shared);
  await expect(fresh.getByRole('dialog', { name: 'Support the artist' })).toBeVisible();
});
