import { test, expect, BACKEND_URL, TEST_USER, NO_ORG_USER, LoginPage } from './fixtures';
import { loginViaApi } from './helpers/seeds';
import { marketSetupPath } from './helpers/marketScreens';
import type { APIRequestContext, Page } from '@playwright/test';

/**
 * The dashboard's opening words are about the account, not about the browser.
 *
 * It used to decide between "You have not set up a market yet" and the last-market card from
 * `localStorage.getItem('market')` - the market last opened *in this browser*. That is empty on a
 * fresh sign-in, a second device, or after clearing site data, so an organizer who had markets was
 * told they had none and offered a button that makes a duplicate (E14/F01/S02, QC finding F1).
 *
 * Nothing about a market is kept in the browser any more (E21/F02/S05). What names the *last market
 * opened* is a `lastMarketId` pointer, set by arriving at a market; the card is drawn from the
 * server's answer for that id.
 */

async function signIn(page: Page, email: string, password: string) {
  const loginPage = new LoginPage(page);
  await loginPage.login(email, password);
  await loginPage.waitForDashboardRedirect();
}

/** The markets the account can actually reach, asked of the server rather than assumed. */
async function marketsFromServer(request: APIRequestContext) {
  await loginViaApi(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  const res = await request.get(`${BACKEND_URL}/markets`);
  expect(res.ok()).toBe(true);
  const { markets } = (await res.json()) as { markets: Array<Record<string, unknown>> };
  expect(markets.length).toBeGreaterThan(0);
  return markets;
}

test.describe('What the dashboard says about your markets', () => {
  test('an organizer who has markets is never told they have none', async ({ page, request }) => {
    await marketsFromServer(request);

    // A browser that has never opened one: a fresh context is exactly that, which is why this bug
    // greeted most organizers on their first sign-in of the day.
    await signIn(page, TEST_USER.email, TEST_USER.password);

    await expect(page.getByTestId('dashboard-no-market-yet')).toHaveCount(0);
    await expect(page.getByTestId('dashboard-has-markets')).toBeVisible();

    // And it survives a hard reload rather than flashing the right answer and losing it.
    await page.reload();
    await expect(page.getByTestId('dashboard-no-market-yet')).toHaveCount(0);
    await expect(page.getByTestId('dashboard-has-markets')).toBeVisible();
  });

  test('an organizer who genuinely has none is welcomed and offered their first', async ({
    page,
  }) => {
    await signIn(page, NO_ORG_USER.email, NO_ORG_USER.password);

    await expect(page.getByTestId('dashboard-no-market-yet')).toBeVisible();
    await expect(page.getByTestId('dashboard-create-market-button')).toBeVisible();
    await expect(page.getByTestId('dashboard-has-markets')).toHaveCount(0);
  });

  /** Open a market the way an organizer does - by arriving at it - and come back to the dashboard. */
  async function openThenReturn(page: Page, market: Record<string, unknown>) {
    await page.goto(marketSetupPath(String(market.id)));
    await expect(page.getByTestId('market-setup-title')).toHaveText(String(market.name), {
      timeout: 15000,
    });
    await page.goto('/dashboard');
  }

  test('the last market opened is offered on the dashboard', async ({ page, request }) => {
    const markets = await marketsFromServer(request);

    await signIn(page, TEST_USER.email, TEST_USER.password);
    await openThenReturn(page, markets[0]);

    await expect(page.getByTestId('dashboard-last-market-card')).toContainText(
      String(markets[0].name),
    );
  });

  /** A pointer, never a copy: the card can only ever be drawn from what the server says now. */
  test('the browser remembers which market, and nothing about it', async ({ page, request }) => {
    const markets = await marketsFromServer(request);

    await signIn(page, TEST_USER.email, TEST_USER.password);
    await openThenReturn(page, markets[0]);

    const stored = await page.evaluate(() => ({
      pointer: localStorage.getItem('lastMarketId'),
      market: localStorage.getItem('market'),
    }));
    expect(stored).toEqual({ pointer: String(markets[0].id), market: null });
  });

  /**
   * The count is unknown when the request fails, and the screen says nothing about it. The card
   * used to be replayed from a market cached in the browser; there is none to replay now, so an
   * unreachable server costs the card too - a convenience lost, never a stale market shown.
   */
  test('an unreachable server costs the claim and the card, and shows nothing stale', async ({
    page,
    request,
  }) => {
    const markets = await marketsFromServer(request);

    await signIn(page, TEST_USER.email, TEST_USER.password);
    await openThenReturn(page, markets[0]);
    await page.route('**/markets', (route) => route.abort());
    await page.reload();

    await expect(page.getByTestId('dashboard-last-market-card')).toHaveCount(0);
    await expect(page.getByTestId('dashboard-no-market-yet')).toHaveCount(0);
    await expect(page.getByTestId('dashboard-has-markets')).toHaveCount(0);
  });
});
