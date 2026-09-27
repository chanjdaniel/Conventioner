import { test, expect, TEST_USER, BACKEND_URL, NewMarketPage } from './fixtures';
import { ensureTestOrg } from './helpers/seeds';
import { StartFromCsvPage } from './pages/StartFromCsvPage';

/**
 * Where starting from a Google Form begins (E24/F04): at creation, and from a draft's Market Setup.
 */
test.describe('I already have a Google Form, at creation', () => {
  test.beforeAll(async ({ request }) => {
    await ensureTestOrg(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  });

  test('starting from scratch is still the default, and one click', async ({
    authenticatedPage: page,
  }) => {
    const dialog = new NewMarketPage(page);
    await page.goto('/markets');
    await page.getByTestId('markets-create-button').click();
    await dialog.waitForOverlay();
    await expect(page.getByTestId('new-market-start-scratch').locator('input')).toBeChecked();
    await dialog.selectFirstOrg();
    await dialog.fillMarketName(`Scratch E2E ${Date.now()}`);
    // Enter submits the dialog, as every dialog in the product does.
    await dialog.nameInput.press('Enter');
    await expect(page).toHaveURL(/\/markets\/[^/]+\/setup$/);
  });

  test('a Google Form lands on its Upload step, and leaving there leaves a CSV draft', async ({
    authenticatedPage: page,
  }) => {
    const dialog = new NewMarketPage(page);
    await page.goto('/markets');
    await page.getByTestId('markets-create-button').click();
    await dialog.waitForOverlay();
    await dialog.selectFirstOrg();
    await dialog.fillMarketName(`Google Form E2E ${Date.now()}`);
    // Reached by keyboard: the choice is a radio group.
    await page.getByTestId('new-market-start-scratch').locator('input').focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('new-market-start-google-form').locator('input')).toBeChecked();
    await dialog.clickSubmit();

    const flow = new StartFromCsvPage(page);
    await expect(flow.upload).toBeVisible();
    const marketId = new URL(page.url()).pathname.split('/')[2];

    await flow.upload.getByRole('button', { name: 'Cancel' }).click();
    const market = (await (await page.request.get(`${BACKEND_URL}/markets/${marketId}`)).json())
      .market;
    expect(market.intakeMode).toBe('csv');
    expect(market.phase).toBe('draft');
    expect(market.applicationForm?.fields ?? []).toEqual([]);
    expect(market.importMapping ?? null).toBeNull();
    expect(market.setupObject ?? null).toBeNull();
  });
});
