import type { APIRequestContext } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL, OrganizationsPage } from './fixtures';
import { loginViaApi } from './helpers/seeds';
import { ensureVerifiedUser } from './helpers/verifiedUser';
import { uniqueMarketName } from './helpers/uniqueName';
import { PHONE_AND_DESK, inTheWindow } from './helpers/phoneWindow';

/**
 * The owner makes an admin a member and back, from their row (T283).
 *
 * An admin could be made a member again only by removing them and adding them back. Manage
 * organization now gives its owner "Make member" on each admin's row and "Make admin" on each
 * member's, each asking first and saying what the person gains or loses on the organization's
 * markets. Confirmed, the person moves to the other list in place, focus goes to that list, and the
 * organization's History says who changed whom from what to what.
 */
const PASSWORD = 'e2echangeplace123';
const ADMIN = 'e2e-change-place-admin@example.com';
const MEMBER = 'e2e-change-place-member@example.com';

test.beforeAll(() => {
  for (const email of [ADMIN, MEMBER]) ensureVerifiedUser(email, PASSWORD);
});

/** A new organization of the test user's, with `ADMIN` its admin and `MEMBER` its member. */
async function seed(request: APIRequestContext): Promise<{ orgId: string; orgName: string }> {
  await loginViaApi(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  const orgName = uniqueMarketName('Change Place Org');
  const org = await request.post(`${BACKEND_URL}/organizations`, { data: { name: orgName } });
  expect(org.ok(), await org.text()).toBeTruthy();
  const orgId = (await org.json()).organization_id as string;
  for (const [place, email] of [
    ['admins', ADMIN],
    ['members', MEMBER],
  ]) {
    const added = await request.post(`${BACKEND_URL}/organizations/${orgId}/${place}`, {
      data: { user_email: email },
    });
    expect(added.ok(), await added.text()).toBeTruthy();
  }
  return { orgId, orgName };
}

for (const size of PHONE_AND_DESK) {
  test.describe(`An organization's people change place, ${size.name}`, () => {
    test.use(size.use);

    test('the owner makes an admin a member and back, each asked first, with the rows and the History', async ({
      authenticatedPage: page,
      request,
      expectAccessible,
    }) => {
      const window = inTheWindow(size);
      const me = TEST_USER.email;
      const { orgId, orgName } = await seed(request);
      await page.goto(`/organizations?manage=${orgId}`);
      const orgs = new OrganizationsPage(page);
      await orgs.waitForManageOverlay();
      await expect(orgs.adminEmails).toHaveText([ADMIN]);
      await expect(orgs.memberEmails).toHaveText([MEMBER]);

      // Each button names its person to a screen reader, as the row's Remove does.
      const rows = orgs.manageWindow;
      await expect(rows.getByRole('button', { name: `Make member ${ADMIN}` })).toBeVisible();
      await expect(rows.getByRole('button', { name: `Remove ${ADMIN}` })).toBeVisible();
      await expect(rows.getByRole('button', { name: `Make admin ${MEMBER}` })).toBeVisible();
      await expect(rows.getByRole('button', { name: `Remove ${MEMBER}` })).toBeVisible();
      // Manage organization never opens on a row's control.
      await expect(orgs.addAdminButton).toBeFocused();
      if (size.phone) {
        await window.expectInside(orgs.placeChangeButton(ADMIN, 'member'), 'Make member');
        await window.expectInside(orgs.placeChangeButton(MEMBER, 'admin'), 'Make admin');
        await window.expectFits(page, 'Manage organization');
      }
      await expectAccessible(`Manage organization with its place changes, ${size.name}`);

      // Make member: asked first, in its own words.
      await window.press(orgs.placeChangeButton(ADMIN, 'member'));
      await expect(page.getByRole('dialog', { name: `Make ${ADMIN} a member?` })).toBeVisible();
      await expect(orgs.placeChangeText).toHaveText(
        `They will read every market of ${orgName} instead of running it, unless a market gives ` +
          'them a role of its own.',
      );
      await expect(orgs.placeChangeConfirmButton).toHaveText('Make member');
      if (size.phone) await window.expectInside(orgs.placeChange, 'the confirmation');
      await expectAccessible(`the confirmation of making an admin a member, ${size.name}`);

      // Cancel changes nothing.
      await window.press(orgs.placeChangeCancelButton);
      await expect(orgs.placeChange).toHaveCount(0);
      await expect(orgs.adminEmails).toHaveText([ADMIN]);

      await window.press(orgs.placeChangeButton(ADMIN, 'member'));
      await orgs.placeChange.waitFor();
      await window.press(orgs.placeChangeConfirmButton);
      await expect(orgs.placeChange).toHaveCount(0);
      await expect(orgs.adminEmails).toHaveCount(0);
      // They keep their place in the organization's order, ahead of the member added after them.
      await expect(orgs.memberEmails).toHaveText([ADMIN, MEMBER]);
      await expect(orgs.members).toBeFocused();
      await expect(orgs.manageWindow).toBeVisible();

      await orgs.openHistory();
      await expect(orgs.historySentences.first()).toHaveText(
        `${me} changed ${ADMIN} from Admin to Member`,
      );

      // Make admin, from the row the change just moved them to.
      await window.press(orgs.placeChangeButton(ADMIN, 'admin'));
      await expect(page.getByRole('dialog', { name: `Make ${ADMIN} an admin?` })).toBeVisible();
      await expect(orgs.placeChangeText).toHaveText(
        `They will run every market of ${orgName} as its Admin.`,
      );
      await expect(orgs.placeChangeConfirmButton).toHaveText('Make admin');
      if (size.phone) await window.expectInside(orgs.placeChange, 'the confirmation');
      await window.press(orgs.placeChangeConfirmButton);
      await expect(orgs.placeChange).toHaveCount(0);
      await expect(orgs.adminEmails).toHaveText([ADMIN]);
      await expect(orgs.memberEmails).toHaveText([MEMBER]);
      await expect(orgs.admins).toBeFocused();
      await expect(orgs.historySentences.first()).toHaveText(
        `${me} changed ${ADMIN} from Member to Admin`,
      );
      await expect(orgs.historySentences).toHaveCount(4);

      // The server holds it: a fresh read lists them where the screen does.
      await page.reload();
      await orgs.waitForManageOverlay();
      await expect(orgs.adminEmails).toHaveText([ADMIN]);
      await expect(orgs.memberEmails).toHaveText([MEMBER]);
    });
  });
}
