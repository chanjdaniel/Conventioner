import type { Page, Request } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL, MarketSetupPage } from './fixtures';
import { seedDraftMarket } from './helpers/seedDraftMarket';
import { planSetupObject, seedApplicantMarket } from './helpers/seedApplicantMarket';
import { marketSetupPath } from './helpers/marketScreens';
import { upcomingSaturday } from './helpers/upcoming';

/**
 * The plan autosave sends one save at a time (T271).
 *
 * The plan saves itself 600 ms after each edit, and nothing used to hold a second save while the
 * first was still out. When the first reached the server last, the older plan was what the server
 * stored, and the page then took that older plan back over the organizer's newer edit, beside a
 * green "Plan saved".
 */

const PLAN_WRITE = /\/markets\/[^/]+\/plan$/;

function isPlanWrite(req: Request): boolean {
  return req.method() === 'PUT' && PLAN_WRITE.test(req.url());
}

/** How many plan writes were ever out at once, from the page's side. */
function watchPlanWrites(page: Page): { mostAtOnce: () => number } {
  let out = 0;
  let most = 0;
  const done = (req: Request) => {
    if (isPlanWrite(req)) out -= 1;
  };
  page.on('request', (req) => {
    if (!isPlanWrite(req)) return;
    out += 1;
    most = Math.max(most, out);
  });
  page.on('requestfinished', done);
  page.on('requestfailed', done);
  return { mostAtOnce: () => most };
}

async function storedDates(
  request: Parameters<typeof seedDraftMarket>[0],
  marketId: string,
): Promise<string[]> {
  const res = await request.get(`${BACKEND_URL}/markets/${marketId}`);
  const { market } = (await res.json()) as {
    market: { setupObject?: { marketDates?: { date: string }[] } };
  };
  return (market.setupObject?.marketDates ?? []).map((d) => d.date);
}

test.describe('The plan saves one at a time', () => {
  test('a slow first save never stores an older plan over the last edit', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { marketId } = await seedDraftMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );
    const first = upcomingSaturday(0);
    const second = upcomingSaturday(1);

    // The first save is slow on the wire: it reaches the server about three seconds after it was
    // sent. Every later one goes straight through.
    let held = false;
    let releaseAnswered: () => void = () => {};
    const heldAnswered = new Promise<void>((resolve) => (releaseAnswered = resolve));
    await page.route(PLAN_WRITE, async (route) => {
      if (route.request().method() !== 'PUT' || held) return route.continue();
      held = true;
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      await route.continue();
    });
    page.on('requestfinished', (req) => {
      if (isPlanWrite(req) && JSON.stringify(req.postDataJSON()).includes(first)) {
        if (!JSON.stringify(req.postDataJSON()).includes(second)) releaseAnswered();
      }
    });
    const writes = watchPlanWrites(page);

    await page.goto(marketSetupPath(marketId));
    const setup = new MarketSetupPage(page);
    const firstSent = page.waitForRequest(isPlanWrite);
    await setup.addMarketDate(first);
    // Past the pause: the first save is out.
    await firstSent;
    await setup.addMarketDate(second);

    await heldAnswered;
    await expect(page.getByTestId('market-setup-plan-saved')).toBeVisible();
    expect(await storedDates(request, marketId)).toEqual([first, second]);
    await expect(page.getByTestId(`setup-dates-day-${second}`)).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(writes.mostAtOnce()).toBe(1);
  });

  test('a refused save puts the plan back as the server holds it, and says why', async ({
    authenticatedPage: page,
    request,
  }) => {
    const held = upcomingSaturday(0);
    const refused = upcomingSaturday(1);
    const { marketId } = await seedApplicantMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
      { draft: true, setupObject: planSetupObject([held]) },
    );

    await page.goto(marketSetupPath(marketId));
    const setup = new MarketSetupPage(page);
    await expect(page.getByTestId(`setup-dates-day-${held}`)).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // Another tab of theirs opens applications, which settles the setup; this tab has not heard.
    const opened = await request.post(`${BACKEND_URL}/markets/${marketId}/transition`, {
      headers: { 'Content-Type': 'application/json' },
      data: { toPhase: 'applications' },
    });
    expect(opened.ok()).toBe(true);

    const refusal = page.waitForResponse((res) => isPlanWrite(res.request()));
    await setup.addMarketDate(refused);
    expect((await refusal).status()).toBe(400);

    const line = page.getByTestId('market-setup-plan-refused');
    await expect(line).toContainText('The setup is settled');
    await expect(line).toContainText('The plan is back as it was last saved.');
    await expect(page.getByTestId('market-setup-plan-retry-button')).toHaveCount(0);
    // The refused date is off the screen, which shows the plan the server holds.
    await expect(page.getByTestId(`setup-dates-day-${refused}`)).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(await storedDates(request, marketId)).toEqual([held]);

    // A later re-read reaches the screen: coming back to the tab reads the market again.
    const reread = page.waitForResponse(
      (res) => res.request().method() === 'GET' && res.url().endsWith(`/markets/${marketId}`),
    );
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await reread;
    await expect(page.getByTestId('phase-rail-current')).toHaveText(/Applications/);
    await expect(page.getByTestId(`setup-dates-day-${refused}`)).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  test('a failed save offers Retry, and a move over it stops and says why', async ({
    authenticatedPage: page,
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
    const moves: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().endsWith(`/markets/${marketId}/transition`)) {
        moves.push(req.url());
      }
    });

    await page.goto(marketSetupPath(marketId));
    const setup = new MarketSetupPage(page);
    // The connection drops: every plan write fails on the wire.
    await page.route(PLAN_WRITE, (route) =>
      route.request().method() === 'PUT' ? route.abort('internetdisconnected') : route.continue(),
    );
    await setup.addMarketDate(added);

    await expect(page.getByTestId('market-setup-plan-save-error')).toHaveText(
      'You seem to be offline. Check the connection and try again.',
    );
    await expect(page.getByTestId('market-setup-plan-retry-button')).toBeVisible();
    // The edit stays on screen: it is the organizer's, only not stored yet.
    await expect(page.getByTestId(`setup-dates-day-${added}`)).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // Opening applications now would open them over a plan the server does not hold.
    await setup.clickTransition('applications');
    await page.getByTestId('open-applications-submit-button').click();
    await expect(page.getByTestId('phase-rail-error')).toHaveText(
      'The market did not move, because the plan did not save. ' +
        'You seem to be offline. Check the connection and try again.',
    );
    await expect(page.getByTestId('phase-rail-current')).toHaveText(/Draft/);
    expect(moves).toEqual([]);

    // The connection is back, and Retry sends the whole plan.
    await page.unroute(PLAN_WRITE);
    await page.getByTestId('market-setup-plan-retry-button').click();
    await expect(page.getByTestId('market-setup-plan-saved')).toBeVisible();
    expect(await storedDates(request, marketId)).toEqual([held, added]);
  });
});
