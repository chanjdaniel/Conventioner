import type { Locator, Page, Route } from '@playwright/test';
import { test, expect, BACKEND_URL, TEST_USER, LoginPage, PasswordResetPage } from './fixtures';
import { loginViaApi } from './helpers/seeds';

/**
 * The way in fits a phone (T73).
 *
 * The door on market day is sometimes a phone, and the attendance page sits behind sign-in, so the
 * pages that get an organizer signed in have to fit one too. Each drew a fixed 600px card centred
 * in a 390px window: the page scrolled sideways by 98px and the card's left edge, with the start of
 * every field and tab, was cut off where no scrolling could reach it.
 */

const PHONE = { width: 390, height: 844 };

/** Each page, opened and settled: `ready` is something only that page shows once it has drawn. */
const PAGES: { name: string; open: (page: Page) => Promise<Locator> }[] = [
  {
    name: 'sign in',
    open: async (page) => {
      const login = new LoginPage(page);
      await login.goto();
      return login.loginForm;
    },
  },
  {
    name: 'create account',
    open: async (page) => {
      const login = new LoginPage(page);
      await login.goto();
      await login.switchToRegister();
      return login.registerForm;
    },
  },
  {
    name: 'sign in with a code',
    open: async (page) => {
      const login = new LoginPage(page);
      await login.goto();
      await login.switchToOtp();
      return login.otpForm;
    },
  },
  {
    name: 'ask for a reset link',
    open: async (page) => {
      const reset = new PasswordResetPage(page);
      await reset.gotoRequest();
      return reset.requestForm;
    },
  },
  {
    name: 'choose a new password',
    open: async (page) => {
      const reset = new PasswordResetPage(page);
      await reset.gotoReset('a-token-from-an-email');
      return reset.resetForm;
    },
  },
  {
    name: 'verify an email address',
    open: async (page) => {
      // An unknown token, so the page settles on its error and the buttons that answer it.
      await page.goto('/verify-email?token=a-token-from-an-email');
      return page.getByTestId('email-verification-error-message');
    },
  },
];

/** The page settled, with its card inside the window and nothing scrolling sideways. */
async function expectItFits(page: Page, ready: Locator): Promise<void> {
  await expect(ready).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'the page scrolls sideways on a phone').toBeLessThanOrEqual(0);

  const card = await page.getByTestId('auth-card').boundingBox();
  expect(card, 'the card is drawn').not.toBeNull();
  expect(card!.x, 'the card starts inside the window').toBeGreaterThanOrEqual(0);
  expect(card!.x + card!.width, 'the card ends inside the window').toBeLessThanOrEqual(PHONE.width);
}

for (const { name, open } of PAGES) {
  test(`${name} fits a phone`, async ({ page }) => {
    await page.setViewportSize(PHONE);
    await expectItFits(page, await open(page));
  });
}

// The same card, met signed in: Discord sends the organizer back to it, in the tab Connect Discord
// opened (E46/F01/S02). Cancelled on Discord, so it settles with no request.
test('the page Discord returns to fits a phone', async ({ authenticatedPage: page }) => {
  await page.setViewportSize(PHONE);
  await page.goto('/discord/connected?error=access_denied&state=a-market.a-nonce');
  await expectItFits(page, page.getByTestId('discord-connected-error'));
});

