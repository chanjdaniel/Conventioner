import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { expectWholeAddress } from './helpers/addressBreaks';
import {
  detectLayout,
  gates,
  minTargetAt,
  SPACE_SCALE,
  TYPE_SCALE,
} from './helpers/layoutDetectors';
import { inTheWindow, PHONE_AND_DESK } from './helpers/phoneWindow';
import { seedPublishedMarketWithAssignments } from './helpers/seeds';
import { calendarToday } from './helpers/vendorSignIn';
import { AttendanceStatusPage } from './pages/AttendanceStatusPage';

/**
 * The door on whichever device stands at the entrance (T318): a phone in the organizer's hand, a
 * tablet on the table, a laptop at the desk.
 *
 * At each, an organizer checks a vendor in and undoes it, reads when the roster was read and reads
 * it again, sees the note asking for a printed roster and Print roster, and reads a vendor here at
 * another table than the one they hold and one here with no table at all, with nothing scrolling
 * sideways, every target a thumb's 44px on the phone, and no address broken mid-word.
 *
 * 768 is no width the app lays out for by name: Attendance fits a phone, so a tablet takes the phone
 * rules or the desk's. Its row takes the phone's: the desk's four columns, at 768, left the vendor a
 * third of the row, and their address broke inside its domain.
 */
const TODAY = calendarToday();
const at = Date.now();
/** Checked in and undone in the walk. */
const COMES = `door-comes-${at}@example.com`;
/** Checked in, then moved to the seat freed below: here, at another table. */
const MOVED = `door-moved-${at}@example.com`;
/** Checked in, then freed: here, with no table. */
const FREED = `door-freed-${at}@example.com`;
/** Never comes. */
const WAITING = `door-waiting-${at}@example.com`;

/** Each window, and the row layout the door gives it: a phone's (two columns) or a desk's (four). */
const THREE_WINDOWS = [
  { ...PHONE_AND_DESK[0], rows: 2 },
  {
    name: 'on a tablet',
    phone: false,
    use: {
      viewport: { width: 768, height: 1024 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    },
    rows: 2,
  },
  { ...PHONE_AND_DESK[1], rows: 4 },
] as const;

type Seat = { vendorEmail: string; tableCode: string | null; tableChoice: string | null };

async function seatsOf(request: APIRequestContext, marketId: string): Promise<Seat[]> {
  const res = await request.get(`${BACKEND_URL}/markets/${marketId}/attendance`);
  expect(res.ok(), await res.text()).toBeTruthy();
  return ((await res.json()) as { roster: Seat[] }).roster;
}

async function ok(response: Promise<{ ok(): boolean; text(): Promise<string> }>, what: string) {
  const res = await response;
  expect(res.ok(), `${what}: ${await res.text()}`).toBeTruthy();
}

/**
 * A market on its day, today, with one vendor here at another table than theirs and one here with
 * no table: each checked in at the door, then moved or freed with "anyway", as an organizer would.
 */
async function seedTheDoor(
  request: APIRequestContext,
): Promise<{ marketId: string; movedFrom: string }> {
  const { marketId } = await seedPublishedMarketWithAssignments(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    {
      marketDate: TODAY,
      intakeMode: 'form',
      vendors: [COMES, MOVED, FREED, WAITING],
      namePrefix: 'E2E Door Widths',
    },
  );
  const attendance = `${BACKEND_URL}/markets/${marketId}/attendance`;
  for (const vendorEmail of [MOVED, FREED]) {
    await ok(request.post(attendance, { data: { vendorEmail, date: TODAY } }), 'check in');
  }
  const seats = await seatsOf(request, marketId);
  const seatOf = (email: string) => seats.find((row) => row.vendorEmail === email)!;
  const freedSeat = seatOf(FREED);
  const placements = `${BACKEND_URL}/markets/${marketId}/placements`;
  await ok(
    request.delete(placements, { data: { email: FREED, date: TODAY, whileHere: true } }),
    'free anyway',
  );
  await ok(
    request.put(placements, {
      data: {
        email: MOVED,
        date: TODAY,
        tableCode: freedSeat.tableCode,
        tableChoice: freedSeat.tableChoice,
        whileHere: true,
      },
    }),
    'move anyway',
  );
  return { marketId, movedFrom: seatOf(MOVED).tableCode! };
}

/** The layout sweep's gating findings on the page as it stands: none, the phone's 44px included. */
async function expectNoLayoutFault(page: Page, what: string): Promise<void> {
  const width = page.viewportSize()!.width;
  const findings = await page.evaluate(detectLayout, {
    spaceScale: SPACE_SCALE,
    textScale: TYPE_SCALE,
    minTarget: minTargetAt(width),
  });
  expect(
    findings.filter((finding) => gates(finding, width)),
    what,
  ).toEqual([]);
}

/**
 * A row scrolled to the window's middle, so the whole of it is in view: brought only as far as its
 * edge, it rested a fraction of a pixel past the window's foot.
 */
const toTheMiddle = (row: Locator) =>
  row.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));

