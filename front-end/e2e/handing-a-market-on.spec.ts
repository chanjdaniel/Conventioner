import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { ManageMarketPage } from './pages/ManageMarketPage';
import { loginViaApi } from './helpers/seeds';
import { seedDraftMarket } from './helpers/seedDraftMarket';
import { ensureVerifiedUser } from './helpers/verifiedUser';
import { uniqueMarketName } from './helpers/uniqueName';
import { withUser } from './helpers/withUser';
import { PHONE_AND_DESK, inTheWindow } from './helpers/phoneWindow';

/**
 * A market's Owner hands the market on (T283).
 *
 * A market has one Owner, the only person who may delete it, give and take Admin roles and change
 * who may do what, and there was no way to hand that on. Manage market now gives its Owner "Hand
 * this market on": a dialog finds someone with access by part of their address, says what they gain
 * and what the Owner keeps, and confirmed, makes them the Owner and the Owner an Admin. The section
 * goes, Users with access shows both roles, the History says it, and the new Owner, signing in,
 * finds Delete market and the section theirs.
 */
const PASSWORD = 'e2ehandon123';
const ADMIN = 'e2e-hand-on-admin@example.com';
const EDITOR = 'e2e-hand-on-editor@example.com';

test.beforeAll(() => {
  for (const email of [ADMIN, EDITOR]) ensureVerifiedUser(email, PASSWORD);
});

/**
 * A draft market of the test user's, in an organization of its own so no other spec's people stand
 * in its list, with `ADMIN` its Admin and `EDITOR` its Editor. The test user owns that organization,
 * so on the market it is an Admin through it once the market is handed on.
 */
async function seed(
  request: APIRequestContext,
): Promise<{ marketName: string; organizationName: string }> {
  await loginViaApi(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  const organizationName = uniqueMarketName('Hand On Org');
  const org = await request.post(`${BACKEND_URL}/organizations`, {
    data: { name: organizationName },
  });
  expect(org.ok(), await org.text()).toBeTruthy();
  const organizationId = (await org.json()).organization_id as string;
  const { marketId, marketName } = await seedDraftMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { name: uniqueMarketName('Spring Fair'), organizationId },
  );
  for (const [email, role] of [
    [ADMIN, 'admin'],
    [EDITOR, 'editor'],
  ]) {
    const given = await request.post(`${BACKEND_URL}/markets/${marketId}/roles`, {
      data: { user_email: email, role },
    });
    expect(given.ok(), await given.text()).toBeTruthy();
  }
  return { marketName, organizationName };
}

async function openManageMarket(page: Page, marketName: string): Promise<ManageMarketPage> {
  await page.goto(`/markets?q=${encodeURIComponent(marketName)}`);
  await page.getByTestId('market-card-manage-button').click();
  const manage = new ManageMarketPage(page);
  await manage.waitForOverlay();
  return manage;
}

for (const size of PHONE_AND_DESK) {
  test.describe(`Handing a market on, ${size.name}`, () => {
    test.use(size.use);

    test('the Owner hands it to an Admin, the section goes, and the new Owner finds it theirs', async ({
      authenticatedPage: page,
      request,
      browser,
      expectAccessible,
    }) => {
      const window = inTheWindow(size);
      const me = TEST_USER.email;
      const { marketName, organizationName } = await seed(request);
      const manage = await openManageMarket(page, marketName);

      await expect(manage.handOnLine).toHaveText(
        'Make someone with access its Owner. You stay on it as an Admin.',
      );
      await expect(manage.handOnButton).toHaveText('Hand on');
      await expect(manage.deleteButton).toBeVisible();
      await manage.handOnButton.scrollIntoViewIfNeeded();
      if (size.phone) {
        await window.expectInside(manage.handOnButton, 'Hand on');
        await window.expectFits(page, 'Manage market');
      }

      // Asked first: whom to, found by part of their address, and nothing until one is chosen.
      await window.press(manage.handOnButton);
      await expect(page.getByRole('dialog', { name: `Hand ${marketName} on` })).toBeVisible();
      await expect(manage.handOnConfirmButton).toHaveText('Hand on');
      await expect(manage.handOnConfirmButton).toBeDisabled();
      await expect(manage.handOnConsequence).toHaveCount(0);
      await manage.handOnPicker.field.fill('e2e-hand-on');
      await expect(manage.handOnPicker.options).toHaveCount(2);
      expect(await manage.handOnPicker.offered()).toEqual([ADMIN, EDITOR]);
      await manage.handOnPicker.field.fill('');
      await expect(manage.handOnPicker.option(me)).toHaveCount(0);
      await manage.handOnPicker.choose(ADMIN);
      await expect(manage.handOnConsequence).toHaveText(
        `${ADMIN} becomes its Owner: only they can delete it, give and take Admin roles and ` +
          'change who may do what. You stay on it as an Admin, and cannot take it back yourself.',
      );
      await expect(manage.handOnConfirmButton).toBeEnabled();
      if (size.phone) {
        await window.expectInside(manage.handOn, 'the hand-on dialog');
        await window.expectFits(page, 'the hand-on dialog');
      }
      await expectAccessible(`the hand-on dialog, ${size.name}`);

      await window.press(manage.handOnConfirmButton);
      await expect(manage.handOn).toHaveCount(0);
      await expect(manage.handOnSection).toHaveCount(0);
      await expect(manage.deleteButton).toHaveCount(0);
      await expect(manage.person(ADMIN).getByTestId('manage-market-role')).toHaveText('Owner');
      await expect(manage.person(me).getByTestId('manage-market-role')).toHaveText(
        `Admin, through ${organizationName}`,
      );
      await expect(manage.people).toBeFocused();
      await expect(manage.window).toBeVisible();

      await manage.openHistory();
      await expect(manage.historySentences.first()).toHaveText(
        `${me} handed the market on to ${ADMIN}, and stays on it as an Admin`,
      );

      // The server holds it: the new Owner, signing in, may delete it and hand it on.
      await withUser(
        browser,
        ADMIN,
        PASSWORD,
        async (theirs) => {
          const theirManage = await openManageMarket(theirs, marketName);
          await expect(theirManage.deleteButton).toBeVisible();
          await expect(theirManage.handOnButton).toBeVisible();
          await expect(theirManage.handOnLine).toHaveText(
            'Make someone with access its Owner. You stay on it as an Admin.',
          );
          await expect(theirManage.person(ADMIN).getByTestId('manage-market-role')).toHaveText(
            'Owner',
          );
          if (size.phone) {
            await theirManage.handOnButton.scrollIntoViewIfNeeded();
            await inTheWindow(size).expectInside(theirManage.handOnButton, 'their Hand on');
          }
        },
        size.use,
      );
    });
  });
}
