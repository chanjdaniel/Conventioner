import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { ApplicationsAllPage } from './pages/ApplicationsAllPage';
import { marketScreenPath } from './helpers/marketScreens';
import { seedAssignedMarket } from './helpers/seedAssignedMarket';
import type { Page } from '@playwright/test';

/**
 * Back to review (T207): from Assignment, until results are published, the phase rail's More…
 * offers the way back to the review. It asks first, saying what it costs, and lands on the
 * Applications tab with the review open again; once results are published it stays in the menu,
 * disabled, with the reason beside it.
 */

async function openMenu(page: Page) {
  await expect(page.getByTestId('phase-rail-current')).toHaveText(/Assignment/, {
    timeout: 15000,
  });
  await page.getByTestId('phase-rail-menu-button').click();
  return page.getByTestId('phase-transition-applications');
}

test('a form market goes back to review, and a verdict changes there', async ({
  authenticatedPage: page,
  request,
}) => {
  const seed = await seedAssignedMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password, {
    intakeMode: 'form',
  });
  await page.goto(marketScreenPath(seed.marketId, 'assignments'));

  const item = await openMenu(page);
  await expect(item).toHaveText('Back to review');
  await expect(item).toHaveAttribute('data-direction', 'back');
  await item.click();

  const dialog = page.getByTestId('back-to-review-confirm-window');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Back to review?');
  await expect(dialog.locator('p')).toHaveText([
    'The review opens again: verdicts can be given and changed, and the automatic rejections can change.',
    'The tables you allocated are kept, but they no longer count. Once every application is decided, begin assignment and allocate tables again before you publish results.',
    'A seat you placed by hand stays, even for a vendor you then reject. Free it on Assignments.',
    'Applications stay closed. To take new ones, choose Take applications again under More…',
  ]);

  // Cancel leaves the market where it was.
  await page.getByTestId('back-to-review-confirm-cancel-button').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('phase-rail-current')).toHaveText(/Assignment/);

  await (await openMenu(page)).click();
  await page.getByTestId('back-to-review-confirm-submit-button').click();

  // It lands where the review is, the review open again.
  await expect(page.getByTestId('phase-rail-current')).toHaveText(/Applications/, {
    timeout: 10000,
  });
  await expect(page).toHaveURL(/\/applications$/);
  const all = new ApplicationsAllPage(page);
  await all.rows.first().getByRole('button').click();
  await all.drawer.waitFor();
  await all.drawerButton('reject').click();
  await expect(all.rows.first().getByTestId('applications-all-status')).toHaveText('Rejected');

  // Applying stayed closed, and More… offers to take applications again.
  await all.closeDrawer();
  await page.getByTestId('phase-rail-menu-button').click();
  await expect(page.getByTestId('phase-rail-action-take-applications')).toBeVisible();
});

test('a Google Form market reads the same words, with no applications line', async ({
  authenticatedPage: page,
  request,
}) => {
  const seed = await seedAssignedMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  await page.goto(marketScreenPath(seed.marketId, 'assignments'));

  await (await openMenu(page)).click();

  await expect(page.getByTestId('back-to-review-confirm-window').locator('p')).toHaveText([
    'The review opens again: verdicts can be given and changed, and the automatic rejections can change.',
    'The tables you allocated are kept, but they no longer count. Once every application is decided, begin assignment and allocate tables again before you publish results.',
    'A seat you placed by hand stays, even for a vendor you then reject. Free it on Assignments.',
  ]);
  await page.getByTestId('back-to-review-confirm-submit-button').click();
  await expect(page.getByTestId('phase-rail-current')).toHaveText(/Review/, { timeout: 10000 });
});

test('once results are published, Back to review is disabled with the reason', async ({
  authenticatedPage: page,
  request,
}) => {
  const seed = await seedAssignedMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password, {
    intakeMode: 'form',
  });
  const published = await request.post(`${BACKEND_URL}/markets/${seed.marketId}/publish-results`);
  expect(published.ok(), await published.text()).toBe(true);
  await page.goto(marketScreenPath(seed.marketId, 'assignments'));

  const item = await openMenu(page);
  await expect(item).toHaveAttribute('aria-disabled', 'true');
  await expect(item.getByTestId('phase-transition-reason')).toHaveText(
    'Results are published: applicants have read whether they have a table, so the review cannot reopen. To change who has a table, place or free a seat on Assignments.',
  );
  // A press on it does nothing: `aria-disabled` keeps it in the menu, to be read.
  await item.dispatchEvent('click');
  await expect(page.getByTestId('back-to-review-confirm-window')).toHaveCount(0);
  await expect(page.getByTestId('phase-rail-current')).toHaveText(/Assignment/);
});
