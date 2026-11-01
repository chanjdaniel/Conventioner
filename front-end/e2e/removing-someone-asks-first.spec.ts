import type { APIRequestContext, Browser, Locator, Page } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL, LoginPage } from './fixtures';
import { ManageMarketPage } from './pages/ManageMarketPage';
import { OrganizationsPage } from './pages/OrganizationsPage';
import { loginViaApi } from './helpers/seeds';
import { ensureVerifiedUser } from './helpers/verifiedUser';
import { uniqueMarketName } from './helpers/uniqueName';

/**
 * Removing someone asks first, and says what they lose (E38/F15/S01).
 *
 * Each row's Remove in Manage organization and Manage market removed at once, from a filled red
 * button on every row: one click took a member's access to every market of the organization. Each
 * now opens a confirmation naming the person and what they lose; Cancel and Escape leave everything
 * as it was, and confirming removes in place with the dialog open and focus on the list.
 *
 * Confirming the removal of someone another organizer removed meanwhile, in a window of their own,
 * is done as well (T181): the confirmation closes and the row is gone, with nothing said of it.
 */
const PASSWORD = 'e2eremoveasks123';
const ADMIN = 'e2e-remove-asks-admin@example.com';
const MEMBER = 'e2e-remove-asks-member@example.com';
// A member who also holds a role of their own on one of the organization's markets.
const KEEPER = 'e2e-remove-asks-keeper@example.com';
// Someone from outside the organization, given a role on one market.
const OUTSIDER = 'e2e-remove-asks-outsider@example.com';

/** `--mm-red`, the destructive ink. */
const RED = 'rgb(192, 57, 43)';

test.beforeAll(() => {
  for (const email of [ADMIN, MEMBER, KEEPER, OUTSIDER]) ensureVerifiedUser(email, PASSWORD);
});

/**
 * An organization of three markets, an admin and two members, one of whom is also Editor on the
 * first market; that market also has an outsider as Viewer and the admin as Editor.
 */
