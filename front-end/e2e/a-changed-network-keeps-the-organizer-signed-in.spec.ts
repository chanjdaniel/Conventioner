import type { Page } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL, LoginPage } from './fixtures';
import { marketScreenPath } from './helpers/marketScreens';
import { seedPublishedMarketWithAssignments } from './helpers/seeds';
import { calendarToday, forgetSignInAttempts } from './helpers/vendorSignIn';
import { AttendanceStatusPage } from './pages/AttendanceStatusPage';

/**
 * An organizer whose phone moves from the venue's wifi to mobile data stays signed in (T318).
 *
 * The back end held a session to the network address and the browser that signed in, so the
 * first request from the new network answered 401 and the app sent the organizer to sign in
 * again, on the same shaky network, at the door. Now it holds the session to the browser alone
 * (ADR 0030).
 *
 * Every request the page sends to the API carries `X-Forwarded-For`, as a proxy in front of the
 * back end names a caller, and the dev server's proxy passes it on: the network is that header,
 * changed mid-session.
 */
const TODAY = calendarToday();
const VENUE_WIFI = '198.51.100.7';
const MOBILE_DATA = '203.0.113.42';

/** Send every API request of the page from `network`, until `network.at` changes. */
async function onTheNetwork(page: Page, network: { at: string }): Promise<void> {
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    (route) =>
      route.continue({
        headers: { ...route.request().headers(), 'x-forwarded-for': network.at },
      }),
  );
}

test.beforeEach(() => forgetSignInAttempts());

test('an organizer whose phone moves to mobile data stays signed in through a check-in', async ({
  page,
  request,
}) => {
  const vendor = `network-${Date.now()}@example.com`;
  const seed = await seedPublishedMarketWithAssignments(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { marketDate: TODAY, vendors: [vendor] },
  );
  const network = { at: VENUE_WIFI };
  await onTheNetwork(page, network);
  const login = new LoginPage(page);
  await login.goto();
  await login.signIn(TEST_USER.email, TEST_USER.password);
  await login.waitForMarkets();

  const attendance = new AttendanceStatusPage(page);
  await attendance.goto(seed.marketId);
  await expect(attendance.status(vendor)).toHaveText('Not yet');

  // The phone leaves the venue's wifi.
  network.at = MOBILE_DATA;
  await attendance.checkIn(vendor);

  await expect(attendance.status(vendor)).toHaveText(/ by you$/);
  await attendance.refresh.click();
  await expect(attendance.updated).toHaveText('Updated just now');
  await expect(attendance.refreshError).toHaveCount(0);
  expect(new URL(page.url()).pathname).toBe(marketScreenPath(seed.marketId, 'attendance'));

  // And back on the wifi, a reload still opens the market signed in.
  network.at = VENUE_WIFI;
  await page.reload();
  await expect(attendance.status(vendor)).toHaveText(/ by you$/);
  expect(new URL(page.url()).pathname).toBe(marketScreenPath(seed.marketId, 'attendance'));
});
