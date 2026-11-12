import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { LayoutPage } from './pages/LayoutPage';
import {
  seedLayout,
  seedRow,
  storedLayoutTables,
  type SeedTable,
  type SeededLayout,
} from './helpers/seeds';

/**
 * A layout's numbers follow the rules (T257 ticket 05), on Upper Hall, 30 m by 22.5 m: each
 * section's tables are numbered 1 to N, so tables that change section are numbered after their
 * new section's own and the one they left closes its gaps; Renumber by position numbers a section
 * by where its tables stand; a section removed on Section Setup leaves its tables in no section,
 * which keeps the market a draft until they are placed or removed; and a location with a layout
 * is not removed without a question. What each did is read from the map's names, the cards and
 * the layout the server stored.
 */
const storedTables = (request: APIRequestContext, marketId: string) =>
  storedLayoutTables(request, BACKEND_URL, marketId);

/** A section's stored tables as [number, x, y], in number order. */
async function numbered(request: APIRequestContext, marketId: string, sectionId: string | null) {
  return (await storedTables(request, marketId))
    .filter((table) => table.sectionId === sectionId)
    .sort((a, b) => (a.number ?? 0) - (b.number ?? 0))
    .map((table) => [table.number, table.xMm, table.yMm]);
}

async function seeded(request: APIRequestContext, tables: SeedTable[]): Promise<SeededLayout> {
  return seedLayout(request, BACKEND_URL, TEST_USER.email, TEST_USER.password, {
    metresAcross: 30,
    tables,
  });
}

async function open(page: Page, market: SeededLayout, tables: number): Promise<LayoutPage> {
  const layout = new LayoutPage(page);
  await layout.goto(market.marketId, market.upper.id);
  await expect(layout.stage).toBeVisible();
  await expect(layout.tables).toHaveCount(tables);
  return layout;
}

/** The plan's next write, answered: Market Setup saves itself a moment after a change. */
function planSaved(page: Page, marketId: string) {
  return page.waitForResponse(
    (response) =>
      response.url().includes(`/markets/${marketId}/plan`) && response.request().method() === 'PUT',
  );
}

const SIX_FOOT = 'Standard 6 ft';
const RENUMBER = 'Renumber by position (rows across the page)';

