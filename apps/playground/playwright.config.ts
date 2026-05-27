import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for gene-glyph browser tests.
 *
 * The `webServer` block runs Vite (`npm run dev`) for the duration of the
 * run and tears it down when the test process exits. Locally we reuse an
 * already-running dev server so iteration is fast; in CI we always boot a
 * fresh one because port reuse there is unreliable.
 *
 * Slice 11 (RD-1085) sets the going-forward convention: every new slice
 * lands with at least one Playwright test pinning its acceptance bar.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:5174',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Pin colorScheme so dark-mode-aware styles stay stable across hosts
    // (CI Chromium ignores the OS preference, but a dev machine running
    // with macOS dark mode would otherwise flip the theme mid-test).
    colorScheme: 'light',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5174',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
