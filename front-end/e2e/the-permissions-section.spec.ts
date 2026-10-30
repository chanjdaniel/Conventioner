import type { Locator, Page } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { marketScreenPath } from './helpers/marketScreens';
import { SEED_MARKET_DATE, seedPublishedMarketWithAssignments } from './helpers/seeds';
import { ensureVerifiedUser } from './helpers/verifiedUser';
import { withUser } from './helpers/withUser';
import { ManageMarketPage } from './pages/ManageMarketPage';

/**
 * The Permissions section in Manage market (E39/F01/S04).
 *
 * The market's table of who may do what was the server's alone, changed only through its routes.
 * The owner now sets each row in Manage market, after a confirmation naming who may after it, and
 * resets them all; everyone who reads the market reads the table and every change to it, with the
 * owner-only line. A change reaches every screen at its next read of the market.
 */
const PEOPLE = {
  admin: { email: 'e2e-perms-admin@example.com', password: 'e2epassword123' },
  editor: { email: 'e2e-perms-editor@example.com', password: 'e2epassword123' },
  viewer: { email: 'e2e-perms-viewer@example.com', password: 'e2epassword123' },
} as const;

let marketId = '';
let marketName = '';

test.beforeAll(async ({ request }) => {
  for (const person of Object.values(PEOPLE)) ensureVerifiedUser(person.email, person.password);
  // A market on its day, so Attendance offers check-in to whoever may.
  ({ marketId, marketName } = await seedPublishedMarketWithAssignments(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  ));
  for (const [role, person] of Object.entries(PEOPLE)) {
    const res = await request.post(`${BACKEND_URL}/markets/${marketId}/roles`, {
      data: { user_email: person.email, role },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
  }
});

async function openPermissions(page: Page): Promise<Locator> {
  await page.goto(`/markets?q=${encodeURIComponent(marketName)}`);
  await page.getByTestId('market-card-manage-button').click();
  await new ManageMarketPage(page).waitForOverlay();
  const section = page.getByTestId('manage-market-permissions');
  const toggle = section.getByTestId('manage-market-permissions-toggle');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  return section;
}

const row = (section: Locator, id: string) => section.locator(`[data-row="${id}"]`);

test.describe.configure({ mode: 'serial' });

test('the owner raises check-in to Admin, and an Editor is offered it nowhere', async ({
  authenticatedPage: page,
  browser,
  playwright,
}) => {
  const section = await openPermissions(page);
  await expect(section.getByTestId('manage-market-permissions-read-only')).toHaveCount(0);
  const checkIn = row(section, 'check-in');
  await expect(checkIn.getByTestId('manage-market-permission-source')).toHaveText(
    'Built-in default',
  );
  const select = checkIn.getByRole('combobox', { name: 'Check vendors in' });
  await expect(select).toHaveValue('editor');

  // Cancelling the confirmation leaves the row as it was.
  await select.selectOption('admin');
  const confirm = page.getByTestId('manage-market-permission-confirm-window');
  await expect(confirm).toContainText(
    'Let only Admins and the owner check vendors in at this market?',
  );
  await expect(confirm).toContainText('Editors lose this.');
  await page.getByTestId('manage-market-permission-confirm-cancel-button').click();
  await expect(confirm).toHaveCount(0);
  await expect(select).toHaveValue('editor');

  await select.selectOption('admin');
  await page.getByTestId('manage-market-permission-confirm-submit-button').click();
  await expect(confirm).toHaveCount(0);
  await expect(select).toHaveValue('admin');
  await expect(checkIn.getByTestId('manage-market-permission-source')).toContainText(
    `Changed on this market by ${TEST_USER.email}`,
  );

  // Under Changes: who, when, the row, before and after.
  const change = section.getByTestId('manage-market-permission-change').first();
  await expect(change).toContainText('Check vendors in');
  await expect(change).toContainText('Editor to Admin');
  await expect(change).toContainText(TEST_USER.email);
  await expect(change).toContainText(String(new Date().getFullYear()));

  // An Editor's Attendance offers no check-in, and the server refuses one.
  await withUser(browser, PEOPLE.editor.email, PEOPLE.editor.password, async (editorPage) => {
    await editorPage.goto(marketScreenPath(marketId, 'attendance'));
    await expect(editorPage.getByTestId('attendance-row').first()).toBeVisible({ timeout: 15000 });
    await expect(editorPage.getByTestId('attendance-check-in')).toHaveCount(0);
  });
  const editorApi = await playwright.request.newContext({
    baseURL: BACKEND_URL,
    ignoreHTTPSErrors: true,
  });
  try {
    await editorApi.post('/login', { data: PEOPLE.editor });
    const refused = await editorApi.post(`/markets/${marketId}/attendance`, {
      data: { vendorEmail: 'ana@example.com', date: SEED_MARKET_DATE },
    });
    expect(refused.status()).toBe(403);
    expect((await refused.json()).error).toBe(
      'Only an Admin or the owner may check vendors in at this market.',
    );
  } finally {
    await editorApi.dispose();
  }
});

test('an Admin and a Viewer read the section and its changes, and change nothing', async ({
  browser,
}) => {
  for (const person of [PEOPLE.admin, PEOPLE.viewer]) {
    await withUser(browser, person.email, person.password, async (page) => {
      const section = await openPermissions(page);
      await expect(section.getByTestId('manage-market-permissions-read-only')).toHaveText(
        "Only the market's owner changes these.",
      );
      await expect(section.getByTestId('manage-market-permission-select')).toHaveCount(0);
      await expect(section.getByTestId('manage-market-permissions-reset')).toHaveCount(0);
      await expect(
        row(section, 'check-in').getByTestId('manage-market-permission-role'),
      ).toHaveText('Admin and above');
      await expect(section.getByTestId('manage-market-permission-change').first()).toContainText(
        'Editor to Admin',
      );
    });
  }
});

test('a fixed row shows its role and Always, with no control', async ({
  authenticatedPage: page,
}) => {
  const section = await openPermissions(page);
  for (const id of ['read', 'manage-admins', 'delete-market', 'change-the-table']) {
    await expect(row(section, id).getByTestId('manage-market-permission-select')).toHaveCount(0);
    await expect(row(section, id).getByTestId('manage-market-permission-source')).toHaveText(
      'Always',
    );
  }
  await expect(
    row(section, 'delete-market').getByTestId('manage-market-permission-role'),
  ).toHaveText('Owner only');
});

test('the owner resets every row to its built-in default, and the reset is recorded', async ({
  authenticatedPage: page,
}) => {
  const section = await openPermissions(page);
  await expect(section.getByTestId('manage-market-permissions-summary')).toContainText(
    '1 row differs from the built-in defaults.',
  );
  await section.getByTestId('manage-market-permissions-reset').click();
  const confirm = page.getByTestId('manage-market-permissions-reset-confirm-window');
  await expect(confirm).toContainText('Check vendors in: Admin and above to Editor and above');
  await page.getByTestId('manage-market-permissions-reset-confirm-submit-button').click();
  await expect(confirm).toHaveCount(0);

  await expect(row(section, 'check-in').getByRole('combobox')).toHaveValue('editor');
  await expect(section.getByTestId('manage-market-permission-source').first()).toBeVisible();
  for (const source of await section.getByTestId('manage-market-permission-source').all()) {
    await expect(source).toHaveText(/^(Built-in default|Always)$/);
  }
  await expect(section.getByTestId('manage-market-permissions-reset')).toBeDisabled();
  const reset = section.getByTestId('manage-market-permission-change').first();
  await expect(reset).toContainText('Reset to built-in defaults');
  await expect(reset).toContainText('Check vendors in: Admin to Editor');
  await expect(reset).toContainText(TEST_USER.email);
});
