import { test, expect, TEST_USER, BACKEND_URL, APP_API, NewMarketPage } from './fixtures';
import { ensureTestOrg, marketNameToSlug } from './helpers/seeds';
import { seedDraftMarket } from './helpers/seedDraftMarket';
import { decideReviewSetup } from './helpers/decideReviewSetup';
import {
  seedApplicationWithStatus,
  seedPhaseMarket,
  transitionMarket,
} from './helpers/seedPhaseMarket';
import { marketSetupPath } from './helpers/marketScreens';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StartFromCsvPage } from './pages/StartFromCsvPage';
import { MarketSetupPage } from './pages/MarketSetupPage';
import { finishStartedPlan, UPCOMING_YEAR } from './helpers/finishStartedPlan';

/**
 * Where starting from a Google Form begins (E24/F04): at creation, and from a draft's Market Setup.
 */
test.describe('I already have a Google Form, at creation', () => {
  test.beforeAll(async ({ request }) => {
    await ensureTestOrg(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  });

  test('nothing is chosen until the organizer says how vendors apply', async ({
    authenticatedPage: page,
  }) => {
    // "Start from scratch" was preselected and set nothing, which put a new organizer on the CSV
    // path - the server's fail-closed default - without their choosing it (E31/F03/S01).
    const dialog = new NewMarketPage(page);
    await page.goto('/markets');
    await page.getByTestId('markets-create-button').click();
    await dialog.waitForOverlay();
    const ownPage = page.getByTestId('new-market-path-form').locator('input');
    await expect(ownPage).not.toBeChecked();
    await expect(page.getByTestId('new-market-path-csv').locator('input')).not.toBeChecked();
    await dialog.selectFirstOrg();
    await dialog.fillMarketName(`Own Page E2E ${Date.now()}`);
    await expect(dialog.submitButton).toBeDisabled();

    await dialog.choosePath('form');
    // The radio is the product's green, like the card edge around it - not the browser's blue.
    const accent = await ownPage.evaluate((input) => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--mm-green)';
      document.body.append(probe);
      const green = getComputedStyle(probe).color;
      probe.remove();
      return { radio: getComputedStyle(input).accentColor, green };
    });
    expect(accent.radio).toBe(accent.green);
    // Enter submits the dialog, as every dialog in the product does.
    await dialog.nameInput.press('Enter');
    await expect(page).toHaveURL(/\/markets\/[^/]+\/setup$/);
    const marketId = new URL(page.url()).pathname.split('/')[2];
    const market = (await (await page.request.get(`${APP_API}/markets/${marketId}`)).json()).market;
    expect(market.intakeMode).toBe('form');
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
    await page.getByTestId('new-market-path-form').locator('input').focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('new-market-path-csv').locator('input')).toBeChecked();
    await dialog.clickSubmit();

    const flow = new StartFromCsvPage(page);
    await expect(flow.upload).toBeVisible();
    const marketId = new URL(page.url()).pathname.split('/')[2];

    await flow.upload.getByRole('button', { name: 'Cancel' }).click();
    const market = (await (await page.request.get(`${APP_API}/markets/${marketId}`)).json()).market;
    expect(market.intakeMode).toBe('csv');
    expect(market.phase).toBe('draft');
    expect(market.applicationForm?.fields ?? []).toEqual([]);
    expect(market.importMapping ?? null).toBeNull();
    expect(market.setupObject ?? null).toBeNull();
  });
});

const HERE = dirname(fileURLToPath(import.meta.url));
const CORPUS = join(HERE, '..', '..', 'back-end', 'tests', 'test_data', 'google_forms');

/** What the start drafts, worded for each intake (T205/F20, the spec's table): it imports no one. */
const DRAFTS_HELP = {
  csv:
    "Drafts this market's dates, tiers and questions from your Google Form's responses. " +
    'It imports no one yet: once the market is ready, import the responses with Import responses, ' +
    "the next step at the top of the market's pages.",
  form:
    "Drafts this market's dates, tiers and questions from a past Google Form's responses. " +
    "It imports no one: vendors apply on the market's page once applications open.",
};

