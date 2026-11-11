import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { LayoutPage } from './pages/LayoutPage';
import {
  LAYOUT_FLOORPLAN_PATH,
  seedLayout,
  seedRow,
  storedLayoutTables,
  type SeedTable,
  type SeedZone,
  type SeededLayout,
  type StoredLayoutTable,
} from './helpers/seeds';
import { apart as separation, cornersOf as tableCorners } from './helpers/tableShapes';

/**
 * Rows of tables and filled areas fill a hall (T257 tickets 07 to 09), on Upper Hall, 30 m by 22.5 m, with
 * six-foot tables, 1830 by 760 mm: a drag places a straight row, clicks along a wall place a row
 * that follows it, round a curve or a corner, on the side chosen, clear of what stands there; a
 * click on the first point closes the path into a shape, its tables spread evenly round it;
 * Rows and Aisle place several rows in the one gesture; and the crosshair lays the same rows and
 * shapes by keys alone. Fill an area packs a dragged box, or a shape whose corners are clicked,
 * with rows of tables an aisle apart, clear of what stands there, as one change, and says how
 * many it placed. Every gesture is the pointer's or the keys' own, and
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
  tool: 'row' | 'fill' = 'row',
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
  if (tool === 'fill') {
    await layout.toolFill.click();
    await expect(layout.fillView).toBeVisible();
  } else {
    await layout.toolRow.click();
    await expect(layout.rowGap).toBeVisible();
  }
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

  test("eight clicks round a stage, closed on the first point, place a ring of tables outside it, none overlapping, every gap the same, the seam's too", async ({
    authenticatedPage: page,
    request,
  }) => {
    // A stage 4 m square in the middle of the hall, and a ring clicked round it 3 m out.
    const centre = [15_000, 11_000] as const;
    const { layout, seeded } = await open(
      page,
      request,
      [],
      [{ label: 'Stage', box: [13_000, 9000, 4000, 4000] }],
    );
    const round = (degrees: number): [number, number] => {
      const turn = (degrees * Math.PI) / 180;
      return [centre[0] + 3000 * Math.cos(turn), centre[1] + 3000 * Math.sin(turn)];
    };
    // Clicked clockwise on the page, the tables would stand inside: Flip side puts them out.
    await layout.rowFlip.click();
    await layout.clickAt(round(0));
    await layout.clickAt(round(45));
    // Two points are no shape: the first wears no ring under the pointer.
    await layout.hoverAt(round(0));
    await expect(layout.rowClose).toHaveCount(0);
    for (const degrees of [90, 135, 180, 225, 270, 315]) await layout.clickAt(round(degrees));
    await expect(layout.rowPoints).toHaveCount(8);

    // Over the first point the path is shown as the click would close it.
    await layout.hoverAt(round(0));
    await expect(layout.rowClose).toBeVisible();
    await expect(layout.rowCount).toHaveText('10 tables');
    await layout.clickAt(round(0));
    await expect(layout.announcement).toHaveText('Closed. 10 tables.');
    await expect(layout.rowClose).toHaveCount(0);
    await expect(layout.rowLines).toHaveCount(1);
    await expect(layout.rowTables).toHaveCount(10);
    // A closed shape is still only a path: nothing is the layout's, and an open path's choice
    // is not offered.
    await expect(layout.tables).toHaveCount(0);
    await expect(layout.undo).toBeDisabled();
    await expect(layout.rowSpread).toBeDisabled();
    // A click on the floor adds no point to it.
    await layout.clickAt([3000, 3000]);
    await expect(layout.rowPoints).toHaveCount(8);

    // The second click on the first point places it: a double-click there closes and places.
    await layout.saved(() => layout.clickAt(round(0)));
    await expect(layout.announcement).toHaveText('Added Gold row 1 to 10.');
    await expect(layout.rowPreview).toHaveCount(0);
    await expect(layout.tables).toHaveCount(10);
    await expect(layout.selectionTitle).toHaveText('10 tables selected');

    const tables = await stored(request, seeded.marketId);
    expect(tables).toHaveLength(10);
    expect(leastSeparation(tables)).toBeGreaterThanOrEqual(-0.05);
    const fromCentre = (point: { xMm: number; yMm: number }) =>
      Math.hypot(point.xMm - centre[0], point.yMm - centre[1]);
    for (const table of tables) {
      // Outside the ring, its back against it: no corner inside the circle by more than the
      // pixel or two the clicks were off, and its middle half a table's depth out.
      for (const corner of tableCorners(table, SIX_FOOT)) {
        expect(fromCentre(corner)).toBeGreaterThan(3000 - 2 * A_PIXEL_MM);
      }
      expect(fromCentre(table)).toBeGreaterThan(3000 + 380 - 2 * A_PIXEL_MM);
      expect(fromCentre(table)).toBeLessThan(3000 + 380 + 2 * A_PIXEL_MM);
    }
    // Every table as far from the next as the last is from the first, to a millimetre.
    const gaps = tables.map((table, i) =>
      separation(
        tableCorners(table, SIX_FOOT),
        tableCorners(tables[(i + 1) % tables.length], SIX_FOOT),
      ),
    );
    expect(Math.min(...gaps)).toBeGreaterThan(0);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(1);
    // Numbered from the first point clicked, the way it was drawn.
    const angles = tables.map((table) => {
      const turn = Math.atan2(table.yMm - centre[1], table.xMm - centre[0]);
      return turn < 0 ? turn + 2 * Math.PI : turn;
    });
    expect(angles).toEqual([...angles].sort((a, b) => a - b));

    // One Undo takes the ring whole.
    await layout.saved(() => layout.undo.click());
    await expect(layout.tables).toHaveCount(0);
  });

  test('Rows and Aisle place two rows in one drag, an aisle apart table to table, the first row numbered whole and then the next; and an open row is spread to its ends where asked', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { layout, seeded } = await open(page, request);
    await expect(layout.rowRows).toHaveValue('1');
    await expect(layout.rowAisle).toHaveValue('120');
    await expect(layout.rowSpread).not.toBeChecked();

    await layout.rowRows.fill('2');
    await layout.saved(() =>
      layout.drag([2000, 3000], [22_000, 3000], {
        hold: async () => {
          await expect(layout.rowCount).toHaveText('20 tables');
          await expect(layout.rowTables).toHaveCount(20);
        },
      }),
    );
    await expect(layout.announcement).toHaveText('Added Gold row 1 to 20.');
    let tables = await stored(request, seeded.marketId);
    expect(tables).toHaveLength(20);
    const first = tables.slice(0, 10);
    const second = tables.slice(10);
    for (const step of steps(first)) expect(step).toBeCloseTo(1830, 1);
    for (const step of steps(second)) expect(step).toBeCloseTo(1830, 1);
    second.forEach((table, i) => {
      // Under its table of the first row, a table's depth and the 120 cm aisle further on.
      expect(table.xMm).toBeCloseTo(first[i].xMm, 1);
      expect(table.yMm - first[i].yMm).toBeCloseTo(760 + 1200, 1);
    });
    expect(leastSeparation(tables)).toBeGreaterThanOrEqual(-0.05);

    // A wider aisle, typed in centimetres, and the rows the other side of the line.
    await layout.rowAisle.fill('200');
    await layout.rowFlip.click();
    await layout.saved(() => layout.drag([2000, 16_000], [22_000, 16_000]));
    await expect(layout.announcement).toHaveText('Added Gold row 21 to 40.');
    tables = (await stored(request, seeded.marketId)).slice(20);
    tables.slice(10).forEach((table, i) => {
      expect(table.yMm - tables[i].yMm).toBeCloseTo(-(760 + 2000), 1);
    });

    // One row again, spread evenly to the ends of its 20 m: the last table ends where the drag
    // did, and the gaps are equal.
    await layout.rowRows.fill('1');
    await layout.rowFlip.click();
    await layout.rowSpread.check();
    await layout.saved(() => layout.drag([2000, 20_000], [22_000, 20_000]));
    await expect(layout.announcement).toHaveText('Added Gold row 41 to 50.');
    tables = (await stored(request, seeded.marketId)).slice(40);
    expect(tables).toHaveLength(10);
    const length = tables[9].xMm - tables[0].xMm + 1830;
    expect(Math.abs(length - 20_000)).toBeLessThan(4 * A_PIXEL_MM);
    const apart = steps(tables);
    expect(Math.max(...apart) - Math.min(...apart)).toBeLessThan(0.1);
    expect(apart[0]).toBeGreaterThan(1830 + 100);
  });

  test('the crosshair closes a shape with C, the live region saying what it holds, and Enter places the ring', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { layout, seeded } = await open(page, request);
    await layout.tabToTheMap();
    await expect(layout.rowCrosshair).toBeVisible();
    await expect(layout.hint).toContainText('C closes a shape');

    /** Move the crosshair by tenths of a metre: a metre at a time with Shift, then 10 cm. */
    const move = async (acrossDm: number, downDm: number) => {
      for (const [by, back, on] of [
        [acrossDm, 'ArrowLeft', 'ArrowRight'],
        [downDm, 'ArrowUp', 'ArrowDown'],
      ] as const) {
        const key = by < 0 ? back : on;
        const metres = Math.floor(Math.abs(by) / 10);
        for (let press = 0; press < metres; press += 1) await page.keyboard.press(`Shift+${key}`);
        for (let press = 0; press < Math.abs(by) % 10; press += 1) await page.keyboard.press(key);
      }
    };
    // Eight points round a circle of 3.05 m about (15.0, 11.3) m, where the crosshair starts,
    // clockwise on the page from its south-east.
    const points = [
      [28, 12],
      [12, 28],
      [-12, 28],
      [-28, 12],
      [-28, -12],
      [-12, -28],
      [12, -28],
      [28, -12],
    ];
    await move(points[0][0], points[0][1]);
    await page.keyboard.press('Enter');
    await expect(layout.announcement).toHaveText('Point 1 at 17.8 m, 12.5 m. No tables yet.');
    // Fewer than three points are no shape.
    await page.keyboard.press('c');
    await expect(layout.announcement).toHaveText('A shape takes three points or more.');
    for (let i = 1; i < points.length; i += 1) {
      await move(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
      await page.keyboard.press('Enter');
    }
    await expect(layout.rowPoints).toHaveCount(8);
    await expect(layout.announcement).toHaveText(/^Point 8 at 17\.8 m, 10\.1 m\. \d+ tables\.$/);
    // Drawn this way the tables would stand inside: F puts them outside, closed or open.
    await page.keyboard.press('f');
    await expect(layout.announcement).toHaveText(/^Tables on the left of the line\. \d+ tables\.$/);

    await page.keyboard.press('c');
    await expect(layout.announcement).toHaveText('Closed. 10 tables.');
    await expect(layout.rowTables).toHaveCount(10);
    await expect(layout.rowLines).toHaveCount(1);

    // Backspace opens it again, its points as they were, and C closes it once more.
    await page.keyboard.press('Backspace');
    await expect(layout.announcement).toHaveText(/^Opened again\. \d+ tables\.$/);
    await expect(layout.rowPoints).toHaveCount(8);
    await page.keyboard.press('c');
    await expect(layout.announcement).toHaveText('Closed. 10 tables.');

    // Enter lays no ninth point on a closed shape: it places the ring.
    await layout.saved(() => page.keyboard.press('Enter'));
    await expect(layout.announcement).toHaveText('Added Gold row 1 to 10.');
    await expect(layout.tables).toHaveCount(10);
    await expect(layout.table('Gold row 1, Standard 6 ft')).toBeFocused();

    const tables = await stored(request, seeded.marketId);
    expect(tables).toHaveLength(10);
    expect(leastSeparation(tables)).toBeGreaterThanOrEqual(-0.05);
    const radius = Math.hypot(2800, 1200);
    for (const table of tables) {
      // Outside the circle the points stand on, its back against it: no corner inside it, and
      // its middle half a table's depth out, to a couple of millimetres.
      const away = (point: { xMm: number; yMm: number }) =>
        Math.hypot(point.xMm - 15_000, point.yMm - 11_300);
      for (const corner of tableCorners(table, SIX_FOOT)) {
        expect(away(corner)).toBeGreaterThan(radius - 1);
      }
      expect(Math.abs(away(table) - (radius + 380))).toBeLessThan(2);
    }
    const gaps = tables.map((table, i) =>
      separation(
        tableCorners(table, SIX_FOOT),
        tableCorners(tables[(i + 1) % tables.length], SIX_FOOT),
      ),
    );
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(1);
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

/** A table's box on the page, for tables that stand unturned or a quarter turned. */
function boxOf(table: StoredLayoutTable) {
  const turned = table.rotation === 90;
  const halfWidth = (turned ? SIX_FOOT.depthMm : SIX_FOOT.widthMm) / 2;
  const halfDepth = (turned ? SIX_FOOT.widthMm : SIX_FOOT.depthMm) / 2;
  return {
    left: table.xMm - halfWidth,
    right: table.xMm + halfWidth,
    top: table.yMm - halfDepth,
    bottom: table.yMm + halfDepth,
  };
}

/** The tables by the row they stand in, from the top, each row from the left. */
function rowsOf(tables: StoredLayoutTable[]): StoredLayoutTable[][] {
  const rows = new Map<number, StoredLayoutTable[]>();
  for (const table of tables) {
    const row = Math.round(table.yMm);
    rows.set(row, [...(rows.get(row) ?? []), table]);
  }
  return [...rows.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, row]) => row.sort((a, b) => a.xMm - b.xMm));
}

