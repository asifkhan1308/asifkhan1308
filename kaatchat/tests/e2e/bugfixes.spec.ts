// Browser regression tests for the reported bugs: processing state, the
// "Measuring" toast, vertical footage, toast placement, export facts and AAC.
import { test, expect, type Locator, type Page } from '@playwright/test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ensureFixtures, ensureStreetFixture, meanVolume, probe } from './fixtures';

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

test('noise reduction: steady hiss is removed from the export, the voice is kept, and the preview runs it too', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles(fx.noisy);
  await expect(page).toHaveURL(/#\/p\//);
  await expect(page.locator('.asset').first().getByText('Loudness')).toBeVisible();

  await page.locator('.clip').first().click({ position: { x: 20, y: 30 } });
  const studio = page.locator('.panel.right');
  await studio.getByRole('tab', { name: 'Clip' }).click();
  const control = studio.getByRole('radiogroup', { name: 'Background noise reduction' });
  await expect(studio.getByText(/Removes steady hiss/)).toBeVisible(); // the profile was measured on import
  await control.getByRole('radio', { name: 'Strong' }).click();
  await expect(control.getByRole('radio', { name: 'Strong' })).toHaveAttribute('aria-checked', 'true');

  // Preview: playback runs through the noise-reduction worklet without errors…
  await page.getByRole('button', { name: 'Play' }).click();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Pause' }).click();
  // …and the shipped worklet really removes noise in the browser's audio engine.
  // (Worklet fetches happen off the page thread, so they are checked by running it.)
  const workletFile = readdirSync(join(process.cwd(), 'dist', 'assets')).find((f) => /^denoise\.worklet-.*\.js$/.test(f));
  expect(workletFile).toBeTruthy();
  const r = await page.evaluate(async (url) => {
    const off = new OfflineAudioContext(2, 48000, 48000);
    await off.audioWorklet.addModule(url);
    const node = new AudioWorkletNode(off, 'kaatchat-denoise', { outputChannelCount: [2] });
    const buf = off.createBuffer(2, 48000, 48000);
    let s = 1;
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < d.length; i++) {
        s = (s * 1664525 + 1013904223) >>> 0;
        d[i] = ((s / 2 ** 32) * 2 - 1) * 0.05;
      }
    }
    const power = (0.05 * 0.05) / 3; // uniform noise variance
    node.port.postMessage({ mode: 'steady', profile: { sampleRate: 48000, db: new Array(513).fill(10 * Math.log10(power * 512)) }, strength: 1 });
    const src = off.createBufferSource();
    src.buffer = buf;
    src.connect(node).connect(off.destination);
    src.start();
    const out = await off.startRendering();
    const rms = (a: Float32Array) => {
      let e = 0;
      for (let i = 24000; i < a.length; i++) e += a[i] * a[i];
      return 10 * Math.log10(e / 24000);
    };
    return { before: rms(buf.getChannelData(0)), after: rms(out.getChannelData(0)) };
  }, `./assets/${workletFile}`);
  expect(r.before - r.after).toBeGreaterThan(12);

  await page.getByRole('button', { name: 'Export' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Export' });
  await dialog.getByRole('button', { name: /^Export \d/ }).click();
  const save = dialog.getByRole('link', { name: 'Save file' });
  await expect(save).toBeVisible({ timeout: 120_000 });
  const dl = page.waitForEvent('download');
  await save.click();
  const path = test.info().outputPath('denoised.mp4');
  await (await dl).saveAs(path);

  const hissBefore = meanVolume(fx.noisy, 0.5, 1.2);
  const hissAfter = meanVolume(path, 0.5, 1.2);
  const voiceBefore = meanVolume(fx.noisy, 2.3, 1.4);
  const voiceAfter = meanVolume(path, 2.3, 1.4);
  expect(hissBefore - hissAfter).toBeGreaterThan(12);
  expect(Math.abs(voiceBefore - voiceAfter)).toBeLessThan(2);
  // Undo removes it again, as one step.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await page.locator('body').press('Control+z');
  await expect(control.getByRole('radio', { name: 'Off' })).toHaveAttribute('aria-checked', 'true');
  expect(errors).toEqual([]);
});

