import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { LayoutPage } from './pages/LayoutPage';
import { seedLayout, storedLayoutTables, type SeedTable, type SeededLayout } from './helpers/seeds';

/**
 * A table is placed, moved, turned and removed with the pointer (T257 ticket 04), on Upper Hall,
 * 30 m by 22.5 m. Every gesture is the pointer's own (`page.mouse`), and what it did is read from
 * the table's name on the map, the selection's card and the layout the server stored, never from
 * the page's state.
 */
const SIX_FOOT = { width: 1830, depth: 760 };

/** Upper Hall's tables as the server holds them. */
const storedTables = (request: APIRequestContext, marketId: string) =>
  storedLayoutTables(request, BACKEND_URL, marketId);

/** Gold row's table of a number, as stored. */
async function gold(request: APIRequestContext, marketId: string, number: number) {
  const table = (await storedTables(request, marketId)).find(
    (one) => one.sectionId === 'sec-gold' && one.number === number,
  );
  if (!table) throw new Error(`No Gold row ${number} is stored`);
  return table;
}

async function open(
  page: Page,
  request: APIRequestContext,
  tables: SeedTable[],
): Promise<{ layout: LayoutPage; seeded: SeededLayout }> {
  const seeded = await seedLayout(request, BACKEND_URL, TEST_USER.email, TEST_USER.password, {
    metresAcross: 30,
    tables,
  });
  const layout = new LayoutPage(page);
  await layout.goto(seeded.marketId, seeded.upper.id);
  await expect(layout.stage).toBeVisible();
  await expect(layout.tables).toHaveCount(tables.length);
  return { layout, seeded };
}

const GOLD_1 = 'Gold row 1, Standard 6 ft';
const GOLD_2 = 'Gold row 2, Standard 6 ft';

