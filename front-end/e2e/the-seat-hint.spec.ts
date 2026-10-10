import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { seedPublishedMarketWithAssignments } from './helpers/seeds';
import { TablesPage } from './pages/TablesPage';
import type { Locator } from '@playwright/test';

/**
 * A seat's hint sits in its top right corner (E28/F04/S01).
 *
 * "Change" floated just right of the occupant, so it moved with the length of their email; an
 * empty seat was 36px tall beside a 56px occupied one; and a whole-table occupant's name was meant
 * to be bold but was not, because weight does not inherit under the global reset.
 */
async function hintGeometry(seat: Locator) {
  await seat.hover();
  return seat.evaluate((button) => {
    const box = button.getBoundingClientRect();
    const style = getComputedStyle(button);
    const hint = button.querySelector('.seat-button-hint')!.getBoundingClientRect();
    const first = (button.querySelector('.vendor-identity-name') ??
      button.querySelector('span'))!.getBoundingClientRect();
    return {
      height: box.height,
      contentRight: box.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight),
      hintRight: hint.right,
      hintBottom: hint.bottom,
      firstLineBottom: first.top + 14 * 1.2,
      hintOpacity: getComputedStyle(button.querySelector('.seat-button-hint')!).opacity,
    };
  });
}

test('the hint sits top right on every seat, and every seat is one height', async ({
  authenticatedPage: page,
  request,
}) => {
  const seed = await seedPublishedMarketWithAssignments(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  await page.setViewportSize({ width: 1920, height: 1080 });
  const tablesPage = new TablesPage(page);
  await tablesPage.goto(seed.marketId);

  const occupied = page.getByTestId('tables-seat-occupied');
  const empty = page.getByTestId('tables-seat-empty');
  await expect(occupied.first()).toBeVisible({ timeout: 10000 });

  const seats = [occupied.first(), occupied.last(), empty.first()];
  const geometry = [];
  for (const seat of seats) geometry.push(await hintGeometry(seat));

  for (const g of geometry) {
    expect(g.hintOpacity, 'shown on hover').toBe('1');
    expect(Math.abs(g.hintRight - g.contentRight), 'at the right padding edge').toBeLessThan(1);
    expect(Math.abs(g.hintBottom - g.firstLineBottom), 'level with the first line').toBeLessThan(5);
  }
  expect(new Set(geometry.map((g) => Math.round(g.height))).size, 'one height').toBe(1);

  // The whole-table occupant's name is bold.
  const weight = await occupied
    .first()
    .locator('.vendor-identity-name')
    .evaluate((el) => getComputedStyle(el).fontWeight);
  expect(weight).toBe('600');
});
