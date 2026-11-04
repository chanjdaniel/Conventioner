import type { Locator, Page } from '@playwright/test';
import { test, expect, BACKEND_URL, NO_ORG_USER, TEST_USER } from './fixtures';
import { LoginPage } from './pages/LoginPage';
import { MarketsPage } from './pages/MarketsPage';
import { grantMarketRole } from './helpers/grantMarketRole';
import { marketScreenPath } from './helpers/marketScreens';
import { seedApplicantMarket } from './helpers/seedApplicantMarket';
import { ensureTestOrg, seedMarketWithVendors } from './helpers/seeds';
import { settle } from './helpers/settle';
import { ensureVerifiedUser } from './helpers/verifiedUser';

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
const changePasswordItem = (page: Page) => page.getByRole('menuitem', { name: 'Change password' });

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
    await expect(changePasswordItem(page)).toBeFocused();

    await page.keyboard.press('ArrowDown');
    await expect(signOutItem(page)).toBeFocused();

    // The arrows go round rather than leaving the menu.
    await page.keyboard.press('ArrowDown');
    await expect(changePasswordItem(page)).toBeFocused();

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
    // Remembered once the market has been read, which the frame does not wait for.
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('lastMarketId')))
      .toBe(marketId);

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

test.describe('the bar on a phone', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
  });

  const GREEN = 'rgb(54, 130, 111)';
  let marketId: string;

  const menuButton = (page: Page) => page.getByTestId('app-bar-menu-button');
  const sheet = (page: Page) => page.getByTestId('app-bar-sheet');
  const scrim = (page: Page) => page.getByTestId('app-bar-scrim');
  const sheetLink = (page: Page, name: string) => sheet(page).getByRole('link', { name });
  const sheetSignOut = (page: Page) => sheet(page).getByRole('button', { name: 'Sign out' });

  /** A box's edges against the window a person sees, whatever the page has scrolled to. */
  const inWindow = (locator: Locator) =>
    locator.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const seen = window.visualViewport!;
      return {
        left: box.left - seen.offsetLeft,
        right: box.right - seen.offsetLeft,
        windowWidth: seen.width,
      };
    });

  async function expectInsideTheWindow(locator: Locator, what: string): Promise<void> {
    const { left, right, windowWidth } = await inWindow(locator);
    expect(left, `${what} starts inside the window`).toBeGreaterThanOrEqual(0);
    expect(right, `${what} ends inside the window`).toBeLessThanOrEqual(windowWidth);
  }

  /** Drag the page sideways with a thumb, as nothing but a real gesture does on a phone. */
  async function thumbSideways(page: Page, distance: number): Promise<void> {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.synthesizeScrollGesture', {
      x: 300,
      y: 400,
      xDistance: -distance,
      yDistance: 0,
      speed: 2000,
    });
    await cdp.detach();
  }

  const sidewaysOverflow = (page: Page) =>
    page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );

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

  test('is one thin row, the logo and a menu button, with the places behind it', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/markets');
    const logo = bar(page).getByRole('link', { name: 'Conventioner, Markets' });
    await expect(logo).toBeVisible();
    expect((await logo.boundingBox())?.height).toBe(44);
    await expect(links(page)).toBeHidden();
    await expect(accountButton(page)).toBeHidden();
    expect((await bar(page).boundingBox())?.height).toBe(44);

    const button = page.getByRole('button', { name: 'Open menu' });
    await expect(button).toBeVisible();
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    const box = await button.boundingBox();
    expect(box).toMatchObject({ width: 44, height: 44, y: 0 });
    await expectInsideTheWindow(button, 'the menu button');
  });

  test('a market screen pins no more than 150px', async ({ authenticatedPage: page }) => {
    await page.goto(marketScreenPath(marketId, 'attendance'));
    const marketBar = page.getByTestId('market-bar');
    await expect(marketBar).toBeVisible();
    const box = await marketBar.boundingBox();
    expect(box!.y).toBe(44);
    expect(box!.y + box!.height).toBeLessThanOrEqual(150);
  });

  test('opens a sheet of 44px rows holding the two places, the address, Change password and Sign out', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/markets');
    await expect(sheet(page)).toHaveCount(0);

    await menuButton(page).tap();
    const close = page.getByRole('button', { name: 'Close menu' });
    await expect(close).toHaveAttribute('aria-expanded', 'true');
    const controls = await close.getAttribute('aria-controls');
    expect(await sheet(page).getAttribute('id')).toBe(controls);

    await expect(sheet(page).getByRole('navigation', { name: 'Main' })).toBeVisible();
    const rows = [
      sheetLink(page, 'Markets'),
      sheetLink(page, 'Organizations'),
      sheet(page).getByText(TEST_USER.email),
      sheetLink(page, 'Change password'),
      sheetSignOut(page),
    ];
    let above = 0;
    for (const row of rows) {
      const box = await row.boundingBox();
      expect(box!.height).toBe(44);
      expect(box!.y).toBeGreaterThanOrEqual(above);
      above = box!.y + box!.height;
      await expectInsideTheWindow(row, 'a row of the sheet');
    }
    expect(await sidewaysOverflow(page)).toBe(0);

    // It hangs from the bar, the window's whole width, over a scrim that starts under the bar.
    expect((await sheet(page).boundingBox())?.y).toBe(44);
    expect(await inWindow(sheet(page))).toEqual({ left: 0, right: 390, windowWidth: 390 });
    expect(await scrim(page).boundingBox()).toEqual({ x: 0, y: 44, width: 390, height: 800 });
  });

  test('marks the place it is in, green with a bar at its left, its words on the logo', async ({
    authenticatedPage: page,
  }) => {
    const look = (name: string) =>
      sheetLink(page, name).evaluate((row) => {
        const style = getComputedStyle(row);
        const mark = getComputedStyle(row, '::before');
        const words = document.createRange();
        words.selectNodeContents(row);
        return {
          color: style.color,
          weight: style.fontWeight,
          bar: mark.content === 'none' ? null : mark.width,
          barColor: mark.backgroundColor,
          words: words.getBoundingClientRect().left,
        };
      });

    await page.goto(marketScreenPath(marketId, 'attendance'));
    const logo = await page.getByAltText('Conventioner, Markets').boundingBox();
    await menuButton(page).tap();
    await expect(sheetLink(page, 'Markets')).toHaveAttribute('aria-current', 'page');
    await expect(sheetLink(page, 'Organizations')).not.toHaveAttribute('aria-current');

    const current = await look('Markets');
    expect(current).toMatchObject({ color: GREEN, weight: '600', bar: '3px', barColor: GREEN });
    const other = await look('Organizations');
    expect(other).toMatchObject({ weight: '400', bar: null });
    expect(other.color).not.toBe(GREEN);
    expect(current.words).toBe(logo!.x);
    expect(other.words).toBe(logo!.x);
  });

  test('moves focus in, holds the page behind out of play, and leaves the close button reachable', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/markets');
    const search = page.getByTestId('markets-search-input');
    await expect(search).toBeVisible();

    await menuButton(page).tap();
    await expect(sheetLink(page, 'Markets')).toBeFocused();

    expect(await search.evaluate((el) => el.closest('[inert]') !== null)).toBe(true);
    const logo = page.getByAltText('Conventioner, Markets');
    expect(await logo.evaluate((el) => el.closest('[inert]') !== null)).toBe(true);
    for (const part of [sheet(page), scrim(page), menuButton(page)]) {
      expect(await part.evaluate((el) => el.closest('[inert]') !== null)).toBe(false);
    }

    // The tab order holds the sheet and the button, and nothing behind them.
    const seen = new Set<string>();
    for (let press = 0; press < 10; press++) {
      await page.keyboard.press('Tab');
      seen.add(
        await page.evaluate(() => {
          const el = document.activeElement as HTMLElement;
          if (el === document.body) return '';
          return el.getAttribute('aria-label') ?? el.textContent!.trim();
        }),
      );
    }
    seen.delete('');
    expect(
      [...seen].filter(
        (name) =>
          !['Markets', 'Organizations', 'Change password', 'Sign out', 'Close menu'].includes(name),
      ),
    ).toEqual([]);
    expect(seen).toContain('Close menu');

    await page.getByRole('button', { name: 'Close menu' }).tap();
    await expect(sheet(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Open menu' })).toBeFocused();
    expect(await search.evaluate((el) => el.closest('[inert]') !== null)).toBe(false);
  });

  test('Escape and a press on the scrim close it and return focus to the button', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/markets');

    await menuButton(page).tap();
    await expect(sheet(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet(page)).toHaveCount(0);
    await expect(menuButton(page)).toBeFocused();

    await menuButton(page).tap();
    await expect(sheet(page)).toBeVisible();
    await scrim(page).tap({ position: { x: 195, y: 600 } });
    await expect(sheet(page)).toHaveCount(0);
    await expect(scrim(page)).toHaveCount(0);
    await expect(menuButton(page)).toBeFocused();
    await expect(page).toHaveURL(/\/markets$/);
  });

  test('choosing a row closes it, and so does any route change', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/markets');

    await menuButton(page).tap();
    await sheetLink(page, 'Organizations').tap();
    await page.waitForURL(/\/organizations$/);
    await expect(sheet(page)).toHaveCount(0);

    // The place it is already in: nothing navigates, and the sheet closes all the same.
    await menuButton(page).tap();
    await sheetLink(page, 'Organizations').tap();
    await expect(sheet(page)).toHaveCount(0);
    await expect(menuButton(page)).toBeFocused();

    // Nothing in the sheet moved the route.
    await menuButton(page).tap();
    await expect(sheet(page)).toBeVisible();
    await page.goBack();
    await page.waitForURL(/\/markets$/);
    await expect(sheet(page)).toHaveCount(0);
    expect(
      await page.getByTestId('markets-search-input').evaluate((el) => el.closest('[inert]')),
    ).toBeNull();
  });

  test('its Sign out ends the session and lands on sign-in', async ({
    authenticatedPage: page,
  }) => {
    await page.goto(marketScreenPath(marketId, 'attendance'));
    await menuButton(page).tap();
    await sheetSignOut(page).tap();

    await page.waitForURL(/\/login$/);
    await expect(sheet(page)).toHaveCount(0);
    await expect(menuButton(page)).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('user'))).toBeNull();
    expect((await page.request.get('/api/check-session')).status()).toBe(401);
  });

  test('a long address stays whole in the sheet, and nothing scrolls sideways', async ({
    authenticatedPage: page,
  }) => {
    const long = `an-organizer-with-a-very-long-address-indeed-${'x'.repeat(30)}@example.com`;
    await page.route(/\/check-session$/, (route) =>
      route.fulfill({ status: 200, json: { email: long } }),
    );
    await page.goto('/markets');
    await menuButton(page).tap();

    const address = sheet(page).getByText(long);
    await expect(address).toBeVisible();
    await expect(address).toHaveAttribute('title', long);
    await expectInsideTheWindow(address, 'the address');
    expect(await address.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await sidewaysOverflow(page)).toBe(0);
  });

  test('taller than the window, it scrolls within itself to its last row', async ({
    authenticatedPage: page,
  }) => {
    await page.setViewportSize({ width: 390, height: 180 });
    await page.goto('/markets');
    await menuButton(page).tap();
    const box = await sheet(page).boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(180);
    expect(await sheet(page).evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    await sheetSignOut(page).scrollIntoViewIfNeeded();
    const last = await sheetSignOut(page).boundingBox();
    expect(last!.y + last!.height).toBeLessThanOrEqual(180);
  });

  test('widening past 640px with the sheet open closes it and gives the page back', async ({
    authenticatedPage: page,
  }) => {
    await page.setViewportSize({ width: 640, height: 800 });
    await page.goto('/markets');
    const search = page.getByTestId('markets-search-input');
    await expect(menuButton(page)).toBeVisible();
    await expect(links(page)).toBeHidden();

    await menuButton(page).tap();
    await expect(sheet(page)).toBeVisible();

    await page.setViewportSize({ width: 641, height: 800 });
    await expect(sheet(page)).toHaveCount(0);
    await expect(scrim(page)).toHaveCount(0);
    await expect(menuButton(page)).toBeHidden();
    await expect(links(page)).toBeVisible();
    expect(await search.evaluate((el) => el.closest('[inert]'))).toBeNull();
  });

  test.describe('on a screen that keeps the desktop floor', () => {
    test('the menu button stays in the window as the page scrolls sideways, and the sheet opens in it', async ({
      authenticatedPage: page,
    }) => {
      await page.goto(marketScreenPath(marketId, 'setup'));
      await expect(page.getByTestId('market-frame').first()).toBeVisible();
      expect(await sidewaysOverflow(page)).toBeGreaterThan(0);
      // The page scrolls, and does not widen the layout viewport and leave a thumb panning over it,
      // which no sticky or fixed box could hold still in.
      expect(await page.evaluate(() => window.innerWidth)).toBe(390);
      await expectInsideTheWindow(menuButton(page), 'the menu button before scrolling');

      await thumbSideways(page, 300);
      expect(await page.evaluate(() => window.scrollX)).toBeGreaterThan(0);
      await expectInsideTheWindow(menuButton(page), 'the menu button after scrolling');

      await menuButton(page).tap();
      await expect(sheet(page)).toBeVisible();
      expect(await inWindow(sheet(page))).toEqual({ left: 0, right: 390, windowWidth: 390 });
      await expectInsideTheWindow(sheetSignOut(page), 'Sign out');
      expect(await inWindow(scrim(page))).toEqual({ left: 0, right: 390, windowWidth: 390 });
    });

    test('the band runs the whole width the page scrolls across', async ({
      authenticatedPage: page,
    }) => {
      await page.goto(marketScreenPath(marketId, 'setup'));
      await expect(page.getByTestId('market-frame').first()).toBeVisible();
      await thumbSideways(page, 300);
      expect(await page.evaluate(() => window.scrollX)).toBeGreaterThan(0);
      const band = await inWindow(bar(page));
      expect(band.left).toBeLessThanOrEqual(0);
      expect(band.right).toBeGreaterThanOrEqual(390);
    });
  });
});

