import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { CheckinPage } from './pages/CheckinPage';
import { marketSetupPath } from './helpers/marketScreens';
import { SEED_MARKET_DATE, seedPublishedMarketWithAssignments } from './helpers/seeds';
import { seedAssignedMarket } from './helpers/seedAssignedMarket';

/**
 * An archived market that ran keeps its check-in page, as a record (bug 9, E26/F06/S02).
 *
 * Archiving took the page off the air - against the docs and the organization-deletion preview,
 * which both said an archived market is still served - so a vendor could no longer look up where
 * they had sat. The archive dialog did not say so, and a dead page let a vendor type their address
 * before telling them there was no market there.
 */
test('an archived market that ran keeps its check-in page, and takes no check-in', async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketId, marketSlug } = await seedPublishedMarketWithAssignments(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  const checkedIn = await request.post(
    `${BACKEND_URL}/public/markets/${marketSlug}/attendance/checkin`,
    { data: { vendorEmail: 'alice@example.com', date: SEED_MARKET_DATE } },
  );
  expect(checkedIn.ok(), await checkedIn.text()).toBeTruthy();

  // The dialog says what archiving does to the page, before it does it.
  await page.goto(marketSetupPath(marketId, 'setup'));
  await page.getByTestId('phase-rail-menu-button').click({ timeout: 15000 });
  await page.getByTestId('phase-transition-archived').click();
  await expect(page.getByTestId('archive-confirm-window')).toContainText(
    'Its check-in page stays up as a record',
  );
  await page.getByTestId('archive-confirm-submit-button').click();
  await expect(page.getByTestId('phase-rail-frozen')).toBeVisible();

  const checkin = new CheckinPage(page);
  await checkin.goto(marketSlug);
  await expect(page.getByTestId('attendance-checkin-ended')).toContainText('This market has ended');

  // Alice checked in: the record says when, and offers no undo.
  await checkin.fillEmail('alice@example.com');
  await checkin.clickLookup();
  await expect(checkin.confirmationPills).toHaveCount(1);
  await expect(checkin.undoButtons).toHaveCount(0);

  // Bob did not: the record says so, and offers no check-in.
  await checkin.fillEmail('bob@example.com');
  await checkin.clickLookup();
  await expect(page.getByTestId('attendance-checkin-not-checked-in')).toBeVisible();
  await expect(checkin.checkinButtons).toHaveCount(0);
});

test('a market that never ran has no check-in page, and says so before asking anything', async ({
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

  const checkin = new CheckinPage(page);
  await checkin.goto(slug);
  await expect(page.getByTestId('attendance-checkin-not-found')).toBeVisible({ timeout: 15000 });
  await expect(checkin.emailInput).toHaveCount(0);
  // The eyebrow names the page; the heading does not say it again.
  await expect(checkin.marketName).not.toHaveText(/check-in/i);
});
