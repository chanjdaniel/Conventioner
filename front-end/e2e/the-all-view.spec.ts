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

    // The tab opens on All, with nothing in the address to say so (E38/F05/S01).
    await page.goto(marketScreenPath(marketId, 'applications'));
    await expect(all.rows).toHaveCount(3);
    await expect(page).not.toHaveURL(/view=/);
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
 * All comes first and is the default, and both controls say what they are in words that are also
 * their names (E38/F05/S01); saved links to All, and to One by one at an application, still open
 * what they did.
 */
test('the review opens on All, its views and its filter named on screen', async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketId } = await seedPhaseMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { intakeMode: 'form' },
  );
  await transitionMarket(request, BACKEND_URL, TEST_USER.email, marketId, 'applications_open');
  const all = new ApplicationsAllPage(page);
  // Before anyone applies, it says nothing has come in, not that nothing matches.
  await page.goto(marketScreenPath(marketId, 'applications'));
  await expect(page.getByTestId('applications-all-empty')).toHaveText(
    'No applications received yet.',
  );

  seedApplicationWithStatus(marketId, 'open', 'nadia@ember.test');
  const theo = seedApplicationWithStatus(marketId, 'open', 'theo@thistle.test');
  await page.reload();
  const views = page.getByRole('group', { name: 'How do you want to review?' });
  await expect(views.getByRole('button')).toHaveText(['All', 'One by one']);
  await expect(views.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
  const filter = page.getByRole('group', { name: 'Filter' });
  await expect(filter.getByRole('button')).toHaveText([
    'Any status',
    'Open',
    'Needs follow-up',
    'Approved',
    'Rejected',
  ]);
  await expect(page.getByText('Open is not decided yet.')).toBeVisible();
  expect(await namelessControls(page), 'the All view').toEqual([]);

  // "Open" keeps the address it had as "To review", and lists what awaits a verdict.
  await all.filter('undecided');
  await expect(page).toHaveURL(/status=undecided/);
  await expect(all.rows).toHaveCount(2);

  // One by one has its own address, and All drops it again.
  await views.getByRole('button', { name: 'One by one' }).click();
  await expect(page).toHaveURL(/view=one/);
  await expect(page.getByTestId('app-monitor-card')).toBeVisible();
  await views.getByRole('button', { name: 'All' }).click();
  await expect(page).not.toHaveURL(/view=/);
  await expect(all.rows).toHaveCount(2);

  // A saved link to All, and a link to one application, open what they did.
  await all.goto(marketId);
  await expect(all.rows).toHaveCount(2);
  await page.goto(`${marketScreenPath(marketId, 'applications')}?application=${theo}`);
  await expect(page.getByTestId('app-monitor-email')).toHaveText('theo@thistle.test');
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

/**
 * Select all ticks the rows the filter shows, and only those (E38/F05/S02): a row another reviewer
 * has open is left, and said so; the verdict is still confirmed by its count.
 */
test('Select all ticks the open rows shown, skipping the one held elsewhere', async ({
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
  const nadia = seedApplicationWithStatus(marketId, 'open', 'nadia@ember.test');
  seedApplicationWithStatus(marketId, 'open', 'theo@thistle.test');
  seedApplicationWithStatus(marketId, 'open', 'ines@loom.test');
  seedApplicationWithStatus(marketId, 'reviewer_approved', 'omar@kiln.test');
  await transitionMarket(request, BACKEND_URL, TEST_USER.email, marketId, 'applications_closed');
  await transitionMarket(request, BACKEND_URL, TEST_USER.email, marketId, 'review');
  const granted = await request.post(`${BACKEND_URL}/markets/${marketId}/roles`, {
    data: { user_email: SECOND.email, role: 'editor' },
  });
  expect(granted.ok(), await granted.text()).toBeTruthy();

  const all = new ApplicationsAllPage(page);
  await withUser(browser, SECOND.email, SECOND.password, async (other) => {
    // The other reviewer is handed the first card, Nadia's.
    await other.request.post(`${BACKEND_URL}/markets/${marketId}/review/next`, { data: {} });
  });
  await all.goto(marketId);
  await all.filter('undecided');
  await expect(all.rows).toHaveCount(3);
  await expect(all.tickOf('nadia@ember.test')).toBeDisabled();

  await all.selectAll.click();
  await expect(all.tickOf('theo@thistle.test')).toBeChecked();
  await expect(all.tickOf('ines@loom.test')).toBeChecked();
  await expect(all.tickOf('nadia@ember.test')).not.toBeChecked();
  await expect(all.selectAllSkipped).toHaveText(
    '1 application not selected: another reviewer has it open.',
  );
  await expect(all.selection).toContainText('2 applications selected');

  // The other reviewer lets Nadia's card go: once the list is read again, nothing is held, so the
  // line no longer says so; the ticks stay as they were.
  await withUser(browser, SECOND.email, SECOND.password, async (other) => {
    const released = await other.request.delete(
      `${BACKEND_URL}/markets/${marketId}/applications/${nadia}/claim`,
    );
    expect(released.ok(), await released.text()).toBeTruthy();
  });
  await page.getByTestId('applications-refresh').click();
  await expect(all.tickOf('nadia@ember.test')).toBeEnabled();
  await expect(all.selectAllSkipped).toHaveCount(0);
  await expect(all.selection).toContainText('2 applications selected');

  // Every status shows the approved row too; it was not ticked, and the open ones stay ticked.
  await all.filter('all');
  await expect(all.rows).toHaveCount(4);
  await expect(all.tickOf('omar@kiln.test')).not.toBeChecked();
  await expect(all.selection).toContainText('2 applications selected');
  await expect(all.selectAllSkipped).toHaveCount(0);

  // A filter that hides the ticked rows unticks them, and Clear clears, as before.
  await all.filter('reviewer_approved');
  await expect(all.selection).toHaveCount(0);
  await all.filter('undecided');
  await all.selectAll.click();
  await page.getByTestId('applications-all-selection-clear').click();
  await expect(all.selection).toHaveCount(0);
  await expect(all.tickOf('theo@thistle.test')).not.toBeChecked();

  // Decided by count, as a selection ticked by hand is.
  await all.selectAll.click();
  await all.decideSelection('approve');
  // Nadia was let go, so Select all takes her too now.
  await expect(all.confirmWindow).toContainText('Approve 3 applications?');
  await all.confirmButton.click();
  await expect(all.result).toContainText('3 applications approved.');
  await expect(all.rows).toHaveCount(0);
});
