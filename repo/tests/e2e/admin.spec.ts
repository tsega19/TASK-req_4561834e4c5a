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

test.describe('Admin panel — end-to-end', () => {
  test('admin adds an announcement, a tag, a channel, and a topic; saves; reload preserves them (happy path)', async ({ page }) => {
    await login(page, ADMIN.user, ADMIN.pass);

    // Admin link is visible for admin role.
    await page.getByRole('link', { name: 'Admin' }).click();
    await expect(page.getByRole('heading', { name: 'Admin Panel' })).toBeVisible();

    // Announcement.
    await page.getByTestId('admin-add-announcement').click();
    // The announcement input is the only input inside the Announcements list
    // (other sections have their own test ids). Locate it via DOM order.
    const annInput = page.locator('section.card').filter({ hasText: 'Announcements' }).locator('input').first();
    await annInput.fill('Weekly standup Tuesdays');

    // Tag palette.
    await page.getByTestId('admin-new-tag').fill('retro-2026');
    await page.getByTestId('admin-add-tag').click();
    await expect(page.locator('.tag', { hasText: 'retro-2026' })).toBeVisible();

    // Channel.
    await page.getByTestId('admin-add-channel').click();
    await page.getByTestId('admin-channel-name-0').fill('field-ops');

    // Topic (enabled only after a channel exists).
    await page.getByTestId('admin-add-topic').click();
    await page.getByTestId('admin-topic-name-0').fill('onsite-install');

    // Save.
    await page.getByTestId('admin-save').click();
    await expect(page.getByText('Admin settings saved.')).toBeVisible();

    // Reload and confirm settings are persisted (backed by localStorage through AdminService).
    await page.reload();
    await page.waitForURL(/admin/);
    await expect(annInput).toHaveValue('Weekly standup Tuesdays');
    await expect(page.locator('.tag', { hasText: 'retro-2026' })).toBeVisible();
    await expect(page.getByTestId('admin-channel-name-0')).toHaveValue('field-ops');
    await expect(page.getByTestId('admin-topic-name-0')).toHaveValue('onsite-install');
  });

  test('admin cannot add a topic while the channel list is empty (error / guarded path)', async ({ page }) => {
    await login(page, ADMIN.user, ADMIN.pass);
    await page.getByRole('link', { name: 'Admin' }).click();
    await expect(page.getByRole('heading', { name: 'Admin Panel' })).toBeVisible();

    // With no channels the add-topic button is disabled, and the hint is rendered.
    await expect(page.getByTestId('admin-add-topic')).toBeDisabled();
    await expect(page.getByText('Add at least one channel before creating topics.')).toBeVisible();
  });

  test('admin can clamp negative featured-slot values on save (body-content assertion post-save)', async ({ page }) => {
    await login(page, ADMIN.user, ADMIN.pass);
    await page.getByRole('link', { name: 'Admin' }).click();

    await page.getByTestId('admin-featured-max').fill('-2');
    await page.getByTestId('admin-featured-rotation').fill('3.9');
    await page.getByTestId('admin-save').click();
    await expect(page.getByText('Admin settings saved.')).toBeVisible();

    // After save the component clamps negatives to 0 and floors the rotation
    // to an integer. Reload to confirm the persisted value was clamped.
    await page.reload();
    await page.waitForURL(/admin/);
    await expect(page.getByTestId('admin-featured-max')).toHaveValue('0');
    await expect(page.getByTestId('admin-featured-rotation')).toHaveValue('3');
  });

  test('RBAC: reviewer does not see the Admin nav link', async ({ page }) => {
    await login(page, REVIEWER.user, REVIEWER.pass);
    await expect(page.getByRole('link', { name: 'Admin' })).toHaveCount(0);
  });

  test('RBAC: editor does not see the Admin nav link', async ({ page }) => {
    await login(page, EDITOR.user, EDITOR.pass);
    await expect(page.getByRole('link', { name: 'Admin' })).toHaveCount(0);
  });
});
