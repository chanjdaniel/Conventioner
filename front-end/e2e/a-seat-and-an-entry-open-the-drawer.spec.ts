import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import type { Locator } from '@playwright/test';
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
 *
 * And the name says so at rest (E38/F09/S01): in the design language's link ink, underlined, with
 * nothing pointed at it, since a phone at the door points at nothing.
 */
const ON_THE_DAY = '2099-05-02';

/** `--mm-text-link`, as the browser computes it. */
const LINK_INK = 'rgb(26, 111, 139)';

/** A vendor's name reads as a link with nothing pointed at it: link ink, underlined. */
async function expectReadsAsALink(name: Locator): Promise<void> {
  const line = name.getByTestId('vendor-identity-name');
  await expect(line).toHaveCSS('color', LINK_INK);
  await expect(line).toHaveCSS('text-decoration-line', 'underline');
}

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
  await expectReadsAsALink(seat.getByTestId('tables-seat-vendor'));

  // One click on the name: their drawer, and no placement dialog.
  await tables.openVendor(seat);
  await expect(page.getByTestId('vendors-detail-panel')).toBeVisible();
  await expect(page.getByTestId('vendors-detail-email')).toHaveText(email);
  await expect(tables.dialog).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('vendors-detail-close')).toBeHidden();

  // The seat's change is its own control, and its dialog leads to the vendor too.
  await tables.change(seat);
  await expect(tables.dialog).toBeVisible();
  await page.getByTestId('placement-dialog-view-vendor').click();
  await expect(tables.dialog).toBeHidden();
  await expect(page.getByTestId('vendors-detail-email')).toHaveText(email);
});

test.describe('at the door, on a phone', () => {
  test.use({ hasTouch: true });

  test('a name at the door reads as a link, opens the drawer by tap, never checks in, and a first note shows on the row', async ({
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

    // At a phone's width the name reads as a link, is a thumb's target, and it and the check-in are
    // two targets, apart.
    const name = attendance.vendor('bob@example.com');
    await expectReadsAsALink(name);
    const checkIn = bob.getByTestId('attendance-check-in');
    const [nameBox, checkInBox] = [await name.boundingBox(), await checkIn.boundingBox()];
    expect(nameBox && checkInBox).toBeTruthy();
    const apart =
      nameBox!.x + nameBox!.width <= checkInBox!.x ||
      checkInBox!.x + checkInBox!.width <= nameBox!.x ||
      nameBox!.y + nameBox!.height <= checkInBox!.y ||
      checkInBox!.y + checkInBox!.height <= nameBox!.y;
    expect(apart, 'the name and the check-in do not overlap').toBe(true);
    expect(nameBox!.height, 'the name is a 44px target').toBeGreaterThanOrEqual(44);

    await name.tap();
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
});

test('a name at the door reads as a link at a desk, with nothing pointed at it', async ({
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
  await page.setViewportSize({ width: 1440, height: 900 });
  await attendance.goto(seed.marketId);
  const name = attendance.vendor('bob@example.com');
  await expect(name).toBeVisible({ timeout: 10000 });
  await expectReadsAsALink(name);

  await name.click();
  await expect(page.getByTestId('vendors-detail-email')).toHaveText('bob@example.com');
});
