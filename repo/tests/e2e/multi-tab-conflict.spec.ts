import { test, expect, Page, BrowserContext } from '@playwright/test';

const ADMIN = {
  user: process.env['SEED_ADMIN_USERNAME'] ?? 'admin',
  pass: process.env['SEED_ADMIN_PASSPHRASE'] ?? 'demo-change-me-admin'
};

/**
 * Log in and create one project + canvas, returning the canvas URL so a
 * second tab can open the exact same canvas through the shared IndexedDB.
 * Both tabs share a single BrowserContext, which is how Playwright expresses
 * "two tabs in the same browser profile" — IDB and BroadcastChannel are
 * scoped to the context, so the app's cross-tab machinery actually fires.
 */
async function loginCreateAndOpen(page: Page, projectName: string): Promise<string> {
  await page.goto('/');
  await page.waitForURL(/login/);
  await page.getByTestId('login-username').fill(ADMIN.user);
  await page.getByTestId('login-passphrase').fill(ADMIN.pass);
  await page.getByTestId('login-submit').click();
  await page.waitForURL(/projects/);
  await page.getByTestId('project-create').click();
  await page.getByTestId('form-name').fill(projectName);
  await page.getByTestId('form-description').fill('Cross-tab E2E');
  await page.getByTestId('form-save').click();
  await page.getByText(projectName).first().click();
  await page.getByTestId('new-canvas-name').fill('Main');
  await page.getByTestId('new-canvas-create').click();
  // Match the /canvas/ segment of the PATH — a bare /canvas/ regex would
  // trivially match the hostname "flowcanvas" and return before the router
  // has finished the project-list → canvas-editor navigation.
  await page.waitForURL(/\/canvas\//);
  return page.url();
}

/**
 * Open a second tab inside the same BrowserContext and navigate straight to
 * `canvasUrl`. Session persists through localStorage/IndexedDB so no re-login.
 */
async function openSecondTab(context: BrowserContext, canvasUrl: string): Promise<Page> {
  const tabB = await context.newPage();
  await tabB.goto(canvasUrl);
  // The canvas editor renders the toolbar once the canvas record loads.
  await expect(tabB.getByTestId('action-export-json')).toBeVisible({ timeout: 15_000 });
  return tabB;
}

test.describe('Cross-tab autosave / conflict banner', () => {
  test('tab B receives the conflict banner when tab A autosaves the same canvas', async ({ browser }) => {
    const context = await browser.newContext();
    const tabA = await context.newPage();
    const canvasUrl = await loginCreateAndOpen(tabA, 'CrossTab-A');
    const tabB = await openSecondTab(context, canvasUrl);

    // Tab A makes a change that flips the dirty flag. Autosave runs every 10s.
    await tabA.getByTestId('tool-button').click();
    await expect(tabA.locator('[data-testid^="el-"]').first()).toBeVisible();

    // Wait for tab A's autosave tick — it publishes on the BroadcastChannel,
    // and tab B's ConflictBannerComponent materialises the banner.
    await expect(tabB.getByTestId('conflict-banner')).toBeVisible({ timeout: 30_000 });
    // Assert body copy (not just the element) to match the rule about asserting
    // on response content, adapted to a DOM context.
    await expect(tabB.getByTestId('conflict-banner')).toContainText('Another tab saved this canvas.');
    await context.close();
  });

  test('tab B "Reload latest" dismisses the banner and adopts tab A\'s state', async ({ browser }) => {
    const context = await browser.newContext();
    const tabA = await context.newPage();
    const canvasUrl = await loginCreateAndOpen(tabA, 'CrossTab-B');
    const tabB = await openSecondTab(context, canvasUrl);

    // Tab A adds TWO elements so the "latest" state is unambiguously richer.
    await tabA.getByTestId('tool-button').click();
    await tabA.getByTestId('tool-input').click();
    await expect(tabB.getByTestId('conflict-banner')).toBeVisible({ timeout: 30_000 });

    await tabB.getByTestId('conflict-reload').click();
    // The banner must disappear and tab B must now render the two elements
    // that tab A saved (proof the reload actually pulled the latest snapshot).
    await expect(tabB.getByTestId('conflict-banner')).toHaveCount(0);
    await expect(tabB.locator('[data-testid^="el-"]')).toHaveCount(2, { timeout: 10_000 });
    await context.close();
  });

  test('tab B "Keep mine" dismisses the banner and marks the local copy dirty', async ({ browser }) => {
    const context = await browser.newContext();
    const tabA = await context.newPage();
    const canvasUrl = await loginCreateAndOpen(tabA, 'CrossTab-C');
    const tabB = await openSecondTab(context, canvasUrl);

    await tabA.getByTestId('tool-button').click();
    await expect(tabB.getByTestId('conflict-banner')).toBeVisible({ timeout: 30_000 });

    await tabB.getByTestId('conflict-keep').click();
    await expect(tabB.getByTestId('conflict-banner')).toHaveCount(0);
    // Tab B's "Keep mine" path marks dirty and will eventually autosave its own
    // state. We assert on the toolbar still being interactive (no modal / lock).
    await expect(tabB.getByTestId('action-export-json')).toBeEnabled();
    await context.close();
  });
});
