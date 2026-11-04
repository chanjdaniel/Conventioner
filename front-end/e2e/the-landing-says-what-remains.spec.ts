import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { StartFromCsvPage } from './pages/StartFromCsvPage';
import { MarketSetupPage } from './pages/MarketSetupPage';
import { UPCOMING_YEAR } from './helpers/finishStartedPlan';
import { seedDraftMarket } from './helpers/seedDraftMarket';
import { marketSetupPath } from './helpers/marketScreens';

/**
 * The landing after the start from a Google Form (T205/F20, F09): the Questions tab says once which
 * file the market was drafted from and that no one was imported, and on a Google Form market that
 * the import comes next, where, and what it still waits on before it, each a link to where it is
 * done.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = join(
  HERE,
  '..',
  '..',
  'back-end',
  'tests',
  'test_data',
  'google_forms',
  'five-day-grid.csv',
);

const DRAFTED = 'Drafted from five-day-grid.csv. No responses were imported.';

/** Start a seeded draft from the corpus export, confirm its proposal, and land where it lands. */
async function draftFromTheFile(page: import('@playwright/test').Page, marketId: string) {
  const flow = new StartFromCsvPage(page);
  await flow.open(marketId);
  await flow.chooseFile(FILE);
  await flow.answerYear(UPCOMING_YEAR['five-day-grid']);
  await flow.confirm.click();
  await expect(page).toHaveURL(marketSetupPath(marketId, 'form'));
}

test.describe('The landing after drafting from a Google Form', () => {
  test('a Google Form draft is told the import comes next and what it still waits on, once', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { marketId } = await seedDraftMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
      { intakeMode: 'csv' },
    );
    await draftFromTheFile(page, marketId);

    // The file gave the market its dates, tiers and questions; where it is and its tables it never
    // says, and Review setup's two decisions are the organizer's, so those four are what the import
    // still waits on.
    const setup = new MarketSetupPage(page);
    await expect(setup.draftedFrom).toHaveText(
      `${DRAFTED} Import them with Import responses, the next step at the top of the market's ` +
        'pages, once the market is ready. Still needed before the import: Add a location, ' +
        'Add tables, Decide what reviewers read first, Decide the automatic rejections.',
    );
    await expect(setup.draftedFromLinks).toHaveText([
      'Add a location',
      'Add tables',
      'Decide what reviewers read first',
      'Decide the automatic rejections',
    ]);
    const reviewSetup = `${marketSetupPath(marketId, 'form')}?step=review`;
    for (const [index, href] of [
      marketSetupPath(marketId),
      marketSetupPath(marketId),
      reviewSetup,
      reviewSetup,
    ].entries()) {
      await expect(setup.draftedFromLinks.nth(index)).toHaveAttribute('href', href);
    }
    await expect(setup.draftedFrom).not.toContainText('Applications tab');

    // Said once: a reload of the same entry shows no notice.
    await page.reload();
    await expect(page.getByTestId('form-steps')).toBeVisible();
    await expect(setup.draftedFrom).toHaveCount(0);
  });

  test('following a link goes to Market Setup, and the Questions tab is quiet after', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { marketId } = await seedDraftMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
      { intakeMode: 'csv' },
    );
    await draftFromTheFile(page, marketId);

    const setup = new MarketSetupPage(page);
    await setup.draftedFromLinks.filter({ hasText: 'Add a location' }).click();
    await expect(page).toHaveURL(marketSetupPath(marketId));
    await expect(setup.locationAddButton).toBeVisible();
    await expect(setup.draftedFrom).toHaveCount(0);

    // Back to the tab by its tab, and by Back to the entry that said it: neither says it again.
    await setup.formTab.click();
    await expect(page.getByTestId('form-steps')).toBeVisible();
    await expect(setup.draftedFrom).toHaveCount(0);
    await page.goBack();
    await page.goBack();
    await expect(page).toHaveURL(marketSetupPath(marketId, 'form'));
    await expect(page.getByTestId('form-steps')).toBeVisible();
    await expect(setup.draftedFrom).toHaveCount(0);
  });

  test("a decision's link opens Review setup from the Questions tab it is read on", async ({
    authenticatedPage: page,
    request,
  }) => {
    const { marketId } = await seedDraftMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
      { intakeMode: 'csv' },
    );
    await draftFromTheFile(page, marketId);

    const setup = new MarketSetupPage(page);
    await setup.draftedFromLinks.filter({ hasText: 'Decide what reviewers read first' }).click();
    await expect(page).toHaveURL(/\/form\?step=review$/);
    await expect(page.getByTestId('review-highlights-undecided')).toBeVisible();
    await expect(setup.draftedFrom).toHaveCount(0);
  });

  test('a market whose vendors apply on its page is told only what the file drafted', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { marketId } = await seedDraftMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
      { intakeMode: 'form' },
    );
    await draftFromTheFile(page, marketId);

    const setup = new MarketSetupPage(page);
    await expect(setup.draftedFrom).toHaveText(DRAFTED);
    await expect(setup.draftedFromLinks).toHaveCount(0);
  });
});
