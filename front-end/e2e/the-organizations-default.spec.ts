import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL, NewMarketPage, OrganizationsPage } from './fixtures';
import { loginViaApi } from './helpers/seeds';
import { ensureVerifiedUser } from './helpers/verifiedUser';
import { withUser } from './helpers/withUser';
import { ManageMarketPage } from './pages/ManageMarketPage';

/**
 * The organization's default table, copied into each new market (E39/F02/S01).
 *
 * An admin of the organization raises "Check vendors in" to Admin in Manage organization, after a
 * confirmation saying it reaches only markets created from now on. A market the owner creates
 * afterwards starts with that row at Admin, marked as copied; the market created before keeps
 * Editor until its owner copies the organization's defaults again. A member reads the default and
 * changes nothing.
 */
test.use({ viewport: { width: 1440, height: 900 } });
test.describe.configure({ mode: 'serial' });

const ADMIN = { email: 'e2e-org-default-admin@example.com', password: 'e2epassword123' };
const MEMBER = { email: 'e2e-org-default-member@example.com', password: 'e2epassword123' };

const RUN = Date.now();
const ORG_NAME = `E2E Default Org ${RUN}`;
const OLDER_MARKET = `E2E Default Older ${RUN}`;
const NEWER_MARKET = `E2E Default Newer ${RUN}`;

let orgId = '';

async function ok(response: Awaited<ReturnType<APIRequestContext['post']>>) {
  expect(response.ok(), await response.text()).toBeTruthy();
}

