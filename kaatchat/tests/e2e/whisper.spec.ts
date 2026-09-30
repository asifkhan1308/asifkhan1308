import { test, expect } from '@playwright/test';
import { ensureFixtures, ensureSpeechFixture, silences } from './fixtures';

const fx = ensureFixtures();

// The speech model cannot be downloaded (offline, firewall, blocked host). The
// app must say so in words the user can act on, and must not stay "processing".
test('Whisper: a model download failure is reported and nothing stays stuck', async ({ page, context }) => {
  let intercepted = 0;
  await context.route(/huggingface\.co|hf\.co/, (r) => {
    intercepted++;
    return r.abort('internetdisconnected');
  });
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles(fx.talk);
  await expect(page.locator('.asset').first().getByText('Framing')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Background tasks' })).toBeVisible();

  await page.locator('.asset').first().getByRole('button', { name: 'Transcribe' }).click();
  const err = page.locator('.toast.err').filter({ hasText: /Couldn't download the speech model/ });
  await expect(err).toBeVisible({ timeout: 60_000 });
  await expect(err).toContainText(/internet connection or firewall/);
  await expect(err).toContainText(/\.srt\/\.vtt/);
  expect(intercepted).toBeGreaterThan(0);
  // The job settled as failed; the header is idle again, and trying again is possible.
  await expect(page.getByRole('button', { name: 'Background tasks' })).toBeVisible();
  await expect(page.locator('.asset').first().getByRole('button', { name: 'Transcribe' })).toBeEnabled();
});

// The real thing: downloads the Whisper model from Hugging Face and transcribes
// real speech on this machine. Runs where the model host is reachable (CI sets
// KAATCHAT_WHISPER_E2E=1); the sandboxed development environment blocks it.
test('Whisper: transcribes real speech end to end, and the transcript drives Find and captions', async ({ page }) => {
  test.skip(process.env.KAATCHAT_WHISPER_E2E !== '1', 'Needs network access to huggingface.co (set KAATCHAT_WHISPER_E2E=1)');
  test.setTimeout(420_000);
  const speech = ensureSpeechFixture();
  expect(speech, 'espeak-ng is needed to make the speech fixture').toBeTruthy();

  // The default model: multilingual, with exact word timings.
  await page.goto('/#/settings');
  await expect(page.getByRole('region', { name: 'Transcription' }).getByLabel('Model')).toHaveValue('onnx-community/whisper-base_timestamped');
  await page.getByRole('region', { name: 'Transcription' }).getByLabel('Spoken language').selectOption({ label: 'English' });
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles(speech!);
  await expect(page.locator('.asset').first().getByText('Loudness')).toBeVisible();
  await page.locator('.asset').first().getByRole('button', { name: 'Transcribe' }).click();
  // Stop at the first outcome, success or error, and show the error's own words.
  const done = page.locator('.toast').filter({ hasText: /Transcript ready/ }).or(page.locator('.toast.err'));
  await expect(done.first()).toBeVisible({ timeout: 360_000 });
  const errors = await page.locator('.toast.err').allInnerTexts();
  expect(errors, 'transcription reported an error').toEqual([]);

  await page.getByRole('tab', { name: 'Transcript' }).click();
  const text = (await page.locator('.transcript').innerText()).toLowerCase();
  // (espeak's robotic "hello" is sometimes heard as "the low"; the rest is clear.)
  expect(text).toMatch(/world/);
  expect(text).toMatch(/test/);
  expect(text).toMatch(/money/);

  // Each word is timed by the model, and the timings match the audio: the first
  // word of each sentence starts where ffmpeg hears the pause before it end.
  await expect(page.locator('.transcript')).toContainText('exact word timings');
  const words = await page.locator('.transcript .w').evaluateAll((els) =>
    els.map((e) => ({ text: (e.textContent ?? '').trim().toLowerCase().replace(/[^a-z]/g, ''), t0: +e.getAttribute('data-t0')!, t1: +e.getAttribute('data-t1')! })),
  );
  for (let i = 1; i < words.length; i++) expect(words[i].t0).toBeGreaterThanOrEqual(words[i - 1].t0 - 0.01);
  const pauses = silences(speech!.replace(/\.webm$/, '.wav')).filter((p) => p.start > 0.2);
  expect(pauses.length, 'the speech has pauses between sentences').toBeGreaterThanOrEqual(2);
  for (const first of ['this', 'money']) {
    const w = words.find((x) => x.text === first);
    expect(w, `"${first}" is in the transcript`).toBeTruthy();
    const nearest = Math.min(...pauses.map((p) => Math.abs(p.end - w!.t0)));
    expect(nearest, `"${first}" starts at ${w!.t0}s; pauses end at ${pauses.map((p) => p.end.toFixed(2)).join(', ')}`).toBeLessThan(0.3);
  }

  // Find uses the transcript.
  const studio = page.locator('.panel.right');
  await studio.getByRole('tab', { name: 'Find' }).click();
  await studio.getByRole('textbox', { name: 'Search your footage' }).fill('where do I talk about money');
  await studio.getByRole('button', { name: 'Search' }).click();
  await expect(studio.getByText(/Found \d+ moment/)).toBeVisible();

  // Captions come from it.
  await page.getByRole('button', { name: 'Captions', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Captions', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

// Every model offered in Settings must exist with the quantized files the app
// loads, and the "exact word timings" ones must really have them.
test('Whisper: every model offered in Settings is downloadable, with the files the app loads', async ({ request }) => {
  test.skip(process.env.KAATCHAT_WHISPER_E2E !== '1', 'Needs network access to huggingface.co (set KAATCHAT_WHISPER_E2E=1)');
  const { WHISPER_MODELS } = await import('../../src/engine/whisperModels');
  for (const m of WHISPER_MODELS) {
    for (const f of ['config.json', 'onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx']) {
      const r = await request.head(`https://huggingface.co/${m.id}/resolve/main/${f}`, { maxRedirects: 0 });
      expect([200, 302, 307], `${m.id}/${f} → ${r.status()}`).toContain(r.status());
    }
    const cfg = await (await request.get(`https://huggingface.co/${m.id}/resolve/main/generation_config.json`)).json();
    // Word timings need the alignment heads; the timed exports also output cross-attentions.
    if (m.wordTimings) expect(cfg.alignment_heads, `${m.id} has alignment heads`).toBeTruthy();
  }
});
