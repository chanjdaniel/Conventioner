import path from 'path';
import { fileURLToPath } from 'url';
import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL, FloorplanWorkflowPage } from './fixtures';
import { seedDraftMarket } from './helpers/seedDraftMarket';
import { savePlan } from './helpers/savePlan';
import { marketScreenPath } from './helpers/marketScreens';

/**
 * The floorplan beta asks before it drops a floorplan not yet saved to the market (T271).
 *
 * The upload, the scale, the tables and the sections live in the page until the save, and a link,
 * a market tab, Back or a reload dropped all of it with no word. Once a floorplan is uploaded a
 * move off the flow now asks, and a reload is asked by the browser; before the upload there is
 * nothing to lose, and the save's own move to the plan never asks, since the floorplan is saved.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FLOORPLAN_PATH = path.resolve(__dirname, 'fixtures', 'test-floorplan.png');

const SENTENCE =
  'This floorplan is not saved to the market yet. Leaving drops the upload, the scale, the tables and the sections.';

/** A draft market with a date on its plan, so the flow is offered and its save is taken. */
async function seedFloorplanDraft(request: APIRequestContext): Promise<string> {
  const { marketId } = await seedDraftMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  await savePlan(request, BACKEND_URL, TEST_USER.email, marketId, {
    priority: [],
    marketDates: [{ date: '2099-07-15' }],
    tiers: [],
    locations: [],
    sections: [],
    assignmentOptions: { maxAssignmentsPerVendor: null, maxHalfTableProportionPerSection: null },
  });
  return marketId;
}

/** The floorplans the market holds, as the server answers it. */
async function floorplanCount(request: APIRequestContext, marketId: string): Promise<number> {
  const res = await request.get(`${BACKEND_URL}/markets/${marketId}`);
  expect(res.ok(), await res.text()).toBeTruthy();
  const body = (await res.json()) as { market: { setupObject?: { floorplans?: unknown[] } } };
  return body.market.setupObject?.floorplans?.length ?? 0;
}

const question = (page: Page) => page.getByTestId('unsaved-work-window');
const floorplanUrl = (marketId: string) =>
  new RegExp(`${marketScreenPath(marketId, 'floorplan')}$`);
const setupUrl = (marketId: string) => new RegExp(`${marketScreenPath(marketId, 'setup')}$`);

/** The flow on its first step with the upload still in hand: its preview shown, Next pressable. */
async function expectTheUploadKept(
  page: Page,
  floorplan: FloorplanWorkflowPage,
  marketId: string,
): Promise<void> {
  await expect(page).toHaveURL(floorplanUrl(marketId));
  await expect(page.getByRole('img', { name: 'Floorplan preview' })).toBeVisible();
  await expect(floorplan.nextButton).toBeEnabled();
}

