import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { seedPublishedMarketWithAssignments } from './helpers/seeds';
import { transitionMarket } from './helpers/seedPhaseMarket';
import { marketScreenPath } from './helpers/marketScreens';

/**
 * The rail's public address reads in full and points at the right page (E30/F01/S03).
 *
 * A form market on its market days carried two - the vendor page and the check-in page - and each
 * once shrank the other to "localhost:5…"; archived, it dropped the check-in page, the reverse of
 * what its archive dialog promised stays up. The check-in page is gone (ADR 0022): its vendors
 * check in on the vendor page, the one address, which a market that ran keeps.
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

    for (const width of [1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(marketScreenPath(seed.marketId, 'attendance'));
      await expect(page.getByTestId('phase-rail-checkin')).toHaveCount(0);
      for (const chip of [vendorPage]) {
        await expect(chip).toBeVisible();
        const link = chip.locator('a');
        const cut = await link.evaluate((a) => a.scrollWidth > a.clientWidth);
        expect(cut, `${await link.textContent()} is cut off at ${width}px`).toBe(false);
      }
    }

    await transitionMarket(request, BACKEND_URL, TEST_USER.email, seed.marketId, 'archived');
    await page.goto(marketScreenPath(seed.marketId, 'assignments'));
    // A market that ran keeps its vendor page: where its vendors read where they sat (ADR 0022).
    await expect(vendorPage.locator('a')).toHaveAttribute(
      'href',
      new RegExp(`/${seed.marketSlug}$`),
    );
  });
});
