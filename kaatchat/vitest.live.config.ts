import { defineConfig } from 'vitest/config';

// Live AI provider tests: real requests to real accounts. Each provider runs only
// when its key is in the environment (CI: repository secrets), so this costs
// nothing unless you opt in.
export default defineConfig({
  test: {
    include: ['tests/live/**/*.test.ts'],
    environment: 'node',
    testTimeout: 180_000,
  },
});
