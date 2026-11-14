import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { seedPublishedMarketWithAssignments } from './helpers/seeds';
import { calendarToday } from './helpers/vendorSignIn';
import { PHONE_AND_DESK, widths } from './helpers/phoneWindow';
import { AttendanceStatusPage } from './pages/AttendanceStatusPage';
import { TablesPage } from './pages/TablesPage';

/**
 * Freeing a vendor who has checked in that day asks first (T318).
 *
 * A free of a vendor already at their table went ahead with no question, so an organizer could take
 * the table from someone set up at it by mistake. Now the server asks, and the seat's dialog says
 * who checked in, at which table and for which day, with "Free anyway" beside Cancel. Going ahead
 * frees the seat and keeps the check-in, so the roster lists the vendor as here with no table, and
 * the market's history says the free was made while they were checked in.
 *
 * At a desk and on a phone, where the seat's dialog must fit the window. The market is on today: the
 * door takes no check-in for a day that has not begun.
 */
const ON_THE_DAY = calendarToday();
const ALICE = 'alice@example.com';
/** The name the seed gives her application, which the sentence names her by. */
const ALICE_NAME = 'Alice Example';

/** A market date as the server's sentence says it: "Nov 14, 2026". */
function dayInWords(date: string): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

for (const size of PHONE_AND_DESK) {
  test.describe(size.name, () => {
    test.use(size.use);

    test('freeing a vendor who is here asks first, then the roster lists them with no table', async ({
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
      await attendance.checkIn(ALICE);
      await expect(attendance.status(ALICE)).toHaveText(/by you$/);
      // The table the server seats them at, as the dialog's sentence names it.
      const roster = await request.get(`${BACKEND_URL}/markets/${seed.marketId}/attendance`);
      const rows = (
        (await roster.json()) as { roster: { vendorEmail: string; tableCode: string }[] }
      ).roster;
      const tableCode = rows.find((row) => row.vendorEmail === ALICE)!.tableCode;

      const tables = new TablesPage(page);
      await tables.goto(seed.marketId);
      await tables.change(tables.seatIn(tableCode, ALICE));
      await tables.dialog.getByTestId('placement-dialog-free').click();

      // Asked, with nothing freed: the server's sentence, and Cancel first, as a destructive
      // question opens.
      const question = tables.dialog.getByTestId('placement-dialog-here');
      await expect(question).toHaveText(
        `${ALICE_NAME} checked in at table ${tableCode} for ${dayInWords(ON_THE_DAY)}. ` +
          'Their check-in stays recorded there.',
      );
      const anyway = tables.dialog.getByTestId('placement-dialog-anyway');
      await expect(anyway).toHaveText('Free anyway');
      await expect(tables.dialog.getByTestId('placement-dialog-cancel')).toBeFocused();
      await expect(tables.dialog.getByTestId('placement-dialog-free')).toHaveCount(0);
      await expect(tables.dialogError).toBeHidden();

      // The dialog fits the window, its question and both buttons in view.
      const window = await tables.dialog.boundingBox();
      expect(window, 'the dialog is drawn').not.toBeNull();
      expect(window!.x).toBeGreaterThanOrEqual(0);
      expect(window!.x + window!.width).toBeLessThanOrEqual(size.use.viewport.width);
      await expect(question).toBeInViewport();
      await expect(anyway).toBeInViewport();
      expect((await widths(page)).sideways, 'nothing scrolls sideways').toBe(0);

      await anyway.click();
      await expect(tables.dialog).toBeHidden();
      await expect(tables.seatIn(tableCode, ALICE)).toHaveCount(0);

      await tables.openHistory();
      await expect(tables.historySentences.first()).toContainText(`freed ${tableCode}, leaving`);
      await expect(tables.historySentences.first()).toContainText(', while they were checked in');
      await page.keyboard.press('Escape');

      await attendance.goto(seed.marketId);
      await expect(attendance.unseatedHeading).toHaveText(
        'Checked in, with no table on this date (1)',
      );
      await expect(attendance.table(ALICE)).toHaveText('No table');
      await expect(attendance.status(ALICE)).toHaveText(/by you$/);
    });
  });
}
