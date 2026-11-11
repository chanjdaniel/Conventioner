import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { LayoutPage } from './pages/LayoutPage';
import { seedLayout, storedLayoutTables, type SeedTable, type SeededLayout } from './helpers/seeds';

/**
 * A layout is edited by keyboard, and heard (T257 ticket 06), on Upper Hall, 30 m by 22.5 m: Tab
 * reaches the map once, the arrow keys move between its tables, Enter picks one up, the arrow keys
 * move it and R turns it, Enter drops it and Escape puts it back; the shortcuts remove, duplicate
 * and select; Add table places by Enter; and a polite live region says what each key did. Every
 * key is pressed on the page as a person presses it, and what it did is read from the live
 * region, the focus and the layout the server stored, never from the page's state.
 */
const GOLD_1 = 'Gold row 1, Standard 6 ft';
const GOLD_2 = 'Gold row 2, Standard 6 ft';
const GOLD_3 = 'Gold row 3, Standard 6 ft';
const SILVER_1 = 'Silver aisle 1, Standard 6 ft';
const LOOSE = 'Table in no section, Standard 6 ft';

/** Gold row's three tables along the top, Silver aisle's one under the middle of them, and one
 *  table in no section, far off. */
const HALL: SeedTable[] = [
  { section: 'sec-gold', at: [5000, 5000] },
  { section: 'sec-gold', at: [9000, 5000] },
  { section: 'sec-gold', at: [13_000, 5000] },
  { section: 'sec-silver', at: [9000, 8000] },
  { section: null, at: [20_000, 15_000] },
];

