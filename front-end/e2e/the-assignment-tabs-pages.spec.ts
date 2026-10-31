import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { ensureTestOrg } from './helpers/seeds';
import { seedAssignedMarket } from './helpers/seedAssignedMarket';

/**
 * The Assignment tab's pages (E22/F04/S03, from the-assignment-tab tickets 01 and 02).
 *
 * The tab holds three pages - Settings (the rules and the run), Assignments and Vendors - in a row
 * under the rail, named for what they hold (E38/F08/S01). Settings does not carry the result: a run
 * lands on Assignments, and once an assignment exists the button says it runs again, and what that
 * keeps.
 */
const at = (marketId: string, page: string) => `/markets/${marketId}/${page}`;

test.describe("The Assignment tab's pages", () => {
  test.beforeEach(async ({ request }) => {
    await ensureTestOrg(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  });

  test('set the rules, run, land on Assignments, return, and it runs again', async ({
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
    await page.goto(at(marketId, 'settings'));

    const pages = page.getByTestId('market-pages');
    await expect(pages).toBeVisible({ timeout: 15000 });
    await expect(pages.getByRole('link')).toHaveText([
      'Settings',
      'Assignments',
      'Vendors',
      'Payments',
    ]);
    await expect(page.getByTestId('market-pages-settings')).toHaveClass(/active/);
    // Told apart from the market's own settings on Market Setup (E38/F08/S01).
    await expect(page.getByRole('heading', { name: 'Assignment settings' })).toBeVisible();
    // The tab keeps its name: only the pages under it changed theirs.
    await expect(page.getByTestId('market-bar-tab-assignment')).toHaveText('Assignment');
    // The rules and the run, and nothing of the result.
    await expect(page.getByTestId('setup-options-max-assignments-input')).toBeVisible();
    await expect(page.locator('.assignment-results')).toHaveCount(0);

    const run = page.getByTestId('market-setup-assign-button');
    await expect(run).toHaveText('Allocate tables');
    await run.click();

    await expect(page).toHaveURL(new RegExp(`/markets/${marketId}/assignments$`), {
      timeout: 15000,
    });
    await expect(page.getByTestId('market-pages-assignments')).toHaveClass(/active/);

    await page.getByTestId('market-pages-settings').click();
    await expect(page).toHaveURL(new RegExp(`/markets/${marketId}/settings$`));
    await expect(run).toHaveText('Allocate tables again');
    await expect(page.getByTestId('market-setup-rerun-keeps')).toHaveText(
      'Allocates tables for everyone again.',
    );
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
    for (const where of ['settings', 'assignments', 'vendors', 'payments']) {
      await page.goto(at(marketId, where));
      await expect(page.getByTestId(`market-pages-${where}`)).toHaveClass(/active/, {
        timeout: 15000,
      });
    }
    await page.setViewportSize({ width: 1920, height: 500 });
    await page.goto(at(marketId, 'assignments'));
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
