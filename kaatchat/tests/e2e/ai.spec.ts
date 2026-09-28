import { test, expect, type Page, type Route } from '@playwright/test';
import { ensureFixtures } from './fixtures';

const fx = ensureFixtures();
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' };

function json(route: Route, status: number, body: unknown) {
  return route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

async function setupProject(page: Page) {
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles(fx.talk);
  await expect(page.locator('.asset').first().getByText('Loudness')).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '.srt / .vtt' }).click();
  await (await chooser).setFiles(fx.srt);
  await expect(page.locator('.asset').getByText('Transcript')).toBeVisible();
  return page.url();
}

async function configure(page: Page, provider: 'OpenAI' | 'Anthropic Claude', key: string) {
  await page.goto('/#/settings');
  const card = page.locator('.provider', { has: page.getByRole('heading', { name: provider }) });
  await card.getByLabel('Enabled').check();
  await card.getByLabel(`${provider} API key`).fill(key);
  await card.getByRole('button', { name: 'Save key' }).click();
  await card.getByRole('button', { name: 'Use this' }).click();
  await expect(card.getByRole('button', { name: 'In use' })).toBeVisible();
  return card;
}

test('OpenAI: key goes only to OpenAI, plan is validated, previewed and applied', async ({ page }) => {
  const editor = await setupProject(page);
  const seen: { auth?: string; body?: string }[] = [];
  await page.route('https://api.openai.com/**', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (req.url().endsWith('/v1/models')) return json(route, 200, { data: [{ id: 'gpt-5-mini' }] });
    seen.push({ auth: req.headers()['authorization'], body: req.postData() ?? '' });
    return json(route, 200, {
      choices: [
        {
          message: {
            content: JSON.stringify({
              summary: 'Keep the part about money, vertical.',
              commands: [
                { type: 'keep_ranges', ranges: [{ start: 6, end: 9 }] },
                { type: 'set_aspect', aspect: '9:16' },
                { type: 'reframe', mode: 'content' },
              ],
            }),
          },
        },
      ],
    });
  });

  const card = await configure(page, 'OpenAI', 'sk-test-123');
  await card.getByRole('button', { name: 'Test connection' }).click();
  await expect(card.getByText('Connected. Model “gpt-5-mini” is available.')).toBeVisible();

  await page.goto(editor);
  const studio = page.locator('.panel.right');
  await expect(studio.getByText('OpenAI')).toBeVisible();
  await studio.getByRole('textbox', { name: 'Request' }).fill('Only keep the bit about money, vertical');
  await studio.getByRole('button', { name: 'Plan it' }).click();
  await expect(studio.getByText('Kaatchat wants to:')).toBeVisible();
  await expect(studio.getByText(/Planned by OpenAI · gpt-5-mini/)).toBeVisible();
  await studio.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByRole('combobox', { name: 'Aspect' })).toHaveValue('9:16');

  expect(seen).toHaveLength(1);
  expect(seen[0].auth).toBe('Bearer sk-test-123');
  // Metadata only: transcript text and timings, never media.
  expect(seen[0].body).toContain('Money matters when you start a company.');
  expect(seen[0].body).not.toMatch(/blob:|data:video|data:audio|base64/);
});

test('OpenAI: a rejected key and malformed output change nothing', async ({ page }) => {
  const editor = await setupProject(page);
  let mode: 'auth' | 'garbage' = 'auth';
  await page.route('https://api.openai.com/**', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (mode === 'auth') return json(route, 401, { error: { message: 'Incorrect API key provided' } });
    return json(route, 200, { choices: [{ message: { content: '{"summary":"x","commands":[{"type":"format_disk"}]}' } }] });
  });
  await configure(page, 'OpenAI', 'sk-wrong');
  await page.goto(editor);
  const studio = page.locator('.panel.right');
  const box = studio.getByRole('textbox', { name: 'Request' });

  await box.fill('make it punchy');
  await studio.getByRole('button', { name: 'Plan it' }).click();
  await expect(studio.getByText(/OpenAI rejected the API key/)).toBeVisible();

  mode = 'garbage';
  await studio.getByRole('button', { name: 'Plan it' }).click();
  await expect(studio.getByText(/did not pass validation, so nothing was changed/)).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Aspect' })).toHaveValue('16:9');
  await expect(page.getByRole('button', { name: /^Undo/ })).toBeDisabled();
});

test('Claude: SDK request carries the key and a structured plan comes back', async ({ page }) => {
  const editor = await setupProject(page);
  const headers: Record<string, string>[] = [];
  await page.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    headers.push(req.headers());
    return json(route, 200, {
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5',
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 10 },
      content: [{ type: 'text', text: '{"summary":"Tighten it.","commands":[{"type":"remove_silence","preset":"aggressive"},{"type":"match_levels","targetDb":-18}]}' }],
    });
  });
  await configure(page, 'Anthropic Claude', 'sk-ant-test');
  await page.goto(editor);
  const studio = page.locator('.panel.right');
  await studio.getByRole('textbox', { name: 'Request' }).fill('tighten this up');
  await studio.getByRole('button', { name: 'Plan it' }).click();
  await expect(studio.getByText('Remove quiet stretches (aggressive)')).toBeVisible();
  await studio.getByRole('button', { name: 'Apply' }).click();
  await expect(page.locator('.clip')).toHaveCount(2);

  expect(headers[0]['x-api-key']).toBe('sk-ant-test');
  expect(headers[0]['anthropic-dangerous-direct-browser-access']).toBe('true');
});
