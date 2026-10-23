import { test, expect, type Locator, type Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
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

/** Mean absolute grey-level difference between two frames of the same crop (0–255). */
function frameDiff(file: string, a: number, b: number): number {
  const grab = (n: number) => spawnSync(ffmpeg, ['-v', 'error', '-i', file, '-vf', `select='eq(n\\,${n})',crop=400:400:1400:340`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-']).stdout;
  const x = grab(a), y = grab(b);
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += Math.abs(x[i] - y[i]);
  return sum / Math.max(1, x.length);
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
  await expect(page.locator('.v1-tl-time')).toHaveText(/^0:04\.00 \/ 0:04\.00$/);
  // A layer longer than the comp must not make the timeline scroll sideways at Fit zoom.
  expect(await page.locator('.v1-tl-grid').evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  expect(errors).toEqual([]);
});

test('Studio: Generate builds an editable video offline, and through a local model', async ({ page }) => {
  await page.goto('/#/studio');
  const heads = page.locator('.v1-tl-layer-row-head');

  // Offline template (no AI connected).
  await page.getByRole('button', { name: 'Generate ▸' }).click();
  await expect(page.locator('.v1-gen-engine')).toContainText('Offline template');
  await page.locator('.v1-gen-input').fill('a 6 second intro for "Asif\'s Bakery" with "Fresh every morning", gold accents');
  await page.locator('.v1-gen-go').click();
  await expect(page.locator('.modal')).toHaveCount(0);
  await expect(heads).toHaveCount(4);
  await expect(heads.nth(2)).toContainText('Title');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(heads).toHaveCount(0);

  // Local engine: a stand-in Ollama server answers; the real provider code runs.
  await page.evaluate(() => localStorage.setItem('kaatchat.ai.settings', JSON.stringify({
    active: 'local',
    providers: { local: { enabled: true, model: 'llama3.2', baseUrl: 'http://localhost:11434', api: 'ollama' } },
  })));
  let asked = '';
  await page.route('http://localhost:11434/api/chat', async (route) => {
    asked = route.request().postData() ?? '';
    const actions = [
      { op: 'comp', duration: 5 },
      { op: 'add_layer', type: 'rectangle', name: 'Sky' },
      { op: 'set', path: 'size', value: [1920, 1080] },
      { op: 'set_color', color: '#112244' },
      { op: 'add_layer', type: 'text', name: 'Headline', text: 'Night Market' },
      { op: 'preset', name: 'slide_in_up', at: 0.3 },
      { op: 'teleport' },
    ];
    await route.fulfill({ json: { message: { content: '```json\n' + JSON.stringify({ actions }) + '\n```' } } });
  });
  await page.getByRole('button', { name: 'Generate ▸' }).click();
  await expect(page.locator('.v1-gen-engine')).toContainText('Local AI');
  await page.locator('.v1-gen-input').fill('a night market teaser');
  await page.locator('.v1-gen-go').click();
  await expect(page.locator('.modal')).toHaveCount(0);
  await expect(heads).toHaveCount(2);
  await expect(heads.nth(1)).toContainText('Headline');
  await expect(page.locator('.v1-tl-time')).toContainText('/ 0:05.00');
  expect(asked).toContain('DESIGNING a complete short motion graphic');
  expect(asked).toContain('a night market teaser');

  // A broken reply is reported in the dialog, not applied.
  await page.unroute('http://localhost:11434/api/chat');
  await page.route('http://localhost:11434/api/chat', (route) => route.fulfill({ json: { message: { content: 'Sorry, I cannot help.' } } }));
  await page.getByRole('button', { name: 'Generate ▸' }).click();
  await page.locator('.v1-gen-input').fill('anything');
  await page.locator('.v1-gen-go').click();
  await expect(page.locator('.v1-gen-err')).toContainText('JSON');
  await expect(heads).toHaveCount(2);
});

test('Studio V1.5: share a review link, comment as a reviewer, pin feedback to the timeline', async ({ page, context }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/#/studio');

  // Creator: generate a piece, save it, open Share.
  await page.getByRole('button', { name: 'Generate ▸' }).click();
  await page.locator('.v1-gen-input').fill('a 6 second intro for "Launch Day" with "Join us live"');
  await page.locator('.v1-gen-go').click();
  await page.locator('.v1-menu-trigger').click();
  await page.locator('.v1-menu-item', { hasText: 'Save' }).first().click();
  await expect(page.locator('.v1-save-badge')).toContainText('Saved');
  await page.locator('.btn-share').click();
  await expect(page.locator('.v1-share-link')).toHaveValue(/#\/review\/1\./);
  const link = await page.locator('.v1-share-link').inputValue();
  await expect(page.locator('.v1-share-warn')).toHaveCount(0); // no imported media
  await page.keyboard.press('Escape');

  // Reviewer: open the link in another tab, play, comment at two moments, send.
  const rev = await context.newPage();
  rev.on('pageerror', (e) => errors.push(e.message));
  await rev.goto('/' + link.slice(link.indexOf('#')));
  await expect(rev.locator('.v1-review-title')).toHaveText('Untitled Project');
  const frame = () => rev.evaluate(() => {
    const c = document.querySelector('.v1-review-canvas') as HTMLCanvasElement;
    return [...c.getContext('2d')!.getImageData(c.width >> 1, (c.height >> 1) - 10, 1, 1).data];
  });
  const scrub = rev.locator('.v1-review-scrub input');
  const seekTo = (t: number) => scrub.evaluate((el, v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, t);
  await seekTo(0);
  const blank = await frame();
  await seekTo(1.5);
  await expect.poll(frame).not.toEqual(blank); // the title has popped in — real rendering
  await rev.locator('.v1-review-name').fill('Sam');
  await rev.locator('.v1-review-input').fill('Make the title bigger');
  await rev.locator('.v1-review-input').press('Enter');
  await seekTo(4);
  await rev.locator('.v1-review-input').fill('Hold the end a bit longer');
  await rev.locator('.v1-review-add').click();
  await expect(rev.locator('.v1-review-list li')).toHaveCount(2);
  await expect(rev.locator('.v1-review-marker')).toHaveCount(2);
  await rev.locator('.v1-review-send-btn').click();
  await expect(rev.locator('.v1-review-reply')).toHaveValue(/#\/studio\/feedback\/1\./);
  const replyLink = await rev.locator('.v1-review-reply').inputValue();

  // Creator: open the feedback link → project reopens with markers + list.
  await page.goto('/#/');
  await page.goto('/' + replyLink.slice(replyLink.indexOf('#')));
  await expect(page.locator('.v1-banner')).toContainText('2 new comments from Sam');
  await expect(page.locator('.v1-tl-layer-row-head')).toHaveCount(4); // the reviewed project, not a blank one
  await expect(page.locator('.v1-tl-comment')).toHaveCount(2);
  await expect(page).toHaveURL(/#\/studio$/);
  await page.locator('.v1-tl-feedback-btn').click();
  await expect(page.locator('.v1-tl-fb-item')).toHaveCount(2);
  await page.locator('.v1-tl-fb-at').first().click();
  await expect(page.locator('.v1-tl-time')).toHaveText(/^0:01\.50 \//);
  await page.locator('.v1-tl-fb-done input').first().check();
  await expect(page.locator('.v1-tl-comment')).toHaveCount(1);
  await expect(page.locator('.v1-tl-feedback-btn')).toHaveText('Feedback 1/2');

  // Opening the same feedback link again doesn't duplicate comments.
  await page.goto('/#/');
  await page.goto('/' + replyLink.slice(replyLink.indexOf('#')));
  await expect(page.locator('.v1-banner')).toContainText('0 new comments');
  await expect(page.locator('.v1-tl-feedback-btn')).toHaveText('Feedback 1/2');

  // A damaged link explains itself.
  await rev.goto('/' + link.slice(link.indexOf('#'), link.length - 40));
  await expect(rev.locator('.v1-review-empty')).toContainText('incomplete or damaged');
  expect(errors).toEqual([]);
});

test('Studio: parenting — a rectangle follows its null on canvas and in the export', async ({ page }) => {
  await page.goto('/#/studio');
  await setValue(page.locator('.duration-field input'), 2);
  await page.locator('.v1-tool', { hasText: 'Rect' }).click();       // white box at the centre
  await page.locator('.v1-tool', { hasText: 'Null' }).click();
  const heads = page.locator('.v1-tl-layer-row-head');
  await heads.nth(0).click();                                          // select the rectangle
  // Options for the rectangle: None, then the null (it can't parent to itself).
  await expect(page.getByLabel('Parent layer').locator('option')).toHaveCount(2);
  await page.getByLabel('Parent layer').selectOption({ index: 1 });
  await expect(heads.nth(0)).toContainText('↳');
  const px = (x: number, y: number) => page.evaluate(([cx, cy]) => {
    const c = document.querySelector('.v1-canvas') as HTMLCanvasElement;
    const k = c.width / 1920;
    return [...c.getContext('2d')!.getImageData(Math.round(cx * k), Math.round(cy * k), 1, 1).data][0];
  }, [x, y]);
  expect(await px(960, 540)).toBeGreaterThan(200);                     // box drawn at centre
  // Move ONLY the null, +500 px right.
  await heads.nth(1).click();
  const posX = page.locator('.v1-inspector .v1-section').first().locator('.v1-field input').first();
  const nx = Number(await posX.inputValue());
  await setValue(posX, nx + 500);
  await expect.poll(() => px(1460, 540)).toBeGreaterThan(200);         // the child came along
  expect(await px(960 - 250, 540)).toBeLessThan(60);                    // and left its old spot

  // Export: the exported frame shows the child at the parented place too.
  await page.locator('.btn-export').click();
  const render = page.locator('.modal .btn-primary');
  await expect(render).toHaveText('Render', { timeout: 30_000 });
  const dl = page.waitForEvent('download', { timeout: 120_000 });
  await render.click();
  const path = test.info().outputPath('parented.mp4');
  await (await dl).saveAs(path);
  const lum = (x: number, y: number) => {
    const r = spawnSync(ffmpeg, ['-v', 'error', '-i', path, '-vf', `select='eq(n\\,10)',crop=4:4:${x}:${y}`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-']);
    return r.stdout.reduce((a, b) => a + b, 0) / Math.max(1, r.stdout.length);
  };
  expect(lum(1458, 538)).toBeGreaterThan(200);
  expect(lum(708, 538)).toBeLessThan(60);
});

test('Studio: smart guides snap canvas drags to the frame centre; Alt drags freely', async ({ page }) => {
  await page.goto('/#/studio');
  await page.locator('.v1-tool', { hasText: 'Ellipse' }).click();      // centred at 960,540
  const stage = (await page.locator('.v1-canvas').boundingBox())!;
  const k = stage.width / 1920;
  const cx = stage.x + 960 * k, cy = stage.y + 540 * k;
  const pos = page.locator('.v1-inspector .v1-section').first().locator('.v1-field input');

  // Drag right 300 comp px and 3 screen px down: the 3 px slip snaps back to the centre line.
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 150 * k, cy + 2, { steps: 4 });
  await page.mouse.move(cx + 300 * k, cy + 3, { steps: 4 });
  await expect(page.locator('.v1-guide')).toHaveCount(1);              // horizontal centre guide shown
  await page.mouse.up();
  await expect(page.locator('.v1-guide')).toHaveCount(0);
  expect(Number(await pos.nth(1).inputValue())).toBe(540);
  expect(Math.abs(Number(await pos.nth(0).inputValue()) - 1260)).toBeLessThan(4);

  // Same slip with Alt held: no snapping.
  const x1 = stage.x + Number(await pos.nth(0).inputValue()) * k;
  await page.mouse.move(x1, cy);
  await page.keyboard.down('Alt');
  await page.mouse.down();
  await page.mouse.move(x1, cy + 3, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  expect(Number(await pos.nth(1).inputValue())).toBeGreaterThan(542);
});

test('Studio: hold keyframes, named curves with overshoot, and the custom curve editor', async ({ page }) => {
  await page.goto('/#/studio');
  await setValue(page.locator('.duration-field input'), 4);
  await page.locator('.v1-tool', { hasText: 'Rect' }).click();
  const pos = transform(page).locator('.v1-field input');
  await seek(page, 0);
  await setValue(pos.nth(0), 400);
  await transform(page).locator('.v1-diamond').nth(0).click();
  await seek(page, 0.5);                                               // 2 s
  await setValue(pos.nth(0), 1500);
  const easing = page.locator('.v1-easing').first();

  await easing.selectOption('hold');
  await seek(page, 0.25);                                              // 1 s: still the first value
  expect(Number(await pos.nth(0).inputValue())).toBe(400);

  await seek(page, 0.5);
  await easing.selectOption({ label: 'Overshoot' });
  await expect(page.locator('.v1-curve')).toBeVisible();               // named curves are editable too
  await seek(page, 0.36);                                              // ~1.45 s: past the target
  expect(Number(await pos.nth(0).inputValue())).toBeGreaterThan(1500);

  await seek(page, 0.5);
  const code = page.locator('.v1-curve-code');
  await expect(code).toHaveText('cubic-bezier(0.34, 1.56, 0.64, 1)');
  const h = (await page.locator('.v1-curve-handle.h1').boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2 + 20, h.y + h.height / 2 + 30, { steps: 4 });
  await page.mouse.up();
  await expect(code).not.toHaveText('cubic-bezier(0.34, 1.56, 0.64, 1)');
  await expect(easing).toHaveValue('bezier');                          // now a custom curve
});

test('Studio: track mattes — alpha and inverted, on canvas and in the export', async ({ page }) => {
  await page.goto('/#/studio');
  await setValue(page.locator('.duration-field input'), 2);
  // White 576×324 rectangle, then a red 324-px circle, both centred.
  await page.locator('.v1-tool', { hasText: 'Rect' }).click();
  await page.locator('.v1-ai-input').fill('add a circle, make it red');
  await page.locator('.v1-ai-input').press('Enter');
  await expect(page.locator('.v1-ai-status')).toContainText('Applied 2');
  const rgb = (x: number, y: number) => page.evaluate(([cx, cy]) => {
    const c = document.querySelector('.v1-canvas') as HTMLCanvasElement;
    const k = c.width / 1920;
    return [...c.getContext('2d')!.getImageData(Math.round(cx * k), Math.round(cy * k), 1, 1).data].slice(0, 3);
  }, [x, y]);
  expect(await rgb(960, 540)).toEqual([255, 59, 48]);                  // red circle on top

  // Rectangle: Alpha matte = the circle.
  await page.locator('.v1-tl-layer-row-head').first().click();
  const matte = page.locator('.v1-matte-select');
  await matte.selectOption({ index: 1 });                               // "Alpha · <circle>"
  await expect.poll(() => rgb(960, 540)).toEqual([255, 255, 255]);      // rect shows through; circle itself hidden
  expect((await rgb(1190, 540))[0]).toBeLessThan(30);                   // rect outside the circle: cut away

  // Inverted.
  await matte.selectOption({ index: 2 });                               // "Inverted · <circle>"
  await expect.poll(async () => (await rgb(960, 540))[0]).toBeLessThan(30);
  expect(await rgb(1190, 540)).toEqual([255, 255, 255]);

  // Export (inverted): same pixels in the MP4.
  await page.locator('.btn-export').click();
  const render = page.locator('.modal .btn-primary');
  await expect(render).toHaveText('Render', { timeout: 30_000 });
  const dl = page.waitForEvent('download', { timeout: 120_000 });
  await render.click();
  const path = test.info().outputPath('matte.mp4');
  await (await dl).saveAs(path);
  const lum = (x: number, y: number) => {
    const r = spawnSync(ffmpeg, ['-v', 'error', '-i', path, '-vf', `select='eq(n\\,5)',crop=4:4:${x}:${y}`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-']);
    return r.stdout.reduce((a, b) => a + b, 0) / Math.max(1, r.stdout.length);
  };
  expect(lum(958, 538)).toBeLessThan(40);
  expect(lum(1188, 538)).toBeGreaterThan(200);
});

test('Studio: align to frame buttons', async ({ page }) => {
  await page.goto('/#/studio');
  await page.locator('.v1-tool', { hasText: 'Rect' }).click();          // 576×324, anchored at its centre
  const pos = transform(page).locator('.v1-field input');
  await page.getByRole('button', { name: 'Align left' }).click();
  await expect(pos.nth(0)).toHaveValue('288');
  await page.getByRole('button', { name: 'Align bottom' }).click();
  await expect(pos.nth(1)).toHaveValue('918');
  await page.getByRole('button', { name: 'Align horizontal centres' }).click();
  await page.getByRole('button', { name: 'Align vertical centres' }).click();
  await expect(pos.nth(0)).toHaveValue('960');
  await expect(pos.nth(1)).toHaveValue('540');
});

test('Studio: text animator — typewriter reveals left to right without the text sliding', async ({ page }) => {
  // (Also guards: shortcut keys don't fire while a <select> has focus.)
  await page.goto('/#/studio');
  await setValue(page.locator('.duration-field input'), 4);
  await page.locator('.v1-ai-input').fill('add a title "MMMMMMMMMMMM"');
  await page.locator('.v1-ai-input').press('Enter');
  await page.getByLabel('Text animator').selectOption('typewriter');
  await expect(page.getByLabel('Reveal amount')).toBeVisible();
  // Columns that have lit text pixels in the band just above the baseline (y≈540).
  const litColumns = () => page.evaluate(() => {
    const c = document.querySelector('.v1-canvas') as HTMLCanvasElement;
    const k = c.width / 1920;
    const y0 = Math.round(470 * k), y1 = Math.round(530 * k);
    const d = c.getContext('2d')!.getImageData(0, y0, c.width, y1 - y0).data;
    const cols: number[] = [];
    for (let x = 0; x < c.width; x++) {
      for (let y = 0; y < y1 - y0; y++) if (d[(y * c.width + x) * 4] > 128) { cols.push(x / k); break; }
    }
    return cols;
  });
  await seek(page, 0);
  expect(await litColumns()).toHaveLength(0);                            // nothing typed yet
  await seek(page, 0.99);
  await expect(page.getByLabel('Text animator')).toHaveValue('typewriter');
  await expect.poll(async () => (await litColumns()).length).toBeGreaterThan(50);
  const full = await litColumns();
  const [minX, maxX] = [Math.min(...full), Math.max(...full)];
  // Halfway through the reveal (keys at 0 s and ~1.5 s).
  await seek(page, 0.75 / 4);
  const half = await litColumns();
  expect(half.length).toBeGreaterThan(5);
  expect(Math.min(...half)).toBeCloseTo(minX, -1);                       // starts where the full text starts
  expect(Math.max(...half)).toBeLessThan(minX + (maxX - minX) * 0.7);    // right part not typed yet
});

test('Studio: keyboard shortcuts leave a focused dropdown alone', async ({ page }) => {
  await page.goto('/#/studio');
  await page.locator('.v1-tool', { hasText: 'Text' }).click();
  const anim = page.getByLabel('Text animator');
  await anim.focus();
  const before = await page.locator('.v1-tl-time').innerText();
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.v1-tl-time')).toHaveText(before);          // playhead didn't move
  await expect(page.locator('.v1-tl-layer-row-head')).toHaveCount(1);
});

test('Studio: multi-select — shift-click, group drag, align, distribute, delete as one undo', async ({ page }) => {
  await page.goto('/#/studio');
  const pos = transform(page).locator('.v1-field input');
  const heads = page.locator('.v1-tl-layer-row-head');
  const xs = [300, 1000, 1500];
  for (let i = 0; i < 3; i++) {
    await page.locator('.v1-tool', { hasText: 'Ellipse' }).click();
    await setValue(pos.nth(0), xs[i]);
    await setValue(pos.nth(1), 300 + i * 200);
  }
  // Shift-click all three rows.
  await heads.nth(0).click();
  await heads.nth(1).click({ modifiers: ['Shift'] });
  await heads.nth(2).click({ modifiers: ['Shift'] });
  await expect(page.locator('.v1-tl-layer-row-head.selected')).toHaveCount(3);
  await expect(page.locator('.v1-multi-note')).toContainText('3 layers selected');

  const xOf = async (i: number) => { await heads.nth(i).click(); return Number(await pos.nth(0).inputValue()); };
  const reselect = async () => {
    await heads.nth(0).click();
    await heads.nth(1).click({ modifiers: ['Shift'] });
    await heads.nth(2).click({ modifiers: ['Shift'] });
  };

  // Align left → all share the leftmost x.
  await page.getByRole('button', { name: 'Align left' }).click();
  expect([await xOf(0), await xOf(1), await xOf(2)]).toEqual([300, 300, 300]);
  await page.keyboard.press('ControlOrMeta+z');                         // one undo restores all
  expect([await xOf(0), await xOf(1), await xOf(2)]).toEqual(xs);

  // Distribute horizontally: the middle one moves to the midpoint.
  await reselect();
  await page.getByRole('button', { name: 'Distribute horizontally' }).click();
  expect(await xOf(1)).toBe(900);

  // Group drag on the canvas: everything moves by the same amount.
  await reselect();
  const before = [await xOf(0), await xOf(1), await xOf(2)];
  await reselect();
  const stage = (await page.locator('.v1-canvas').boundingBox())!;
  const k = stage.width / 1920;
  const [sx, sy] = [stage.x + 900 * k, stage.y + 500 * k];             // middle ellipse
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 40, sy + 2, { steps: 5 });
  await page.mouse.up();
  const after = [await xOf(0), await xOf(1), await xOf(2)];
  const d = after.map((v, i) => v - before[i]);
  expect(d[0]).toBeGreaterThan(50);
  expect(d[1]).toBeCloseTo(d[0], 0);
  expect(d[2]).toBeCloseTo(d[0], 0);

  // Delete all three, then one undo brings them back.
  await reselect();
  await page.keyboard.press('Delete');
  await expect(heads).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(heads).toHaveCount(3);
});

test('Studio: shift-clicking timeline rows does not highlight page text', async ({ page }) => {
  await page.goto('/#/studio');
  for (let i = 0; i < 2; i++) await page.locator('.v1-tool', { hasText: 'Rect' }).click();
  const heads = page.locator('.v1-tl-layer-row-head');
  await heads.nth(0).click();
  await heads.nth(1).click({ modifiers: ['Shift'] });
  expect(await page.evaluate(() => String(window.getSelection() ?? ''))).toBe('');
});

test('Studio: glow and drop shadow render around a layer', async ({ page }) => {
  await page.goto('/#/studio');
  await page.locator('.v1-tool', { hasText: 'Rect' }).click();           // white 576×324 at the centre
  await page.locator('.v1-inspector').getByRole('button', { name: '+ Enable' }).click();
  const lum = (x: number, y: number) => page.evaluate(([cx, cy]) => {
    const c = document.querySelector('.v1-canvas') as HTMLCanvasElement;
    const k = c.width / 1920;
    return c.getContext('2d')!.getImageData(Math.round(cx * k), Math.round(cy * k), 1, 1).data[0];
  }, [x, y]);
  const slider = (label: string) => page.locator('.v1-prop', { hasText: label }).locator('input[type=range]');
  // Just outside the rectangle's right edge (x 1248) — dark before.
  expect(await lum(1268, 540)).toBeLessThan(10);
  await setValue(slider('Glow'), 1);
  await expect.poll(() => lum(1268, 540)).toBeGreaterThan(60);           // glow lights it up
  await setValue(slider('Glow'), 0);
  await expect.poll(() => lum(1268, 540)).toBeLessThan(10);

  // White drop shadow: shows below the box (y 702+), not above it (y < 378).
  await page.getByLabel('Shadow colour').evaluate((el) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, '#ffffff');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await setValue(slider('Drop shadow'), 1);
  await expect.poll(() => lum(960, 716)).toBeGreaterThan(60);
  expect(await lum(960, 364)).toBeLessThan(40);

  // The export (an OffscreenCanvas context) renders glow + shadow too.
  await setValue(page.locator('.duration-field input'), 1);
  await setValue(slider('Glow'), 1);
  await page.locator('.btn-export').click();
  const render = page.locator('.modal .btn-primary');
  await expect(render).toHaveText('Render', { timeout: 30_000 });
  const dl = page.waitForEvent('download', { timeout: 120_000 });
  await render.click();
  const path = test.info().outputPath('glow.mp4');
  await (await dl).saveAs(path);
  const out = (x: number, y: number) => {
    const r = spawnSync(ffmpeg, ['-v', 'error', '-i', path, '-vf', `select='eq(n\\,3)',crop=4:4:${x}:${y}`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-']);
    return r.stdout.reduce((a, b) => a + b, 0) / Math.max(1, r.stdout.length);
  };
  expect(out(1266, 538)).toBeGreaterThan(50);                             // glow beside the box
  expect(out(958, 714)).toBeGreaterThan(50);                              // shadow below it
  expect(out(40, 40)).toBeLessThan(20);                                   // corner stays dark
});

test('Studio: ⌘C / ⌘V copies layers, and still copies keyframes when there are some at the playhead', async ({ page }) => {
  await page.goto('/#/studio');
  const heads = page.locator('.v1-tl-layer-row-head');
  await page.locator('.v1-tool', { hasText: 'Ellipse' }).click();
  await page.locator('.v1-tool', { hasText: 'Rect' }).click();
  // Two layers selected, no keyframes → layers are copied and pasted on top.
  await heads.nth(0).click();
  await heads.nth(1).click({ modifiers: ['Shift'] });
  await page.locator('.v1-canvas-wrap').hover();
  await page.keyboard.press('ControlOrMeta+c');
  await page.keyboard.press('ControlOrMeta+v');
  await expect(heads).toHaveCount(4);
  await expect(page.locator('.v1-tl-layer-row-head.selected')).toHaveCount(2); // the pasted pair
  await page.keyboard.press('ControlOrMeta+z');
  await expect(heads).toHaveCount(2);

  // With a keyframe at the playhead, ⌘C copies keyframes (unchanged behaviour).
  await heads.nth(1).click();
  await transform(page).locator('.v1-diamond').nth(4).click();            // opacity key at 0 s
  await page.keyboard.press('ControlOrMeta+c');
  await heads.nth(0).click();
  await page.keyboard.press('ControlOrMeta+v');
  await expect(heads).toHaveCount(2);                                    // no layers pasted
  await expect(page.locator('.v1-tl-layer-row-track').nth(0).locator('.v1-tl-kf')).toHaveCount(1);
});

test('Studio: ? opens the shortcuts sheet (not while typing); Esc closes it', async ({ page }) => {
  await page.goto('/#/studio');
  await page.locator('.v1-canvas-wrap').hover();
  await page.keyboard.press('?');
  const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('Alt + drag');
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await page.locator('.v1-ai-input').fill('what is this?');               // typing ? in a field
  await expect(sheet).toHaveCount(0);
  await page.getByRole('button', { name: 'Shortcuts and gestures' }).click();
  await expect(sheet).toBeVisible();
});

test('Studio: gradient fill runs along its angle', async ({ page }) => {
  await page.goto('/#/studio');
  await page.locator('.v1-tool', { hasText: 'Rect' }).click();          // 576×324 at the centre: x 672–1248, y 378–702
  await page.getByRole('button', { name: 'Gradient' }).click();
  const setColor = (label: string, v: string) => page.getByLabel(label).evaluate((el, val) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, v);
  await setColor('Gradient start', '#000000');
  await setColor('Gradient end', '#ffffff');
  await setValue(page.getByLabel('Gradient angle'), 0);                 // left → right
  const lum = (x: number, y: number) => page.evaluate(([cx, cy]) => {
    const c = document.querySelector('.v1-canvas') as HTMLCanvasElement;
    const k = c.width / 1920;
    return c.getContext('2d')!.getImageData(Math.round(cx * k), Math.round(cy * k), 1, 1).data[0];
  }, [x, y]);
  await expect.poll(() => lum(1230, 540)).toBeGreaterThan(200);
  expect(await lum(690, 540)).toBeLessThan(40);
  expect(Math.abs((await lum(960, 540)) - 128)).toBeLessThan(40);       // mid-grey in the middle
  await setValue(page.getByLabel('Gradient angle'), 90);                // top → bottom
  await expect.poll(() => lum(960, 690)).toBeGreaterThan(200);
  expect(await lum(960, 390)).toBeLessThan(40);
  await page.getByRole('button', { name: 'Solid' }).click();             // back to the solid colour
  await expect.poll(() => lum(960, 390)).toBeGreaterThan(200);
});

test('Studio: motion blur streaks fast motion — paused canvas and export', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/#/studio');
  await setValue(page.locator('.duration-field input'), 1);
  await page.locator('.v1-tool', { hasText: 'Rect' }).click();          // white 576 px wide
  const pos = transform(page).locator('.v1-field input');
  await seek(page, 0);
  await setValue(pos.nth(0), 200);
  await transform(page).locator('.v1-diamond').nth(0).click();
  await seek(page, 0.999);
  await setValue(pos.nth(0), 1700);                                      // 1,500 px/s
  await page.locator('.v1-easing').first().selectOption('linear');
  await seek(page, 0.5);                                                 // right edge ≈ 1238

  // Grey (in-between) pixels along y = 540 around the moving right edge.
  const greyOnCanvas = () => page.evaluate(() => {
    const c = document.querySelector('.v1-canvas') as HTMLCanvasElement;
    const k = c.width / 1920;
    const d = c.getContext('2d')!.getImageData(Math.round(1150 * k), Math.round(540 * k), Math.round(180 * k), 1).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 30 && d[i] < 225) n++;
    return n / k;                                                        // in comp pixels
  });
  expect(await greyOnCanvas()).toBeLessThan(4);                          // sharp edge
  await page.getByRole('button', { name: 'Motion blur' }).click();
  await expect.poll(greyOnCanvas).toBeGreaterThan(12);                   // streaked edge (paused preview)

  const exportGrey = async (name: string) => {
    await page.locator('.btn-export').click();
    const render = page.locator('.modal .btn-primary');
    await expect(render).toHaveText('Render', { timeout: 30_000 });
    const dl = page.waitForEvent('download', { timeout: 120_000 });
    await render.click();
    const path = test.info().outputPath(name);
    await (await dl).saveAs(path);
    await expect(page.locator('.modal')).toHaveCount(0, { timeout: 5_000 });
    // yuv420 can't crop a 1-px strip (chroma rounds to 0): take 2 rows, use one.
    const r = spawnSync(ffmpeg, ['-v', 'error', '-i', path, '-vf', `select='eq(n\\,15)',crop=180:2:1150:540`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-']);
    expect(r.stdout.length).toBe(360);
    return [...r.stdout.subarray(0, 180)].filter((v) => v > 30 && v < 225).length;
  };
  const blurred = await exportGrey('blur.mp4');
  await page.getByRole('button', { name: 'Motion blur' }).click();       // off
  const sharp = await exportGrey('sharp.mp4');
  expect(blurred).toBeGreaterThan(sharp + 8);
});

test('Studio: music / audio files import as sound-only layers and are mixed into the export', async ({ page }) => {
  await page.goto('/#/studio');
  await setValue(page.locator('.duration-field input'), 3);
  await page.locator('.v1-tool', { hasText: 'Rect' }).click();
  await page.locator('.v1-toolbar input[type=file]').setInputFiles(fx.music);
  const heads = page.locator('.v1-tl-layer-row-head');
  await expect(heads).toHaveCount(2);
  await expect(heads.nth(1)).toContainText('♪ audio');
  await expect(page.locator('.v1-audio-note')).toBeVisible();            // no transform for sound
  await expect(page.locator('.v1-section', { hasText: 'Fade out' })).toBeVisible();
  await expect(page.locator('.v1-sel-outline')).toHaveCount(0);          // nothing on the canvas
  await expect(page.locator('.v1-notice.err')).toHaveCount(0);

  await page.locator('.btn-export').click();
  const render = page.locator('.modal .btn-primary');
  await expect(render).toHaveText('Render', { timeout: 30_000 });
  const dl = page.waitForEvent('download', { timeout: 120_000 });
  await render.click();
  const path = test.info().outputPath('music.mp4');
  await (await dl).saveAs(path);
  expect(probe(path).audio).toMatch(/^(aac|opus)/);
  expect(meanVolume(path, 0.2, 2.5)).toBeGreaterThan(-40);               // the music is there

  // Survives save → reload → reopen (bytes come back from the media store).
  await page.locator('.v1-menu-trigger').click();
  await page.locator('.v1-menu-item', { hasText: 'Save' }).first().click();
  await expect(page.locator('.v1-save-badge')).toContainText('Saved');
  await page.reload();
  await page.locator('.v1-menu-trigger').click();
  await page.locator('.v1-menu-recent-main').first().click();
  await expect(heads.nth(1)).toContainText('♪ audio');
  await page.locator('.btn-export').click();
  await expect(page.locator('.modal .btn-primary')).toHaveText('Render', { timeout: 30_000 });
  const dl2 = page.waitForEvent('download', { timeout: 120_000 });
  await page.locator('.modal .btn-primary').click();
  const path2 = test.info().outputPath('music-reopened.mp4');
  await (await dl2).saveAs(path2);
  expect(meanVolume(path2, 0.2, 2.5)).toBeGreaterThan(-40);
});

test('Studio: M adds a marker; click jumps, double-click renames, trims snap to it, right-click deletes', async ({ page }) => {
  await page.goto('/#/studio');
  await page.locator('.v1-tool', { hasText: 'Rect' }).click();
  await seek(page, 0.4);                                                 // 4 s
  await page.locator('.v1-canvas-wrap').hover();
  await page.keyboard.press('m');
  const marker = page.locator('.v1-tl-marker');
  await expect(marker).toHaveCount(1);
  await seek(page, 0.05);
  await marker.click();
  await expect(page.locator('.v1-tl-time')).toHaveText(/^0:04\.00 \//);
  await marker.dblclick();
  await page.getByLabel('Marker name').fill('Beat drop');
  await page.keyboard.press('Enter');
  await expect(marker).toContainText('Beat drop');

  // Trim the clip's end near the marker (playhead moved away): it snaps onto it.
  await seek(page, 0.9);
  const mx = await marker.evaluate((el) => { const b = el.getBoundingClientRect(); return b.left + 1; });
  const h = (await page.locator('.v1-tl-clip-trim-out').first().boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(mx + 2, h.y + h.height / 2, { steps: 6 });
  await page.mouse.up();
  const clipEnd = await page.locator('.v1-tl-clip').first().evaluate((el) => parseFloat((el as HTMLElement).style.left) + parseFloat((el as HTMLElement).style.width));
  expect(clipEnd).toBeCloseTo(40, 3);

  await marker.click({ button: 'right' });
  await page.locator('.v1-ctx-item', { hasText: 'Delete marker' }).click();
  await expect(marker).toHaveCount(0);
});

test('Studio: stroke, font family and letter spacing', async ({ page }) => {
  await page.goto('/#/studio');
  await page.locator('.v1-tool', { hasText: 'Rect' }).click();          // white, x 672–1248
  const px = (x: number, y: number) => page.evaluate(([cx, cy]) => {
    const c = document.querySelector('.v1-canvas') as HTMLCanvasElement;
    const k = c.width / 1920;
    return [...c.getContext('2d')!.getImageData(Math.round(cx * k), Math.round(cy * k), 1, 1).data].slice(0, 3);
  }, [x, y]);
  expect((await px(1256, 540))[0]).toBeLessThan(20);                     // just outside: background
  await page.locator('.v1-seg[aria-label="Stroke"]').getByRole('button', { name: 'On' }).click();
  await page.getByLabel('Stroke colour').evaluate((el) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, '#ff0000');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const width = page.locator('.v1-prop', { hasText: 'Stroke' }).locator('.v1-field input');
  await setValue(width, 24);                                             // 12 px lands outside the edge
  await expect.poll(() => px(1256, 540)).toEqual([255, 0, 0]);

  // Text: letter spacing widens the measured box; the font menu changes the rendering.
  await page.locator('.v1-ai-input').fill('add a title "SPACING"');
  await page.locator('.v1-ai-input').press('Enter');
  const boxW = () => page.locator('.v1-sel-outline').first().evaluate((el) => (el as SVGGraphicsElement).getBBox().width);
  const w0 = await boxW();
  await setValue(page.locator('.v1-prop-pair label', { hasText: 'Letter spacing' }).locator('input'), 40);
  await expect.poll(boxW).toBeGreaterThan(w0 + 200);                     // 7 letters × 40 px
  const shot = () => page.locator('.v1-canvas').screenshot();
  const before = await shot();
  await page.getByLabel('Font family').selectOption({ label: 'Serif' });
  await expect.poll(async () => Buffer.compare(await shot(), before)).not.toBe(0);
});

test('Studio: the preview keeps the composition aspect ratio (no stretching)', async ({ page }) => {
  const ratio = async () => { const b = (await page.locator('.v1-canvas').boundingBox())!; return b.width / b.height; };
  for (const vp of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }]) {
    await page.setViewportSize(vp);
    await page.goto('/#/studio');
    await page.locator('.v1-topbar select').first().selectOption({ label: 'HD 1920×1080' }); // same-URL goto keeps the project
    await expect.poll(ratio).toBeCloseTo(1920 / 1080, 2);
    await page.locator('.v1-topbar select').first().selectOption({ label: 'Vertical 1080×1920' });
    await expect.poll(ratio).toBeCloseTo(1080 / 1920, 2);
    await page.locator('.v1-topbar select').first().selectOption({ label: 'Square 1080×1080' });
    await expect.poll(ratio).toBeCloseTo(1, 2);
  }
});

test('Studio: Generate offline templates from the chips', async ({ page }) => {
  await page.goto('/#/studio');
  const heads = page.locator('.v1-tl-layer-row-head');
  for (const [chip, layers] of [['Lower third', 4], ['Quote', 3], ['Countdown', 5], ['Call to action', 3]] as const) {
    await page.getByRole('button', { name: 'Generate ▸' }).click();
    await page.locator('.v1-gen-chip', { hasText: chip }).click();
    await page.locator('.v1-gen-go').click();
    await expect(heads).toHaveCount(layers);
    await page.keyboard.press('ControlOrMeta+z');                         // one undo removes it
    await expect(heads).toHaveCount(0);
  }
});

test('Studio: a group drag is one undo step; quick ✦ Ask commands are one step each', async ({ page }) => {
  await page.goto('/#/studio');
  const pos = transform(page).locator('.v1-field input');
  const heads = page.locator('.v1-tl-layer-row-head');
  for (const x of [600, 1300]) {
    await page.locator('.v1-tool', { hasText: 'Ellipse' }).click();
    await setValue(pos.nth(0), x);
  }
  await heads.nth(0).click();
  await heads.nth(1).click({ modifiers: ['Shift'] });
  const stage = (await page.locator('.v1-canvas').boundingBox())!;
  const k = stage.width / 1920;
  const [sx, sy] = [stage.x + 600 * k, stage.y + 540 * k];
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(sx + i * 8, sy + 30 + i, { steps: 1 });
  await page.mouse.up();
  await page.keyboard.press('ControlOrMeta+z');                          // undoes the whole drag
  await heads.nth(0).click();
  await expect(pos.nth(0)).toHaveValue('600');
  await heads.nth(1).click();
  await expect(pos.nth(0)).toHaveValue('1300');

  // Two commands sent back-to-back → two undo steps.
  const ask = page.locator('.v1-ai-input');
  await ask.fill('make it red'); await ask.press('Enter');
  await ask.fill('outline it white 6px'); await ask.press('Enter');
  await page.locator('.v1-canvas-wrap').hover();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('.v1-seg[aria-label="Stroke"] button.on')).toHaveText('Off');
  await expect(page.getByLabel('Fill colour')).toHaveValue('#ff3b30');  // the colour command is still applied
});

test('Studio: work area — B / N, looped playback, and a range export with correctly offset audio', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/#/studio');
  await setValue(page.locator('.duration-field input'), 4);
  await page.locator('.v1-toolbar input[type=file]').setInputFiles(fx.talk); // tone 1–4 s
  await expect(page.locator('.v1-tl-layer-row-head')).toHaveCount(1);
  await page.locator('.v1-canvas-wrap').hover();
  await seek(page, 0.25);                                                // 1 s
  await page.keyboard.press('b');
  await seek(page, 0.75);                                                // 3 s
  await page.keyboard.press('n');
  await expect(page.locator('.v1-tl-workarea')).toHaveCount(1);

  // Playback loops inside 1–3 s.
  await page.keyboard.press('Space');
  const seen: number[] = [];
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(250);
    const [m, s] = (await page.locator('.v1-tl-time').innerText()).split(' / ')[0].split(':');
    seen.push(Number(m) * 60 + Number(s));
  }
  await page.keyboard.press('Space');
  expect(Math.min(...seen)).toBeGreaterThanOrEqual(0.99);
  expect(Math.max(...seen)).toBeLessThanOrEqual(3.01);

  // Export defaults to the work area: a 2 s file whose audio starts on the tone.
  await page.locator('.btn-export').click();
  await expect(page.locator('.v1-export-range input')).toBeChecked();
  const render = page.locator('.modal .btn-primary');
  await expect(render).toHaveText('Render', { timeout: 30_000 });
  const dl = page.waitForEvent('download', { timeout: 120_000 });
  await render.click();
  const path = test.info().outputPath('range.mp4');
  await (await dl).saveAs(path);
  const info = probe(path);
  expect(info.duration).toBeGreaterThan(1.9);
  expect(info.duration).toBeLessThan(2.2);
  expect(meanVolume(path, 0.05, 0.5)).toBeGreaterThan(-30);              // tone from the first moment

  // Double-click clears it.
  await page.locator('.v1-tl-workarea').dblclick();
  await expect(page.locator('.v1-tl-workarea')).toHaveCount(0);
});

test('Studio: background colour, and Save frame as PNG at full resolution', async ({ page }) => {
  await page.goto('/#/studio');
  await page.getByLabel('Background colour').evaluate((el) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, '#204080');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const corner = () => page.evaluate(() => {
    const c = document.querySelector('.v1-canvas') as HTMLCanvasElement;
    return [...c.getContext('2d')!.getImageData(3, 3, 1, 1).data].slice(0, 3);
  });
  await expect.poll(corner).toEqual([32, 64, 128]);
  await page.locator('.v1-tool', { hasText: 'Ellipse' }).click();
  await page.locator('.btn-export').click();
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save frame as PNG' }).click();
  const d = await dl;
  expect(d.suggestedFilename()).toMatch(/\.png$/);
  const path = test.info().outputPath('frame.png');
  await d.saveAs(path);
  const px = (x: number, y: number) => {
    const r = spawnSync(ffmpeg, ['-v', 'error', '-i', path, '-vf', `crop=2:2:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    return [...r.stdout.subarray(0, 3)];
  };
  const size = spawnSync(ffmpeg, ['-v', 'error', '-i', path, '-f', 'null', '-'], { encoding: 'utf8' });
  expect(size.status).toBe(0);
  expect(px(10, 10)).toEqual([32, 64, 128]);                             // background
  expect(px(960, 540)).toEqual([255, 255, 255]);                         // the white circle at the centre
  expect(px(1910, 1070)).toEqual([32, 64, 128]);                         // full 1920×1080 frame
});

test('Studio: Alt + arrows nudge the selection; Shift + arrows step 10 frames', async ({ page }) => {
  await page.goto('/#/studio');
  await page.locator('.v1-tool', { hasText: 'Rect' }).click();
  const x = page.locator('.v1-prop', { hasText: 'Position' }).locator('input').first();
  const x0 = Number(await x.inputValue());
  await page.keyboard.press('Alt+ArrowRight');
  await page.keyboard.press('Alt+Shift+ArrowRight');
  await expect(x).toHaveValue(String(x0 + 11));
  await page.keyboard.press('Shift+ArrowRight');
  await expect(page.locator('.v1-tl-time')).toContainText('0:00.33');
});

test('Studio: wiggle — ∿ toggles it per property, amount and speed are editable, the canvas moves', async ({ page }) => {
  await page.goto('/#/studio');
  await page.locator('.v1-tool', { hasText: 'Rect' }).click();
  const row = page.locator('.v1-prop', { hasText: 'Position' });
  await row.locator('.v1-wiggle-btn').click();
  const amount = page.getByLabel('Position wiggle amount');
  await expect(amount).toHaveValue('20');
  await amount.fill('200');
  await expect(page.getByLabel('Position wiggle speed')).toHaveValue('2');
  const x = row.locator('.v1-prop-body input').first();
  const x0 = await x.inputValue();
  const shot = async () => (await page.locator('.v1-canvas-wrap canvas').first().screenshot()).toString('base64');
  const a = await shot();
  await amount.blur();
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight');   // 1 s later
  await expect(page.locator('.v1-tl-time')).toContainText('0:01.00');
  await expect.poll(shot).not.toBe(a);                                    // the wiggle moved it
  await expect(x).toHaveValue(x0);                                        // the edited value is untouched
  await row.locator('.v1-wiggle-btn').click();
  await expect(amount).toHaveCount(0);
});

test('Studio: time remapping — 2× speed plays the footage twice as fast; freeze frame holds it, silently', async ({ page }) => {
  await page.goto('/#/studio');
  await setValue(page.locator('.duration-field input'), 4);
  await page.locator('.v1-toolbar input[type=file]').setInputFiles(fx.talk);   // 10 s, tone at 1–4 s
  await expect(page.locator('.v1-tl-layer-row-head').first()).toContainText('talk.webm');
  const time = page.locator('.v1-section', { hasText: 'Speed' });
  await time.getByRole('button', { name: '2×' }).click();
  await expect(time.getByRole('button', { name: '2×' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.v1-tl-clip-badge')).toHaveText('2×');

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
  const fast = await exportOnce('fast.mp4');
  // Source tones at 1–4 s and 6–9 s now sit at 0.5–2 s and 3–4.5 s; source 4.2–5.8 s (silent) at 2.1–2.9 s.
  expect(meanVolume(fast, 2.1, 0.8)).toBeLessThan(meanVolume(fast, 0.8, 1) - 10);
  expect(meanVolume(fast, 3.1, 0.8)).toBeGreaterThan(meanVolume(fast, 2.1, 0.8) + 10);

  await time.getByRole('button', { name: '1×' }).click();
  await seek(page, 0.375);                                                     // 1.5 s
  await time.getByRole('button', { name: 'Freeze frame at playhead' }).click();
  await expect(page.locator('.v1-tl-clip-badge')).toHaveText('frozen');
  await expect(time.getByRole('button', { name: 'Frozen' })).toHaveAttribute('aria-pressed', 'true');
  const held = await exportOnce('held.mp4');
  expect(frameHash(held, 6)).not.toBe(frameHash(held, 18));                     // moving before the freeze
  expect(frameDiff(held, 60, 100)).toBeLessThan(1);                              // held after it (encoder noise only)
  expect(frameDiff(held, 6, 18)).toBeGreaterThan(3);
  expect(meanVolume(held, 2.2, 1.5)).toBeLessThan(meanVolume(held, 1.1, 0.35) - 10);   // and silent
});

test('Studio: blend modes mix a layer with what is under it (multiply, screen, add)', async ({ page }) => {
  await page.goto('/#/studio');
  const setColor = (label: string, v: string) => page.getByLabel(label).evaluate((el, val) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, v);
  await setColor('Background colour', '#204080');                        // 32, 64, 128
  await page.locator('.v1-tool', { hasText: 'Rect' }).click();
  await setColor('Fill colour', '#808080');                              // 128 grey
  const centre = () => page.evaluate(() => {
    const c = document.querySelector('.v1-canvas') as HTMLCanvasElement;
    return [...c.getContext('2d')!.getImageData(Math.round(c.width / 2), Math.round(c.height / 2), 1, 1).data].slice(0, 3);
  });
  const near = (want: number[]) => async () => (await centre()).every((v, i) => Math.abs(v - want[i]) <= 3);
  await expect.poll(near([128, 128, 128])).toBe(true);
  const blend = page.getByLabel('Blend mode');
  await blend.selectOption('multiply');
  await expect.poll(near([16, 32, 64])).toBe(true);
  await blend.selectOption('screen');
  await expect.poll(near([144, 160, 192])).toBe(true);
  await blend.selectOption('add');
  await expect.poll(near([160, 192, 255])).toBe(true);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  await expect(blend).not.toHaveValue('add');                             // undone (quick edits merge into one step)
  await blend.selectOption('normal');
  await expect.poll(near([128, 128, 128])).toBe(true);
});

test('Studio: polygon and star shapes — toolbar, shape kind, points', async ({ page }) => {
  await page.goto('/#/studio');
  await page.getByLabel('Background colour').evaluate((el) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, '#000000');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('.v1-tool', { hasText: 'Star' }).click();             // white, 324 × 324 at the centre
  await expect(page.locator('.v1-layer-type')).toHaveText('star');
  const lum = (x: number, y: number) => page.evaluate(([cx, cy]) => {
    const c = document.querySelector('.v1-canvas') as HTMLCanvasElement;
    const k = c.width / 1920;
    return c.getContext('2d')!.getImageData(Math.round(cx * k), Math.round(cy * k), 1, 1).data[0];
  }, [x, y]);
  await expect.poll(() => lum(960, 400)).toBeGreaterThan(200);             // inside the top point
  expect(await lum(960, 670)).toBeLessThan(40);                            // between the two lower points
  const kind = page.getByRole('group', { name: 'Shape kind' });
  await kind.getByRole('button', { name: 'Ellipse' }).click();
  await expect.poll(() => lum(960, 670)).toBeGreaterThan(200);             // a circle covers it
  await kind.getByRole('button', { name: 'Polygon' }).click();
  await expect(page.locator('.v1-layer-type')).toHaveText('polygon');
  await setValue(page.locator('.v1-prop', { hasText: 'Sides' }).locator('input'), 3);   // triangle, point up
  await expect.poll(() => lum(960, 670)).toBeLessThan(40);                // below the base (at 0.5 r)
  expect(await lum(960, 560)).toBeGreaterThan(200);
  await page.locator('.v1-tool', { hasText: 'Polygon' }).click();
  await expect(page.locator('.v1-tl-layer-row-head')).toHaveCount(2);
});

test('Studio: export an animated, looping GIF at the chosen size and frame rate', async ({ page }) => {
  await page.goto('/#/studio');
  await setValue(page.locator('.duration-field input'), 2);
  await page.locator('.v1-tool', { hasText: 'Rect' }).click();
  const pos = transform(page).locator('.v1-field input');
  await seek(page, 0);
  await setValue(pos.nth(0), 400);
  await transform(page).locator('.v1-diamond').first().click();
  await seek(page, 0.5);                                                   // 1 s
  await setValue(pos.nth(0), 1500);
  await page.locator('.btn-export').click();
  await page.getByLabel('Format').selectOption('gif');
  await expect(page.getByLabel('GIF width')).toHaveValue('480');
  await page.getByLabel('GIF frame rate').selectOption('10');
  const dl = page.waitForEvent('download', { timeout: 120_000 });
  await page.locator('.modal .btn-primary').click();
  const d = await dl;
  expect(d.suggestedFilename()).toMatch(/480x270\.gif$/);
  const path = test.info().outputPath('anim.gif');
  await d.saveAs(path);
  const info = probe(path);
  expect(info.video).toMatch(/^gif\b.*\b480x270\b/);
  expect(info.duration).toBeCloseTo(2, 1);
  const decoded = spawnSync(ffmpeg, ['-hide_banner', '-i', path, '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  expect(Number(/frame=\s*(\d+)/.exec(decoded)?.[1])).toBe(20);                          // 2 s × 10 fps
  const frame = (n: number) => spawnSync(ffmpeg, ['-v', 'error', '-i', path, '-vf', `select='eq(n\\,${n})'`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-']).stdout.toString('base64');
  expect(frame(0)).not.toBe(frame(9));                                  // it moves
  expect(frame(12)).toBe(frame(19));                                    // held after the last key
  const bytes = readFileSync(path);
  expect(bytes.includes(Buffer.from('NETSCAPE2.0'))).toBe(true);        // loops
});
