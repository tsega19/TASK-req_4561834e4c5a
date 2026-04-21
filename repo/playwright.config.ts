import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env['E2E_BASE_URL'] ?? 'http://localhost:4200';

// In Docker the app container is reached by service name ("flowcanvas"), which
// is an insecure origin — Chromium then hides navigator.serviceWorker and
// window.crypto.subtle. To avoid that we navigate the browser to
// http://localhost (always a secure context) and remap the DNS inside
// Chromium's own resolver via --host-rules. The Docker compose file supplies
// E2E_CHROMIUM_HOST_RULES=`MAP localhost flowcanvas`. For local/host runs no
// remap is needed because baseURL is already localhost:4200.
const hostRules = process.env['E2E_CHROMIUM_HOST_RULES'];

const chromiumArgs: string[] = [
  '--disable-features=IsolateOrigins,site-per-process'
];
if (hostRules) {
  chromiumArgs.push(`--host-rules=${hostRules}`);
}

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: '.tmp/playwright-report', open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    launchOptions: { args: chromiumArgs }
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } }
  ]
});
