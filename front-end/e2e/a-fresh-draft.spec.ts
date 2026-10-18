import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { seedDraftMarket } from './helpers/seedDraftMarket';
import { marketScreenPath } from './helpers/marketScreens';

/**
 * A market as the create dialog leaves it - a name and an organization, no plan - opened on every
 * page its Assignment tab holds (E30/F01/S01). Result and Vendors answered "Internal server error":
 * the tables and statistics endpoints refused a market with no plan.
 */
test.describe('A fresh draft', () => {
  for (const screen of ['result', 'vendors'] as const) {
    test(`${screen} loads, with nothing assigned and no error`, async ({
      authenticatedPage: page,
      request,
    }) => {
      const { marketId } = await seedDraftMarket(
        request,
        BACKEND_URL,
        TEST_USER.email,
        TEST_USER.password,
      );
      const failed: string[] = [];
      page.on('response', (response) => {
        if (response.status() >= 500) failed.push(response.url());
      });

      await page.goto(marketScreenPath(marketId, screen));

      await expect(page.getByTestId('market-bar')).toBeVisible();
      if (screen === 'result') {
        await expect(page.getByTestId('result-empty')).toContainText(
          'assignment phase. Set the rules',
        );
      } else {
        await expect(page.getByTestId('vendors-summary')).toBeVisible();
      }
      await expect(page.getByText('Internal server error')).toHaveCount(0);
      expect(failed).toEqual([]);
    });
  }
});
