import { test, expect } from '@playwright/test';
import { ensureFixtures } from './fixtures';

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
