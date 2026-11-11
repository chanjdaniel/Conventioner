import {
  test,
  expect,
  LoginPage,
  NewMarketPage,
  TEST_USER,
  BACKEND_URL,
  APP_API,
} from './fixtures';
import { ensureTestOrg, ensureTestOrgs, loginViaApi, seedLayout } from './helpers/seeds';
import { LayoutPage } from './pages/LayoutPage';
import { OrganizationsPage } from './pages/OrganizationsPage';
import { ensureVerifiedUser } from './helpers/verifiedUser';
import { MarketsPage } from './pages/MarketsPage';

/**
 * What a dialog is in this product (E20/F01/S01), proved on the create-market dialog.
 *
 * A dialog is a native `<form>` in a modal doing one small job. That single fact is the whole
 * Enter contract: submission runs the same handler as the confirm button, so it inherits that
 * handler's guard, and a disabled submit makes Enter inert with no key handler anywhere.
 *
 * Enter did nothing here before, on the first screen of the product, while six other views each
 * hand-rolled their own answer - `@keydown.enter` in three, `@keyup.enter` in two, two of those
 * with `.prevent`.
 */
test.describe('The create-market dialog is the dialog idiom', () => {
  test.beforeAll(async ({ request }) => {
    // Two, so the dialog has a choice to make: with one it picks it, and "a name but no
    // organization yet" below cannot happen.
    await ensureTestOrgs(request, BACKEND_URL, TEST_USER.email, TEST_USER.password, 2);
  });

  async function openTheDialog(page: import('@playwright/test').Page): Promise<NewMarketPage> {
    await page.goto('/markets');
    await page.getByTestId('markets-create-button').click();
    const dialog = new NewMarketPage(page);
    await dialog.waitForOverlay();
    return dialog;
  }

  test('it opens with focus inside it, on something that is not disabled', async ({
    authenticatedPage: page,
  }) => {
    // The page behind is inert, so the button that opened this is no longer a place focus can
    // sensibly sit. The first control is the organization select, which is DISABLED while it
    // fetches - and `focus()` on a disabled element is a silent no-op, which left the dialog
    // opening with focus on <body>.
    const dialog = await openTheDialog(page);
    await expect(dialog.nameInput).toBeFocused();
  });

  test('closing gives focus back to the button that opened it, whichever way it closes', async ({
    authenticatedPage: page,
  }) => {
    // Closing unmounts the window, which dropped focus to <body>: the next Tab started at the top
    // of the page (T45).
    const opener = page.getByTestId('markets-create-button');
    const dialog = await openTheDialog(page);
    await page.keyboard.press('Escape');
    await expect(dialog.nameInput).toBeHidden();
    await expect(opener).toBeFocused();

    await opener.click();
    await dialog.waitForOverlay();
    await dialog.cancelButton.click();
    await expect(opener).toBeFocused();

    await opener.click();
    await dialog.waitForOverlay();
    // A corner: the dialog is centred in the scrim, so a default click lands on the dialog.
    await dialog.overlayBackground.click({ position: { x: 8, y: 8 } });
    await expect(opener).toBeFocused();
  });

  test('Enter creates the market, through the same guard the button has', async ({
    authenticatedPage: page,
  }) => {
    const dialog = await openTheDialog(page);

    // Nothing filled in: the confirm is disabled, so Enter must do nothing at all.
    await expect(dialog.submitButton).toBeDisabled();
    await dialog.nameInput.press('Enter');
    await expect(dialog.nameInput).toBeVisible();
    await expect(page).toHaveURL(/\/markets/);

    // A name but still no organization: still disabled, so still inert.
    await dialog.fillMarketName(`Enter Submits ${Date.now()}`);
    await expect(dialog.submitButton).toBeDisabled();
    await dialog.nameInput.press('Enter');
    await expect(dialog.nameInput).toBeVisible();

    // An organization, but not yet how vendors apply (E31/F03/S01): still inert.
    await dialog.selectFirstOrg();
    await expect(dialog.submitButton).toBeDisabled();

    // Everything answered, and now Enter does exactly what the button does.
    await dialog.choosePath('form');
    await expect(dialog.submitButton).toBeEnabled();
    await dialog.nameInput.press('Enter');
    await dialog.waitForSetupRedirect();
  });

  test('the name field reads as a field, and the error sits under it', async ({
    authenticatedPage: page,
  }) => {
    const dialog = await openTheDialog(page);

    // It was `all: unset` inside a container declaring a radius with no border and no background,
    // so it rendered as bare text and read as a suggested title rather than as somewhere to type.
    const dressed = await dialog.nameInput.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        border: style.borderTopWidth,
        background: style.backgroundColor,
        height: el.getBoundingClientRect().height,
      };
    });
    expect(parseFloat(dressed.border)).toBeGreaterThan(0);
    expect(dressed.background).not.toBe('rgba(0, 0, 0, 0)');
    expect(dressed.height).toBeGreaterThan(24);

    // A name the server will refuse, so the error is a real one.
    const taken = `Duplicate Dialog ${Date.now()}`;
    // With the page's own cookies, so at the page's own address for the API (`APP_API`).
    await loginViaApi(page.request, APP_API, TEST_USER.email, TEST_USER.password);
    const orgId = await ensureTestOrg(page.request, APP_API, TEST_USER.email, TEST_USER.password);
    await page.request.post(`${APP_API}/markets`, {
      headers: { 'Content-Type': 'application/json' },
      data: {
        name: taken,
        creationDate: new Date().toISOString(),
        organizationId: orgId,
        roles: { [TEST_USER.email]: 'owner' },
        modificationList: [],
        assignmentObject: {},
      },
    });

    await dialog.fillMarketName(taken);
    await dialog.selectFirstOrg();
    await dialog.choosePath('form');
    await dialog.clickSubmit();
    await expect(dialog.errorMessage).toBeVisible();

    // In flow beneath the input, not at `top: 35px; left: 50%` measured against one arrangement.
    const placed = await page.evaluate(() => {
      const input = document.querySelector('[data-testid="new-market-name-input"]')!;
      const error = document.querySelector('[data-testid="new-market-error"]')!;
      return {
        position: getComputedStyle(error).position,
        below: error.getBoundingClientRect().top >= input.getBoundingClientRect().bottom,
      };
    });
    expect(placed.position).toBe('static');
    expect(placed.below).toBe(true);
  });
});

