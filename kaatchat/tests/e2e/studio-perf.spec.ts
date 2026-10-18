import { test, expect, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { defaultProject, newEllipseLayer, newRectangleLayer, newTextLayer } from '../../src/features/motionlab-v1/engine/defaults';
import type { AnimatedProperty, Layer } from '../../src/features/motionlab-v1/types';

/* Heavy-project budget: 200 animated layers in a 10-minute comp must stay
 * interactive. Numbers are printed so regressions are visible in CI logs. */

const LAYERS = 200;

function heavyProject() {
  const p = defaultProject('Heavy');
  p.composition = { ...p.composition, duration: 600 };
  const keys = <T,>(ap: AnimatedProperty<T>, vals: T[]) => {
    ap.keyframes = vals.map((v, i) => ({ time: i * 150, value: v, easing: 'ease-in-out' as const }));
  };
  for (let i = 0; i < LAYERS; i++) {
    const mk = [newTextLayer, newRectangleLayer, newEllipseLayer][i % 3];
    const l = mk(p.composition) as Layer;
    l.id = `L${i}`;
    l.name = `Layer ${i}`;
    keys(l.transform.position, [[100, 100], [1800, 900], [200, 900], [960, 540]] as [number, number][]);
    keys(l.transform.opacity, [0.2, 1, 0.5, 1]);
    keys(l.transform.rotation, [0, 90, 180, 360]);
    p.layers.push(l);
  }
  return p;
}

async function openProject(page: Page, file: string) {
  await page.goto('/#/studio');
  await page.locator('.v1-menu-trigger').click();
  await page.locator('.v1-menu input[type=file], input[accept=".kaatchat,application/json"]').setInputFiles(file);
  await expect(page.locator('.v1-tl-layer-row-head')).toHaveCount(LAYERS, { timeout: 20_000 });
}

test('Studio perf: 200 animated layers stay interactive', async ({ page }) => {
  const file = test.info().outputPath('heavy.kaatchat');
  writeFileSync(file, JSON.stringify(heavyProject()));

  const t0 = Date.now();
  await openProject(page, file);
  const openMs = Date.now() - t0;

  const cdp = process.env.PROFILE ? await page.context().newCDPSession(page) : null;
  if (cdp) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.start'); }
  // Playback: count distinct painted times over 3 s, and long main-thread tasks.
  const play = await page.evaluate(async () => {
    const longs: number[] = [];
    const po = new PerformanceObserver((l) => l.getEntries().forEach((e) => longs.push(e.duration)));
    po.observe({ type: 'longtask', buffered: false });
    (document.querySelector('.btn-play') as HTMLButtonElement).click();
    let frames = 0;
    let last = '';
    const end = performance.now() + 3000;
    await new Promise<void>((done) => {
      const tick = () => {
        const s = (document.querySelector('.v1-tl-time') as HTMLElement).textContent ?? '';
        if (s !== last) { frames++; last = s; }
        if (performance.now() < end) requestAnimationFrame(tick); else done();
      };
      requestAnimationFrame(tick);
    });
    (document.querySelector('.btn-play') as HTMLButtonElement).click();
    po.disconnect();
    return { fps: frames / 3, longTasks: longs.length, worstTask: Math.round(Math.max(0, ...longs)) };
  });

  if (cdp) {
    const { profile } = await cdp.send('Profiler.stop');
    writeFileSync(test.info().outputPath('play.cpuprofile'), JSON.stringify(profile));
  }
  // Scrub: 20 ruler clicks, time from input to the next painted frame.
  const scrub = await page.evaluate(async () => {
    const ruler = document.querySelector('.v1-tl-ruler') as HTMLElement;
    const r = ruler.getBoundingClientRect();
    const lat: number[] = [];
    for (let i = 0; i < 20; i++) {
      const x = r.left + ((i * 37) % 100) / 100 * r.width;
      const t = performance.now();
      ruler.dispatchEvent(new MouseEvent('mousedown', { clientX: x, clientY: r.top + 5, bubbles: true }));
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      await new Promise((d) => requestAnimationFrame(() => requestAnimationFrame(d)));
      lat.push(performance.now() - t);
    }
    lat.sort((a, b) => a - b);
    return { p50: Math.round(lat[10]), p95: Math.round(lat[18]) };
  });

  console.log(`PERF open=${openMs}ms play=${play.fps.toFixed(1)}fps longTasks=${play.longTasks} worst=${play.worstTask}ms scrub p50=${scrub.p50}ms p95=${scrub.p95}ms`);
  expect(play.fps).toBeGreaterThan(24);
  expect(scrub.p95).toBeLessThan(120);
});
