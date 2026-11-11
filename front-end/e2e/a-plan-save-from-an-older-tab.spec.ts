import { test, expect, TEST_USER, BACKEND_URL, MarketSetupPage } from './fixtures';
import { planSetupObject, seedApplicantMarket } from './helpers/seedApplicantMarket';
import { marketSetupPath } from './helpers/marketScreens';
import { upcomingSaturday } from './helpers/upcoming';

/**
 * Two tabs of one organizer on Market Setup of one draft (ADR 0024, T274).
 *
 * The plan saves itself whole. Tab B, opened before tab A saved, used to store its older copy over
 * A's: A's new market date was gone, and both tabs said "Plan saved". The plan now carries the
 * revision its copy came from, so B's save is refused in the server's words, B shows the plan as A
 * left it, and nothing of B's is stored.
 */

const PLAN_WRITE = /\/markets\/[^/]+\/plan$/;

interface StoredPlan {
  marketDates: { date: string }[];
  sections: { name: string }[];
}

test('a plan save from a tab opened before another saved is refused, and shows what that one saved', async ({
  authenticatedPage: pageA,
  request,
}) => {
  const held = upcomingSaturday(0);
  const added = upcomingSaturday(1);
  const { marketId } = await seedApplicantMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { draft: true, setupObject: planSetupObject([held]) },
  );
  const pageB = await pageA.context().newPage();
  await pageB.goto(marketSetupPath(marketId));
  await expect(pageB.getByTestId('setup-section-name-input-1')).toHaveValue('Garden');

  await pageA.goto(marketSetupPath(marketId));
  await new MarketSetupPage(pageA).addMarketDate(added);
  await expect(pageA.getByTestId('market-setup-plan-saved')).toBeVisible();

  const refusal = pageB.waitForResponse(
    (res) => res.request().method() === 'PUT' && PLAN_WRITE.test(res.url()),
  );
  await pageB.getByTestId('setup-section-name-input-1').fill('Courtyard');
  expect((await refusal).status()).toBe(409);

  const line = pageB.getByTestId('market-setup-plan-refused');
  await expect(line).toContainText(
    'This market changed while you were working on it, so your change was not saved. ' +
      'Reload to see the latest, then make your change again.',
  );
  await expect(pageB.getByTestId('market-setup-plan-saved')).toHaveCount(0);
  // B shows the plan as A left it: A's date, and B's rename gone.
  await expect(pageB.getByTestId(`setup-dates-day-${added}`)).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(pageB.getByTestId('setup-section-name-input-1')).toHaveValue('Garden');

  const res = await request.get(`${BACKEND_URL}/markets/${marketId}`);
  const { market } = (await res.json()) as { market: { setupObject: StoredPlan } };
  expect(market.setupObject.marketDates.map((d) => d.date)).toEqual([held, added]);
  expect(market.setupObject.sections.map((s) => s.name)).toEqual(['Main Hall', 'Garden']);
  await pageB.close();
});
