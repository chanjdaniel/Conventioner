import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { marketSetupPath } from './helpers/marketScreens';
import { seedAssignedMarket } from './helpers/seedAssignedMarket';
import { mongoEval } from './helpers/mongo';
import { seedPublishedMarketWithAssignments } from './helpers/seeds';
import type { Page } from '@playwright/test';

/**
 * Wherever the review is closed, the Applications tab says why and what to do instead (T207), in
 * the server's words (`verdictsSettledReason`), over both views where the review's controls were:
 * Back to review while tables are allocated, a seat on Assignments once results are published or
 * a Google Form market that went live before it could publish them. The automatic rejections say
 * the same in their own subject.
 */

const ALLOCATING =
  'The review is closed while tables are allocated. To change a verdict, choose Back to review under More… on the phase rail; tables are then allocated again.';
const PUBLISHED =
  'The review closed when results were published. To change who has a table, place or free a seat on Assignments.';
const WENT_LIVE =
  'The review closed when the market went live. To change who has a table, place or free a seat on Assignments.';

async function conditionLine(page: Page, marketId: string) {
  await page.goto(marketSetupPath(marketId, 'applications'));
  const line = page.getByTestId('market-setup-applications-condition');
  await expect(line).toBeVisible({ timeout: 15000 });
  return line;
}

test('in Assignment, the tab says the review is closed and Back to review reopens it', async ({
  authenticatedPage: page,
  request,
}) => {
  const seed = await seedAssignedMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password, {
    intakeMode: 'form',
  });

  const line = await conditionLine(page, seed.marketId);
  await expect(line).toHaveText(ALLOCATING);
  // Said once, over both views, where the reviewers panel was.
  await page.getByTestId('applications-view-one').click();
  await expect(line).toHaveText(ALLOCATING);
  await expect(page.getByTestId('reviewers')).toHaveCount(0);

  // The automatic rejections say the same, in their own subject.
  await page.goto(marketSetupPath(seed.marketId, 'form'));
  await page.getByTestId('form-step-review').click();
  await expect(page.getByTestId('rejection-rules-locked')).toHaveText(
    'The automatic rejections are closed while tables are allocated. To change a rule, choose Back to review under More… on the phase rail; tables are then allocated again.',
  );
});

test('once results are published, the tab says to place or free a seat instead', async ({
  authenticatedPage: page,
  request,
}) => {
  const seed = await seedAssignedMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password, {
    intakeMode: 'form',
  });
  const published = await request.post(`${BACKEND_URL}/markets/${seed.marketId}/publish-results`);
  expect(published.ok(), await published.text()).toBe(true);

  await expect(await conditionLine(page, seed.marketId)).toHaveText(PUBLISHED);
});

test('a Google Form market that went live before it could publish says the review closed then', async ({
  authenticatedPage: page,
  request,
}) => {
  const seed = await seedPublishedMarketWithAssignments(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  // Going live waits for results now (ADR 0022), so this market went before that rule reached it.
  mongoEval(
    `db.markets.updateOne({id: ${JSON.stringify(seed.marketId)}}, {$unset: {resultsPublished: ''}})`,
  );

  await expect(await conditionLine(page, seed.marketId)).toHaveText(WENT_LIVE);
});
