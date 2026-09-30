import { test, expect, type Page } from '@playwright/test';
import { ensureFixtures, probe } from './fixtures';

const fx = ensureFixtures();

async function timelineSeconds(page: Page): Promise<number> {
  const txt = await page.locator('.timecode').innerText();
  const total = txt.split('/')[1].trim(); // mm:ss:ff
  const [m, s, f] = total.split(':').map(Number);
  return m * 60 + s + f / 30;
}

async function importFromHome(page: Page) {
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles(fx.talk);
  await expect(page).toHaveURL(/#\/p\//);
  const asset = page.locator('.asset').first();
  await expect(asset.getByText('Loudness')).toBeVisible();
  await expect(asset.getByText('Framing')).toBeVisible();
}

test('import → measure → ask → reel → captions → export', async ({ page }) => {
  await importFromHome(page);
  expect(await timelineSeconds(page)).toBeCloseTo(10, 0);

  // Transcript from an existing subtitle file.
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '.srt / .vtt' }).click();
  await (await chooser).setFiles(fx.srt);
  await expect(page.locator('.asset').getByText('Transcript')).toBeVisible();

  // Ask: remove pauses → preview → apply.
  const studio = page.locator('.panel.right');
  await studio.getByRole('textbox', { name: 'Request' }).fill('Remove all boring pauses');
  await studio.getByRole('button', { name: 'Plan it' }).click();
  await expect(studio.getByText('Kaatchat wants to:')).toBeVisible();
  await expect(studio.getByText(/Removed \d quiet stretch/)).toBeVisible();
  await studio.getByRole('button', { name: 'Apply' }).click();
  const afterSilence = await timelineSeconds(page);
  expect(afterSilence).toBeGreaterThan(5.5);
  expect(afterSilence).toBeLessThan(7);

  // One undo reverts the whole plan; redo brings it back.
  await page.locator('body').press('Control+z');
  expect(await timelineSeconds(page)).toBeCloseTo(10, 0);
  await page.locator('body').press('Control+Shift+z');
  expect(await timelineSeconds(page)).toBeCloseTo(afterSilence, 1);

  // Ask your footage (keyword search on this device).
  await studio.getByRole('tab', { name: 'Find' }).click();
  await studio.getByRole('textbox', { name: 'Search your footage' }).fill('where do I talk about money');
  await studio.getByRole('button', { name: 'Search' }).click();
  await expect(studio.getByText('Found 1 moment')).toBeVisible();
  await expect(studio.getByText('Money matters when you start a company.')).toBeVisible();

  // Found moments → a new sequence; the original edit is untouched.
  await studio.getByRole('button', { name: 'New sequence' }).click();
  const tabs = page.getByRole('tablist', { name: 'Sequences' }).getByRole('tab');
  await expect(tabs).toHaveCount(2);
  expect(await timelineSeconds(page)).toBeLessThan(4);
  await tabs.first().getByRole('button').first().click();
  expect(await timelineSeconds(page)).toBeCloseTo(afterSilence, 1);

  // Command bar → a reel plan.
  await page.getByRole('textbox', { name: 'Ask Kaatchat' }).fill('Turn this into a 4 second reel');
  await page.getByRole('textbox', { name: 'Ask Kaatchat' }).press('Enter');
  await expect(studio.getByText('Kaatchat wants to:')).toBeVisible();
  await expect(studio.getByText('Set aspect to 9:16')).toBeVisible();
  await expect(studio.getByText(/Content-aware crop/).first()).toBeVisible();
  await studio.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByRole('combobox', { name: 'Aspect' })).toHaveValue('9:16');
  expect(await timelineSeconds(page)).toBeCloseTo(4, 0);

  // Content-aware crop found the busy region on the right of the frame.
  await page.locator('.clip').first().click({ position: { x: 20, y: 30 } });
  await studio.getByRole('tab', { name: 'Clip' }).click();
  const focus = await studio.getByRole('slider', { name: 'Crop focus point' }).getAttribute('aria-valuetext');
  expect(Number(/x (\d+)%/.exec(focus!)![1])).toBeGreaterThan(70);

  // Captions are on (reel plan turns them on when a transcript exists).
  await expect(page.getByRole('button', { name: 'Captions', exact: true })).toHaveAttribute('aria-pressed', 'true');

  // Export and verify the file with ffmpeg.
  await page.getByRole('button', { name: 'Export' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Export' });
  await dialog.getByRole('button', { name: /^Export \d/ }).click();
  const save = dialog.getByRole('link', { name: 'Save file' });
  await expect(save).toBeVisible({ timeout: 120_000 });
  const dl = page.waitForEvent('download');
  await save.click();
  const path = test.info().outputPath('reel.mp4');
  await (await dl).saveAs(path);
  const info = probe(path);
  expect(info.duration).toBeGreaterThan(3.8);
  expect(info.duration).toBeLessThan(4.3);
  // MP4 audio is always AAC: native where the browser has an encoder, otherwise
  // the bundled WASM AAC encoder (open-source Chromium has none).
  expect(info.video).toMatch(/h264|vp9|av1/);
  expect(info.video).toMatch(/1080x1920/);
  expect(info.audio).toMatch(/^aac/);
});