test.describe('The floorplan asks before it drops a floorplan not yet saved', () => {
  test('before an upload a market tab leaves; after one it asks, Stay keeps the upload and Leave goes', async ({
    authenticatedPage: page,
    request,
    expectAccessible,
  }) => {
    const marketId = await seedFloorplanDraft(request);
    const floorplan = new FloorplanWorkflowPage(page);
    const setupTab = page.getByTestId('market-bar-tab-setup');

    // Nothing uploaded, nothing to lose.
    await floorplan.goto(marketId);
    await floorplan.waitForWizard();
    await setupTab.click();
    await expect(page).toHaveURL(setupUrl(marketId));
    await expect(question(page)).toBeHidden();

    await floorplan.goto(marketId);
    await floorplan.waitForWizard();
    await floorplan.uploadFloorplanImage(FLOORPLAN_PATH);
    await floorplan.waitForUploadComplete();

    await setupTab.click();
    await expect(question(page)).toBeVisible();
    await expect(question(page)).toHaveAccessibleName('Leave without saving?');
    await expect(page.getByTestId('unsaved-work-sentence')).toHaveText(SENTENCE);
    await expect(page.getByTestId('unsaved-work-cancel-button')).toBeFocused();
    await expectAccessible('the leave question over the floorplan');

    await page.getByTestId('unsaved-work-cancel-button').click();
    await expect(question(page)).toBeHidden();
    await expectTheUploadKept(page, floorplan, marketId);

    await setupTab.click();
    await expect(question(page)).toBeVisible();
    await page.getByTestId('unsaved-work-submit-button').click();
    await expect(page).toHaveURL(setupUrl(marketId));
    await expect(question(page)).toBeHidden();
    expect(await floorplanCount(request, marketId)).toBe(0);
  });

  test('a calibrated floorplan asks on Back and on the app bar, and Stay keeps the step', async ({
    authenticatedPage: page,
    request,
  }) => {
    const marketId = await seedFloorplanDraft(request);
    const floorplan = new FloorplanWorkflowPage(page);
    // Arrive from Market Setup, a page of its own, so that Back leaves the flow.
    await page.goto(marketScreenPath(marketId, 'setup'));
    await floorplan.selectFloorplanPath();
    await floorplan.reachTableTypes(FLOORPLAN_PATH);

    const staysOnTheStep = async (how: string, leave: () => Promise<void>) => {
      await leave();
      await expect(question(page), `${how} asks`).toBeVisible();
      await expect(page.getByTestId('unsaved-work-sentence')).toHaveText(SENTENCE);
      await page.getByTestId('unsaved-work-cancel-button').click();
      await expect(question(page)).toBeHidden();
      await expect(floorplan.tableTypeAddBtn, `Stay after ${how} keeps the step`).toBeVisible();
      await expect(page).toHaveURL(floorplanUrl(marketId));
    };
    await staysOnTheStep('Back', async () => {
      await page.goBack({ waitUntil: 'commit' });
    });
    await staysOnTheStep('the app bar', () => page.getByTestId('app-bar-logo').click());

    // The flow's own Back stays inside the page, so it never asks.
    await floorplan.clickBack();
    await expect(question(page)).toBeHidden();
    await expect(floorplan.calibrateStage).toBeVisible();

    await page.getByTestId('app-bar-logo').click();
    await page.getByTestId('unsaved-work-submit-button').click();
    await expect(page).toHaveURL(/\/markets$/);
  });

  test('a reload after an upload is asked by the browser, and one before is not', async ({
    authenticatedPage: page,
    request,
  }) => {
    const marketId = await seedFloorplanDraft(request);
    const floorplan = new FloorplanWorkflowPage(page);
    await floorplan.goto(marketId);
    await floorplan.waitForWizard();

    const asked: string[] = [];
    page.on('dialog', (dialog) => {
      asked.push(dialog.type());
      void dialog.accept();
    });
    // Pressed, so the browser would let the page ask, but nothing is uploaded.
    await page.getByRole('progressbar', { name: 'Floorplan steps' }).click();
    await page.reload();
    await floorplan.waitForWizard();
    expect(asked).toEqual([]);

    await floorplan.uploadFloorplanImage(FLOORPLAN_PATH);
    await floorplan.waitForUploadComplete();
    await page.reload();
    await floorplan.waitForWizard();
    expect(asked).toEqual(['beforeunload']);
    await expect(floorplan.nextButton).toBeDisabled();
  });

  test('the save leaves for the plan without asking', async ({
    authenticatedPage: page,
    request,
  }) => {
    const marketId = await seedFloorplanDraft(request);
    const floorplan = new FloorplanWorkflowPage(page);
    const asked: string[] = [];
    page.on('dialog', (dialog) => {
      asked.push(dialog.type());
      void dialog.accept();
    });
    await floorplan.goto(marketId);
    await floorplan.reachSaveStep(FLOORPLAN_PATH);
    await floorplan.openSaveDialog();
    await floorplan.confirmSave();
    await floorplan.waitForSaveComplete();
    await expect(page).toHaveURL(setupUrl(marketId));
    await expect(question(page)).toBeHidden();
    expect(await floorplanCount(request, marketId)).toBe(1);

    // The saved floorplan holds the page no more: a reload from the plan is not asked either.
    await page.reload();
    await expect(page.getByTestId('setup-tier-add-button')).toBeVisible();
    expect(asked).toEqual([]);
  });
});
