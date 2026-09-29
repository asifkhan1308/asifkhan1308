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
  await expect(page.getByRole('link', { name: 'Download for Windows' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Open (the web app|Kaatchat)/ })).toHaveCount(0);
  await expect(page.getByText(/published on GitHub Releases/)).toBeVisible();
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
});
