import type { Locator } from '@playwright/test';
import { test, expect } from './fixtures';
import { eachWindow, expectLaidOut, openEntry } from './helpers/componentLibrary';
import { inTheWindow } from './helpers/phoneWindow';

/**
 * The component library's `layout-map` entry (T257): `LayoutMap` on a fixture hall of four
 * sections and 49 tables, at a desk and on a phone. Read mode names the map and its tables and
 * reads out a press; edit mode outlines the selection and draws a guide; print is a picture with
 * no stop; at 10% and at 800% an edge and a name hold their size on the screen, and a number holds
 * its size or is left out; nine sections wrap the palette; and 400 tables pan.
 */

const readOutsOf = (map: Locator): Locator => map.locator('xpath=..').getByTestId('read-out');

/** The edge drawn round a table's top: how much wider its box on the screen is than the top
 *  itself, whose corners the drawing's own matrix places. */
async function edgeOf(table: Locator): Promise<number> {
  const top = table.getByTestId('layout-table-top');
  const across = await top.evaluate((rect) => {
    const matrix = (rect as SVGRectElement).getScreenCTM()!;
    const { width, height } = rect as SVGRectElement;
    return Math.abs(matrix.a * width.baseVal.value) + Math.abs(matrix.c * height.baseVal.value);
  });
  return (await top.boundingBox())!.width - across;
}

const numberHeight = (table: Locator) =>
  table.getByTestId('layout-table-number').evaluate((number) => {
    const size = parseFloat(number.getAttribute('font-size')!);
    return size * (number as SVGTextElement).getScreenCTM()!.a;
  });

