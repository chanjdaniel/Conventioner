import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { LayoutPage } from './pages/LayoutPage';
import { seedLayout, storedLayoutTables, type SeedTable, type SeededLayout } from './helpers/seeds';

/**
 * A table is placed, moved, turned and removed with the pointer (T257 ticket 04), and several at
 * once selected by a box, moved, turned, duplicated, lined up and removed together (ticket 05),
 * on Upper Hall, 30 m by 22.5 m. Every gesture is the pointer's own (`page.mouse`), and what it
 * did is read from the table's name on the map, the selection's card and the layout the server
 * stored, never from the page's state.
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

const gold_1 = (request: APIRequestContext, marketId: string) => gold(request, marketId, 1);

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
    await expect(layout.selectionSection.locator('option:checked')).toHaveText('Gold row');
    await expect(layout.selectionType.locator('option:checked')).toHaveText('Standard 6 ft');
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

    // "No section" is a choice that stays chosen: two tables of none, numberless.
    await layout.addSection.selectOption({ label: 'No section' });
    await layout.saved(async () => {
      await layout.clickAt([24_000, 4000]);
      await expect(layout.addSection).toHaveValue('');
      await layout.clickAt([24_000, 8000]);
    });
    await expect(layout.table('Table in no section, Standard 6 ft')).toHaveCount(2);
    await expect(layout.selectionTitle).toHaveText('Table in no section');

    await page.reload();
    await expect(layout.tables).toHaveCount(5);
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

  test('the handle of a table in a column of turned ones stands clear of its neighbours, and turns it', async ({
    authenticatedPage: page,
    request,
  }) => {
    // Four tables turned a quarter, end to end down the west wall: above and below the third
    // stand the second and the fourth.
    const column: SeedTable[] = [0, 1, 2, 3].map((i) => ({
      section: 'sec-gold',
      at: [2000, 4000 + i * 1830],
      rotation: 90,
    }));
    const { layout, seeded } = await open(page, request, column);
    await layout.clickAt([2000, 4000 + 2 * 1830]);
    await expect(layout.table('Gold row 3, Standard 6 ft')).toHaveAttribute('aria-pressed', 'true');
    await expect(layout.turnKnob).toBeVisible();

    const knob = (await layout.turnKnob.boundingBox())!;
    for (const name of ['Gold row 2, Standard 6 ft', 'Gold row 4, Standard 6 ft']) {
      const other = (await layout.tableTop(name).boundingBox())!;
      const apart =
        knob.x + knob.width <= other.x ||
        other.x + other.width <= knob.x ||
        knob.y + knob.height <= other.y ||
        other.y + other.height <= knob.y;
      expect(apart, `the knob covers ${name}`).toBe(true);
    }

    // Dragged 40° round the table's centre, wherever it stands, it turns the table to 135°.
    const centre = await layout.onScreen([2000, 4000 + 2 * 1830]);
    const from = { x: knob.x + knob.width / 2, y: knob.y + knob.height / 2 };
    const start = Math.atan2(from.y - centre.y, from.x - centre.x);
    const reach = Math.hypot(from.x - centre.x, from.y - centre.y);
    const at = (degrees: number) => {
      const angle = start + (degrees * Math.PI) / 180;
      return { x: centre.x + reach * Math.cos(angle), y: centre.y + reach * Math.sin(angle) };
    };
    await layout.saved(async () => {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(at(20).x, at(20).y, { steps: 3 });
      await page.mouse.move(at(40).x, at(40).y, { steps: 3 });
      await page.mouse.up();
    });
    expect((await gold(request, seeded.marketId, 3)).rotation).toBe(135);
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
    // The button pressed went with the selection; the focus is on the map, not lost.
    await expect(layout.table(GOLD_1)).toBeFocused();

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

  test('a box dragged on the floor selects the tables whose centre is in it, and Shift, Ctrl+A and Escape change the selection', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { layout } = await open(page, request, [
      { section: 'sec-gold', at: [6000, 6000] },
      { section: 'sec-gold', at: [10_000, 6000] },
      { section: 'sec-gold', at: [14_000, 6000] },
      { section: 'sec-silver', at: [10_000, 12_000] },
    ]);

    // The box ends over Gold row 2, past its centre and short of its right edge: its centre is
    // in, so it is selected, and Gold row 3 and the table below are not.
    await layout.drag([4000, 4500], [10_500, 8000], {
      hold: async () => {
        await expect(layout.selectBox).toBeVisible();
        // What the box will take is selected as it is drawn.
        await expect(layout.selectionTitle).toHaveText('2 tables selected');
      },
    });
    await expect(layout.selectBox).toHaveCount(0);
    await expect(layout.selectionCodes).toHaveText('Gold row 1, Gold row 2');
    await expect(layout.table(GOLD_1)).toHaveAttribute('aria-pressed', 'true');
    await expect(layout.table(GOLD_2)).toHaveAttribute('aria-pressed', 'true');
    await expect(layout.table('Gold row 3, Standard 6 ft')).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    // Shift and a click adds a table, and takes one out.
    await layout.shiftClickAt([14_000, 6000]);
    await expect(layout.selectionTitle).toHaveText('3 tables selected');
    await layout.shiftClickAt([6000, 6000]);
    await expect(layout.selectionCodes).toHaveText('Gold row 2, Gold row 3');

    // A box drawn with Shift held adds its tables to those selected. It starts on the floor under
    // the table: a press on a section's name, which stands over it, would move the name.
    await page.keyboard.down('Shift');
    await layout.drag([7000, 13_500], [13_000, 11_500]);
    await page.keyboard.up('Shift');
    await expect(layout.selectionCodes).toHaveText('Gold row 2, Gold row 3, Silver aisle 1');

    // Escape selects nothing, Ctrl+A every table, and a press on the floor nothing again.
    await page.keyboard.press('Escape');
    await expect(layout.selection).toContainText('Select tables to change them.');
    await page.keyboard.press('Control+a');
    await expect(layout.selectionTitle).toHaveText('4 tables selected');
    await layout.clickAt([22_000, 18_000]);
    await expect(layout.selection).toContainText('Select tables to change them.');

    // A box put back with Escape leaves the selection as it was.
    await layout.clickAt([10_000, 12_000]);
    await expect(layout.selectionTitle).toHaveText('Silver aisle 1');
    await layout.drag([4000, 4500], [15_000, 8000], {
      hold: async () => {
        await expect(layout.selectionTitle).toHaveText('3 tables selected');
        await page.keyboard.press('Escape');
        await expect(layout.selectBox).toHaveCount(0);
      },
    });
    await expect(layout.selectionTitle).toHaveText('Silver aisle 1');
  });

  test('several tables are dragged, turned, duplicated and removed together, each one step of undo', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { layout, seeded } = await open(page, request, [
      { section: 'sec-gold', at: [6000, 6000] },
      { section: 'sec-gold', at: [10_000, 6000] },
      { section: 'sec-silver', at: [20_000, 15_000] },
    ]);
    const { scale } = await layout.onScreen([0, 0]);
    const pixel = 1 / scale;
    const golds = async () =>
      (await storedTables(request, seeded.marketId))
        .filter((table) => table.sectionId === 'sec-gold')
        .sort((a, b) => (a.number ?? 0) - (b.number ?? 0));

    await layout.drag([4000, 4500], [12_000, 7500]);
    await expect(layout.selectionCodes).toHaveText('Gold row 1, Gold row 2');

    // Dragged by one of them, 4 m down the hall, both go, keeping their places beside each other.
    // Alt: placed freely, so the distance is the pointer's own.
    await page.keyboard.down('Alt');
    await layout.saved(() => layout.drag([6000, 6000], [6000, 10_000]));
    await page.keyboard.up('Alt');
    let [first, second] = await golds();
    expect(Math.abs(first.yMm - 10_000)).toBeLessThan(pixel);
    expect(first.xMm).toBe(6000);
    expect(second.xMm - first.xMm).toBe(4000);
    expect(second.yMm).toBe(first.yMm);
    const moved = first.yMm;
    // The table left out of the selection stands where it stood.
    const silver = (await storedTables(request, seeded.marketId)).find(
      (table) => table.sectionId === 'sec-silver',
    )!;
    expect([silver.xMm, silver.yMm]).toEqual([20_000, 15_000]);

    // R turns the two a quarter about the middle of the selection, as one.
    await layout.saved(() => page.keyboard.press('r'));
    [first, second] = await golds();
    expect([first.rotation, second.rotation]).toEqual([90, 90]);
    expect(first.xMm).toBe(8000);
    expect(second.xMm).toBe(8000);
    expect(first.yMm).toBeCloseTo(moved - 2000, 1);
    expect(second.yMm).toBeCloseTo(moved + 2000, 1);

    // One undo takes the whole turn back, and one more the whole drag.
    await layout.saved(() => page.keyboard.press('Control+z'));
    [first, second] = await golds();
    expect([first.rotation, first.xMm, first.yMm]).toEqual([0, 6000, moved]);
    expect([second.rotation, second.xMm, second.yMm]).toEqual([0, 10_000, moved]);
    await layout.saved(() => page.keyboard.press('Control+z'));
    [first, second] = await golds();
    expect([first.yMm, second.yMm]).toEqual([6000, 6000]);
    await expect(layout.undo).toBeDisabled();

    // Duplicate puts a copy of each a table depth and 300 mm down, numbered on, and selects them.
    await layout.saved(async () => {
      await layout.selectionDuplicate.click();
      await expect(layout.tables).toHaveCount(5);
    });
    await expect(layout.selectionCodes).toHaveText('Gold row 3, Gold row 4');
    const four = await golds();
    expect(four.map((table) => [table.number, table.xMm, table.yMm])).toEqual([
      [1, 6000, 6000],
      [2, 10_000, 6000],
      [3, 6000, 7060],
      [4, 10_000, 7060],
    ]);

    // Undone from the card's button, the copies go and the card empties: the focus goes to the
    // map, not lost with the button. Redone, they are selected again by Shift and a click.
    await layout.selectionDuplicate.focus();
    await layout.saved(async () => {
      await page.keyboard.press('Control+z');
      await expect(layout.tables).toHaveCount(3);
    });
    await expect(layout.selection).toContainText('Select tables to change them.');
    await expect(layout.map.locator('[data-table-id][tabindex="0"]')).toBeFocused();
    await layout.saved(async () => {
      await page.keyboard.press('Control+y');
      await expect(layout.tables).toHaveCount(5);
    });
    await layout.clickAt([6000, 7060]);
    await layout.shiftClickAt([10_000, 7060]);
    await expect(layout.selectionCodes).toHaveText('Gold row 3, Gold row 4');

    // Remove takes both copies, and one undo brings both back.
    await layout.saved(async () => {
      await layout.selectionRemove.click();
      await expect(layout.tables).toHaveCount(3);
    });
    expect(await golds()).toHaveLength(2);
    await layout.saved(async () => {
      await layout.undo.click();
      await expect(layout.tables).toHaveCount(5);
    });
    expect(await golds()).toHaveLength(4);
    // And one more takes the duplicates away again: the whole Duplicate was one step.
    await layout.saved(async () => {
      await layout.undo.click();
      await expect(layout.tables).toHaveCount(3);
    });
    await expect(layout.undo).toBeDisabled();
  });

  test('Align and Space evenly line up a ragged selection', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { layout, seeded } = await open(page, request, [
      { section: 'sec-gold', at: [5000, 6000] },
      { section: 'sec-gold', at: [9000, 6400] },
      { section: 'sec-gold', at: [16_000, 5700] },
      { section: 'sec-silver', at: [20_000, 15_000] },
    ]);
    const golds = async () =>
      (await storedTables(request, seeded.marketId))
        .filter((table) => table.sectionId === 'sec-gold')
        .map((table) => [table.number, table.xMm, table.yMm]);

    // One table has nothing to line up with: the menu comes with a second.
    await layout.clickAt([5000, 6000]);
    await expect(layout.selectionAlign).toHaveCount(0);
    await layout.drag([2000, 3000], [19_000, 9000]);
    await expect(layout.selectionTitle).toHaveText('3 tables selected');

    await layout.saved(() => layout.align('Align top'));
    expect(await golds()).toEqual([
      [1, 5000, 5700],
      [2, 9000, 5700],
      [3, 16_000, 5700],
    ]);
    // The menu gave the focus back to its button.
    await expect(layout.selectionAlign).toBeFocused();

    await layout.saved(() => layout.align('Space evenly across'));
    expect(await golds()).toEqual([
      [1, 5000, 5700],
      [2, 10_500, 5700],
      [3, 16_000, 5700],
    ]);

    await layout.saved(() => layout.align('Align left'));
    expect((await golds()).map(([, x]) => x)).toEqual([5000, 5000, 5000]);
    // Each was one step: an undo spaces them again.
    await layout.saved(() => layout.undo.click());
    expect((await golds()).map(([, x]) => x)).toEqual([5000, 10_500, 16_000]);
    // The table left out never moved.
    const silver = (await storedTables(request, seeded.marketId)).find(
      (table) => table.sectionId === 'sec-silver',
    )!;
    expect([silver.xMm, silver.yMm]).toEqual([20_000, 15_000]);
  });

  test("a section's colour and the place its name is dragged to survive a reload", async ({
    authenticatedPage: page,
    request,
  }) => {
    const { layout, seeded } = await open(page, request, [
      { section: 'sec-gold', at: [6000, 6000] },
      { section: 'sec-gold', at: [7830, 6000] },
      { section: 'sec-silver', at: [20_000, 15_000] },
    ]);
    const styles = async () => {
      const read = await request.get(`${BACKEND_URL}/markets/${seeded.marketId}`);
      const { market } = (await read.json()) as {
        market: {
          setupObject: {
            floorplans: {
              sectionStyles: {
                sectionId: string;
                color: number;
                labelAt: { xMm: number; yMm: number } | null;
              }[];
            }[];
          };
        };
      };
      return market.setupObject.floorplans[0].sectionStyles;
    };

    // Gold row is drawn in the first colour until another is chosen from its swatch.
    await expect(layout.tableTop(GOLD_1)).toHaveAttribute('fill', 'var(--layout-section-1-fill)');
    await layout.sectionColour('Gold row').click();
    await expect(layout.paletteColour('Gold')).toHaveAttribute('aria-pressed', 'true');
    await layout.saved(() => layout.paletteColour('Violet').click());
    await expect(layout.tableTop(GOLD_1)).toHaveAttribute('fill', 'var(--layout-section-5-fill)');
    await expect(layout.sectionColour('Gold row')).toBeFocused();
    expect(await styles()).toEqual([{ sectionId: 'sec-gold', color: 5, labelAt: null }]);

    // Its name is dragged from beside its tables out onto the floor.
    const label = (await layout.sectionLabel('Gold row').boundingBox())!;
    const to = await layout.onScreen([15_000, 3000]);
    await layout.saved(async () => {
      await page.mouse.move(label.x + label.width / 2, label.y + label.height / 2);
      await page.mouse.down();
      await page.mouse.move(to.x, (label.y + to.y) / 2, { steps: 4 });
      await page.mouse.move(to.x, to.y, { steps: 4 });
      await page.mouse.up();
    });
    const pixel = 1 / to.scale;
    const [gold] = await styles();
    expect(gold.color).toBe(5);
    expect(Math.abs(gold.labelAt!.xMm - 15_000)).toBeLessThan(pixel);
    expect(Math.abs(gold.labelAt!.yMm - 3000)).toBeLessThan(pixel);
    // No table moved, and none was selected by the drag.
    expect((await gold_1(request, seeded.marketId)).xMm).toBe(6000);
    await expect(layout.selection).toContainText('Select tables to change them.');

    await page.reload();
    await expect(layout.tables).toHaveCount(3);
    await expect(layout.tableTop(GOLD_1)).toHaveAttribute('fill', 'var(--layout-section-5-fill)');
    const after = (await layout.sectionLabel('Gold row').boundingBox())!;
    const there = await layout.onScreen([gold.labelAt!.xMm, gold.labelAt!.yMm]);
    expect(after.x + after.width / 2).toBeCloseTo(there.x, 0);
    expect(after.y + after.height / 2).toBeCloseTo(there.y, 0);
  });
});
