import type { Page } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { marketScreenPath, marketSetupPath } from './helpers/marketScreens';
import { seedAssignedMarket } from './helpers/seedAssignedMarket';
import {
  seedApplicationWithStatus,
  seedPhaseMarket,
  transitionMarket,
} from './helpers/seedPhaseMarket';
import { seedPublishedMarketWithAssignments } from './helpers/seeds';
import { ensureVerifiedUser } from './helpers/verifiedUser';
import { withUser } from './helpers/withUser';
import { ApplicationMonitorPage } from './pages/ApplicationMonitorPage';

/**
 * Every screen offers a control on the table's answer for the action it takes (E39/F01/S02).
 *
 * The screens read five role-shaped reasons from the market read, each standing for several
 * actions, and Manage market compared roles itself. They now ask the table's answer per action,
 * which the read serves for the person asking. Nothing anyone is offered changed: a Viewer, an
 * Editor and an Admin each walk Market Setup, Applications, the Assignment tab and Attendance, and
 * each is offered exactly what the built-in table lets their role do.
 */
const PEOPLE = {
  viewer: { email: 'e2e-table-viewer@example.com', password: 'e2epassword123' },
  editor: { email: 'e2e-table-editor@example.com', password: 'e2epassword123' },
  admin: { email: 'e2e-table-admin@example.com', password: 'e2epassword123' },
} as const;
type Role = keyof typeof PEOPLE;

/** What each role may do by the built-in table: Editor rows, and the Admin ones. */
const MAY = {
  viewer: { edits: false, administers: false },
  editor: { edits: true, administers: false },
  admin: { edits: true, administers: true },
} as const;

const ARTICLE: Record<Role, string> = { viewer: 'a', editor: 'an', admin: 'an' };

/** One market in each phase the walk needs: a plan to edit, a review, a run, and the door. */
const markets = { draft: '', review: '', assignment: '', marketDays: '' };

test.beforeAll(async ({ request }) => {
  for (const person of Object.values(PEOPLE)) ensureVerifiedUser(person.email, person.password);

  ({ marketId: markets.draft } = await seedPhaseMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  ));

  ({ marketId: markets.review } = await seedPhaseMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { intakeMode: 'form' },
  ));
  await transitionMarket(request, BACKEND_URL, TEST_USER.email, markets.review, 'applications');
  seedApplicationWithStatus(markets.review, 'open', 'ana@thistle.test');
  seedApplicationWithStatus(markets.review, 'open', 'ben@ember.test');

  ({ marketId: markets.assignment } = await seedAssignedMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  ));

  ({ marketId: markets.marketDays } = await seedPublishedMarketWithAssignments(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  ));

  // The seeds sign the request in as the owner, who gives each person their role on each market.
  for (const marketId of Object.values(markets)) {
    for (const [role, person] of Object.entries(PEOPLE)) {
      const res = await request.post(`${BACKEND_URL}/markets/${marketId}/roles`, {
        data: { user_email: person.email, role },
      });
      expect(res.ok(), await res.text()).toBeTruthy();
    }
  }
});

/** A control is offered, or it is not on the page at all. */
async function offered(page: Page, testId: string, yes: boolean): Promise<void> {
  if (yes) await expect(page.getByTestId(testId).first()).toBeVisible({ timeout: 15000 });
  else await expect(page.getByTestId(testId)).toHaveCount(0);
}

/** The phase moves are offered to whoever may move the phase, and the rail stands for everyone. */
async function railOffersMoves(page: Page, yes: boolean): Promise<void> {
  await expect(page.getByTestId('phase-rail')).toBeVisible({ timeout: 15000 });
  await offered(page, 'phase-rail-menu-button', yes);
}

for (const role of Object.keys(PEOPLE) as Role[]) {
  const { edits, administers } = MAY[role];

  test(`${ARTICLE[role]} ${role} is offered on every screen what the table lets them do`, async ({
    browser,
  }) => {
    const person = PEOPLE[role];
    await withUser(browser, person.email, person.password, async (page) => {
      // Market Setup, in draft: the plan is the Market Setup row's, the moves the phase row's.
      await page.goto(marketSetupPath(markets.draft, 'setup'));
      const dates = page.getByTestId('plan-card-dates').getByRole('button').first();
      await expect(dates).toBeVisible({ timeout: 15000 });
      if (edits) await expect(dates).toBeEnabled();
      else await expect(dates).toBeDisabled();
      await railOffersMoves(page, administers);
      // The frame says once why someone may change nothing, and to nobody else.
      await expect(page.getByTestId('market-read-only')).toHaveCount(edits ? 0 : 1);

      // Applications, in review: verdicts are the verdicts row's, the card's highlights the
      // form's, publishing the Publish results row's.
      await page.goto(marketSetupPath(markets.review, 'applications'));
      const review = new ApplicationMonitorPage(page);
      await review.waitForLoaded();
      await expect(review.email).toBeVisible();
      await offered(page, 'app-monitor-approve-button', edits);
      await offered(page, 'app-monitor-reject-button', edits);
      await offered(page, 'app-monitor-choose-highlights', edits);
      await offered(page, 'app-monitor-publish-button', administers);
      await railOffersMoves(page, administers);

      // The Assignment tab, in assignment: running it and placing seats are the Assignment row's.
      await page.goto(marketSetupPath(markets.assignment, 'assignment'));
      await expect(page.getByTestId('assignment-card-priority')).toBeVisible({ timeout: 15000 });
      await offered(page, 'market-setup-assign-button', edits);
      await page.goto(marketScreenPath(markets.assignment, 'result'));
      await expect(page.getByTestId('tables-seat-occupied').first()).toBeVisible({
        timeout: 15000,
      });
      await offered(page, 'tables-seat-change', edits);
      await railOffersMoves(page, administers);

      // Attendance, on the day: checking in is the door's row.
      await page.goto(marketScreenPath(markets.marketDays, 'attendance'));
      await expect(page.getByTestId('attendance-row').first()).toBeVisible({ timeout: 15000 });
      await offered(page, 'attendance-check-in', edits);
      await railOffersMoves(page, administers);
    });
  });
}
