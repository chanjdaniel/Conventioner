import type { Page } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { LayoutPage } from './pages/LayoutPage';
import { LoginPage } from './pages/LoginPage';
import { grantMarketRole } from './helpers/grantMarketRole';
import {
  seedLayout,
  seedSettledLayout,
  UPPER_HALL_TABLES,
  UPPER_HALL_ZONES,
  type SeededLayout,
} from './helpers/seeds';
import { ensureVerifiedUser } from './helpers/verifiedUser';

/**
 * Export PNG (T257 ticket 13): a location's layout saved as a PNG 3200 px wide, named for the
 * market and the location, drawn by the browser: the market's name in Merge One and the location in
 * Outfit over the map, the venue's floorplan under the tables only when asked, the tables' numbers
 * unless asked not to. A Viewer and an archived market's organizer export too.
 *
 * The PNG is read in the page, on a canvas: its size, a pixel, and how wide the ink of a line of
 * its head is, which is the width of the words in the family they were drawn in (and not in a
 * fallback, which is tens of pixels off).
 */
const VIEWER = { email: 'e2e-layout-viewer@example.com', password: 'e2epassword123' };

/** The PNG's page as `exportLayoutPng.ts` lays it out, in the PNG's pixels (twice the SVG's). */
const SCALE = 2;
const MARGIN = 56 * SCALE;
const MAP_TOP = (56 + 64 + 32) * SCALE;
const MAP_WIDTH = 1488 * SCALE;
/** Upper Hall is 30 m across. */
const PX_PER_MM = MAP_WIDTH / 30_000;
const at = ([xMm, yMm]: [number, number]) => ({
  x: Math.round(MARGIN + xMm * PX_PER_MM),
  y: Math.round(MAP_TOP + yMm * PX_PER_MM),
});

/** A box of the PNG, in its pixels. */
interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface ReadPng {
  width: number;
  height: number;
  /** Each asked point's colour, `[r, g, b]`. */
  points: [number, number, number][];
  /** Each asked box's ink: how wide the dark pixels in it spread, 0 for none. */
  ink: number[];
}

/** The PNG read on a canvas in the page. */
async function readPng(
  page: Page,
  png: Buffer,
  ask: { points: { x: number; y: number }[]; boxes: Box[] },
): Promise<ReadPng> {
  return page.evaluate(
    async ({ base64, points, boxes }) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(bitmap, 0, 0);
      const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
      const rgb = (x: number, y: number): [number, number, number] => {
        const i = (y * bitmap.width + x) * 4;
        return [data[i], data[i + 1], data[i + 2]];
      };
      const dark = (x: number, y: number) => {
        const [r, g, b] = rgb(x, y);
        return 0.299 * r + 0.587 * g + 0.114 * b < 160;
      };
      const ink = boxes.map((box) => {
        let left = Infinity;
        let right = -Infinity;
        for (let y = box.top; y < box.bottom; y++)
          for (let x = box.left; x < box.right; x++)
            if (dark(x, y)) {
              left = Math.min(left, x);
              right = Math.max(right, x);
            }
        return right >= left ? right - left + 1 : 0;
      });
      return {
        width: bitmap.width,
        height: bitmap.height,
        points: points.map(({ x, y }) => rgb(x, y)),
        ink,
      };
    },
    { base64: png.toString('base64'), ...ask },
  );
}

/** How wide words are drawn in the page in a font, by their ink's box. */
async function inkWidth(page: Page, text: string, font: string): Promise<number> {
  return page.evaluate(
    async ({ text, font }) => {
      await document.fonts.load(font);
      const context = document.createElement('canvas').getContext('2d')!;
      context.font = font;
      const box = context.measureText(text);
      return box.actualBoundingBoxLeft + box.actualBoundingBoxRight;
    },
    { text, font },
  );
}

async function openTheLayout(page: Page, seeded: SeededLayout): Promise<LayoutPage> {
  const layout = new LayoutPage(page);
  await layout.goto(seeded.marketId, seeded.upper.id);
  await expect(layout.map).toBeVisible();
  return layout;
}

/** The download's name: the market's slug, the location's, and "layout". */
const nameOf = (seeded: SeededLayout) =>
  `${seeded.marketName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-upper-hall-layout.png`;

