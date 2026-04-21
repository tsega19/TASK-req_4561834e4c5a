import { test, expect, Page } from '@playwright/test';

const ADMIN = {
  user: process.env['SEED_ADMIN_USERNAME'] ?? 'admin',
  pass: process.env['SEED_ADMIN_PASSPHRASE'] ?? 'demo-change-me-admin'
};
const EDITOR = {
  user: process.env['SEED_EDITOR_USERNAME'] ?? 'editor',
  pass: process.env['SEED_EDITOR_PASSPHRASE'] ?? 'demo-change-me-editor'
};
const REVIEWER = {
  user: process.env['SEED_REVIEWER_USERNAME'] ?? 'reviewer',
  pass: process.env['SEED_REVIEWER_PASSPHRASE'] ?? 'demo-change-me-reviewer'
};

async function login(page: Page, user: string, pass: string): Promise<void> {
  await page.goto('/');
  await page.waitForURL(/login/);
  await page.getByTestId('login-username').fill(user);
  await page.getByTestId('login-passphrase').fill(pass);
  await page.getByTestId('login-submit').click();
  await page.waitForURL(/projects/);
}

test.describe('Diagnostics — end-to-end', () => {
  test('admin sees all diagnostic sections and can run the health check (happy path)', async ({ page }) => {
    await login(page, ADMIN.user, ADMIN.pass);
    await page.getByRole('link', { name: 'Diagnostics' }).click();
    await expect(page.getByRole('heading', { name: 'Diagnostics' })).toBeVisible();
    // All five panels render.
    await expect(page.getByRole('heading', { name: 'Storage' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Element counts' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Performance' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Health check' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Recent log' })).toBeVisible();

    // Run health check and assert on body content, not just status.
    await page.getByTestId('diag-run-health').click();
    const result = page.getByTestId('diag-health-result');
    await expect(result).toBeVisible();
    // Body content: "OK · <ms> ms · <detail>" on success.
    await expect(result).toContainText(/OK\s·\s\d+\sms\s·/);

    // The health-check records an entry into the audit timeline.
    await expect(page.locator('[data-testid^="audit-"]')).not.toHaveCount(0);
  });

  test('editor has access to Diagnostics (admin or editor only)', async ({ page }) => {
    await login(page, EDITOR.user, EDITOR.pass);
    // Editor can see the link …
    const link = page.getByRole('link', { name: 'Diagnostics' });
    await expect(link).toBeVisible();
    await link.click();
    // … and the panel renders for them.
    await expect(page.getByRole('heading', { name: 'Diagnostics' })).toBeVisible();
    await expect(page.getByTestId('diag-run-health')).toBeVisible();
  });

  test('RBAC: reviewer does not see the Diagnostics nav link', async ({ page }) => {
    await login(page, REVIEWER.user, REVIEWER.pass);
    await expect(page.getByRole('link', { name: 'Diagnostics' })).toHaveCount(0);
  });
});