async function seed(request: APIRequestContext) {
  const ownerId = await loginViaApi(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  const orgName = uniqueMarketName('Remove Org');
  const org = await request.post(`${BACKEND_URL}/organizations`, { data: { name: orgName } });
  expect(org.ok(), await org.text()).toBeTruthy();
  const orgId = (await org.json()).organization_id as string;
  for (const [place, email] of [
    ['admins', ADMIN],
    ['members', MEMBER],
    ['members', KEEPER],
  ]) {
    const added = await request.post(`${BACKEND_URL}/organizations/${orgId}/${place}`, {
      data: { user_email: email },
    });
    expect(added.ok(), await added.text()).toBeTruthy();
  }
  const marketNames: string[] = [];
  const marketIds: string[] = [];
  for (let i = 0; i < 3; i++) {
    const name = uniqueMarketName('Remove Market');
    const market = await request.post(`${BACKEND_URL}/markets`, {
      data: {
        name,
        creationDate: new Date().toISOString(),
        organizationId: orgId,
        roles: { [ownerId]: 'owner' },
        modificationList: [],
        assignmentObject: {},
      },
    });
    expect(market.ok(), await market.text()).toBeTruthy();
    marketNames.push(name);
    marketIds.push((await market.json()).market_id as string);
  }
  for (const [email, role] of [
    [KEEPER, 'editor'],
    [OUTSIDER, 'viewer'],
    [ADMIN, 'editor'],
  ]) {
    const given = await request.post(`${BACKEND_URL}/markets/${marketIds[0]}/roles`, {
      data: { user_email: email, role },
    });
    expect(given.ok(), await given.text()).toBeTruthy();
  }
  return { orgId, orgName, marketName: marketNames[0] };
}

async function openManageOrganization(page: Page, orgId: string): Promise<OrganizationsPage> {
  await page.goto(`/organizations?manage=${orgId}`);
  const orgs = new OrganizationsPage(page);
  await orgs.waitForManageOverlay();
  return orgs;
}

async function openManageMarket(page: Page, marketName: string): Promise<ManageMarketPage> {
  await page.goto(`/markets?q=${encodeURIComponent(marketName)}`);
  await page.getByTestId('market-card-manage-button').click();
  const manage = new ManageMarketPage(page);
  await manage.waitForOverlay();
  return manage;
}

const memberRow = (page: Page, email: string) =>
  page.getByTestId('manage-org-window').locator('.user-card').filter({ hasText: email });
const person = (page: Page, email: string) =>
  page.getByTestId('manage-market-person').filter({ hasText: email });

/** The quieter destructive style: red ink on the secondary button's white, never a red fill. */
async function expectQuiet(remove: Locator) {
  await expect(remove).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(remove).toHaveCSS('color', RED);
}

test.describe('Removing someone asks first', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('Manage organization names them and the markets they lose, and Cancel and Escape remove nothing', async ({
    authenticatedPage: page,
    request,
    expectAccessible,
  }) => {
    const { orgId, orgName } = await seed(request);
    const orgs = await openManageOrganization(page, orgId);

    const memberRemove = memberRow(page, MEMBER).getByTestId('manage-org-remove-member-button');
    await expectQuiet(memberRemove);
    await expectQuiet(memberRow(page, ADMIN).getByTestId('manage-org-remove-user-button'));

    await memberRemove.click();
    await expect(
      page.getByRole('dialog', { name: `Remove ${MEMBER} from ${orgName}?` }),
    ).toBeVisible();
    await expect(orgs.removeConsequence).toHaveText('They lose access to its 3 markets.');
    // The destructive dialog opens on Cancel, and its confirm is the filled destructive button.
    await expect(orgs.removeCancelButton).toBeFocused();
    await expect(orgs.removeConfirmButton).toHaveText('Remove');
    await expect(orgs.removeConfirmButton).toHaveCSS('background-color', RED);
    await expectAccessible('the confirmation of removing an organization member');

    await orgs.removeCancelButton.click();
    await expect(orgs.removeConfirm).toHaveCount(0);
    await expect(memberRemove).toBeFocused();

    await memberRemove.click();
    await expect(orgs.removeConfirm).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(orgs.removeConfirm).toHaveCount(0);
    await expect(orgs.manageWindow).toBeVisible();
    await expect(orgs.memberEmails.filter({ hasText: MEMBER })).toHaveCount(1);
    await expect(memberRemove).toBeFocused();
  });

  test('Manage organization removes on confirm, in place, and says the markets a role of their own keeps', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { orgId } = await seed(request);
    const orgs = await openManageOrganization(page, orgId);

    await memberRow(page, KEEPER).getByTestId('manage-org-remove-member-button').click();
    await expect(orgs.removeConsequence).toHaveText(
      'They lose access to 2 of its 3 markets, and keep the 1 they hold a role on of their own.',
    );
    await orgs.confirmRemove();
    await expect(orgs.removeConfirm).toHaveCount(0);
    await expect(orgs.memberEmails.filter({ hasText: KEEPER })).toHaveCount(0);
    await expect(orgs.memberEmails.filter({ hasText: MEMBER })).toHaveCount(1);
    await expect(orgs.manageWindow).toBeVisible();
    await expect(orgs.members).toBeFocused();

    // The admin is Editor on one market of their own too.
    await memberRow(page, ADMIN).getByTestId('manage-org-remove-user-button').click();
    await expect(orgs.removeConsequence).toHaveText(
      'They lose access to 2 of its 3 markets, and keep the 1 they hold a role on of their own.',
    );
    await orgs.confirmRemove();
    await expect(orgs.adminEmails).toHaveCount(0);
    await expect(orgs.admins).toBeFocused();
    await expect(orgs.manageWindow).toBeVisible();
  });

  test('Manage market names the role they lose and the place they keep', async ({
    authenticatedPage: page,
    request,
    expectAccessible,
  }) => {
    const { orgName, marketName } = await seed(request);
    const manage = await openManageMarket(page, marketName);

    const outsiderRemove = person(page, OUTSIDER).getByTestId('manage-market-remove-user-button');
    await expectQuiet(outsiderRemove);
    await outsiderRemove.click();
    await expect(
      page.getByRole('dialog', { name: `Remove ${OUTSIDER} from ${marketName}?` }),
    ).toBeVisible();
    await expect(manage.removeConsequence).toHaveText('They lose their Viewer role on it.');
    await expect(manage.removeKeeps).toHaveCount(0);
    await expect(manage.removeCancelButton).toBeFocused();
    await expectAccessible('the confirmation of removing a market role');
    await page.keyboard.press('Escape');
    await expect(manage.removeConfirm).toHaveCount(0);
    await expect(person(page, OUTSIDER)).toHaveCount(1);
    await expect(outsiderRemove).toBeFocused();

    // A member of the organization keeps what it gives them.
    const keeperRemove = person(page, KEEPER).getByTestId('manage-market-remove-user-button');
    await keeperRemove.click();
    await expect(manage.removeConsequence).toHaveText('They lose their Editor role on it.');
    await expect(manage.removeKeeps).toHaveText(
      `They can still view it as a member of ${orgName}.`,
    );
    await manage.removeCancelButton.click();
    await expect(keeperRemove).toBeFocused();

    // An organization admin's market role, which adds nothing: they still run it.
    await person(page, ADMIN).getByTestId('manage-market-remove-user-button').click();
    await expect(manage.removeConsequence).toHaveText('They lose their Editor role on it.');
    await expect(manage.removeKeeps).toHaveText(`They can still run it as an admin of ${orgName}.`);
    await manage.removeCancelButton.click();

    // Confirmed: gone from the list in place, the dialog open, focus on the list.
    await manage.removeUser(OUTSIDER);
    await expect(manage.removeConfirm).toHaveCount(0);
    await expect(person(page, OUTSIDER)).toHaveCount(0);
    await expect(manage.window).toBeVisible();
    await expect(manage.people).toBeFocused();
  });
});

