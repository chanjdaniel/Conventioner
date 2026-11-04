import type { Locator, Page } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { SEED_MARKET_DATE, seedPublishedMarketWithAssignments } from './helpers/seeds';
import { ensureVerifiedUser } from './helpers/verifiedUser';
import { AttendanceStatusPage } from './pages/AttendanceStatusPage';
import { LoginPage } from './pages/LoginPage';

/**
 * A Viewer at the door reads why they cannot check vendors in (E38/F15/S04).
 *
 * Before the market is published the Attendance tab's note stands in for its page, and the
 * read-only line is left out under it, which a walk took for the line missing. In Market Days the
 * door is the page, so a Viewer reads the line there as on every other page, and is offered no
 * Check in and no Undo, on a phone at the door as at a desk.
 *
 * Two things looked off beside it, for the same role on the same screen: the rail told the Viewer
 * "Check vendors in at the door.", and at a desk each row kept the empty column a Check in stands in,
 * so its status stopped short of the row's edge. An Editor, who checks vendors in, keeps both.
 */
const VIEWER = { email: 'e2e-door-viewer@example.com', password: 'e2epassword123' };
const EDITOR = { email: 'e2e-door-editor@example.com', password: 'e2epassword123' };
const HERE = 'alice@example.com';
const NOT_YET = 'bob@example.com';

const SIZES = [
  {
    name: 'on a phone',
    use: {
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 3,
    },
  },
  { name: 'at a desk', use: { viewport: { width: 1440, height: 900 } } },
] as const;

let marketId: string;

/** px between a box's right edge and the right edge of the row's content, inside its padding. */
async function shortOfTheRowsEnd(row: Locator, inside: Locator): Promise<number> {
  const rowBox = await row.boundingBox();
  const box = await inside.boundingBox();
  expect(rowBox, 'the row is drawn').not.toBeNull();
  expect(box, 'the box is drawn').not.toBeNull();
  const padding = await row.evaluate((el) => {
    const style = getComputedStyle(el);
    return parseFloat(style.paddingRight) + parseFloat(style.borderRightWidth);
  });
  return Math.round(rowBox!.x + rowBox!.width - padding - (box!.x + box!.width));
}

/**
 * A vendor's address on their row is whole, on one line. On a phone the status shared a column with
 * the action, so a wide one ("9:44 AM by e2e@example.com") squeezed the vendor's line and broke the
 * address mid-word, for a Viewer as for an Editor (E38/F15/S04).
 */
async function expectAddressWhole(row: Locator, vendor: string): Promise<void> {
  const address = row.getByTestId('vendor-identity-email');
  await expect(address).toHaveText(vendor);
  const lines = await address.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
  });
  expect(lines, `${vendor}'s address is on one line`).toBe(1);
}

/** Signed in on the test's own page, so the size the test uses is the window the door is drawn in. */
async function signIn(page: Page, person: { email: string; password: string }, width: number) {
  const login = new LoginPage(page);
  await login.login(person.email, person.password);
  await login.waitForMarkets();
  expect(await page.evaluate(() => window.innerWidth)).toBe(width);
}

test.beforeAll(async ({ request }) => {
  ensureVerifiedUser(VIEWER.email, VIEWER.password);
  ensureVerifiedUser(EDITOR.email, EDITOR.password);
  ({ marketId } = await seedPublishedMarketWithAssignments(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  ));
  // The seed leaves the owner's session on `request`: they give each person their role, and check
  // one vendor in, so the door has a row an Undo would stand on.
  for (const [person, role] of [
    [VIEWER, 'viewer'],
    [EDITOR, 'editor'],
  ] as const) {
    const res = await request.post(`${BACKEND_URL}/markets/${marketId}/roles`, {
      data: { user_email: person.email, role },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
  }
  const checkIn = await request.post(`${BACKEND_URL}/markets/${marketId}/attendance`, {
    data: { vendorEmail: HERE, date: SEED_MARKET_DATE },
  });
  expect(checkIn.ok(), await checkIn.text()).toBeTruthy();
});

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use(size.use);

    const width = size.use.viewport.width;

    test('a Viewer reads the read-only line at the door, and is offered no check-in', async ({
      page,
    }) => {
      await signIn(page, VIEWER, width);
      const door = new AttendanceStatusPage(page);
      await door.goto(marketId);
      await expect(door.row(NOT_YET)).toBeVisible({ timeout: 15000 });
      await expect(door.row(HERE)).toBeVisible();
      await expect(door.status(HERE)).not.toHaveText('Not yet');

      await expect(door.readOnly).toHaveCount(1);
      await expect(door.readOnly).toBeVisible();
      await expect(door.readOnly).toContainText('You can view this market but not change it.');
      // No tab's note stands in for the door once the market is published.
      await expect(page.getByTestId('market-tab-note')).toHaveCount(0);

      await expect(door.checkIns).toHaveCount(0);
      await expect(door.undos).toHaveCount(0);

      // The rail says what a Viewer may do at the door, and leaves the rest to the line above.
      await expect(page.getByTestId('phase-rail-next')).toHaveText(
        'Follow who has checked in at the door.',
      );

      // Each status ends its row, with no empty column beside it, and each address is whole.
      for (const vendor of [HERE, NOT_YET]) {
        await expectAddressWhole(door.row(vendor), vendor);
        expect(
          await shortOfTheRowsEnd(door.row(vendor), door.status(vendor)),
          `${vendor}'s status ends the row`,
        ).toBeLessThanOrEqual(1);
      }
    });

    test('an Editor is told to check vendors in, and each row ends in its Check in or Undo', async ({
      page,
    }) => {
      await signIn(page, EDITOR, width);
      const door = new AttendanceStatusPage(page);
      await door.goto(marketId);
      await expect(door.row(NOT_YET)).toBeVisible({ timeout: 15000 });

      await expect(door.readOnly).toHaveCount(0);
      await expect(page.getByTestId('phase-rail-next')).toHaveText('Check vendors in at the door.');

      const checkIn = door.row(NOT_YET).getByTestId('attendance-check-in');
      const undo = door.row(HERE).getByTestId('attendance-undo');
      await expect(checkIn).toBeVisible();
      await expect(undo).toBeVisible();
      // At a desk the action has its column at the row's end, the status left of it; on a phone the
      // action is on the vendor's line and the status under it, at the end of each.
      for (const [vendor, action] of [
        [NOT_YET, checkIn],
        [HERE, undo],
      ] as const) {
        const row = door.row(vendor);
        await expectAddressWhole(row, vendor);
        expect(
          await shortOfTheRowsEnd(row, action),
          `${vendor}'s action ends the row`,
        ).toBeLessThanOrEqual(1);
        const status = await door.status(vendor).boundingBox();
        const button = await action.boundingBox();
        if (width > 640) expect(status!.x + status!.width).toBeLessThan(button!.x);
        else expect(status!.y).toBeGreaterThan(button!.y);
      }
    });
  });
}