eachWindow('the layout map entry', (size) => {
  test.beforeEach(async ({ page }) => {
    await openEntry(page, 'layout-map');
  });

  test('names what it serves, ends with its choices, and is laid out', async ({
    page,
    expectAccessible,
  }) => {
    await expect(page.getByTestId('library-serves')).toContainText("A location's layout page");
    await expect(page.getByTestId('choices-for-you').getByRole('listitem')).toHaveCount(6);
    await expect(page.getByTestId('library-map-read').getByTestId('layout-table')).toHaveCount(49);

    await expectLaidOut(page, size, 'the layout map entry');
    await expectAccessible('the layout map entry');
  });

  test('read: the map and its tables are named, and a press is read out', async ({ page }) => {
    const { press } = inTheWindow(size);
    const frame = page.getByTestId('library-map-read');
    const map = frame.getByTestId('layout-map');
    await expect(map).toHaveAccessibleName('Upper Hall layout, 49 tables');
    await expect(map).toHaveRole('group');
    await expect(map.getByRole('button')).toHaveCount(49);
    await expect(frame.getByTestId('layout-map-label')).toHaveText([
      'Gold row',
      'Silver aisle',
      'Bronze row',
      'Food court',
    ]);
    await expect(readOutsOf(frame).first()).toHaveText('Pressed: nothing');

    await press(map.getByRole('button', { name: 'Bronze row 11, Standard 6 ft' }));
    await expect(readOutsOf(frame).first()).toHaveText('Pressed: Bronze row 11, Standard 6 ft');
  });

  test('edit outlines the selection and draws the guide; print is a picture', async ({ page }) => {
    const edit = page.getByTestId('library-map-edit');
    await expect(edit.getByTestId('layout-table-selected')).toHaveCount(3);
    await expect(edit.getByTestId('layout-map-guide')).toHaveCount(1);
    await expect(readOutsOf(edit)).toHaveText(
      'Selected: Silver aisle 4, Standard 6 ft, Silver aisle 5, Standard 6 ft, Silver aisle 6, Standard 6 ft',
    );

    const print = page.getByTestId('library-map-print');
    await expect(print.getByTestId('layout-map')).toHaveRole('img');
    await expect(print.getByRole('button')).toHaveCount(0);
    await expect(print.locator('[tabindex]')).toHaveCount(0);
    await expect(print.getByTestId('layout-map-image')).toHaveCount(0);
    await expect(print.getByTestId('layout-table')).toHaveCount(49);
  });

  test('at 10% and at 800% the edges, names and numbers hold their size', async ({ page }) => {
    const { press } = inTheWindow(size);
    const frame = page.getByTestId('library-map-read');
    const table = frame.getByRole('button', { name: 'Silver aisle 5, Standard 6 ft' });
    const pill = frame.getByTestId('layout-map-label').first().getByTestId('layout-map-label-pill');
    const pillHeight = async () => (await pill.boundingBox())!.height;

    await press(page.getByTestId('library-map-zoom-100'));
    await expect(readOutsOf(frame).nth(1)).toHaveText('Zoom: 100%');
    // A 6 ft table at 1 px to 25 mm.
    const top = (await table.getByTestId('layout-table-top').boundingBox())!;
    expect(top.width).toBeCloseTo(1830 * 0.04 + 1.5, 0);
    expect(await edgeOf(table)).toBeCloseTo(1.5, 0);
    expect(await numberHeight(table)).toBeCloseTo(14, 1);

    await press(page.getByTestId('library-map-zoom-800'));
    await expect(readOutsOf(frame).nth(1)).toHaveText('Zoom: 800%');
    expect(await edgeOf(table)).toBeCloseTo(1.5, 0);
    expect(await numberHeight(table)).toBeCloseTo(14, 1);

    await press(page.getByTestId('library-map-zoom-10'));
    await expect(readOutsOf(frame).nth(1)).toHaveText('Zoom: 10%');
    expect(await edgeOf(table)).toBeCloseTo(1.5, 0);
    // A table 7 px wide carries no number; the names stay, at their size.
    await expect(frame.getByTestId('layout-table-number')).toHaveCount(0);
    await expect(frame.getByTestId('layout-table')).toHaveCount(49);
    expect(await pillHeight()).toBeCloseTo(22 + 1.5, 0);

    await press(page.getByTestId('library-map-zoom-Fit'));
    expect(await pillHeight()).toBeCloseTo(22 + 1.5, 0);
  });

  test('nine sections take the eight colours and the first again', async ({ page }) => {
    const frame = page.getByTestId('library-map-nine');
    await expect(readOutsOf(frame)).toHaveText(
      'Colours: Row 1: 1, Row 2: 2, Row 3: 3, Row 4: 4, Row 5: 5, Row 6: 6, Row 7: 7, Row 8: 8, Row 9: 1',
    );
    const fillOf = (name: string) =>
      frame
        .getByRole('button', { name, exact: true })
        .getByTestId('layout-table-top')
        .evaluate((top) => getComputedStyle(top).fill);
    expect(await fillOf('Row 9 1, Standard 6 ft')).toBe(await fillOf('Row 1 1, Standard 6 ft'));
    expect(await fillOf('Row 8 1, Standard 6 ft')).toBe('rgb(232, 235, 208)');
    await expect(
      frame.getByRole('button', { name: 'Table in no section, Square 4 ft' }),
    ).toHaveCount(2);
  });

  test('400 tables pan, and the frames drawn are read out', async ({ page }) => {
    const { press } = inTheWindow(size);
    const frame = page.getByTestId('library-map-big');
    await expect(frame.getByTestId('layout-table')).toHaveCount(400);
    await press(page.getByTestId('library-map-pan'));
    await expect(readOutsOf(frame)).toHaveText(
      /^Panned: \d+ frames a second over 400 tables, the slowest frame \d+ ms$/,
      { timeout: 15_000 },
    );
    // Panned to the east wall at 100%: the last table of a row is in the box, the first is not.
    const box = (await frame.boundingBox())!;
    const first = (await frame
      .getByRole('button', { name: 'Block 1 1, Standard 6 ft' })
      .boundingBox())!;
    expect(first.x + first.width).toBeLessThan(box.x);
  });
});
