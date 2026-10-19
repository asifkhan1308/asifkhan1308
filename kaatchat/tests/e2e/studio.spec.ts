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

test('Studio: clip fade-out lowers the tail, mute removes the audio track', async ({ page }) => {
  await page.goto('/#/studio');
  await setValue(page.locator('.duration-field input'), 4);
  await page.locator('.v1-toolbar input[type=file]').setInputFiles(fx.talk);
  await expect(page.locator('.v1-tl-layer-row-head').first()).toContainText('talk.webm');

  const audio = page.locator('.v1-section', { hasText: 'Fade out' });
  await setValue(audio.locator('.v1-field input').nth(1), 1.5); // fade out over 2.5–4 s

  const exportOnce = async (name: string) => {
    await page.locator('.btn-export').click();
    const render = page.locator('.modal .btn-primary');
    await expect(render).toHaveText('Render', { timeout: 30_000 });
    const dl = page.waitForEvent('download', { timeout: 150_000 });
    await render.click();
    const path = test.info().outputPath(name);
    await (await dl).saveAs(path);
    await expect(page.locator('.modal')).toHaveCount(0, { timeout: 5_000 });
    return path;
  };

  const faded = await exportOnce('faded.mp4');
  // Tone runs 1–4 s; the last 0.3 s sits at ≤ 20 % gain → well over 10 dB quieter.
  expect(meanVolume(faded, 3.65, 0.3)).toBeLessThan(meanVolume(faded, 1.5, 0.9) - 10);

  await audio.getByRole('button', { name: 'Mute' }).click();
  await expect(audio.getByRole('button', { name: 'Muted' })).toHaveAttribute('aria-pressed', 'true');
  const muted = await exportOnce('muted.mp4');
  expect(probe(muted).audio).toBe('');
});

test('Studio: timeline zooms and clip trims snap to the playhead', async ({ page }) => {
  await page.goto('/#/studio');
  await page.locator('.v1-tool', { hasText: 'Rect' }).click();
  await seek(page, 0.5);

  const pct = async (loc: Locator, prop: 'left' | 'right') =>
    loc.evaluate((el, p) => {
      const s = (el as HTMLElement).style;
      return p === 'left' ? parseFloat(s.left) : parseFloat(s.left) + parseFloat(s.width);
    }, prop);
  const playhead = page.locator('.v1-tl-playhead');
  const clip = page.locator('.v1-tl-clip').first();
  const handle = page.locator('.v1-tl-clip-trim-out').first();
  const drag = async (toX: number, alt = false) => {
    const h = (await handle.boundingBox())!;
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    if (alt) await page.keyboard.down('Alt');
    await page.mouse.down();
    await page.mouse.move(toX, h.y + h.height / 2, { steps: 6 });
    await page.mouse.up();
    if (alt) await page.keyboard.up('Alt');
  };
  const phX = async () => { const b = (await playhead.boundingBox())!; return b.x + b.width / 2; };

  // Edge lands a few px past the playhead (the handle is grabbed ~3 px inside the edge) → snaps onto it.
  await drag((await phX()) + 2);
  expect(await pct(clip, 'right')).toBeCloseTo(await pct(playhead, 'left'), 4);
  // Alt bypasses snapping.
  await drag((await phX()) - 15, true);
  expect(Math.abs((await pct(clip, 'right')) - (await pct(playhead, 'left')))).toBeGreaterThan(0.1);

  // Zoom in → the track overflows and scrolls; Fit restores it.
  const grid = page.locator('.v1-tl-grid');
  const overflows = () => grid.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
  expect(await overflows()).toBe(false);
  await page.getByTitle('Zoom in (⌘/Ctrl + scroll)').click();
  await page.getByTitle('Zoom in (⌘/Ctrl + scroll)').click();
  expect(await overflows()).toBe(true);
  // Finer ruler ticks when zoomed.
  expect(await page.locator('.v1-tl-tick').count()).toBeGreaterThan(11);
  await page.getByTitle('Fit timeline').click();
  expect(await overflows()).toBe(false);
});

