import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

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

test.describe('Backup / Restore — end-to-end', () => {
  test('admin exports a bundle whose body is a v1 JSON payload with the expected stores (happy path)', async ({ page }) => {
    await login(page, ADMIN.user, ADMIN.pass);
    // Seed a project so the bundle has visible content to assert on.
    await page.getByTestId('project-create').click();
    await page.getByTestId('form-name').fill('Backup-Seed');
    await page.getByTestId('form-description').fill('seeded for backup test');
    await page.getByTestId('form-save').click();
    await expect(page.getByText('Backup-Seed')).toBeVisible();

    await page.getByRole('link', { name: 'Backup' }).click();
    await expect(page.getByRole('heading', { name: 'Backup & Restore' })).toBeVisible();

    const download = page.waitForEvent('download');
    await page.getByTestId('backup-export').click();
    const d = await download;
    expect(d.suggestedFilename()).toMatch(/flowcanvas-backup-\d{4}-\d{2}-\d{2}\.json/);

    const filePath = await d.path();
    expect(filePath).toBeTruthy();
    const body = fs.readFileSync(filePath as string, 'utf8');
    const parsed = JSON.parse(body) as { version: number; exportedAt: number; stores: Record<string, unknown[]> };
    // Body-content assertions: bundle shape, schema version, and known stores.
    expect(parsed.version).toBe(1);
    expect(typeof parsed.exportedAt).toBe('number');
    expect(Array.isArray(parsed.stores['projects'])).toBe(true);
    expect(Array.isArray(parsed.stores['audit_log'])).toBe(true);
    expect((parsed.stores['projects'] as Array<{ name: string }>).some((p) => p.name === 'Backup-Seed')).toBe(true);

    await expect(page.getByText('Backup exported.')).toBeVisible();
  });

  test('admin restore surfaces an error when the uploaded file is empty (error path)', async ({ page }) => {
    await login(page, ADMIN.user, ADMIN.pass);
    await page.getByRole('link', { name: 'Backup' }).click();

    const tmp = path.join(os.tmpdir(), `fc-empty-${Date.now()}.json`);
    fs.writeFileSync(tmp, '');
    try {
      await page.getByTestId('backup-restore').setInputFiles(tmp);
      await expect(page.getByText('Backup bundle is empty.')).toBeVisible();
    } finally {
      try { fs.unlinkSync(tmp); } catch { /* noop */ }
    }
  });

  test('admin restore surfaces a parse error when the uploaded file is not valid JSON (error path)', async ({ page }) => {
    await login(page, ADMIN.user, ADMIN.pass);
    await page.getByRole('link', { name: 'Backup' }).click();

    const tmp = path.join(os.tmpdir(), `fc-bad-${Date.now()}.json`);
    fs.writeFileSync(tmp, '{not valid json');
    try {
      await page.getByTestId('backup-restore').setInputFiles(tmp);
      await expect(page.getByText(/Restore failed:/)).toBeVisible();
    } finally {
      try { fs.unlinkSync(tmp); } catch { /* noop */ }
    }
  });

  test('RBAC: reviewer does not see the Backup nav link', async ({ page }) => {
    await login(page, REVIEWER.user, REVIEWER.pass);
    await expect(page.getByRole('link', { name: 'Backup' })).toHaveCount(0);
  });

  test('RBAC: editor does not see the Backup nav link', async ({ page }) => {
    await login(page, EDITOR.user, EDITOR.pass);
    await expect(page.getByRole('link', { name: 'Backup' })).toHaveCount(0);
  });
});
