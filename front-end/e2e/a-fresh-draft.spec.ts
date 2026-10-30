import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { seedDraftMarket } from './helpers/seedDraftMarket';
import { savePlan } from './helpers/savePlan';
import { completePlan } from './helpers/seeds';
import { marketScreenPath } from './helpers/marketScreens';

/**
 * A market as the create dialog leaves it - a name and an organization, no plan - opened on every
 * page its Assignment tab holds (E30/F01/S01). Result and Vendors answered "Internal server error":
 * the tables and statistics endpoints refused a market with no plan. A plan begun but holding no
 * tables yet is the same market a step later, and must load as plainly.
 */
const PLANS = {
  'no plan': null,
  'a plan with no tables': { ...completePlan(), sections: [] },
} as const;

test.describe('A fresh draft', () => {
  for (const [planned, plan] of Object.entries(PLANS)) {
    for (const [screen, empty] of [
      ['assignments', 'result-empty'],
      ['vendors', 'vendors-empty'],
    ] as const) {
      test(`${screen} loads with ${planned}, with nothing assigned and no error`, async ({
        authenticatedPage: page,
        request,
      }) => {
        const { marketId } = await seedDraftMarket(
          request,
          BACKEND_URL,
          TEST_USER.email,
          TEST_USER.password,
        );
        if (plan) await savePlan(request, BACKEND_URL, TEST_USER.email, marketId, plan);
        const failed: string[] = [];
        page.on('response', (response) => {
          if (response.status() >= 500) failed.push(response.url());
        });

        await page.goto(marketScreenPath(marketId, screen));

        await expect(page.getByTestId('market-bar')).toBeVisible();
        await expect(page.getByTestId(empty)).toContainText(
          'Nothing assigned yet. This market is still a draft.',
        );
        await expect(page.getByText('Internal server error')).toHaveCount(0);
        expect(failed).toEqual([]);
      });
    }
  }
});
