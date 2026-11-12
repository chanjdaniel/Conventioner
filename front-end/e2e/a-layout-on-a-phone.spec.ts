import type { CDPSession, Page } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { LayoutPage } from './pages/LayoutPage';
import { LoginPage } from './pages/LoginPage';
import { grantMarketRole } from './helpers/grantMarketRole';
import { PHONE_AND_DESK, inTheWindow } from './helpers/phoneWindow';
import {
  seedLayout,
  UPPER_HALL_TABLES,
  UPPER_HALL_ZONES,
  type SeededLayout,
} from './helpers/seeds';
import { ensureVerifiedUser } from './helpers/verifiedUser';

/**
 * Reading a layout, on a phone too (T257 ticket 12). At a phone's width the layout page reads
 * only: the whole hall fitted to the column, no tool and no card that edits, a pinch zooming the
 * map and never the page, one finger looking round it once zoomed, and a tap on a table reading
 * its code, its tier and its type under the map, above the sections and the hint saying so. At a
 * desk a Viewer reads the same card for the table pressed or focused.
 *
 * The seeded Upper Hall is 30 m by 22.5 m; Silver aisle's six tables run across its middle from
 * (10 m, 11 m), so Silver aisle 5's centre is 7.32 m along from there.
 */
const PHONE = PHONE_AND_DESK[0];
const HALL_MM = { width: 30_000, height: 22_500 };
const SILVER_5: [number, number] = [10_000 + 4 * 1830, 11_000];
const VIEWER = { email: 'e2e-layout-phone-viewer@example.com', password: 'e2epassword123' };

const aLaidOutMarket = (request: Parameters<typeof seedLayout>[0]) =>
  seedLayout(request, BACKEND_URL, TEST_USER.email, TEST_USER.password, {
    metresAcross: 30,
    tables: UPPER_HALL_TABLES,
    zones: UPPER_HALL_ZONES,
  });

async function openTheLayout(page: Page, seeded: SeededLayout): Promise<LayoutPage> {
  const layout = new LayoutPage(page);
  await layout.goto(seeded.marketId, seeded.upper.id);
  await expect(layout.tables).toHaveCount(UPPER_HALL_TABLES.length);
  await expect(layout.mapImage).toHaveAttribute('href', /^blob:/);
  return layout;
}

/** A point of the page, in its pixels, as a touch point of the screen. */
const touch = (x: number, y: number) => ({ x: Math.round(x), y: Math.round(y) });

/** One finger pressed, moved in steps and lifted, as a phone's touch screen sends it. */
async function dragByFinger(
  cdp: CDPSession,
  from: { x: number; y: number },
  by: { x: number; y: number },
) {
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [touch(from.x, from.y)],
  });
  for (let step = 1; step <= 10; step += 1) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [touch(from.x + (by.x * step) / 10, from.y + (by.y * step) / 10)],
    });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

