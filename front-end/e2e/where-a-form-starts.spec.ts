import { test, expect, TEST_USER, BACKEND_URL, NewMarketPage } from './fixtures';
import { ensureTestOrg, marketNameToSlug } from './helpers/seeds';
import { seedDraftMarket } from './helpers/seedDraftMarket';
import { seedPhaseMarket, transitionMarket } from './helpers/seedPhaseMarket';
import { marketSetupPath } from './helpers/marketScreens';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

const HERE = dirname(fileURLToPath(import.meta.url));
const CORPUS = join(HERE, '..', '..', 'back-end', 'tests', 'test_data', 'google_forms');

test.describe("Start from a draft's Market Setup", () => {
  test('a draft with no questions of its own opens the Upload step', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { marketId } = await seedDraftMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );
    await page.goto(marketSetupPath(marketId));
    await page.getByTestId('plan-start-from-csv-link').click();
    await expect(new StartFromCsvPage(page).upload).toBeVisible();
  });

  test('a form with a question of its own is refused, here and by the server', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { marketId } = await seedPhaseMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );
    await page.goto(marketSetupPath(marketId));
    await expect(page.getByTestId('plan-start-from-csv-disabled')).toBeDisabled();
    await expect(page.getByTestId('plan-start-from-csv-reason')).toContainText(
      'questions of its own',
    );
    const refused = await page.request.post(`${BACKEND_URL}/markets/${marketId}/csv-proposal`, {
      data: { csvContent: 'Timestamp,Email Address\n1/1/2026 9:00:00,a@mail.test\n' },
    });
    expect(refused.status()).toBe(409);
    // And the flow's own address says the same, rather than offering a file picker.
    const flow = new StartFromCsvPage(page);
    await flow.open(marketId);
    await expect(flow.refused).toContainText('questions of its own');
    await expect(flow.upload).toHaveCount(0);
  });

  test('a market out of draft is refused, and says why', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { marketId } = await seedPhaseMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );
    await transitionMarket(request, BACKEND_URL, TEST_USER.email, marketId, 'applications_open');
    await page.goto(marketSetupPath(marketId));
    await expect(page.getByTestId('plan-start-from-csv-disabled')).toBeDisabled();
    await expect(page.getByTestId('plan-start-from-csv-reason')).toContainText('Only a draft');
  });

  test('a market whose vendors apply on its page keeps doing so', async ({
    authenticatedPage: page,
    request,
  }) => {
    const name = `E2E Form Intake ${Date.now()}`;
    const { marketId } = await seedDraftMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
      { name, intakeMode: 'form' },
    );
    await page.goto(marketSetupPath(marketId));
    await page.getByTestId('plan-start-from-csv-link').click();
    const flow = new StartFromCsvPage(page);
    await flow.chooseFile(join(CORPUS, 'fall-2023.csv'));
    await flow.answerYear();
    await page.getByTestId('proposal-confirm').click();
    await expect(page).toHaveURL(marketSetupPath(marketId, 'form'));

    const market = (await (await page.request.get(`${BACKEND_URL}/markets/${marketId}`)).json())
      .market;
    expect(market.intakeMode).toBe('form');

    await transitionMarket(request, BACKEND_URL, TEST_USER.email, marketId, 'applications_open');
    // The applicant's form, as the public apply page reads it: live, with the organizer's questions.
    const form = await page.request.get(
      `${BACKEND_URL}/public/markets/${marketNameToSlug(name)}/application-form`,
    );
    expect(form.ok()).toBe(true);
    const served = await form.json();
    expect(served.is_open).toBe(true);
    const labels = (served.application_form?.fields ?? []).map((f: { label: string }) => f.label);
    expect(labels).toContain('Are you a UBC Student?');
  });
});