test.describe('Removing someone asks first, on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  /** The locator's box is inside the 390px screen. */
  async function expectInside(locator: Locator, what: string) {
    const box = await locator.boundingBox();
    expect(box, what).not.toBeNull();
    expect(box!.x, `${what} starts inside the screen`).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width, `${what} ends inside the screen`).toBeLessThanOrEqual(390);
  }

  async function expectNoSidewaysScroll(window: Locator) {
    const sizes = await window.evaluate((el) => ({
      scroll: el.scrollWidth,
      client: el.clientWidth,
    }));
    expect(sizes.scroll, 'the dialog does not scroll sideways').toBeLessThanOrEqual(sizes.client);
  }

  test('each Remove is a 44px target, and each confirmation fits the screen', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { orgId, marketName } = await seed(request);

    const orgs = await openManageOrganization(page, orgId);
    const memberRemove = memberRow(page, KEEPER).getByTestId('manage-org-remove-member-button');
    expect((await memberRemove.boundingBox())?.height, 'a 44px target').toBeGreaterThanOrEqual(44);
    await memberRemove.click();
    await expect(orgs.removeConsequence).toBeVisible();
    await expectInside(orgs.removeConfirm, 'the confirmation');
    await expectNoSidewaysScroll(orgs.removeConfirm);
    await expectInside(orgs.removeConfirmButton, 'Remove');
    await expectInside(orgs.removeCancelButton, 'Cancel');
    await orgs.removeCancelButton.click();
    await expect(orgs.removeConfirm).toHaveCount(0);

    const manage = await openManageMarket(page, marketName);
    for (const remove of await manage.removeUserButtons.all()) {
      expect((await remove.boundingBox())?.height, 'a 44px target').toBeGreaterThanOrEqual(44);
    }
    await person(page, KEEPER).getByTestId('manage-market-remove-user-button').click();
    await expect(manage.removeKeeps).toBeVisible();
    await expectInside(manage.removeConfirm, 'the confirmation');
    await expectNoSidewaysScroll(manage.removeConfirm);
    await expectInside(manage.removeConfirmButton, 'Remove');
    await manage.removeCancelButton.click();
    await expect(manage.removeConfirm).toHaveCount(0);
  });
});

/** The organization's admin, signed in in a window of their own, as another organizer would be. */
async function anotherOrganizer(browser: Browser, viewport: { width: number; height: number }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await new LoginPage(page).login(ADMIN, PASSWORD);
  await page.waitForURL('**/dashboard');
  return { page, close: () => context.close() };
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test.describe(`Removing someone already removed in another window, at ${viewport.width}`, () => {
    test.use({ viewport });

    test('Manage organization reads it as removed: the confirmation closes and the row is gone', async ({
      authenticatedPage: page,
      request,
      browser,
    }) => {
      const { orgId } = await seed(request);
      const orgs = await openManageOrganization(page, orgId);
      await memberRow(page, MEMBER).getByTestId('manage-org-remove-member-button').click();
      await expect(orgs.removeConfirm).toBeVisible();

      const other = await anotherOrganizer(browser, viewport);
      try {
        const theirs = await openManageOrganization(other.page, orgId);
        await memberRow(other.page, MEMBER).getByTestId('manage-org-remove-member-button').click();
        await theirs.confirmRemove();
        await expect(theirs.memberEmails.filter({ hasText: MEMBER })).toHaveCount(0);
      } finally {
        await other.close();
      }

      await orgs.confirmRemove();
      await expect(orgs.removeConfirm).toHaveCount(0);
      await expect(orgs.memberEmails.filter({ hasText: MEMBER })).toHaveCount(0);
      await expect(orgs.memberEmails.filter({ hasText: KEEPER })).toHaveCount(1);
      await expect(orgs.manageWindow).toBeVisible();
      await expect(orgs.members).toBeFocused();
      await expect(orgs.manageError).toHaveCount(0);
    });

    test('Manage market reads a role taken meanwhile as taken: the confirmation closes and the row is gone', async ({
      authenticatedPage: page,
      request,
      browser,
    }) => {
      const { marketName } = await seed(request);
      const manage = await openManageMarket(page, marketName);
      await person(page, OUTSIDER).getByTestId('manage-market-remove-user-button').click();
      await expect(manage.removeConfirm).toBeVisible();

      const other = await anotherOrganizer(browser, viewport);
      try {
        const theirs = await openManageMarket(other.page, marketName);
        await theirs.removeUser(OUTSIDER);
        await expect(person(other.page, OUTSIDER)).toHaveCount(0);
      } finally {
        await other.close();
      }

      await manage.confirmRemove();
      await expect(manage.removeConfirm).toHaveCount(0);
      await expect(person(page, OUTSIDER)).toHaveCount(0);
      await expect(person(page, KEEPER)).toHaveCount(1);
      await expect(manage.window).toBeVisible();
      await expect(manage.people).toBeFocused();
      await expect(manage.error).toHaveCount(0);
    });
  });
}