test('Studio: drag layers to restack them and rename inline', async ({ page }) => {
  await page.goto('/#/studio');
  for (const t of ['Text', 'Rect', 'Ellipse']) await page.locator('.v1-tool', { hasText: t }).click();
  const heads = page.locator('.v1-tl-layer-row-head');
  const names = () => page.locator('.v1-tl-layer-row-head .v1-tl-layer-type').allInnerTexts();
  expect((await names()).map((s) => s.toLowerCase())).toEqual(['text', 'rectangle', 'ellipse']);

  // Drag the ellipse row up two rows.
  const b = (await heads.nth(2).locator('.v1-tl-layer-meta').boundingBox())!;
  await page.mouse.move(b.x + 10, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + 10, b.y + b.height / 2 - 2 * b.height - 40, { steps: 8 });
  await expect(heads.first()).toHaveClass(/drop-before/);
  await page.mouse.up();
  expect((await names()).map((s) => s.toLowerCase())).toEqual(['ellipse', 'text', 'rectangle']);

  // Double-click → rename, Enter commits; Escape cancels.
  await heads.nth(1).locator('.v1-tl-layer-name').dblclick();
  await page.locator('.v1-tl-rename').fill('Hero title');
  await page.keyboard.press('Enter');
  await expect(heads.nth(1).locator('.v1-tl-layer-name')).toHaveText('Hero title');
  await heads.nth(1).locator('.v1-tl-layer-name').dblclick();
  await page.locator('.v1-tl-rename').fill('nope');
  await page.keyboard.press('Escape');
  await expect(heads.nth(1).locator('.v1-tl-layer-name')).toHaveText('Hero title');

  // Right-click → Rename… opens the same inline field.
  await heads.nth(2).click({ button: 'right' });
  await page.locator('.v1-ctx-item, [role=menuitem]', { hasText: 'Rename' }).first().click();
  await page.locator('.v1-tl-rename').fill('Box');
  await page.keyboard.press('Enter');
  await expect(heads.nth(2).locator('.v1-tl-layer-name')).toHaveText('Box');

  // Undo restores the previous name.
  await page.keyboard.press('ControlOrMeta+z');
  await expect(heads).toHaveCount(3);
  await expect(heads.nth(2).locator('.v1-tl-layer-name')).not.toHaveText('Box');
});

test('Studio: ✦ Ask works offline — add, style, animate and trim in one undoable command', async ({ page }) => {
  await page.goto('/#/studio');
  const ask = page.locator('.v1-ai-input');
  await ask.fill('add a title "Launch day" and pop it in, make it red, trim to 3s');
  await ask.press('Enter');
  await expect(page.locator('.v1-ai-status')).toContainText('Applied 4 actions');
  const heads = page.locator('.v1-tl-layer-row-head');
  await expect(heads).toHaveCount(1);
  await expect(page.locator('.text-input')).toHaveValue('Launch day');
  // pop = 3 scale keys; the clip is 3 s of the 10 s comp.
  await expect(page.locator('.v1-tl-layer-row-track').first().locator('.v1-tl-kf')).toHaveCount(3);
  const width = await page.locator('.v1-tl-clip').first().evaluate((el) => parseFloat((el as HTMLElement).style.width));
  expect(width).toBeCloseTo(30, 1);

  // One ⌘Z removes the whole command.
  await page.locator('.v1-canvas-wrap').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('ControlOrMeta+z');
  await expect(heads).toHaveCount(0);

  // Unknown phrases explain themselves instead of failing silently.
  await ask.fill('write me a poem');
  await ask.press('Enter');
  await expect(page.locator('.v1-ai-status.err')).toContainText('Offline mode');
});

test('Studio regressions: first video frame, saved state on reopen, dialogs, comp duration', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const centre = () => page.evaluate(() => {
    const c = document.querySelector('.v1-canvas') as HTMLCanvasElement;
    return [...c.getContext('2d')!.getImageData(c.width >> 1, c.height >> 1, 1, 1).data].slice(0, 3);
  });
  await page.goto('/#/studio');
  await page.locator('.v1-tool', { hasText: 'Rect' }).click();          // white box under the video
  await page.locator('.v1-toolbar input[type=file]').setInputFiles(fx.talk);
  // The imported video's first frame paints without moving the playhead (was: the box showed through).
  await expect.poll(centre, { timeout: 10_000 }).not.toEqual([255, 255, 255]);

  // Saved, then reopened → still "Saved", not "Unsaved".
  await page.locator('.v1-menu-trigger').click();
  await page.locator('.v1-menu-item', { hasText: 'Save' }).first().click();
  await expect(page.locator('.v1-save-badge')).toContainText('Saved');
  await page.waitForTimeout(1600); // past the autosave debounce
  await page.reload();
  await page.locator('.v1-menu-trigger').click();
  await page.locator('.v1-menu-recent-main').first().click();
  await expect(page.locator('.v1-tl-layer-row-head')).toHaveCount(2);
  await expect(page.locator('.v1-save-badge')).toContainText('Saved');
  await expect.poll(centre, { timeout: 10_000 }).not.toEqual([255, 255, 255]);

  // Dialogs: Escape closes; Delete behind a dialog does not delete the selected layer.
  await page.locator('.v1-tl-layer-row-head').first().click();
  await page.locator('.btn-export').click();
  await expect(page.locator('.modal')).toBeVisible();
  await page.keyboard.press('Delete');
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal')).toHaveCount(0);
  await expect(page.locator('.v1-tl-layer-row-head')).toHaveCount(2);

  // Shortening the comp clamps the playhead; clips stay inside the track.
  await page.keyboard.press('End');
  await setValue(page.locator('.duration-field input'), 4);
  await expect(page.locator('.v1-tl-time')).toHaveText(/^04:00 \/ 04:00$/);
  // A layer longer than the comp must not make the timeline scroll sideways at Fit zoom.
  expect(await page.locator('.v1-tl-grid').evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  expect(errors).toEqual([]);
});