test('transcript editing cuts the video; crash recovery restores unsaved work', async ({ page }) => {
  await importFromHome(page);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '.srt / .vtt' }).click();
  await (await chooser).setFiles(fx.srt);

  await page.getByRole('tab', { name: 'Transcript' }).click();
  const words = page.locator('.transcript .w');
  await expect(words.first()).toHaveText(/Um/);
  await page.getByRole('button', { name: 'Remove um/uh' }).click();
  await expect(words.first()).toHaveClass(/cut/);
  const d1 = await timelineSeconds(page);
  expect(d1).toBeLessThan(10);

  // Select "Money matters" and cut it.
  await page.locator('.transcript .w', { hasText: /^Money/ }).click();
  await page.locator('.transcript .w', { hasText: /^matters/ }).click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Cut selection' }).click();
  expect(await timelineSeconds(page)).toBeLessThan(d1 - 0.3);

  // Leave without saving (simulated crash: autosave exists, saved copy older).
  await page.waitForTimeout(1200); // autosave debounce
  const url = page.url();
  await page.evaluate(() => {
    window.addEventListener('pagehide', (e) => e.stopImmediatePropagation(), { capture: true });
  });
  await page.goto('about:blank');
  await page.goto(url);
  const dlg = page.getByRole('dialog', { name: 'Recovered project' });
  await expect(dlg).toBeVisible();
  await dlg.getByRole('button', { name: 'Restore' }).click();
  expect(await timelineSeconds(page)).toBeLessThan(d1 - 0.3);
});

test('built-in commands are honest about what they cannot do', async ({ page }) => {
  await importFromHome(page);
  const studio = page.locator('.panel.right');
  await studio.getByRole('textbox', { name: 'Request' }).fill('Generate B-roll of mountains');
  await studio.getByRole('button', { name: 'Plan it' }).click();
  await expect(studio.getByText(/did not understand that/)).toBeVisible();
  await expect(studio.locator('[aria-disabled=true]', { hasText: 'Generate B-roll' })).toBeVisible();
  // Nothing changed.
  expect(await timelineSeconds(page)).toBeCloseTo(10, 0);
});

