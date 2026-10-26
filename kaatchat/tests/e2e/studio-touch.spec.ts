import { test, expect, type Page } from '@playwright/test';

/* Phones / tablets: real touch input (CDP touch events, no mouse) must scrub
 * the ruler, drag a layer on the canvas and drag a clip on the timeline. */
test.use({ hasTouch: true });

async function touchDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
  for (let i = 1; i <= 8; i++) {
    const p = { x: from.x + ((to.x - from.x) * i) / 8, y: from.y + ((to.y - from.y) * i) / 8 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [p] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

test('Studio on touch: scrub the ruler, drag a layer, drag a clip', async ({ page }) => {
  await page.goto('/#/studio');
  await page.locator('.v1-tool', { hasText: 'Rect' }).click();
  const time = page.locator('.v1-tl-time');
  const before = await time.innerText();

  const ruler = (await page.locator('.v1-tl-ruler').boundingBox())!;
  await touchDrag(page, { x: ruler.x + ruler.width * 0.1, y: ruler.y + ruler.height / 2 }, { x: ruler.x + ruler.width * 0.5, y: ruler.y + ruler.height / 2 });
  await expect(time).not.toHaveText(before);

  const x = page.locator('.v1-prop', { hasText: 'Position' }).locator('input').first();
  const x0 = Number(await x.inputValue());
  const body = (await page.locator('.v1-sel-body').boundingBox())!;
  const c = { x: body.x + body.width / 2, y: body.y + body.height / 2 };
  await touchDrag(page, c, { x: c.x + 60, y: c.y });
  await expect.poll(async () => Number(await x.inputValue())).toBeGreaterThan(x0 + 40);

  // Shorten the clip first so it has room to move, then drag it along the track.
  await page.locator('.v1-ai-input').fill('trim to 2s');
  await page.locator('.v1-ai-input').press('Enter');
  const clip = page.locator('.v1-tl-clip').first();
  const left0 = (await clip.boundingBox())!.x;
  const cb = (await clip.boundingBox())!;
  await touchDrag(page, { x: cb.x + cb.width / 2, y: cb.y + cb.height / 2 }, { x: cb.x + cb.width / 2 + 120, y: cb.y + cb.height / 2 });
  await expect.poll(async () => (await clip.boundingBox())!.x).toBeGreaterThan(left0 + 60);
});
