import type { APIRequestContext, Locator, Page, Route } from '@playwright/test';
import { test, expect, BACKEND_URL, LoginPage, ManageMarketPage } from './fixtures';
import { loginViaApi } from './helpers/seeds';
import { marketSetupPath } from './helpers/marketScreens';
import { widths } from './helpers/phoneWindow';
import { savePlan } from './helpers/savePlan';
import { seedDraftMarket } from './helpers/seedDraftMarket';
import { ensureVerifiedUser } from './helpers/verifiedUser';

/**
 * What Markets says first: the market last opened, one that has gone, or that there is none yet.
 *
 * Each is about the account, not the browser. An organizer who had markets was once told they had
 * none, because the question was put to `localStorage`, which knows only what this browser opened
 * (E14/F01/S02). What names the market last opened is a `lastMarketId` pointer, set by arriving at
 * a market; the line is drawn from the server's answer for that id (E21/F02/S05).
 *
 * Every test has an organizer of its own, so its list is exactly the markets it seeds.
 */

const WINDOWS = [
  { name: 'at a desk', phone: false, use: { viewport: { width: 1280, height: 800 } } },
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

const PASSWORD = 'OpeningWords123!';
/** Longer than the line holds at either window. */
const LONG_NAME =
  'The Riverside Spring Handmade and Vintage Market of Unusually Many Words, Held Every Year on the Old Harbour Front by the Friends of the Riverside Makers and Their Many Neighbours';

const line = (page: Page) => page.getByTestId('markets-previously-opened');
const note = (page: Page) => page.getByTestId('markets-last-market-gone');
const message = (page: Page) => page.getByTestId('markets-no-market-yet');
const finder = (page: Page) => page.getByTestId('markets-finder');
const cards = (page: Page) => page.getByTestId('market-card');

let accounts = 0;

/** A verified organizer of this test's own, with these markets, and signed in on `page`. */
async function organizerWith(page: Page, request: APIRequestContext, names: string[]) {
  // Short, since the organization's name is a fact a card must hold on one line, even on a phone.
  const run = `${Date.now().toString(36)}${(accounts += 1)}`;
  const email = `e2e-opening-${run}@example.com`;
  ensureVerifiedUser(email, PASSWORD);
  await loginViaApi(request, BACKEND_URL, email, PASSWORD);
  const res = await request.post(`${BACKEND_URL}/organizations`, {
    headers: { 'Content-Type': 'application/json', 'X-Owner-Email': email },
    data: { name: `Org ${run}` },
  });
  expect(res.ok(), await res.text()).toBe(true);
  const { organization_id: organizationId } = (await res.json()) as { organization_id: string };
  const markets: { id: string; name: string }[] = [];
  for (const words of names) {
    // A market's address is its name, and addresses are shared across the stack.
    const name = `${words} ${run}`;
    const seeded = await seedDraftMarket(request, BACKEND_URL, email, PASSWORD, {
      name,
      organizationId,
    });
    markets.push({ id: seeded.marketId, name });
  }
  const login = new LoginPage(page);
  await login.login(email, PASSWORD);
  await login.waitForDashboardRedirect();
  return { email, markets };
}

/** Plants the pointer as arriving at a market leaves it, for a market that may not exist. */
async function remember(page: Page, id: string) {
  await page.evaluate((remembered) => localStorage.setItem('lastMarketId', remembered), id);
}

const pointer = (page: Page) => page.evaluate(() => localStorage.getItem('lastMarketId'));

/** The API's list, and not the page of the same address. */
const isTheRead = (route: Route) => route.request().resourceType() !== 'document';

for (const size of WINDOWS) {
  test.describe(`what Markets says first, ${size.name}`, () => {
    test.use(size.use);

    const expectItFits = async (page: Page) =>
      expect(await widths(page)).toEqual({
        layout: size.use.viewport.width,
        sideways: 0,
        zoom: 1,
      });

    test('a remembered market is one line above the finder, opening it', async ({
      page,
      request,
    }) => {
      const { markets } = await organizerWith(page, request, ['Riverside Market', 'Harbour Fair']);
      await page.goto(marketSetupPath(markets[0].id));
      await expect(page.getByTestId('market-bar-title')).toHaveText(markets[0].name);
      await page.goto('/markets');

      await expect(line(page)).toContainText('Previously opened');
      await expect(line(page)).toContainText(markets[0].name);
      const badge = line(page).getByTestId('phase-badge');
      await (size.phone ? expect(badge).toBeHidden() : expect(badge).toBeVisible());

      const lineBox = (await line(page).boundingBox())!;
      const finderBox = (await finder(page).boundingBox())!;
      expect(lineBox.height, 'one 44px control').toBeCloseTo(44, 1);
      expect(lineBox.y + lineBox.height, 'above the finder').toBeLessThanOrEqual(finderBox.y);
      expect(lineBox.x, 'the width of what it stands over').toBeCloseTo(finderBox.x, 1);
      expect(lineBox.width, 'the width of what it stands over').toBeCloseTo(finderBox.width, 1);

      // Its whole width opens the market, right up to the far end of the line.
      await line(page).click({ position: { x: lineBox.width - 4, y: lineBox.height / 2 } });
      await expect(page).toHaveURL(new RegExp(`/markets/${markets[0].id}`));
    });

    test('the keyboard opens it too', async ({ page, request }) => {
      const { markets } = await organizerWith(page, request, ['Riverside Market', 'Harbour Fair']);
      await remember(page, markets[1].id);
      await page.goto('/markets');

      await line(page).focus();
      await page.keyboard.press('Enter');

      await expect(page).toHaveURL(new RegExp(`/markets/${markets[1].id}`));
    });

    test('a long name is cut with an ellipsis, and nothing scrolls sideways', async ({
      page,
      request,
    }) => {
      const { markets } = await organizerWith(page, request, [LONG_NAME, 'Harbour Fair']);
      await remember(page, markets[0].id);
      await page.goto('/markets');

      const name = line(page).getByTitle(markets[0].name);
      await expect(name).toHaveText(markets[0].name);
      const cut = await name.evaluate((el) => ({
        overflow: getComputedStyle(el).textOverflow,
        cut: el.scrollWidth > el.clientWidth,
      }));
      expect(cut).toEqual({ overflow: 'ellipsis', cut: true });
      expect((await line(page).boundingBox())!.height, 'still one line').toBeCloseTo(44, 1);
      await expectItFits(page);
    });

    test('filters and search do not hide it', async ({ page, request }) => {
      const { markets } = await organizerWith(page, request, ['Riverside Market', 'Harbour Fair']);
      await remember(page, markets[0].id);
      await page.goto('/markets');
      await expect(line(page)).toBeVisible();

      await page.getByTestId('markets-search-input').fill('nothing is called this');

      await expect(page.getByTestId('markets-no-match')).toBeVisible();
      await expect(line(page)).toBeVisible();
    });

    test('one market gets no line, and neither does nothing remembered', async ({
      page,
      request,
    }) => {
      const { markets } = await organizerWith(page, request, ['Riverside Market']);
      await remember(page, markets[0].id);
      await page.goto('/markets');
      await expect(cards(page)).toHaveCount(1);
      await expect(line(page)).toHaveCount(0);
      expect(await pointer(page), 'the pointer is not news of a market gone').toBe(markets[0].id);

      await page.evaluate(() => localStorage.removeItem('lastMarketId'));
      await page.reload();
      await expect(cards(page)).toHaveCount(1);
      await expect(line(page)).toHaveCount(0);
      await expect(note(page)).toHaveCount(0);
    });

    test('a remembered market gone is said once, with others left', async ({ page, request }) => {
      await organizerWith(page, request, ['Riverside Market']);
      await remember(page, 'a-market-that-has-gone');
      await page.goto('/markets');

      await expect(note(page)).toHaveText(
        'The market you last opened is no longer available. Your other markets are still here.',
      );
      await expect(line(page)).toHaveCount(0);
      await expect(cards(page)).toHaveCount(1);
      expect(await pointer(page)).toBeNull();
      await expectItFits(page);

      await page.reload();
      await expect(cards(page)).toHaveCount(1);
      await expect(note(page)).toHaveCount(0);
    });

    test('a remembered market gone is said once, with none left', async ({ page, request }) => {
      await organizerWith(page, request, []);
      await remember(page, 'a-market-that-has-gone');
      await page.goto('/markets');

      await expect(note(page)).toHaveText(
        'The market you last opened is no longer available, and there are no others.',
      );
      await expect(message(page)).toHaveCount(0);
      await expect(page.getByTestId('markets-empty')).toHaveCount(0);
      expect(await pointer(page)).toBeNull();

      await page.reload();
      await expect(message(page)).toBeVisible();
      await expect(note(page)).toHaveCount(0);
    });

    /** An unreachable server costs the line, and shows nothing stale in its place. */
    test('a failed read gives no note and forgets nothing', async ({ page, request }) => {
      const { markets } = await organizerWith(page, request, ['Riverside Market', 'Harbour Fair']);
      await remember(page, markets[0].id);
      await page.route('**/markets', (route) =>
        isTheRead(route) ? route.abort() : route.continue(),
      );
      await page.goto('/markets');

      await expect(page.getByTestId('markets-read-failed')).toBeVisible();
      await expect(note(page)).toHaveCount(0);
      await expect(line(page)).toHaveCount(0);
      await expect(message(page)).toHaveCount(0);
      expect(await pointer(page)).toBe(markets[0].id);

      await page.unroute('**/markets');
      await page.getByTestId('markets-retry').click();
      await expect(line(page)).toContainText(markets[0].name);
    });

    test('deleting the remembered market in Manage gives no note, and the line goes', async ({
      page,
      request,
    }) => {
      const { markets } = await organizerWith(page, request, ['Riverside Market', 'Harbour Fair']);
      await remember(page, markets[0].id);
      await page.goto('/markets');
      await expect(line(page)).toBeVisible();

      const card = cards(page).filter({ hasText: markets[0].name });
      await card.getByTestId('market-card-manage-button').click();
      const manage = new ManageMarketPage(page);
      await manage.waitForOverlay();
      await manage.deleteButton.click();
      await manage.deleteConfirmButton.click();

      await expect(card).toHaveCount(0);
      await expect(line(page)).toHaveCount(0);
      await expect(note(page)).toHaveCount(0);

      await page.reload();
      await expect(cards(page)).toHaveCount(1);
      await expect(note(page)).toHaveCount(0);
    });

    test('a first-time organizer is told what to do, and its link works', async ({
      page,
      request,
    }) => {
      await organizerWith(page, request, []);
      await page.goto('/markets');

      await expect(message(page)).toHaveText(
        'You have not set up a market yet. Every market belongs to an organization - if you are not in one yet, create it under Organizations first.',
      );
      await expect(page.getByTestId('markets-empty')).toHaveCount(0);
      await expectItFits(page);

      await message(page).getByRole('link', { name: 'Organizations' }).click();
      await expect(page).toHaveURL(/\/organizations$/);
    });

    test('nothing jumps when the list arrives: the line comes with it', async ({
      page,
      request,
    }) => {
      const { markets } = await organizerWith(page, request, ['Riverside Market', 'Harbour Fair']);
      await remember(page, markets[0].id);
      let release = () => {};
      const held = new Promise<void>((resolve) => (release = resolve));
      await page.route('**/markets', async (route) => {
        if (isTheRead(route)) await held;
        await route.continue();
      });
      await page.goto('/markets');

      await expect(page.getByText('Loading markets...')).toBeVisible();
      await expect(line(page), 'it waits for the held answer').toHaveCount(0);
      await expect(note(page)).toHaveCount(0);
      const headerBefore = await page.getByTestId('markets-create-button').boundingBox();

      release();
      await expect(finder(page)).toBeVisible();
      await expect(line(page)).toBeVisible();
      expect(await page.getByTestId('markets-create-button').boundingBox()).toEqual(headerBefore);
      const lineAt = await line(page).boundingBox();

      // A re-read after a dialog closes keeps the line and the finder where they stood.
      await page.getByTestId('markets-create-button').click();
      await page.keyboard.press('Escape');
      await expect(line(page)).toBeVisible();
      expect(await line(page).boundingBox()).toEqual(lineAt);
    });

    /** It is asked of the server, and a reload does not lose it (E14/F01/S02). */
    test('an organizer with markets is never told they have none', async ({ page, request }) => {
      await organizerWith(page, request, ['Riverside Market']);

      // A browser that has never opened one: a fresh context is exactly that.
      await page.goto('/markets');
      await expect(cards(page)).toHaveCount(1);
      await expect(message(page)).toHaveCount(0);

      await page.reload();
      await expect(cards(page)).toHaveCount(1);
      await expect(message(page)).toHaveCount(0);
    });

    /** A pointer, never a copy: the line can only ever be drawn from what the server says now. */
    test('the browser remembers which market, and nothing about it', async ({ page, request }) => {
      const { markets } = await organizerWith(page, request, ['Riverside Market', 'Harbour Fair']);
      await page.goto(marketSetupPath(markets[0].id));
      await expect(page.getByTestId('market-bar-title')).toHaveText(markets[0].name);

      const stored = await page.evaluate(() => ({
        pointer: localStorage.getItem('lastMarketId'),
        market: localStorage.getItem('market'),
      }));

      expect(stored).toEqual({ pointer: markets[0].id, market: null });
    });

    /** Each fact's value is a single line of text, not a column of fragments. */
    async function expectFactsOnOneLine(card: Locator) {
      const facts = await card.locator('dd').evaluateAll((dds) =>
        dds.map((dd) => ({
          text: dd.textContent,
          height: dd.getBoundingClientRect().height,
          lineHeight: parseFloat(getComputedStyle(dd).lineHeight),
        })),
      );
      expect(facts.length).toBe(2);
      for (const fact of facts) {
        expect(fact.height, `"${fact.text}" wrapped`).toBeLessThan(fact.lineHeight * 1.5);
      }
    }

    /**
     * The name column once took its whole 28rem at every width, leaving the facts so little room
     * on a narrow card that "Nov 18-20, 2026 (3 days)" broke after every few characters.
     */
    test('a market row reads each fact on one line', async ({ page, request }) => {
      const { email, markets } = await organizerWith(page, request, ['Riverside Market']);
      await savePlan(request, BACKEND_URL, email, markets[0].id, {
        priority: [],
        marketDates: [{ date: '2026-11-18' }, { date: '2026-11-19' }, { date: '2026-11-20' }],
        tiers: [],
        locations: [],
        sections: [],
        assignmentOptions: {
          maxAssignmentsPerVendor: null,
          maxHalfTableProportionPerSection: null,
        },
        floorplans: null,
      });
      await page.goto('/markets');

      const card = cards(page).filter({ hasText: markets[0].name });
      await expect(card).toContainText('Nov 18-20, 2026 (3 days)');
      await expectFactsOnOneLine(card);
    });
  });
}
