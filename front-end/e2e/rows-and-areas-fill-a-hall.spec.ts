import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { LayoutPage } from './pages/LayoutPage';
import {
  seedLayout,
  storedLayoutTables,
  type SeedTable,
  type SeedZone,
  type SeededLayout,
  type StoredLayoutTable,
} from './helpers/seeds';
import { apart as separation, cornersOf as tableCorners } from './helpers/tableShapes';

/**
 * Rows of tables fill a hall (T257 ticket 07), on Upper Hall, 30 m by 22.5 m, with six-foot
 * tables, 1830 by 760 mm: a drag places a straight row, clicks along a wall place a row that
 * follows it, round a curve or a corner, on the side chosen, clear of what stands there; and the
 * crosshair lays the same row by keys alone. Every gesture is the pointer's or the keys' own, and
 * what it placed is read from the layout the server stored, the tables' names on the map and the
 * live region, never from the page's state.
 *
 * The map is drawn at about 50 mm to the pixel here, so a place asked for in millimetres is
 * pressed within a few centimetres of it.
 */
const SIX_FOOT = { widthMm: 1830, depthMm: 760 };
/** As near as the pointer can be put to a place asked for: two pixels of the map, in millimetres. */
const A_PIXEL_MM = 60;

async function open(
  page: Page,
  request: APIRequestContext,
  tables: SeedTable[] = [],
  zones: SeedZone[] = [],
): Promise<{ layout: LayoutPage; seeded: SeededLayout }> {
  const seeded = await seedLayout(request, BACKEND_URL, TEST_USER.email, TEST_USER.password, {
    metresAcross: 30,
    tables,
    zones,
  });
  const layout = new LayoutPage(page);
  await layout.goto(seeded.marketId, seeded.upper.id);
  await expect(layout.stage).toBeVisible();
  await expect(layout.tables).toHaveCount(tables.length);
  await layout.toolRow.click();
  await expect(layout.rowGap).toBeVisible();
  return { layout, seeded };
}

/** Upper Hall's tables as the server holds them, in the order of their numbers. */
async function stored(request: APIRequestContext, marketId: string) {
  const tables = await storedLayoutTables(request, BACKEND_URL, marketId);
  return [...tables].sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
}

/** The least distance between any two of the tables: less than nothing where two overlap. */
function leastSeparation(tables: StoredLayoutTable[]): number {
  let least = Infinity;
  for (let i = 0; i < tables.length; i += 1) {
    for (let j = i + 1; j < tables.length; j += 1) {
      least = Math.min(
        least,
        separation(tableCorners(tables[i], SIX_FOOT), tableCorners(tables[j], SIX_FOOT)),
      );
    }
  }
  return least;
}

/** How far each table's centre is from the one before it. */
const steps = (tables: StoredLayoutTable[]) =>
  tables
    .slice(1)
    .map((table, i) => Math.hypot(table.xMm - tables[i].xMm, table.yMm - tables[i].yMm));

