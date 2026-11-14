import { test, expect, TEST_USER, BACKEND_URL, VendorPage } from './fixtures';
import { marketSetupPath } from './helpers/marketScreens';
import { seedPublishedMarketWithAssignments } from './helpers/seeds';
import { seedAssignedMarket } from './helpers/seedAssignedMarket';
import { calendarToday, forgetSignInAttempts, signInOnThePage } from './helpers/vendorSignIn';

/**
 * An archived market that ran keeps its vendor page, as a record (bug 9, E26/F06/S02, ADR 0022).
 *
 * Archiving once took the market's public page off the air - against the docs and the
 * organization-deletion preview, which both said an archived market is still served - so a vendor
 * could no longer look up where they had sat. That page was the public check-in page, gone since
 * T202: the record is now each vendor's own, on their vendor page, behind their sign-in. The archive
 * dialog says so before it archives.
 */
test.beforeEach(() => forgetSignInAttempts());

test('an archived market that ran keeps its vendor page as the record, and takes no check-in', async ({
  authenticatedPage: page,
  request,
}) => {
  const at = Date.now();
  const came = `archive-came-${at}@example.com`;
  const stayedAway = `archive-away-${at}@example.com`;
  const { marketId, marketSlug } = await seedPublishedMarketWithAssignments(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    // Today: the door takes no check-in for a day that has not begun (T318).
    { vendors: [came, stayedAway], marketDate: calendarToday() },
  );
  const checkedIn = await request.post(`${BACKEND_URL}/markets/${marketId}/attendance`, {
    data: { vendorEmail: came, date: calendarToday() },
  });
  expect(checkedIn.ok(), await checkedIn.text()).toBeTruthy();

  // The dialog says what archiving does to the page, before it does it.
  await page.goto(marketSetupPath(marketId, 'setup'));
  await page.getByTestId('phase-rail-menu-button').click({ timeout: 15000 });
  await page.getByTestId('phase-transition-archived').click();
  await expect(page.getByTestId('archive-confirm-window')).toContainText(
    'Its vendor page stays up as a record',
  );
  await page.getByTestId('archive-confirm-submit-button').click();
  await expect(page.getByTestId('phase-rail-frozen')).toBeVisible();

  const vendorPage = new VendorPage(page);

  // The vendor who came: the record says when, and offers no undo.
  await vendorPage.goto(marketSlug);
  await signInOnThePage(vendorPage, marketId, came);
  await expect(vendorPage.record).toContainText('This market has ended');
  await expect(vendorPage.recordSeats).toHaveCount(1);
  await expect(vendorPage.recordSeats.first()).toContainText(/Checked in at \d{1,2}:\d{2}\s[AP]M/);
  await expect(vendorPage.undoButton).toHaveCount(0);
  await expect(vendorPage.checkInButton).toHaveCount(0);
  await vendorPage.signOutButton.click();
  await expect(vendorPage.emailInput).toBeVisible();

  // The one who did not: the record says so, and offers no check-in.
  await signInOnThePage(vendorPage, marketId, stayedAway);
  await expect(vendorPage.recordSeats.first()).toContainText('Not checked in');
  await expect(vendorPage.doorCodeInput).toHaveCount(0);
});

test('a Google Form market archived without running has no vendor page', async ({
  page,
  request,
}) => {
  const { marketId, slug } = await seedAssignedMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  const archived = await request.post(`${BACKEND_URL}/markets/${marketId}/transition`, {
    data: { toPhase: 'archived' },
  });
  expect(archived.ok(), await archived.text()).toBeTruthy();

  const vendorPage = new VendorPage(page);
  await vendorPage.goto(slug);
  await expect(vendorPage.notFound).toBeVisible({ timeout: 15000 });
  await expect(vendorPage.emailInput).toHaveCount(0);
});
