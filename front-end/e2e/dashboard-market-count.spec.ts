import { test, expect, BACKEND_URL, TEST_USER, LoginPage } from './fixtures';
import { loginViaApi } from './helpers/seeds';
import type { Page } from '@playwright/test';

/**
 * The dashboard's opening words are about the account, not about the browser.
 *
 * It used to decide between "You have not set up a market yet" and the last-market card from
 * `localStorage.getItem('market')` - the market last opened *in this browser*. That is empty on a
 * fresh sign-in, a second device, or after clearing site data, so an organizer who owns markets was
 * told they owned none and offered a button that makes a duplicate (E14/F01/S02, QC finding F1).
 *
 * The cache is still what names the *last market opened*, because nothing else knows it. It just no
 * longer decides whether the account has any.
 */

/** Deliberately in no organization, therefore owning no market: created by `scripts/seed_fixture.sh`. */
const NO_ORG_USER = {
  email: 'e2e-noorg@example.com',
  password: 'e2enoorg123',
};

async function signIn(page: Page, email: string, password: string) {
  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await loginPage.fillEmail(email);
  await loginPage.fillPassword(password);
  await loginPage.clickSubmit();
  await page.waitForURL('**/dashboard', { timeout: 10000 });
}

test.describe('What the dashboard says about your markets', () => {
  test('an organizer who owns a market is never told they have none', async ({ page, request }) => {
    // The account genuinely owns at least one market - asked of the server, not assumed.
    await loginViaApi(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
    const res = await request.get(`${BACKEND_URL}/markets`);
    const { markets } = (await res.json()) as { markets: unknown[] };
    expect(markets.length).toBeGreaterThan(0);

    // A browser that has never opened one: a fresh context is exactly that, which is why this bug
    // greeted every organizer on their first sign-in of the day.
    await signIn(page, TEST_USER.email, TEST_USER.password);

    await expect(page.getByTestId('dashboard-no-market-yet')).toHaveCount(0);
    await expect(page.getByTestId('dashboard-has-markets')).toBeVisible();

    // And it survives a hard reload rather than flashing the right answer and losing it.
    await page.reload();
    await expect(page.getByTestId('dashboard-no-market-yet')).toHaveCount(0);
    await expect(page.getByTestId('dashboard-has-markets')).toBeVisible();
  });

  test('an organizer who genuinely owns none is welcomed and offered their first', async ({
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
    await loginViaApi(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
    const res = await request.get(`${BACKEND_URL}/markets`);
    const { markets } = (await res.json()) as { markets: Array<Record<string, unknown>> };

    await signIn(page, TEST_USER.email, TEST_USER.password);
    await page.evaluate((m) => localStorage.setItem('market', JSON.stringify(m)), markets[0]);
    await page.reload();

    await expect(page.getByTestId('dashboard-last-market-card')).toBeVisible();
    await expect(page.getByTestId('dashboard-last-market-card')).toContainText(
      String(markets[0].name),
    );
  });
});