test.describe('the bar on a floored screen in a narrow desk window', () => {
  test('the account menu stays in the window, however far the page has scrolled', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { marketId } = await seedMarketWithVendors(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );
    await page.setViewportSize({ width: 800, height: 800 });
    await page.goto(marketScreenPath(marketId, 'setup'));
    await expect(accountButton(page)).toBeVisible();

    const rightEdge = () =>
      accountButton(page).evaluate((el) => ({
        right: el.getBoundingClientRect().right,
        window: document.documentElement.clientWidth,
      }));
    for (const left of [0, 10_000]) {
      await page.evaluate((x) => window.scrollTo(x, 0), left);
      const { right, window: width } = await rightEdge();
      expect(right, `scrolled to ${left}`).toBeLessThanOrEqual(width);
    }
  });
});

/**
 * Who sees the bar: a known signed-in organizer gets all of it, on every route; nobody else gets more
 * than the logo.
 */
const VIEWER = { email: 'e2e-bar-viewer@example.com', password: 'e2epassword123' };
const SIZES = [
  { name: 'at a desk', phone: false, use: { viewport: DESK } },
  {
    name: 'on a phone',
    phone: true,
    use: {
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 3,
    },
  },
] as const;

for (const size of SIZES) {
  test.describe(`who sees the bar, ${size.name}`, () => {
    test.use(size.use);

    let marketId: string;
    let marketSlug: string;

    /** A person's press: a thumb's on a phone. */
    const press = (locator: Locator) => (size.phone ? locator.tap() : locator.click());
    const logoLink = (page: Page) =>
      bar(page).getByRole('link', { name: 'Conventioner, Markets', exact: true });
    const menuButton = (page: Page) => page.getByTestId('app-bar-menu-button');

    async function expectLogoAlone(page: Page): Promise<void> {
      await expect(bar(page).getByAltText('Conventioner', { exact: true })).toBeVisible();
      await expect(bar(page).getByRole('link')).toHaveCount(0);
      await expect(bar(page).getByRole('navigation')).toHaveCount(0);
      await expect(bar(page).getByRole('button')).toHaveCount(0);
    }

    /** Runs `then` with the places in sight, on a phone in the sheet the menu button opens. */
    async function withPlacesOpen(page: Page, then: () => Promise<void>): Promise<void> {
      if (size.phone) await press(menuButton(page));
      await then();
    }

    /** Everything the bar holds for an organizer, its menu closed again as it was found. */
    async function expectFullBar(page: Page, email = TEST_USER.email): Promise<void> {
      await expect(logoLink(page)).toBeVisible();
      if (size.phone) {
        await press(menuButton(page));
        const sheet = page.getByTestId('app-bar-sheet');
        await expect(sheet.getByRole('link', { name: 'Markets' })).toBeVisible();
        await expect(sheet.getByRole('link', { name: 'Organizations' })).toBeVisible();
        await expect(sheet.getByText(email)).toBeVisible();
        await expect(sheet.getByRole('button', { name: 'Sign out' })).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(sheet).toHaveCount(0);
      } else {
        await expect(placeLink(page, 'Markets')).toBeVisible();
        await expect(placeLink(page, 'Organizations')).toBeVisible();
        await expect(accountButton(page)).toHaveText(email);
      }
    }

    const place = (page: Page, name: string) =>
      size.phone
        ? page.getByTestId('app-bar-sheet').getByRole('link', { name })
        : placeLink(page, name);

    async function signOutFromTheBar(page: Page): Promise<void> {
      if (size.phone) {
        await press(menuButton(page));
        await press(page.getByTestId('app-bar-sheet-sign-out'));
      } else {
        await accountButton(page).click();
        await signOutItem(page).click();
      }
    }

    /** Marks this document, so a later `expectSameDocument` says nothing reloaded it. */
    const markTheDocument = (page: Page) =>
      page.evaluate(() => {
        (window as unknown as { sameDocument: boolean }).sameDocument = true;
      });
    const expectSameDocument = async (page: Page) =>
      expect(
        await page.evaluate(
          () => (window as unknown as { sameDocument?: boolean }).sameDocument === true,
        ),
        'the page did not reload',
      ).toBe(true);

    /** Answers the shell's probe only when the test says to, so it can act while it is in flight. */
    async function holdTheProbe(page: Page): Promise<(status: number) => Promise<void>> {
      let answer: (status: number) => void = () => {};
      const answered = new Promise<number>((resolve) => {
        answer = resolve;
      });
      await page.route(/\/check-session$/, async (route) => {
        const status = await answered;
        await route.fulfill({ status, json: status === 200 ? { email: TEST_USER.email } : {} });
      });
      return async (status) => {
        const finished = page.waitForEvent('requestfinished', (request) =>
          request.url().endsWith('/check-session'),
        );
        answer(status);
        await finished;
        await settle(page);
      };
    }

    test.beforeAll(async ({ request }) => {
      ensureVerifiedUser(VIEWER.email, VIEWER.password);
      const applying = await seedApplicantMarket(
        request,
        BACKEND_URL,
        TEST_USER.email,
        TEST_USER.password,
      );
      marketId = applying.marketId;
      marketSlug = applying.marketSlug;
      // The seed leaves the owner's session on `request`.
      await grantMarketRole(request, marketId, VIEWER, 'viewer');
    });

    test('signed out, sign-in, a password page, a public page and Page not found show the logo alone', async ({
      page,
    }) => {
      for (const path of ['/login', '/reset-password-request', `/${marketSlug}`, '/no/such/page']) {
        await page.goto(path);
        await expect(page.locator('main')).not.toBeEmpty();
        await expectLogoAlone(page);
      }
    });

    test('signed in, a public page and Page not found show the full bar with nothing current', async ({
      authenticatedPage: page,
    }) => {
      for (const path of [`/${marketSlug}`, '/no/such/page']) {
        await page.goto(path);
        await expectFullBar(page);
        await withPlacesOpen(page, async () => {
          await expect(place(page, 'Markets')).not.toHaveAttribute('aria-current');
          await expect(place(page, 'Organizations')).not.toHaveAttribute('aria-current');
        });
        if (size.phone) await page.keyboard.press('Escape');
      }
    });

    test("signed in on a public page, the bar's logo and links work", async ({
      authenticatedPage: page,
    }) => {
      await page.goto(`/${marketSlug}`);
      await press(logoLink(page));
      await page.waitForURL(/\/markets$/);

      await page.goto(`/${marketSlug}`);
      await withPlacesOpen(page, () => press(place(page, 'Organizations')));
      await page.waitForURL(/\/organizations$/);

      await page.goto('/no/such/page');
      await withPlacesOpen(page, () => press(place(page, 'Markets')));
      await page.waitForURL(/\/markets$/);
    });

    test('Sign out from a public page leaves sign-in with the logo alone, with no reload', async ({
      authenticatedPage: page,
    }) => {
      await page.goto(`/${marketSlug}`);
      await expectFullBar(page);
      await markTheDocument(page);

      await signOutFromTheBar(page);

      await page.waitForURL(/\/login$/);
      await expectLogoAlone(page);
      await expectSameDocument(page);
    });

    test('a 401 mid-work leaves sign-in with the logo alone, with no reload', async ({
      authenticatedPage: page,
    }) => {
      await page.goto('/markets');
      await expectFullBar(page);
      await markTheDocument(page);
      await page.route(/\/organizations/, (route) =>
        ['xhr', 'fetch'].includes(route.request().resourceType())
          ? route.fulfill({ status: 401, json: {} })
          : route.continue(),
      );

      await withPlacesOpen(page, () => press(place(page, 'Organizations')));

      await page.waitForURL(/\/login\?.*ended=1/);
      await expectLogoAlone(page);
      await expectSameDocument(page);
    });

    for (const status of [401, 403]) {
      test(`a probe answering ${status} leaves sign-in with the logo alone, with no reload`, async ({
        authenticatedPage: page,
      }) => {
        const answer = await holdTheProbe(page);
        await page.goto('/markets');
        await expect(logoLink(page)).toBeVisible();
        await markTheDocument(page);

        await answer(status);

        await page.waitForURL(/\/login\?/);
        await expectLogoAlone(page);
        await expectSameDocument(page);
      });

      // The bar stands before the probe has answered, so a person can sign out under it. That answer
      // is about a session already over: it brings back neither the bar nor a note of a session ended.
      test(`signing out with the probe in flight, its later ${status} changes nothing`, async ({
        authenticatedPage: page,
      }) => {
        const answer = await holdTheProbe(page);
        await page.goto('/markets');
        await expect(logoLink(page)).toBeVisible();

        await signOutFromTheBar(page);
        await page.waitForURL(/\/login$/);

        await answer(status);

        await expect(page).toHaveURL(/\/login$/);
        await expectLogoAlone(page);
        expect(await page.evaluate(() => localStorage.getItem('user'))).toBeNull();
      });
    }

    test('signing out with the probe in flight, its later 200 brings nothing back', async ({
      authenticatedPage: page,
    }) => {
      const answer = await holdTheProbe(page);
      await page.goto('/markets');
      await expect(logoLink(page)).toBeVisible();

      await signOutFromTheBar(page);
      await page.waitForURL(/\/login$/);

      await answer(200);

      await expectLogoAlone(page);
      expect(await page.evaluate(() => localStorage.getItem('user'))).toBeNull();
    });

    test('signing in shows the full bar at once, with no reload', async ({ page }) => {
      const login = new LoginPage(page);
      await login.goto();
      await expectLogoAlone(page);
      await markTheDocument(page);

      await login.signIn(TEST_USER.email, TEST_USER.password);
      await login.waitForDashboardRedirect();

      await expectFullBar(page);
      await expectSameDocument(page);
    });

    test('a stale stored user on a public page shows the full bar, and its links lead to sign-in', async ({
      authenticatedPage: page,
    }) => {
      await page.context().clearCookies();
      await page.goto(`/${marketSlug}`);
      await expect(logoLink(page)).toBeVisible();

      await withPlacesOpen(page, () => press(place(page, 'Markets')));

      await page.waitForURL(/\/login\?/);
      await expectLogoAlone(page);
    });

    test("a Viewer's bar is the same as an Owner's", async ({ authenticatedPage: page }) => {
      /** The bar as a person reads it, with the one thing that differs, whose it is, taken out. */
      const readTheBar = async (email: string) => {
        await page.goto(marketScreenPath(marketId, 'stats'));
        await expect(logoLink(page)).toBeVisible();
        if (size.phone) await press(menuButton(page));
        const read = (await bar(page).ariaSnapshot()).split(email).join('<address>');
        if (size.phone) await page.keyboard.press('Escape');
        return read;
      };

      const owners = await readTheBar(TEST_USER.email);
      expect(owners).toContain('<address>');
      await signOutFromTheBar(page);
      await page.waitForURL(/\/login$/);

      const login = new LoginPage(page);
      await login.signIn(VIEWER.email, VIEWER.password);
      await login.waitForDashboardRedirect();

      expect(await readTheBar(VIEWER.email)).toBe(owners);
    });

    test('an organizer with no organization has the same bar', async ({ page }) => {
      const login = new LoginPage(page);
      await login.login(NO_ORG_USER.email, NO_ORG_USER.password);
      await login.waitForDashboardRedirect();

      await expectFullBar(page, NO_ORG_USER.email);
    });

    test('Page not found offers Sign in signed out', async ({ page }) => {
      await page.goto('/no/such/page');
      const notFound = page.getByTestId('page-not-found');
      await expect(notFound.getByRole('button', { name: 'Markets' })).toHaveCount(0);

      await press(notFound.getByRole('button', { name: 'Sign in' }));

      await page.waitForURL(/\/login$/);
    });

    test('Page not found leads a signed-in organizer to Markets', async ({
      authenticatedPage: page,
    }) => {
      await page.goto('/no/such/page');
      const notFound = page.getByTestId('page-not-found');
      await expect(notFound.getByRole('button', { name: 'Sign in' })).toHaveCount(0);

      await press(notFound.getByRole('button', { name: 'Markets' }));

      await page.waitForURL(/\/markets$/);
    });

    test('the shell makes no session probe on a public page, signed in or out', async ({
      page,
    }) => {
      let probes = 0;
      page.on('request', (request) => {
        if (request.url().endsWith('/check-session')) probes += 1;
      });
      const visit = async (paths: string[]) => {
        for (const path of paths) {
          await page.goto(path);
          await page.waitForLoadState('networkidle');
          expect(probes, path).toBe(0);
        }
      };

      await visit(['/login', '/reset-password-request', `/${marketSlug}`, '/no/such/page']);

      const login = new LoginPage(page);
      await login.login(TEST_USER.email, TEST_USER.password);
      await login.waitForDashboardRedirect();
      probes = 0;
      await visit(['/reset-password-request', `/${marketSlug}`, '/no/such/page']);

      // That the count can move at all: an organizer's page does probe.
      await page.goto('/markets');
      await expect.poll(() => probes).toBe(1);
    });
  });
}

