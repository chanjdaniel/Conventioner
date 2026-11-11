import type { Page, Route } from '@playwright/test';
import { test, expect, NewMarketPage, BACKEND_URL, APP_API, TEST_USER } from './fixtures';
import { ensureTestOrg } from './helpers/seeds';
import { MarketsPage } from './pages/MarketsPage';

/**
 * A market's name is at most 100 characters, on one line (T273).
 *
 * Both name fields stop at 100 characters as the organizer types, and the server refuses a longer
 * name or one holding a line break, which no text field can type, so a client that sends one
 * anyway is shown the server's sentence where the name was typed.
 */
const TYPED = 'N'.repeat(120);
const NOT_ONE_LINE = "A market's name must be on one line.";

/** Send the name the request carries with a line break in it, as a client other than ours might. */
async function breakTheNameOnItsWay(route: Route): Promise<void> {
  const body = route.request().postDataJSON() as { name: string };
  await route.continue({ postData: JSON.stringify({ ...body, name: `${body.name}\nFair` }) });
}

async function openTheNewMarketDialog(page: Page): Promise<NewMarketPage> {
  await page.goto('/markets');
  await page.getByTestId('markets-create-button').click();
  const dialog = new NewMarketPage(page);
  await dialog.waitForOverlay();
  return dialog;
}

test.describe("A market's name fits one line", () => {
  let orgId: string;

  test.beforeAll(async ({ request }) => {
    orgId = await ensureTestOrg(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  });

  test('the New market dialog keeps 100 characters and shows the refusal of a line break', async ({
    authenticatedPage: page,
  }) => {
    const dialog = await openTheNewMarketDialog(page);
    await dialog.nameInput.pressSequentially(TYPED);
    await expect(dialog.nameInput).toHaveValue('N'.repeat(100));

    await dialog.nameInput.fill(`Spring ${Date.now()}`);
    await dialog.selectFirstOrg();
    await dialog.choosePath('form');
    await page.route(
      (url) => url.pathname === `${APP_API}/markets`,
      (route) =>
        route.request().method() === 'POST' ? breakTheNameOnItsWay(route) : route.continue(),
    );
    await dialog.clickSubmit();

    await expect(dialog.errorMessage).toHaveText(NOT_ONE_LINE);
    await expect(dialog.nameInput, 'the dialog closed on a refusal').toBeVisible();
  });

  test('Manage market keeps 100 characters and shows the refusal of a line break', async ({
    authenticatedPage: page,
  }) => {
    const name = `Rename Line ${Date.now()}`;
    const created = await page.request.post(`${APP_API}/markets`, {
      headers: { 'Content-Type': 'application/json' },
      data: {
        name,
        creationDate: new Date().toISOString(),
        organizationId: orgId,
        modificationList: [],
        assignmentObject: {},
      },
    });
    expect(created.ok(), await created.text()).toBe(true);

    const markets = new MarketsPage(page);
    await markets.goto();
    await markets.narrowTo(name);
    await markets.card(name).getByTestId('market-card-manage-button').click();
    const input = page.getByTestId('manage-market-rename-input');
    await input.fill('');
    await input.pressSequentially(TYPED);
    await expect(input).toHaveValue('N'.repeat(100));

    await input.fill(`${name} Spring`);
    await page.route((url) => /\/markets\/[^/]+\/name$/.test(url.pathname), breakTheNameOnItsWay);
    await page.getByTestId('manage-market-rename-save-button').click();

    await expect(page.getByTestId('manage-market-rename-error')).toHaveText(NOT_ONE_LINE);
  });
});
