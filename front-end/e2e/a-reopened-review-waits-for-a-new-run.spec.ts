import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL, MarketSetupPage } from './fixtures';
import { ApplicationsAllPage } from './pages/ApplicationsAllPage';
import { marketScreenPath } from './helpers/marketScreens';
import { seedAssignedMarket } from './helpers/seedAssignedMarket';
import { SEED_MARKET_DATE } from './helpers/seeds';

/**
 * A reopened review makes the stored run out of date (T207, ADR 0021).
 *
 * Back to review keeps the tables allocated so far, hand seats and all, but they were allocated
 * before this review: Assignments says so once the market is back in Assignment, Publish results
 * (or, on a Google Form market, Publish market) waits until tables are allocated again, and a seat
 * placed by hand for a vendor the reopened review rejected stays, marked "Not approved".
 */
const REOPENED = 'The review was reopened after tables were allocated.';

async function post(request: APIRequestContext, path: string, data: object = {}) {
  const res = await request.post(`${BACKEND_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    data,
  });
  expect(res.ok(), `${path}: ${await res.text()}`).toBeTruthy();
}

async function allocateAgain(page: Page, marketId: string) {
  await page.goto(marketScreenPath(marketId, 'settings'));
  await page.getByTestId('market-setup-assign-button').click();
  await expect(page).toHaveURL(new RegExp(`/markets/${marketId}/assignments$`), {
    timeout: 15000,
  });
}

test('a form market back from review allocates tables again before it publishes results', async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketId } = await seedAssignedMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { intakeMode: 'form' },
  );
  // Alice's seat is placed by hand, then the review that approved her reopens and rejects her.
  const pinned = await request.put(`${BACKEND_URL}/markets/${marketId}/placements`, {
    data: {
      email: 'alice@example.com',
      date: SEED_MARKET_DATE,
      table_code: 'Hall A 5',
      table_choice: 'Full Table',
    },
  });
  expect(pinned.ok(), await pinned.text()).toBeTruthy();

  await page.goto(marketScreenPath(marketId, 'assignments'));
  await expect(page.getByTestId('phase-rail-current')).toHaveText(/Assignment/, {
    timeout: 15000,
  });
  await expect(page.getByTestId('assignment-out-of-date')).toHaveCount(0);
  await page.getByTestId('phase-rail-menu-button').click();
  await page.getByTestId('phase-transition-applications').click();
  await page.getByTestId('back-to-review-confirm-submit-button').click();
  await expect(page).toHaveURL(/\/applications$/, { timeout: 10000 });

  const all = new ApplicationsAllPage(page);
  await all.open('alice@example.com');
  await all.drawerButton('reject').click();
  await expect(all.statusOf('alice@example.com')).toHaveText('Rejected');
  await all.closeDrawer();

  // Begin assignment lands on the tables already allocated, which say they predate this review,
  // in a sentence of their own.
  await page.getByTestId('phase-transition-assignment').click();
  await expect(page).toHaveURL(/\/assignments$/, { timeout: 15000 });
  await expect(page.getByTestId('assignment-out-of-date')).toContainText(REOPENED);
  await expect(page.getByTestId('assignment-out-of-date')).toContainText(
    'The approved applications changed since tables were allocated.',
  );

  // Publish results waits, saying why.
  await page.goto(marketScreenPath(marketId, 'applications'));
  await expect(page.getByTestId('applications-publish-button')).toBeDisabled();
  await expect(page.getByTestId('applications-publish-hint')).toHaveText(
    'The table allocation is out of date. Allocate tables again before publishing, so applicants are told what the market will hold.',
  );

  await allocateAgain(page, marketId);
  await expect(page.getByTestId('assignment-out-of-date')).toHaveCount(0);
  // Alice's hand seat stayed through the run, marked: the review left her out.
  const seat = page.locator('[data-testid="tables-table-row"][data-table-code="Hall A 5"]');
  await expect(seat).toContainText('alice@example.com');
  await expect(seat.getByTestId('tables-seat-not-approved')).toBeVisible();

  await page.goto(marketScreenPath(marketId, 'applications'));
  const publish = page.getByTestId('applications-publish-button');
  await expect(publish).toBeEnabled();
  await publish.click();
  await page.getByTestId('publish-results-submit-button').click();
  await expect(page.getByTestId('applications-published-badge')).toBeVisible();
});

test('a Google Form market back from review allocates tables again before it goes live', async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketId } = await seedAssignedMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  await post(request, `/markets/${marketId}/transition`, { toPhase: 'applications' });
  await post(request, `/markets/${marketId}/transition`, { toPhase: 'assignment' });

  await page.goto(marketScreenPath(marketId, 'assignments'));
  await expect(page.getByTestId('assignment-out-of-date')).toHaveText(
    `${REOPENED} Allocate tables again to bring the result up to date.`,
  );
  // Publish market waits, and its first fix is to allocate tables.
  await expect(page.getByTestId('phase-transition-market_days')).toBeDisabled();
  await expect(page.getByTestId('phase-rail-next')).toContainText(
    'The review was reopened after tables were allocated. Allocate tables again before the market goes live.',
  );

  await allocateAgain(page, marketId);
  await expect(page.getByTestId('assignment-out-of-date')).toHaveCount(0);
  // Its vendors read their results on its vendor page, so those come before going live (ADR 0022).
  await new MarketSetupPage(page).publishResults(marketId);
  await page.getByTestId('phase-transition-market_days').click();
  await page.getByTestId('sweep-confirm-submit-button').click();
  await expect(page.getByTestId('phase-rail-current')).toHaveText('Market Days');
});
