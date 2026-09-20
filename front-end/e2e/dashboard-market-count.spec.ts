import { test, expect, BACKEND_URL, TEST_USER, NO_ORG_USER, LoginPage } from './fixtures';
import { loginViaApi } from './helpers/seeds';
import type { APIRequestContext, Page } from '@playwright/test';

/**
 * The dashboard's opening words are about the account, not about the browser.
 *
 * It used to decide between "You have not set up a market yet" and the last-market card from
 * `localStorage.getItem('market')` - the market last opened *in this browser*. That is empty on a
 * fresh sign-in, a second device, or after clearing site data, so an organizer who had markets was
 * told they had none and offered a button that makes a duplicate (E14/F01/S02, QC finding F1).
 *
 * The cache is still what names the *last market opened*, because nothing else knows it. It just no
 * longer decides how many the account has.
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

  test('the last market opened is still offered where this browser remembers one', async ({
    page,
    request,
  }) => {
    const markets = await marketsFromServer(request);

    await signIn(page, TEST_USER.email, TEST_USER.password);
    await page.evaluate((m) => localStorage.setItem('market', JSON.stringify(m)), markets[0]);
    await page.reload();

    await expect(page.getByTestId('dashboard-last-market-card')).toContainText(
      String(markets[0].name),
    );
  });

  /**
   * The card is drawn from the server's answer rather than replayed from the cache, so a market
   * renamed elsewhere does not read back here under the name this browser stored. Seeding the
   * cache with a stale name is the only way to tell the two apart - seeding it from the server's
   * own payload passes either way and proves nothing.
   */
  test('that card shows the market as it is now, not as this browser cached it', async ({
    page,
    request,
  }) => {
    const markets = await marketsFromServer(request);

    await signIn(page, TEST_USER.email, TEST_USER.password);
    await page.evaluate(
      (m) => localStorage.setItem('market', JSON.stringify({ ...m, name: 'A Stale Cached Name' })),
      markets[0],
    );
    await page.reload();

    const card = page.getByTestId('dashboard-last-market-card');
    await expect(card).toContainText(String(markets[0].name));
    await expect(card).not.toContainText('A Stale Cached Name');
  });

  /**
   * The count is unknown when the request fails, and the screen says nothing about it. The
   * remembered card is a different matter: this browser can draw it unaided, and did so before
   * this screen made any request at all.
   */
  test('an unreachable server costs the claim, not the remembered market', async ({
    page,
    request,
  }) => {
    const markets = await marketsFromServer(request);

    await signIn(page, TEST_USER.email, TEST_USER.password);
    await page.evaluate((m) => localStorage.setItem('market', JSON.stringify(m)), markets[0]);
    await page.route('**/markets', (route) => route.abort());
    await page.reload();

    await expect(page.getByTestId('dashboard-last-market-card')).toContainText(
      String(markets[0].name),
    );
    await expect(page.getByTestId('dashboard-no-market-yet')).toHaveCount(0);
    await expect(page.getByTestId('dashboard-has-markets')).toHaveCount(0);
  });
});