/** Upper Hall's tables as the server holds them, each by its section and number. */
async function stored(request: APIRequestContext, marketId: string) {
  const tables = await storedLayoutTables(request, BACKEND_URL, marketId);
  return tables.map((table) => ({
    code: `${table.sectionId ?? 'none'} ${table.number ?? '-'}`,
    at: [table.xMm, table.yMm, table.rotation],
  }));
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

/** Whether a table is drawn whole inside the stage, as the view shows it. */
async function inView(layout: LayoutPage, name: string): Promise<boolean> {
  const stage = (await layout.stage.boundingBox())!;
  const top = (await layout.tableTop(name).boundingBox())!;
  return (
    top.x >= stage.x &&
    top.y >= stage.y &&
    top.x + top.width <= stage.x + stage.width &&
    top.y + top.height <= stage.y + stage.height
  );
}

test.describe('A table moves by keyboard', () => {
  test('one Tab from the toolbar lands on the map, the arrow keys move between its tables, and the last one that way keeps the focus', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { layout } = await open(page, request, HALL);

    // The toolbar is one stop, its buttons reached by the arrow keys.
    await layout.toolSelect.focus();
    await page.keyboard.press('ArrowRight');
    await expect(layout.toolAdd).toBeFocused();
    await page.keyboard.press('End');
    await expect(layout.fit).toBeFocused();
    await page.keyboard.press('Home');
    await expect(layout.toolSelect).toBeFocused();

    // One Tab lands on the map, on its first table, and the map says its keys.
    await page.keyboard.press('Tab');
    await expect(layout.table(GOLD_1)).toBeFocused();
    await expect(layout.tableFocusBorder(GOLD_1)).toBeVisible();
    await expect(layout.map).toHaveAccessibleName('Upper Hall layout, 5 tables');
    await expect(layout.map).toHaveAccessibleDescription(/Enter picks a table up/);
    await expect(layout.hint).toContainText('The arrow keys move between tables.');

    // Along Gold row, down to Silver aisle from its middle, and back.
    await page.keyboard.press('ArrowRight');
    await expect(layout.table(GOLD_2)).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(layout.table(SILVER_1)).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(layout.table(GOLD_2)).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(layout.table(GOLD_1)).toBeFocused();

    // No table stands left of the first or above it: the focus stays, and nothing is said.
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowUp');
    await expect(layout.table(GOLD_1)).toBeFocused();
    await expect(layout.announcement).toHaveText('');

    // Another Tab leaves the map, for the panel.
    await page.keyboard.press('Tab');
    await expect(layout.sectionColour('Gold row')).toBeFocused();

    // With a table selected that never had the focus, the map's stop is the selected one.
    await page.reload();
    await expect(layout.tables).toHaveCount(HALL.length);
    await layout.selectNoSection.press('Enter');
    await expect(layout.selectionTitle).toHaveText('Table in no section');
    await layout.tabToTheMap();
    await expect(layout.table(LOOSE)).toBeFocused();
  });

  test('Enter picks a table up, the arrow keys move it 10 cm and 1 m with Shift, R turns it, and Enter drops it as one change', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { layout, seeded } = await open(page, request, HALL);

    await layout.tabToTheMap();
    await expect(layout.table(GOLD_1)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(layout.announcement).toHaveText(
      'Gold row 1 picked up: the arrow keys move it, R turns it, Enter drops it, Escape puts it back',
    );
    // Picked up, it is selected, drawn lifted, and the hint says its keys.
    await expect(layout.table(GOLD_1)).toHaveAttribute('aria-pressed', 'true');
    await expect(layout.table(GOLD_1)).toHaveAttribute('data-carried', '');
    await expect(layout.table(GOLD_1).getByTestId('layout-table-shadow')).toBeVisible();
    await expect(layout.hint).toHaveText(
      'Picked up: the arrow keys move it 10 cm, or 1 m with Shift. ' +
        'R turns it, Enter drops it and Escape puts it back.',
    );

    await page.keyboard.press('ArrowRight');
    await expect(layout.announcement).toHaveText('Gold row 1 moved to 5.1 m, 5.0 m');
    await page.keyboard.press('Shift+ArrowDown');
    await expect(layout.announcement).toHaveText('Gold row 1 moved to 5.1 m, 6.0 m');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await expect(layout.announcement).toHaveText('Gold row 1 moved to 5.1 m, 5.8 m');
    await page.keyboard.press('r');
    await expect(layout.announcement).toHaveText('Gold row 1 turned to 90°');
    await page.keyboard.press('Shift+R');
    await expect(layout.announcement).toHaveText('Gold row 1 turned to 105°');
    // The keys moved the table, not the focus, and nothing is undone or saved while it is in hand.
    await expect(layout.table(GOLD_1)).toBeFocused();
    await expect(layout.undo).toBeDisabled();
    await expect(layout.selectionPosition).toHaveText('5.1 m, 5.8 m');

    await layout.saved(async () => {
      await page.keyboard.press('Enter');
      await expect(layout.announcement).toHaveText('Gold row 1 dropped at 5.1 m, 5.8 m');
    });
    await expect(layout.table(GOLD_1)).not.toHaveAttribute('data-carried');
    await expect(layout.table(GOLD_1)).toBeFocused();
    expect((await stored(request, seeded.marketId))[0]).toEqual({
      code: 'sec-gold 1',
      at: [5100, 5800, 105],
    });

    // One change: one undo puts it back whole, and no other is left.
    await layout.saved(async () => {
      await page.keyboard.press('Control+z');
      await expect(layout.announcement).toHaveText('Undid the last change');
    });
    await expect(layout.undo).toBeDisabled();
    expect((await stored(request, seeded.marketId))[0].at).toEqual([5000, 5000, 0]);
  });

  test('R turns the selection only while the map has the keys, never from a control beside it', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { layout, seeded } = await open(page, request, HALL);
    await layout.table(GOLD_1).click();
    await expect(layout.table(GOLD_1)).toHaveAttribute('aria-pressed', 'true');

    await layout.backToSetup.focus();
    await page.keyboard.press('r');
    await layout.table(GOLD_1).focus();
    await layout.saved(async () => {
      await page.keyboard.press('r');
      await expect(layout.announcement).toHaveText('Gold row 1 turned to 90°');
    });

    // One turn: the R pressed on "Back to Market Setup" turned nothing.
    expect((await stored(request, seeded.marketId))[0].at).toEqual([5000, 5000, 90]);
  });

  test('Escape puts a picked-up table back where it was, a wall stops it, and nothing of it is saved', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { layout, seeded } = await open(page, request, [
      { section: 'sec-gold', at: [100, 5000] },
      { section: 'sec-gold', at: [9000, 5000] },
    ]);
    let saves = 0;
    page.on('request', (sent) => {
      if (sent.url().includes('/floorplans/save-to-market')) saves += 1;
    });

    await layout.tabToTheMap();
    // Space picks up as Enter does.
    await page.keyboard.press('Space');
    await expect(layout.announcement).toContainText('Gold row 1 picked up');
    await page.keyboard.press('ArrowLeft');
    await expect(layout.announcement).toHaveText('Gold row 1 moved to 0.0 m, 5.0 m');
    // Its centre never leaves the floorplan: the next press says so, and the one after says it again.
    await page.keyboard.press('ArrowLeft');
    await expect(layout.announcement).toHaveText('At the edge of the floorplan');
    await page.keyboard.press('ArrowLeft');
    await expect(layout.announcement).toHaveText('At the edge of the floorplan');
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('r');
    await expect(layout.table(GOLD_1)).toHaveAttribute('transform', 'translate(0 6000) rotate(90)');

    await page.keyboard.press('Escape');
    await expect(layout.announcement).toHaveText('Gold row 1 put back at 0.1 m, 5.0 m');
    await expect(layout.table(GOLD_1)).toHaveAttribute(
      'transform',
      'translate(100 5000) rotate(0)',
    );
    await expect(layout.table(GOLD_1)).not.toHaveAttribute('data-carried');
    // Put back, it is still selected and focused, and there is nothing to undo.
    await expect(layout.table(GOLD_1)).toBeFocused();
    await expect(layout.table(GOLD_1)).toHaveAttribute('aria-pressed', 'true');
    await expect(layout.undo).toBeDisabled();

    // Picked up and dropped where it stands is no change either.
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Enter');
    await expect(layout.announcement).toHaveText('Gold row 1 dropped at 0.1 m, 5.0 m');
    await expect(layout.undo).toBeDisabled();

    // The first save is the next real move's, and it holds that move alone.
    await page.keyboard.press('ArrowRight');
    await expect(layout.table(GOLD_2)).toBeFocused();
    await layout.saved(async () => {
      await page.keyboard.press('Enter');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
    });
    expect(saves).toBe(1);
    expect(await stored(request, seeded.marketId)).toEqual([
      { code: 'sec-gold 1', at: [100, 5000, 0] },
      { code: 'sec-gold 2', at: [9000, 5100, 0] },
    ]);
  });

  test('Shift+Enter gathers a selection, which is picked up, moved and turned together, and dropped when the focus leaves the map', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { layout, seeded } = await open(page, request, HALL);

    await layout.tabToTheMap();
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+Enter');
    await expect(layout.selectionTitle).toHaveText('2 tables selected');
    // Shift+Enter again takes a table out, and once more puts it back in.
    await page.keyboard.press('Shift+Enter');
    await expect(layout.selectionTitle).toHaveText('Gold row 1');
    await page.keyboard.press('Shift+Enter');
    await expect(layout.selectionTitle).toHaveText('2 tables selected');

    await page.keyboard.press('Enter');
    await expect(layout.announcement).toHaveText(
      '2 tables picked up: the arrow keys move them, R turns them, Enter drops them, Escape puts them back',
    );
    await expect(layout.map.locator('[data-carried]')).toHaveCount(2);
    await page.keyboard.press('Shift+ArrowDown');
    await expect(layout.announcement).toHaveText('2 tables moved, Gold row 2 to 9.0 m, 6.0 m');
    await page.keyboard.press('r');
    await expect(layout.announcement).toHaveText('2 tables turned by 90°');

    // Tab leaves the map: what was in hand stays where the keys left it, as one change.
    await layout.saved(async () => {
      await page.keyboard.press('Tab');
      await expect(layout.announcement).toHaveText('2 tables dropped, Gold row 2 at 7.0 m, 8.0 m');
    });
    await expect(layout.map.locator('[data-carried]')).toHaveCount(0);
    // Turned a quarter about the middle of the two, (7 m, 6 m), each on its own centre too.
    expect((await stored(request, seeded.marketId)).slice(0, 3)).toEqual([
      { code: 'sec-gold 1', at: [7000, 4000, 90] },
      { code: 'sec-gold 2', at: [7000, 8000, 90] },
      { code: 'sec-gold 3', at: [13_000, 5000, 0] },
    ]);
    await layout.saved(() => layout.undo.click());
    expect((await stored(request, seeded.marketId)).slice(0, 2)).toEqual([
      { code: 'sec-gold 1', at: [5000, 5000, 0] },
      { code: 'sec-gold 2', at: [9000, 5000, 0] },
    ]);
  });

  test('Space picks up with the pointer left over the map, and Enter under a pointer press picks nothing up', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { layout, seeded } = await open(page, request, HALL);

    // The pointer rests over the map; the focus comes by keyboard, so Space is the map's key.
    const floor = await layout.onScreen([20_000, 5000]);
    await page.mouse.move(floor.x, floor.y);
    await layout.tabToTheMap();
    await page.keyboard.press('Space');
    await expect(layout.announcement).toContainText('Gold row 1 picked up');
    await page.keyboard.press('Escape');

    // Enter while a table is pressed by the pointer picks nothing up: the drag that follows moves
    // the table to where it is let go, and no further.
    await layout.saved(() =>
      layout.drag([9000, 5000], [9000, 12_000], {
        hold: async () => {
          await page.keyboard.press('Enter');
          await expect(layout.map.locator('[data-carried]')).toHaveCount(0);
        },
      }),
    );
    const moved = (await stored(request, seeded.marketId))[1];
    expect(moved.code).toBe('sec-gold 2');
    expect(moved.at[0]).toBeCloseTo(9000, -2);
    expect(moved.at[1]).toBeCloseTo(12_000, -2);
    await expect(layout.announcement).toContainText('Gold row 2 moved to');
  });

  test('Delete removes, Ctrl+D duplicates, Ctrl+A selects every table and Escape none, each said, and the focus is never lost', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { layout, seeded } = await open(page, request, HALL);

    // With nothing selected, Delete removes the table the keys are on; the focus goes to the
    // nearest one left, and the section's later numbers close the gap.
    await layout.tabToTheMap();
    await page.keyboard.press('ArrowRight');
    await expect(layout.table(GOLD_2)).toBeFocused();
    await layout.saved(async () => {
      await page.keyboard.press('Delete');
      await expect(layout.announcement).toHaveText('Removed Gold row 2');
    });
    await expect(layout.tables).toHaveCount(4);
    // What was Gold row 3 is Gold row 2 now, at 13 m; Silver aisle 1 stood nearest the gap, 3 m
    // under it.
    await expect(layout.table(SILVER_1)).toBeFocused();

    // Ctrl+D copies the table the keys are on; the copy is selected and takes the focus.
    await layout.saved(async () => {
      await page.keyboard.press('Control+d');
      await expect(layout.announcement).toHaveText('Added Silver aisle 2');
    });
    await expect(layout.table('Silver aisle 2, Standard 6 ft')).toBeFocused();
    await expect(layout.selectionTitle).toHaveText('Silver aisle 2');

    // Backspace removes the selection, as Delete does.
    await layout.saved(async () => {
      await page.keyboard.press('Backspace');
      await expect(layout.announcement).toHaveText('Removed Silver aisle 2');
    });
    await expect(layout.table(SILVER_1)).toBeFocused();

    await page.keyboard.press('Control+a');
    await expect(layout.announcement).toHaveText('4 tables selected');
    await expect(layout.selectionTitle).toHaveText('4 tables selected');
    await page.keyboard.press('Escape');
    await expect(layout.announcement).toHaveText('Nothing selected');
    await expect(layout.selectionTitle).toHaveText('Selection');

    // Every table, removed at once and said as a count; the map itself then holds the focus.
    await page.keyboard.press('Control+a');
    await layout.saved(async () => {
      await page.keyboard.press('Delete');
      await expect(layout.announcement).toHaveText('Removed 4 tables');
    });
    await expect(layout.tables).toHaveCount(0);
    await expect(layout.map).toBeFocused();
    expect(await stored(request, seeded.marketId)).toEqual([]);

    // Undo and redo by their keys, each said; undone, the tables are back.
    await layout.saved(async () => {
      await page.keyboard.press('Control+z');
      await expect(layout.announcement).toHaveText('Undid the last change');
    });
    await expect(layout.tables).toHaveCount(4);
    await layout.saved(async () => {
      await page.keyboard.press('Control+Shift+z');
      await expect(layout.announcement).toHaveText('Redid the change');
    });
    await expect(layout.tables).toHaveCount(0);
    await layout.saved(() => page.keyboard.press('Control+z'));
    await layout.saved(async () => {
      await page.keyboard.press('Control+y');
      await expect(layout.announcement).toHaveText('Redid the change');
    });
    await expect(layout.tables).toHaveCount(0);
  });

  test('no shortcut fires while a field of the page has the focus', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { layout, seeded } = await open(page, request, HALL);
    const before = await stored(request, seeded.marketId);
    let saves = 0;
    page.on('request', (sent) => {
      if (sent.url().includes('/floorplans/save-to-market')) saves += 1;
    });

    // Gold row 1 selected, and the selection card's Section field focused.
    await layout.tabToTheMap();
    await page.keyboard.press('Shift+Enter');
    await expect(layout.selectionTitle).toHaveText('Gold row 1');
    await layout.selectionSection.focus();
    const zoom = await layout.zoom.textContent();
    for (const key of ['Delete', 'Backspace', 'Control+d', 'Control+a', 'r', 'Shift+R', '0']) {
      await page.keyboard.press(key);
    }
    for (const key of ['+', '-', 'Control+z', 'Control+y']) await page.keyboard.press(key);
    await expect(layout.selectionSection).toBeFocused();
    await expect(layout.tables).toHaveCount(HALL.length);
    await expect(layout.selectionTitle).toHaveText('Gold row 1');
    await expect(layout.table(GOLD_1)).toHaveAttribute(
      'transform',
      'translate(5000 5000) rotate(0)',
    );
    await expect(layout.zoom).toHaveText(zoom!);
    await expect(layout.announcement).toHaveText('');

    // Nor on a button of the panel, where Delete and Ctrl+A are not the map's.
    await layout.selectionTurn.focus();
    await page.keyboard.press('Delete');
    await page.keyboard.press('Control+d');
    await expect(layout.tables).toHaveCount(HALL.length);

    // The same keys on the map do fire: the next save holds one removal, and it is the first.
    await layout.tabToTheMap();
    await layout.saved(async () => {
      await page.keyboard.press('Delete');
      await expect(layout.announcement).toHaveText('Removed Gold row 1');
    });
    expect(saves).toBe(1);
    expect(await stored(request, seeded.marketId)).toHaveLength(before.length - 1);
  });

  test('+ and - zoom, 0 fits, and the view follows the table the keys are on', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { layout } = await open(page, request, HALL);
    const fitted = await layout.zoom.textContent();

    await layout.tabToTheMap();
    await expect(layout.table(GOLD_1)).toBeFocused();
    // Each + is the next round percentage up from the fitted one, to 300% within seven of them.
    for (
      let press = 0;
      press < 7 && (await layout.zoom.textContent()) !== 'Zoom 300%';
      press += 1
    ) {
      await page.keyboard.press('+');
    }
    await expect(layout.zoom).toHaveText('Zoom 300%');
    // Zoomed far in, the focused table is kept in view, and the one in no section is far out of it.
    expect(await inView(layout, GOLD_1)).toBe(true);
    expect(await inView(layout, LOOSE)).toBe(false);
    await page.keyboard.press('-');
    await expect(layout.zoom).toHaveText('Zoom 200%');

    // The arrow keys carry the view with the focus, table by table.
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(layout.table(GOLD_3)).toBeFocused();
    await expect.poll(() => inView(layout, GOLD_3)).toBe(true);
    await page.keyboard.press('ArrowDown');
    await expect(layout.table(LOOSE)).toBeFocused();
    await expect.poll(() => inView(layout, LOOSE)).toBe(true);

    // And with a table picked up and carried out of the view.
    await page.keyboard.press('Enter');
    for (let press = 0; press < 8; press += 1) await page.keyboard.press('Shift+ArrowRight');
    await expect(layout.announcement).toHaveText('Table in no section moved to 28.0 m, 15.0 m');
    await expect.poll(() => inView(layout, LOOSE)).toBe(true);
    await page.keyboard.press('Escape');

    await page.keyboard.press('0');
    await expect(layout.zoom).toHaveText(fitted!);
  });

  test('with Add table on, Enter places a table at the middle of the view, the next beside it, on a map with no table', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { layout, seeded } = await open(page, request, []);

    await layout.toolSelect.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await expect(layout.toolAdd).toHaveAttribute('aria-pressed', 'true');
    // Past the options strip's two fields, the map itself is the stop while it has no table.
    await layout.tabToTheMap();
    await expect(layout.map).toBeFocused();
    await expect(layout.hint).toHaveText(
      'Enter places a table at the middle of the view. The arrow keys move between tables.',
    );

    await layout.saved(async () => {
      await page.keyboard.press('Enter');
      await expect(layout.announcement).toHaveText('Added Gold row 1');
      // The new table takes the focus, and the next Enter places the next one under it.
      await expect(layout.table(GOLD_1)).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(layout.announcement).toHaveText('Added Gold row 2');
      await expect(layout.table(GOLD_2)).toBeFocused();
    });
    // The middle of the hall as it is fitted, and one table's depth and 300 mm under it.
    expect(await stored(request, seeded.marketId)).toEqual([
      { code: 'sec-gold 1', at: [15_000, 11_250, 0] },
      { code: 'sec-gold 2', at: [15_000, 12_310, 0] },
    ]);
  });

  test('the panel lists the keys under "Keyboard", opened by keyboard', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { layout } = await open(page, request, HALL);

    await expect(layout.keyboard.getByText('Put them back')).toBeHidden();
    await layout.keyboardSummary.focus();
    await page.keyboard.press('Enter');
    for (const line of [
      'Move to the nearest table that way',
      'Pick up the table, or the selection it is in',
      'Select the table, or take it out',
      'Move them 10 cm, or 1 m with Shift',
      'Turn them 90°, or 15° with Shift',
      'Drop them',
      'Put them back',
      'Remove it',
      'Duplicate it',
      'Select every table',
      'Select nothing',
      'With Add table on, place a table at the middle of the view',
      'Undo',
      'Redo',
      'Zoom in and out',
      'Fit the floorplan',
    ]) {
      await expect(layout.keyboard.getByText(line, { exact: true })).toBeVisible();
    }
  });
});