test.beforeAll(async ({ request }) => {
  ensureVerifiedUser(ADMIN.email, ADMIN.password);
  ensureVerifiedUser(MEMBER.email, MEMBER.password);
  await loginViaApi(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  await ok(await request.post(`${BACKEND_URL}/organizations`, { data: { name: ORG_NAME } }));
  const listed = await request.get(`${BACKEND_URL}/organizations`);
  const { organizations } = (await listed.json()) as {
    organizations: Array<{ id: string; name: string }>;
  };
  orgId = organizations.find((org) => org.name === ORG_NAME)!.id;
  await ok(
    await request.post(`${BACKEND_URL}/organizations/${orgId}/admins`, {
      data: { user_email: ADMIN.email },
    }),
  );
  await ok(
    await request.post(`${BACKEND_URL}/organizations/${orgId}/members`, {
      data: { user_email: MEMBER.email },
    }),
  );
  // The market created before the default changes.
  await ok(
    await request.post(`${BACKEND_URL}/markets`, {
      data: {
        name: OLDER_MARKET,
        creationDate: new Date().toISOString(),
        organizationId: orgId,
        modificationList: [],
        assignmentObject: {},
      },
    }),
  );
});

async function openOrganization(page: Page): Promise<OrganizationsPage> {
  const orgs = new OrganizationsPage(page);
  await orgs.goto();
  await orgs.waitForLoaded();
  await page
    .getByTestId('organization-card')
    .filter({ hasText: ORG_NAME })
    .getByTestId('organizations-manage-button')
    .click();
  await orgs.waitForManageOverlay();
  await expect(orgs.defaultsToggle).toHaveAttribute('aria-expanded', 'false');
  await orgs.showDefaults();
  await expect(orgs.defaultsToggle).toHaveAttribute('aria-expanded', 'true');
  return orgs;
}

async function openMarketPermissions(page: Page, name: string): Promise<ManageMarketPage> {
  await page.goto(`/markets?q=${encodeURIComponent(name)}`);
  await page.getByTestId('market-card-manage-button').click();
  const manage = new ManageMarketPage(page);
  await manage.waitForOverlay();
  await manage.showPermissions();
  return manage;
}

test("an organization admin raises check-in to Admin for the organization's new markets", async ({
  browser,
}) => {
  await withUser(browser, ADMIN.email, ADMIN.password, async (page) => {
    const orgs = await openOrganization(page);
    await expect(orgs.defaultsReadOnly).toHaveCount(0);
    await expect(orgs.defaultSource('check-in')).toHaveText('Built-in default');
    await expect(orgs.defaultSelect('check-in')).toHaveAccessibleName('Check vendors in');
    await expect(orgs.defaultRow('manage-editors-and-viewers')).toContainText(
      'any Viewer can make themself an Editor',
    );

    await orgs.chooseDefault('check-in', 'admin');
    await expect(orgs.defaultConfirm).toContainText('Change “Check vendors in” for new markets?');
    await expect(orgs.defaultConfirm).toContainText(
      'Markets created from now on start with this. The markets it already holds keep their own.',
    );
    await orgs.confirmDefault();
    await expect(orgs.defaultConfirm).toHaveCount(0);
    await expect(orgs.defaultSelect('check-in')).toHaveValue('admin');
    await expect(orgs.defaultSource('check-in')).toContainText(
      `Set for this organization by ${ADMIN.email}`,
    );

    // Listed under the section, and in the organization's History: who, when, before and after.
    const change = orgs.defaultChanges.first();
    await expect(change).toContainText('Check vendors in');
    await expect(change).toContainText('Editor to Admin');
    await expect(change).toContainText(ADMIN.email);
    await expect(change).toContainText(String(new Date().getFullYear()));
    await orgs.openHistory();
    await expect(orgs.historySentences.first()).toHaveText(
      `${ADMIN.email} changed Check vendors in for new markets from Editor to Admin`,
    );
  });
});

test('a member reads the default and changes nothing', async ({ browser }) => {
  await withUser(browser, MEMBER.email, MEMBER.password, async (page) => {
    const orgs = await openOrganization(page);
    await expect(orgs.defaultsReadOnly).toHaveText(
      "Only the organization's owner and its admins change these.",
    );
    await expect(orgs.defaultSelects).toHaveCount(0);
    await expect(orgs.defaultRole('check-in')).toHaveText('Admin and above');
    await expect(orgs.defaultChanges.first()).toContainText('Editor to Admin');
  });
});

test('a market created afterwards starts with the row copied, and one created before keeps Editor', async ({
  authenticatedPage: page,
}) => {
  await page.goto('/markets');
  await page.getByTestId('markets-create-button').click();
  const newMarket = new NewMarketPage(page);
  await newMarket.waitForOverlay();
  await newMarket.orgSelect.and(page.locator(':enabled')).waitFor();
  await newMarket.orgSelect.selectOption({ label: ORG_NAME });
  await newMarket.fillMarketName(NEWER_MARKET);
  await newMarket.choosePath('form');
  await newMarket.clickSubmit();
  await newMarket.waitForSetupRedirect();

  const newer = await openMarketPermissions(page, NEWER_MARKET);
  await expect(newer.permissionSelect('check-in')).toHaveValue('admin');
  await expect(newer.permissionSource('check-in')).toHaveText('Copied from the organization');
  await expect(newer.permissionsSummary).toContainText('1 row differs');

  const older = await openMarketPermissions(page, OLDER_MARKET);
  await expect(older.permissionSelect('check-in')).toHaveValue('editor');
  await expect(older.permissionSource('check-in')).toHaveText('Built-in default');
});

test("the older market's owner copies the organization's defaults again", async ({
  authenticatedPage: page,
}) => {
  const older = await openMarketPermissions(page, OLDER_MARKET);

  await older.copyOrganizationDefaults();
  await expect(older.copyConfirm).toContainText("Copy the organization's defaults again?");
  await expect(older.copyConfirm).toContainText('Rows changed on this market are replaced.');
  await older.confirmCopy();
  await expect(older.copyConfirm).toHaveCount(0);

  await expect(older.permissionSelect('check-in')).toHaveValue('admin');
  await expect(older.permissionSource('check-in')).toHaveText('Copied from the organization');
  const change = older.permissionChanges.first();
  await expect(change).toContainText("Copied the organization's defaults");
  await expect(change).toContainText('Check vendors in: Editor to Admin');
  await expect(change).toContainText(TEST_USER.email);
});
