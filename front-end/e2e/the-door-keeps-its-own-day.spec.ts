import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { seedPublishedMarketWithAssignments } from './helpers/seeds';
import { marketScreenPath } from './helpers/marketScreens';

/**
 * A running market's last day is over on the door's own calendar (E31/F02/S03).
 *
 * Once it is, archiving becomes the rail's step onward. The same instant is still the market's day
 * in Honolulu and already the next in Tokyo; a day read in UTC would have closed a Vancouver
 * market's door at four in the afternoon.
 */
const MARKET_DAY = '2099-05-01';
// 05:00 UTC on 2 May: 7pm on 1 May in Honolulu, 2pm on 2 May in Tokyo.
const THE_INSTANT = new Date('2099-05-02T05:00:00Z');

for (const [timezoneId, over] of [
  ['Pacific/Honolulu', false],
  ['Asia/Tokyo', true],
] as const) {
  test.describe(timezoneId, () => {
    test.use({ timezoneId });

    test(`the last day is ${over ? 'over' : 'still on'}`, async ({
      authenticatedPage: page,
      request,
    }) => {
      const seed = await seedPublishedMarketWithAssignments(
        request,
        BACKEND_URL,
        TEST_USER.email,
        TEST_USER.password,
        { marketDate: MARKET_DAY },
      );
      await page.clock.setFixedTime(THE_INSTANT);
      await page.goto(marketScreenPath(seed.marketId, 'attendance'));

      const archive = page.locator(
        '.rail-button--forward[data-testid="phase-transition-archived"]',
      );
      const next = page.getByTestId('phase-rail-next');
      if (over) {
        await expect(archive).toBeVisible();
        await expect(next).toContainText('The market has run');
      } else {
        await expect(next).toHaveText('Check vendors in at the door.');
        await expect(archive).toHaveCount(0);
      }
    });
  });
}
