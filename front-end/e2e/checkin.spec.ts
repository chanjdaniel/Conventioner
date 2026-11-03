import type { Browser } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL, VendorPage } from './fixtures';
import { seedPublishedMarketWithAssignments } from './helpers/seeds';
import {
  calendarToday,
  forgetSignInAttempts,
  signInOnThePage,
  vendorToken,
} from './helpers/vendorSignIn';
import { AttendanceStatusPage } from './pages/AttendanceStatusPage';

/**
 * A vendor checks in on their own vendor page, with the market's door code (T202, ADR 0022).
 *
 * The check-in was a public page at `/<slug>/check-in`: anyone with the market's address typed any
 * vendor's email, read their seats and checked them in or out, so a check-in proved nothing about
 * who was at the door. Now the organizer shows a door code at the entrance; the vendor scans its
 * QR code with their phone's own camera, which opens their vendor page, signs them in if it has to,
 * and checks them in for today. A vendor whose camera will not read it types the code. The old page
 * is gone.
 *
 * Each test seats vendors of its own: the sign-in limits count an address across every market.
 */
const TODAY = calendarToday();

function vendorsOf(name: string) {
  const at = Date.now();
  return [`${name}-a-${at}@example.com`, `${name}-b-${at}@example.com`];
}

/** A market on its days, on `marketDate` (today unless a test says), with `vendors` seated. */
async function aMarketOnItsDay(
  request: Parameters<typeof seedPublishedMarketWithAssignments>[0],
  vendors: string[],
  marketDate = TODAY,
) {
  return seedPublishedMarketWithAssignments(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { marketDate, vendors },
  );
}

/** Make a door code, the first or a new one, over the organizer's API; its address, as a path. */
async function makeDoorCode(
  request: Parameters<typeof seedPublishedMarketWithAssignments>[0],
  marketId: string,
): Promise<{ code: string; path: string }> {
  const made = await request.post(`${BACKEND_URL}/markets/${marketId}/door-code`);
  expect(made.ok(), await made.text()).toBeTruthy();
  const { code, url } = (await made.json()) as { code: string; url: string };
  const at = new URL(url);
  return { code, path: `${at.pathname}${at.search}` };
}

/** A vendor's phone: a browser of its own, signed in as nobody. */
async function aPhone(browser: Browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  return { context, page, vendorPage: new VendorPage(page) };
}

test.beforeEach(() => forgetSignInAttempts());

test('the organizer opens the door code, and a vendor who scans it signed out lands checked in', async ({
  authenticatedPage: ownerPage,
  browser,
  request,
}) => {
  const [vendor] = vendorsOf('scan');
  const seed = await aMarketOnItsDay(request, [vendor]);

  // The organizer puts the door code up at the entrance, from Attendance.
  const attendance = new AttendanceStatusPage(ownerPage);
  await attendance.goto(seed.marketId);
  await attendance.doorCodeButton.click();
  await attendance.doorCodeMake.click();
  const url = await attendance.doorCodeQr.getAttribute('data-url');
  expect(url).toMatch(new RegExp(`/${seed.marketSlug}\\?door=[A-Z0-9]{6}$`));
  const scanned = new URL(url!);

  // The vendor's camera opens it. Signed out, the code waits through the sign-in, off the address.
  const phone = await aPhone(browser);
  await phone.page.goto(`${scanned.pathname}${scanned.search}`);
  await expect(phone.vendorPage.doorCodeHeld).toHaveText(
    "Sign in, and you'll be checked in for today.",
  );
  await expect.poll(() => new URL(phone.page.url()).search).toBe('');
  await signInOnThePage(phone.vendorPage, seed.marketId, vendor);

  await expect(phone.vendorPage.checkedIn).toContainText('Checked in at');
  await expect(phone.vendorPage.todayCard).toContainText('Today');
  // Where they sit, in words, not as a stored seat label.
  await expect(phone.vendorPage.todayCard).toContainText(/a whole table|left half|right half/);
  await expect(phone.vendorPage.todayCard).not.toContainText('(');
  // Used once: a reload checks nobody in again, and draws no notice.
  await phone.page.reload();
  await expect(phone.vendorPage.checkedIn).toBeVisible();
  await expect(phone.vendorPage.checkInNotice).toHaveCount(0);
  await phone.context.close();

  // The roster says how they came.
  await attendance.doorCodeClose.click();
  await attendance.goto(seed.marketId);
  await expect(attendance.status(vendor)).toHaveText(/^Scanned in at \d{1,2}:\d{2}\s[AP]M$/);
});