/** The number of columns a row's grid lays out: four at a desk, two on a phone. */
const columnsOf = (page: Page, email: string) =>
  new AttendanceStatusPage(page)
    .row(email)
    .evaluate((row) => getComputedStyle(row).gridTemplateColumns.split(' ').length);

for (const size of THREE_WINDOWS) {
  test.describe(size.name, () => {
    test.use(size.use);
    const { expectFits, expectInside, press } = inTheWindow(size);

    test('checks a vendor in and out, reads the roster again, and says where each vendor stands', async ({
      authenticatedPage: page,
      request,
    }) => {
      const { marketId, movedFrom } = await seedTheDoor(request);
      const door = new AttendanceStatusPage(page);
      await door.goto(marketId);
      await expect(door.rows).toHaveCount(4);

      // Where each stands: three seats today, and the vendor freed while here under them.
      await expect(door.status(MOVED)).toHaveText(
        new RegExp(`^\\d{1,2}:\\d{2}\\s[AP]M by you, at table ${movedFrom}$`),
      );
      await expect(door.status(MOVED)).toHaveClass(/chip--attention/);
      await expect(door.unseatedHeading).toHaveText('Checked in, with no table on this date (1)');
      await expect(
        page.getByTestId('attendance-list-unseated').getByTestId('attendance-row'),
      ).toHaveCount(1);
      await expect(door.table(FREED)).toHaveText('No table');
      await expect(door.status(FREED)).toHaveClass(/chip--attention/);
      await expect(door.row(FREED).getByTestId('attendance-undo')).toBeVisible();
      await expect(door.summary).toHaveText('1 of 3 checked in');

      // When the roster was read, and Refresh reads it again.
      await expect(door.updated).toHaveText('Updated just now');
      const reread = page.waitForResponse(
        (res) =>
          res.request().method() === 'GET' && res.url().endsWith(`/markets/${marketId}/attendance`),
      );
      await press(door.refresh);
      expect((await reread).ok()).toBeTruthy();
      await expect(door.updated).toHaveText('Updated just now');
      await expect(door.refreshError).toHaveCount(0);

      // The note asking for paper, and Print roster beside the door code.
      await expect(door.printNote).toContainText('a printed roster still works');
      await expect(door.print).toHaveText('Print roster');
      for (const [control, what] of [
        [door.print, 'Print roster'],
        [door.doorCodeButton, 'Door code'],
        [door.refresh, 'Refresh'],
        [door.printNote, 'the print note'],
      ] as const) {
        await expectInside(control, what);
      }

      // The page as it is, and every row in the window, its address whole.
      await expectFits(page, 'the door');
      await expectNoLayoutFault(page, 'the door');
      for (const email of [COMES, MOVED, FREED, WAITING]) {
        await toTheMiddle(door.row(email));
        await expectInside(door.row(email), `${email}'s row`);
        await expectWholeAddress(door.vendor(email), email);
      }
      // The phone's rows or the desk's: a tablet's row is too narrow for the desk's four columns.
      expect(await columnsOf(page, COMES), 'the row layout').toBe(size.rows);

      // A check-in and its undo, the row saying each.
      await toTheMiddle(door.row(COMES));
      await press(door.row(COMES).getByTestId('attendance-check-in'));
      await expect(door.status(COMES)).toHaveText(/^\d{1,2}:\d{2}\s[AP]M by you$/);
      await expect(door.status(COMES)).toHaveClass(/chip--positive/);
      await expect(door.summary).toHaveText('2 of 3 checked in');
      await expectInside(door.row(COMES), 'the row checked in');
      await expectFits(page, 'the door, a vendor checked in');
      await expectNoLayoutFault(page, 'the door, a vendor checked in');

      await press(door.row(COMES).getByTestId('attendance-undo'));
      await expect(door.status(COMES)).toHaveText('Not yet');
      await expect(door.row(COMES).getByTestId('attendance-check-in')).toBeEnabled();
      await expect(door.summary).toHaveText('1 of 3 checked in');
      await expectInside(door.row(COMES), 'the row undone');
      await expectFits(page, 'the door, the check-in undone');
    });
  });
}