/**
 * With exactly one organization the select is a control offering no decision - and one that still
 * has to be operated before the dialog will submit. It says which organization instead.
 */
test.describe('The create-market dialog with exactly one organization', () => {
  const ONE_ORG_USER = { email: 'e2e-oneorg@example.com', password: 'e2eoneorg123' };

  test.beforeAll(async ({ playwright }) => {
    ensureVerifiedUser(ONE_ORG_USER.email, ONE_ORG_USER.password);

    const api = await playwright.request.newContext({
      baseURL: BACKEND_URL,
      ignoreHTTPSErrors: true,
    });
    await api.post('/login', { data: ONE_ORG_USER });
    const existing = (await (await api.get('/organizations')).json()) as {
      organizations: unknown[];
    };
    if (existing.organizations.length === 0) {
      await api.post('/organizations', {
        headers: { 'Content-Type': 'application/json' },
        data: { name: 'The Only Org' },
      });
    }
    await api.dispose();
  });

  test('it names the organization rather than asking a question with one answer', async ({
    page,
  }) => {
    const login = new LoginPage(page);
    await login.login(ONE_ORG_USER.email, ONE_ORG_USER.password);
    await login.waitForMarkets();

    await page.goto('/markets');
    await expect(page.getByTestId('markets-create-button')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('markets-create-button').click();

    const dialog = new NewMarketPage(page);
    await dialog.waitForOverlay();

    await expect(dialog.orgOnly).toHaveText('The Only Org');
    await expect(dialog.orgSelect).toHaveCount(0);

    // And it is chosen, so all that is left is to name the market, say how vendors apply, and press
    // Enter.
    await dialog.fillMarketName(`One Org Market ${Date.now()}`);
    await dialog.choosePath('form');
    await expect(dialog.submitButton).toBeEnabled();
    await dialog.nameInput.press('Enter');
    await dialog.waitForSetupRedirect();
  });
});

/**
 * Closing never means saved, and saving never closes (E20/F01/S02).
 *
 * Three actions here each succeeded and then emitted the close event, and the PARENT treated
 * close as its refresh signal - so closing was the only thing that re-read the data, and adding
 * two people meant reopening the dialog between them.
 */
test.describe('Manage organization stays open', () => {
  const SECOND = { email: 'e2e-dialog-second@example.com', password: 'e2edialog123' };
  const THIRD = { email: 'e2e-dialog-third@example.com', password: 'e2edialog123' };

  test.beforeAll(() => {
    ensureVerifiedUser(SECOND.email, SECOND.password);
    ensureVerifiedUser(THIRD.email, THIRD.password);
  });

  async function openAFreshOrg(page: import('@playwright/test').Page) {
    const orgs = new OrganizationsPage(page);
    await orgs.goto();
    await orgs.waitForLoaded();

    const orgName = `E2E DialogStays ${Date.now()}`;
    await orgs.createOrg(orgName);
    const card = await orgs.findCard(orgName);

    await card.getByTestId('organizations-manage-button').click();
    await orgs.waitForManageOverlay();
    return { orgs, orgName, card };
  }

  test('two people are added in a row, and the list behind learns about it', async ({
    authenticatedPage: page,
  }) => {
    const { orgs } = await openAFreshOrg(page);

    await orgs.addAdmin(SECOND.email);
    await expect(orgs.adminEmails.filter({ hasText: SECOND.email })).toBeVisible({
      timeout: 5000,
    });
    await expect(orgs.manageWindow).toBeVisible();

    // No reopening: the add form is still there with an empty field, ready for the next person.
    await expect(orgs.addAdminInput).toBeVisible();
    await expect(orgs.addAdminInput).toHaveValue('');

    // Enter, not the button - the row is a native form, so both go through the same handler.
    await orgs.addAdminInput.fill(THIRD.email);
    await orgs.addAdminInput.press('Enter');
    await expect(orgs.adminEmails.filter({ hasText: THIRD.email })).toBeVisible({ timeout: 5000 });
    await expect(orgs.manageWindow).toBeVisible();

    // The list behind knows, through `changed` and not through close.
    await orgs.manageCloseButton.click();
    await expect(orgs.manageWindow).toBeHidden();
  });

  test('a failing add keeps the dialog open with what was typed still in the field', async ({
    authenticatedPage: page,
  }) => {
    const { orgs } = await openAFreshOrg(page);

    const notAUser = `nobody-${Date.now()}@example.com`;
    await orgs.addAdmin(notAUser);

    await expect(page.getByTestId('manage-org-add-admin-error')).toBeVisible({ timeout: 5000 });
    await expect(orgs.manageWindow).toBeVisible();
    await expect(orgs.addAdminInput).toHaveValue(notAUser);
  });

  test('its controls are the product size, adding is one row with its own Cancel, and it opens on no Remove', async ({
    authenticatedPage: page,
  }) => {
    const { orgs, card } = await openAFreshOrg(page);
    const height = (button: import('@playwright/test').Locator) =>
      button.evaluate((el) => Math.round(el.getBoundingClientRect().height));

    // Manage market's "Add user": the product's height, secondary.
    for (const button of [orgs.addAdminButton, orgs.addMemberButton, orgs.deleteButton]) {
      expect(await height(button)).toBe(36);
    }

    await orgs.addAdmin(SECOND.email);
    await expect(orgs.adminEmails.filter({ hasText: SECOND.email })).toBeVisible();
    await expect(orgs.addAdminButton).toHaveCount(0);
    const cancel = page.getByTestId('manage-org-add-admin-cancel');
    const add = await orgs.addAdminSubmit.boundingBox();
    const cancelBox = await cancel.boundingBox();
    expect(Math.abs((add?.y ?? 0) - (cancelBox?.y ?? -100))).toBeLessThan(2);
    await cancel.click();
    await expect(orgs.addAdminInput).toHaveCount(0);
    await expect(orgs.addAdminButton).toBeVisible();

    // Opened again with an admin listed, it starts on "Add admin", never on their Remove.
    await orgs.manageCloseButton.click();
    await card.getByTestId('organizations-manage-button').click();
    await orgs.waitForManageOverlay();
    await expect(orgs.addAdminButton).toBeFocused();
  });

  test('the explicit close and the backdrop both still close it', async ({
    authenticatedPage: page,
  }) => {
    const { orgs } = await openAFreshOrg(page);

    await orgs.manageCloseButton.click();
    await expect(orgs.manageWindow).toBeHidden({ timeout: 5000 });

    await orgs.manageButtons.first().click();
    await orgs.waitForManageOverlay();
    // A corner: the dialog is centred in the scrim, so a default click lands on the dialog.
    await orgs.manageOverlayBackground.click({ position: { x: 8, y: 8 } });
    await expect(orgs.manageWindow).toBeHidden({ timeout: 5000 });
  });

  test('Escape closes it', async ({ authenticatedPage: page }) => {
    const { orgs } = await openAFreshOrg(page);

    await page.keyboard.press('Escape');
    await expect(orgs.manageWindow).toBeHidden({ timeout: 5000 });
  });
});

/**
 * Enter means one thing, everywhere (E20/F01/S03).
 *
 * Four dialogs had no Enter handling at all, and six other places each invented their own -
 * `@keydown.enter` in three views, `@keyup.enter` in two, two of those preventing the default.
 * They are all native forms now, so Enter runs the confirm's own handler and inherits its guard.
 */
test.describe('Enter means the same thing in every dialog', () => {
  test('the create-organization dialog', async ({ authenticatedPage: page }) => {
    const orgs = new OrganizationsPage(page);
    await orgs.goto();
    await orgs.waitForLoaded();

    await orgs.clickCreate();
    await expect(orgs.createNameInput).toBeVisible({ timeout: 5000 });

    // Empty: the confirm is disabled, so Enter is inert with no key handler saying so.
    await expect(orgs.createSubmitButton).toBeDisabled();
    await orgs.createNameInput.press('Enter');
    await expect(orgs.createNameInput).toBeVisible();

    const name = `E2E EnterOrg ${Date.now()}`;
    await orgs.fillOrgName(name);
    await orgs.createNameInput.press('Enter');
    await orgs.findCard(name);
  });

  test('the manage-market dialog, which had no Enter handling at all', async ({
    authenticatedPage: page,
    request,
  }) => {
    // Its OWN market. This test renames what it opens, and taking whichever card came first
    // renamed the shared seed fixture out from under `smoke.spec.ts`.
    await loginViaApi(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
    const orgId = await ensureTestOrg(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
    const mine = `E2E EnterTarget ${Date.now()}`;
    const created = await request.post(`${BACKEND_URL}/markets`, {
      headers: { 'Content-Type': 'application/json' },
      data: {
        name: mine,
        creationDate: new Date().toISOString(),
        organizationId: orgId,
        roles: { [TEST_USER.email]: 'owner' },
        modificationList: [],
        assignmentObject: {},
      },
    });
    expect(created.ok(), await created.text()).toBeTruthy();

    const markets = new MarketsPage(page);
    await markets.goto();
    await markets.narrowTo(mine);
    const card = markets.card(mine);
    await card.getByTestId('market-card-manage-button').click();

    const dialog = page.getByTestId('manage-market-window');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // One organization, fixed at creation, said as one line - no control to move it (E21/F03/S05).
    await expect(page.getByTestId('manage-market-organization')).toContainText('Belongs to');
    await expect(page.getByTestId('manage-market-add-org-button')).toHaveCount(0);

    // Renaming, by Enter in the field rather than by finding the Save button.
    const rename = page.getByTestId('manage-market-rename-input');
    const save = page.getByTestId('manage-market-rename-save-button');

    // Unchanged: nothing to save, so the confirm is disabled and Enter does nothing.
    await expect(save).toBeDisabled();
    await rename.press('Enter');
    await expect(dialog).toBeVisible();

    const renamed = `E2E EnterRename ${Date.now()}`;
    await rename.fill(renamed);
    await expect(save).toBeEnabled();
    await rename.press('Enter');

    // Saved, and the dialog is still open - saving never closes.
    await expect(save).toBeDisabled({ timeout: 5000 });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(renamed).first()).toBeVisible();
  });
});

/**
 * A dialog opened FROM a dialog is live, not inert (E20/F01/S01, found by E20/F04/S01).
 *
 * `useInertBehind` marks every sibling of the open modal's branch, and a second dialog IS a
 * sibling - so the confirmation rendered, said all the right things, and silently could not be
 * pressed. Nothing caught it: it is visible, it is enabled, and only an actual click finds out.
 */
test.describe('A dialog opened from a dialog can be used', () => {
  test('the delete confirmation is clickable while the dialog beneath it is open', async ({
    authenticatedPage: page,
  }) => {
    const orgs = new OrganizationsPage(page);
    await orgs.goto();
    await orgs.waitForLoaded();

    const name = `E2E StackedDialog ${Date.now()}`;
    await orgs.createOrg(name);
    const card = await orgs.findCard(name);

    await card.getByTestId('organizations-manage-button').click();
    await orgs.waitForManageOverlay();
    await orgs.clickDelete();
    await expect(orgs.deleteWindow).toBeVisible({ timeout: 5000 });

    // Visible and enabled is not the same as reachable, which is exactly how this got through.
    const inert = await orgs.deleteWindow.evaluate((el) => Boolean(el.closest('[inert]')));
    expect(inert, 'the confirmation is inside an inert subtree, so nothing can click it').toBe(
      false,
    );

    await expect(orgs.deleteConfirmButton).toBeEnabled({ timeout: 10000 });
    await orgs.confirmDelete();
    await expect(card).not.toBeVisible({ timeout: 10000 });
  });

  test('and the dialog beneath is inert again once the one above closes', async ({
    authenticatedPage: page,
  }) => {
    const orgs = new OrganizationsPage(page);
    await orgs.goto();
    await orgs.waitForLoaded();

    const name = `E2E StackedBack ${Date.now()}`;
    await orgs.createOrg(name);
    const card = await orgs.findCard(name);

    await card.getByTestId('organizations-manage-button').click();
    await orgs.waitForManageOverlay();
    await orgs.clickDelete();
    await expect(orgs.deleteWindow).toBeVisible({ timeout: 5000 });

    // Cancelling puts the page back out of play behind the dialog that is still open.
    await orgs.deleteCancelButton.click();
    await expect(orgs.deleteWindow).toBeHidden({ timeout: 5000 });
    await expect(orgs.manageWindow).toBeVisible();
    // And focus is back on Delete, in the dialog beneath, rather than on <body> behind both.
    await expect(orgs.deleteButton).toBeFocused();

    /*
     * Asserted on a control the page HOLDS, not on the page container: the dialogs render inside
     * `.organizations-view`, so it is an ancestor of theirs and on the live spine - it is never
     * marked, and asserting on it would pass whatever the marks said.
     */
    const stillOutOfPlay = await page
      .getByTestId('organizations-create-button')
      .evaluate((el) => el.closest('[inert]') !== null);
    expect(stillOutOfPlay, 'the page behind the manage dialog became reachable again').toBe(true);
  });

  test('Escape closes only the dialog on top, and focus goes back to its opener', async ({
    authenticatedPage: page,
  }) => {
    const orgs = new OrganizationsPage(page);
    await orgs.goto();
    await orgs.waitForLoaded();

    const name = `E2E StackedEscape ${Date.now()}`;
    await orgs.createOrg(name);
    const card = await orgs.findCard(name);

    await card.getByTestId('organizations-manage-button').click();
    await orgs.waitForManageOverlay();
    await orgs.clickDelete();
    await expect(orgs.deleteWindow).toBeVisible({ timeout: 5000 });

    // Every open dialog took Escape, so one press closed both and left focus on <body> (T114).
    await page.keyboard.press('Escape');
    await expect(orgs.deleteWindow).toBeHidden({ timeout: 5000 });
    await expect(orgs.manageWindow).toBeVisible();
    await expect(orgs.deleteButton).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(orgs.manageWindow).toBeHidden({ timeout: 5000 });
  });
});

test.describe("Fill an area's dialog is the dialog idiom", () => {
  /** Upper Hall, empty, with Fill an area on and a box dragged over the floor: the dialog open. */
  async function openTheDialog(
    page: import('@playwright/test').Page,
    request: import('@playwright/test').APIRequestContext,
  ): Promise<{ layout: LayoutPage; marketId: string }> {
    const seeded = await seedLayout(request, BACKEND_URL, TEST_USER.email, TEST_USER.password, {
      metresAcross: 30,
    });
    const layout = new LayoutPage(page);
    await layout.goto(seeded.marketId, seeded.upper.id);
    await expect(layout.stage).toBeVisible();
    await layout.toolFill.click();
    await layout.drag([2000, 3000], [14_000, 9000]);
    await expect(layout.fillDialog).toBeVisible();
    return { layout, marketId: seeded.marketId };
  }

  test('it is a narrow dialog that opens with the focus on its first field', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { layout } = await openTheDialog(page, request);

    await expect(layout.fillDialog).toHaveAccessibleName('Fill an area');
    await expect(layout.fillSection).toBeFocused();
    // 26rem, the narrow step.
    expect((await layout.fillDialog.boundingBox())!.width).toBeCloseTo(416, 0);
    // The page behind is out of play while it is open.
    expect(await layout.toolFill.evaluate((el) => el.closest('[inert]') !== null)).toBe(true);
  });

  test('Enter in a field fills, through the same guard the button has', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { layout } = await openTheDialog(page, request);

    // No whole number: the button is disabled, so Enter does nothing, with no key handler.
    await layout.fillCount.fill('a few');
    await expect(page.getByTestId('layout-fill-count-error')).toHaveText(
      'Type a whole number of tables, 1 to 500.',
    );
    await expect(layout.fillSubmit).toBeDisabled();
    await layout.fillCount.press('Enter');
    await expect(layout.fillDialog).toBeVisible();
    await expect(layout.tables).toHaveCount(0);

    await layout.fillCount.fill('4');
    await layout.saved(() => layout.fillCount.press('Enter'));
    await expect(layout.fillDialog).toBeHidden();
    await expect(layout.status).toHaveText('Placed 4.');
    await expect(layout.tables).toHaveCount(4);
  });

  test('Cancel, the close control, Escape and the backdrop each close it and fill nothing', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { layout } = await openTheDialog(page, request);
    const reopen = async () => {
      await layout.drag([2000, 3000], [14_000, 9000]);
      await expect(layout.fillDialog).toBeVisible();
    };

    await layout.fillCancel.click();
    await expect(layout.fillDialog).toBeHidden();
    await reopen();
    await page.getByTestId('layout-fill-close-button').click();
    await expect(layout.fillDialog).toBeHidden();
    await reopen();
    await page.keyboard.press('Escape');
    await expect(layout.fillDialog).toBeHidden();
    await reopen();
    // A corner: the dialog is centred in the scrim, so a default click lands on the dialog.
    await page.getByTestId('layout-fill-background').click({ position: { x: 8, y: 8 } });
    await expect(layout.fillDialog).toBeHidden();

    // A box given up is gone, and nothing was placed.
    await expect(layout.fillPreview).toHaveCount(0);
    await expect(layout.tables).toHaveCount(0);
    await expect(layout.undo).toBeDisabled();
  });

  test('opened from "Fill what is in view", closing gives the focus back to that button', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { layout } = await openTheDialog(page, request);
    await layout.fillCancel.click();

    await layout.fillView.click();
    await expect(layout.fillDialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(layout.fillDialog).toBeHidden();
    await expect(layout.fillView).toBeFocused();
  });
});

