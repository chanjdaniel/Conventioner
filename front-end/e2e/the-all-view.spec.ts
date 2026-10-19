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

test('a verdict on a selection: confirmed by count, held ones untickable, changed ones skipped', async ({
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
  seedApplicationWithStatus(marketId, 'open', 'theo@thistle.test');
  const ines = seedApplicationWithStatus(marketId, 'open', 'ines@loom.test');
  seedApplicationWithStatus(marketId, 'open', 'omar@kiln.test');
  await transitionMarket(request, BACKEND_URL, TEST_USER.email, marketId, 'applications_closed');
  await transitionMarket(request, BACKEND_URL, TEST_USER.email, marketId, 'review');
  const granted = await request.post(`${BACKEND_URL}/markets/${marketId}/roles`, {
    data: { user_email: SECOND.email, role: 'editor' },
  });
  expect(granted.ok(), await granted.text()).toBeTruthy();

  await page.goto(`${marketScreenPath(marketId, 'applications')}?view=all`);
  const rows = page.getByTestId('applications-all-row');
  await expect(rows).toHaveCount(4);
  const row = (email: string) => rows.filter({ hasText: email });

  await withUser(browser, SECOND.email, SECOND.password, async (other) => {
    // The other reviewer opens Nadia's card; once the list knows, she cannot be ticked.
    await other.request.post(`${BACKEND_URL}/markets/${marketId}/review/next`, { data: {} });
    await page.reload();
    await expect(row('nadia@ember.test').getByTestId('applications-all-tick')).toBeDisabled();

    // Theo and Ines ticked; then the other reviewer rejects Ines before the approval lands.
    await row('theo@thistle.test').getByTestId('applications-all-tick').check();
    await row('ines@loom.test').getByTestId('applications-all-tick').check();
    await expect(page.getByTestId('applications-all-selection')).toContainText(
      '2 applications selected',
    );
    const rejected = await other.request.put(
      `${BACKEND_URL}/markets/${marketId}/applications/${ines}/review`,
      { data: { status: 'reviewer_rejected' } },
    );
    expect(rejected.ok()).toBeTruthy();
  });

  // Nothing is written until the count is confirmed.
  await page.getByTestId('applications-all-selection-approve').click();
  await expect(page.getByTestId('applications-all-confirm-window')).toContainText(
    'Approve 2 applications?',
  );
  await page.getByTestId('applications-all-confirm-submit-button').click();

  await expect(page.getByTestId('applications-all-result')).toContainText(
    '1 application approved; 1 skipped',
  );
  await expect(page.getByTestId('applications-all-skipped')).toHaveText(
    `ines@loom.test: ${SECOND.email} rejected this application since you opened it.`,
  );
  await expect(row('theo@thistle.test').getByTestId('applications-all-status')).toHaveText(
    'Approved',
  );
  await expect(row('ines@loom.test').getByTestId('applications-all-status')).toHaveText('Rejected');
  // The rail moves with it: two left, not four.
  await expect(page.getByTestId('phase-rail-next')).toContainText(
    '2 applications are still awaiting review',
  );
  // Omar was never ticked, and is left as he was.
  await expect(row('omar@kiln.test').getByTestId('applications-all-status')).toHaveText('Open');
});
