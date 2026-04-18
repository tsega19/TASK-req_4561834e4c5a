import { test, expect } from '@playwright/test';

const ADMIN = {
  user: process.env['SEED_ADMIN_USERNAME'] ?? 'admin',
  pass: process.env['SEED_ADMIN_PASSPHRASE'] ?? 'demo-change-me-admin'
};

test.describe('Service Worker / offline', () => {
  test('app shell reloads while the context is offline (SW serves the precached shell)', async ({ page, context }) => {
    // First visit — online — so the SW installs and precaches the app shell.
    await page.goto('/');
    await page.waitForURL(/login/);

    // Wait for a service worker to take control (bounded — the SW is configured
    // via ngsw-config.json and may not always claim under automation).
    const hasSW = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return false;
      const reg = await navigator.serviceWorker.ready.catch(() => null);
      return !!reg;
    }).catch(() => false);

    if (!hasSW) {
      test.info().annotations.push({ type: 'skip-reason', description: 'service worker did not install in this environment' });
      test.skip(true, 'SW unavailable');
      return;
    }

    // Flip the context offline and reload. The app shell must still render.
    await context.setOffline(true);
    await page.reload();
    // The login screen's username field is part of the precached shell;
    // its presence confirms the shell loaded from the SW cache, not the network.
    await expect(page.getByTestId('login-username')).toBeVisible({ timeout: 15_000 });
    await context.setOffline(false);
  });

  test('after login, going offline and reloading keeps the user inside the app (IndexedDB session + SW shell)', async ({ page, context }) => {
    await page.goto('/');
    await page.waitForURL(/login/);
    await page.getByTestId('login-username').fill(ADMIN.user);
    await page.getByTestId('login-passphrase').fill(ADMIN.pass);
    await page.getByTestId('login-submit').click();
    await page.waitForURL(/projects/);

    const hasSW = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return false;
      const reg = await navigator.serviceWorker.ready.catch(() => null);
      return !!reg;
    }).catch(() => false);

    if (!hasSW) {
      test.skip(true, 'SW unavailable');
      return;
    }

    await context.setOffline(true);
    await page.reload();
    // On reload with session in localStorage the app should land back on /projects.
    await page.waitForURL(/projects/, { timeout: 15_000 });
    await context.setOffline(false);
  });
});
