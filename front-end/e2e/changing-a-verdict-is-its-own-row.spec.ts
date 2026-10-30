import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import {
  seedApplicationWithStatus,
  seedPhaseMarket,
  transitionMarket,
} from './helpers/seedPhaseMarket';
import { ensureVerifiedUser } from './helpers/verifiedUser';
import { withUser } from './helpers/withUser';
import { ApplicationMonitorPage } from './pages/ApplicationMonitorPage';
import { ApplicationsAllPage } from './pages/ApplicationsAllPage';

/**
 * Giving a verdict and changing one are two rows of the table (E38/F06/S01).
 *
 * An Editor gives verdicts on open applications and follow-ups, and is offered no change to one
 * already approved or rejected - on One by one, in the All view's ticks and Select all, or in the
 * vendor drawer; an Admin is offered each change, and the server takes it.
 */
const PEOPLE = {
  editor: { email: 'e2e-change-editor@example.com', password: 'e2epassword123' },
  admin: { email: 'e2e-change-admin@example.com', password: 'e2epassword123' },
} as const;

const CHANGE_REFUSED =
  'Only an Admin or the owner may change a verdict or overturn an automatic rejection on this market.';

let marketId = '';

test.beforeAll(async ({ request }) => {
  for (const person of Object.values(PEOPLE)) ensureVerifiedUser(person.email, person.password);
  ({ marketId } = await seedPhaseMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password, {
    intakeMode: 'form',
  }));
  await transitionMarket(request, BACKEND_URL, TEST_USER.email, marketId, 'applications');
  seedApplicationWithStatus(marketId, 'open', 'ana@thistle.test');
  seedApplicationWithStatus(marketId, 'reviewer_approved', 'ben@ember.test');
  seedApplicationWithStatus(marketId, 'reviewer_rejected', 'cleo@fern.test');
  seedApplicationWithStatus(marketId, 'open', 'dina@moss.test');
  for (const [role, person] of Object.entries(PEOPLE)) {
    const res = await request.post(`${BACKEND_URL}/markets/${marketId}/roles`, {
      data: { user_email: person.email, role },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
  }
});

test.describe.configure({ mode: 'serial' });

test('an Editor gives a verdict, and is offered no change to one already given', async ({
  browser,
}) => {
  await withUser(browser, PEOPLE.editor.email, PEOPLE.editor.password, async (page) => {
    const review = new ApplicationMonitorPage(page);
    await review.goto(marketId);
    await review.waitForLoaded();

    await review.openDecided();
    await expect(review.decidedReason).toHaveText(CHANGE_REFUSED);
    await expect(review.changeButton('approve')).toHaveCount(0);
    await expect(review.changeButton('reject')).toHaveCount(0);

    // A first verdict is still theirs.
    await review.approve('ana@thistle.test');
    await expect(review.decidedGiverOf('ana@thistle.test')).toHaveText(
      new RegExp(`^Approved by ${PEOPLE.editor.email}, `),
    );
    await expect(review.changeButton('reject')).toHaveCount(0);

    // The All view: no tick on a decided row, said once; Select all ticks the rest and says why.
    const all = new ApplicationsAllPage(page);
    await all.goto(marketId);
    await expect(all.row('ben@ember.test')).toBeVisible({ timeout: 15000 });
    await expect(all.changeReason).toHaveText(CHANGE_REFUSED);
    await expect(all.tickOf('ben@ember.test')).toBeDisabled();
    await expect(all.tickOf('dina@moss.test')).toBeEnabled();
    await all.selectAll.click();
    await expect(all.selection).toContainText('1 application selected');
    await expect(all.selectAllSkipped).toHaveText(
      '3 applications not selected: they already have a verdict, which only an Admin or the owner may change.',
    );
    // That line says why, so the one over the list stands down while it shows.
    await expect(all.changeReason).toHaveCount(0);

    // The drawer of a decided application says why instead of offering a verdict.
    await all.open('ben@ember.test');
    await expect(all.drawerChangeReason).toHaveText(CHANGE_REFUSED);
    await expect(all.drawerButton('approve')).toHaveCount(0);
    await expect(all.drawerButton('reject')).toHaveCount(0);
  });
});

test('an Admin changes a verdict already given', async ({ browser }) => {
  await withUser(browser, PEOPLE.admin.email, PEOPLE.admin.password, async (page) => {
    const review = new ApplicationMonitorPage(page);
    await review.goto(marketId);
    await review.waitForLoaded();

    await review.openDecided();
    await expect(review.decidedReason).toHaveCount(0);
    await review.changeButton('approve', 'cleo@fern.test').click();
    await expect(review.decidedGiverOf('cleo@fern.test')).toHaveText(
      new RegExp(`^Approved by ${PEOPLE.admin.email}, `),
    );

    // The All view offers them every tick, and the drawer every verdict.
    const all = new ApplicationsAllPage(page);
    await all.goto(marketId);
    await expect(all.row('ben@ember.test')).toBeVisible({ timeout: 15000 });
    await expect(all.changeReason).toHaveCount(0);
    await expect(all.tickOf('ben@ember.test')).toBeEnabled();
    await all.open('ben@ember.test');
    await expect(all.drawerChangeReason).toHaveCount(0);
    await all.drawerButton('reject').click();
    await expect(all.statusOf('ben@ember.test')).toHaveText('Rejected');
  });
});
