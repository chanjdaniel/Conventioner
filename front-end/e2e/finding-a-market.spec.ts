import type { APIRequestContext } from '@playwright/test';
import { test, expect, BACKEND_URL, LoginPage } from './fixtures';
import { loginViaApi } from './helpers/seeds';
import { savePlan } from './helpers/savePlan';
import { seedDraftMarket } from './helpers/seedDraftMarket';
import { transitionMarket } from './helpers/seedPhaseMarket';
import { ensureVerifiedUser } from './helpers/verifiedUser';
import { MarketsPage } from './pages/MarketsPage';

/**
 * Finding a market on the Markets page (E25/F01/S01): search as you type, an organization, phases
 * and an order, applied together and held in the page's address.
 *
 * A user of its own, so the list is exactly the markets seeded here rather than whatever the
 * shared test user has gathered from every other spec.
 */

const RUN = Date.now();
const USER = { email: `e2e-finder-${RUN}@example.com`, password: 'FinderPass123!' };

/** A calendar day `offset` days from the viewer's today, so the upcoming/past split never rots. */
function dayFromToday(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function plan(dates: string[]) {
  return {
    priority: [],
    marketDates: dates.map((date) => ({ date })),
    tiers: [{ id: 1, name: 'Standard' }],
    locations: [{ name: 'Main Hall' }],
    sections: [
      {
        name: 'Hall',
        location: { name: 'Main Hall' },
        tier: { id: 1, name: 'Standard' },
        count: 4,
      },
    ],
    assignmentOptions: { maxAssignmentsPerVendor: null, maxHalfTableProportionPerSection: null },
  };
}

const headers = { 'Content-Type': 'application/json', 'X-Owner-Email': USER.email };

async function createOrg(request: APIRequestContext, name: string): Promise<string> {
  const res = await request.post(`${BACKEND_URL}/organizations`, { headers, data: { name } });
  expect(res.ok(), await res.text()).toBe(true);
  return ((await res.json()) as { organization_id: string }).organization_id;
}

async function createMarket(
  request: APIRequestContext,
  organizationId: string,
  name: string,
  dates: string[],
): Promise<string> {
  const { marketId } = await seedDraftMarket(request, BACKEND_URL, USER.email, USER.password, {
    name,
    organizationId,
  });
  await savePlan(request, BACKEND_URL, USER.email, marketId, plan(dates));
  return marketId;
}

const TEST_FAIR = `Test Fair ${RUN}`;
const CAFE = `Café Latest ${RUN}`;
const WINTER = `Winter Market ${RUN}`;
const ATTIC = `Attic Sale ${RUN}`;

test.describe('Finding a market', () => {
  test.beforeAll(async ({ request }) => {
    ensureVerifiedUser(USER.email, USER.password);
    await loginViaApi(request, BACKEND_URL, USER.email, USER.password);
    const orgA = await createOrg(request, `Finder North ${RUN}`);
    const orgB = await createOrg(request, `Finder South ${RUN}`);
    await createOrg(request, `Finder Empty ${RUN}`);

    await createMarket(request, orgA, TEST_FAIR, [dayFromToday(10)]);
    const cafe = await createMarket(request, orgA, CAFE, [dayFromToday(40)]);
    const winter = await createMarket(request, orgB, WINTER, [dayFromToday(-60)]);
    await createMarket(request, orgA, ATTIC, []);

    // Applications open needs a form that asks something; the plan's dates are essential
    // questions, so that alone is a form.
    await transitionMarket(request, BACKEND_URL, USER.email, cafe, 'applications_open');
    await transitionMarket(request, BACKEND_URL, USER.email, winter, 'archived');
  });

  test.beforeEach(async ({ page }) => {
    const login = new LoginPage(page);
    await login.login(USER.email, USER.password);
    await login.waitForDashboardRedirect();
  });

  test('search narrows as it is typed, and composes with filters and sort', async ({ page }) => {
    const markets = new MarketsPage(page);
    await markets.goto();

    // Market date by default: soonest upcoming, then past, then no dates.
    await markets.expectNames([TEST_FAIR, CAFE, WINTER, ATTIC]);
    await expect(markets.resultCount).toHaveText('4 markets');

    await markets.searchInput.pressSequentially('te');
    await markets.expectNames([TEST_FAIR, CAFE, WINTER]);
    await markets.searchInput.pressSequentially('s');
    await markets.expectNames([TEST_FAIR, CAFE]);
    await expect(markets.resultCount).toHaveText('2 of 4 markets');
    await expect(page).toHaveURL(/[?&]q=tes(&|$)/);

    // Accents and case do not count.
    await markets.searchInput.fill('CAFE');
    await markets.expectNames([CAFE]);
    await markets.searchInput.fill('');
    await markets.expectNames([TEST_FAIR, CAFE, WINTER, ATTIC]);

    // An organization with no markets is still offered, and says so rather than "No markets found".
    // Clear filters clears all three at once, with text in the box as well as without.
    await markets.orgSelect.selectOption({ label: `Finder Empty ${RUN}` });
    await markets.phaseToggle('draft').click();
    await markets.searchInput.fill('fair');
    await expect(markets.noMatch).toContainText('No markets match these filters');
    await markets.clearFiltersButton.click();
    await markets.expectNames([TEST_FAIR, CAFE, WINTER, ATTIC]);
    await expect(markets.orgSelect).toHaveValue('');
    await expect(markets.searchInput).toHaveValue('');
    await expect(markets.allPhasesToggle).toHaveAttribute('aria-pressed', 'true');
    await expect(page).toHaveURL(/\/markets$/);

    // Organization + phase + sort together.
    await markets.orgSelect.selectOption({ label: `Finder North ${RUN}` });
    await markets.expectNames([TEST_FAIR, CAFE, ATTIC]);
    await markets.phaseToggle('draft').click();
    await expect(markets.phaseToggle('draft')).toHaveAttribute('aria-pressed', 'true');
    await expect(markets.allPhasesToggle).toHaveAttribute('aria-pressed', 'false');
    await markets.expectNames([TEST_FAIR, ATTIC]);
    await markets.phaseToggle('applications_open').click();
    await markets.expectNames([TEST_FAIR, CAFE, ATTIC]);
    await markets.sortSelect.selectOption('name');
    await markets.expectNames([ATTIC, CAFE, TEST_FAIR]);
    await markets.searchInput.fill('a');
    await markets.expectNames([ATTIC, CAFE, TEST_FAIR]);
    await markets.searchInput.fill('sale');
    await markets.expectNames([ATTIC]);
    await markets.searchInput.fill('e');
    await markets.expectNames([ATTIC, CAFE, TEST_FAIR]);

    // Opening a market and coming Back returns to the same narrowed, ordered list.
    await markets.openMarket(CAFE);
    await expect(page).toHaveURL(/\/markets\/[^/?]+/);
    await page.goBack();
    await markets.expectNames([ATTIC, CAFE, TEST_FAIR]);
    await expect(markets.sortSelect).toHaveValue('name');
    await expect(markets.searchInput).toHaveValue('e');
    await expect(markets.phaseToggle('draft')).toHaveAttribute('aria-pressed', 'true');

    // And so does a reload.
    await page.reload();
    await markets.expectNames([ATTIC, CAFE, TEST_FAIR]);

    // "All phases" lets every phase back in.
    await markets.allPhasesToggle.click();
    await markets.expectNames([ATTIC, CAFE, TEST_FAIR]);
    await expect(markets.phaseToggle('draft')).toHaveAttribute('aria-pressed', 'false');
  });

  test('an address naming what no longer exists opens onto every market', async ({ page }) => {
    const markets = new MarketsPage(page);
    await markets.goto('?org=gone&phase=bogus&sort=sideways&q=');
    await markets.expectNames([TEST_FAIR, CAFE, WINTER, ATTIC]);
    await expect(markets.orgSelect).toHaveValue('');
    await expect(markets.sortSelect).toHaveValue('date');
  });

  // The shell's own floor is 1000px (`.app-container` in App.vue): the product is not laid out for
  // a phone, so the narrowest window the finder must fit is that one.
  test('the finder fits the narrowest window the app is laid out for', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 800 });
    const markets = new MarketsPage(page);
    await markets.goto();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
