import type { APIRequestContext } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { VendorsPage } from './pages/VendorsPage';
import { completePlan } from './helpers/seeds';
import { savePlan } from './helpers/savePlan';
import { approvedVendorApplication, insertApplications } from './helpers/seedApplication';
import { seedPhaseMarket, transitionMarket } from './helpers/seedPhaseMarket';
import { marketScreenPath } from './helpers/marketScreens';
import { ensureVerifiedUser } from './helpers/verifiedUser';
import { withUser } from './helpers/withUser';
import { ManageMarketPage } from './pages/ManageMarketPage';

/**
 * A vendor's own history, in their drawer's History tab (E40/F01/S04).
 *
 * It was the placement trail alone; it is now everything the market's history holds about that
 * vendor, newest first, in the words of Manage market's History section. Two vendors are given a
 * verdict, a note and a table each through the API the screens call, on a fixture market, and each
 * drawer reads its own vendor's entries and never the other's. Raised above a Viewer, the history's
 * row takes the tab from their drawer and the changes from their Permissions section.
 */
const VENDOR = { email: 'e2e-drawer-history-vera@example.com', name: 'Vera Vendor' };
const OTHER = { email: 'e2e-drawer-history-otto@example.com', name: 'Otto Other' };
const VIEWER = { email: 'e2e-drawer-history-viewer@example.com', password: 'e2epassword123' };

async function ok(response: Awaited<ReturnType<APIRequestContext['put']>>) {
  expect(response.ok(), await response.text()).toBeTruthy();
}

async function seedTwoVendors(
  request: APIRequestContext,
): Promise<{ marketId: string; marketName: string }> {
  const seed = await seedPhaseMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  const plan = completePlan();
  const date = plan.marketDates[0].date;
  await savePlan(request, BACKEND_URL, TEST_USER.email, seed.marketId, plan);
  const applications = [VENDOR, OTHER].map((vendor) => ({
    ...approvedVendorApplication(seed.marketId, vendor.email, {
      dates: [date],
      tiers: ['Gold'],
      fullName: vendor.name,
    }),
    // As an import leaves it, so the verdict is the organizer's to give.
    status: 'open',
  }));
  insertApplications(applications);
  const market = `${BACKEND_URL}/markets/${seed.marketId}`;

  await transitionMarket(request, BACKEND_URL, TEST_USER.email, seed.marketId, 'applications');
  for (const application of applications) {
    await ok(
      await request.put(`${market}/applications/${application.id}/review`, {
        data: { status: 'reviewer_approved' },
      }),
    );
  }
  for (const vendor of [VENDOR, OTHER]) {
    await ok(
      await request.put(`${market}/vendor-notes/${encodeURIComponent(vendor.email)}`, {
        data: { note: `A note on ${vendor.name}` },
      }),
    );
  }

  await transitionMarket(request, BACKEND_URL, TEST_USER.email, seed.marketId, 'assignment');
  // Vera is given a table and then moved to another; Otto takes the one she left.
  for (const [vendor, table] of [
    [VENDOR, 'Hall A 1'],
    [VENDOR, 'Hall A 3'],
    [OTHER, 'Hall A 1'],
  ] as const) {
    await ok(
      await request.put(`${market}/placements`, {
        data: { email: vendor.email, date, table_code: table, table_choice: 'Full Table' },
      }),
    );
  }
  return { marketId: seed.marketId, marketName: seed.marketName };
}

function drawerPath(marketId: string, email: string): string {
  return `${marketScreenPath(marketId, 'vendors')}?vendor=${encodeURIComponent(email)}&vendorTab=history`;
}

test("a vendor's History tab reads their verdict, note and tables, newest first, and nobody else's", async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketId } = await seedTwoVendors(request);
  const vendors = new VendorsPage(page);
  const me = TEST_USER.email;
  // In their own drawer a vendor reads by name alone: its head already shows the address.
  const vera = VENDOR.name;
  const otto = OTHER.name;

  await page.goto(drawerPath(marketId, VENDOR.email));
  await expect(vendors.detailHistorySentences).toHaveText([
    `${me} moved ${vera} from Hall A 1 to Hall A 3 (Full Table) on May 1, 2099`,
    `${me} assigned ${vera} at Hall A 1 (Full Table) on May 1, 2099`,
    `${me} changed the note on ${vera}`,
    `${me} set ${vera} to Approved`,
  ]);
  // No filters in the drawer: it is already one vendor's.
  await expect(vendors.detailPanel.getByTestId('market-history-vendor')).toHaveCount(0);

  await page.goto(drawerPath(marketId, OTHER.email));
  await expect(vendors.detailHistorySentences).toHaveText([
    `${me} assigned ${otto} at Hall A 1 (Full Table) on May 1, 2099`,
    `${me} changed the note on ${otto}`,
    `${me} set ${otto} to Approved`,
  ]);
  await expect(vendors.detailPanel).not.toContainText(VENDOR.email);
});

test("a Viewer the history's row is raised above has no History tab and no Permissions changes", async ({
  browser,
  request,
}) => {
  ensureVerifiedUser(VIEWER.email, VIEWER.password);
  const { marketId, marketName } = await seedTwoVendors(request);
  const market = `${BACKEND_URL}/markets/${marketId}`;
  await ok(
    await request.post(`${market}/roles`, { data: { user_email: VIEWER.email, role: 'viewer' } }),
  );
  // As the owner raises it from the Permissions section.
  await ok(await request.put(`${market}/permissions/read-history`, { data: { role: 'editor' } }));

  await withUser(browser, VIEWER.email, VIEWER.password, async (page) => {
    // A link to the History tab opens on the Application tab rather than on a refusal.
    await page.goto(drawerPath(marketId, VENDOR.email));
    const tabs = page.getByRole('tablist', { name: 'Vendor detail' });
    await expect(tabs.getByRole('tab')).toHaveText(['Application', 'Assignments', 'Payment']);
    await expect(tabs.getByRole('tab', { name: 'Application' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByTestId('vendor-drawer-panel-application')).toBeVisible();
    await expect(page.getByTestId('market-history')).toHaveCount(0);

    await page.goto(`/markets?q=${encodeURIComponent(marketName)}`);
    await page.getByTestId('market-card-manage-button').click();
    const manage = new ManageMarketPage(page);
    await manage.waitForOverlay();
    await expect(manage.history).toHaveCount(0);
    await manage.showPermissions();
    await expect(manage.permissionRole('read-history')).toHaveText('Editor and above');
    await expect(manage.permissions).not.toContainText('Changes');
    await expect(manage.permissionChanges).toHaveCount(0);
    await expect(
      manage.permissions
        .getByTestId('manage-market-permission-row-read-history')
        .getByTestId('manage-market-permission-source'),
    ).toHaveText('Changed on this market');
  });
});
