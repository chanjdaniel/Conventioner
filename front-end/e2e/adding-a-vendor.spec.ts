import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { TablesPage } from './pages/TablesPage';
import { seedPublishedMarketWithAssignments } from './helpers/seeds';
import { marketScreenPath } from './helpers/marketScreens';
import { namelessControls } from './helpers/accessibleNames';

/**
 * A vendor who never applied, added by hand on the day (E36/F03/S01).
 *
 * A walk-in is recorded as a vendor the market knows: added on the Vendors page with a name and an
 * address, shown as added by whoever added them, seated by hand on the Result page, and checked in
 * at the door like anyone.
 */
test('a walk-in is added on market day, seated, and checked in at the door', async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketId } = await seedPublishedMarketWithAssignments(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );

  await page.goto(marketScreenPath(marketId, 'vendors'));
  await page.getByTestId('vendors-add-button').click();
  const dialog = page.getByTestId('add-vendor-window');
  expect(await namelessControls(page), 'the add-a-vendor dialog').toEqual([]);
  await dialog.getByTestId('add-vendor-name-input').fill('Walk-in Wares');
  await dialog.getByTestId('add-vendor-email-input').fill('Walk.In@Example.com');
  await dialog.getByTestId('add-vendor-submit-button').click();
  await expect(dialog).toBeHidden();
  // The drawer opens on them, saying who added them.
  await expect(page.getByTestId('vendors-detail-giver')).toContainText(
    `Added by ${TEST_USER.email}`,
  );
  await page.getByTestId('vendors-detail-close').click();

  // An address the market already has is refused, naming it.
  await page.getByTestId('vendors-add-button').click();
  await dialog.getByTestId('add-vendor-name-input').fill('Alice again');
  await dialog.getByTestId('add-vendor-email-input').fill('alice@example.com');
  await dialog.getByTestId('add-vendor-submit-button').click();
  await expect(dialog).toContainText('alice@example.com already has an application');
  await dialog.getByTestId('add-vendor-cancel-button').click();

  const tables = new TablesPage(page);
  await tables.goto(marketId);
  await tables.vacantSeat('A 3').click();
  await tables.dialog.getByTestId('placement-dialog-vendor').selectOption('walk.in@example.com');
  await tables.dialog.getByTestId('placement-dialog-confirm').click();
  await expect(tables.dialog).toBeHidden();
  await expect(tables.occupiedSeat('A 3')).toHaveAttribute(
    'data-vendor-email',
    'walk.in@example.com',
  );

  await page.goto(marketScreenPath(marketId, 'attendance'));
  const row = page.getByTestId('attendance-row').filter({ hasText: 'Walk-in Wares' });
  await row.getByTestId('attendance-check-in').click();
  await expect(row.getByTestId('attendance-row-status')).not.toHaveText('Not yet');
});