test.describe("Drafting from a Google Form, from a draft's Market Setup", () => {
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

  test('the button says it drafts, and its help follows the intake as it is chosen', async ({
    authenticatedPage: page,
    request,
  }) => {
    // F20: "Start from my Google Form's responses" under "Vendors apply on this market's page" read
    // as bringing the vendors in; it drafts the plan and questions and imports no one.
    const { marketId } = await seedDraftMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
      { intakeMode: 'csv' },
    );
    const setup = new MarketSetupPage(page);
    await page.goto(marketSetupPath(marketId));
    await expect(setup.startFromCsvButton).toHaveText("Draft from a Google Form's responses");
    await expect(setup.startFromCsvHelp).toHaveText(DRAFTS_HELP.csv);

    await setup.chooseIntake('form');
    await expect(setup.startFromCsvHelp).toHaveText(DRAFTS_HELP.form);
    await setup.chooseIntake('csv');
    await expect(setup.startFromCsvHelp).toHaveText(DRAFTS_HELP.csv);

    // The import is reached from the phase rail's next step; the Applications tab offers none
    // (E38/F04/S03), so no line here may send the organizer there.
    const card = page.getByTestId('plan-card-intake');
    await expect(card).not.toContainText('Applications tab');
  });

  test('a market whose vendors apply on its page is told so under the button', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { marketId } = await seedDraftMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
      { intakeMode: 'form' },
    );
    const setup = new MarketSetupPage(page);
    await page.goto(marketSetupPath(marketId));
    await expect(setup.startFromCsvHelp).toHaveText(DRAFTS_HELP.form);
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
    const setup = new MarketSetupPage(page);
    await page.goto(marketSetupPath(marketId));
    await expect(setup.startFromCsvDisabled).toBeDisabled();
    await expect(setup.startFromCsvDisabled).toHaveText("Draft from a Google Form's responses");
    await expect(setup.startFromCsvReason).toContainText('questions of its own');
    // The card reads the same either way: what the start does, then why it cannot here.
    await expect(setup.startFromCsvHelp).toHaveText(DRAFTS_HELP.csv);
    const help = await setup.startFromCsvHelp.boundingBox();
    const reason = await setup.startFromCsvReason.boundingBox();
    expect(reason!.y).toBeGreaterThan(help!.y + help!.height - 1);
    const refused = await page.request.post(`${APP_API}/markets/${marketId}/csv-proposal`, {
      data: { csvContent: 'Timestamp,Email Address\n1/1/2026 9:00:00,a@mail.test\n' },
    });
    expect(refused.status()).toBe(409);
    // And the flow's own address says the same, rather than offering a file picker.
    const flow = new StartFromCsvPage(page);
    await flow.open(marketId);
    await expect(flow.title).toHaveText('Draft this market from a Google Form');
    await expect(flow.refusedHeading).toHaveText("This market can't be drafted from a Google Form");
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
    // Its responses imported, so it may enter Review (E38/F04/S01).
    seedApplicationWithStatus(marketId, 'open', 'imported@example.com');
    await transitionMarket(request, BACKEND_URL, TEST_USER.email, marketId, 'applications');
    // Past draft the setup is settled (E31/F01/S03), so Market Setup offers no start at all and says
    // why; the flow's own address still refuses in words.
    await page.goto(marketSetupPath(marketId));
    await expect(page.getByTestId('plan-setup-settled')).toContainText('The setup is settled');
    await expect(page.getByTestId('plan-start-from-csv')).toHaveCount(0);
    const flow = new StartFromCsvPage(page);
    await flow.open(marketId);
    await expect(flow.refused).toContainText('Only a draft');
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
    await flow.chooseFile(join(CORPUS, 'days-as-one-question.csv'));
    await flow.answerYear(UPCOMING_YEAR['days-as-one-question']);
    await page.getByTestId('proposal-confirm').click();
    await expect(page).toHaveURL(marketSetupPath(marketId, 'form'));
    await finishStartedPlan(request, BACKEND_URL, TEST_USER.email, marketId);

    const market = (await (await page.request.get(`${APP_API}/markets/${marketId}`)).json()).market;
    expect(market.intakeMode).toBe('form');

    await decideReviewSetup(request, BACKEND_URL, marketId);
    await transitionMarket(request, BACKEND_URL, TEST_USER.email, marketId, 'applications');
    // The applicant's form, as the public apply page reads it: live, with the organizer's questions.
    const form = await page.request.get(
      `${APP_API}/public/markets/${marketNameToSlug(name)}/application-form`,
    );
    expect(form.ok()).toBe(true);
    const served = await form.json();
    expect(served.is_open).toBe(true);
    const labels = (served.application_form?.fields ?? []).map((f: { label: string }) => f.label);
    expect(labels).toContain('Are you an Example College student?');
  });
});