test('a new door code ends the old one; a vendor types the new one, and undoes a mis-tap', async ({
  browser,
  request,
}) => {
  const [vendor] = vendorsOf('typed');
  const seed = await aMarketOnItsDay(request, [vendor]);
  const old = await makeDoorCode(request, seed.marketId);
  const current = await makeDoorCode(request, seed.marketId);
  expect(current.code).not.toBe(old.code);

  // A poster of the old code checks nobody in.
  const phone = await aPhone(browser);
  await phone.page.goto(old.path);
  await signInOnThePage(phone.vendorPage, seed.marketId, vendor);
  await expect(phone.vendorPage.checkInError).toHaveText(
    "That isn't this market's door code. Check it, or ask at the door.",
  );
  await expect(phone.vendorPage.checkedIn).toHaveCount(0);

  // Typed as a vendor reads it off the poster: in two groups, in lower case.
  const typed = `${current.code.slice(0, 3)} ${current.code.slice(3)}`.toLowerCase();
  await phone.vendorPage.checkInWith(typed);
  await expect(phone.vendorPage.checkedIn).toContainText('Checked in at');

  await phone.vendorPage.undoButton.click();
  await expect(phone.vendorPage.checkedIn).toHaveCount(0);
  await expect(phone.vendorPage.doorCodeInput).toBeVisible();
  await phone.context.close();

  // The server holds what the page says.
  const roster = await request.get(`${BACKEND_URL}/markets/${seed.marketId}/attendance`);
  const { roster: rows } = (await roster.json()) as {
    roster: { vendorEmail: string; checkedInAt: string | null }[];
  };
  expect(rows.find((row) => row.vendorEmail === vendor)?.checkedInAt).toBeNull();
});

test('a scan on a day the vendor has no table says so, and checks nothing in', async ({
  browser,
  request,
}) => {
  const [vendor] = vendorsOf('notoday');
  const seed = await aMarketOnItsDay(request, [vendor], '2099-05-01');
  const { path } = await makeDoorCode(request, seed.marketId);

  const phone = await aPhone(browser);
  await phone.page.goto(path);
  await signInOnThePage(phone.vendorPage, seed.marketId, vendor);

  await expect(phone.vendorPage.checkInNotice).toHaveText(
    'You have no table today, so you are not checked in.',
  );
  await expect(phone.vendorPage.todayCard).toHaveCount(0);
  await expect(phone.vendorPage.otherDays).toContainText('2099');
  await phone.context.close();
});

test('a vendor is shown the seat stored for them, after a swap', async ({ browser, request }) => {
  // Bug 1 (E26/F05/S01): the lookup ran the solver afresh on every request, so a vendor moved by
  // hand was sent to their old seat - now another vendor's - and could check in there.
  const vendors = vendorsOf('swap');
  const seed = await aMarketOnItsDay(request, vendors);
  const stored = async () => {
    const res = await request.get(`${BACKEND_URL}/markets/${seed.marketId}`);
    const { market } = (await res.json()) as {
      market: { assignmentObject: { vendorAssignments: { email: string; tableCode: string }[] } };
    };
    return Object.fromEntries(
      market.assignmentObject.vendorAssignments.map((row) => [row.email, row.tableCode]),
    );
  };
  const before = await stored();
  const swapped = await request.post(`${BACKEND_URL}/markets/${seed.marketId}/placements/swap`, {
    data: { emails: vendors, date: TODAY },
  });
  expect(swapped.ok(), await swapped.text()).toBeTruthy();
  const after = await stored();
  expect(after[vendors[0]]).toBe(before[vendors[1]]);

  const phone = await aPhone(browser);
  await phone.vendorPage.goto(seed.marketSlug);
  await signInOnThePage(phone.vendorPage, seed.marketId, vendors[0]);
  await expect(phone.vendorPage.todayCard).toContainText(after[vendors[0]]);
  await expect(phone.vendorPage.todayCard).not.toContainText(before[vendors[0]]);
  await phone.context.close();
});

test('nobody checks in at the old public check-in page, which is gone', async ({
  page,
  request,
}) => {
  const [vendor] = vendorsOf('gone');
  const seed = await aMarketOnItsDay(request, [vendor]);

  await page.goto(`/${seed.marketSlug}/check-in`);
  await expect(page.getByTestId('page-not-found')).toBeVisible();

  for (const [method, path] of [
    ['get', `/public/markets/${seed.marketSlug}/check-in`],
    ['get', `/public/markets/${seed.marketSlug}/vendors/${vendor}/assignments`],
    ['post', `/public/markets/${seed.marketSlug}/attendance/checkin`],
    ['delete', `/public/markets/${seed.marketSlug}/attendance/checkin`],
  ] as const) {
    const answer = await request[method](`${BACKEND_URL}${path}`, {
      data: { vendorEmail: vendor, date: TODAY },
    });
    expect(answer.status(), `${method} ${path}`).toBe(404);
  }

  // Nor without signing in as the vendor at their own page's.
  const { code } = await makeDoorCode(request, seed.marketId);
  const signedOut = await request.post(
    `${BACKEND_URL}/public/markets/${seed.marketSlug}/vendor/check-in`,
    { data: { date: TODAY, doorCode: code } },
  );
  expect(signedOut.status()).toBe(401);
  const token = await vendorToken(request, BACKEND_URL, seed.marketSlug, seed.marketId, vendor);
  const signedIn = await request.post(
    `${BACKEND_URL}/public/markets/${seed.marketSlug}/vendor/check-in`,
    { data: { date: TODAY, doorCode: code }, headers: { Authorization: `Bearer ${token}` } },
  );
  expect(signedIn.ok(), await signedIn.text()).toBeTruthy();
});
