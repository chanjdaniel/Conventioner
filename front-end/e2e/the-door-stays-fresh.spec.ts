import type { APIRequestContext } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { seedPublishedMarketWithAssignments } from './helpers/seeds';
import { calendarToday, forgetSignInAttempts, vendorToken } from './helpers/vendorSignIn';
import { AttendanceStatusPage } from './pages/AttendanceStatusPage';

/**
 * The door's roster stays fresh with no tap (T318).
 *
 * It was read on load and after the organizer's own tap, so a vendor who scanned themselves in, or
 * a second organizer's check-in, showed only after the next tap or a reload: "who is missing" was
 * stale at exactly the moment it was asked. Now the open roster reads itself again every 15
 * seconds while it is in view, says when it was last read, offers Refresh, and keeps its rows when
 * a read fails. `page.clock` runs the 15 seconds.
 *
 * Each test seats vendors of its own: the sign-in limits count an address across every market.
 */
const TODAY = calendarToday();

function vendorsOf(name: string): [string, string] {
  const at = Date.now();
  return [`${name}-a-${at}@example.com`, `${name}-b-${at}@example.com`];
}

/** The vendor checks themselves in on their own phone, with the market's door code. */
async function scansIn(
  request: APIRequestContext,
  seed: { marketId: string; marketSlug: string },
  vendor: string,
): Promise<void> {
  const made = await request.post(`${BACKEND_URL}/markets/${seed.marketId}/door-code`);
  expect(made.ok(), await made.text()).toBeTruthy();
  const { code } = (await made.json()) as { code: string };
  const token = await vendorToken(request, BACKEND_URL, seed.marketSlug, seed.marketId, vendor);
  const checkedIn = await request.post(
    `${BACKEND_URL}/public/markets/${seed.marketSlug}/vendor/check-in`,
    { data: { date: TODAY, doorCode: code }, headers: { Authorization: `Bearer ${token}` } },
  );
  expect(checkedIn.ok(), await checkedIn.text()).toBeTruthy();
}

test.beforeEach(() => forgetSignInAttempts());

test('a vendor who scans themselves in shows on the open roster with no tap or reload', async ({
  authenticatedPage: page,
  request,
}) => {
  const [vendor, other] = vendorsOf('fresh');
  const seed = await seedPublishedMarketWithAssignments(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { marketDate: TODAY, vendors: [vendor, other] },
  );
  await page.clock.install();
  const attendance = new AttendanceStatusPage(page);
  await attendance.goto(seed.marketId);
  await expect(attendance.status(vendor)).toHaveText('Not yet');
  await expect(attendance.updated).toHaveText('Updated just now');

  await scansIn(request, seed, vendor);
  await page.clock.runFor(15_000);
  await expect(attendance.status(vendor)).toHaveText(/^Scanned in at \d{1,2}:\d{2}\s[AP]M$/);
  await expect(attendance.summary).toHaveText('1 of 2 checked in');

  // A second organizer checks the other vendor in; Refresh shows it at once.
  const atTheOtherDoor = await request.post(`${BACKEND_URL}/markets/${seed.marketId}/attendance`, {
    data: { vendorEmail: other, date: TODAY },
  });
  expect(atTheOtherDoor.ok(), await atTheOtherDoor.text()).toBeTruthy();
  await attendance.refresh.click();
  await expect(attendance.status(other)).toContainText(' by ');
  await expect(attendance.summary).toHaveText('2 of 2 checked in');
});

test('a re-read that fails keeps the roster and says so, until one lands', async ({
  authenticatedPage: page,
  request,
}) => {
  const [vendor, other] = vendorsOf('failing');
  const seed = await seedPublishedMarketWithAssignments(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { marketDate: TODAY, vendors: [vendor, other] },
  );
  await page.clock.install();
  const attendance = new AttendanceStatusPage(page);
  await attendance.goto(seed.marketId);
  await expect(attendance.rows).toHaveCount(2);

  // The venue's network drops the roster's reads.
  const roster = (url: URL) => url.pathname.endsWith(`/markets/${seed.marketId}/attendance`);
  await page.route(roster, (route) =>
    route.request().method() === 'GET' ? route.abort('internetdisconnected') : route.continue(),
  );
  await page.clock.runFor(15_000);
  await expect(attendance.refreshError).toHaveText(
    'Could not update. The roster is as it was last read.',
  );
  await expect(attendance.rows).toHaveCount(2);
  await expect(attendance.status(vendor)).toHaveText('Not yet');

  // The network is back: the next read lands, shows what happened meanwhile, and clears the line.
  await scansIn(request, seed, vendor);
  await page.unroute(roster);
  await attendance.refresh.click();
  await expect(attendance.status(vendor)).toHaveText(/^Scanned in at /);
  await expect(attendance.refreshError).toHaveCount(0);
});
