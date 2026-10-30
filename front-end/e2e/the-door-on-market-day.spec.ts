import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { seedPublishedMarketWithAssignments } from './helpers/seeds';
import { CheckinPage } from './pages/CheckinPage';
import { AttendanceStatusPage } from './pages/AttendanceStatusPage';
import { transitionMarket } from './helpers/seedPhaseMarket';

/**
 * The door on market day (E29/F01). Attendance listed only the vendors who had checked in, by
 * email, so the organizer at the door could not say who was missing (known gap 3), and could not
 * check a vendor in themselves. The seed places alice and bob on one date: a date still to come,
 * where the door is, unless a test is about a day that is over.
 */
const ON_THE_DAY = '2099-05-02';
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
      { marketDate: ON_THE_DAY },
    );
    const checkin = new CheckinPage(page);
    await checkin.goto(seed.marketSlug);
    await checkin.fillEmail('alice@example.com');
    await checkin.clickLookup();
    await checkin.clickCheckIn();
    await expect(checkin.confirmationPills.first()).toBeVisible({ timeout: 10000 });

    const attendance = new AttendanceStatusPage(ownerPage);
    await attendance.goto(seed.marketId);

    await expect(attendance.date(ON_THE_DAY)).toHaveAttribute('aria-pressed', 'true');
    await expect(attendance.summary).toHaveText('1 of 2 checked in');
    await expect(attendance.status('alice@example.com')).not.toHaveText('Not yet');
    await expect(attendance.status('bob@example.com')).toHaveText('Not yet');
    // A vendor is said where they sit, not as a stored seat label.
    await expect(attendance.row('bob@example.com')).toContainText(/Table [A-Za-z ]+\d/);

    // Who has not arrived, on their own.
    await attendance.show('not-yet');
    await expect(attendance.rows).toHaveCount(1);
    await expect(attendance.row('bob@example.com')).toBeVisible();

    // And finding one vendor among eighty, in a field with a name of its own, which Chrome asks of
    // every form field.
    await attendance.show('all');
    await expect(attendance.search).toHaveAttribute('name', 'attendance-search');
    await attendance.search.fill('alice');
    await expect(attendance.rows).toHaveCount(1);
    await expect(attendance.row('alice@example.com')).toBeVisible();
  });

  test('once the day is over, a vendor who never came did not come', async ({
    authenticatedPage: page,
    request,
  }) => {
    // E30/F01/S02: an archived market's roster still said "Not yet" of everyone who never came.
    // The browser's clock is set past the market's day, so the day is over while it still runs.
    const seed = await seedPublishedMarketWithAssignments(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
      { marketDate: ON_THE_DAY },
    );
    await page.clock.setFixedTime(new Date('2099-05-03T12:00:00Z'));
    const attendance = new AttendanceStatusPage(page);

    for (const when of ['running', 'archived']) {
      if (when === 'archived') {
        await transitionMarket(request, BACKEND_URL, TEST_USER.email, seed.marketId, 'archived');
      }
      await attendance.goto(seed.marketId);
      await expect(attendance.status('bob@example.com')).toHaveText('Did not come');
      await expect(page.getByTestId('attendance-show-not-yet')).toHaveText('Did not come 2');
      await expect(page.getByText('Not yet')).toHaveCount(0);
    }
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
      { marketDate: ON_THE_DAY },
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
      { marketDate: ON_THE_DAY },
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
