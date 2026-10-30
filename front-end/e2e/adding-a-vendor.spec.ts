import { test, expect, TEST_USER, BACKEND_URL, ApplicantLoginPage } from './fixtures';
import { createApplicantLoginChallenge } from './helpers/seedApplicantMarket';
import { TablesPage } from './pages/TablesPage';
import { seedPublishedMarketWithAssignments } from './helpers/seeds';
import { marketScreenPath } from './helpers/marketScreens';
import { namelessControls } from './helpers/accessibleNames';

/**
 * A vendor who never applied, added by hand on the day (E36/F03/S01).
 *
 * A walk-in is recorded as a vendor the market knows: added on the Vendors page with a name and an
 * address, shown as added by whoever added them, seated by hand on the Assignments page, and checked in
 * at the door like anyone.
 */
test('a walk-in is added on market day, seated, and checked in at the door', async ({
  authenticatedPage: page,
  request,
}) => {
  // A market whose vendors apply on its page, so the walk-in can sign in on it too.
  const { marketId, marketSlug } = await seedPublishedMarketWithAssignments(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { intakeMode: 'form' },
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
  // Listed as added, and counted as needing a table though outside the run (E38/F08/S02).
  await expect(
    page
      .getByTestId('vendors-list-item')
      .filter({ hasText: 'Walk-in Wares' })
      .getByTestId('vendors-list-status'),
  ).toHaveText('Added');
  await expect(page.getByTestId('vendors-summary')).toHaveText(/2\s+of\s+3\s+vendors assigned/);

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
  await tables.openPicker('vendor');
  await expect(tables.pickerOptions('vendor', 'placement-dialog-added')).toHaveText([
    /Walk-in Wares/,
  ]);
  await tables.pick('vendor', 'walk.in@example.com', 'walk-in');
  // Nothing they answered to cross, said as such - not that they declined the date.
  await expect(tables.dialogWarning).toHaveText(
    'Added by hand: they gave no answers to check this seat against.',
  );
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

  // On a market vendors apply on, they sign in and read their table like anyone.
  const vendorPage = await page.context().newPage();
  const login = new ApplicantLoginPage(vendorPage);
  await vendorPage.goto(`/${marketSlug}/applicant-login`);
  await login.requestCode('walk.in@example.com');
  createApplicantLoginChallenge(marketId, 'walk.in@example.com', '135790');
  await login.enterCode('135790');
  await vendorPage.waitForURL(new RegExp(`/${marketSlug}/applicant/dashboard`));
  await expect(vendorPage.getByTestId('applicant-dashboard-status')).toContainText(
    'You have a table',
  );
});