test('voice isolation: traffic-like noise that comes and goes is removed from the export, the speech is kept, the preview runs it', async ({ page }) => {
  const street = ensureStreetFixture();
  test.skip(!street, 'espeak-ng is needed to make the speech fixture');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles(street!.file);
  await expect(page).toHaveURL(/#\/p\//);
  await expect(page.locator('.asset').first().getByText('Loudness')).toBeVisible();

  await page.locator('.clip').first().click({ position: { x: 20, y: 30 } });
  const studio = page.locator('.panel.right');
  await studio.getByRole('tab', { name: 'Clip' }).click();
  await studio.getByRole('radiogroup', { name: 'Type of noise' }).getByRole('radio', { name: 'Changing (AI)' }).click();
  await expect(studio.getByText(/AI voice isolation: removes noise that comes and goes/)).toBeVisible();
  const level = studio.getByRole('radiogroup', { name: 'Background noise reduction' });
  await level.getByRole('radio', { name: 'Strong' }).click();
  await expect(level.getByRole('radio', { name: 'Strong' })).toHaveAttribute('aria-checked', 'true');

  // Preview: plays through the worklet (RNNoise inside) without errors…
  await page.getByRole('button', { name: 'Play' }).click();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Pause' }).click();
  // …and the shipped worklet's voice isolation removes changing noise in the browser's audio engine.
  const workletFile = readdirSync(join(process.cwd(), 'dist', 'assets')).find((f) => /^denoise\.worklet-.*\.js$/.test(f));
  const r = await page.evaluate(async (url) => {
    const off = new OfflineAudioContext(2, 96000, 48000);
    await off.audioWorklet.addModule(url);
    const node = new AudioWorkletNode(off, 'kaatchat-denoise', { outputChannelCount: [2] });
    const buf = off.createBuffer(2, 96000, 48000);
    let s = 3;
    let lp = 0;
    for (let i = 0; i < 96000; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      const w = (s / 2 ** 32) * 2 - 1;
      lp = 0.97 * lp + 0.03 * w;
      const v = (0.25 * lp + 0.02 * w) * (Math.floor(i / 16800) % 2 ? 1 : 0.15);
      buf.getChannelData(0)[i] = v;
      buf.getChannelData(1)[i] = v;
    }
    node.port.postMessage({ mode: 'voice', strength: 1 });
    const src = off.createBufferSource();
    src.buffer = buf;
    src.connect(node).connect(off.destination);
    src.start();
    const out = await off.startRendering();
    const rms = (a: Float32Array) => {
      let e = 0;
      for (let i = 24000; i < a.length; i++) e += a[i] * a[i];
      return 10 * Math.log10(e / (a.length - 24000));
    };
    return { before: rms(buf.getChannelData(0)), after: rms(out.getChannelData(0)) };
  }, `./assets/${workletFile}`);
  expect(r.before - r.after).toBeGreaterThan(20);

  await page.getByRole('button', { name: 'Export' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Export' });
  await dialog.getByRole('button', { name: /^Export \d/ }).click();
  const save = dialog.getByRole('link', { name: 'Save file' });
  await expect(save).toBeVisible({ timeout: 120_000 });
  const dl = page.waitForEvent('download');
  await save.click();
  const path = test.info().outputPath('isolated.mp4');
  await (await dl).saveAs(path);

  const { speechStart: a, speechEnd: b } = street!;
  const noiseBefore = meanVolume(street!.file, 0.2, 1.1);
  const noiseAfter = meanVolume(path, 0.2, 1.1);
  const voiceBefore = meanVolume(street!.file, a + 0.2, b - a - 0.4);
  const voiceAfter = meanVolume(path, a + 0.2, b - a - 0.4);
  expect(noiseBefore - noiseAfter, `noise ${noiseBefore} → ${noiseAfter} dB`).toBeGreaterThan(20);
  // The speech stretch loses its noise too, so allow for that, but the voice itself stays.
  expect(voiceBefore - voiceAfter, `speech ${voiceBefore} → ${voiceAfter} dB`).toBeLessThan(4);
  expect(voiceAfter - noiseAfter).toBeGreaterThan(20);
  expect(errors).toEqual([]);
});

test('Hindi: the main screens are translated and a translated suggestion still edits', async ({ page }) => {
  await page.goto('/#/settings');
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('hi');
  await expect(page.getByRole('heading', { name: 'सेटिंग्स', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'अपडेट' })).toBeVisible();
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles(fx.talk);
  await expect(page.locator('.toast').filter({ hasText: '1 फ़ाइल माप ली गईं।' })).toBeVisible();
  const studio = page.locator('.panel.right');
  await expect(studio.getByRole('button', { name: 'योजना बनाएँ' })).toBeVisible();
  await studio.getByRole('button', { name: 'इसे वर्टिकल बनाएँ' }).click();
  await expect(page.getByRole('combobox', { name: 'Aspect' })).toHaveValue('9:16');
  await page.getByRole('button', { name: 'एक्सपोर्ट' }).first().click();
  await expect(page.getByText('इसी डिवाइस पर WebCodecs से बनता है। कुछ भी अपलोड नहीं होता।')).toBeVisible();
});
