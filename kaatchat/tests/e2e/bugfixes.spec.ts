// Browser regression tests for the reported bugs: processing state, the
// "Measuring" toast, vertical footage, toast placement, export facts and AAC.
import { test, expect, type Locator, type Page } from '@playwright/test';
import { ensureFixtures, probe } from './fixtures';

const fx = ensureFixtures();

async function timelineSeconds(page: Page): Promise<number> {
  const [m, s, f] = (await page.locator('.timecode').innerText()).split('/')[1].trim().split(':').map(Number);
  return m * 60 + s + f / 30;
}

function overlaps(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** Imports through the editor's Import button, as a person would. */
async function importInEditor(page: Page, file: { name: string; mimeType: string; buffer: Buffer }) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await (await chooser).setFiles(file);
}

async function box(l: Locator) {
  const b = await l.boundingBox();
  expect(b).not.toBeNull();
  return b!;
}

test('processing indicator and the Measuring toast follow the real jobs (bugs 1–2)', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles(fx.talk);
  await expect(page).toHaveURL(/#\/p\//);
  // While measuring, the header says so; afterwards it is idle and the toast is gone.
  await expect(page.locator('.asset').first().getByText('Loudness')).toBeVisible();
  await expect(page.locator('.asset').first().getByText('Framing')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Background tasks' })).toBeVisible();
  await expect(page.getByText(/Processing ·/)).toHaveCount(0);
  await expect(page.locator('.toast').filter({ hasText: 'Measuring on this device' })).toHaveCount(0);
  await expect(page.locator('.toast').filter({ hasText: 'Measured 1 file.' })).toBeVisible();

  // A file that cannot be decoded still ends in a clear state.
  await importInEditor(page, { name: 'broken.mp4', mimeType: 'video/mp4', buffer: Buffer.from('not a video') });
  await expect(page.locator('.toast.err')).toBeVisible();
  await expect(page.locator('.toast').filter({ hasText: 'Measuring on this device' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Background tasks' })).toBeVisible();
});

test('toasts sit clear of the preview and never overlap each other (bug 5)', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles(fx.talk);
  await expect(page.locator('.toast').filter({ hasText: 'Measured 1 file.' })).toBeVisible();
  // A second toast while the first is still showing.
  await importInEditor(page, { name: 'broken.mp4', mimeType: 'video/mp4', buffer: Buffer.from('x') });
  await expect(page.locator('.toast.err')).toBeVisible();
  const toasts = page.locator('.toasts .toast');
  expect(await toasts.count()).toBeGreaterThanOrEqual(2);

  for (const size of [
    { width: 1440, height: 900 },
    { width: 1280, height: 720 },
  ]) {
    await page.setViewportSize(size);
    const preview = await box(page.locator('canvas[aria-label="Preview"]'));
    const boxes = [];
    for (let i = 0; i < (await toasts.count()); i++) boxes.push(await box(toasts.nth(i)));
    for (const [i, b] of boxes.entries()) {
      expect(overlaps(b, preview), `toast ${i} covers the preview at ${size.width}×${size.height}`).toBe(false);
      expect(b.x + b.width).toBeLessThanOrEqual(size.width);
      expect(b.y + b.height).toBeLessThanOrEqual(size.height);
      for (const other of boxes.slice(i + 1)) expect(overlaps(b, other)).toBe(false);
    }
  }
  // Still readable and dismissable.
  await expect(page.locator('.toasts')).toHaveAttribute('aria-live', 'polite');
  await toasts.first().getByRole('button', { name: 'Dismiss' }).click();
});

test('vertical footage makes a 9:16 edit; export reports the real duration with AAC audio (bugs 3, 6, 7)', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles(fx.vertical);
  await expect(page).toHaveURL(/#\/p\//);
  await expect(page.locator('.asset').first().getByText('Loudness')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Aspect' })).toHaveValue('9:16');
  const seconds = await timelineSeconds(page);
  expect(seconds).toBeCloseTo(4, 0);

  await page.getByRole('button', { name: 'Export' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Export' });
  await dialog.getByRole('button', { name: /^Export \d/ }).click();
  const save = dialog.getByRole('link', { name: 'Save file' });
  await expect(save).toBeVisible({ timeout: 120_000 });

  // Duration is the video's length, read back from the file — not the encode time.
  const facts = dialog.locator('.export-facts');
  const dur = /^(\d+):(\d+\.\d)$/.exec(await facts.locator('[data-fact="duration"]').innerText());
  expect(dur).not.toBeNull();
  expect(+dur![1] * 60 + +dur![2]).toBeCloseTo(seconds, 0);
  await expect(facts.locator('[data-fact="resolution"]')).toHaveText('1080×1920');
  await expect(facts.locator('[data-fact="size"]')).toHaveText(/\d.*(KB|MB)/);
  await expect(facts.locator('[data-fact="codecs"]')).toHaveText(/\+ AAC$/);
  await expect(facts.locator('[data-fact="encoded"]')).toHaveText(/^\d+\.\d s$/);

  const dl = page.waitForEvent('download');
  await save.click();
  const path = test.info().outputPath('vertical.mp4');
  await (await dl).saveAs(path);
  const info = probe(path);
  expect(info.duration).toBeCloseTo(seconds, 0);
  expect(info.video).toMatch(/1080x1920/);
  // AAC-LC in MP4 even where the browser has no native AAC encoder.
  expect(info.audio).toMatch(/^aac \(LC\)/);
  expect(info.audio).toMatch(/48000 Hz, stereo/);
});

test('a video with no audio track still exports, and says so (bug 7)', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles(fx.silent);
  await expect(page).toHaveURL(/#\/p\//);
  await expect(page.locator('.asset').first().getByText('Framing')).toBeVisible();
  await page.getByRole('button', { name: 'Export' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Export' });
  await dialog.getByRole('button', { name: /^Export \d/ }).click();
  const save = dialog.getByRole('link', { name: 'Save file' });
  await expect(save).toBeVisible({ timeout: 120_000 });
  await expect(dialog.locator('[data-fact="codecs"]')).toHaveText(/\(no audio\)$/);
  const dl = page.waitForEvent('download');
  await save.click();
  const path = test.info().outputPath('silent.mp4');
  await (await dl).saveAs(path);
  const info = probe(path);
  expect(info.video).toMatch(/640x360|1920x1080/);
  expect(info.duration).toBeCloseTo(2, 0);
});