const PLACE_TABLES = '**/floorplans/place-tables';

test.describe('Areas fill a hall', () => {
  test('a box dragged over empty floor and asked for 30 is filled with 30, in rows touching with the aisle between them, numbered as read, and one Undo takes them all', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { layout, seeded } = await open(page, request, [], [], 'fill');
    await expect(layout.hint).toContainText('Drag a box over the floor to fill.');

    await layout.drag([2000, 3000], [22_000, 15_000], {
      hold: async () => {
        // The box as it is drawn, while the button is down.
        await expect(layout.fillArea).toBeVisible();
      },
    });
    await expect(layout.fillDialog).toBeVisible();
    // The pointer is put within a few centimetres of the places asked for.
    await expect(layout.fillAreaText).toHaveText(
      /^Area: A box (19\.9|20\.0|20\.1) m by (11\.9|12\.0|12\.1) m$/,
    );
    await expect(layout.fillSection).toHaveValue('sec-gold');
    await expect(layout.fillCount).toHaveValue('30');
    await expect(layout.fillDirection).toHaveValue('across');
    await expect(layout.fillAisle).toHaveValue('120');
    await expect(layout.fillInView).not.toBeChecked();

    // The placement held, so what the dialog says while it runs can be read.
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(PLACE_TABLES, async (route) => {
      await held;
      await route.continue();
    });
    await layout.fillSubmit.click();
    await expect(layout.fillSubmit).toHaveText('Placing…');
    await expect(layout.fillSubmit).toBeDisabled();
    await expect(layout.fillCancel).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(layout.fillDialog).toBeVisible();
    await layout.saved(async () => {
      release();
      await expect(layout.fillDialog).toBeHidden();
    });
    await page.unroute(PLACE_TABLES);

    await expect(layout.status).toHaveText('Placed 30.');
    await expect(layout.announcement).toHaveText('Placed 30.');
    await expect(layout.tables).toHaveCount(30);
    await expect(layout.fillPreview).toHaveCount(0);
    await expect(layout.selectionTitle).toHaveText('30 tables selected');

    const tables = await stored(request, seeded.marketId);
    expect(tables).toHaveLength(30);
    expect(tables.map((table) => table.number)).toEqual(
      Array.from({ length: 30 }, (_, i) => i + 1),
    );
    expect(new Set(tables.map((table) => table.sectionId))).toEqual(new Set(['sec-gold']));
    expect(new Set(tables.map((table) => table.rotation))).toEqual(new Set([0]));
    for (const table of tables) {
      const box = boxOf(table);
      expect(box.left).toBeGreaterThanOrEqual(2000 - 2 * A_PIXEL_MM);
      expect(box.right).toBeLessThanOrEqual(22_000 + 2 * A_PIXEL_MM);
      expect(box.top).toBeGreaterThanOrEqual(3000 - 2 * A_PIXEL_MM);
      expect(box.bottom).toBeLessThanOrEqual(15_000 + 2 * A_PIXEL_MM);
    }
    // Three rows of ten, each row's tables touching and the rows an aisle apart; numbered in
    // reading order, so each row holds the next ten numbers from its left.
    const rows = rowsOf(tables);
    expect(rows.map((row) => row.length)).toEqual([10, 10, 10]);
    rows.forEach((row, at) => {
      expect(row.map((table) => table.number)).toEqual(
        Array.from({ length: 10 }, (_, i) => at * 10 + i + 1),
      );
      for (const step of steps(row)) expect(step).toBeCloseTo(1830, 1);
    });
    expect(rows[1][0].yMm - rows[0][0].yMm).toBeCloseTo(760 + 1200, 1);
    expect(rows[2][0].yMm - rows[1][0].yMm).toBeCloseTo(760 + 1200, 1);
    expect(leastSeparation(tables)).toBeGreaterThanOrEqual(-0.05);

    // One change: one Undo takes all thirty, and the status line with them.
    await layout.saved(() => layout.undo.click());
    await expect(layout.tables).toHaveCount(0);
    await expect(layout.status).toHaveCount(0);
    expect(await stored(request, seeded.marketId)).toHaveLength(0);
    await layout.saved(() => layout.redo.click());
    await expect(layout.tables).toHaveCount(30);
  });

  test('"As many as fit" fills the box, in rows down the page where asked, and a box too small for what was asked says how many fitted', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { layout, seeded } = await open(page, request, [], [], 'fill');

    // 6 m by 12 m, rows down: three columns (0, 1.96 m and 3.92 m across) of six tables each.
    await layout.drag([2000, 3000], [8000, 15_000]);
    await layout.fillFitChoice.check();
    await expect(layout.fillCount).toBeDisabled();
    await layout.fillDirection.selectOption('down');
    await layout.saved(() => layout.fillSubmit.click());
    await expect(layout.status).toHaveText('Placed 18.');
    let tables = await stored(request, seeded.marketId);
    expect(tables).toHaveLength(18);
    expect(new Set(tables.map((table) => table.rotation))).toEqual(new Set([90]));
    expect(new Set(tables.map((table) => Math.round(table.xMm - tables[0].xMm)))).toEqual(
      new Set([0, 1960, 3920]),
    );
    expect(leastSeparation(tables)).toBeGreaterThanOrEqual(-0.05);

    // The dialog kept what was chosen. 12 m by 6 m across holds three rows of six: 18 of 30.
    await layout.drag([12_000, 3000], [24_000, 9000]);
    await expect(layout.fillFitChoice).toBeChecked();
    await expect(layout.fillDirection).toHaveValue('down');
    await layout.fillCountChoice.check();
    await layout.fillDirection.selectOption('across');
    await layout.saved(() => layout.fillSubmit.click());
    await expect(layout.status).toHaveText('Placed 18 of 30; the rest did not fit.');
    await expect(layout.announcement).toHaveText('Placed 18 of 30; the rest did not fit.');
    tables = (await stored(request, seeded.marketId)).slice(18);
    expect(tables.map((table) => table.number)).toEqual(
      Array.from({ length: 18 }, (_, i) => i + 19),
    );
    expect(rowsOf(tables).map((row) => row.length)).toEqual([6, 6, 6]);

    // A box no table fits in changes nothing, and says so.
    await layout.drag([26_000, 18_000], [27_000, 18_500]);
    await layout.fillSubmit.click();
    await expect(layout.fillDialog).toBeHidden();
    await expect(layout.status).toHaveText('No table fits in that area.');
    await expect(layout.tables).toHaveCount(36);

    // A drag along one line is no box: no dialog, and the same sentence.
    await layout.saved(() => layout.undo.click());
    await expect(layout.status).toHaveCount(0);
    await layout.drag([12_000, 14_000], [24_000, 14_000]);
    await expect(layout.status).toHaveText('No table fits in that area.');
    await expect(layout.fillDialog).toBeHidden();
    await expect(layout.fillPreview).toHaveCount(0);
  });

  test('no table is placed on a no-table zone or within the aisle of a table that stands, and the rows go on past both', async ({
    authenticatedPage: page,
    request,
  }) => {
    const standing: SeedTable = { section: 'sec-silver', at: [9000, 4380], rotation: 30 };
    const stage: SeedZone = { label: 'Stage', box: [15_000, 2000, 2000, 9000] };
    const { layout, seeded } = await open(page, request, [standing], [stage], 'fill');

    await layout.drag([2000, 3000], [24_000, 10_000]);
    await layout.fillFitChoice.check();
    await layout.saved(() => layout.fillSubmit.click());
    await expect(layout.status).toHaveText(/^Placed \d+\.$/);

    const all = await storedLayoutTables(request, BACKEND_URL, seeded.marketId);
    const filled = all.filter((table) => table.sectionId === 'sec-gold');
    expect(filled.length).toBeGreaterThan(15);
    const table = tableCorners({ xMm: 9000, yMm: 4380, rotation: 30 }, SIX_FOOT);
    const zone = [
      { xMm: 15_000, yMm: 2000 },
      { xMm: 17_000, yMm: 2000 },
      { xMm: 17_000, yMm: 11_000 },
      { xMm: 15_000, yMm: 11_000 },
    ];
    for (const one of filled) {
      const corners = tableCorners(one, SIX_FOOT);
      expect(separation(corners, table)).toBeGreaterThanOrEqual(1200 - 0.05);
      expect(separation(corners, zone)).toBeGreaterThanOrEqual(-0.05);
    }
    // Tables stand on both sides of the zone, and the first row past it starts at its edge.
    expect(filled.some((one) => one.xMm < 15_000)).toBe(true);
    const past = filled.filter((one) => one.xMm > 17_000);
    expect(past.length).toBeGreaterThan(0);
    expect(Math.min(...past.map((one) => boxOf(one).left))).toBeCloseTo(17_000, 1);
    expect(leastSeparation(filled)).toBeGreaterThanOrEqual(-0.05);
  });

  test('an L-shaped area, its corners clicked and closed on the first, is filled only inside the L', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { layout, seeded } = await open(page, request, [], [], 'fill');
    const corners: [number, number][] = [
      [2000, 2000],
      [14_000, 2000],
      [14_000, 6000],
      [6000, 6000],
      [6000, 14_000],
      [2000, 14_000],
    ];

    for (const corner of corners) await layout.clickAt(corner);
    await expect(layout.fillPoints).toHaveCount(6);
    // Nothing of a shape being drawn is the layout's.
    await expect(layout.undo).toBeDisabled();
    // The first corner wears a ring while a click on it would close the shape.
    await layout.hoverAt(corners[0]);
    await expect(layout.fillClose).toBeVisible();
    await layout.clickAt(corners[0]);

    await expect(layout.fillDialog).toBeVisible();
    await expect(layout.fillAreaText).toHaveText('Area: A shape of 6 corners');
    await layout.fillFitChoice.check();
    await layout.saved(() => layout.fillSubmit.click());
    // Two rows of six across the L's top, and four of two down its arm.
    await expect(layout.status).toHaveText('Placed 20.');

    const tables = await stored(request, seeded.marketId);
    expect(tables).toHaveLength(20);
    const slack = 2 * A_PIXEL_MM;
    for (const table of tables) {
      const box = boxOf(table);
      expect(box.left).toBeGreaterThanOrEqual(2000 - slack);
      expect(box.top).toBeGreaterThanOrEqual(2000 - slack);
      expect(box.bottom).toBeLessThanOrEqual(14_000 + slack);
      // Inside the top of the L, or inside its arm: never in the corner the L leaves out.
      const inTheTop = box.bottom <= 6000 + slack && box.right <= 14_000 + slack;
      const inTheArm = box.right <= 6000 + slack;
      expect(inTheTop || inTheArm, `table ${table.number} at ${table.xMm}, ${table.yMm}`).toBe(
        true,
      );
    }
    expect(rowsOf(tables).map((row) => row.length)).toEqual([6, 6, 2, 2, 2, 2]);
  });

  test('a shape whose sides cross cannot be closed, by pointer or by Enter, until a corner is moved; given up in the dialog it is its corners again, and Escape drops it', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { layout, seeded } = await open(page, request, [], [], 'fill');
    const crosses =
      "This shape's sides cross. Move a corner, or take one back, so that they do not.";

    // A bow tie: the third and fourth corners are the wrong way round.
    for (const corner of [
      [4000, 4000],
      [16_000, 4000],
      [4000, 12_000],
      [16_000, 12_000],
    ] as [number, number][]) {
      await layout.clickAt(corner);
    }
    await expect(layout.fillLine).toHaveAttribute('data-crosses', '');
    await layout.hoverAt([4000, 4000]);
    await expect(layout.fillClose).toHaveCount(0);
    await layout.clickAt([4000, 4000]);
    await expect(layout.status).toHaveText(crosses);
    await expect(layout.announcement).toHaveText(crosses);
    await expect(layout.fillDialog).toBeHidden();
    await layout.hoverAt([10_000, 16_000]);
    await page.keyboard.press('Enter');
    await expect(layout.fillDialog).toBeHidden();
    await expect(layout.fillPoints).toHaveCount(4);

    // The fourth corner dragged past the third, and the third to where the fourth was.
    await layout.drag([16_000, 12_000], [16_000, 14_000]);
    await layout.drag([4000, 12_000], [16_000, 11_000]);
    await layout.drag([16_000, 14_000], [4000, 12_000]);
    await expect(layout.fillLine).not.toHaveAttribute('data-crosses', '');
    await expect(layout.status).toHaveCount(0);
    await layout.hoverAt([10_000, 16_000]);
    await page.keyboard.press('Enter');
    await expect(layout.fillDialog).toBeVisible();
    await expect(layout.fillAreaText).toHaveText('Area: A shape of 4 corners');

    // Cancel gives the corners back, to be moved; Backspace takes one, and Escape drops the rest.
    await layout.fillCancel.click();
    await expect(layout.fillDialog).toBeHidden();
    await expect(layout.fillPoints).toHaveCount(4);
    await layout.hoverAt([10_000, 16_000]);
    await page.keyboard.press('Backspace');
    await expect(layout.fillPoints).toHaveCount(3);
    await page.keyboard.press('Escape');
    await expect(layout.fillPreview).toHaveCount(0);
    await expect(layout.status).toHaveText('Area dropped. No table was added.');
    await expect(layout.tables).toHaveCount(0);
    expect(await stored(request, seeded.marketId)).toHaveLength(0);

    // The server refuses a crossing shape too, with its sentence.
    const refused = await request.post(`${BACKEND_URL}/floorplans/place-tables`, {
      data: {
        market_id: seeded.marketId,
        walls: [],
        obstacles: [],
        table_types: [{ id: 'six', name: 'Six', width_mm: 1830, height_mm: 760, max_capacity: 1 }],
        counts: { six: 5 },
        scale_px_per_mm: 0.05,
        room_mm: { width_mm: 30_000, height_mm: 22_500 },
        area_polygon_mm: [
          [4000, 4000],
          [16_000, 4000],
          [4000, 12_000],
          [16_000, 12_000],
        ],
      },
    });
    expect(refused.status()).toBe(400);
    expect(await refused.json()).toEqual({
      error: 'An area is drawn with 3 to 50 corners that do not cross.',
    });
  });

  test('a placement that ran out of time says so with what it placed, and a refusal is written into the dialog, which stays open', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { layout } = await open(page, request, [], [], 'fill');

    // The server's refusal: the dialog keeps it, and the area.
    await page.route(PLACE_TABLES, (route) =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Auto-Place places up to 500 tables at a time.' }),
      }),
    );
    await layout.drag([2000, 3000], [22_000, 15_000]);
    await layout.fillSubmit.click();
    await expect(layout.fillError).toHaveText('Auto-Place places up to 500 tables at a time.');
    await expect(layout.fillDialog).toBeVisible();
    await expect(layout.fillSubmit).toHaveText('Fill');
    await expect(layout.fillSubmit).toBeEnabled();
    await page.unroute(PLACE_TABLES);

    // The grid's deadline cannot be reached on this stack in a spec's time: its answer is staged.
    await page.route(PLACE_TABLES, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          placed_tables: Array.from({ length: 24 }, (_, i) => ({
            x_mm: 2915 + (i % 10) * 1830,
            y_mm: 3380 + Math.floor(i / 10) * 1960,
            rotation: 0,
            width_mm: 1830,
            height_mm: 760,
            table_type_id: 'six-foot',
          })),
          timed_out: true,
        }),
      }),
    );
    await layout.saved(() => layout.fillSubmit.click());
    await page.unroute(PLACE_TABLES);
    await expect(layout.fillDialog).toBeHidden();
    await expect(layout.status).toHaveText(
      'Placed 24 of 30 - Fill an area ran out of time before the rest.',
    );
    await expect(layout.tables).toHaveCount(24);
  });

  test('the crosshair lays an area\'s corners by keys alone and Ctrl+Enter closes it; "Fill what is in view" fills what the map shows with nothing drawn', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { layout, seeded } = await open(page, request, [], [], 'fill');

    // The crosshair begins at the middle of the view, on the keys' 10 cm steps.
    await layout.tabToTheMap();
    await expect(layout.fillCrosshair).toBeVisible();
    await expect(layout.hint).toContainText('Enter lays a corner of the area');
    await page.keyboard.press('Control+Enter');
    await expect(layout.status).toHaveText('An area takes three corners or more.');
    await page.keyboard.press('Enter');
    await expect(layout.announcement).toHaveText('Corner 1 at 15.0 m, 11.3 m.');
    for (let press = 0; press < 8; press += 1) await page.keyboard.press('Shift+ArrowRight');
    await expect(layout.announcement).toHaveText('Crosshair at 23.0 m, 11.3 m');
    await page.keyboard.press('Enter');
    await expect(layout.announcement).toHaveText('Corner 2 at 23.0 m, 11.3 m.');
    for (let press = 0; press < 5; press += 1) await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Enter');
    await expect(layout.announcement).toHaveText('Corner 4 at 22.9 m, 16.3 m.');
    await page.keyboard.press('Backspace');
    await expect(layout.announcement).toHaveText('Corner 4 taken back.');
    await expect(layout.fillPoints).toHaveCount(3);
    await expect(layout.undo).toBeDisabled();

    // Ctrl+Enter closes the triangle and asks how to fill it, the focus in the dialog; Enter in
    // a field is Fill.
    await page.keyboard.press('Control+Enter');
    await expect(layout.fillDialog).toBeVisible();
    await expect(layout.fillAreaText).toHaveText('Area: A shape of 3 corners');
    await expect(layout.fillSection).toBeFocused();
    await layout.fillCount.fill('3');
    await layout.saved(() => page.keyboard.press('Enter'));
    await expect(layout.fillDialog).toBeHidden();
    await expect(layout.announcement).toHaveText('Placed 3.');
    let tables = await stored(request, seeded.marketId);
    expect(tables).toHaveLength(3);
    // The triangle's top row, under its top side and inside its sloping one.
    for (const table of tables) {
      expect(table.yMm).toBeCloseTo(11_300 + 380, 1);
      expect(boxOf(table).right).toBeLessThanOrEqual(23_000 + 0.05);
      expect(boxOf(table).left).toBeGreaterThanOrEqual(15_000 + (760 / 5000) * 8000 - 0.05);
    }

    // "Fill what is in view", by keys: the whole hall is in view, less what stands and its aisle.
    await layout.fillView.focus();
    await page.keyboard.press('Enter');
    await expect(layout.fillDialog).toBeVisible();
    await expect(layout.fillAreaText).toHaveText('Area: What is in view');
    await expect(layout.fillInView).toBeChecked();
    await expect(layout.fillInView).toBeDisabled();
    await layout.fillFitChoice.check();
    await layout.saved(() => page.keyboard.press('Enter'));
    await expect(layout.status).toHaveText(/^Placed \d+\.$/);
    // Closed, the dialog gives the focus back to the button that opened it.
    await expect(layout.fillView).toBeFocused();
    tables = await stored(request, seeded.marketId);
    expect(tables.length).toBeGreaterThan(100);
    expect(leastSeparation(tables)).toBeGreaterThanOrEqual(-0.05);
    for (const table of tables) {
      const box = boxOf(table);
      expect(box.left).toBeGreaterThanOrEqual(-0.05);
      expect(box.top).toBeGreaterThanOrEqual(-0.05);
      expect(box.right).toBeLessThanOrEqual(30_000 + 0.05);
      expect(box.bottom).toBeLessThanOrEqual(22_500 + 0.05);
    }
  });
});