for (const size of SIZES) {
  test.describe(`Change password, ${size.name}`, () => {
    test.use(size.use);

    const press = (locator: Locator) => (size.phone ? locator.tap() : locator.click());
    const emailField = (page: Page) => page.getByTestId('password-reset-request-email-input');
    const backLink = (page: Page) => page.getByTestId('password-reset-request-back-link');

    async function chooseChangePassword(page: Page): Promise<void> {
      if (size.phone) {
        await press(page.getByTestId('app-bar-menu-button'));
        await press(
          page.getByTestId('app-bar-sheet').getByRole('link', { name: 'Change password' }),
        );
      } else {
        await press(accountButton(page));
        await press(changePasswordItem(page));
      }
    }

    test('opens the reset page with the address filled in and editable, and not in the address', async ({
      authenticatedPage: page,
    }) => {
      await page.goto('/markets');
      await chooseChangePassword(page);

      await expect(emailField(page)).toHaveValue(TEST_USER.email);
      const here = new URL(page.url());
      expect(here.pathname).toBe('/reset-password-request');
      expect(here.search).toBe('');
      expect(here.hash).toBe('');
      await expect(page.getByTestId('app-bar-sheet')).toHaveCount(0);

      await emailField(page).fill('someone-else@example.com');
      await expect(emailField(page)).toHaveValue('someone-else@example.com');
    });

    test('chosen on the reset page itself, it stays there and the menu closes', async ({
      authenticatedPage: page,
    }) => {
      await page.goto('/reset-password-request');
      await chooseChangePassword(page);
      await expect(page).toHaveURL(/\/reset-password-request$/);
      await expect(page.getByTestId('app-bar-sheet')).toHaveCount(0);
      await expect(accountMenu(page)).toBeHidden();
    });

    test('says only what is true of someone signed in, and leads back to Markets', async ({
      authenticatedPage: page,
    }) => {
      await page.goto('/reset-password-request');
      await expect(page.getByText('Enter your email address')).toHaveCount(0);
      await expect(backLink(page)).toHaveText('Back to Markets');
      await press(backLink(page));
      await expect(page).toHaveURL(/\/markets$/);
    });

    test('a link that is refused keeps the session and still leads back to Markets', async ({
      authenticatedPage: page,
    }) => {
      await page.goto('/reset-password?token=a-token-no-one-holds');
      await page.getByTestId('password-reset-new-password-input').fill('E2eLinksNew456!');
      await page.getByTestId('password-reset-confirm-password-input').fill('E2eLinksNew456!');
      await press(page.getByTestId('password-reset-submit-button'));
      await expect(page.getByTestId('password-reset-error-message')).toBeVisible();

      const back = page.getByTestId('password-reset-back-link');
      await expect(back).toHaveText('Back to Markets');
      await press(back);
      await expect(page).toHaveURL(/\/markets$/);
      await expect(page.getByTestId('login-session-ended')).toHaveCount(0);
    });

    test('signed out, the field is empty and the page leads back to sign in', async ({ page }) => {
      await page.goto('/reset-password-request');
      await expect(emailField(page)).toHaveValue('');
      await expect(page.getByText('Enter your email address')).toBeVisible();
      await expect(backLink(page)).toHaveText('Back to sign in');
      await press(backLink(page));
      await expect(page).toHaveURL(/\/login$/);

      await page.goto('/reset-password?token=a-token-no-one-holds');
      await expect(page.getByTestId('password-reset-back-link')).toHaveText('Back to sign in');
    });
  });
}
