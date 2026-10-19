import { test, expect, type Page } from '@playwright/test';
import { ensureFixtures } from './fixtures';
import { writeFileSync } from 'node:fs';
const fx = ensureFixtures();

const findings: string[] = [];
const note = (s: string) => { findings.push(s); };

async function setValue(loc: import('@playwright/test').Locator, v: string | number) {
  await loc.evaluate((el, val) => {
    const proto = HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, String(val));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, v);
}
function watch(page: Page, tag: string) {
  page.on('pageerror', (e) => note(`[${tag}] pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') note(`[${tag}] console.error: ${m.text().slice(0, 200)}`); });
}
const time = (page: Page) => page.locator('.v1-tl-time').innerText();
const clips = (page: Page) => page.locator('.v1-tl-clip').evaluateAll((els) => els.map((e) => [parseFloat((e as HTMLElement).style.left), parseFloat((e as HTMLElement).style.width)]));

test('Studio smoke: edge cases across the editor raise no errors', async ({ page }) => {
  test.setTimeout(90_000);
  watch(page, 'main');
  await page.goto('/#/studio');
  await expect(page.locator('.v1-timeline')).toBeVisible();
  await page.waitForTimeout(300); // let the editor attach its keyboard shortcuts

  // 1. Empty project: play, undo/redo, export dialog, keyboard.
  await page.keyboard.press('Space'); await page.waitForTimeout(300); await page.keyboard.press('Space');
  await page.keyboard.press('ControlOrMeta+z'); await page.keyboard.press('ControlOrMeta+Shift+z');
  await page.keyboard.press('Delete'); await page.keyboard.press('k'); await page.keyboard.press('ControlOrMeta+c'); await page.keyboard.press('ControlOrMeta+v');
  await page.locator('.btn-export').click();
  await page.waitForTimeout(500);
  note(`(info) empty-export modal: ${await page.locator('.modal').innerText().catch(() => 'none')}`.slice(0, 200));
  await page.keyboard.press('Escape');
  if (await page.locator('.modal').count()) { note('Escape does not close the export dialog'); await page.locator('.modal button', { hasText: /cancel|close/i }).first().click().catch(() => {}); }

  // 2. Shrink comp duration below playhead and layer ends.
  await page.locator('.v1-tool', { hasText: 'Rect' }).click();
  await page.keyboard.press('End');
  await setValue(page.locator('.duration-field input'), 4);
  await page.waitForTimeout(200);
  note(`(info) after duration 10→4 with playhead at end: time="${await time(page)}" clips=${JSON.stringify(await clips(page))}`);
  await setValue(page.locator('.duration-field input'), 0);
  await page.waitForTimeout(200);
  note(`(info) duration set to 0 → field=${await page.locator('.duration-field input').inputValue()} time="${await time(page)}"`);
  await setValue(page.locator('.duration-field input'), -5);
  note(`(info) duration set to -5 → field=${await page.locator('.duration-field input').inputValue()}`);
  await setValue(page.locator('.duration-field input'), 10);

  // 3. Delete selected layer while inspector shows it, then use inspector-related keys.
  await page.locator('.v1-tool', { hasText: 'Text' }).click();
  await page.keyboard.press('Escape');
  await page.locator('.v1-canvas-wrap').click({ position: { x: 3, y: 3 } });
  await page.locator('.v1-tl-layer-row-head').last().click();
  await page.keyboard.press('Delete');
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowLeft');

  // 4. Typing in text fields must not trigger shortcuts.
  await page.locator('.v1-tl-layer-row-head').first().click();
  const before = await page.locator('.v1-tl-layer-row-head').count();
  // Start from a known paused state so only the keypress below can start playback.
  if ((await page.locator('.btn-play').innerText()).includes('⏸')) await page.locator('.btn-play').click();
  await page.locator('.v1-ai-input').fill('');
  await page.locator('.v1-ai-input').press('Space');
  await page.locator('.v1-ai-input').press('Backspace');
  await page.locator('.v1-ai-input').press('k');
  if ((await page.locator('.v1-tl-layer-row-head').count()) !== before) note('Typing in ✦ Ask triggered a layer shortcut');
  if ((await page.locator('.btn-play').innerText()).includes('⏸')) { note('Space in ✦ Ask started playback'); await page.locator('.btn-play').click(); }

  // 5. Split at clip boundaries, trim to minimum.
  await page.keyboard.press('Home');
  await page.locator('.v1-tl-layer-row-head').first().click();
  await page.keyboard.press('k');
  await page.keyboard.press('End');
  await page.keyboard.press('k');
  note(`(info) split at 0 and at end → layers=${await page.locator('.v1-tl-layer-row-head').count()} clips=${JSON.stringify(await clips(page))}`);

  // 6. Unsupported import file.
  const bad = test.info().outputPath('notes.txt');
  writeFileSync(bad, 'hello');
  await page.locator('.v1-toolbar input[type=file]').setInputFiles(bad);
  await page.waitForTimeout(1000);
  note(`(info) after importing .txt: layers=${await page.locator('.v1-tl-layer-row-head').count()} toast/err=${(await page.locator('.v1-toast, .v1-error, [role=alert]').allInnerTexts()).join('|')}`);

  // 7. Import image + video, then save, reload, reopen; check audio settings survive.
  await page.locator('.v1-toolbar input[type=file]').setInputFiles(fx.talk);
  await page.waitForTimeout(1500);
  const audio = page.locator('.v1-section', { hasText: 'Fade out' });
  if (await audio.count()) {
    await audio.getByRole('button', { name: 'Mute' }).click();
  } else note('Audio section not shown after importing a video');
  await page.locator('.v1-menu-trigger').click();
  await page.locator('.v1-menu-item', { hasText: 'Save' }).first().click();
  await expect(page.locator('.v1-save-badge')).toContainText('Saved');
  await page.reload();
  await page.locator('.v1-menu-trigger').click();
  await page.locator('.v1-menu-recent-main').first().click();
  await page.waitForTimeout(1500);
  const vid = page.locator('.v1-tl-layer-row-head', { hasText: 'talk.webm' });
  if (await vid.count()) {
    await vid.first().click();
    const muted = await page.locator('.v1-section', { hasText: 'Fade out' }).getByRole('button', { name: 'Muted' }).count();
    if (!muted) note('Mute state lost after save + reopen');
  } else note('Video layer missing after reopen');

  // 8. Context menu near the bottom-right edge stays on screen.
  const vp = page.viewportSize()!;
  const lastHead = page.locator('.v1-tl-layer-row-head').last();
  await lastHead.click({ button: 'right' });
  const box = await page.locator('.v1-context-menu').boundingBox();
  if (box && (box.y + box.height > vp.height + 1 || box.x + box.width > vp.width + 1)) note(`Context menu overflows viewport: ${JSON.stringify(box)} vp=${JSON.stringify(vp)}`);
  await page.keyboard.press('Escape');
  if (await page.locator('.v1-context-menu').count()) note('Escape does not close the context menu');

  // 9. Narrow window.
  await page.setViewportSize({ width: 900, height: 700 });
  await page.waitForTimeout(300);
  const overflowX = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (overflowX) note('Page scrolls horizontally at 900px wide');
  await page.screenshot({ path: test.info().outputPath('narrow.png') });

  // 10. Dark mode render
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: test.info().outputPath('dark.png') });

  // Real problems (anything not tagged "(info)") fail the test.
  expect(findings.filter((f) => !f.startsWith('(info)'))).toEqual([]);
});
