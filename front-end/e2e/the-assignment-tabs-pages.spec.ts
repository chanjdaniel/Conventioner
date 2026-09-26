import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { ensureTestOrg } from './helpers/seeds';
import { seedAssignedMarket } from './helpers/seedAssignedMarket';

/**
 * The Assignment tab's pages (E22/F04/S03, from the-assignment-tab tickets 01 and 02).
 *
 * The tab holds three pages - Assignment (the rules and the run), Result and Vendors - in a row
 * under the rail. The Assignment page no longer carries the result: a run lands on Result, and once
 * an assignment exists the button says it runs again, and what that keeps.
 */
const at = (marketId: string, page: string) => `/markets/${marketId}/${page}`;

test.describe("The Assignment tab's pages", () => {
  test.beforeEach(async ({ request }) => {
    await ensureTestOrg(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  });

  test('set the rules, run, land on Result, return, and it runs again', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { marketId } = await seedAssignedMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
      { run: false },
    );
    await page.goto(at(marketId, 'assignment'));

    const pages = page.getByTestId('market-pages');
    await expect(pages).toBeVisible({ timeout: 15000 });
    await expect(pages.getByRole('link')).toHaveText(['Assignment', 'Result', 'Vendors']);
    await expect(page.getByTestId('market-pages-assignment')).toHaveClass(/active/);
    // The rules and the run, and nothing of the result.
    await expect(page.getByTestId('setup-options-max-assignments-input')).toBeVisible();
    await expect(page.locator('.assignment-results')).toHaveCount(0);

    const run = page.getByTestId('market-setup-assign-button');
    await expect(run).toHaveText('Assign');
    await run.click();

    await expect(page).toHaveURL(new RegExp(`/markets/${marketId}/result$`), { timeout: 15000 });
    await expect(page.getByTestId('market-pages-result')).toHaveClass(/active/);

    await page.getByTestId('market-pages-assignment').click();
    await expect(page).toHaveURL(new RegExp(`/markets/${marketId}/assignment$`));
    await expect(run).toHaveText('Run again');
    await expect(page.getByTestId('market-setup-rerun-keeps')).toHaveText('Places everyone again.');
  });

  test('the page row is only on the Assignment tab, and pinned with the frame', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { marketId } = await seedAssignedMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );
    for (const where of ['assignment', 'result', 'vendors']) {
      await page.goto(at(marketId, where));
      await expect(page.getByTestId(`market-pages-${where}`)).toHaveClass(/active/, {
        timeout: 15000,
      });
    }
    await page.setViewportSize({ width: 1920, height: 500 });
    await page.goto(at(marketId, 'result'));
    await expect(page.getByTestId('market-pages')).toBeVisible({ timeout: 15000 });
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(page.getByTestId('market-pages')).toBeInViewport({ ratio: 1 });

    for (const where of ['setup', 'form', 'applications']) {
      await page.goto(at(marketId, where));
      await expect(page.getByTestId('market-bar-title')).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId('market-pages')).toHaveCount(0);
    }
  });
});
