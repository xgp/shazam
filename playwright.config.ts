import { defineConfig, devices } from '@playwright/test'

/**
 * Layout checks for the board at phone, landscape, narrow-window and desktop
 * sizes. Every /api and /ws call is answered from e2e/fixtures.ts, so no shazam
 * server, GitHub token or agent is needed - only the Vite dev server.
 *
 * Browsers: on a machine with a shared Playwright cache this uses the
 * chromium-headless-shell build that @playwright/test's version pins.
 */
const PORT = Number(process.env.E2E_PORT ?? 4381)

// Phone metrics and touch, but in Chromium: the iPhone presets default to
// WebKit, and these tests are about layout rather than engine quirks.
const { defaultBrowserType: _p, ...iphone } = devices['iPhone 14']
const { defaultBrowserType: _l, ...iphoneLandscape } = devices['iPhone 14 landscape']

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    colorScheme: 'dark',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'phone', use: iphone },
    { name: 'phone-landscape', use: iphoneLandscape },
    { name: 'narrow-window', use: { viewport: { width: 700, height: 900 } } },
    { name: 'desktop', use: { viewport: { width: 1600, height: 1000 } } },
  ],
  webServer: {
    command: `vite --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
