import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { SEED_MARKET_DATE, seedPublishedMarketWithAssignments } from './helpers/seeds';
import { CheckinPage } from './pages/CheckinPage';
import { AttendanceStatusPage } from './pages/AttendanceStatusPage';

/**
 * The door on market day (E29/F01). Attendance listed only the vendors who had checked in, by
 * email, so the organizer at the door could not say who was missing (known gap 3), and could not
 * check a vendor in themselves. The seed places alice and bob on one date.
 */
test.describe('The door on market day', () => {
  test('Attendance lists everyone expected on the day, and who has come', async ({
    page,
    authenticatedPage: ownerPage,
    request,
  }) => {
    const seed = await seedPublishedMarketWithAssignments(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );
    const checkin = new CheckinPage(page);
    await checkin.goto(seed.marketSlug);
    await checkin.fillEmail('alice@example.com');
    await checkin.clickLookup();
    await checkin.clickCheckIn();
    await expect(checkin.confirmationPills.first()).toBeVisible({ timeout: 10000 });

    const attendance = new AttendanceStatusPage(ownerPage);
    await attendance.goto(seed.marketId);

    await expect(attendance.date(SEED_MARKET_DATE)).toHaveAttribute('aria-pressed', 'true');
    await expect(attendance.summary).toHaveText('1 of 2 checked in');
    await expect(attendance.status('alice@example.com')).not.toHaveText('Not yet');
    await expect(attendance.status('bob@example.com')).toHaveText('Not yet');
    // A vendor is said where they sit, not as a stored seat label.
    await expect(attendance.row('bob@example.com')).toContainText(/Table [A-Za-z ]+\d/);

    // Who has not arrived, on their own.
    await attendance.show('not-yet');
    await expect(attendance.rows).toHaveCount(1);
    await expect(attendance.row('bob@example.com')).toBeVisible();

    // And finding one vendor among eighty.
    await attendance.show('all');
    await attendance.search.fill('alice');
    await expect(attendance.rows).toHaveCount(1);
    await expect(attendance.row('alice@example.com')).toBeVisible();
  });

  test('an organizer checks a vendor in at the door, and can take it back', async ({
    authenticatedPage: page,
    request,
  }) => {
    const seed = await seedPublishedMarketWithAssignments(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );
    const attendance = new AttendanceStatusPage(page);
    await attendance.goto(seed.marketId);
    await expect(attendance.summary).toHaveText('0 of 2 checked in');

    await attendance.checkIn('bob@example.com');
    await expect(attendance.summary).toHaveText('1 of 2 checked in');
    // An organizer's check-in says who made it, so a vendor who never came cannot look present.
    await expect(attendance.status('bob@example.com')).toContainText('by you');

    // The vendor's own page agrees: the record is one record.
    const lookup = await request.get(
      `${BACKEND_URL}/public/markets/${seed.marketSlug}/vendors/bob@example.com/assignments`,
    );
    expect(lookup.ok(), await lookup.text()).toBeTruthy();
    expect((await lookup.json()).assignments[0].checkedInAt).toBeTruthy();

    await attendance.undo('bob@example.com');
    await expect(attendance.summary).toHaveText('0 of 2 checked in');
    await expect(attendance.status('bob@example.com')).toHaveText('Not yet');
  });

  test('the door works on a phone', async ({ authenticatedPage: page, request }) => {
    const seed = await seedPublishedMarketWithAssignments(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    const attendance = new AttendanceStatusPage(page);
    await attendance.goto(seed.marketId);
    await expect(attendance.summary).toHaveText('0 of 2 checked in');

    const action = attendance.row('bob@example.com').getByRole('button', { name: /Check in/ });
    await expect(action).toBeInViewport();
    const scrolls = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(scrolls, 'the page scrolls sideways on a phone').toBe(false);

    await attendance.checkIn('bob@example.com');
    await expect(attendance.summary).toHaveText('1 of 2 checked in');
  });
});
