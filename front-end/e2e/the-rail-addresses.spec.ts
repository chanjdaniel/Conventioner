import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { seedPublishedMarketWithAssignments } from './helpers/seeds';
import { transitionMarket } from './helpers/seedPhaseMarket';
import { marketScreenPath } from './helpers/marketScreens';

/**
 * The rail's public addresses read in full and point at the right page (E30/F01/S03).
 *
 * A form market on its market days carries two - the vendor page and the check-in page - and each
 * once shrank the other to "localhost:5…". Once archived, it dropped the check-in page, the reverse
 * of what its archive dialog promises stays up; a market that ran keeps both.
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
    const vendorPage = page.getByTestId('phase-rail-vendor-page');
    const checkIn = page.getByTestId('phase-rail-checkin');

    for (const width of [1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(marketScreenPath(seed.marketId, 'attendance'));
      for (const chip of [vendorPage, checkIn]) {
        await expect(chip).toBeVisible();
        const link = chip.locator('a');
        const cut = await link.evaluate((a) => a.scrollWidth > a.clientWidth);
        expect(cut, `${await link.textContent()} is cut off at ${width}px`).toBe(false);
      }
    }

    await transitionMarket(request, BACKEND_URL, TEST_USER.email, seed.marketId, 'archived');
    await page.goto(marketScreenPath(seed.marketId, 'assignments'));
    await expect(checkIn.locator('a')).toHaveAttribute('href', /\/check-in$/);
    // A market that ran keeps its vendor page: where its vendors read where they sat (ADR 0022).
    await expect(vendorPage.locator('a')).toHaveAttribute(
      'href',
      new RegExp(`/${seed.marketSlug}$`),
    );
  });
});
