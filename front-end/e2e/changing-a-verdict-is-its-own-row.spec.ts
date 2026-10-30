import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { marketSetupPath } from './helpers/marketScreens';
import {
  seedApplicationWithStatus,
  seedPhaseMarket,
  transitionMarket,
} from './helpers/seedPhaseMarket';
import { ensureVerifiedUser } from './helpers/verifiedUser';
import { withUser } from './helpers/withUser';
import { ApplicationMonitorPage } from './pages/ApplicationMonitorPage';

/**
 * Giving a verdict and changing one are two rows of the table (E38/F06/S01).
 *
 * An Editor gives verdicts on open applications and follow-ups, and is offered no change to one
 * already approved or rejected; an Admin is offered each change, "Approve instead" and "Reject
 * instead", and the server takes it.
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
    await page.goto(marketSetupPath(marketId, 'applications'));
    const review = new ApplicationMonitorPage(page);
    await review.waitForLoaded();

    await review.openDecided();
    await expect(review.decidedReason).toHaveText(CHANGE_REFUSED);
    await expect(page.getByTestId('app-monitor-decided-approve-button')).toHaveCount(0);
    await expect(page.getByTestId('app-monitor-decided-reject-button')).toHaveCount(0);

    // A first verdict is still theirs.
    await review.approve('ana@thistle.test');
    await expect(
      review.decidedRow('ana@thistle.test').getByTestId('app-monitor-decided-giver'),
    ).toHaveText(new RegExp(`^Approved by ${PEOPLE.editor.email}, `));
    await expect(page.getByTestId('app-monitor-decided-reject-button')).toHaveCount(0);
  });
});

test('an Admin changes a verdict already given', async ({ browser }) => {
  await withUser(browser, PEOPLE.admin.email, PEOPLE.admin.password, async (page) => {
    await page.goto(marketSetupPath(marketId, 'applications'));
    const review = new ApplicationMonitorPage(page);
    await review.waitForLoaded();

    await review.openDecided();
    await expect(review.decidedReason).toHaveCount(0);
    const cleo = review.decidedRow('cleo@fern.test');
    await cleo.getByTestId('app-monitor-decided-approve-button').click();
    await expect(cleo.getByTestId('app-monitor-decided-giver')).toHaveText(
      new RegExp(`^Approved by ${PEOPLE.admin.email}, `),
    );
  });
});
