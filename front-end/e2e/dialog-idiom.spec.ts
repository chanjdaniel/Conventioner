import { test, expect, LoginPage, NewMarketPage, TEST_USER, BACKEND_URL } from './fixtures';
import { ensureTestOrg, loginViaApi } from './helpers/seeds';
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