test.describe('Numbers follow the rules', () => {
  test('three of Gold row moved to Silver aisle are numbered after its own, and Gold row closes its gaps', async ({
    authenticatedPage: page,
    request,
  }) => {
    // Gold row's 9 along the top, Silver aisle's 18 in two rows under it.
    const market = await seeded(request, [
      ...seedRow('sec-gold', [3000, 3000], 9),
      ...seedRow('sec-silver', [3000, 9000], 9),
      ...seedRow('sec-silver', [3000, 12_000], 9),
    ]);
    const layout = await open(page, market, 27);
    // Section Setup had Gold row at 13 when the layout began, and 9 are placed.
    await expect(layout.startingCounts).toHaveText('Section Setup had Gold row at 13: 9 placed.');

    // Gold row 2, 4 and 7, selected one by one.
    const goldAt = (number: number): [number, number] => [3000 + (number - 1) * 1830, 3000];
    await layout.clickAt(goldAt(2));
    await layout.shiftClickAt(goldAt(4));
    await layout.shiftClickAt(goldAt(7));
    await expect(layout.selectionTitle).toHaveText('3 tables selected');
    await expect(layout.selectionCodes).toHaveText('Gold row 2, Gold row 4, Gold row 7');
    await expect(layout.selectionSection).toHaveValue('sec-gold');

    await layout.saved(async () => {
      await layout.selectionSection.selectOption({ label: 'Silver aisle' });
      await expect(layout.selectionCodes).toHaveText(
        'Silver aisle 19, Silver aisle 20, Silver aisle 21',
      );
    });

    // They stand where they stood, numbered on from Silver aisle's 18 in the order they had.
    const silver = await numbered(request, market.marketId, 'sec-silver');
    expect(silver).toHaveLength(21);
    expect(silver.slice(18)).toEqual([
      [19, ...goldAt(2)],
      [20, ...goldAt(4)],
      [21, ...goldAt(7)],
    ]);
    // Gold row is 1 to 6 again, in the order its tables had.
    expect(await numbered(request, market.marketId, 'sec-gold')).toEqual(
      [1, 3, 5, 6, 8, 9].map((was, index) => [index + 1, ...goldAt(was)]),
    );
    await expect(layout.table(`Silver aisle 20, ${SIX_FOOT}`)).toBeVisible();
    await expect(layout.table(`Gold row 6, ${SIX_FOOT}`)).toBeVisible();
    await expect(layout.table(`Gold row 7, ${SIX_FOOT}`)).toHaveCount(0);
    await expect(layout.sectionRow('Gold row')).toContainText('6 tables');
    await expect(layout.sectionRow('Silver aisle')).toContainText('21 tables');
    await expect(layout.startingCounts).toHaveText('Section Setup had Gold row at 13: 6 placed.');

    // Section Setup reads 6 and 21.
    await layout.backToSetup.click();
    await expect(page.getByTestId('setup-section-count-0')).toHaveText('6');
    await expect(page.getByTestId('setup-section-count-1')).toHaveText('21');
  });

  test('Renumber by position numbers a section in rows from the top, each from the left', async ({
    authenticatedPage: page,
    request,
  }) => {
    // Gold row in two rows of three, numbered in no order of the floor; Silver aisle likewise.
    const market = await seeded(request, [
      { section: 'sec-gold', at: [14_000, 9000] },
      { section: 'sec-gold', at: [6000, 4000] },
      { section: 'sec-gold', at: [10_000, 9000] },
      { section: 'sec-gold', at: [14_000, 4000] },
      { section: 'sec-gold', at: [6000, 9000] },
      { section: 'sec-gold', at: [10_000, 4000] },
      { section: 'sec-silver', at: [10_000, 15_000] },
      { section: 'sec-silver', at: [6000, 15_000] },
    ]);
    const layout = await open(page, market, 8);
    const before = await numbered(request, market.marketId, 'sec-gold');

    await layout.saved(() => layout.chooseForSection('Gold row', RENUMBER));

    expect(await numbered(request, market.marketId, 'sec-gold')).toEqual([
      [1, 6000, 4000],
      [2, 10_000, 4000],
      [3, 14_000, 4000],
      [4, 6000, 9000],
      [5, 10_000, 9000],
      [6, 14_000, 9000],
    ]);
    // Silver aisle was not asked: its numbers stand, out of the floor's order as they were.
    expect(await numbered(request, market.marketId, 'sec-silver')).toEqual([
      [1, 10_000, 15_000],
      [2, 6000, 15_000],
    ]);
    // The map names each table by its new number.
    await layout.clickAt([14_000, 4000]);
    await expect(layout.selectionTitle).toHaveText('Gold row 3');

    // One step of undo, which saves.
    await layout.saved(() => layout.undo.click());
    expect(await numbered(request, market.marketId, 'sec-gold')).toEqual(before);
    await expect(layout.undo).toBeDisabled();
  });

  test('a section removed on Section Setup leaves its tables in no section, and the market a draft until they are placed', async ({
    authenticatedPage: page,
    request,
  }) => {
    const market = await seeded(request, [
      ...seedRow('sec-gold', [4000, 4000], 2),
      ...seedRow('sec-silver', [4000, 10_000], 3),
    ]);
    const sentence =
      "Upper Hall's layout has 3 tables in no section. Put them in a section or remove them.";

    // Silver aisle, the second section, is removed on Market Setup.
    await page.goto(`/markets/${encodeURIComponent(market.marketId)}/setup`);
    await expect(page.getByTestId('setup-section-count-1')).toHaveText('3');
    const saved = planSaved(page, market.marketId);
    await page.getByRole('button', { name: 'Remove section 2', exact: true }).click();
    expect((await saved).ok()).toBe(true);

    // The rail says what leaving Draft waits on, and its main button leads to the layout.
    const fix = page.getByTestId('phase-rail-fix');
    await expect(fix).toHaveText('Open the layout', { timeout: 15_000 });
    await expect(page.getByTestId('phase-rail-next')).toContainText(sentence);
    await expect(page.getByTestId('phase-transition-applications')).toBeDisabled();
    // And the server refuses the move with the same sentence and link.
    const refused = await request.post(`${BACKEND_URL}/markets/${market.marketId}/transition`, {
      data: { toPhase: 'applications' },
    });
    expect(refused.status()).toBe(409);
    const { blockers } = (await refused.json()) as {
      blockers: { id: string; message: string; resolutionLink: string }[];
    };
    expect(blockers[0]).toMatchObject({
      id: 'layout_tables_have_sections',
      message: sentence,
      resolutionLink: `layout/${market.upper.id}`,
    });

    await fix.click();
    await expect(page).toHaveURL(new RegExp(`/layout/${market.upper.id}$`));
    const layout = new LayoutPage(page);
    await expect(layout.tables).toHaveCount(5);
    // Its tables stand where they stood, grey, numberless, in no section.
    await expect(layout.table(`Table in no section, ${SIX_FOOT}`)).toHaveCount(3);
    await expect(layout.noSection).toContainText('3 tables are in no section');
    await expect(layout.sectionRow('Silver aisle')).toHaveCount(0);
    const loose = layout.table(`Table in no section, ${SIX_FOOT}`).first();
    await expect(loose.getByTestId('layout-table-top')).toHaveAttribute(
      'fill',
      'var(--layout-no-section-fill)',
    );
    await expect(loose.getByTestId('layout-table-number')).toHaveCount(0);

    // "Select them" selects the three, and the card puts them in Gold row, numbered on from 2.
    await layout.selectNoSection.click();
    await expect(layout.selectionTitle).toHaveText('3 tables selected');
    await expect(layout.selectionSection).toHaveValue('');
    await layout.saved(async () => {
      await layout.selectionSection.selectOption({ label: 'Gold row' });
      await expect(layout.selectionCodes).toHaveText('Gold row 3, Gold row 4, Gold row 5');
    });
    await expect(layout.noSection).toHaveCount(0);
    expect(await numbered(request, market.marketId, 'sec-gold')).toEqual([
      [1, 4000, 4000],
      [2, 5830, 4000],
      [3, 4000, 10_000],
      [4, 5830, 10_000],
      [5, 7660, 10_000],
    ]);
    expect(await numbered(request, market.marketId, null)).toEqual([]);

    // Nothing of the layout keeps the market a draft now.
    const read = await request.get(`${BACKEND_URL}/markets/${market.marketId}`);
    const { market: stored } = (await read.json()) as {
      market: { transitionBlockers: { applications?: { id: string }[] } };
    };
    expect(
      (stored.transitionBlockers.applications ?? []).map((blocker) => blocker.id),
    ).not.toContain('layout_tables_have_sections');
  });

  test('removing a location that has a layout asks first, and Cancel keeps both', async ({
    authenticatedPage: page,
    request,
  }) => {
    const market = await seeded(request, seedRow('sec-gold', [4000, 4000], 5));
    await page.goto(`/markets/${encodeURIComponent(market.marketId)}/setup`);
    const openLayout = page.getByTestId(`plan-layout-open-${market.upper.id}`);
    await expect(openLayout).toHaveText("Open Upper Hall's layout · 5 tables");

    const remove = page.getByRole('button', { name: 'Remove location 1', exact: true });
    await remove.click();
    const dialog = page.getByTestId('remove-location-window');
    await expect(dialog).toContainText('Remove Upper Hall?');
    await expect(page.getByTestId('remove-location-sentence')).toHaveText(
      'Its layout of 5 tables goes with it.',
    );
    // It opens on Cancel, which keeps the location and its layout.
    const cancel = page.getByTestId('remove-location-cancel-button');
    await expect(cancel).toBeFocused();
    await cancel.click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('setup-location-name-input-0')).toHaveValue('Upper Hall');
    await expect(openLayout).toBeVisible();
    expect(await storedTables(request, market.marketId)).toHaveLength(5);

    // Confirmed, the location goes, and the plan's save takes its layout with it.
    await remove.click();
    const saved = planSaved(page, market.marketId);
    await page.getByTestId('remove-location-submit-button').click();
    await expect(dialog).toHaveCount(0);
    expect((await saved).ok()).toBe(true);
    await expect(page.getByTestId('setup-location-name-input-0')).toHaveValue('Lower Hall');
    await expect(openLayout).toHaveCount(0);
    const read = await request.get(`${BACKEND_URL}/markets/${market.marketId}`);
    const { market: stored } = (await read.json()) as {
      market: { setupObject: { floorplans?: unknown[]; locations: { name: string }[] } };
    };
    expect(stored.setupObject.floorplans ?? []).toEqual([]);
    expect(stored.setupObject.locations.map((location) => location.name)).not.toContain(
      'Upper Hall',
    );
  });
});
