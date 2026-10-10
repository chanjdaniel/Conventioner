import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { seedPublishedMarketWithAssignments } from './helpers/seeds';
import { setApplicationAnswer } from './helpers/seedApplication';
import { marketSetupPath } from './helpers/marketScreens';
import { VendorsPage } from './pages/VendorsPage';

/**
 * What the 2026-10-10 screenshot pass found clearly off (E28/F04/S03).
 */
test('a locked intake choice still says which it is', async ({
  authenticatedPage: page,
  request,
}) => {
  const seed = await seedPublishedMarketWithAssignments(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  await page.goto(marketSetupPath(seed.marketId, 'setup'));
  await expect(page.getByTestId('setup-intake-mode-frozen')).toBeVisible({ timeout: 10000 });

  const cards = await page.locator('.choice-card').evaluateAll((labels) =>
    labels.map((label) => ({
      chosen: label.classList.contains('chosen'),
      background: getComputedStyle(label).backgroundColor,
      outline: getComputedStyle(label).outlineStyle,
      weight: getComputedStyle(label.querySelector('.choice-card-label')!).fontWeight,
    })),
  );
  const chosen = cards.filter((card) => card.chosen);
  const other = cards.filter((card) => !card.chosen);
  expect(chosen).toHaveLength(1);
  expect(other.length).toBeGreaterThan(0);
  // The chosen card stands apart from the frozen ground, ringed and in bold, rather than being
  // the same beige card with a faint disabled radio.
  expect(chosen[0].background).not.toBe(other[0].background);
  expect(chosen[0].outline).toBe('solid');
  expect(chosen[0].weight).toBe('600');
  expect(other[0].weight).toBe('400');
});

test('a web address in the vendor drawer is a link, and a plain answer is not', async ({
  authenticatedPage: page,
  request,
}) => {
  const seed = await seedPublishedMarketWithAssignments(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  setApplicationAnswer(
    seed.marketId,
    'alice@example.com',
    'business_name',
    'Alice Ceramics https://www.instagram.com/alice',
  );
  setApplicationAnswer(seed.marketId, 'bob@example.com', 'business_name', 'Bob Prints');

  const vendorsPage = new VendorsPage(page);
  await vendorsPage.goto(seed.marketId);
  await vendorsPage.search('alice');
  await vendorsPage.clickVendor(0);
  const link = vendorsPage.detailPanel.getByTestId('answer-link');
  await expect(link).toHaveAttribute('href', 'https://www.instagram.com/alice', { timeout: 5000 });
  await expect(vendorsPage.detailPanel).toContainText('Alice Ceramics');
  await vendorsPage.closeDetail();

  await vendorsPage.search('bob');
  await vendorsPage.clickVendor(0);
  await expect(vendorsPage.detailPanel).toContainText('Bob Prints');
  await expect(vendorsPage.detailPanel.getByTestId('answer-link')).toHaveCount(0);
});