/** The market as the server holds it: its types and its layouts, whole. */
async function storedPlan(request: APIRequestContext, marketId: string) {
  const read = await request.get(`${BACKEND_URL}/markets/${marketId}`);
  expect(read.ok()).toBe(true);
  const { market } = (await read.json()) as {
    market: {
      setupObject: {
        tableTypes: { id: string; name: string; widthMm: number; depthMm: number }[];
        floorplans: {
          imageGridfsId: string;
          imageWidth: number;
          scalePxPerUnit: number;
          zones: { label: string; xMm: number; yMm: number; widthMm: number; depthMm: number }[];
          tables: StoredLayoutTable[];
        }[];
      };
    };
  };
  return market.setupObject;
}

test.describe('Types and zones shape a hall', () => {
  test('a type added is offered for new tables and the selection, sizes its tables, and is kept while 12 tables are of it; types saved in one market are used in another', async ({
    authenticatedPage: page,
    request,
  }) => {
    const seeded = await seedLayout(request, BACKEND_URL, TEST_USER.email, TEST_USER.password, {
      metresAcross: 30,
      tables: seedRow('sec-gold', [3000, 4000], 12),
    });
    const layout = new LayoutPage(page);
    await layout.goto(seeded.marketId, seeded.upper.id);
    await expect(layout.tables).toHaveCount(12);
    await expect(layout.typeRow('Standard 6 ft')).toContainText('183 x 76 cm');
    await expect(layout.typeRow('Standard 6 ft')).toContainText('12 tables');

    await layout.typesAdd.click();
    await expect(layout.typeDialog).toHaveAccessibleName('Add a table type');
    await expect(layout.typeUnit).toHaveValue('cm');
    await layout.typeTheType('Square 4 ft', '122', '122');
    await expect(layout.typeRow('Square 4 ft')).toContainText('122 x 122 cm');
    await expect(layout.typeRow('Square 4 ft')).toContainText('0 tables');
    await expect(layout.typesSaid).toHaveText('Added Square 4 ft.');

    // Offered in the options strip and in the selection card.
    await layout.toolAdd.click();
    await expect(layout.addType.locator('option', { hasText: 'Square 4 ft' })).toHaveCount(1);
    await layout.toolSelect.click();
    await layout.stage.click({ position: { x: 4, y: 4 } });
    await page.keyboard.press('Control+a');
    await expect(layout.selectionType.locator('option', { hasText: 'Square 4 ft' })).toHaveCount(1);
    await layout.saved(async () => {
      await layout.selectionType.selectOption({ label: 'Square 4 ft' });
    });
    await expect(layout.table('Gold row 1, Square 4 ft')).toBeVisible();
    await expect(layout.typeRow('Square 4 ft')).toContainText('12 tables');
    expect(await layout.tableTop('Gold row 1, Square 4 ft').getAttribute('width')).toBe('1220');

    // A type resized redraws its tables at the new size.
    await layout.chooseForType('Square 4 ft', 'Edit');
    await expect(layout.typeWidth).toHaveValue('122');
    await layout.typeTheType('Square 4 ft', '150', '150');
    await expect(layout.typeRow('Square 4 ft')).toContainText('150 x 150 cm');
    await expect
      .poll(() => layout.tableTop('Gold row 1, Square 4 ft').getAttribute('width'))
      .toBe('1500');

    // Kept while tables are of it, with their count; one no table is of goes.
    await layout.chooseForType('Square 4 ft', 'Remove');
    await expect(layout.typesSaid).toHaveText('12 tables are Square 4 ft. Change them first.');
    await expect(layout.typeRows).toHaveCount(2);
    await layout.chooseForType('Standard 6 ft', 'Remove');
    await expect(layout.typesSaid).toHaveText('Removed Standard 6 ft.');
    await expect(layout.typeRows).toHaveCount(1);
    await expect(layout.typesAdd).toBeFocused();
    expect((await storedPlan(request, seeded.marketId)).tableTypes.map((t) => t.name)).toEqual([
      'Square 4 ft',
    ]);

    // Saved under a name...
    const venue = `Riverside Hall ${Date.now()}`;
    await layout.typesSave.click();
    await expect(layout.saveTypesDialog).toHaveAccessibleName('Save these types');
    await layout.saveTypesName.fill(venue);
    await layout.saveTypesSubmit.click();
    await expect(layout.saveTypesDialog).toBeHidden();
    await expect(layout.typesSaid).toHaveText(`Saved these types as ${venue}.`);

    // ...and used in another market, which gains the type it lacks by name.
    const other = await seedLayout(request, BACKEND_URL, TEST_USER.email, TEST_USER.password, {
      metresAcross: 30,
    });
    await layout.goto(other.marketId, other.upper.id);
    await expect(layout.typeRows).toHaveCount(1);
    await layout.typesUseSaved.click();
    await expect(layout.savedTypesDialog).toHaveAccessibleName('Use saved types');
    const choice = layout.savedTypesDialog.getByRole('radio', { name: new RegExp(`^${venue}`) });
    await choice.check();
    const written = page.waitForResponse(
      (response) =>
        response.url().includes('/table-types') && response.request().method() === 'PUT',
    );
    await layout.savedTypesSubmit.click();
    expect((await written).ok()).toBe(true);
    await expect(layout.savedTypesDialog).toBeHidden();
    await expect(layout.typesSaid).toHaveText(`Added 1 type from ${venue}.`);
    await expect(layout.typeRow('Square 4 ft')).toContainText('150 x 150 cm');
    expect((await storedPlan(request, other.marketId)).tableTypes.map((t) => t.name)).toEqual([
      'Standard 6 ft',
      'Square 4 ft',
    ]);
  });

  test('a no-table zone dragged and named "Stage" is drawn hatched with its name, stays after a reload, and a table dropped on it is pushed off it', async ({
    authenticatedPage: page,
    request,
  }) => {
    const seeded = await seedLayout(request, BACKEND_URL, TEST_USER.email, TEST_USER.password, {
      metresAcross: 30,
      tables: [{ section: 'sec-gold', at: [4000, 4000] }],
    });
    const layout = new LayoutPage(page);
    await layout.goto(seeded.marketId, seeded.upper.id);
    await expect(layout.tables).toHaveCount(1);
    await expect(layout.noZones).toBeVisible();

    await layout.toolZone.click();
    await expect(layout.toolZone).toHaveAttribute('aria-pressed', 'true');
    await layout.saved(() =>
      layout.drag([10_000, 8000], [16_000, 12_000], {
        hold: async () => expect(layout.zoneBox).toBeVisible(),
      }),
    );
    // The zone just drawn is named where it is listed.
    await expect(layout.zoneLabels.first()).toBeFocused();
    await expect(layout.announcement).toHaveText(/^Added a no-table zone 6\.\d m by 4\.\d m\./);
    await layout.saved(async () => {
      await page.keyboard.type('Stage');
      await page.keyboard.press('Enter');
    });
    const zone = layout.zone('No-table zone: Stage');
    await expect(zone).toBeVisible();
    await expect(zone.getByTestId('layout-map-zone-box')).toHaveAttribute('fill', /^url\(#/);
    await expect(zone.getByTestId('layout-map-zone-label')).toHaveText('Stage');

    await page.reload();
    await expect(layout.zone('No-table zone: Stage')).toBeVisible();
    await expect(layout.zoneLabels.first()).toHaveValue('Stage');
    let [stored] = (await storedPlan(request, seeded.marketId)).floorplans[0].zones;
    expect(stored.label).toBe('Stage');
    expect(Math.abs(stored.xMm - 10_000)).toBeLessThan(A_PIXEL_MM);
    expect(Math.abs(stored.widthMm - 6000)).toBeLessThan(2 * A_PIXEL_MM);

    // Dragged onto the middle of the stage, the table is pushed to its nearest edge, off it.
    await layout.saved(() => layout.drag([4000, 4000], [13_000, 9_000]));
    const [table] = await storedLayoutTables(request, BACKEND_URL, seeded.marketId);
    [stored] = (await storedPlan(request, seeded.marketId)).floorplans[0].zones;
    const corners = tableCorners(table, SIX_FOOT);
    const stage = { left: stored.xMm, top: stored.yMm };
    const overStage = corners.some(
      (corner) =>
        corner.xMm > stage.left + 0.1 &&
        corner.xMm < stage.left + stored.widthMm - 0.1 &&
        corner.yMm > stage.top + 0.1 &&
        corner.yMm < stage.top + stored.depthMm - 0.1,
    );
    expect(overStage).toBe(false);
    // The nearest way off from 1 m inside its top edge is up, just past that edge.
    expect(Math.abs(table.yMm + 380 - stored.yMm)).toBeLessThan(1);
    expect(Math.abs(table.xMm - 13_000)).toBeLessThan(A_PIXEL_MM);

    // Removed, from its row, and the table may stand there again.
    await layout.saved(() =>
      layout.zonesCard.getByRole('button', { name: 'Remove Stage', exact: true }).click(),
    );
    await expect(layout.zones).toHaveCount(0);
    await expect(layout.announcement).toHaveText('Removed the no-table zone Stage');
  });

  test('"Show the floorplan" hides and shows the image; a replaced image keeps every table where it was in metres and its old file is deleted', async ({
    authenticatedPage: page,
    request,
  }) => {
    const seeded = await seedLayout(request, BACKEND_URL, TEST_USER.email, TEST_USER.password, {
      metresAcross: 30,
      tables: seedRow('sec-gold', [3000, 4000], 4),
    });
    const layout = new LayoutPage(page);
    await layout.goto(seeded.marketId, seeded.upper.id);
    await expect(layout.mapImage).toBeVisible();
    await layout.showImage.uncheck();
    await expect(layout.mapImage).toHaveCount(0);
    await layout.showImage.check();
    await expect(layout.mapImage).toBeVisible();

    const before = (await storedPlan(request, seeded.marketId)).floorplans[0];
    // Given up after its upload, the new image is deleted and the layout keeps the old one.
    await layout.replaceImage.click();
    await expect(layout.editor).toHaveCount(0);
    await layout.replaceCancel.click();
    await expect(layout.stage).toBeVisible();

    // Refused as it is taken, the layout stays on its old image and says why; given up then, the
    // new image is deleted and nothing is left unsaved.
    await layout.replaceImage.click();
    const refusedUpload = page.waitForResponse((r) => r.url().includes('/floorplans/upload'));
    await layout.uploadFileInput.setInputFiles(LAYOUT_FLOORPLAN_PATH);
    const { gridfs_id: refusedImage } = (await (await refusedUpload).json()) as {
      gridfs_id: string;
    };
    await expect(layout.calibration).toBeVisible();
    await page.route('**/floorplans/save-to-market', (route) =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Every table must stand inside the floorplan.' }),
      }),
    );
    await layout.setScale.click();
    await expect(page.getByTestId('layout-replace-error')).toHaveText(
      'Every table must stand inside the floorplan.',
    );
    await expect(layout.calibration).toBeVisible();
    await page.unroute('**/floorplans/save-to-market');
    await layout.calibrationCancel.click();
    await expect(layout.stage).toBeVisible();
    await expect(layout.saveState).toHaveText('Saved');
    await expect(layout.mapImage).toHaveAttribute('href', /^blob:/);
    await expect
      .poll(async () => (await request.get(`${BACKEND_URL}/floorplans/${refusedImage}`)).status())
      .toBe(404);
    expect((await storedPlan(request, seeded.marketId)).floorplans[0].imageGridfsId).toBe(
      before.imageGridfsId,
    );

    await layout.replaceImage.click();
    await layout.uploadFileInput.setInputFiles(LAYOUT_FLOORPLAN_PATH);
    await expect(layout.calibration).toBeVisible();
    // The old line, on the new image: "Set the scale" alone keeps the hall 30 m across.
    await expect(layout.length).toHaveValue('30');
    await expect(layout.calibrationCancel).toHaveText('Keep the current image');
    await layout.saved(() => layout.setScale.click());
    await expect(layout.stage).toBeVisible();
    await expect(layout.scale).toHaveText('30.0 m across');

    const after = (await storedPlan(request, seeded.marketId)).floorplans[0];
    expect(after.imageGridfsId).not.toBe(before.imageGridfsId);
    expect(after.tables.map(({ id, xMm, yMm }) => [id, xMm, yMm])).toEqual(
      before.tables.map(({ id, xMm, yMm }) => [id, xMm, yMm]),
    );
    const old = await request.get(`${BACKEND_URL}/floorplans/${before.imageGridfsId}`);
    expect(old.status()).toBe(404);
    const current = await request.get(`${BACKEND_URL}/floorplans/${after.imageGridfsId}`);
    expect(current.ok()).toBe(true);
  });
});