test.describe('A layout exports as a PNG', () => {
  test('3200 px wide, named for the market and the location, with and without the floorplan', async ({
    authenticatedPage: page,
    request,
  }) => {
    const seeded = await seedLayout(request, BACKEND_URL, TEST_USER.email, TEST_USER.password, {
      metresAcross: 30,
      tables: UPPER_HALL_TABLES,
      zones: UPPER_HALL_ZONES,
    });
    const layout = await openTheLayout(page, seeded);

    // The dialog's choices as it opens: the floor alone, the tables numbered.
    await layout.exportOpen.click();
    await expect(layout.exportDialog).toBeVisible();
    await expect(layout.exportImage).not.toBeChecked();
    await expect(layout.exportNumbers).toBeChecked();
    await layout.exportCancel.click();
    await expect(layout.exportDialog).toBeHidden();

    // The floorplan's line down the middle of the hall, between 3.75 m and 18.75 m down it, where
    // no table or zone stands; Gold row 10, the first of the four along the top, and its number.
    const line = at([15_000 + 15, 7000]);
    const gold10 = at([3500, 1200]);
    const numberBox = {
      left: gold10.x - 40,
      top: gold10.y - 20,
      right: gold10.x + 40,
      bottom: gold10.y + 20,
    };
    const head = { top: MARGIN, bottom: MARGIN + 60 * SCALE };
    const nameBox = { left: 0, right: 800 * SCALE, ...head };
    const placeBox = {
      left: 800 * SCALE,
      right: 1600 * SCALE,
      top: MARGIN,
      bottom: MARGIN + 30 * SCALE,
    };

    const plain = await layout.exportPng({ image: false, numbers: true });
    expect(plain.name).toBe(nameOf(seeded));
    const read = await readPng(page, plain.png, {
      points: [line],
      boxes: [numberBox, nameBox, placeBox],
    });
    expect(read.width).toBe(3200);
    // The head, the map at the hall's shape (30 m by 22.5 m) and the legend under it.
    expect(read.height).toBeGreaterThan(MAP_TOP + (MAP_WIDTH * 22.5) / 30);
    // No floorplan: the floor, light, where the image draws its line.
    expect(Math.min(...read.points[0])).toBeGreaterThan(200);
    // Gold row 10 carries its number.
    expect(read.ink[0]).toBeGreaterThan(10);

    // The head's words in the app's families: the market's name in Merge One, as wide as the page
    // draws it in Merge One and not in a fallback, which is a long way off (170 px on Linux). The
    // image places its glyphs a little apart from the canvas that measures them, up to 6 px over
    // the name's random digits, so the name is held within 12 px and the fallback must be further.
    // The location is held as wide as Outfit draws it. A fallback sans draws "Upper Hall" within a few pixels
    // of Outfit, so that line alone cannot tell them apart: the unit test of the embedding names
    // both families (`theLayoutExportsAPng.test.ts`).
    const merge = await inkWidth(page, seeded.marketName, `400 ${44 * SCALE}px 'Merge One'`);
    const serif = await inkWidth(page, seeded.marketName, `400 ${44 * SCALE}px serif`);
    expect(Math.abs(merge - serif)).toBeGreaterThan(40);
    expect(Math.abs(read.ink[1] - merge)).toBeLessThanOrEqual(12);
    const outfit = await inkWidth(page, 'Upper Hall', `600 ${22 * SCALE}px Outfit`);
    expect(Math.abs(read.ink[2] - outfit)).toBeLessThanOrEqual(3);

    // With the floorplan, its line is under the tables; with no numbers, Gold row 10 carries none.
    const withImage = await layout.exportPng({ image: true, numbers: false });
    expect(withImage.name).toBe(nameOf(seeded));
    const imaged = await readPng(page, withImage.png, { points: [line], boxes: [numberBox] });
    expect(imaged.width).toBe(3200);
    expect(imaged.height).toBe(read.height);
    expect(Math.max(...imaged.points[0])).toBeLessThan(120);
    expect(imaged.ink[0]).toBe(0);
  });

  test('a Viewer exports too', async ({ page, request }) => {
    ensureVerifiedUser(VIEWER.email, VIEWER.password);
    const seeded = await seedLayout(request, BACKEND_URL, TEST_USER.email, TEST_USER.password, {
      metresAcross: 30,
      tables: UPPER_HALL_TABLES,
    });
    await grantMarketRole(request, seeded.marketId, VIEWER, 'viewer');

    const login = new LoginPage(page);
    await login.login(VIEWER.email, VIEWER.password);
    await login.waitForMarkets();
    const layout = await openTheLayout(page, seeded);
    await expect(layout.toolbar).toHaveCount(0);
    const saved = await layout.exportPng({ image: true, numbers: true });
    expect(saved.name).toBe(nameOf(seeded));
    expect((await readPng(page, saved.png, { points: [], boxes: [] })).width).toBe(3200);
  });

  test("an archived market's organizer exports too", async ({
    authenticatedPage: page,
    request,
  }) => {
    const seeded = await seedSettledLayout(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
      'archived',
    );
    const layout = await openTheLayout(page, seeded);
    await expect(page.getByTestId('phase-rail-frozen')).toContainText('archived');
    const saved = await layout.exportPng({ image: false, numbers: true });
    expect(saved.name).toBe(nameOf(seeded));
    expect((await readPng(page, saved.png, { points: [], boxes: [] })).width).toBe(3200);
  });
});
