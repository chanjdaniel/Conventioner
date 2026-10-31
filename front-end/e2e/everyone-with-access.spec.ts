import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { ManageMarketPage } from './pages/ManageMarketPage';
import { loginViaApi } from './helpers/seeds';
import { ensureVerifiedUser } from './helpers/verifiedUser';
import { uniqueMarketName } from './helpers/uniqueName';

/**
 * Manage market lists everyone with access, at the role that counts and where it comes from
 * (E38/F12/S01).
 *
 * "Users with access" listed only the market's own roles: an organization's admins and members,
 * who act on every market it holds, were missing, an organization admin added as Editor was offered
 * a role select and Remove that changed nothing, and someone just added was listed above the owner.
 */
const ORG_ADMIN = { email: 'e2e-access-list-admin@example.com', password: 'e2eaccesslist123' };
const ORG_MEMBER = { email: 'e2e-access-list-member@example.com', password: 'e2eaccesslist123' };
const ADDED = { email: 'e2e-access-list-added@example.com', password: 'e2eaccesslist123' };

test.beforeAll(() => {
  for (const person of [ORG_ADMIN, ORG_MEMBER, ADDED]) {
    ensureVerifiedUser(person.email, person.password);
  }
});

/**
 * The walk's case, on an organization of its own: an admin and a member, the admin also given
 * Editor on the market, and someone from outside it added as Viewer, after the organization's people.
 */
async function seedTheWalksCase(request: APIRequestContext) {
  const ownerId = await loginViaApi(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  const orgName = uniqueMarketName('Access Org');
  const org = await request.post(`${BACKEND_URL}/organizations`, { data: { name: orgName } });
  expect(org.ok(), await org.text()).toBeTruthy();
  const orgId = (await org.json()).organization_id as string;
  for (const [place, email] of [
    ['admins', ORG_ADMIN.email],
    ['members', ORG_MEMBER.email],
  ]) {
    const added = await request.post(`${BACKEND_URL}/organizations/${orgId}/${place}`, {
      data: { user_email: email },
    });
    expect(added.ok(), await added.text()).toBeTruthy();
  }
  const marketName = uniqueMarketName('Access Market');
  const market = await request.post(`${BACKEND_URL}/markets`, {
    data: {
      name: marketName,
      creationDate: new Date().toISOString(),
      organizationId: orgId,
      roles: { [ownerId]: 'owner' },
      modificationList: [],
      assignmentObject: {},
    },
  });
  expect(market.ok(), await market.text()).toBeTruthy();
  const marketId = (await market.json()).market_id as string;
  for (const [email, role] of [
    [ORG_ADMIN.email, 'editor'],
    [ADDED.email, 'viewer'],
  ]) {
    const given = await request.post(`${BACKEND_URL}/markets/${marketId}/roles`, {
      data: { user_email: email, role },
    });
    expect(given.ok(), await given.text()).toBeTruthy();
  }
  return { orgId, orgName, marketName };
}

async function openManage(page: Page, marketName: string): Promise<ManageMarketPage> {
  await page.goto(`/markets?q=${encodeURIComponent(marketName)}`);
  await page.getByTestId('market-card-manage-button').click();
  const manage = new ManageMarketPage(page);
  await manage.waitForOverlay();
  return manage;
}

const person = (page: Page, email: string) =>
  page.getByTestId('manage-market-person').filter({ hasText: email });

test.describe('Users with access', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("lists the organization's people at the role that counts, the owner first", async ({
    authenticatedPage: page,
    request,
  }) => {
    const { orgId, orgName, marketName } = await seedTheWalksCase(request);
    const manage = await openManage(page, marketName);

    // The owner first, then by the role that counts, then by address.
    await expect(page.getByTestId('manage-market-person').locator('.user-email')).toHaveText([
      TEST_USER.email,
      ORG_ADMIN.email,
      ADDED.email,
      ORG_MEMBER.email,
    ]);

    // The member's role comes from the organization: stated, with nothing to change it here.
    const member = person(page, ORG_MEMBER.email);
    await expect(member.getByTestId('manage-market-role')).toHaveText(`Viewer, through ${orgName}`);
    await expect(member.getByTestId('manage-market-role-select')).toHaveCount(0);
    await expect(member.getByTestId('manage-market-remove-user-button')).toHaveCount(0);

    // The admin is listed once, at Admin, the Editor role beside it said to add nothing.
    const admin = person(page, ORG_ADMIN.email);
    await expect(admin).toHaveCount(1);
    await expect(admin.getByTestId('manage-market-role')).toHaveText(`Admin, through ${orgName}`);
    await expect(admin.getByTestId('manage-market-role-select')).toHaveCount(0);
    await expect(admin.getByTestId('manage-market-also')).toHaveText(
      `Also Editor on this market: this adds nothing while they are an admin of ${orgName}.`,
    );

    // Someone whose market role counts keeps the select and Remove.
    const added = person(page, ADDED.email);
    await expect(added.getByTestId('manage-market-role-select')).toHaveValue('viewer');
    await expect(added.getByTestId('manage-market-remove-user-button')).toBeVisible();

    await expect(page.getByTestId('manage-market-organization')).toHaveText(
      `Belongs to ${orgName}. Its admins run it; its members can view it.`,
    );

    // Remove takes only the market role: the admin stays, at Admin, through the organization.
    await admin.getByTestId('manage-market-remove-user-button').click();
    await expect(admin.getByTestId('manage-market-also')).toHaveCount(0);
    await expect(admin.getByTestId('manage-market-role')).toHaveText(`Admin, through ${orgName}`);

    // The organization's people are managed in Manage organization, which the line opens.
    const note = page.getByTestId('manage-market-organization-people');
    await expect(note).toHaveText(
      'Organization admins and members are managed in Manage organization.',
    );
    await note.getByRole('link', { name: 'Manage organization' }).click();
    await expect(page).toHaveURL(new RegExp(`/organizations\\?manage=${orgId}$`));
    await expect(page.getByTestId('manage-org-window')).toBeVisible();
    await expect(page.getByTestId('manage-org-window')).toContainText(orgName);
    await expect(manage.window).toHaveCount(0);
  });
});

test.describe('Users with access on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('nothing overflows, and each Remove is a 44px target', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { marketName } = await seedTheWalksCase(request);
    const manage = await openManage(page, marketName);
    await expect(person(page, ORG_ADMIN.email).getByTestId('manage-market-also')).toBeVisible();

    const window = await manage.window.evaluate((el) => ({
      scroll: el.scrollWidth,
      client: el.clientWidth,
      right: el.getBoundingClientRect().right,
    }));
    expect(window.scroll, 'the dialog does not scroll sideways').toBeLessThanOrEqual(window.client);
    expect(window.right, 'inside the screen').toBeLessThanOrEqual(390);

    for (const row of await page.getByTestId('manage-market-person').all()) {
      const box = await row.boundingBox();
      expect((box?.x ?? 0) + (box?.width ?? 0), 'the row is inside the screen').toBeLessThanOrEqual(
        390,
      );
    }
    const removes = await manage.removeUserButtons.all();
    expect(removes.length, "the added person's Remove and the admin's").toBe(2);
    for (const remove of removes) {
      const box = await remove.boundingBox();
      expect(box?.height, 'a 44px target').toBeGreaterThanOrEqual(44);
      expect((box?.x ?? 0) + (box?.width ?? 0), 'inside the screen').toBeLessThanOrEqual(390);
    }
  });
});
