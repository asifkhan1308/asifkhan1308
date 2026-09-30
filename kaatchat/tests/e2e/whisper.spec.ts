import { test, expect } from '@playwright/test';
import { ensureFixtures, ensureSpeechFixture } from './fixtures';

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

  await page.goto('/#/settings');
  await page.getByRole('region', { name: 'Transcription' }).getByLabel('Model').selectOption('onnx-community/whisper-base.en');
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
  expect(text).toMatch(/hello/);
  expect(text).toMatch(/test/);
  expect(text).toMatch(/money/);

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
