import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { seedPublishedMarketWithAssignments } from './helpers/seeds';
import { pdfPagesText } from './helpers/pdfText';
import { calendarToday } from './helpers/vendorSignIn';
import { AttendanceStatusPage } from './pages/AttendanceStatusPage';

/**
 * The door's roster prints whole (T318).
 *
 * Paper is the door's only fallback when the venue's network or the back end fails, and nothing
 * prompted the organizer to keep one. Attendance now asks for it before each day still to be run,
 * and "Print roster" prints a sheet of every vendor of the chosen date by table, with a box to
 * tick, in place of the app and whatever the filter and the search on screen leave out.
 */
const TODAY = calendarToday();

test('the printed roster is every vendor of the day, alone on the paper and its width', async ({
  authenticatedPage: page,
  request,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const at = Date.now();
  const vendors = [
    `print-a-${at}@example.com`,
    `print-b-${at}@example.com`,
    `print-c-a-much-longer-address-than-most-${at}@example.com`,
  ];
  const seed = await seedPublishedMarketWithAssignments(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { marketDate: TODAY, vendors, namePrefix: 'E2E Roster Print' },
  );
  const checkedIn = await request.post(`${BACKEND_URL}/markets/${seed.marketId}/attendance`, {
    data: { vendorEmail: vendors[0], date: TODAY },
  });
  expect(checkedIn.ok(), await checkedIn.text()).toBeTruthy();

  const door = new AttendanceStatusPage(page);
  await door.goto(seed.marketId);
  await expect(door.rows).toHaveCount(3);
  await expect(door.printNote).toHaveText(
    "If the venue's network fails, a printed roster still works. Print this day's roster before the doors open.",
  );
  await expect(door.print).toHaveText('Print roster');
  await expect(door.printSheet).toBeHidden();

  // A filter and a search on: the screen shows one vendor, the paper all three.
  await door.show('not-yet');
  await door.search.fill(vendors[1]!);
  await expect(door.rows).toHaveCount(1);

  await page.emulateMedia({ media: 'print' });
  await expect(door.printSheet).toBeVisible();
  await expect(page.locator('#app')).toBeHidden();
  await expect(door.printRows).toHaveCount(3);
  for (const vendor of vendors) {
    await expect(door.printRows.filter({ hasText: vendor })).toHaveCount(1);
  }
  await expect(page.getByTestId('attendance-print-market')).toHaveText(seed.marketName);
  await expect(page.getByTestId('attendance-print-count')).toHaveText('3 vendors');
  await expect(page.getByTestId('attendance-print-box')).toHaveCount(2);

  // The sheet is the paper's width and no wider: nothing runs off its edge.
  const fits = await page.evaluate(() => {
    const sheet = document.querySelector('[data-testid="attendance-print-sheet"]')!;
    const right = sheet.getBoundingClientRect().right;
    const overruns = [...sheet.querySelectorAll('*')].filter(
      (el) => el.getBoundingClientRect().right > right + 0.5 || el.scrollWidth > el.clientWidth,
    );
    return {
      page: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      overruns: overruns.map((el) => el.outerHTML.slice(0, 80)),
    };
  });
  expect(fits).toEqual({ page: true, overruns: [] });

  // On paper too the sheet is all there is: its first page opens on the market's name.
  const name = seed.marketName.replace(/\s/g, '');
  for (const format of ['Letter', 'A4']) {
    const pages = pdfPagesText(await page.pdf({ format }));
    expect(pages[0]!.slice(0, name.length), `${format}'s first page`).toBe(name);
    expect(pages[0], `${format}'s first page`).toContain(vendors[2]);
  }
  await page.emulateMedia({ media: 'screen' });
  await expect(door.printSheet).toBeHidden();
});
