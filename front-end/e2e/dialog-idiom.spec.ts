import { test, expect, LoginPage, NewMarketPage, TEST_USER, BACKEND_URL } from './fixtures';
import { ensureTestOrg, loginViaApi } from './helpers/seeds';
import { OrganizationsPage } from './pages/OrganizationsPage';
import { ensureVerifiedUser } from './helpers/verifiedUser';

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
    await ensureTestOrg(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
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

    // Both answered, and now Enter does exactly what the button does.
    await dialog.selectFirstOrg();
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
    await loginViaApi(page.request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
    const orgId = await ensureTestOrg(
      page.request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );
    await page.request.post(`${BACKEND_URL}/markets`, {
      headers: { 'Content-Type': 'application/json', 'X-Owner-Email': TEST_USER.email },
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
    const existing = (await (
      await api.get('/organizations', { headers: { 'X-Owner-Email': ONE_ORG_USER.email } })
    ).json()) as { organizations: unknown[] };
    if (existing.organizations.length === 0) {
      await api.post('/organizations', {
        headers: { 'Content-Type': 'application/json', 'X-Owner-Email': ONE_ORG_USER.email },
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
    await login.waitForDashboardRedirect();

    await page.goto('/markets');
    await expect(page.getByTestId('markets-create-button')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('markets-create-button').click();

    const dialog = new NewMarketPage(page);
    await dialog.waitForOverlay();

    await expect(dialog.orgOnly).toHaveText('The Only Org');
    await expect(dialog.orgSelect).toHaveCount(0);

    // And it is chosen, so the only thing left to do is name the market and press Enter.
    await dialog.fillMarketName(`One Org Market ${Date.now()}`);
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
    const card = page.getByTestId('organization-card').filter({ hasText: orgName });
    await expect(card).toBeVisible({ timeout: 10000 });

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
    await expect(page.getByTestId('organization-card').filter({ hasText: name })).toBeVisible({
      timeout: 10000,
    });
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
      headers: { 'Content-Type': 'application/json', 'X-Owner-Email': TEST_USER.email },
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

    await page.goto('/markets');
    await expect(page.locator('.markets-view')).toBeVisible({ timeout: 10000 });
    const card = page.getByTestId('market-card').filter({ hasText: mine });
    await expect(card).toBeVisible({ timeout: 10000 });
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
    const card = page.getByTestId('organization-card').filter({ hasText: name });
    await expect(card).toBeVisible({ timeout: 10000 });

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
    const card = page.getByTestId('organization-card').filter({ hasText: name });
    await expect(card).toBeVisible({ timeout: 10000 });

    await card.getByTestId('organizations-manage-button').click();
    await orgs.waitForManageOverlay();
    await orgs.clickDelete();
    await expect(orgs.deleteWindow).toBeVisible({ timeout: 5000 });

    // Cancelling puts the page back out of play behind the dialog that is still open.
    await orgs.deleteCancelButton.click();
    await expect(orgs.deleteWindow).toBeHidden({ timeout: 5000 });
    await expect(orgs.manageWindow).toBeVisible();

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
});