test.describe('Rows fill a hall', () => {
  test('a straight drag of 20 m places ten tables touching, and nine with a gap of 30 cm, the count following the drag', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { layout, seeded } = await open(page, request);
    await expect(layout.hint).toContainText('Click along a wall. A sharp turn makes a corner.');

    await layout.saved(() =>
      layout.drag([2000, 3000], [22_000, 3000], {
        hold: async () => {
          // The row as it will be placed, and its count at the pointer, while the button is down.
          await expect(layout.rowCount).toHaveText('10 tables');
          await expect(layout.rowTables).toHaveCount(10);
        },
      }),
    );
    await expect(layout.rowPreview).toHaveCount(0);
    await expect(layout.tables).toHaveCount(10);
    await expect(layout.announcement).toHaveText('Added Gold row 1 to 10.');

    let tables = await stored(request, seeded.marketId);
    expect(tables).toHaveLength(10);
    // Beside the line, on the right of the way it was drawn: under it, on the page.
    expect(Math.abs(tables[0].xMm - 2915)).toBeLessThan(2 * A_PIXEL_MM);
    expect(Math.abs(tables[0].yMm - 3380)).toBeLessThan(2 * A_PIXEL_MM);
    for (const step of steps(tables)) expect(step).toBeCloseTo(1830, 1);
    expect(leastSeparation(tables)).toBeGreaterThanOrEqual(-0.05);
    expect(new Set(tables.map((table) => table.rotation))).toEqual(new Set([0]));

    // The same drag with a gap: nine, each 300 mm from the next.
    await layout.rowGap.fill('30');
    await layout.saved(() =>
      layout.drag([2000, 8000], [22_000, 8000], {
        hold: async () => {
          await expect(layout.rowCount).toHaveText('9 tables');
        },
      }),
    );
    await expect(layout.announcement).toHaveText('Added Gold row 11 to 19.');
    tables = (await stored(request, seeded.marketId)).slice(10);
    expect(tables).toHaveLength(9);
    for (const step of steps(tables)) expect(step).toBeCloseTo(2130, 1);
    for (let i = 1; i < tables.length; i += 1) {
      const apart = separation(
        tableCorners(tables[i - 1], SIX_FOOT),
        tableCorners(tables[i], SIX_FOOT),
      );
      expect(apart).toBeGreaterThanOrEqual(299.95);
      expect(apart).toBeLessThanOrEqual(300.05);
    }
  });

  test('three clicks along a curved wall and a double-click place the count the pointer showed, every table inside the wall and none overlapping, numbered the way it was drawn', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { layout, seeded } = await open(page, request);
    // A circular wall of 5 m radius about (9, 8) m, clicked clockwise on the page from its east.
    const centre = [9000, 8000] as const;
    const onWall = (degrees: number): [number, number] => {
      const turn = (degrees * Math.PI) / 180;
      return [centre[0] + 5000 * Math.cos(turn), centre[1] + 5000 * Math.sin(turn)];
    };

    await layout.clickAt(onWall(0));
    await expect(layout.rowPoints).toHaveCount(1);
    await layout.hoverAt(onWall(45));
    // The row follows the pointer before the point is laid.
    await expect(layout.rowCount).toHaveText(/^\d+ tables?$/);
    await layout.clickAt(onWall(45));
    await layout.hoverAt(onWall(90));
    await expect(layout.rowLines).toHaveCount(1);
    const shown = Number((await layout.rowCount.textContent())!.trim().split(' ')[0]);
    expect(shown).toBeGreaterThanOrEqual(3);
    await expect(layout.rowTables).toHaveCount(shown);

    // Nothing of the path is the layout's until it is placed.
    await expect(layout.tables).toHaveCount(0);
    await expect(layout.undo).toBeDisabled();

    await layout.saved(() => layout.doubleClickAt(onWall(90)));
    await expect(layout.tables).toHaveCount(shown);
    await expect(layout.rowPreview).toHaveCount(0);
    await expect(layout.announcement).toHaveText(`Added Gold row 1 to ${shown}.`);

    const tables = await stored(request, seeded.marketId);
    expect(tables).toHaveLength(shown);
    expect(leastSeparation(tables)).toBeGreaterThanOrEqual(-0.05);
    const fromCentre = (point: { xMm: number; yMm: number }) =>
      Math.hypot(point.xMm - centre[0], point.yMm - centre[1]);
    for (const table of tables) {
      // On the right of the way drawn: inside the wall, no corner past it by more than the
      // pixel or two the clicks were off.
      for (const corner of tableCorners(table, SIX_FOOT)) {
        expect(fromCentre(corner)).toBeLessThan(5000 + 2 * A_PIXEL_MM);
      }
      expect(fromCentre(table)).toBeLessThan(5000 - 300);
      expect(fromCentre(table)).toBeGreaterThan(5000 - 760 - 2 * A_PIXEL_MM);
    }
    // Each touches the next, and they run round the wall the way it was clicked.
    for (let i = 1; i < tables.length; i += 1) {
      const apart = separation(
        tableCorners(tables[i - 1], SIX_FOOT),
        tableCorners(tables[i], SIX_FOOT),
      );
      expect(apart).toBeLessThan(0.1);
    }
    const angles = tables.map((table) => Math.atan2(table.yMm - centre[1], table.xMm - centre[0]));
    expect(angles).toEqual([...angles].sort((a, b) => a - b));
    // And the map names them in that order.
    await expect(layout.table('Gold row 1, Standard 6 ft')).toBeVisible();
    await expect(layout.table(`Gold row ${shown}, Standard 6 ft`)).toBeVisible();
  });

  test('three clicks round an L-shaped wall give two straight runs meeting at a corner, placed by Enter', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { layout, seeded } = await open(page, request);
    await layout.clickAt([3000, 3000]);
    await layout.clickAt([11_000, 3000]);
    await layout.clickAt([11_000, 11_000]);
    await expect(layout.rowPoints).toHaveCount(3);
    // Two runs: the corner is a corner, not a bend.
    await expect(layout.rowLines).toHaveCount(2);
    await expect(layout.rowCount).toHaveText('7 tables');

    await layout.saved(() => page.keyboard.press('Enter'));
    const tables = await stored(request, seeded.marketId);
    expect(tables.map((table) => table.rotation)).toEqual([0, 0, 0, 0, 90, 90, 90]);
    // Four along the first wall in one line, three down the second in another: no bulge.
    const along = tables.slice(0, 4);
    const down = tables.slice(4);
    expect(new Set(along.map((table) => table.yMm)).size).toBe(1);
    expect(new Set(down.map((table) => table.xMm)).size).toBe(1);
    expect(Math.abs(along[0].yMm - 3380)).toBeLessThan(2 * A_PIXEL_MM);
    expect(Math.abs(down[0].xMm - 10_620)).toBeLessThan(2 * A_PIXEL_MM);
    expect(leastSeparation(tables)).toBeGreaterThanOrEqual(-0.05);
  });

  test('F and "Flip side" put the tables on the other side of the line, and "Centred on the line" centres them on it', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { layout, seeded } = await open(page, request);

    await layout.clickAt([3000, 4000]);
    await layout.clickAt([11_000, 4000]);
    const before = (await layout.rowTables.first().boundingBox())!;
    await page.keyboard.press('f');
    await expect(layout.announcement).toHaveText('Tables on the left of the line. 4 tables.');
    // The row shown has crossed the line.
    const after = (await layout.rowTables.first().boundingBox())!;
    expect(after.y).toBeLessThan(before.y - 5);
    await layout.saved(() => page.keyboard.press('Enter'));
    let tables = await stored(request, seeded.marketId);
    expect(tables).toHaveLength(4);
    for (const table of tables) expect(Math.abs(table.yMm - 3620)).toBeLessThan(2 * A_PIXEL_MM);

    // The button swaps it back, and the side is kept for the next row.
    await layout.rowFlip.click();
    await expect(layout.announcement).toHaveText('Tables on the right of the line.');
    await layout.saved(() => layout.drag([3000, 8000], [11_000, 8000]));
    tables = (await stored(request, seeded.marketId)).slice(4);
    expect(tables).toHaveLength(4);
    for (const table of tables) expect(Math.abs(table.yMm - 8380)).toBeLessThan(2 * A_PIXEL_MM);

    await layout.rowStand.selectOption({ label: 'Centred on the line' });
    await expect(layout.rowFlip).toBeDisabled();
    await layout.saved(() => layout.drag([3000, 12_000], [11_000, 12_000]));
    tables = (await stored(request, seeded.marketId)).slice(8);
    expect(tables).toHaveLength(4);
    for (const table of tables) expect(Math.abs(table.yMm - 12_000)).toBeLessThan(2 * A_PIXEL_MM);
  });

  test('a row drawn across a table and a no-table zone leaves them clear', async ({
    authenticatedPage: page,
    request,
  }) => {
    const standing: SeedTable = { section: 'sec-silver', at: [8000, 5380] };
    const stage: SeedZone = { label: 'Stage', box: [14_000, 4000, 2000, 3000] };
    const { layout, seeded } = await open(page, request, [standing], [stage]);

    await layout.saved(() => layout.drag([2000, 5000], [24_000, 5000]));
    const all = await storedLayoutTables(request, BACKEND_URL, seeded.marketId);
    const row = all.filter((table) => table.sectionId === 'sec-gold');
    const others = [
      tableCorners({ xMm: 8000, yMm: 5380, rotation: 0 }, SIX_FOOT),
      [
        { xMm: 14_000, yMm: 4000 },
        { xMm: 16_000, yMm: 4000 },
        { xMm: 16_000, yMm: 7000 },
        { xMm: 14_000, yMm: 7000 },
      ],
    ];
    expect(row.length).toBeGreaterThanOrEqual(6);
    for (const table of row) {
      for (const other of others) {
        expect(separation(tableCorners(table, SIX_FOOT), other)).toBeGreaterThanOrEqual(-0.05);
      }
    }
    // It went on past both: tables stand before the table, between the two and after the zone.
    expect(row.some((table) => table.xMm < 7000)).toBe(true);
    expect(row.some((table) => table.xMm > 9000 && table.xMm < 14_000)).toBe(true);
    expect(row.some((table) => table.xMm > 16_000)).toBe(true);
  });

  test("a placed row is selected, numbered on from its section's tables the way it was drawn, and one Undo takes it whole", async ({
    authenticatedPage: page,
    request,
  }) => {
    const { layout, seeded } = await open(page, request, [
      { section: 'sec-gold', at: [5000, 15_000] },
      { section: 'sec-gold', at: [9000, 15_000] },
    ]);

    // Drawn from the east: the first of the row is its easternmost.
    await layout.saved(() => layout.drag([22_000, 3000], [2000, 3000]));
    await expect(layout.announcement).toHaveText('Added Gold row 3 to 12.');
    await expect(layout.selectionTitle).toHaveText('10 tables selected');
    await expect(layout.selectionCodes).toHaveText(
      'Gold row 3, Gold row 4, Gold row 5, Gold row 6, Gold row 7, Gold row 8, Gold row 9, ' +
        'Gold row 10, Gold row 11, Gold row 12',
    );
    const row = (await stored(request, seeded.marketId)).slice(2);
    expect(row.map((table) => table.number)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const xs = row.map((table) => table.xMm);
    expect(xs).toEqual([...xs].sort((a, b) => b - a));
    // Drawn westward, its right is up the page.
    for (const table of row) expect(Math.abs(table.yMm - 2620)).toBeLessThan(2 * A_PIXEL_MM);
    const third = await layout.table('Gold row 3, Standard 6 ft').boundingBox();
    const twelfth = await layout.table('Gold row 12, Standard 6 ft').boundingBox();
    expect(third!.x).toBeGreaterThan(twelfth!.x);

    // Backspace is the path's key while Row of tables is on: with no point to take it takes
    // nothing, and never the row just placed, selected as it is.
    await layout.hoverAt([12_000, 9000]);
    await page.keyboard.press('Backspace');
    await expect(layout.tables).toHaveCount(12);
    await expect(layout.selectionTitle).toHaveText('10 tables selected');

    await layout.saved(() => layout.undo.click());
    await expect(layout.tables).toHaveCount(2);
    expect(await stored(request, seeded.marketId)).toHaveLength(2);
    await layout.saved(() => layout.redo.click());
    await expect(layout.tables).toHaveCount(12);
  });

  test('a pending path is not the layout: its points are dragged and taken back, Ctrl+Z leaves the layout alone, and Escape or another tool drops it unsaved', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { layout, seeded } = await open(page, request);
    // A row placed first, so the layout has a change of its own to undo.
    await layout.saved(() => layout.drag([2000, 18_000], [9000, 18_000]));
    await expect(layout.tables).toHaveCount(3);

    const saves: string[] = [];
    page.on('request', (sent) => {
      if (sent.url().includes('/floorplans/save-to-market')) saves.push(sent.url());
    });

    await layout.clickAt([3000, 4000]);
    await layout.clickAt([8000, 4000]);
    await layout.clickAt([13_000, 4000]);
    await expect(layout.rowCount).toHaveText('5 tables');

    // The last point dragged east: the row grows with it.
    await layout.drag([13_000, 4000], [20_000, 4000]);
    await expect(layout.rowPoints).toHaveCount(3);
    await expect(layout.rowCount).toHaveText('9 tables');

    // Backspace and Ctrl+Z each take the last point; the placed row stays.
    await page.keyboard.press('Backspace');
    await expect(layout.rowPoints).toHaveCount(2);
    await expect(layout.announcement).toHaveText('Point 3 taken back. 2 tables.');
    await page.keyboard.press('Control+z');
    await expect(layout.rowPoints).toHaveCount(1);
    await expect(layout.tables).toHaveCount(3);

    await layout.clickAt([8000, 4000]);
    await expect(layout.rowPoints).toHaveCount(2);
    await page.keyboard.press('Escape');
    await expect(layout.rowPreview).toHaveCount(0);
    await expect(layout.announcement).toHaveText('Row dropped. No table was added.');

    // Another tool drops a path too.
    await layout.clickAt([3000, 4000]);
    await layout.clickAt([8000, 4000]);
    await layout.toolSelect.click();
    await layout.toolRow.click();
    await layout.hoverAt([12_000, 9000]);
    await expect(layout.rowPreview).toHaveCount(0);

    // Nothing of any of it was sent, and the layout holds the first row alone.
    expect(saves).toEqual([]);
    expect(await stored(request, seeded.marketId)).toHaveLength(3);

    // With no path pending, Ctrl+Z is the layout's undo again.
    await layout.saved(() => page.keyboard.press('Control+z'));
    await expect(layout.tables).toHaveCount(0);
  });

  test('the crosshair lays the same row by keys alone, and the live region says each point and the count', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { layout, seeded } = await open(page, request);
    await layout.tabToTheMap();
    // The crosshair stands at the middle of the view, on the keys' 10 cm steps.
    await expect(layout.rowCrosshair).toBeVisible();
    await expect(layout.hint).toContainText('The arrow keys move the crosshair');

    await page.keyboard.press('ArrowUp');
    await expect(layout.announcement).toHaveText('Crosshair at 15.0 m, 11.2 m');
    await page.keyboard.press('Enter');
    await expect(layout.announcement).toHaveText('Point 1 at 15.0 m, 11.2 m. No tables yet.');
    for (let press = 0; press < 4; press += 1) await page.keyboard.press('Shift+ArrowRight');
    await expect(layout.announcement).toHaveText('Crosshair at 19.0 m, 11.2 m');
    await page.keyboard.press('Enter');
    await expect(layout.announcement).toHaveText('Point 2 at 19.0 m, 11.2 m. 2 tables.');
    for (let press = 0; press < 5; press += 1) await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Enter');
    await expect(layout.announcement).toHaveText('Point 3 at 19.0 m, 16.2 m. 4 tables.');
    await expect(layout.rowCount).toHaveText('4 tables');

    // A point taken back, and laid again.
    await page.keyboard.press('Backspace');
    await expect(layout.announcement).toHaveText('Point 3 taken back. 2 tables.');
    await page.keyboard.press('Enter');
    await expect(layout.announcement).toHaveText('Point 3 at 19.0 m, 16.2 m. 4 tables.');

    // F swaps the side, and back.
    await page.keyboard.press('f');
    await expect(layout.announcement).toHaveText(/^Tables on the left of the line\. \d+ tables\.$/);
    await page.keyboard.press('f');
    await expect(layout.announcement).toHaveText('Tables on the right of the line. 4 tables.');

    await layout.saved(() => page.keyboard.press('Control+Enter'));
    await expect(layout.announcement).toHaveText('Added Gold row 1 to 4.');
    await expect(layout.tables).toHaveCount(4);
    await expect(layout.selectionTitle).toHaveText('4 tables selected');
    // The map had no table to stop on; now the focus is on the row's first.
    await expect(layout.table('Gold row 1, Standard 6 ft')).toBeFocused();

    // The row a pointer would have placed through the same three points: two along the first
    // wall, two down the second, inside the corner.
    const tables = await stored(request, seeded.marketId);
    const expected = [
      [15_915, 11_580, 0],
      [17_745, 11_580, 0],
      [18_620, 12_875, 90],
      [18_620, 14_705, 90],
    ];
    expect(tables).toHaveLength(expected.length);
    tables.forEach((table, index) => {
      // To a twentieth of a millimetre: the first table past a corner is found by halving.
      expect(table.xMm).toBeCloseTo(expected[index][0], 1);
      expect(table.yMm).toBeCloseTo(expected[index][1], 1);
      expect(table.rotation).toBe(expected[index][2]);
    });

    // Escape drops a path begun by keys, with its words.
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await expect(layout.announcement).toHaveText('Row dropped. No table was added.');
    await expect(layout.rowPoints).toHaveCount(0);
  });

  test('"Row of N…" in the selection card goes on along the selected table\'s line', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { layout, seeded } = await open(page, request, [
      { section: 'sec-gold', at: [5000, 5000] },
    ]);
    await layout.toolSelect.click();
    await layout.clickAt([5000, 5000]);
    await expect(layout.selectionTitle).toHaveText('Gold row 1');
    await layout.selectionRow.click();
    await layout.selectionRowCount.fill('3');
    await layout.saved(() => layout.selectionRowAdd.click());
    await expect(layout.announcement).toHaveText('Added Gold row 2 to 4.');
    const tables = await stored(request, seeded.marketId);
    expect(tables.map((table) => [table.xMm, table.yMm, table.rotation])).toEqual([
      [5000, 5000, 0],
      [6830, 5000, 0],
      [8660, 5000, 0],
      [10_490, 5000, 0],
    ]);
    // The table stays selected, and the button under the focus, so the row goes on again.
    await expect(layout.selectionTitle).toHaveText('Gold row 1');
    await expect(layout.selectionRowAdd).toBeFocused();
  });
});
