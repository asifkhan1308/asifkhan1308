import { defineConfig } from '@playwright/test';

// Desktop smoke tests: run after `npm run build && npm --prefix desktop run copy-web`.
export default defineConfig({
  testDir: 'tests/desktop',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  workers: 1,
  reporter: [['list']],
});
