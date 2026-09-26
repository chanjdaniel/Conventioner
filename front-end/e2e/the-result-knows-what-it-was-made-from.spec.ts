import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { ensureTestOrg } from './helpers/seeds';
import { seedAssignedMarket } from './helpers/seedAssignedMarket';
import { marketSetupPath } from './helpers/marketScreens';

/**
 * The result says when it is out of date (E22/F03, from the-assignment-tab ticket 03).
 *
 * Editing a rule never changes a stored assignment - only running it again does. So once anything
 * the solver reads has changed since the run, the result says what, quietly, until it is run again.
 */
test.describe('The result knows what it was made from', () => {
  let marketId: string;

  test.beforeEach(async ({ request }) => {
    await ensureTestOrg(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
    // Walked to `assignment` and assigned, by the run that records what it was made from.
    const seeded = await seedAssignedMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );
    marketId = seeded.marketId;
  });

  test('change a rule and the result says so; run again and it is gone', async ({
    authenticatedPage: page,
  }) => {
    await page.goto(marketSetupPath(marketId, 'assignment'));
    // The half-table proportion: max-per-vendor is clamped to the market's one date, so changing it
    // can land back on the value it had.
    const halfTables = page.getByTestId('setup-options-max-proportion-input');
    await expect(halfTables).toBeEnabled({ timeout: 15000 });

    // The plan saves as the organizer types; the store re-reads the market after it does.
    const current = await halfTables.inputValue();
    await halfTables.fill(current === '40' ? '30' : '40');
    await halfTables.blur();

    // The line is on the Result page, where the assignment it describes is (E22/F04/S04).
    await page.getByTestId('market-pages-result').click();
    const line = page.getByTestId('assignment-out-of-date');
    await expect(line).toContainText('Your rules changed since this assignment ran', {
      timeout: 10000,
    });

    await line.getByRole('link', { name: 'Run it again' }).click();
    await page.getByTestId('market-setup-assign-button').click();
    await expect(page).toHaveURL(new RegExp(`/markets/${marketId}/result$`), { timeout: 15000 });
    await expect(page.getByTestId('result-strip')).toBeVisible();
    await expect(line).toHaveCount(0);
  });
});
