import path from 'path';
import { fileURLToPath } from 'url';
import {
  test,
  expect,
  MarketSetupPage,
  FloorplanWorkflowPage,
  APP_API,
  TEST_USER,
} from './fixtures';
import { marketSetupPath, MARKET_SETUP_URL } from './helpers/marketScreens';
import { seedDraftMarket } from './helpers/seedDraftMarket';

/**
 * A floorplan saved to a market whose plan was never saved leaves the market readable (T272).
 *
 * An organizer who goes from the new-market dialog straight to "Set up sections from a floorplan
 * instead" saves before Market Setup has saved a plan. The save used to write a plan of only the
 * floorplan's sections, locations and floorplan, which does not parse, so from then on the market
 * answered as missing to every reader and refused every write, its own Delete included. The save
 * now goes through the plan's own writer and starts from the empty plan Market Setup starts from.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FLOORPLAN_PATH = path.resolve(__dirname, 'fixtures', 'test-floorplan.png');

interface SavedPlan {
  priority: unknown[];
  marketDates: unknown[];
  tiers: unknown[];
  locations: { name: string }[];
  sections: { name: string; location: { name: string } | null; count: number }[];
  assignmentOptions: Record<string, unknown>;
  floorplans: { id: string }[] | null;
}

test('a floorplan saved to a market with no plan leaves the market opening', async ({
  authenticatedPage: page,
}) => {
  // What an organizer has the moment the new-market dialog closes: no plan at all.
  const { marketId } = await seedDraftMarket(
    page.request,
    APP_API,
    TEST_USER.email,
    TEST_USER.password,
  );

  await page.goto(marketSetupPath(marketId, 'setup'));
  const floorplan = new FloorplanWorkflowPage(page);
  await floorplan.selectFloorplanPath();
  await floorplan.completeFloorplanWorkflow(FLOORPLAN_PATH, '6ft Table', '1800', '900', 'Main');
  await expect(page).toHaveURL(MARKET_SETUP_URL);

  // The market reads, for the server and for the screen it came back to.
  const read = await page.request.get(`${APP_API}/markets/${marketId}`);
  expect(read.status(), await read.text()).toBe(200);
  await new MarketSetupPage(page).waitForWizard();
  await expect(page.getByTestId('market-arrival-missing')).toHaveCount(0);

  // The empty plan Market Setup starts from, with the floorplan's sections, locations and floorplan.
  const plan = ((await read.json()) as { market: { setupObject: SavedPlan } }).market.setupObject;
  expect(plan.priority).toEqual([]);
  expect(plan.marketDates).toEqual([]);
  expect(plan.tiers).toEqual([]);
  expect(plan.assignmentOptions).toMatchObject({
    maxAssignmentsPerVendor: null,
    maxHalfTableProportionPerSection: null,
  });
  expect(plan.locations).toEqual([{ name: 'Main Hall' }]);
  expect(plan.sections).toHaveLength(1);
  expect(plan.sections[0]).toMatchObject({ name: 'Main', location: { name: 'Main Hall' } });
  expect(plan.sections[0].count).toBeGreaterThan(0);
  expect(plan.floorplans).toHaveLength(1);
});
