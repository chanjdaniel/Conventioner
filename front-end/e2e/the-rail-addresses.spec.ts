import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { seedPublishedMarketWithAssignments } from './helpers/seeds';
import { transitionMarket } from './helpers/seedPhaseMarket';
import { marketScreenPath } from './helpers/marketScreens';

/**
 * The rail's public addresses read in full and point at the right page (E30/F01/S03).
 *
 * A form market on its market days carries two - the application page and the check-in page - and
 * each shrank the other to "localhost:5…". Once archived, it kept the application page and dropped
 * the check-in page, the reverse of what its archive dialog promises stays up.
 */
test.describe("The rail's addresses", () => {
  test('read whole on a running form market, and the record stays once archived', async ({
    authenticatedPage: page,
    request,
  }) => {
    const seed = await seedPublishedMarketWithAssignments(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
      { intakeMode: 'form', marketDate: '2099-05-03' },
    );
    const apply = page.getByTestId('phase-rail-apply');
    const checkIn = page.getByTestId('phase-rail-checkin');

    for (const width of [1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(marketScreenPath(seed.marketId, 'attendance'));
      for (const chip of [apply, checkIn]) {
        await expect(chip).toBeVisible();
        const link = chip.locator('a');
        const cut = await link.evaluate((a) => a.scrollWidth > a.clientWidth);
        expect(cut, `${await link.textContent()} is cut off at ${width}px`).toBe(false);
      }
    }

    await transitionMarket(request, BACKEND_URL, TEST_USER.email, seed.marketId, 'archived');
    await page.goto(marketScreenPath(seed.marketId, 'assignments'));
    await expect(checkIn.locator('a')).toHaveAttribute('href', /\/check-in$/);
    await expect(apply).toHaveCount(0);
  });
});
