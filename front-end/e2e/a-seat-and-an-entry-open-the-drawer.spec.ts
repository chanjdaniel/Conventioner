import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { seedPublishedMarketWithAssignments } from './helpers/seeds';
import { AttendanceStatusPage } from './pages/AttendanceStatusPage';
import { TablesPage } from './pages/TablesPage';

/**
 * A seat and an attendance entry open the vendor drawer (E35/F01/S02).
 *
 * The vendor drawer opened only from the Vendors list, so an organizer looking at a table on the
 * Result page, or at a name at the door, went to another page and searched to learn who it was.
 * The name opens it now, one click, and a seat's change and the door's check-in stay their own
 * controls: opening the drawer never moves or checks in anybody.
 */
const ON_THE_DAY = '2099-05-02';

test('a vendor on a table opens their drawer, from the seat and from its dialog', async ({
  authenticatedPage: page,
  request,
}) => {
  const seed = await seedPublishedMarketWithAssignments(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  const tables = new TablesPage(page);
  await tables.goto(seed.marketId);

  const seat = page.getByTestId('tables-seat-occupied').first();
  await expect(seat).toBeVisible({ timeout: 10000 });
  const email = await tables.occupantOf(seat);

  // One click on the name: their drawer, and no placement dialog.
  await seat.getByTestId('tables-seat-vendor').click();
  await expect(page.getByTestId('vendors-detail-panel')).toBeVisible();
  await expect(page.getByTestId('vendors-detail-email')).toHaveText(email);
  await expect(tables.dialog).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('vendors-detail-close')).toBeHidden();

  // The seat's change is its own control, and its dialog leads to the vendor too.
  await seat.getByTestId('tables-seat-change').click();
  await expect(tables.dialog).toBeVisible();
  await page.getByTestId('placement-dialog-view-vendor').click();
  await expect(tables.dialog).toBeHidden();
  await expect(page.getByTestId('vendors-detail-email')).toHaveText(email);
});

test('a name at the door opens the drawer, never checks in, and a first note shows on the row', async ({
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
  await page.setViewportSize({ width: 390, height: 844 });
  await attendance.goto(seed.marketId);
  const bob = attendance.row('bob@example.com');
  await expect(bob).toBeVisible({ timeout: 10000 });

  // At a phone's width the name and the check-in are two targets, apart.
  const name = bob.getByTestId('attendance-vendor');
  const checkIn = bob.getByTestId('attendance-check-in');
  const [nameBox, checkInBox] = [await name.boundingBox(), await checkIn.boundingBox()];
  expect(nameBox && checkInBox).toBeTruthy();
  const apart =
    nameBox!.x + nameBox!.width <= checkInBox!.x ||
    checkInBox!.x + checkInBox!.width <= nameBox!.x ||
    nameBox!.y + nameBox!.height <= checkInBox!.y ||
    checkInBox!.y + checkInBox!.height <= nameBox!.y;
  expect(apart, 'the name and the check-in do not overlap').toBe(true);

  await name.click();
  await expect(page.getByTestId('vendors-detail-email')).toHaveText('bob@example.com');
  await expect(attendance.status('bob@example.com')).toHaveText('Not yet');

  // No note yet, so the row shows none; one written in the drawer shows under the row.
  await expect(bob.getByTestId('attendance-notes-bob@example.com')).toHaveCount(0);
  await page.getByTestId('vendors-detail-notes-note-input').fill('Brings their own tent');
  const saved = page.waitForResponse(
    (r) => r.url().includes('/vendor-notes/') && r.request().method() === 'PUT',
  );
  await page.getByTestId('vendors-detail-notes-note-save').click();
  expect((await saved).ok()).toBeTruthy();
  await page.keyboard.press('Escape');
  await expect(bob.getByTestId('attendance-notes-bob@example.com-note-input')).toHaveValue(
    'Brings their own tent',
  );
  await expect(attendance.status('bob@example.com')).toHaveText('Not yet');
});
