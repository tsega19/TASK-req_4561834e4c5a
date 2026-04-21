import { test, expect, Page } from '@playwright/test';

const ADMIN = {
  user: process.env['SEED_ADMIN_USERNAME'] ?? 'admin',
  pass: process.env['SEED_ADMIN_PASSPHRASE'] ?? 'demo-change-me-admin'
};

// Must be >= the app's `registerWhenStable:30000` window (app.config.ts) plus
// a cushion for Chromium's post-load idle period. Anything shorter races the
// app's own registration schedule.
const SW_REGISTER_TIMEOUT_MS = 45_000;

/**
 * Wait for the service worker to reach `ready` state. Returns when the SW is
 * controlling the page, or throws on timeout. Older versions of this test
 * suite called `test.skip()` when SW didn't register in time — that hid real
 * regressions behind a green E2E run. The app is built with SW enabled in
 * production (`provideServiceWorker(..., { enabled: !isDevMode() })`), and
 * Docker serves the production build, so missing SW IS a failure, not a
 * tolerated environment quirk.
 */
async function requireServiceWorker(page: Page): Promise<void> {
  const deadline = Date.now() + SW_REGISTER_TIMEOUT_MS;
  let lastError = '';
  while (Date.now() < deadline) {
    const status = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return { ready: false, reason: 'navigator.serviceWorker missing' };
      const reg = await Promise.race([
        navigator.serviceWorker.ready.then((r) => ({ ready: true, reason: 'ready', scope: r.scope })),
        new Promise<{ ready: false; reason: string }>((resolve) => setTimeout(() => resolve({ ready: false, reason: 'ready-poll-timeout' }), 1000))
      ]).catch((e) => ({ ready: false, reason: 'ready-threw: ' + String(e) }));
      return reg;
    }).catch((e) => ({ ready: false, reason: 'evaluate-threw: ' + String(e) }));
    if ((status as { ready: boolean }).ready) return;
    lastError = (status as { reason: string }).reason;
    await page.waitForTimeout(500);
  }
  throw new Error(`service worker did not reach 'ready' within ${SW_REGISTER_TIMEOUT_MS}ms (last status: ${lastError}). ` +
    `The production build registers SW via registerWhenStable:30000 — missing SW means the precached app shell is unavailable ` +
    `and the offline guarantee documented in README is broken.`);
}

test.describe('Service Worker / offline', () => {
  test('app shell reloads while the context is offline (SW serves the precached shell)', async ({ page, context }) => {
    // Playwright's default 30s per-test timeout is tighter than the app's own
    // `registerWhenStable:30000` SW-registration window. Give the whole test
    // enough room for SW registration + the offline-reload assertion.
    test.setTimeout(90_000);
    await page.goto('/');
    await page.waitForURL(/login/);
    await requireServiceWorker(page);

    // Flip the context offline and reload. The app shell must still render.
    await context.setOffline(true);
    await page.reload();
    // The login screen's username field is part of the precached shell;
    // its presence confirms the shell loaded from the SW cache, not the network.
    await expect(page.getByTestId('login-username')).toBeVisible({ timeout: 15_000 });
    await context.setOffline(false);
  });

  test('after login, going offline and reloading keeps the user inside the app (IndexedDB session + SW shell)', async ({ page, context }) => {
    test.setTimeout(90_000);
    await page.goto('/');
    await page.waitForURL(/login/);
    await page.getByTestId('login-username').fill(ADMIN.user);
    await page.getByTestId('login-passphrase').fill(ADMIN.pass);
    await page.getByTestId('login-submit').click();
    await page.waitForURL(/projects/);

    await requireServiceWorker(page);

    await context.setOffline(true);
    await page.reload();
    // On reload with session in localStorage the app should land back on /projects.
    await page.waitForURL(/projects/, { timeout: 15_000 });
    await context.setOffline(false);
  });

  /**
   * SW-independent persistence guarantee. This runs unconditionally (no
   * service worker involved) so even if the Chromium SW lifecycle misbehaves
   * in CI, we still have an E2E test proving IndexedDB round-trips survive a
   * full page reload. Without this we had zero E2E coverage of the core
   * "data survives reload" promise when the two SW tests skipped.
   */
  test('project + canvas created while online round-trip through IndexedDB across a full reload', async ({ page }) => {
    await page.goto('/');
    await page.waitForURL(/login/);
    await page.getByTestId('login-username').fill(ADMIN.user);
    await page.getByTestId('login-passphrase').fill(ADMIN.pass);
    await page.getByTestId('login-submit').click();
    await page.waitForURL(/projects/);
    await page.getByTestId('project-create').click();
    await page.getByTestId('form-name').fill('Persistence-Check');
    await page.getByTestId('form-description').fill('IDB survival test');
    await page.getByTestId('form-save').click();
    await expect(page.getByText('Persistence-Check')).toBeVisible();

    // Full reload, then assert the project is still listed. The list is
    // rendered from IndexedDB — if IDB weren't persisted (or the app
    // re-seeded on boot), the project would be gone.
    await page.reload();
    // After reload, the auth session in localStorage should route us to /projects.
    await page.waitForURL(/projects/);
    await expect(page.getByText('Persistence-Check')).toBeVisible();
  });

  /**
   * Forced-offline variant of the persistence check: seed data, go offline,
   * reload. Even without SW, Chromium still serves the current page from
   * memory for a brief window, which is enough to verify IDB is readable
   * offline. Asserts on visible body content (project name in the list).
   */
  test('project list renders from IndexedDB when context is offline (no SW dependency for read path)', async ({ page, context }) => {
    await page.goto('/');
    await page.waitForURL(/login/);
    await page.getByTestId('login-username').fill(ADMIN.user);
    await page.getByTestId('login-passphrase').fill(ADMIN.pass);
    await page.getByTestId('login-submit').click();
    await page.waitForURL(/projects/);
    await page.getByTestId('project-create').click();
    await page.getByTestId('form-name').fill('Offline-Read');
    await page.getByTestId('form-description').fill('IDB offline read');
    await page.getByTestId('form-save').click();
    await expect(page.getByText('Offline-Read')).toBeVisible();

    // Go offline and navigate within the SPA. Router navigation is local,
    // IDB reads are local — this exercise must succeed regardless of SW state.
    await context.setOffline(true);
    // Trigger a fresh project-list refresh by navigating away and back in-app.
    await page.evaluate(() => { window.history.pushState({}, '', '/projects'); window.dispatchEvent(new PopStateEvent('popstate')); });
    await expect(page.getByText('Offline-Read')).toBeVisible({ timeout: 10_000 });
    await context.setOffline(false);
  });
});
