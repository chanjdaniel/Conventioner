import type { Locator } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { LayoutPage } from './pages/LayoutPage';
import {
  seedLayout,
  UPPER_HALL_TABLES,
  UPPER_HALL_ZONES,
  type SeededLayout,
} from './helpers/seeds';

/**
 * A calibrated layout draws as a map (T257 ticket 03): the seeded Upper Hall, 30 m by 22.5 m, with
 * Gold row's 13 tables, Silver aisle's 6, one table in no section, a stage and a pillar. Each table
 * stands where the layout says, at its true size and turn, in its section's colour with its number;
 * the sections are named beside their tables and listed in the panel; the floorplan lies faded
 * under them; and the map is one Tab stop, its tables reached by the arrow keys.
 */
const HALL_MM = { width: 30_000, height: 22_500 };
const TABLE_MM = { width: 1830, depth: 760 };

/** Where the hall is drawn on the screen: whole in the map's box, centred. */
async function hallOnScreen(layout: LayoutPage) {
  const box = (await layout.map.boundingBox())!;
  const scale = Math.min(box.width / HALL_MM.width, box.height / HALL_MM.height);
  return {
    scale,
    left: box.x + (box.width - HALL_MM.width * scale) / 2,
    top: box.y + (box.height - HALL_MM.height * scale) / 2,
  };
}

/** A shape's box on the screen without the 1.5 px edge drawn half outside it. */
async function inside(shape: Locator, edge = 1.5) {
  const box = (await shape.boundingBox())!;
  return {
    x: box.x + edge / 2,
    y: box.y + edge / 2,
    width: box.width - edge,
    height: box.height - edge,
  };
}

const paintOf = (table: Locator) =>
  table.getByTestId('layout-table-top').evaluate((top) => {
    const style = getComputedStyle(top);
    return { fill: style.fill, stroke: style.stroke };
  });

