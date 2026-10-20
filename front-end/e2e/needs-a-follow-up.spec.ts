import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { ApplicationMonitorPage } from './pages/ApplicationMonitorPage';
import {
  seedApplicationWithStatus,
  seedPhaseMarket,
  transitionMarket,
} from './helpers/seedPhaseMarket';
import { marketScreenPath } from './helpers/marketScreens';
import { mongoEval } from './helpers/mongo';
import { ensureVerifiedUser } from './helpers/verifiedUser';
import { namelessControls } from './helpers/accessibleNames';

/**
 * An application can need a follow-up, and someone owns it (E34/F02/S01).
 *
 * Skip recorded nothing, so an application waiting on its applicant looked like one nobody had
 * opened. S marks it now: the reviewer owns it unless they hand it to someone else on the market,
 * and what is needed goes in the vendor's notes. It leaves the queue unless asked for, and holds
 * Begin Assignment, which says so.
 */
const EDITOR = { email: 'e2e-follow-up-editor@example.com', password: 'e2efollowupeditor1' };

test('a follow-up is marked, waits out of the queue, holds the market, and is handed on', async ({
  authenticatedPage: page,
  request,
}) => {
  ensureVerifiedUser(EDITOR.email, EDITOR.password);
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
  await transitionMarket(request, BACKEND_URL, TEST_USER.email, marketId, 'applications_closed');
  await transitionMarket(request, BACKEND_URL, TEST_USER.email, marketId, 'review');
  const granted = await request.post(`${BACKEND_URL}/markets/${marketId}/roles`, {
    data: { user_email: EDITOR.email, role: 'editor' },
  });
  expect(granted.ok(), await granted.text()).toBeTruthy();
  // The organizer already knows Nadia: a note is there before anyone reviews her.
  const noted = await request.put(
    `${BACKEND_URL}/markets/${marketId}/vendor-notes/${encodeURIComponent('nadia@ember.test')}`,
    { data: { note: 'Met at the spring fair' } },
  );
  expect(noted.ok(), await noted.text()).toBeTruthy();

  await page.goto(marketScreenPath(marketId, 'applications'));
  const monitor = new ApplicationMonitorPage(page);
  await monitor.waitForLoaded();
  await expect(monitor.email).toHaveText('nadia@ember.test');

  // S, as Skip was: the dialog asks who will follow up, the reviewer by default, and what for.
  await page.keyboard.press('s');
  const dialog = page.getByTestId('follow-up-window');
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('follow-up-owner')).toHaveValue(TEST_USER.email);
  expect(await namelessControls(page), 'the follow-up dialog').toEqual([]);
  // The box opens on the note already there, so adding to it never writes over it unseen.
  const box = page.getByTestId('follow-up-note');
  await expect(box).toHaveValue('Met at the spring fair');
  await box.fill('Met at the spring fair. Ask for a portfolio link');
  await page.getByTestId('follow-up-submit-button').click();
  await expect(dialog).toBeHidden();

  // Out of the walk: Theo is next, and the follow-up is counted beside the queue.
  await expect(monitor.email).toHaveText('theo@thistle.test');
  await expect(page.getByTestId('app-monitor-include-follow-ups')).toBeVisible();
  const stored = JSON.parse(
    mongoEval(
      `JSON.stringify(db.applications.findOne({ id: ${JSON.stringify(nadia)} }, ` +
        `{ _id: 0, status: 1, follow_up_owner: 1, 'verdict_by.email': 1 }))`,
    ),
  );
  expect(stored).toMatchObject({
    status: 'needs_follow_up',
    follow_up_owner: { email: TEST_USER.email },
    verdict_by: { email: TEST_USER.email },
  });

  // It holds Begin Assignment as an undecided application would, and the rail says why.
  await monitor.approve('theo@thistle.test');
  await expect(page.getByTestId('phase-rail-next')).toContainText(
    '1 application needs a follow-up',
  );

  // Asked for, it is back - its note kept - and handed to someone else on the market.
  await page.getByTestId('app-monitor-include-follow-ups').check();
  await expect(monitor.email).toHaveText('nadia@ember.test');
  await expect(page.getByTestId('app-monitor-notes-note-input')).toHaveValue(
    'Met at the spring fair. Ask for a portfolio link',
  );
  const handed = page.waitForResponse((r) => r.url().endsWith('/follow-up-owner'));
  await page.getByTestId('app-monitor-follow-up-owner').selectOption(EDITOR.email);
  expect((await handed).ok()).toBeTruthy();
  expect(
    mongoEval(`db.applications.findOne({ id: ${JSON.stringify(nadia)} }).follow_up_owner.email`),
  ).toBe(EDITOR.email);
});
