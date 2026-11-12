import type { APIRequestContext } from '@playwright/test';
import { upcomingSaturday } from './helpers/upcoming';
import {
  test,
  expect,
  TEST_USER,
  BACKEND_URL,
  NewMarketPage,
  MarketSetupPage,
  ResultPage,
} from './fixtures';
import { LayoutPage } from './pages/LayoutPage';
import { LAYOUT_FLOORPLAN_PATH, ensureTestOrg, loginViaApi } from './helpers/seeds';
import { seedApprovedVendor } from './helpers/seedApplication';

/**
 * A layout is the plan's tables (T257): the plan's acceptance criterion, walked once by one
 * organizer through the screens. They create a market, plan two halls and their sections on
 * Market Setup, and lay out each hall on its layout page with every tool a hall is laid out by:
 * the floorplan uploaded, its scale set by a line drawn across it, a straight row of tables
 * dragged, a row clicked along an L-shaped wall, an area filled, and a table moved. Section
 * Setup then reads each section's count from the layout, a reload keeps all of it, and once
 * vendors have applied and the market's assignment has run, the Assignments page names the
 * layout's tables: "Gold row 5" is the vendor's table the run seated there, the table the
 * organizer moved.
 *
 * Only the vendors are seeded, as applications already approved: what this proves is the seam
 * between the layout and the plan's readers, which the layout's own specs, each on a market
 * seeded laid out, do not cross. The review is the market journey's (`market-journey.spec.ts`).
 */
const MARKET_DATE = upcomingSaturday(0);
const UPPER = 'Upper Hall';
const LOWER = 'Lower Hall';
/** Each section's count as typed on Section Setup, before its hall is laid out. */
const TYPED = 2;
/** Six vendors, each asking for a Gold table on the market's one day: one for each Gold table.
 *  A market of several sections asks each to rank them. */
const VENDORS = Array.from({ length: 6 }, (_, i) => `layout-vendor-${i + 1}@example.com`);
/** As near as the pointer can be put to a place asked for: two pixels of the map, in millimetres. */
const NEAR_MM = 120;

interface StoredMarket {
  setupObject: {
    locations: { id: string; name: string }[];
    sections: { id: string; name: string; count: number }[];
    floorplans: {
      locationId: string | null;
      tables: { sectionId: string | null; number: number | null; xMm: number; yMm: number }[];
    }[];
  };
  assignmentObject: { vendorAssignments: { email: string; tableCode: string }[] };
}

async function storedMarket(request: APIRequestContext, marketId: string): Promise<StoredMarket> {
  const read = await request.get(`${BACKEND_URL}/markets/${marketId}`);
  expect(read.ok()).toBe(true);
  return ((await read.json()) as { market: StoredMarket }).market;
}

/** A hall's tables as the server stores them, by the hall's name. */
async function storedTables(request: APIRequestContext, marketId: string, hall: string) {
  const { setupObject } = await storedMarket(request, marketId);
  const location = setupObject.locations.find((one) => one.name === hall);
  const layout = setupObject.floorplans.find((one) => one.locationId === location?.id);
  return layout?.tables ?? [];
}

