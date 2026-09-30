// Performance at scale: a real one-hour recording, cut into ~1,200 clips by
// pause removal, with a 1,200-line transcript. Measures what a user feels —
// import, applying an edit, playback smoothness, scrubbing, undo — and holds
// each to a budget.

import { test, expect, type Page } from '@playwright/test';
import { ensureHourFixture } from './fixtures';

const hour = ensureHourFixture();

/** Frames drawn and the longest main-thread stall while `run` happens. */
async function smoothness(page: Page, run: () => Promise<void>) {
  await page.evaluate(() => {
    const w = window as unknown as { __perf: { frames: number; longest: number; stop: boolean } };
    w.__perf = { frames: 0, longest: 0, stop: false };
    let last = performance.now();
    const tick = (now: number) => {
      w.__perf.frames++;
      w.__perf.longest = Math.max(w.__perf.longest, now - last);
      last = now;
      if (!w.__perf.stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const t0 = Date.now();
  await run();
  const secs = (Date.now() - t0) / 1000;
  const r = await page.evaluate(() => {
    const w = window as unknown as { __perf: { frames: number; longest: number; stop: boolean } };
    w.__perf.stop = true;
    return w.__perf;
  });
  return { fps: r.frames / secs, longestFrameMs: Math.round(r.longest) };
}

/** The sequence length from the transport's timecode (h:mm:ss:ff or mm:ss:ff), in seconds. */
const total = async (page: Page) => {
  const parts = (await page.locator('.timecode').innerText()).split('/')[1].trim().split(':').map(Number);
  const [h, m, s] = parts.length === 4 ? parts : [0, ...parts];
  return h * 3600 + m * 60 + s;
};

const clipCount = (page: Page) => page.evaluate(() => document.querySelectorAll('.track:not(.music) .clip').length);

test('an hour-long recording cut into 1,200 clips stays responsive', async ({ page }) => {
  test.setTimeout(600_000);
  const report: Record<string, number | string> = {};
  const lap = (() => {
    let t = Date.now();
    return (name: string) => {
      report[name] = `${((Date.now() - t) / 1000).toFixed(2)}s`;
      console.log(`[scale] ${name}: ${report[name]}`);
      const s = (Date.now() - t) / 1000;
      t = Date.now();
      return s;
    };
  })();

  await page.goto('/');
  lap('start');
  await page.locator('input[type=file]').setInputFiles(hour.video);
  await expect(page).toHaveURL(/#\/p\//);
  const asset = page.locator('.asset').first();
  await expect(asset.getByText('Loudness')).toBeVisible({ timeout: 300_000 });
  await expect(asset.getByText('Framing')).toBeVisible({ timeout: 300_000 });
  const importS = lap('import + measure 1 h');

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '.srt / .vtt' }).click();
  await (await chooser).setFiles(hour.srt);
  await expect(page.locator('.asset').getByText('Transcript')).toBeVisible();
  lap('load 1,200-line transcript');

  const studio = page.locator('.panel.right');
  await studio.getByRole('textbox', { name: 'Request' }).fill('Remove all boring pauses');
  await studio.getByRole('button', { name: 'Plan it' }).click();
  await expect(studio.getByText('Kaatchat wants to:')).toBeVisible({ timeout: 60_000 });
  lap('plan pause removal');
  await studio.getByRole('button', { name: 'Apply' }).click();
  await expect.poll(() => total(page), { timeout: 30_000 }).toBeLessThan(3000);
  const applyS = lap('apply (1,200 cuts)');
  const clips = await page.evaluate(() => {
    const txt = document.querySelector('.timecode')!.textContent!;
    return txt;
  });
  report['timeline after'] = clips;

  // Transcript open, playing: the playhead moves, the current word is highlighted.
  await page.getByRole('tab', { name: 'Transcript' }).click();
  await expect(page.locator('.transcript .w').first()).toBeVisible();
  const cdp = process.env.KAATCHAT_PROFILE ? await page.context().newCDPSession(page) : null;
  if (cdp) {
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.start');
  }
  const play = await smoothness(page, async () => {
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.waitForTimeout(4000);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
  });
  if (cdp) {
    const { profile } = await cdp.send('Profiler.stop');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(process.env.KAATCHAT_PROFILE!, JSON.stringify(profile));
  }
  report['playback fps'] = play.fps.toFixed(1);
  console.log('[scale] playback', play);
  report['playback longest frame'] = `${play.longestFrameMs}ms`;

  // Zoomed in: only what is on screen is drawn.
  await page.getByRole('slider', { name: 'Timeline zoom' }).fill('6');
  await page.waitForTimeout(300);
  const drawn = await clipCount(page);
  report['clips drawn when zoomed in'] = drawn;
  console.log('[scale] drawn', drawn);

  // Scrubbing along the timeline.
  // Across the visible part of the ruler (zoomed in, the ruler itself is far wider than the screen).
  const view = (await page.locator('.tl-scroll').boundingBox())!;
  const y = (await page.locator('.ruler').boundingBox())!.y + 8;
  const scrub = await smoothness(page, async () => {
    await page.mouse.move(view.x + 20, y);
    await page.mouse.down();
    for (let x = 20; x < view.width - 20; x += 8) await page.mouse.move(view.x + x, y);
    await page.mouse.up();
  });
  report['scrub fps'] = scrub.fps.toFixed(1);
  console.log('[scale] scrub', scrub);
  report['scrub longest frame'] = `${scrub.longestFrameMs}ms`;

  // Undo and redo the 1,200 cuts.
  lap('-');
  await page.locator('body').press('Control+z');
  await expect.poll(() => total(page), { timeout: 30_000 }).toBeGreaterThan(3590);
  const undoS = lap('undo');
  await page.locator('body').press('Control+Shift+z');
  await expect.poll(() => total(page), { timeout: 30_000 }).toBeLessThan(3000);
  lap('redo');

  console.log('Scale report:', JSON.stringify(report, null, 2));
  expect(importS, 'import and measure an hour').toBeLessThan(240);
  expect(applyS, 'apply 1,200 cuts').toBeLessThan(5);
  expect(undoS, 'undo 1,200 cuts').toBeLessThan(3);
  expect(play.longestFrameMs, 'no long stall while playing').toBeLessThan(250);
  // CI machines draw video without a GPU; ~20 fps there is the browser's own drawing, not the app's work.
  expect(play.fps, 'smooth playback UI').toBeGreaterThan(15);
  expect(scrub.longestFrameMs, 'no long stall while scrubbing').toBeLessThan(250);
  expect(drawn, 'zoomed in, only visible clips are drawn').toBeLessThan(150);
});