test('layout has no horizontal overflow at common widths', async ({ page }) => {
  await importFromHome(page);
  for (const w of [390, 640, 820, 1024, 1440]) {
    await page.setViewportSize({ width: w, height: 800 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `overflow at ${w}px`).toBeLessThanOrEqual(0);
  }
});

test('repurpose: find clips → sequences → export all', async ({ page }) => {
  await importFromHome(page);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '.srt / .vtt' }).click();
  await (await chooser).setFiles(fx.srt);
  await expect(page.locator('.asset').getByText('Transcript')).toBeVisible();

  const studio = page.locator('.panel.right');
  await studio.getByRole('tab', { name: 'Repurpose' }).click();
  await studio.getByRole('button', { name: '3', exact: true }).click();
  await studio.getByRole('button', { name: '15s' }).click();
  await studio.getByRole('button', { name: 'Find clips' }).click();
  await expect(studio.getByText(/candidate/)).toBeVisible();
  await expect(studio.getByText(/measured loudness/)).toBeVisible();
  await studio.getByRole('button', { name: /^Create \d sequence/ }).click();

  const tabs = page.getByRole('tablist', { name: 'Sequences' }).getByRole('tab');
  const n = await tabs.count();
  expect(n).toBeGreaterThanOrEqual(2);
  await expect(page.getByRole('combobox', { name: 'Aspect' })).toHaveValue('9:16');

  // Hooks (built-in: loudest full sentences) → use as opening.
  await studio.getByRole('button', { name: 'Suggest hooks' }).click();
  await expect(studio.getByText(/Loudest complete sentences/)).toBeVisible();

  await page.getByRole('button', { name: 'Export' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Export' });
  await dialog.getByRole('button', { name: /All sequences/ }).click();
  await dialog.getByRole('button', { name: `Export ${n} sequences` }).click();
  const saves = dialog.getByRole('link', { name: 'Save file' });
  await expect(saves).toHaveCount(n, { timeout: 150_000 });
  for (let i = 0; i < n; i++) {
    const dl = page.waitForEvent('download');
    await saves.nth(i).click();
    const path = test.info().outputPath(`batch-${i}.mp4`);
    await (await dl).saveAs(path);
    const info = probe(path);
    expect(info.duration).toBeGreaterThan(1);
    expect(info.video).toMatch(/\d+x\d+/);
  }
});

test('music: beat detection, sync to beat, ducking, mixed export', async ({ page }) => {
  await importFromHome(page);
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.panel.left').getByRole('button', { name: 'Import' }).click();
  await (await chooser).setFiles(fx.music);
  const lane = page.getByLabel('Music track');
  await expect(lane.getByText(/\d+ bpm/)).toBeVisible();
  const bpm = Number(/(\d+) bpm/.exec(await lane.innerText())![1]);
  expect(bpm).toBeGreaterThanOrEqual(115);
  expect(bpm).toBeLessThanOrEqual(125);

  // Make some cuts, then snap them to the beat.
  const studio = page.locator('.panel.right');
  await studio.getByRole('textbox', { name: 'Request' }).fill('remove the pauses and sync the cuts to the beat');
  await studio.getByRole('button', { name: 'Plan it' }).click();
  await expect(studio.getByText('Nudge cuts onto the beat (±0.25s)')).toBeVisible();
  await studio.getByRole('button', { name: 'Apply' }).click();

  // Mute/solo are real mix settings.
  await page.getByRole('group', { name: 'Track mix' }).getByTitle('Solo music').click();
  await expect(page.getByRole('group', { name: 'Track mix' }).getByTitle('Solo music')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('body').press('Control+z');

  await page.getByRole('button', { name: 'Export' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Export' });
  await dialog.getByRole('button', { name: /^Export \d/ }).click();
  const save = dialog.getByRole('link', { name: 'Save file' });
  await expect(save).toBeVisible({ timeout: 120_000 });
  const dl = page.waitForEvent('download');
  await save.click();
  const path = test.info().outputPath('music.mp4');
  await (await dl).saveAs(path);
  const info = probe(path);
  expect(info.audio).toMatch(/^aac \(LC\)/); // ducked mix, still AAC
  expect(info.duration).toBeGreaterThan(4);
});

test('motion: text layer with keyframes, transitions, look, export', async ({ page }) => {
  await importFromHome(page);
  const studio = page.locator('.panel.right');
  await studio.getByRole('textbox', { name: 'Request' }).fill('Remove all boring pauses');
  await studio.getByRole('button', { name: 'Plan it' }).click();
  await studio.getByRole('button', { name: 'Apply' }).click();
  const before = await timelineSeconds(page);

  // Text layer at the playhead, edited in the inspector.
  await page.locator('body').press('Home');
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await expect(page.getByLabel('Titles and graphics track').getByRole('button')).toHaveCount(1);
  await studio.getByRole('tab', { name: 'Clip' }).click();
  const text = studio.getByRole('textbox', { name: 'Text', exact: true });
  await text.fill('Kaatchat');
  await text.blur();
  await expect(page.getByLabel('Titles and graphics track').getByText('Kaatchat')).toBeVisible();
  await studio.getByRole('button', { name: '◆ Keyframe here' }).click();
  await expect(studio.getByText('◆ 0.00s')).toBeVisible();

  // Transitions + look via the command bar (built-in rules).
  await page.getByRole('textbox', { name: 'Ask Kaatchat' }).fill('add dissolve transitions and make it cinematic');
  await page.getByRole('textbox', { name: 'Ask Kaatchat' }).press('Enter');
  await expect(studio.getByText('dissolve transitions (0.5s)')).toBeVisible();
  await expect(studio.getByRole('listitem').filter({ hasText: 'cinematic look' })).toBeVisible();
  await studio.getByRole('button', { name: 'Apply' }).click();
  // Transitions overlap the cut; they never change the length.
  expect(await timelineSeconds(page)).toBeCloseTo(before, 1);

  await page.getByRole('button', { name: 'Export' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Export' });
  await dialog.getByRole('button', { name: /^Export \d/ }).click();
  const save = dialog.getByRole('link', { name: 'Save file' });
  await expect(save).toBeVisible({ timeout: 150_000 });
  const dl = page.waitForEvent('download');
  await save.click();
  const path = test.info().outputPath('motion.mp4');
  await (await dl).saveAs(path);
  const info = probe(path);
  expect(info.duration).toBeCloseTo(before, 0);
  expect(info.video).toMatch(/1920x1080/);
});

test('brand kit and talking-head clean-up', async ({ page }) => {
  await importFromHome(page);
  const studio = page.locator('.panel.right');

  await page.getByRole('textbox', { name: 'Ask Kaatchat' }).fill('Clean up this talking head');
  await page.getByRole('textbox', { name: 'Ask Kaatchat' }).press('Enter');
  await expect(studio.getByText(/Punch in 12% \(alternate\)/)).toBeVisible();
  await studio.getByRole('button', { name: 'Apply' }).click();

  await studio.getByRole('tab', { name: 'Brand' }).click();
  const chooser = page.waitForEvent('filechooser');
  await studio.getByRole('button', { name: 'Import' }).click();
  await (await chooser).setFiles(fx.logo);
  await expect(studio.getByRole('combobox').first()).toHaveValue(/.+/);
  await studio.getByLabel('Lower third').check();
  await studio.getByRole('textbox', { name: 'Lower third name' }).fill('Asif Khan');
  await studio.getByRole('textbox', { name: 'Lower third title' }).fill('Creator');
  await studio.getByRole('textbox', { name: 'Lower third title' }).blur();
  await studio.getByLabel(/Logo watermark/).check();
  await studio.getByRole('button', { name: 'Apply brand' }).click();

  const lane = page.getByLabel('Titles and graphics track');
  await expect(lane.getByText('Watermark')).toBeVisible();
  await expect(lane.getByText(/Asif Khan/)).toBeVisible();
  // The logo stayed in the bin, not on the timeline.
  await expect(page.locator('.track:not(.music):not(.overlays) .clip')).not.toHaveCount(0);

  // Asking for the brand again replaces rather than stacks.
  await page.getByRole('textbox', { name: 'Ask Kaatchat' }).fill('use my brand');
  await page.getByRole('textbox', { name: 'Ask Kaatchat' }).press('Enter');
  await expect(studio.getByRole('listitem').filter({ hasText: 'Apply your Brand Kit' })).toBeVisible();
  await studio.getByRole('button', { name: 'Apply' }).click();
  await expect(lane.getByText('Watermark')).toHaveCount(1);

  await page.getByRole('button', { name: 'Export' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Export' });
  await dialog.getByRole('button', { name: /^Export \d/ }).click();
  const save = dialog.getByRole('link', { name: 'Save file' });
  await expect(save).toBeVisible({ timeout: 150_000 });
  const dl = page.waitForEvent('download');
  await save.click();
  const path = test.info().outputPath('brand.mp4');
  await (await dl).saveAs(path);
  expect(probe(path).video).toMatch(/1920x1080/);
});
