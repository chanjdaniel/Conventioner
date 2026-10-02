import type { Locator, Page } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { ManageMarketPage } from './pages/ManageMarketPage';
import { seedApplicantMarket } from './helpers/seedApplicantMarket';
import { ensureVerifiedUser } from './helpers/verifiedUser';

/**
 * Manage market holds together (bug 15, and items 14 and 15 of bug 43; E26/F10/S01).
 *
 * Its buttons were the compact size, smaller than every other button in the product. "Add user"
 * turned into a lone Cancel above the row it opened. The owner's own row offered a role select the
 * server refused every use of, and the refusal appeared at the foot of the dialog. Delete asked
 * "Are you sure?" inline, Confirm before Cancel, with focus left on the page.
 */
test.use({ viewport: { width: 1440, height: 900 } });

const COLLEAGUE = { email: 'e2e-manage-market@example.com', password: 'e2epassword123' };

test.beforeAll(() => ensureVerifiedUser(COLLEAGUE.email, COLLEAGUE.password));

async function openManage(page: Page, marketName: string): Promise<ManageMarketPage> {
  await page.goto(`/markets?q=${encodeURIComponent(marketName)}`);
  await page.getByTestId('market-card-manage-button').click();
  const manage = new ManageMarketPage(page);
  await manage.waitForOverlay();
  return manage;
}

const height = (locator: Locator) =>
  locator.evaluate((el) => Math.round(el.getBoundingClientRect().height));

test('its controls are the product size, and adding someone is one row with its own Cancel', async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketName } = await seedApplicantMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  const manage = await openManage(page, marketName);

  // The product's control height, which the fields beside them already have.
  for (const button of [manage.addUserButton, manage.deleteButton]) {
    expect(await height(button)).toBe(36);
  }

  // The owner's own role is a fact, not a choice the server will refuse.
  const owner = page.locator('.user-card').filter({ hasText: TEST_USER.email });
  await expect(owner.getByTestId('manage-market-role-select')).toHaveCount(0);
  await expect(owner).toContainText('Owner');

  await manage.clickAddUser();
  await expect(manage.addUserButton).toHaveCount(0);
  const cancel = page.getByTestId('manage-market-add-user-cancel');
  // Cancel sits in the row it cancels, beside Add, at the same height.
  const add = await manage.addUserSubmit.boundingBox();
  const cancelBox = await cancel.boundingBox();
  expect(Math.abs((add?.y ?? 0) - (cancelBox?.y ?? -100))).toBeLessThan(2);
  expect(await height(cancel)).toBe(36);

  await cancel.click();
  await expect(manage.addUserInput).toHaveCount(0);
  await expect(manage.addUserButton).toBeVisible();
});

test("a refused change is said beneath the person's row, which keeps the role they hold", async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketId, marketName } = await seedApplicantMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  const added = await request.post(`${BACKEND_URL}/markets/${marketId}/roles`, {
    data: { user_email: COLLEAGUE.email, role: 'editor' },
  });
  expect(added.ok(), await added.text()).toBeTruthy();
  await openManage(page, marketName);

  // The server's refusal, whatever it is, for a change this page offers.
  await page.route('**/api/markets/*/roles/*', (route) =>
    route.request().method() === 'PUT'
      ? route.fulfill({ status: 403, json: { error: 'You cannot make that change.' } })
      : route.continue(),
  );
  const row = page.locator('.user-entry').filter({ hasText: COLLEAGUE.email });
  const select = row.getByTestId('manage-market-role-select');
  await select.selectOption('viewer');

  await expect(row.getByTestId('manage-market-user-error')).toHaveText(
    'You cannot make that change.',
  );
  await expect(select).toHaveValue('editor');
  // Not also at the foot of the dialog, where it used to be the only place it was said.
  await expect(page.getByTestId('manage-market-error')).toHaveCount(0);
});

test('deleting is a destructive dialog that opens on Cancel and says what goes', async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketName } = await seedApplicantMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  const manage = await openManage(page, marketName);
  await manage.deleteButton.click();

  const dialog = page.getByTestId('manage-market-delete-window');
  await expect(dialog).toContainText(`Delete ${marketName}?`);
  await expect(page.getByTestId('manage-market-delete-consequence')).toContainText(
    'its applications, its assignment, its check-in records',
  );
  // A form market taking applications has a public page, and it goes too.
  await expect(page.getByTestId('manage-market-delete-public')).toHaveText(
    'Its application page will stop working for anyone who has the link.',
  );
  await expect(manage.deleteCancelButton).toBeFocused();

  await manage.deleteCancelButton.click();
  await expect(dialog).toHaveCount(0);
  await expect(manage.window).toBeVisible();

  await manage.deleteButton.click();
  await manage.deleteConfirmButton.click();
  await expect(manage.window).toHaveCount(0);
  await expect(page.getByTestId('market-card')).toHaveCount(0);
});
