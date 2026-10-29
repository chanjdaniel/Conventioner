import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { ApplicationMonitorPage } from './pages/ApplicationMonitorPage';
import {
  seedApplicationWithStatus,
  seedPhaseMarket,
  transitionMarket,
} from './helpers/seedPhaseMarket';
import { oneByOnePath } from './helpers/marketScreens';
import { ensureVerifiedUser } from './helpers/verifiedUser';
import { withUser } from './helpers/withUser';

/**
 * Every verdict says who gave it, and a reviewer gives one at EDITOR (E34/F01/S01).
 *
 * The organizers review as a team. A verdict recorded nobody, and giving one needed ADMIN, which
 * also moves the market's phase. Now an EDITOR reviews, and the review says who decided what; a
 * VIEWER reads it all and decides nothing; and the phase is still ADMIN's.
 */
const EDITOR = { email: 'e2e-reviewer-editor@example.com', password: 'e2ereviewereditor1' };
const VIEWER = { email: 'e2e-reviewer-viewer@example.com', password: 'e2ereviewerviewer1' };

test('an editor decides and is named; a viewer decides nothing; the phase stays ADMIN', async ({
  browser,
  request,
}) => {
  ensureVerifiedUser(EDITOR.email, EDITOR.password);
  ensureVerifiedUser(VIEWER.email, VIEWER.password);
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
  await transitionMarket(request, BACKEND_URL, TEST_USER.email, marketId, 'applications_closed');
  await transitionMarket(request, BACKEND_URL, TEST_USER.email, marketId, 'review');
  for (const [person, role] of [
    [EDITOR, 'editor'],
    [VIEWER, 'viewer'],
  ] as const) {
    const granted = await request.post(`${BACKEND_URL}/markets/${marketId}/roles`, {
      data: { user_email: person.email, role },
    });
    expect(granted.ok(), await granted.text()).toBeTruthy();
  }

  await withUser(browser, EDITOR.email, EDITOR.password, async (page) => {
    await page.goto(oneByOnePath(marketId));
    const monitor = new ApplicationMonitorPage(page);
    await monitor.waitForLoaded();
    await monitor.reject('theo@thistle.test');
    await monitor.openDecided();
    await expect(page.getByTestId('app-monitor-decided-giver')).toHaveText(
      new RegExp(`^Rejected by ${EDITOR.email}, `),
    );
    // Deciding is not moving the market: the rail offers an editor no move.
    await expect(page.getByTestId('phase-transition-assignment')).toHaveCount(0);
    const moved = await page.request.post(`${BACKEND_URL}/markets/${marketId}/transition`, {
      data: { toPhase: 'applications_closed' },
    });
    expect(moved.status()).toBe(403);
  });

  await withUser(browser, VIEWER.email, VIEWER.password, async (page) => {
    await page.goto(oneByOnePath(marketId));
    const monitor = new ApplicationMonitorPage(page);
    await monitor.waitForLoaded();
    await expect(monitor.approveButton).toHaveCount(0);
    await expect(monitor.rejectButton).toHaveCount(0);
    await monitor.openDecided();
    await expect(page.getByTestId('app-monitor-decided-giver')).toContainText(EDITOR.email);
  });
});