test.describe('A calibrated layout draws as a map', () => {
  let seeded: SeededLayout;

  test.beforeEach(async ({ request }) => {
    seeded = await seedLayout(request, BACKEND_URL, TEST_USER.email, TEST_USER.password, {
      metresAcross: 30,
      tables: UPPER_HALL_TABLES,
      zones: UPPER_HALL_ZONES,
    });
  });

  test('each table stands where the layout says, at its size and turn, in its colour', async ({
    authenticatedPage: page,
  }) => {
    const layout = new LayoutPage(page);
    await layout.goto(seeded.marketId, seeded.upper.id);

    await expect(layout.map).toHaveAccessibleName('Upper Hall layout, 20 tables');
    await expect(layout.tables).toHaveCount(20);
    const hall = await hallOnScreen(layout);

    // Gold row 1 heads the west wall, turned a quarter: its box is its depth by its width.
    const first = layout.table('Gold row 1, Standard 6 ft');
    const firstBox = await inside(first.getByTestId('layout-table-top'));
    expect(firstBox.x + firstBox.width / 2).toBeCloseTo(hall.left + 1200 * hall.scale, 0);
    expect(firstBox.y + firstBox.height / 2).toBeCloseTo(hall.top + 4500 * hall.scale, 0);
    expect(firstBox.width).toBeCloseTo(TABLE_MM.depth * hall.scale, 0);
    expect(firstBox.height).toBeCloseTo(TABLE_MM.width * hall.scale, 0);

    // Gold row 10 starts the row along the top, not turned.
    const tenth = layout.table('Gold row 10, Standard 6 ft');
    const tenthBox = await inside(tenth.getByTestId('layout-table-top'));
    expect(tenthBox.x + tenthBox.width / 2).toBeCloseTo(hall.left + 3500 * hall.scale, 0);
    expect(tenthBox.y + tenthBox.height / 2).toBeCloseTo(hall.top + 1200 * hall.scale, 0);
    expect(tenthBox.width).toBeCloseTo(TABLE_MM.width * hall.scale, 0);
    expect(tenthBox.height).toBeCloseTo(TABLE_MM.depth * hall.scale, 0);
    await expect(tenth.getByTestId('layout-table-number')).toHaveText('10');

    // Each section in the palette's next colour, in the plan's order; no section, grey and no number.
    expect(await paintOf(first)).toEqual({
      fill: 'rgb(248, 231, 194)',
      stroke: 'rgb(169, 122, 27)',
    });
    expect(await paintOf(layout.table('Silver aisle 6, Standard 6 ft'))).toEqual({
      fill: 'rgb(220, 233, 238)',
      stroke: 'rgb(26, 111, 139)',
    });
    const loose = layout.table('Table in no section, Standard 6 ft');
    expect(await paintOf(loose)).toEqual({
      fill: 'rgb(231, 229, 226)',
      stroke: 'rgb(122, 118, 114)',
    });
    await expect(loose.getByTestId('layout-table-number')).toHaveCount(0);
    await expect(loose).toHaveAttribute('transform', 'translate(24000 18000) rotate(30)');
  });

  test('the sections are named beside their tables, and listed in the panel', async ({
    authenticatedPage: page,
  }) => {
    const layout = new LayoutPage(page);
    await layout.goto(seeded.marketId, seeded.upper.id);

    await expect(layout.sectionLabels).toHaveText(['Gold row', 'Silver aisle']);
    // A name covers no table.
    const tables = await layout.tables.evaluateAll((drawn) =>
      drawn.map((table) =>
        table.querySelector('[data-testid="layout-table-top"]')!.getBoundingClientRect().toJSON(),
      ),
    );
    for (const label of await layout.sectionLabels.all()) {
      const pill = await inside(label.getByTestId('layout-map-label-pill'));
      const covered = tables.filter(
        (table) =>
          pill.x < table.right &&
          table.left < pill.x + pill.width &&
          pill.y < table.bottom &&
          table.top < pill.y + pill.height,
      );
      expect(covered, `${await label.textContent()} covers a table`).toEqual([]);
      // 22 px tall at any size of hall.
      expect(pill.height).toBeCloseTo(22, 0);
    }

    await expect(layout.sections.getByRole('heading')).toHaveText('Sections in Upper Hall');
    const rows = layout.sections.getByTestId('layout-panel-section');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('Gold row');
    await expect(rows.nth(0)).toContainText('Gold tier');
    await expect(rows.nth(0)).toContainText('13 tables');
    await expect(rows.nth(1)).toContainText('Silver aisle');
    await expect(rows.nth(1)).toContainText('6 tables');
    await expect(rows.nth(0).getByTestId('layout-panel-section-swatch')).toHaveCSS(
      'background-color',
      'rgb(248, 231, 194)',
    );
  });

  test('the floorplan lies faded under the tables, and the zones are hatched', async ({
    authenticatedPage: page,
  }) => {
    const layout = new LayoutPage(page);
    await layout.goto(seeded.marketId, seeded.upper.id);

    const image = layout.mapImage;
    await expect(image).toHaveAttribute('href', /^blob:/);
    await expect(image).toHaveCSS('opacity', '0.5');
    await expect(image).toHaveCSS('filter', 'grayscale(1)');
    // The image is the hall, edge to edge.
    const hall = await hallOnScreen(layout);
    const imageBox = (await image.boundingBox())!;
    expect(imageBox.width).toBeCloseTo(HALL_MM.width * hall.scale, 0);
    expect(imageBox.height).toBeCloseTo(HALL_MM.height * hall.scale, 0);
    // Hiding it comes with the editor's panel; the page offers no such tick yet.
    await expect(page.getByRole('checkbox', { name: 'Show the floorplan' })).toHaveCount(0);

    await expect(layout.zones).toHaveCount(2);
    const stage = layout.zone('No-table zone: Stage');
    await expect(stage.getByTestId('layout-map-zone-label')).toHaveText('Stage');
    await expect(stage.getByTestId('layout-map-zone-box')).toHaveAttribute(
      'fill',
      /^url\(#layout-hatch-/,
    );
    const stageBox = await inside(stage.getByTestId('layout-map-zone-box'));
    expect(stageBox.x).toBeCloseTo(hall.left + 12_000 * hall.scale, 0);
    expect(stageBox.width).toBeCloseTo(8000 * hall.scale, 0);
  });

  test('the tables are drawn though the image cannot be had, and the page says so', async ({
    authenticatedPage: page,
  }) => {
    await page.route('**/floorplans/*', (route) =>
      route.request().method() === 'GET' ? route.abort() : route.continue(),
    );
    const layout = new LayoutPage(page);
    await layout.goto(seeded.marketId, seeded.upper.id);

    await expect(page.getByTestId('layout-image-failed')).toHaveText(
      "The floorplan's image could not be shown. Reload the page to try again.",
    );
    await expect(layout.tables).toHaveCount(20);
    await expect(layout.mapImage).toHaveCount(0);
    await expect(layout.sectionLabels).toHaveText(['Gold row', 'Silver aisle']);
  });

  test('Tab reaches the map once, and the arrow keys move between its tables', async ({
    authenticatedPage: page,
  }) => {
    const layout = new LayoutPage(page);
    await layout.goto(seeded.marketId, seeded.upper.id);
    await expect(layout.tables).toHaveCount(20);

    await layout.backToSetup.focus();
    await page.keyboard.press('Tab');
    await expect(layout.table('Gold row 1, Standard 6 ft')).toBeFocused();
    // The focused table draws its ring.
    await expect(layout.tableFocusBorder('Gold row 1, Standard 6 ft')).toBeVisible();

    // One stop: the next Tab leaves the map for the panel.
    await page.keyboard.press('Tab');
    await expect(layout.recalibrate).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(layout.table('Gold row 1, Standard 6 ft')).toBeFocused();

    // Down the west wall, then back up, and across to the row along the top.
    await page.keyboard.press('ArrowDown');
    await expect(layout.table('Gold row 2, Standard 6 ft')).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await expect(layout.table('Gold row 10, Standard 6 ft')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(layout.table('Gold row 11, Standard 6 ft')).toBeFocused();

    // The stop follows the focus: leaving and coming back lands where it was left.
    await page.keyboard.press('Tab');
    await expect(layout.recalibrate).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(layout.table('Gold row 11, Standard 6 ft')).toBeFocused();
  });

  test('the map fits a phone, the whole hall in it', async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const layout = new LayoutPage(page);
    await layout.goto(seeded.marketId, seeded.upper.id);
    await expect(layout.tables).toHaveCount(20);

    const box = (await layout.map.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    // The map's box is the floorplan's shape, so the hall fills it.
    expect(box.width / box.height).toBeCloseTo(HALL_MM.width / HALL_MM.height, 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
  });
});
