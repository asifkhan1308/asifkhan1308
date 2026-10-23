import { test, expect, type Page } from '@playwright/test';
import { ensureFixtures, probe } from './fixtures';

/* Bug-bash #3: the newer features together — polygons / stars, blend modes,
 * wiggle, mattes, clip speed + freeze frames, undo, save / reopen, copy /
 * paste, review links, GIF export of the work area. */
const fx = ensureFixtures();
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const ask = async (page: Page, cmd: string) => {
  await page.locator('.v1-ai-input').fill(cmd);
  await page.locator('.v1-ai-input').press('Enter');
  await expect(page.locator('.v1-ai-status')).not.toHaveText('Thinking…');
  return page.locator('.v1-ai-status').innerText();
};
const row = (page: Page, name: string) => page.locator('.v1-tl-layer-row-head').filter({ hasText: name }).first();
const pick = async (page: Page, name: string) => { await row(page, name).click(); await expect(page.locator('.v1-layer-name-input')).toHaveValue(name); };
const posRow = (page: Page) => page.locator('.v1-prop', { hasText: 'Position' }).first();
const rotRow = (page: Page) => page.locator('.v1-prop', { hasText: 'Rotation' }).first();

test('Studio combo 3: shapes, blends, wiggle, mattes, speed + freeze — through undo, reopen, paste, review and GIF', async ({ page, context }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_CONNECTION_REFUSED/.test(m.text())) errors.push('console: ' + m.text().slice(0, 200)); });
  page.on('dialog', (d) => { errors.push('dialog: ' + d.message()); void d.dismiss(); });
  await page.goto('/#/studio');
  const heads = page.locator('.v1-tl-layer-row-head');

  for (const c of ['add a star and blend screen and wiggle it', 'add a hexagon, make it red, wiggle the rotation 10 degrees',
                   'add a triangle and use Star as matte']) {
    expect(await ask(page, c), c).not.toMatch(/skipped|Couldn’t|Offline mode/);
  }
  await expect(heads).toHaveCount(3);

  // Video at 2×, then a freeze frame at 1 s.
  await page.locator('.v1-toolbar input[type=file]').setInputFiles(fx.talk);
  await expect(heads).toHaveCount(4);
  await pick(page, 'talk.webm');
  expect(await ask(page, '2x speed')).not.toMatch(/skipped/);
  await expect(page.locator('.v1-tl-clip-badge', { hasText: '2×' })).toHaveCount(1);
  expect(await ask(page, 'freeze frame at 1s')).not.toMatch(/skipped/);
  await expect(heads).toHaveCount(5);
  await expect(page.locator('.v1-tl-clip-badge', { hasText: 'frozen' })).toHaveCount(1);
  await page.locator('.v1-canvas-wrap').click({ position: { x: 3, y: 3 } });
  await page.keyboard.press(`${mod}+z`);
  await expect(heads).toHaveCount(4);                                     // freeze undone as one step
  await expect(page.locator('.v1-tl-clip-badge', { hasText: '2×' })).toHaveCount(1);
  await page.keyboard.press(`${mod}+Shift+z`);
  await expect(heads).toHaveCount(5);

  const checkStar = async (name: string) => {
    await pick(page, name);
    await expect(page.locator('.v1-layer-type')).toHaveText('star');
    await expect(page.getByLabel('Blend mode')).toHaveValue('screen');
    await expect(posRow(page).locator('.v1-wiggle-btn')).toHaveAttribute('aria-pressed', 'true');
  };
  await checkStar('Star');
  await pick(page, 'Hexagon');
  await expect(page.locator('.v1-layer-type')).toHaveText('polygon');
  await expect(rotRow(page).locator('.v1-wiggle-btn')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Rotation wiggle amount')).toHaveValue('10');
  await pick(page, 'Triangle');
  await expect(page.getByLabel('Track matte')).toHaveValue(/^alpha:/);

  // Save → reload → reopen keeps all of it.
  await page.locator('.v1-menu-trigger').click();
  await page.locator('.v1-menu-item', { hasText: 'Save' }).first().click();
  await expect(page.locator('.v1-save-badge')).toContainText('Saved');
  await page.reload();
  await page.locator('.v1-menu-trigger').click();
  await page.locator('.v1-menu-recent-main').first().click();
  await expect(heads).toHaveCount(5);
  await expect(page.locator('.v1-save-badge')).toContainText('Saved');
  await checkStar('Star');
  await expect(page.locator('.v1-tl-clip-badge', { hasText: '2×' })).toHaveCount(1);
  await expect(page.locator('.v1-tl-clip-badge', { hasText: 'frozen' })).toHaveCount(1);

  // Copy / paste the star keeps its points, blend and wiggle.
  await pick(page, 'Star');
  await page.locator('.v1-canvas-wrap').click({ position: { x: 3, y: 3 } });
  await pick(page, 'Star');
  await page.keyboard.press(`${mod}+c`);
  await page.keyboard.press(`${mod}+v`);
  await expect(heads).toHaveCount(6);
  // The copy is selected (same name, like After Effects / Figma); check it as it stands.
  await expect(page.locator('.v1-layer-type')).toHaveText('star');
  await expect(page.getByLabel('Blend mode')).toHaveValue('screen');
  await expect(posRow(page).locator('.v1-wiggle-btn')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.v1-tl-layer-row-head').filter({ hasText: 'Star' })).toHaveCount(2);

  // A review link of all this opens without errors.
  await page.locator('.btn-share').click();
  await expect(page.locator('.v1-share-link')).toHaveValue(/#\/review\/1\./);
  const link = await page.locator('.v1-share-link').inputValue();
  await page.keyboard.press('Escape');
  const rev = await context.newPage();
  rev.on('pageerror', (e) => errors.push('review pageerror: ' + e.message));
  await rev.goto('/' + link.slice(link.indexOf('#')));
  await expect(rev.locator('.v1-review-title')).toBeVisible();
  await rev.close();

  // GIF of a 1 s work area.
  await page.locator('.v1-canvas-wrap').click({ position: { x: 3, y: 3 } });
  await page.keyboard.press('Home');
  await page.keyboard.press('b');
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('n');
  await page.locator('.btn-export').click();
  await page.getByLabel('Format').selectOption('gif');
  await page.getByLabel('GIF frame rate').selectOption('10');
  const dl = page.waitForEvent('download', { timeout: 120_000 });
  await page.locator('.modal .btn-primary').click();
  const path = test.info().outputPath('combo.gif');
  await (await dl).saveAs(path);
  const info = probe(path);
  expect(info.video).toMatch(/^gif\b/);
  expect(info.duration).toBeCloseTo(1, 1);
  expect(errors).toEqual([]);
});
