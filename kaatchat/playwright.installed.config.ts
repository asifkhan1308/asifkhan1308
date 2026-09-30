import { defineConfig } from '@playwright/test';

// Tests the app as a user gets it: the Windows installer installed for real,
// the installed Kaatchat.exe launched. Set KAATCHAT_EXE to its path (CI does).
export default defineConfig({
  testDir: 'tests/installed',
  timeout: 180_000,
  expect: { timeout: 45_000 },
  workers: 1,
  reporter: [['list']],
});
