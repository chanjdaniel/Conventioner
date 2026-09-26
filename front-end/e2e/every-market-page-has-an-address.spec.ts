import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import {
  ensureTestOrg,
  seedMarketWithVendors,
  seedPublishedMarketWithAssignments,
} from './helpers/seeds';
import { seedAssignedMarket } from './helpers/seedAssignedMarket';
import type { Page } from '@playwright/test';

/**
 * Every market page has its own address, and the bar reaches every one (E22/F04/S02, from the
 * the-assignment-tab ticket 02).
 *
 * The bar carries Market Setup, Application Form, Applications, Assignment, and Attendance once
 * the market is published. It is rendered once, by the frame, so Tables - now the Result page -
 * Vendors and Attendance are reached the same way as the plan; the Back buttons those screens kept
 * because they had no tabs are gone.
 */
const at = (marketId: string, page = '') => `/markets/${marketId}${page ? `/${page}` : ''}`;

async function activeTab(page: Page, tab: string) {
  await expect(page.getByTestId(`market-bar-tab-${tab}`)).toHaveClass(/active/, { timeout: 15000 });
}

test.describe('Every market page has its own address', () => {
  let published: string;
  let assigned: string;

  test.beforeAll(async ({ request }) => {
    await ensureTestOrg(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
    published = (
      await seedPublishedMarketWithAssignments(
        request,
        BACKEND_URL,
        TEST_USER.email,
        TEST_USER.password,
      )
    ).marketId;
    assigned = (await seedAssignedMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password))
      .marketId;
  });

  test('each page opens at its address, under its tab, and a refresh keeps it', async ({
    authenticatedPage: page,
  }) => {
    for (const [where, tab] of [
      ['setup', 'setup'],
      ['form', 'form'],
      ['applications', 'applications'],
      ['assignment', 'assignment'],
      ['result', 'assignment'],
      ['vendors', 'assignment'],
      ['attendance', 'attendance'],
    ] as const) {
      await page.goto(at(published, where));
      await activeTab(page, tab);
      await page.reload();
      await expect(page).toHaveURL(new RegExp(`/markets/${published}/${where}$`));
      await activeTab(page, tab);
    }
  });

  test('the old addresses land on their pages', async ({ authenticatedPage: page }) => {
    await page.goto(`${at(published, 'setup')}?tab=form`);
    await expect(page).toHaveURL(new RegExp(`/markets/${published}/form$`));
    await activeTab(page, 'form');

    await page.goto(`${at(published, 'tables')}?date=2026-07-15`);
    await expect(page).toHaveURL(new RegExp(`/markets/${published}/result\\?date=2026-07-15$`));
    await activeTab(page, 'assignment');
  });

  test('the flows carry the bar with their tab active', async ({ authenticatedPage: page }) => {
    await page.goto(at(assigned, 'import'));
    await activeTab(page, 'applications');
    await page.goto(at(assigned, 'floorplan'));
    await activeTab(page, 'setup');
  });

  test('a market opens on the page it is worked on in its phase', async ({
    authenticatedPage: page,
    request,
  }) => {
    await page.goto(at(assigned));
    await expect(page).toHaveURL(new RegExp(`/markets/${assigned}/result$`), { timeout: 15000 });

    await page.goto(at(published));
    await expect(page).toHaveURL(new RegExp(`/markets/${published}/attendance$`), {
      timeout: 15000,
    });

    const draft = await seedMarketWithVendors(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );
    await page.goto(at(draft.marketId));
    await expect(page).toHaveURL(new RegExp(`/markets/${draft.marketId}/setup$`), {
      timeout: 15000,
    });

    // A tab opens the page carrying the dot when it holds it.
    await page.goto(at(assigned, 'setup'));
    await page.getByTestId('market-bar-tab-assignment').click();
    await expect(page).toHaveURL(new RegExp(`/markets/${assigned}/result$`));
  });

  test('Attendance is a tab once the market is published, the moment it is', async ({
    authenticatedPage: page,
    request,
  }) => {
    const market = (
      await seedAssignedMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password)
    ).marketId;
    await page.goto(at(market, 'assignment'));
    await activeTab(page, 'assignment');
    await expect(page.getByTestId('market-bar-tab-attendance')).toHaveCount(0);

    await page.getByTestId('phase-transition-market_days').click();
    await page.getByTestId('sweep-confirm-submit-button').click();

    await expect(page.getByTestId('market-bar-tab-attendance')).toBeVisible({ timeout: 10000 });
  });

  test('no market page keeps a Back button of its own', async ({ authenticatedPage: page }) => {
    for (const where of ['result', 'vendors', 'attendance']) {
      await page.goto(at(published, where));
      await expect(page.getByTestId('market-bar-title')).toBeVisible({ timeout: 15000 });
      await expect(page.locator('[data-testid$="-back-button"]')).toHaveCount(0);
    }
  });
});
