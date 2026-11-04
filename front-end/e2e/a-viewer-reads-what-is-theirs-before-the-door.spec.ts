import type { Page } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { seedAssignedMarket } from './helpers/seedAssignedMarket';
import {
  seedApplicationWithStatus,
  seedPhaseMarket,
  transitionMarket,
} from './helpers/seedPhaseMarket';
import { ensureVerifiedUser } from './helpers/verifiedUser';
import { LoginPage } from './pages/LoginPage';

/**
 * A Viewer reads what they may do on a market whose step onward is refused (E38/F15/S04).
 *
 * The server serves a step's blockers to everyone, so a Viewer in the stage with an application
 * waiting read the reviewer's own sentence ("review them as they arrive. Finish deciding: ..."),
 * and in Assignment on a form market the publisher's ("Publish the results before the market goes
 * live."). A blocker now reads only to someone who may put it right: an Editor reviews, so reads
 * the stage's blocker, and may change the seats but not publish results, so reads in Assignment
 * what is theirs and who does the rest.
 */
const VIEWER = { email: 'e2e-rail-viewer@example.com', password: 'e2epassword123' };
const EDITOR = { email: 'e2e-rail-editor@example.com', password: 'e2epassword123' };

const SIZES = [
  {
    name: 'on a phone',
    use: {
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 3,
    },
  },
  { name: 'at a desk', use: { viewport: { width: 1440, height: 900 } } },
] as const;

const STAGE_ONLOOKER =
  'Applications are open on the application page. Read where each application stands.';
const ASSIGNED_ONLOOKER =
  'Tables are allocated, and the market is not published yet. Read the assignments.';

let stageId: string;
let assignedId: string;

async function signIn(page: Page, person: { email: string; password: string }, width: number) {
  const login = new LoginPage(page);
  await login.login(person.email, person.password);
  await login.waitForMarkets();
  expect(await page.evaluate(() => window.innerWidth)).toBe(width);
}

/** The rail's sentence, without the link that follows it. */
function railSentence(page: Page) {
  return page.getByTestId('phase-rail-next');
}

test.beforeAll(async ({ request }) => {
  ensureVerifiedUser(VIEWER.email, VIEWER.password);
  ensureVerifiedUser(EDITOR.email, EDITOR.password);

  ({ marketId: stageId } = await seedPhaseMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { intakeMode: 'form' },
  ));
  await transitionMarket(request, BACKEND_URL, TEST_USER.email, stageId, 'applications');
  seedApplicationWithStatus(stageId, 'open', 'waiting@example.com');

  ({ marketId: assignedId } = await seedAssignedMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { intakeMode: 'form' },
  ));

  // The seeds leave the owner's session on `request`: they give each person their role.
  for (const marketId of [stageId, assignedId]) {
    for (const [person, role] of [
      [VIEWER, 'viewer'],
      [EDITOR, 'editor'],
    ] as const) {
      const res = await request.post(`${BACKEND_URL}/markets/${marketId}/roles`, {
        data: { user_email: person.email, role },
      });
      expect(res.ok(), await res.text()).toBeTruthy();
    }
  }
});

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use(size.use);

    const width = size.use.viewport.width;

    test('a Viewer reads what they may do in the stage and in Assignment, never the blocker', async ({
      page,
    }) => {
      await signIn(page, VIEWER, width);

      await page.goto(`/markets/${stageId}/applications`);
      await expect(railSentence(page)).toContainText(STAGE_ONLOOKER, { timeout: 15000 });
      await expect(railSentence(page)).not.toContainText(/review them|Finish deciding/);

      await page.goto(`/markets/${assignedId}/assignments`);
      await expect(railSentence(page)).toContainText(ASSIGNED_ONLOOKER, { timeout: 15000 });
      await expect(railSentence(page)).not.toContainText(/Publish the results/);
    });

    test('an Editor reads the stage blocker, which is theirs, and their own work in Assignment', async ({
      page,
    }) => {
      await signIn(page, EDITOR, width);

      await page.goto(`/markets/${stageId}/applications`);
      await expect(railSentence(page)).toContainText(
        'Applications are open on your application page: review them as they arrive. Finish deciding: 1 application is still awaiting review.',
        { timeout: 15000 },
      );

      await page.goto(`/markets/${assignedId}/assignments`);
      await expect(railSentence(page)).toContainText(
        'Check the assignments; the results are published by whoever may publish them.',
        { timeout: 15000 },
      );
      await expect(railSentence(page)).not.toContainText(/Publish the results/);
    });
  });
}