test.describe("A layout's table type dialogs are the dialog idiom", () => {
  /** Upper Hall, calibrated and empty, with its Table types card. */
  async function openTheLayout(
    page: import('@playwright/test').Page,
    request: import('@playwright/test').APIRequestContext,
  ): Promise<LayoutPage> {
    const seeded = await seedLayout(request, BACKEND_URL, TEST_USER.email, TEST_USER.password, {
      metresAcross: 30,
    });
    const layout = new LayoutPage(page);
    await layout.goto(seeded.marketId, seeded.upper.id);
    await expect(layout.typesCard).toBeVisible();
    return layout;
  }

  test('a type is added in a narrow dialog that opens on its name and holds the page behind it', async ({
    authenticatedPage: page,
    request,
  }) => {
    const layout = await openTheLayout(page, request);
    await layout.typesAdd.click();

    await expect(layout.typeDialog).toHaveAccessibleName('Add a table type');
    await expect(layout.typeName).toBeFocused();
    expect((await layout.typeDialog.boundingBox())!.width).toBeCloseTo(416, 0);
    expect(await layout.typesAdd.evaluate((el) => el.closest('[inert]') !== null)).toBe(true);
  });

  test('Enter in a field adds the type, and a type refused stays in the dialog, saying why under its field', async ({
    authenticatedPage: page,
    request,
  }) => {
    const layout = await openTheLayout(page, request);
    await layout.typesAdd.click();

    await layout.typeName.fill('Standard 6 ft');
    await layout.typeWidth.fill('100');
    await layout.typeDepth.press('Enter');
    await expect(layout.typeDialog).toBeVisible();
    await expect(page.getByTestId('layout-type-name-error')).toHaveText(
      'There is a type named Standard 6 ft already.',
    );
    await expect(page.getByTestId('layout-type-depth-error')).toHaveText(
      'Type the depth as a number of cm.',
    );
    await expect(layout.typeName).toHaveAttribute('aria-invalid', 'true');

    await layout.typeName.fill('Round 5 ft');
    await layout.typeWidth.fill('152');
    await layout.typeDepth.fill('152');
    const written = page.waitForResponse(
      (response) =>
        response.url().includes('/table-types') && response.request().method() === 'PUT',
    );
    await layout.typeDepth.press('Enter');
    expect((await written).ok()).toBe(true);
    await expect(layout.typeDialog).toBeHidden();
    await expect(layout.typeRow('Round 5 ft')).toContainText('152 x 152 cm');
  });

  test('Cancel, the close control, Escape and the backdrop each close it, add nothing, and give the focus back', async ({
    authenticatedPage: page,
    request,
  }) => {
    const layout = await openTheLayout(page, request);
    const reopen = async () => {
      await layout.typesAdd.click();
      await expect(layout.typeDialog).toBeVisible();
      await layout.typeName.fill('Not kept');
    };

    await reopen();
    await layout.typeCancel.click();
    await expect(layout.typeDialog).toBeHidden();
    await expect(layout.typesAdd).toBeFocused();
    await reopen();
    await page.getByTestId('layout-type-close-button').click();
    await expect(layout.typeDialog).toBeHidden();
    await reopen();
    await page.keyboard.press('Escape');
    await expect(layout.typeDialog).toBeHidden();
    await expect(layout.typesAdd).toBeFocused();
    await reopen();
    await page.getByTestId('layout-type-background').click({ position: { x: 8, y: 8 } });
    await expect(layout.typeDialog).toBeHidden();
    await expect(layout.typeRows).toHaveCount(1);
  });

  test('"Save these types" is a narrow dialog Enter saves from; "Use saved types" a wide one listing them', async ({
    authenticatedPage: page,
    request,
  }) => {
    const layout = await openTheLayout(page, request);
    const venue = `Dialog Hall ${Date.now()}`;

    await layout.typesSave.click();
    await expect(layout.saveTypesDialog).toHaveAccessibleName('Save these types');
    await expect(layout.saveTypesName).toBeFocused();
    expect((await layout.saveTypesDialog.boundingBox())!.width).toBeCloseTo(416, 0);
    await layout.saveTypesName.press('Enter');
    await expect(page.getByTestId('layout-save-types-name-error')).toHaveText(
      'Name the saved types, such as the venue.',
    );
    await layout.saveTypesName.fill(venue);
    await layout.saveTypesName.press('Enter');
    await expect(layout.saveTypesDialog).toBeHidden();
    await expect(layout.typesSave).toBeFocused();

    await layout.typesUseSaved.click();
    await expect(layout.savedTypesDialog).toHaveAccessibleName('Use saved types');
    // 38rem, the wide step, for a list.
    expect((await layout.savedTypesDialog.boundingBox())!.width).toBeCloseTo(608, 0);
    await expect(
      layout.savedTypesDialog.getByRole('radio', { name: new RegExp(`^${venue}`) }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(layout.savedTypesDialog).toBeHidden();
    await expect(layout.typesUseSaved).toBeFocused();
  });
});