test.describe('A table moves by pointer', () => {
  test('Add table places each table where it is clicked, numbered in turn, at its true size', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { layout, seeded } = await open(page, request, []);

    await layout.toolAdd.click();
    await expect(layout.toolAdd).toHaveAttribute('aria-pressed', 'true');
    await expect(layout.addSection).toHaveValue('sec-gold');
    await layout.saved(async () => {
      await layout.clickAt([6000, 6000]);
      await expect(layout.table(GOLD_1)).toBeVisible();
      // The tool stays on: the next click places the next table.
      await layout.clickAt([12_000, 9000]);
      await expect(layout.table(GOLD_2)).toBeVisible();
    });
    await expect(layout.selectionTitle).toHaveText('Gold row 2');
    await expect(layout.selectionSection).toHaveText('Gold row');
    await expect(layout.selectionType).toHaveText('Standard 6 ft');
    await expect(layout.selectionPosition).toHaveText('12.0 m, 9.0 m');

    // At its true size: a six foot table, 1,830 by 760 mm at the map's scale.
    const { scale } = await layout.onScreen([0, 0]);
    const top = (await layout.tableTop(GOLD_2).boundingBox())!;
    expect(top.width - 1.5).toBeCloseTo(SIX_FOOT.width * scale, 0);
    expect(top.height - 1.5).toBeCloseTo(SIX_FOOT.depth * scale, 0);

    // Each stands where it was clicked, to the pixel, which is about 40 mm of this hall.
    const pixel = 1 / scale;
    const first = await gold(request, seeded.marketId, 1);
    const second = await gold(request, seeded.marketId, 2);
    expect(Math.abs(first.xMm - 6000)).toBeLessThan(pixel);
    expect(Math.abs(first.yMm - 6000)).toBeLessThan(pixel);
    expect(Math.abs(second.xMm - 12_000)).toBeLessThan(pixel);
    expect(Math.abs(second.yMm - 9000)).toBeLessThan(pixel);

    // Silver aisle's first table is numbered on its own.
    await layout.addSection.selectOption({ label: 'Silver aisle' });
    await layout.saved(async () => {
      await layout.clickAt([20_000, 15_000]);
      await expect(layout.table('Silver aisle 1, Standard 6 ft')).toBeVisible();
    });

    await page.reload();
    await expect(layout.tables).toHaveCount(3);
    await expect(layout.table(GOLD_2)).toBeVisible();
    await expect(layout.table('Silver aisle 1, Standard 6 ft')).toBeVisible();
  });

  test("a dragged table snaps to another's edge with a guide, moves freely with Alt, and stays where it was dropped", async ({
    authenticatedPage: page,
    request,
  }) => {
    const { layout, seeded } = await open(page, request, [
      { section: 'sec-gold', at: [5000, 5000] },
      { section: 'sec-gold', at: [12_000, 8000] },
    ]);

    // Gold row 2 is dropped five pixels short of standing against Gold row 1's right edge.
    await layout.saved(() =>
      layout.drag([12_000, 8000], [5000 + SIX_FOOT.width, 8000], {
        nudgePx: [5, 0],
        hold: async () => {
          await expect(layout.guides).toHaveCount(1);
        },
      }),
    );
    await expect(layout.guides).toHaveCount(0);
    // Snapped: its left edge is the other's right edge, to the tenth of a millimetre.
    let moved = await gold(request, seeded.marketId, 2);
    expect(moved.xMm).toBeCloseTo(5000 + SIX_FOOT.width, 1);
    expect(moved.yMm).toBeCloseTo(8000, 1);
    await expect(layout.selectionPosition).toHaveText('6.8 m, 8.0 m');

    // With Alt held the same five pixels are kept: no guide, no snap.
    const snapped = moved;
    await page.keyboard.down('Alt');
    await layout.saved(() =>
      layout.drag([snapped.xMm, snapped.yMm], [snapped.xMm, snapped.yMm], {
        nudgePx: [5, 0],
        hold: async () => {
          await expect(layout.guides).toHaveCount(0);
        },
      }),
    );
    await page.keyboard.up('Alt');
    const { scale } = await layout.onScreen([0, 0]);
    moved = await gold(request, seeded.marketId, 2);
    // Five pixels, to within the pixel the pointer's place is rounded to.
    expect(Math.abs(moved.xMm - snapped.xMm - 5 / scale)).toBeLessThan(1 / scale);

    // Gold row 1 never moved, and a reload shows Gold row 2 where it was dropped.
    const still = await gold(request, seeded.marketId, 1);
    expect([still.xMm, still.yMm]).toEqual([5000, 5000]);
    await page.reload();
    await expect(layout.tables).toHaveCount(2);
    const at = await layout.onScreen([moved.xMm, moved.yMm]);
    const top = (await layout.tableTop(GOLD_2).boundingBox())!;
    expect(top.x + top.width / 2).toBeCloseTo(at.x, 0);
    expect(top.y + top.height / 2).toBeCloseTo(at.y, 0);
  });

  test("a table cannot be dragged past the image's edge", async ({
    authenticatedPage: page,
    request,
  }) => {
    const { layout, seeded } = await open(page, request, [
      { section: 'sec-gold', at: [27_000, 5000] },
    ]);
    // Dropped two metres past the east wall and above the north one.
    await layout.saved(() => layout.drag([27_000, 5000], [32_000, -2000]));
    const table = await gold(request, seeded.marketId, 1);
    expect([table.xMm, table.yMm]).toEqual([30_000, 0]);
  });

  test('the handle turns a table in 15° steps about its centre, and R and "Turn 90°" by a quarter', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { layout, seeded } = await open(page, request, [
      { section: 'sec-gold', at: [15_000, 11_000] },
    ]);
    await layout.clickAt([15_000, 11_000]);
    await expect(layout.table(GOLD_1)).toHaveAttribute('aria-pressed', 'true');
    await expect(layout.turnKnob).toBeVisible();

    // The knob is dragged round the table's centre by 40°, which holds at 45°.
    const centre = await layout.onScreen([15_000, 11_000]);
    const knob = (await layout.turnKnob.boundingBox())!;
    const from = { x: knob.x + knob.width / 2, y: knob.y + knob.height / 2 };
    const reach = Math.hypot(from.x - centre.x, from.y - centre.y);
    const turn = (40 * Math.PI) / 180;
    await layout.saved(async () => {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(
        centre.x + reach * Math.sin(turn / 2),
        centre.y - reach * Math.cos(turn / 2),
        { steps: 3 },
      );
      await page.mouse.move(centre.x + reach * Math.sin(turn), centre.y - reach * Math.cos(turn), {
        steps: 3,
      });
      await page.mouse.up();
    });
    let table = await gold(request, seeded.marketId, 1);
    expect(table.rotation).toBe(45);
    // About its centre: it stands where it stood.
    expect([table.xMm, table.yMm]).toEqual([15_000, 11_000]);
    // Its number turns with it: the table is drawn turned, the number inside it.
    await expect(layout.table(GOLD_1)).toHaveAttribute('transform', /rotate\(45\)/);
    await expect(layout.tableNumber(GOLD_1)).toHaveText('1');

    await layout.saved(() => page.keyboard.press('r'));
    table = await gold(request, seeded.marketId, 1);
    expect(table.rotation).toBe(135);

    await layout.saved(() => layout.selectionTurn.click());
    table = await gold(request, seeded.marketId, 1);
    expect(table.rotation).toBe(225);
    expect([table.xMm, table.yMm]).toEqual([15_000, 11_000]);
    await expect(layout.table(GOLD_1)).toHaveAttribute('transform', /rotate\(225\)/);
  });

  test('removing Gold row 2 of 4 makes 3 and 4 into 2 and 3, and Section Setup reads 3', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { layout, seeded } = await open(page, request, [
      { section: 'sec-gold', at: [4000, 4000] },
      { section: 'sec-gold', at: [8000, 4000] },
      { section: 'sec-gold', at: [12_000, 4000] },
      { section: 'sec-gold', at: [16_000, 4000] },
    ]);
    await layout.clickAt([8000, 4000]);
    await expect(layout.selectionTitle).toHaveText('Gold row 2');
    await layout.saved(async () => {
      await layout.selectionRemove.click();
      await expect(layout.tables).toHaveCount(3);
    });
    await expect(layout.selection).toContainText('Select tables to change them.');

    // The table that was Gold row 3, at 12 m, is Gold row 2 now, and the last is Gold row 3.
    const tables = await storedTables(request, seeded.marketId);
    expect(tables.map((one) => [one.number, one.xMm])).toEqual([
      [1, 4000],
      [2, 12_000],
      [3, 16_000],
    ]);
    await layout.clickAt([12_000, 4000]);
    await expect(layout.selectionTitle).toHaveText('Gold row 2');
    await expect(layout.sections).toContainText('3 tables');

    await layout.backToSetup.click();
    await expect(page.getByTestId('setup-section-count-0')).toHaveText('3');
    await expect(page.getByTestId('setup-section-count-source-0')).toHaveText('from the layout');
    await expect(page.getByTestId('setup-section-count-input-0')).toHaveCount(0);
    await expect(page.getByTestId(`plan-layout-open-${seeded.upper.id}`)).toHaveText(
      "Open Upper Hall's layout · 3 tables",
    );
    // Lower Hall has no layout: its section's count is still typed.
    await expect(page.getByTestId('setup-section-count-input-2')).toHaveValue('4');
    await expect(page.getByTestId('setup-section-total')).toHaveText('Total tables: 7');
  });

  test('the keys and the buttons undo and redo every change, and each undo saves', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { layout, seeded } = await open(page, request, [
      { section: 'sec-gold', at: [6000, 6000] },
    ]);
    await expect(layout.undo).toBeDisabled();
    await expect(layout.redo).toBeDisabled();

    // Three changes: a table added, the first moved, then turned.
    await layout.toolAdd.click();
    await layout.saved(() => layout.clickAt([20_000, 15_000]));
    await layout.toolSelect.click();
    await layout.saved(() => layout.drag([6000, 6000], [6000, 12_000]));
    await layout.saved(() => page.keyboard.press('r'));
    const turned = await gold(request, seeded.marketId, 1);
    expect(turned.rotation).toBe(90);
    const dropped = [turned.xMm, turned.yMm];

    // Ctrl+Z takes back the turn, and saves.
    await layout.saved(() => page.keyboard.press('Control+z'));
    expect((await gold(request, seeded.marketId, 1)).rotation).toBe(0);
    // The button takes back the move.
    await layout.saved(() => layout.undo.click());
    let first = await gold(request, seeded.marketId, 1);
    expect([first.xMm, first.yMm]).toEqual([6000, 6000]);
    // And the added table.
    await layout.saved(async () => {
      await page.keyboard.press('Control+z');
      await expect(layout.tables).toHaveCount(1);
    });
    expect(await storedTables(request, seeded.marketId)).toHaveLength(1);
    await expect(layout.undo).toBeDisabled();

    // Ctrl+Shift+Z, Ctrl+Y and the button bring each back, across those saves.
    await layout.saved(async () => {
      await page.keyboard.press('Control+Shift+z');
      await expect(layout.tables).toHaveCount(2);
    });
    await layout.saved(() => page.keyboard.press('Control+y'));
    first = await gold(request, seeded.marketId, 1);
    expect([first.xMm, first.yMm]).toEqual(dropped);
    await layout.saved(() => layout.redo.click());
    expect((await gold(request, seeded.marketId, 1)).rotation).toBe(90);
    await expect(layout.redo).toBeDisabled();
    expect(await storedTables(request, seeded.marketId)).toHaveLength(2);
  });
});
