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
import { ApplicationsAllPage } from './pages/ApplicationsAllPage';

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
  await transitionMarket(request, BACKEND_URL, TEST_USER.email, marketId, 'applications');
  seedApplicationWithStatus(marketId, 'open', 'nadia@ember.test');
  const theo = seedApplicationWithStatus(marketId, 'open', 'theo@thistle.test');
  seedApplicationWithStatus(marketId, 'open', 'ines@loom.test');
  const granted = await request.post(`${BACKEND_URL}/markets/${marketId}/roles`, {
    data: { user_email: SECOND.email, role: 'editor' },
  });
  expect(granted.ok(), await granted.text()).toBeTruthy();
  const followUp = await request.put(
    `${BACKEND_URL}/markets/${marketId}/applications/${theo}/review`,
    { data: { status: 'needs_follow_up' } },
  );
  expect(followUp.ok(), await followUp.text()).toBeTruthy();

  const all = new ApplicationsAllPage(page);
  await withUser(browser, SECOND.email, SECOND.password, async (other) => {
    // Another reviewer opens a card, which holds it.
    const next = await other.request.post(`${BACKEND_URL}/markets/${marketId}/review/next`, {
      data: {},
    });
    expect(next.ok()).toBeTruthy();

    await page.goto(marketScreenPath(marketId, 'applications'));
    await all.switchTo();
    await expect(page).toHaveURL(/view=all/);
    await expect(all.rows).toHaveCount(3);
    await expect(all.holders().filter({ hasText: SECOND.email })).toHaveText(
      `${SECOND.email} is looking at this`,
    );
    // And the drawer of the card they hold says so too (E34/F03/S02).
    await all.open('nadia@ember.test');
    await expect(all.drawerHolder).toHaveText(`${SECOND.email} is looking at this`);
    await page.keyboard.press('Escape');
  });

  // Filters, in the address: the follow-ups, then only mine.
  await all.filter('needs_follow_up');
  await expect(all.rows).toHaveCount(1);
  await expect(all.rows.first()).toContainText('theo@thistle.test');
  await expect(all.ownerOf('theo@thistle.test')).toHaveText(`Followed up by ${TEST_USER.email}`);
  await all.mine.check();
  await expect(all.rows).toHaveCount(1);
  await page.reload();
  await expect(page).toHaveURL(/status=needs_follow_up/);
  await expect(page).toHaveURL(/mine=1/);
  await expect(all.mine).toBeChecked();
  await expect(all.rows).toHaveCount(1);

  // A row opens the drawer, which decides it; the row follows.
  await all.filter('all');
  await all.mine.uncheck();
  await all.open('ines@loom.test');
  expect(await namelessControls(page), 'the All view, its drawer open').toEqual([]);
  await all.drawerButton('approve').click();
  await expect(all.statusOf('ines@loom.test')).toHaveText('Approved');
  await expect(all.giverOf('ines@loom.test')).toContainText(`Approved by ${TEST_USER.email}`);
});

/**
 * A verdict can change while the review is open, and not once the market is assigning: the verdicts
 * settle on the way in, and a mistake is fixed with a seat (E36/F01/S01).
 */
test('a verdict changes while the review is open, then the drawer only shows it', async ({
  authenticatedPage: page,
  request,
}) => {
  const all = new ApplicationsAllPage(page);
  const { marketId: reviewing } = await seedPhaseMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { intakeMode: 'form' },
  );
  await transitionMarket(request, BACKEND_URL, TEST_USER.email, reviewing, 'applications');
  seedApplicationWithStatus(reviewing, 'reviewer_approved', 'nadia@ember.test');
  await all.goto(reviewing);
  await all.rows.first().getByRole('button').click();
  await expect(all.drawerButton('reject')).toBeVisible();

  const assigning = await seedAssignedMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  await all.goto(assigning.marketId);
  await all.rows.first().getByRole('button').click();
  await expect(all.drawerVerdict).toContainText('Approved');
  await expect(all.drawerButton('approve')).toHaveCount(0);
  await expect(all.drawerButton('reject')).toHaveCount(0);
  // Nor can anything be ticked for a verdict on several.
  await expect(page.getByTestId('applications-all-tick')).toHaveCount(0);
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
  await transitionMarket(request, BACKEND_URL, TEST_USER.email, marketId, 'applications');
  seedApplicationWithStatus(marketId, 'open', 'nadia@ember.test');
  seedApplicationWithStatus(marketId, 'open', 'theo@thistle.test');
  const ines = seedApplicationWithStatus(marketId, 'open', 'ines@loom.test');
  seedApplicationWithStatus(marketId, 'open', 'omar@kiln.test');
  const granted = await request.post(`${BACKEND_URL}/markets/${marketId}/roles`, {
    data: { user_email: SECOND.email, role: 'editor' },
  });
  expect(granted.ok(), await granted.text()).toBeTruthy();

  const all = new ApplicationsAllPage(page);
  await all.goto(marketId);
  await expect(all.rows).toHaveCount(4);

  await withUser(browser, SECOND.email, SECOND.password, async (other) => {
    // The other reviewer opens Nadia's card; once the list knows, she cannot be ticked.
    await other.request.post(`${BACKEND_URL}/markets/${marketId}/review/next`, { data: {} });
    await page.reload();
    await expect(all.tickOf('nadia@ember.test')).toBeDisabled();

    // Theo and Ines ticked; then the other reviewer rejects Ines before the approval lands.
    await all.tickOf('theo@thistle.test').check();
    await all.tickOf('ines@loom.test').check();
    await expect(all.selection).toContainText('2 applications selected');
    const rejected = await other.request.put(
      `${BACKEND_URL}/markets/${marketId}/applications/${ines}/review`,
      { data: { status: 'reviewer_rejected' } },
    );
    expect(rejected.ok()).toBeTruthy();
  });

  // Nothing is written until the count is confirmed.
  await all.decideSelection('approve');
  await expect(all.confirmWindow).toContainText('Approve 2 applications?');
  await all.confirmButton.click();

  await expect(all.result).toContainText('1 application approved; 1 skipped');
  await expect(all.skipped).toHaveText(
    `ines@loom.test: ${SECOND.email} rejected this application since you opened it.`,
  );
  await expect(all.statusOf('theo@thistle.test')).toHaveText('Approved');
  await expect(all.statusOf('ines@loom.test')).toHaveText('Rejected');
  // The rail moves with it: two left, not four.
  await expect(page.getByTestId('phase-rail-next')).toContainText(
    '2 applications are still awaiting review',
  );
  // Omar was never ticked, and is left as he was.
  await expect(all.statusOf('omar@kiln.test')).toHaveText('Open');
});
