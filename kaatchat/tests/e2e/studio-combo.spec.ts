import { test, expect, type Page } from '@playwright/test';
import { ensureFixtures, probe, meanVolume } from './fixtures';
const fx = ensureFixtures();
async function setValue(loc: import('@playwright/test').Locator, v: string | number) {
  await loc.evaluate((el, val) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, String(val));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, v);
}
const ask = async (page: Page, cmd: string) => {
  await page.locator('.v1-ai-input').fill(cmd);
  await page.locator('.v1-ai-input').press('Enter');
  await expect(page.locator('.v1-ai-status')).not.toHaveText('Thinking…');
  return page.locator('.v1-ai-status').innerText();
};
test('Studio combo: many features together — no errors; export, save / reopen and share still work', async ({ page, context }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  // Generate probes localhost for Ollama / LM Studio; refused connections are expected.
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_CONNECTION_REFUSED/.test(m.text())) errors.push('console: ' + m.text().slice(0, 200)); });
  page.on('dialog', (d) => { errors.push('dialog: ' + d.message()); void d.dismiss(); });
  await page.goto('/#/studio');
  const heads = page.locator('.v1-tl-layer-row-head');

  // Generate a lower third, then build on it with ✦ Ask.
  await page.getByRole('button', { name: 'Generate ▸' }).click();
  await page.locator('.v1-gen-chip', { hasText: 'Quote' }).click();
  await page.locator('.v1-gen-go').click();
  for (const c of ['add a null', 'rename to Rig', 'add a circle, make it blue, parent it to Rig', 'gradient from blue to purple at 45',
                   'make it cinematic', 'outline it white 6px', 'add a title "Matte me" and use Ellipse as matte', 'add a marker called Hit at 2s',
                   'typewriter over 1s', 'center it']) {
    expect(await ask(page, c), c).not.toMatch(/skipped|Couldn’t|Offline mode/);
  }
  // Media + music
  await page.locator('.v1-toolbar input[type=file]').setInputFiles(fx.talk);
  await page.locator('.v1-toolbar input[type=file]').setInputFiles(fx.music);
  await expect(page.locator('.v1-tl-layer-row-head', { hasText: '♪ audio' })).toHaveCount(1);
  await expect(heads).toHaveCount(8);

  // Multi-select everything, align, distribute, group drag, copy/paste, undo.
  const alive = async (tag: string) => {
    const ok = await Promise.race([page.evaluate(() => 1).then(() => true), new Promise((r) => setTimeout(() => r(false), 4000))]);
    if (!ok) throw new Error('frozen after ' + tag);
  };
  await page.locator('.v1-canvas-wrap').hover();
  await alive('hover');
  await page.keyboard.press('ControlOrMeta+a');
  await alive('select all');
  // Primary is the music layer: Align must still be offered for the selection.
  await page.getByRole('button', { name: 'Align vertical centres' }).click({ timeout: 4000 }).catch((e) => errors.push('align: ' + e.message));
  await alive('align');
  await page.keyboard.press('ControlOrMeta+z');
  await alive('undo');
  await page.keyboard.press('ControlOrMeta+c');
  await alive('copy');
  await page.keyboard.press('ControlOrMeta+v');
  await alive('paste');
  await expect(heads).toHaveCount(16);                                    // all 8 copied and pasted
  await page.keyboard.press('ControlOrMeta+z');
  await expect(heads).toHaveCount(8);

  // Easing, motion blur, work area, background
  await heads.first().click();
  await page.getByRole('button', { name: 'Motion blur' }).click();
  await setValue(page.locator('.duration-field input'), 4);
  await page.keyboard.press('Escape');
  const r = (await page.locator('.v1-tl-ruler').boundingBox())!;
  await page.mouse.click(r.x + r.width * 0.25, r.y + 5); await page.keyboard.press('b');
  await page.mouse.click(r.x + r.width * 0.75, r.y + 5); await page.keyboard.press('n');
  await page.keyboard.press('Space'); await page.waitForTimeout(1500); await page.keyboard.press('Space');

  // Export (work area), save, reload, reopen, share link opens.
  await page.locator('.btn-export').click();
  await expect(page.locator('.modal .btn-primary')).toHaveText('Render', { timeout: 30_000 });
  const dl = page.waitForEvent('download', { timeout: 200_000 });
  await page.locator('.modal .btn-primary').click();
  const path = test.info().outputPath('combo.mp4');
  await (await dl).saveAs(path);
  const info = probe(path);
  expect(info.duration).toBeGreaterThan(1.9);                            // work area 1–3 s
  expect(info.duration).toBeLessThan(2.2);
  expect(info.audio).toMatch(/^(aac|opus)/);
  expect(meanVolume(path, 0.1, 1.5)).toBeGreaterThan(-40);
  await page.locator('.v1-menu-trigger').click();
  await page.locator('.v1-menu-item', { hasText: 'Save' }).first().click();
  await expect(page.locator('.v1-save-badge')).toContainText('Saved');
  const before = await heads.count();
  await page.reload();
  await page.locator('.v1-menu-trigger').click();
  await page.locator('.v1-menu-recent-main').first().click();
  await expect(heads).toHaveCount(before);
  await expect(page.locator('.v1-tl-workarea')).toHaveCount(1);
  await expect(page.locator('.v1-tl-marker')).toHaveCount(1);
  await page.locator('.btn-share').click();
  await expect(page.locator('.v1-share-link')).toHaveValue(/#\/review\/1\./);   // encoded asynchronously
  const link = await page.locator('.v1-share-link').inputValue();
  await page.keyboard.press('Escape');
  const rev = await context.newPage();
  rev.on('pageerror', (e) => errors.push('review pageerror: ' + e.message));
  await rev.goto('/' + link.slice(link.indexOf('#')));
  await expect(rev.locator('.v1-review-title')).toBeVisible();
  expect(errors).toEqual([]);
});