test.describe('A layout is the plan’s tables', () => {
  test.beforeAll(async ({ request }) => {
    await ensureTestOrg(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  });

  test('an organizer lays out two halls by every tool, Section Setup counts their tables, a reload keeps them, and the Assignments page seats a vendor at the table the layout calls Gold row 5', async ({
    authenticatedPage: page,
    request,
  }) => {
    test.setTimeout(240_000);
    // The spec's own reads of what the server stored, as the organizer.
    await loginViaApi(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
    const newMarket = new NewMarketPage(page);
    const setup = new MarketSetupPage(page);
    const layout = new LayoutPage(page);
    const results = new ResultPage(page);

    // --- 1. Create the market and plan two halls ------------------------------------------------
    await page.goto('/markets');
    await page.getByTestId('markets-create-button').click();
    await newMarket.waitForOverlay();
    await newMarket.selectFirstOrg();
    await newMarket.fillMarketName(`Layout Journey E2E ${Date.now()}`);
    await newMarket.choosePath('form');
    await newMarket.clickSubmit();
    const marketId = await newMarket.waitForSetupRedirect();
    await setup.waitForWizard();
    await setup.addMarketDate(MARKET_DATE);
    await setup.addTier('Gold', 0);
    await setup.addTier('Silver', 1);
    await setup.addLocation(UPPER, 0);
    await setup.addLocation(LOWER, 1);
    await setup.addSection('Gold row', UPPER, 'Gold', TYPED, 0);
    await setup.addSection('Silver aisle', UPPER, 'Silver', TYPED, 1);
    await setup.addSection('Bronze corner', LOWER, 'Silver', TYPED, 2);
    await expect(setup.getSectionCountInput(0)).toHaveValue(String(TYPED));
    await expect(page.getByTestId('setup-section-total')).toHaveText('Total tables: 6');

    // --- 2. Lay out Upper Hall: its floorplan, its scale, a row, an area and a move -------------
    const layouts = page.getByTestId('plan-layouts');
    await layouts.getByRole('button', { name: `Lay out ${UPPER}` }).click();
    await expect(layout.uploadDropzone).toBeVisible();
    await layout.uploadFileInput.setInputFiles(LAYOUT_FLOORPLAN_PATH);
    await expect(layout.calibrationMap).toBeVisible();
    // The plan's 800 px are 30 m: a line dragged edge to edge, its length typed.
    await layout.calibrate([0, 300], [800, 300], '30');
    await expect(layout.scale).toHaveText('30.0 m across');
    await expect(layout.stage).toBeVisible();

    // A straight row of six Gold tables, dragged along the top wall.
    await layout.toolRow.click();
    await expect(layout.addSection.locator('option:checked')).toHaveText('Gold row');
    await layout.saved(() =>
      layout.drag([2000, 3000], [14_000, 3000], {
        hold: async () => {
          await expect(layout.rowCount).toHaveText('6 tables');
        },
      }),
    );
    await expect(layout.announcement).toHaveText('Added Gold row 1 to 6.');

    // Four Silver tables, packed into a box by Fill an area.
    await layout.toolFill.click();
    await layout.drag([2000, 9000], [16_000, 14_000]);
    await expect(layout.fillDialog).toBeVisible();
    await layout.fillSection.selectOption({ label: 'Silver aisle' });
    await layout.fillCount.fill('4');
    await layout.saved(async () => {
      await layout.fillSubmit.click();
      await expect(layout.fillDialog).toBeHidden();
    });
    await expect(layout.status).toHaveText('Placed 4.');

    // Gold row 5 moved across the hall: it keeps its number.
    const gold = (await storedMarket(request, marketId)).setupObject.sections.find(
      (section) => section.name === 'Gold row',
    )!.id;
    const goldFive = (await storedTables(request, marketId, UPPER)).find(
      (table) => table.sectionId === gold && table.number === 5,
    )!;
    expect(goldFive).toBeTruthy();
    const movedTo: [number, number] = [22_000, 18_000];
    await layout.toolSelect.click();
    await layout.saved(() => layout.drag([goldFive.xMm, goldFive.yMm], movedTo));
    const upperTables = await storedTables(request, marketId, UPPER);
    expect(upperTables).toHaveLength(10);
    const moved = upperTables.find((table) => table.sectionId === gold && table.number === 5)!;
    expect(Math.abs(moved.xMm - movedTo[0])).toBeLessThan(NEAR_MM);
    expect(Math.abs(moved.yMm - movedTo[1])).toBeLessThan(NEAR_MM);
    await expect(layout.table('Gold row 5, Standard 6 ft')).toBeVisible();

    // --- 3. Lay out Lower Hall: a row clicked along an L-shaped wall ----------------------------
    await layout.location(LOWER).click();
    await expect(layout.uploadDropzone).toBeVisible();
    await layout.uploadFileInput.setInputFiles(LAYOUT_FLOORPLAN_PATH);
    await expect(layout.calibrationMap).toBeVisible();
    await layout.calibrate([0, 300], [800, 300], '30');
    await expect(layout.scale).toHaveText('30.0 m across');
    await layout.toolRow.click();
    await expect(layout.addSection.locator('option:checked')).toHaveText('Bronze corner');
    await layout.clickAt([3000, 3000]);
    await layout.clickAt([11_000, 3000]);
    await layout.clickAt([11_000, 11_000]);
    await expect(layout.rowLines).toHaveCount(2);
    await expect(layout.rowCount).toHaveText('7 tables');
    await layout.saved(() => page.keyboard.press('Enter'));
    await expect(layout.tables).toHaveCount(7);
    await expect(layout.table('Bronze corner 7, Standard 6 ft')).toBeVisible();

    // --- 4. Section Setup reads each laid-out section's count from its layout --------------------
    const countsFromTheLayouts = async () => {
      await expect(page.getByTestId('setup-section-count-0')).toHaveText('6');
      await expect(page.getByTestId('setup-section-count-1')).toHaveText('4');
      await expect(page.getByTestId('setup-section-count-2')).toHaveText('7');
      for (const row of [0, 1, 2]) {
        await expect(page.getByTestId(`setup-section-count-source-${row}`)).toHaveText(
          'from the layout',
        );
        await expect(setup.getSectionCountInput(row)).toHaveCount(0);
      }
      await expect(page.getByTestId('setup-section-total')).toHaveText('Total tables: 17');
      await expect(layouts).toContainText(`Open ${UPPER}'s layout · 10 tables`);
      await expect(layouts).toContainText(`Open ${LOWER}'s layout · 7 tables`);
    };
    await layout.backToSetup.click();
    await countsFromTheLayouts();
    // The server derived the same counts for every reader of the plan.
    const planned = await storedMarket(request, marketId);
    expect(planned.setupObject.sections.map((section) => section.count)).toEqual([6, 4, 7]);

    // --- 5. A reload keeps all of it -------------------------------------------------------------
    await page.reload();
    await countsFromTheLayouts();
    await layouts.getByRole('button', { name: `Open ${UPPER}'s layout · 10 tables` }).click();
    await expect(layout.scale).toHaveText('30.0 m across');
    await expect(layout.tables).toHaveCount(10);
    for (let number = 1; number <= 6; number += 1) {
      await expect(layout.table(`Gold row ${number}, Standard 6 ft`)).toBeVisible();
    }
    for (let number = 1; number <= 4; number += 1) {
      await expect(layout.table(`Silver aisle ${number}, Standard 6 ft`)).toBeVisible();
    }
    // Gold row 5 stands where it was moved to.
    const fiveBox = await layout.tableTop('Gold row 5, Standard 6 ft').boundingBox();
    const fiveAt = await layout.onScreen(movedTo);
    expect(Math.abs(fiveBox!.x + fiveBox!.width / 2 - fiveAt.x)).toBeLessThan(3);
    expect(Math.abs(fiveBox!.y + fiveBox!.height / 2 - fiveAt.y)).toBeLessThan(3);
    await layout.location(LOWER).click();
    await expect(layout.tables).toHaveCount(7);
    await layout.backToSetup.click();
    await countsFromTheLayouts();

    // --- 6. Vendors apply, and the market's assignment runs --------------------------------------
    await setup.decideOnReviewSetupAskingNothingOfTheirOwn('Add your questions');
    await setup.advancePhaseTo('applications', 'Applications');
    for (const vendor of VENDORS) {
      seedApprovedVendor(marketId, vendor, {
        dates: [MARKET_DATE],
        tiers: ['Gold'],
        sections: ['Gold row', 'Silver aisle', 'Bronze corner'],
      });
    }
    await page.reload();
    await setup.advancePhaseTo('assignment', 'Assignment');
    await setup.waitForAssignEnabled();
    await setup.clickAssign();
    await expect(setup.assignError).toBeHidden();
    await expect(page).toHaveURL(/\/assignments$/, { timeout: 15000 });
    await expect(results.occupiedSeats.first()).toBeVisible({ timeout: 10000 });

    // --- 7. The Assignments page names the layout's tables ---------------------------------------
    // Every table the layouts hold, and none the typed counts said.
    const codes = await page
      .getByTestId('tables-table-row')
      .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-table-code')));
    expect([...codes].sort()).toEqual(
      [
        ...Array.from({ length: 6 }, (_, i) => `Gold row ${i + 1}`),
        ...Array.from({ length: 4 }, (_, i) => `Silver aisle ${i + 1}`),
        ...Array.from({ length: 7 }, (_, i) => `Bronze corner ${i + 1}`),
      ].sort(),
    );
    // Each vendor holds one of the six Gold tables.
    const seated: string[] = [];
    for (const vendor of VENDORS) {
      const placements = await results.placementsFor(vendor);
      expect(placements).toHaveLength(1);
      seated.push(placements[0]);
    }
    expect([...seated].sort()).toEqual(
      Array.from({ length: 6 }, (_, i) => `Gold row ${i + 1}`).sort(),
    );
    // Gold row 5, the table the organizer moved, is the one the run seated its vendor at.
    const atFive = VENDORS[seated.indexOf('Gold row 5')];
    const stored = await storedMarket(request, marketId);
    expect(
      stored.assignmentObject.vendorAssignments.find((row) => row.email === atFive)?.tableCode,
    ).toBe('Gold row 5');
    await expect(
      page
        .locator('[data-testid="tables-table-row"][data-table-code="Gold row 5"]')
        .getByTestId('tables-seat-occupied'),
    ).toHaveAttribute('data-vendor-email', atFive);
  });
});