test.describe('A layout on a phone', () => {
  test.use(PHONE.use);
  const phone = inTheWindow(PHONE);

  let seeded: SeededLayout;
  test.beforeEach(async ({ request }) => {
    seeded = await aLaidOutMarket(request);
  });

  test('fits the phone and reads only: the whole hall in the column, no tool, every target a thumb’s', async ({
    authenticatedPage: page,
  }) => {
    const layout = await openTheLayout(page, seeded);

    await phone.expectFits(page, 'The layout page');
    // The map is as wide as the column, at the floorplan's shape, the whole hall in it.
    const box = (await layout.map.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(16);
    expect(box.x + box.width).toBeLessThanOrEqual(390 - 16);
    expect(box.width / box.height).toBeCloseTo(HALL_MM.width / HALL_MM.height, 1);
    const view = await layout.view();
    expect(view.width).toBeCloseTo(HALL_MM.width, 0);
    expect(view.height).toBeCloseTo(HALL_MM.height, 0);
    // The frame stands as on every page that fits a phone, its rail inside the window.
    await phone.expectInside(page.getByTestId('phase-rail-current'), "The rail's phase");

    // Read only, though this organizer edits it at a desk.
    await expect(layout.toolbar).toHaveCount(0);
    await expect(layout.editor).toHaveCount(0);
    await expect(layout.selection).toHaveCount(0);
    await expect(layout.typesCard).toHaveCount(0);
    await expect(layout.zonesCard).toHaveCount(0);
    await expect(layout.saveState).toHaveCount(0);
    await expect(page.getByTestId('layout-panel-floorplan')).toHaveCount(0);
    await expect(layout.sections).toBeVisible();
    await expect(layout.tableReadEmpty).toHaveText('Tap a table to read it.');
    await expect(layout.phoneHint).toHaveText(
      'Pinch to zoom, drag to look around, tap a table to read it. The layout is edited at a desk.',
    );

    // Every control of the page a thumb's 44px each way: the map's tables aside, which are drawn
    // at their size in the hall and read by a tap within 12px of them.
    const small = await layout.root.evaluate((root) =>
      [...root.querySelectorAll<HTMLElement>('a[href],button,summary,input,select,[role=button]')]
        .filter((el) => !el.closest('svg') && el.getClientRects().length)
        .map((el) => ({
          what: el.textContent?.trim() || el.outerHTML.slice(0, 60),
          box: el.getBoundingClientRect(),
        }))
        .filter(({ box }) => box.width < 44 || box.height < 44)
        .map(({ what, box }) => `${what}: ${Math.round(box.width)}x${Math.round(box.height)}`),
    );
    expect(small).toEqual([]);
  });

  test('a pinch zooms the map, not the page; a drag looks round it; a tap reads a table', async ({
    authenticatedPage: page,
  }) => {
    const layout = await openTheLayout(page, seeded);
    const cdp = await page.context().newCDPSession(page);
    const box = (await layout.map.boundingBox())!;

    // Two fingers spread to 2.5 times apart about the map's middle.
    await cdp.send('Input.synthesizePinchGesture', {
      x: Math.round(box.x + box.width / 2),
      y: Math.round(box.y + box.height / 2),
      scaleFactor: 2.5,
      relativeSpeed: 400,
      gestureSourceType: 'touch',
    });
    await expect.poll(async () => (await layout.view()).width).toBeLessThan(HALL_MM.width / 2);
    const zoomed = await layout.view();
    // The hall's middle is still about the map's middle.
    expect(zoomed.x + zoomed.width / 2).toBeCloseTo(HALL_MM.width / 2, -3);
    // The page itself neither zoomed nor moved.
    expect(await page.evaluate(() => window.visualViewport?.scale)).toBe(1);
    await phone.expectFits(page, 'The pinched page');
    const scrolled = await page.evaluate(() => window.scrollY);

    // One finger drags the zoomed map 80 px to the left: the view moves 80 px of the hall right.
    const mmPerPx = zoomed.width / box.width;
    await dragByFinger(
      cdp,
      { x: box.x + box.width / 2, y: box.y + box.height / 2 },
      { x: -80, y: 0 },
    );
    await expect.poll(async () => (await layout.view()).x).toBeCloseTo(zoomed.x + 80 * mmPerPx, -1);
    expect((await layout.view()).width).toBeCloseTo(zoomed.width, 0);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrolled);
    // A drag reads nothing.
    await expect(layout.tableReadEmpty).toBeVisible();

    // A tap on Silver aisle 5, drawn larger now, reads it under the map.
    const at = await layout.onScreen(SILVER_5);
    await page.touchscreen.tap(at.x, at.y);
    await expect(layout.tableReadTitle).toHaveText('Silver aisle 5');
    await expect(layout.tableReadFacts).toHaveText('Silver tier · Standard 6 ft (183 x 76 cm)');
    // The map outlines the table read, and only it.
    const mark = layout.map.getByTestId('layout-map-read');
    await expect(mark).toHaveCount(1);
    const marked = (await mark.boundingBox())!;
    expect(marked.x + marked.width / 2).toBeCloseTo(at.x, 0);
    expect(marked.y + marked.height / 2).toBeCloseTo(at.y, 0);
    // The card stands under the map.
    const card = (await layout.tableRead.boundingBox())!;
    expect(card.y).toBeGreaterThan(box.y + box.height);
  });

  test('a tap on the whole hall reads the table it falls on, or just beside', async ({
    authenticatedPage: page,
  }) => {
    const layout = await openTheLayout(page, seeded);

    // Gold row 1 stands turned down the west wall, a few pixels wide on a phone: a tap 8 px off
    // its side still reads it.
    const gold1 = await layout.onScreen([1200, 4500]);
    await page.touchscreen.tap(gold1.x + 380 * gold1.scale + 8, gold1.y);
    await expect(layout.tableReadTitle).toHaveText('Gold row 1');
    await expect(layout.tableReadFacts).toHaveText('Gold tier · Standard 6 ft (183 x 76 cm)');

    // The table in no section says so.
    const loose = await layout.onScreen([24_000, 18_000]);
    await page.touchscreen.tap(loose.x, loose.y);
    await expect(layout.tableReadTitle).toHaveText('Table in no section');
    await expect(layout.tableReadFacts).toHaveText('Standard 6 ft (183 x 76 cm)');
  });
});

test.describe('A layout read at a desk', () => {
  test('a Viewer reads the table focused, then the one pressed', async ({ page, request }) => {
    ensureVerifiedUser(VIEWER.email, VIEWER.password);
    const seeded = await aLaidOutMarket(request);
    await grantMarketRole(request, seeded.marketId, VIEWER, 'viewer');
    const login = new LoginPage(page);
    await login.login(VIEWER.email, VIEWER.password);
    await login.waitForMarkets();

    const layout = await openTheLayout(page, seeded);
    await expect(page.getByTestId('market-read-only')).toBeVisible();
    await expect(layout.toolbar).toHaveCount(0);
    await expect(layout.tableReadEmpty).toHaveText(
      'Press a table, or move to it with the arrow keys, to read it.',
    );

    // Tab from the head reaches the map's one stop, Gold row 1, and the arrows move along the wall.
    await layout.backToSetup.focus();
    await page.keyboard.press('Tab');
    await expect(layout.table('Gold row 1, Standard 6 ft')).toBeFocused();
    await expect(layout.tableReadTitle).toHaveText('Gold row 1');
    await page.keyboard.press('ArrowDown');
    await expect(layout.table('Gold row 2, Standard 6 ft')).toBeFocused();
    await expect(layout.tableReadTitle).toHaveText('Gold row 2');
    await expect(layout.tableReadFacts).toHaveText('Gold tier · Standard 6 ft (183 x 76 cm)');

    // A press reads the table pressed.
    await layout.clickAt(SILVER_5);
    await expect(layout.tableReadTitle).toHaveText('Silver aisle 5');
    await expect(layout.tableReadFacts).toHaveText('Silver tier · Standard 6 ft (183 x 76 cm)');
  });
});
