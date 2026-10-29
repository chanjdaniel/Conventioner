import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { ApplicationMonitorPage } from './pages/ApplicationMonitorPage';
import { ApplicationsAllPage } from './pages/ApplicationsAllPage';
import {
  seedApplicationWithStatus,
  seedPhaseMarket,
  transitionMarket,
} from './helpers/seedPhaseMarket';
import { marketScreenPath } from './helpers/marketScreens';
import { ensureVerifiedUser } from './helpers/verifiedUser';
import { withUser } from './helpers/withUser';

/**
 * Giving a verdict is an Editor's; changing one is an Admin's or the owner's (E38/F06/S01).
 *
 * One gate covered both, so an Editor was offered "Approve instead" on every rejection, an
 * automatic one included. An Editor now gives verdicts on open applications and follow-ups and is
 * offered no change on a decided one, on any screen, and the server refuses one; an Admin changes
 * them.
 */
const EDITOR = { email: 'e2e-changer-editor@example.com', password: 'e2echangereditor1' };
const ADMIN = { email: 'e2e-changer-admin@example.com', password: 'e2echangeradmin1' };
const CHANGING = 'Only an Admin or the owner of this market changes a verdict already given.';

test('an Editor gives verdicts and changes none; an Admin changes them', async ({
  browser,
  request,
}) => {
  ensureVerifiedUser(EDITOR.email, EDITOR.password);
  ensureVerifiedUser(ADMIN.email, ADMIN.password);
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
  await transitionMarket(request, BACKEND_URL, TEST_USER.email, marketId, 'applications_closed');
  await transitionMarket(request, BACKEND_URL, TEST_USER.email, marketId, 'review');
  for (const [person, role] of [
    [EDITOR, 'editor'],
    [ADMIN, 'admin'],
  ] as const) {
    const granted = await request.post(`${BACKEND_URL}/markets/${marketId}/roles`, {
      data: { user_email: person.email, role },
    });
    expect(granted.ok(), await granted.text()).toBeTruthy();
  }
  // The owner rejected Theo.
  const rejected = await request.put(
    `${BACKEND_URL}/markets/${marketId}/applications/${theo}/review`,
    { data: { status: 'reviewer_rejected' } },
  );
  expect(rejected.ok(), await rejected.text()).toBeTruthy();

  await withUser(browser, EDITOR.email, EDITOR.password, async (page) => {
    await page.goto(marketScreenPath(marketId, 'applications'));
    const monitor = new ApplicationMonitorPage(page);
    await monitor.waitForLoaded();
    // A first verdict is theirs.
    await monitor.approve('nadia@ember.test');

    // A change is not: no "Approve instead" or "Reject instead", and the reason said once.
    await monitor.openDecided();
    await expect(monitor.decidedRows).toHaveCount(2);
    await expect(monitor.insteadOf('theo@thistle.test', 'approve')).toHaveCount(0);
    await expect(monitor.insteadOf('nadia@ember.test', 'reject')).toHaveCount(0);
    await expect(monitor.decidedLocked).toHaveText(CHANGING);

    // Nor in the All view: a decided row takes no tick, its drawer no verdict.
    const all = new ApplicationsAllPage(page);
    await all.goto(marketId);
    await expect(all.rows).toHaveCount(2);
    await expect(all.tickOf('theo@thistle.test')).toBeDisabled();
    await expect(all.tickOf('theo@thistle.test')).toHaveAttribute(
      'aria-label',
      `theo@thistle.test: ${CHANGING}`,
    );
    await all.open('theo@thistle.test');
    await expect(all.drawerButton('approve')).toHaveCount(0);
    await expect(all.drawerLocked).toHaveText(CHANGING);

    // And the server refuses the write the screens do not offer.
    const changed = await page.request.put(
      `${BACKEND_URL}/markets/${marketId}/applications/${theo}/review`,
      { data: { status: 'reviewer_approved' } },
    );
    expect(changed.status()).toBe(403);
    expect((await changed.json()).error).toBe(CHANGING);
  });

  await withUser(browser, ADMIN.email, ADMIN.password, async (page) => {
    await page.goto(marketScreenPath(marketId, 'applications'));
    const monitor = new ApplicationMonitorPage(page);
    await monitor.waitForLoaded();
    await monitor.openDecided();
    await expect(monitor.decidedLocked).toHaveCount(0);
    await monitor.insteadOf('theo@thistle.test', 'approve').click();
    await expect(monitor.decidedStatusOf('theo@thistle.test')).toHaveText('Approved');
    await expect(monitor.decidedRow('theo@thistle.test')).toContainText(
      `Approved by ${ADMIN.email}`,
    );
  });
});
