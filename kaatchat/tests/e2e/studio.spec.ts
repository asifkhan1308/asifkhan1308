import { test, expect, type Locator, type Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { ensureFixtures, ffmpeg, meanVolume, probe } from './fixtures';

const fx = ensureFixtures();

/* MOTIONLAB V1 (Studio) acceptance workflow from the V1 spec:
 * new comp → import video → text → rectangle → animate opacity + position →
 * change easing → save → export MP4 → verify file → reload and reopen. */

async function setValue(loc: Locator, v: string | number) {
  await loc.evaluate((el, val) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, String(val));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, v);
}

async function seek(page: Page, fraction: number) {
  const b = (await page.locator('.v1-tl-ruler').boundingBox())!;
  await page.mouse.click(b.x + Math.max(1, b.width * fraction), b.y + b.height / 2);
}

const transform = (page: Page) => page.locator('.v1-inspector .v1-section').first();

/** md5 of a cropped frame, to prove the source video advances in the export. */
function frameHash(file: string, frame: number): string {
  const r = spawnSync(ffmpeg, ['-v', 'error', '-i', file, '-vf', `select='eq(n\\,${frame})',crop=400:400:1400:340`, '-frames:v', '1', '-f', 'rawvideo', '-']);
  return createHash('md5').update(r.stdout).digest('hex');
}

test('Studio: import, animate, ease, save, export with clip audio, reopen', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/#/studio');
  await setValue(page.locator('.duration-field input'), 4);

  // Import a real clip (10 s, tone at 1–4 s, moving test pattern on the right).
  await page.locator('.v1-toolbar input[type=file]').setInputFiles(fx.talk);
  await expect(page.locator('.v1-tl-layer-row-head').first()).toContainText('talk.webm');

  // Text "MOTIONLAB": opacity 0 → 1 between 0 s and 2 s, linear.
  await page.locator('.v1-tool', { hasText: 'Text' }).click();
  await setValue(page.locator('.text-input'), 'MOTIONLAB');
  await seek(page, 0);
  await setValue(transform(page).locator('input[type=range]'), 0);
  await transform(page).locator('.v1-diamond').nth(4).click();
  await seek(page, 0.5);
  await setValue(transform(page).locator('input[type=range]'), 1);
  await expect(page.locator('.v1-easing')).toBeVisible();
  await page.locator('.v1-easing').first().selectOption('linear');

  // Rectangle: position X 400 → 1500 between 0 s and 2 s.
  await page.locator('.v1-tool', { hasText: 'Rect' }).click();
  const pos = transform(page).locator('.v1-field input');
  await seek(page, 0);
  await setValue(pos.nth(0), 400);
  await transform(page).locator('.v1-diamond').nth(0).click();
  await seek(page, 0.5);
  await setValue(pos.nth(0), 1500);

  const tracks = page.locator('.v1-tl-layer-row-track');
  await expect(tracks.nth(1).locator('.v1-tl-kf')).toHaveCount(2);
  await expect(tracks.nth(2).locator('.v1-tl-kf')).toHaveCount(2);

  // Scrubbing interpolates: X at ~1 s sits strictly between the keys.
  await seek(page, 0.25);
  const midX = Number(await pos.nth(0).inputValue());
  expect(midX).toBeGreaterThan(450);
  expect(midX).toBeLessThan(1450);

  // Save.
  await page.locator('.v1-menu-trigger').click();
  await page.locator('.v1-menu-item', { hasText: 'Save' }).first().click();
  await expect(page.locator('.v1-save-badge')).toContainText('Saved');

  // Export MP4.
  await page.locator('.btn-export').click();
  const render = page.locator('.modal .btn-primary');
  await expect(render).toHaveText('Render', { timeout: 30_000 });
  const dl = page.waitForEvent('download', { timeout: 150_000 });
  await render.click();
  const path = test.info().outputPath('studio.mp4');
  await (await dl).saveAs(path);

  const info = probe(path);
  expect(info.duration).toBeGreaterThan(3.9);
  expect(info.duration).toBeLessThan(4.2);
  expect(info.video).toMatch(/h264|vp9|av1/);
  expect(info.video).toMatch(/1920x1080/);
  // Clip audio is carried into the export: tone (1–4 s) well above the lead-in silence.
  expect(info.audio).toMatch(/^(aac|opus)/);
  expect(meanVolume(path, 1.5, 1.5)).toBeGreaterThan(meanVolume(path, 0.1, 0.7) + 20);
  // The source video advances (not frozen on its first frame).
  expect(frameHash(path, 6)).not.toBe(frameHash(path, 18));

  // Reload and reopen from Recent: the project survives with all three layers.
  await page.reload();
  await page.locator('.v1-menu-trigger').click();
  await page.locator('.v1-menu-recent-main').first().click();
  await expect(page.locator('.v1-tl-layer-row-head')).toHaveCount(3);

  expect(errors).toEqual([]);
});
