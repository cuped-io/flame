import { defineConfig, devices } from '@playwright/test';

/**
 * flame e2e suite.
 *
 * Boots three long-lived processes for the run:
 *   1. the mock cuped API          (fixtures/experiments.mjs)
 *   2. a static host for script-tag (mock-server/static.mjs)
 *   3. the next-app example         (built + started against the mock)
 *
 * Prerequisite: `pnpm build` at the repo root, so `dist/flame.js` and
 * the workspace packages the next-app depends on exist. The root
 * `test:e2e` script does this for you.
 *
 * Workers are pinned to 1: the mock API records events in a single
 * in-memory sink that specs reset between tests, so parallel workers
 * would cross-contaminate.
 */

const API_PORT = 8788;
const STATIC_PORT = 8789;
const NEXT_PORT = 3210;

const TEST_DSN = `http://0123456789abcdef0123456789abcdef@localhost:${API_PORT}`;
const COOKIE_SECRET = 'e2e-cookie-secret-please-do-not-use-in-prod';

// The next-app build is slow; allow skipping it while iterating on the
// script-tag path (E2E_SKIP_NEXT=1). The full suite always runs it.
const skipNext = process.env.E2E_SKIP_NEXT === '1';

const nextWebServer = {
  command:
    'pnpm --filter @cuped-io/example-next-app build && pnpm --filter @cuped-io/example-next-app start',
  url: `http://localhost:${NEXT_PORT}`,
  reuseExistingServer: !process.env.CI,
  timeout: 180_000,
  stdout: 'pipe' as const,
  env: {
    CUPED_DSN: TEST_DSN,
    NEXT_PUBLIC_CUPED_DSN: TEST_DSN,
    CUPED_COOKIE_SECRET: COOKIE_SECRET,
    NEXT_PUBLIC_CUPED_EXPERIMENT_ID: 'exp_react',
  },
};

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['github'], ['list'], ['html', { open: 'never' }]]
    : 'list',
  use: {
    headless: true,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node mock-server/api.mjs',
      url: `http://localhost:${API_PORT}/_test/events`,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
    },
    {
      command: 'node mock-server/static.mjs',
      url: `http://localhost:${STATIC_PORT}/examples/script-tag/index.html`,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
    },
    ...(skipNext ? [] : [nextWebServer]),
  ],
});
