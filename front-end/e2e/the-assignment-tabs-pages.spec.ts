import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { ensureTestOrg } from './helpers/seeds';
import { seedAssignedMarket } from './helpers/seedAssignedMarket';

/**
 * The Assignment tab's pages (E22/F04/S03, from the-assignment-tab tickets 01 and 02).
 *
 * The tab holds four pages - Settings (the rules and the run), Assignments, Vendors and Payments -
 * in a row under the rail, named for what they hold (E38/F08/S01, E44/F02/S01). Settings does not carry the result: a run
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

  test("on a phone every page link is one whole line and a thumb's target", async ({
    authenticatedPage: page,
    request,
  }) => {
    // Assignments fits a phone (T142), and the row is on it: the fourth link once ran past the
    // card at 390, and squeezed Assignments onto two lines.
    const { marketId } = await seedAssignedMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );
    const row = page.getByTestId('market-pages');
    const measure = () =>
      row.evaluate((nav) => {
        const box = nav.getBoundingClientRect();
        return {
          fits: nav.scrollWidth <= nav.clientWidth,
          pageFits: document.documentElement.scrollWidth <= window.innerWidth,
          inWindow: box.left >= 0 && box.right <= window.innerWidth,
          links: Array.from(nav.querySelectorAll('a')).map((a) => ({
            height: Math.round(a.getBoundingClientRect().height),
            whole: a.scrollWidth <= a.clientWidth,
          })),
        };
      });
    const oneLineTargets = Array(4).fill({ height: 44, whole: true });

    // A 390 phone fits all four, beside each other.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(at(marketId, 'assignments'));
    await expect(row).toBeVisible({ timeout: 15000 });
    expect(await measure()).toEqual({
      fits: true,
      pageFits: true,
      inWindow: true,
      links: oneLineTargets,
    });

    // A narrower one keeps each whole and scrolls the row inside itself, never the page.
    await page.setViewportSize({ width: 320, height: 640 });
    await expect(row).toBeVisible();
    const narrow = await measure();
    expect({ ...narrow, fits: undefined }).toEqual({
      fits: undefined,
      pageFits: true,
      inWindow: true,
      links: oneLineTargets,
    });
    await page.getByTestId('market-pages-payments').scrollIntoViewIfNeeded();
    await expect(page.getByTestId('market-pages-payments')).toBeInViewport({ ratio: 1 });
  });
});
