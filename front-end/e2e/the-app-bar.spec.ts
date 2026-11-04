import type { Page } from '@playwright/test';
import { test, expect, BACKEND_URL, TEST_USER } from './fixtures';
import { MarketsPage } from './pages/MarketsPage';
import { marketScreenPath } from './helpers/marketScreens';
import { ensureTestOrg, seedMarketWithVendors } from './helpers/seeds';

/**
 * The app bar (T209): the way between an organizer's places, always in sight and always the same.
 * Each test drives it as a person does, and asserts what they would see.
 */

const DESK = { width: 1280, height: 800 };

const bar = (page: Page) => page.getByTestId('app-bar');
const links = (page: Page) => page.getByRole('navigation', { name: 'Main' });
const placeLink = (page: Page, name: string) => links(page).getByRole('link', { name });
const accountButton = (page: Page) => page.getByTestId('app-bar-account-button');
const accountMenu = (page: Page) => page.getByTestId('app-bar-account');
const signOutItem = (page: Page) => page.getByRole('menuitem', { name: 'Sign out' });

test.describe('the bar on a desk', () => {
  let marketId: string;

  test.beforeAll(async ({ request }) => {
    await ensureTestOrg(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
    const seeded = await seedMarketWithVendors(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );
    marketId = seeded.marketId;
  });

  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.setViewportSize(DESK);
  });

  for (const height of [600, 800, 1080]) {
    test(`is 44px tall with the market frame directly under it at a window ${height} tall`, async ({
      authenticatedPage: page,
    }) => {
      await page.setViewportSize({ width: 1280, height });
      const paths = ['/markets', '/organizations', marketScreenPath(marketId, 'stats')];
      for (const path of paths) {
        await page.goto(path);
        await expect(placeLink(page, 'Markets')).toBeVisible();
        expect((await bar(page).boundingBox())?.height, path).toBe(44);
      }

      const frame = await page.getByTestId('market-frame').first().boundingBox();
      expect(frame?.y).toBe(44);
    });
  }

  test('marks the place it is in, and none off them', async ({ authenticatedPage: page }) => {
    const markets = placeLink(page, 'Markets');
    const organizations = placeLink(page, 'Organizations');

    for (const path of [
      '/markets',
      marketScreenPath(marketId, 'stats'),
      marketScreenPath(marketId, 'vendors'),
    ]) {
      await page.goto(path);
      await expect(markets, path).toHaveAttribute('aria-current', 'page');
      await expect(organizations, path).not.toHaveAttribute('aria-current');
    }

    await page.goto('/organizations');
    await expect(organizations).toHaveAttribute('aria-current', 'page');
    await expect(markets).not.toHaveAttribute('aria-current');

    await page.goto('/dashboard');
    await expect(markets).toBeVisible();
    await expect(markets).not.toHaveAttribute('aria-current');
    await expect(organizations).not.toHaveAttribute('aria-current');
  });

  test('draws the current link green and semibold, and moving between them moves neither', async ({
    authenticatedPage: page,
  }) => {
    const look = async (name: string) =>
      placeLink(page, name).evaluate((link) => {
        const style = getComputedStyle(link);
        const underline = getComputedStyle(link, '::after');
        const box = link.getBoundingClientRect();
        return {
          color: style.color,
          weight: style.fontWeight,
          underline: underline.height,
          left: box.left,
          width: box.width,
        };
      });
    const GREEN = 'rgb(54, 130, 111)';

    await page.goto('/markets');
    await expect(placeLink(page, 'Markets')).toHaveAttribute('aria-current', 'page');
    const markets = await look('Markets');
    const other = await look('Organizations');
    expect(markets).toMatchObject({ color: GREEN, weight: '600', underline: '2px' });
    expect(other.color).not.toBe(GREEN);
    expect(other.weight).toBe('400');

    await page.goto('/organizations');
    await expect(placeLink(page, 'Organizations')).toHaveAttribute('aria-current', 'page');
    const after = await look('Organizations');
    expect(after).toMatchObject({ color: GREEN, weight: '600', underline: '2px' });
    expect(after.left).toBe(other.left);
    expect(after.width).toBe(other.width);
  });

  test('its logo and links go where they say, in a landmark named Main', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/markets');
    await placeLink(page, 'Organizations').click();
    await page.waitForURL(/\/organizations$/);

    await placeLink(page, 'Markets').click();
    await page.waitForURL(/\/markets$/);

    await page.goto(marketScreenPath(marketId, 'stats'));
    await bar(page).getByRole('link', { name: 'Conventioner, Markets' }).click();
    await page.waitForURL(/\/markets$/);
  });

  test('its account menu names the organizer, and walks and closes as a menu does', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/markets');
    const button = accountButton(page);
    await expect(button).toContainText(TEST_USER.email);
    await expect(button).toHaveAttribute('aria-expanded', 'false');

    await button.focus();
    await page.keyboard.press('Enter');
    await expect(accountMenu(page)).toBeVisible();
    await expect(signOutItem(page)).toBeFocused();

    // One item today: the arrows stay on it rather than leaving the menu.
    await page.keyboard.press('ArrowDown');
    await expect(signOutItem(page)).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(accountMenu(page)).toBeHidden();
    await expect(button).toBeFocused();

    await button.click();
    await expect(accountMenu(page)).toBeVisible();
    await page.getByRole('heading', { level: 1 }).click();
    await expect(accountMenu(page)).toBeHidden();
    await expect(button).toBeFocused();
  });

  test('a press on another control closes the account menu and leaves focus on that control', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/markets');
    await accountButton(page).click();
    await expect(accountMenu(page)).toBeVisible();

    const search = page.getByTestId('markets-search-input');
    await search.click();
    await expect(accountMenu(page)).toBeHidden();
    await expect(search).toBeFocused();
  });

  test('cuts a long address with an ellipsis, keeps it whole in a title, and keeps its shape', async ({
    authenticatedPage: page,
  }) => {
    const long = `an-organizer-with-a-very-long-address-indeed-${'x'.repeat(30)}@example.com`;
    await page.route(/\/check-session$/, (route) =>
      route.fulfill({ status: 200, json: { email: long } }),
    );
    await page.goto('/markets');
    await expect(accountButton(page)).toBeVisible();

    const address = accountButton(page).getByTitle(long);
    await expect(address).toHaveText(long);
    const cut = await address.evaluate((el) => ({
      cut: el.scrollWidth > el.clientWidth,
      overflow: getComputedStyle(el).textOverflow,
    }));
    expect(cut).toEqual({ cut: true, overflow: 'ellipsis' });

    const box = await accountButton(page).boundingBox();
    expect(box?.width).toBeLessThanOrEqual(260);
    expect(box?.height).toBe(32);
    const band = await bar(page).boundingBox();
    expect(band?.height).toBe(44);
    expect(box!.x + box!.width).toBe(band!.x + band!.width - 16);

    // At the narrowest desk layout the address gives way and nothing leaves the window.
    await page.setViewportSize({ width: 641, height: 800 });
    const narrow = await accountButton(page).boundingBox();
    expect(narrow!.x + narrow!.width).toBeLessThanOrEqual(641);
    const organizations = await placeLink(page, 'Organizations').boundingBox();
    expect(organizations!.x + organizations!.width).toBeLessThanOrEqual(narrow!.x);
  });

  test('signing out ends the session, forgets the organizer and the market, and lands on sign-in', async ({
    authenticatedPage: page,
  }) => {
    await page.goto(marketScreenPath(marketId, 'stats'));
    await expect(page.getByTestId('market-frame').first()).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('lastMarketId'))).toBe(marketId);

    await accountButton(page).click();
    await signOutItem(page).click();

    await page.waitForURL(/\/login$/);
    expect(await page.evaluate(() => localStorage.getItem('user'))).toBeNull();
    expect(await page.evaluate(() => localStorage.getItem('lastMarketId'))).toBeNull();
    await expect(links(page)).toHaveCount(0);

    // The server heard: the session is over.
    expect((await page.request.get('/api/check-session')).status()).toBe(401);
    await page.goto('/markets');
    await page.waitForURL(/\/login/);
  });

  for (const { failure, fail } of [
    { failure: 'answers 500', fail: 500 },
    { failure: 'gets no answer', fail: null },
  ]) {
    test(`signing out still signs this browser out when the server ${failure}`, async ({
      authenticatedPage: page,
    }) => {
      await page.route(/\/logout$/, (route) =>
        fail === null ? route.abort('internetdisconnected') : route.fulfill({ status: fail }),
      );
      await page.goto(marketScreenPath(marketId, 'stats'));
      await expect(page.getByTestId('market-frame').first()).toBeVisible();

      await accountButton(page).click();
      await signOutItem(page).click();

      await page.waitForURL(/\/login$/);
      expect(await page.evaluate(() => localStorage.getItem('user'))).toBeNull();
      expect(await page.evaluate(() => localStorage.getItem('lastMarketId'))).toBeNull();
      await expect(links(page)).toHaveCount(0);
    });
  }

  test('does not print', async ({ authenticatedPage: page }) => {
    await new MarketsPage(page).goto();
    await expect(bar(page)).toBeVisible();
    await page.emulateMedia({ media: 'print' });
    await expect(bar(page)).toBeHidden();
    await page.emulateMedia({ media: 'screen' });
    await expect(bar(page)).toBeVisible();
  });
});

test.describe('the bar at a phone width, until the sheet replaces the drawer', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
  });

  test('the menu button opens the drawer, and the links and account menu stand aside', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/markets');
    await expect(bar(page).getByRole('link', { name: 'Conventioner, Markets' })).toBeVisible();
    await expect(links(page)).toBeHidden();
    await expect(accountButton(page)).toBeHidden();
    expect((await bar(page).boundingBox())?.height).toBe(44);

    await page.getByTestId('app-menu-button').click();
    await page.getByTestId('app-nav').getByRole('link', { name: 'Organizations' }).click();
    await page.waitForURL(/\/organizations$/);
  });

  test('the phone layout ends at 640, and the desk layout starts at 641', async ({
    authenticatedPage: page,
  }) => {
    await page.setViewportSize({ width: 640, height: 800 });
    await page.goto('/markets');
    await expect(page.getByTestId('app-menu-button')).toBeVisible();
    await expect(links(page)).toBeHidden();

    await page.setViewportSize({ width: 641, height: 800 });
    await expect(page.getByTestId('app-menu-button')).toBeHidden();
    await expect(links(page)).toBeVisible();
  });
});