// Signing in lands on the dashboard, so an organizer on a phone meets it before `/markets` or the
// market they remembered (T148). Under a phone's own emulation a page wider than the window does not
// scroll sideways: it widens the layout viewport and zooms out, which the 1000px floor did here.
test.describe('signing in on a phone', () => {
  test.use({
    viewport: PHONE,
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
  });

  /** The window as the page lays itself out in it, the page's own width, and the zoom. */
  const widths = (page: Page) =>
    page.evaluate(() => ({
      layout: window.innerWidth,
      page: document.documentElement.scrollWidth,
      zoom: window.visualViewport?.scale ?? 1,
    }));

  /** A box wholly inside the 390px window. */
  async function expectInside(locator: Locator, what: string): Promise<void> {
    const box = await locator.boundingBox();
    expect(box, `${what} is drawn`).not.toBeNull();
    expect(box!.x, `${what} starts inside the window`).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width, `${what} ends inside the window`).toBeLessThanOrEqual(PHONE.width);
  }

  /**
   * Holds the dashboard's markets answer back until `release` is called, so a test can read the
   * page as it stands before the answer lands. The page's own `/markets` is a document, not this.
   */
  async function holdTheMarkets(page: Page): Promise<() => void> {
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    await page.route(
      (url) => url.pathname.endsWith('/markets'),
      async (route: Route) => {
        if (route.request().resourceType() === 'document') return route.fallback();
        await released;
        await route.fallback();
      },
    );
    return release;
  }

  /** Signs in through the form, holding the markets answer back, and returns its release. */
  async function signInHolding(page: Page): Promise<() => void> {
    const release = await holdTheMarkets(page);
    const login = new LoginPage(page);
    await login.login(TEST_USER.email, TEST_USER.password);
    await login.waitForDashboardRedirect();
    return release;
  }

  /** The Markets tile's box once the dashboard has drawn it. */
  async function marketsTile(page: Page) {
    const tile = page.getByTestId('dashboard-markets-button');
    await expect(tile).toBeVisible();
    return tile.boundingBox();
  }

  /** The dashboard fits the window: no zoom, no sideways scroll, and its column inside it. */
  async function expectTheDashboardFits(page: Page, card: Locator, what: string): Promise<void> {
    expect(await widths(page)).toEqual({ layout: 390, page: 390, zoom: 1 });
    await expectInside(card, what);
    await expectInside(page.getByTestId('dashboard-markets-button'), 'the Markets tile');
    await expectInside(
      page.getByTestId('dashboard-organizations-button'),
      'the Organizations tile',
    );
    await expectInside(page.getByTestId('dashboard-sign-out-button'), 'Sign out');
  }

  test("lands on a dashboard that keeps the phone's width, and Markets keeps it too", async ({
    page,
  }) => {
    const release = await signInHolding(page);
    const before = await marketsTile(page);
    release();

    const count = page.getByTestId('dashboard-has-markets');
    await expect(count).toBeVisible();
    expect(await marketsTile(page), 'the tiles hold still as the count arrives').toEqual(before);
    await expectTheDashboardFits(page, count, 'the count');

    await page.getByTestId('dashboard-markets-button').tap();
    await page.waitForURL('**/markets');
    await expect(page.getByTestId('markets-result-count')).toBeVisible();
    expect(await widths(page)).toEqual({ layout: 390, page: 390, zoom: 1 });
  });

  test('a remembered market is drawn inside the window', async ({ page, request }) => {
    // A market this account can reach, remembered as opening it would (`utils/lastMarket.ts`).
    await loginViaApi(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
    const res = await request.get(`${BACKEND_URL}/markets`);
    expect(res.ok()).toBe(true);
    const { markets } = (await res.json()) as { markets: { id: string }[] };
    expect(markets.length).toBeGreaterThan(0);
    await page.addInitScript((id) => localStorage.setItem('lastMarketId', id), markets[0].id);

    const release = await signInHolding(page);
    const before = await marketsTile(page);
    release();

    const card = page.getByTestId('dashboard-last-market-card');
    await expect(card).toBeVisible();
    expect(await marketsTile(page), 'the tiles hold still as the card arrives').toEqual(before);
    await expectTheDashboardFits(page, card, "the remembered market's card");
  });
});

// Between a phone and a desk, the dashboard's column narrows with the window rather than holding
// a desk's width (T148).
test('the dashboard fits a window between a phone and a desk', async ({
  authenticatedPage: page,
}) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto('/dashboard');
  await expect(page.getByTestId('dashboard-has-markets')).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'the dashboard scrolls sideways at 768px').toBeLessThanOrEqual(0);
});
