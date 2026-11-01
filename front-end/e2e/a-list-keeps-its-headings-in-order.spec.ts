import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './fixtures';
import { MarketsPage } from './pages/MarketsPage';

/**
 * A list's cards are headed one level under the page's title, so a screen reader's outline of the
 * page skips no level: Markets and Organizations are each an `h1` over one `h2` per card. axe's
 * `heading-order` is a best practice rather than WCAG, so the suite-wide check leaves it out, and
 * this holds it for the two lists.
 */
async function headingsOutOfOrder(page: import('@playwright/test').Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page })
    .options({ runOnly: { type: 'rule', values: ['heading-order'] } })
    .analyze();
  return violations.flatMap((v) => v.nodes.map((node) => node.target.join(' ')));
}

test('Markets heads each card one level under its title', async ({ authenticatedPage: page }) => {
  await new MarketsPage(page).goto();
  await expect(page.getByTestId('market-card').first()).toBeVisible();

  expect(await headingsOutOfOrder(page)).toEqual([]);
});

test('Organizations heads each card one level under its title', async ({
  authenticatedPage: page,
}) => {
  await page.goto('/organizations');
  await expect(page.getByTestId('organization-card').first()).toBeVisible();

  expect(await headingsOutOfOrder(page)).toEqual([]);
});

/**
 * The dashboard has one title for a screen reader to land on, and the remembered market's name sits
 * one level under it; its buttons are named by their words, not by headings inside them.
 */
test('the dashboard opens with its title, the remembered market one level under it', async ({
  authenticatedPage: page,
}) => {
  await new MarketsPage(page).goto();
  const card = page.getByTestId('market-card').first();
  const name = (await card.getByTestId('market-card-name').innerText()).trim();
  await card.getByTestId('market-card-name').getByRole('button').click();
  await expect(page.getByTestId('market-bar-title')).toHaveText(name, { timeout: 15000 });

  await page.goto('/dashboard');
  await expect(page.getByTestId('dashboard-last-market-card')).toContainText(name);

  const { violations } = await new AxeBuilder({ page })
    .options({ runOnly: { type: 'rule', values: ['heading-order', 'page-has-heading-one'] } })
    .analyze();
  expect(violations.map((v) => v.id)).toEqual([]);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dashboard');
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(name);
});
