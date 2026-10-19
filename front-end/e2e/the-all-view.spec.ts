import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import {
  seedApplicationWithStatus,
  seedPhaseMarket,
  transitionMarket,
} from './helpers/seedPhaseMarket';
import { seedAssignedMarket } from './helpers/seedAssignedMarket';
import { marketScreenPath } from './helpers/marketScreens';
import { ensureVerifiedUser } from './helpers/verifiedUser';
import { withUser } from './helpers/withUser';
import { namelessControls } from './helpers/accessibleNames';

/**
 * The All view (E34/F04/S01).
 *
 * Besides the one-by-one review, every application at once: status, who gave it and who holds it,
 * filtered by status and by Mine, kept in the address; a row opens the vendor drawer, which carries
 * the verdicts while the market is deciding and shows them read-only after.
 */
const SECOND = { email: 'e2e-all-view-reviewer@example.com', password: 'e2eallviewreviewer1' };

test('every application, filtered, held and decided from the drawer', async ({
  authenticatedPage: page,
  browser,
  request,
}) => {
  ensureVerifiedUser(SECOND.email, SECOND.password);
  const { marketId } = await seedPhaseMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { intakeMode: 'form' },
  );
  await transitionMarket(request, BACKEND_URL, TEST_USER.email, marketId, 'applications_open');
  seedApplicationWithStatus(marketId, 'open', 'nadia@ember.test');
  const theo = seedApplicationWithStatus(marketId, 'open', 'theo@thistle.test');
  seedApplicationWithStatus(marketId, 'open', 'ines@loom.test');
  await transitionMarket(request, BACKEND_URL, TEST_USER.email, marketId, 'applications_closed');
  await transitionMarket(request, BACKEND_URL, TEST_USER.email, marketId, 'review');
  const granted = await request.post(`${BACKEND_URL}/markets/${marketId}/roles`, {
    data: { user_email: SECOND.email, role: 'editor' },
  });
  expect(granted.ok(), await granted.text()).toBeTruthy();
  const followUp = await request.put(
    `${BACKEND_URL}/markets/${marketId}/applications/${theo}/review`,
    { data: { status: 'needs_follow_up' } },
  );
  expect(followUp.ok(), await followUp.text()).toBeTruthy();

  await withUser(browser, SECOND.email, SECOND.password, async (other) => {
    // Another reviewer opens a card, which holds it.
    const next = await other.request.post(`${BACKEND_URL}/markets/${marketId}/review/next`, {
      data: {},
    });
    expect(next.ok()).toBeTruthy();

    await page.goto(marketScreenPath(marketId, 'applications'));
    await page.getByTestId('applications-view-all').click();
    await expect(page).toHaveURL(/view=all/);
    const rows = page.getByTestId('applications-all-row');
    await expect(rows).toHaveCount(3);
    // The page's own line counts what is left from this view too.
    await expect(page.getByTestId('market-setup-applications-condition')).toContainText(
      '3 applications still to decide',
    );
    await expect(
      page.getByTestId('applications-all-holder').filter({ hasText: SECOND.email }),
    ).toHaveText(`${SECOND.email} is looking at this`);
  });

  // Filters, in the address: the follow-ups, then only mine.
  const rows = page.getByTestId('applications-all-row');
  await page.getByTestId('applications-all-filter-needs_follow_up').click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('theo@thistle.test');
  await expect(rows.first().getByTestId('applications-all-owner')).toHaveText(
    `Followed up by ${TEST_USER.email}`,
  );
  await page.getByTestId('applications-all-mine').check();
  await expect(rows).toHaveCount(1);
  await page.reload();
  await expect(page).toHaveURL(/status=needs_follow_up/);
  await expect(page).toHaveURL(/mine=1/);
  await expect(page.getByTestId('applications-all-mine')).toBeChecked();
  await expect(rows).toHaveCount(1);

  // A row opens the drawer, which decides it; the row follows.
  await page.getByTestId('applications-all-filter-all').click();
  await page.getByTestId('applications-all-mine').uncheck();
  await rows.filter({ hasText: 'ines@loom.test' }).getByRole('button').click();
  await expect(page.getByTestId('vendors-detail-panel')).toBeVisible();
  expect(await namelessControls(page), 'the All view, its drawer open').toEqual([]);
  await page.getByTestId('applications-all-approve').click();
  await expect(
    rows.filter({ hasText: 'ines@loom.test' }).getByTestId('applications-all-status'),
  ).toHaveText('Approved');
  await expect(
    rows.filter({ hasText: 'ines@loom.test' }).getByTestId('applications-all-giver'),
  ).toContainText(`Approved by ${TEST_USER.email}`);
});

test('outside the review the drawer shows the verdict and offers none', async ({
  authenticatedPage: page,
  request,
}) => {
  const seed = await seedAssignedMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);

  await page.goto(`${marketScreenPath(seed.marketId, 'applications')}?view=all`);
  await page.getByTestId('applications-all-row').first().getByRole('button').click();
  await expect(page.getByTestId('applications-all-drawer-verdict')).toContainText('Approved');
  await expect(page.getByTestId('applications-all-approve')).toHaveCount(0);
  await expect(page.getByTestId('applications-all-reject')).toHaveCount(0);
});
