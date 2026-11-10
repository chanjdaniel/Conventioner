import type { Page, Request } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL, MarketSetupPage } from './fixtures';
import { seedDraftMarket } from './helpers/seedDraftMarket';
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
});
