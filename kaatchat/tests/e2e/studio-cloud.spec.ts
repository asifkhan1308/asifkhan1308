import { test, expect, type Page } from '@playwright/test';

/* V2 cloud, end to end, on the in-browser demo backend: two tabs share the
 * same "cloud" (localStorage) but are signed in as different people. */

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const rows = (p: Page) => p.locator('.v1-tl-layer-row-head');

async function signIn(p: Page, email: string) {
  await p.getByRole('button', { name: /^Cloud/ }).click();
  const dlg = p.getByRole('dialog', { name: 'Cloud' });
  if (await dlg.getByRole('button', { name: 'Try the demo (this browser only)' }).isVisible().catch(() => false)) {
    await dlg.getByRole('button', { name: 'Try the demo (this browser only)' }).click();
  }
  await dlg.getByLabel('Email').fill(email);
  await dlg.getByRole('button', { name: 'Sign in' }).click();
  await expect(dlg).toContainText(`Signed in as ${email}`);
  return dlg;
}

test('Studio cloud: save, share, open as a collaborator, live updates and conflicts', async ({ context }) => {
  const errors: string[] = [];
  const ann = await context.newPage();
  ann.on('pageerror', (e) => errors.push('ann: ' + e.message));
  await ann.goto('/#/studio');
  await ann.locator('.v1-tool', { hasText: 'Rect' }).click();
  let dlg = await signIn(ann, 'ann@example.com');
  await expect(dlg).toContainText('Only on this device.');
  await dlg.getByRole('button', { name: 'Save to cloud' }).click();
  await expect(dlg).toContainText('In the cloud');
  await dlg.getByLabel('Share with email').fill('bob@example.com');
  await dlg.getByRole('button', { name: 'Share' }).click();
  await expect(dlg.getByRole('list', { name: 'People with access' })).toContainText('bob@example.com · can edit');
  await dlg.getByRole('button', { name: 'Close' }).click();
  await expect(ann.locator('.btn-cloud')).toContainText('●');

  const bob = await context.newPage();
  bob.on('pageerror', (e) => errors.push('bob: ' + e.message));
  await bob.goto('/#/studio');
  dlg = await signIn(bob, 'bob@example.com');
  const shared = dlg.getByRole('region', { name: 'Cloud projects' }).locator('li');
  await expect(shared).toHaveCount(1);
  await expect(shared).toContainText('Shared by ann@example.com · editor');
  await shared.getByRole('button', { name: 'Open' }).click();
  await expect(dlg).toHaveCount(0);
  await expect(rows(bob)).toHaveCount(1);

  // Live: Ann adds a layer and saves (⌘S saves to the cloud) → Bob, with no edits, updates by itself.
  await ann.locator('.v1-tool', { hasText: 'Ellipse' }).click();
  await ann.locator('.v1-canvas-wrap').click({ position: { x: 3, y: 3 } });
  await ann.keyboard.press(`${mod}+s`);
  await expect(rows(bob)).toHaveCount(2);
  await expect(bob.locator('.v1-banner', { hasText: 'Updated by ann@example.com' })).toBeVisible();

  // Conflict: both edit; Ann saves first; Bob is told, his save is refused until he chooses.
  await bob.locator('.v1-tool', { hasText: 'Star' }).click();
  await ann.locator('.v1-tool', { hasText: 'Text' }).click();
  await ann.keyboard.press('Escape');
  await ann.locator('.v1-canvas-wrap').click({ position: { x: 3, y: 3 } });
  await ann.keyboard.press(`${mod}+s`);
  await expect(bob.locator('.v1-banner', { hasText: 'ann@example.com saved a newer version' })).toBeVisible();
  await bob.locator('.v1-canvas-wrap').click({ position: { x: 3, y: 3 } });
  await bob.keyboard.press(`${mod}+s`);
  await expect(bob.locator('.v1-banner.err')).toContainText('Not saved: ann@example.com saved this project after you opened it');
  await bob.getByRole('button', { name: 'Overwrite with mine' }).click();
  await expect(bob.locator('.v1-banner.err')).toHaveCount(0);
  // Ann had no unsaved edits, so Bob's version (rect, ellipse, star) replaces hers live.
  await expect(rows(ann)).toHaveCount(3);
  await expect(rows(ann).filter({ hasText: 'Star' })).toHaveCount(1);

  // Viewers can open but not save.
  await ann.getByRole('button', { name: /^Cloud/ }).click();
  dlg = ann.getByRole('dialog', { name: 'Cloud' });
  await dlg.getByLabel('Access', { exact: true }).selectOption('viewer');
  await dlg.getByLabel('Share with email').fill('bob@example.com');
  await dlg.getByRole('button', { name: 'Share' }).click();
  await expect(dlg.getByRole('list', { name: 'People with access' })).toContainText('bob@example.com · can view');
  await bob.reload();
  await bob.getByRole('button', { name: /^Cloud/ }).click();
  const bdlg = bob.getByRole('dialog', { name: 'Cloud' });
  await bdlg.getByRole('region', { name: 'Cloud projects' }).getByRole('button', { name: 'Open' }).click();
  await bob.getByRole('button', { name: /^Cloud/ }).click();
  await expect(bdlg).toContainText('Shared with you to view');
  await expect(bdlg.getByRole('button', { name: /Save to cloud/ })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Studio cloud: not set up → connect form validates; secret keys refused', async ({ page }) => {
  await page.goto('/#/studio');
  await page.getByRole('button', { name: /^Cloud/ }).click();
  const dlg = page.getByRole('dialog', { name: 'Cloud' });
  await expect(dlg).toContainText('Connect Studio Cloud');
  await dlg.getByLabel('Project URL').fill('http://example.com');
  await dlg.getByLabel('Publishable key').fill('abc');
  await dlg.getByRole('button', { name: 'Connect' }).click();
  await expect(dlg.getByRole('alert')).toContainText('https://');
  await dlg.getByLabel('Project URL').fill('https://abc.supabase.co');
  await dlg.getByLabel('Publishable key').fill('sb_secret_123');
  await dlg.getByRole('button', { name: 'Connect' }).click();
  await expect(dlg.getByRole('alert')).toContainText('secret key');
});
