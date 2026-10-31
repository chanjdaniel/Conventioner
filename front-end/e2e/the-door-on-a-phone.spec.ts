import type { Locator, Page } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { pinnedBottom, PINNED_MAX } from './helpers/layoutDetectors';
import { seedPublishedMarketWithAssignments } from './helpers/seeds';
import { AttendanceStatusPage } from './pages/AttendanceStatusPage';
import { MarketsPage } from './pages/MarketsPage';
import { TablesPage } from './pages/TablesPage';

/**
 * The door's journey, on the phone in an organizer's hand and at a desk (T142, T82 re-check note 8).
 *
 * An organizer finds the market on `/markets`, opens the door, checks a vendor in, reads the
 * vendor's drawer tab by tab and taps "Change assignment". On a phone that action led to the
 * Assignments page's 1000px desk floor, and under a phone's own emulation a page wider than the
 * window widens the layout viewport and zooms out, so the dialog it opened was off screen. The
 * door itself sat under a pinned frame that took half the window.
 */

const VENDOR = 'alice@example.com';
/** Enough vendors at the door that it scrolls, at a phone's height and a desk's. */
const VENDORS = [
  VENDOR,
  ...Array.from({ length: 19 }, (_, i) => `door-vendor-${i + 1}@example.com`),
];

const SIZES = [
  {
    name: 'on a phone',
    phone: true,
    use: {
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 3,
    },
  },
  { name: 'at a desk', phone: false, use: { viewport: { width: 1440, height: 900 } } },
] as const;

/** The window as the page lays itself out in it, and whether the page is wider than it. */
const widths = (page: Page) =>
  page.evaluate(() => ({
    layout: window.innerWidth,
    sideways: Math.max(
      0,
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
    zoom: window.visualViewport?.scale ?? 1,
  }));

/** px from the window's top to a box's top and bottom. */
async function edgesOf(locator: Locator): Promise<{ top: number; bottom: number }> {
  const box = await locator.boundingBox();
  expect(box, 'the box is drawn').not.toBeNull();
  return { top: Math.round(box!.y), bottom: Math.round(box!.y + box!.height) };
}

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use(size.use);
    const width = size.use.viewport.width;

    /** The page keeps the window's width: nothing scrolls sideways, nothing zooms out. */
    async function expectFits(page: Page, what: string): Promise<void> {
      expect(await widths(page), `${what} keeps the window's width`).toEqual({
        layout: width,
        sideways: 0,
        zoom: 1,
      });
    }

    /** A box wholly inside the window, across and down. */
    async function expectInside(locator: Locator, what: string): Promise<void> {
      const box = await locator.boundingBox();
      expect(box, `${what} is drawn`).not.toBeNull();
      const { height } = size.use.viewport;
      expect(box!.x, `${what} starts inside the window`).toBeGreaterThanOrEqual(0);
      expect(box!.y, `${what} starts inside the window`).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width, `${what} ends inside the window`).toBeLessThanOrEqual(width);
      expect(box!.y + box!.height, `${what} ends inside the window`).toBeLessThanOrEqual(height);
    }

    /** A tap on a phone, a click at a desk. */
    const press = (locator: Locator) => (size.phone ? locator.tap() : locator.click());

    test('from the markets list to a changed assignment', async ({
      authenticatedPage: page,
      request,
    }) => {
      const seed = await seedPublishedMarketWithAssignments(
        request,
        BACKEND_URL,
        TEST_USER.email,
        TEST_USER.password,
        { intakeMode: 'form', vendors: VENDORS },
      );

      // The market, found on /markets.
      const markets = new MarketsPage(page);
      await markets.goto();
      await markets.searchInput.fill(seed.marketName);
      await markets.expectNames([seed.marketName]);
      await expectFits(page, '/markets');
      await press(markets.card(seed.marketName).getByTestId('market-card-name'));

      // A market in market days opens on the door.
      const attendance = new AttendanceStatusPage(page);
      await page.waitForURL(/\/attendance$/);
      await expect(attendance.row(VENDOR)).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId('phase-rail-checkin')).toBeVisible();
      await expectFits(page, 'the door');
      if (size.phone) {
        // The door has the screen, on first paint: the list starts within the top 340px of 844.
        const door = page.locator('[data-testid="market-frame"] + *');
        expect((await edgesOf(door)).top, 'the door starts within 340px').toBeLessThanOrEqual(340);
      }

      // Scrolled, the bar stays under the banner: alone on a phone, with the whole rail at a desk.
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
      const banner = await edgesOf(page.locator('.app-container > header'));
      const bar = await edgesOf(page.getByTestId('market-bar'));
      const rail = await edgesOf(page.getByTestId('phase-rail'));
      const pinned = await page.evaluate(pinnedBottom);
      expect(bar.top, 'the bar stays under the banner').toBe(banner.bottom);
      if (size.phone) {
        expect(rail.bottom, 'the rail went with the page').toBeLessThanOrEqual(bar.top);
        expect(pinned.bottom, `pinned to the bottom of ${pinned.el}`).toBe(bar.bottom);
        expect(pinned.bottom).toBeLessThanOrEqual(PINNED_MAX);
      } else {
        expect(rail.top, 'the rail stays under the bar').toBe(bar.bottom);
        expect(pinned.bottom, `pinned to the bottom of ${pinned.el}`).toBeGreaterThanOrEqual(
          rail.bottom,
        );
      }

      // A vendor checked in at the door.
      await press(attendance.row(VENDOR).getByTestId('attendance-check-in'));
      await expect(attendance.status(VENDOR)).not.toHaveText('Not yet');

      // Their drawer, inside the window, each tab read.
      await press(attendance.vendor(VENDOR));
      const drawer = page.getByTestId('vendors-detail-panel');
      await expect(page.getByTestId('vendors-detail-email')).toBeVisible();
      // It slides in from the window's edge.
      await expect(drawer).toBeInViewport({ ratio: 1 });
      await expectInside(drawer, 'the drawer');
      const tabs = page.getByRole('tablist', { name: 'Vendor detail' });
      for (const [tab, shown] of [
        ['Application', 'vendors-detail-update-info'],
        ['Assignments', 'vendors-detail-assignment-item'],
        ['Payment', 'payment-tab'],
        ['History', 'market-history'],
      ] as const) {
        await press(tabs.getByRole('tab', { name: tab }));
        await expect(page.getByRole('tabpanel').getByTestId(shown).first()).toBeVisible();
        const sideways = await drawer
          .locator('.detail-content')
          .evaluate((el) => el.scrollWidth - el.clientWidth);
        expect(sideways, `the ${tab} tab scrolls sideways`).toBe(0);
        if (!size.phone) continue;
        // Each action on a phone is a target a thumb can hit, standing in the drawer.
        for (const action of await drawer.locator('button:visible, a:visible').all()) {
          const box = (await action.boundingBox())!;
          const name = `"${(await action.innerText()).trim()}" on the ${tab} tab`;
          expect(box.height, `${name} is a 44px target`).toBeGreaterThanOrEqual(44);
          expect(box.x + box.width, `${name} ends inside the window`).toBeLessThanOrEqual(width);
        }
      }

      // "Change assignment" lands on the Assignments page, which keeps the window's width.
      await press(tabs.getByRole('tab', { name: 'Assignments' }));
      await press(page.getByTestId('vendor-date-card-place-link').first());
      await page.waitForURL(/\/assignments\?/);
      await expect(drawer).not.toBeInViewport();
      const tables = new TablesPage(page);
      await expect(tables.tableRows).toHaveCount(1);
      const seat = tables.tableRows.first().getByTestId('tables-seat-occupied');
      await expect(seat).toHaveAttribute('data-vendor-email', VENDOR);
      await expectFits(page, 'the Assignments page');

      // And the dialog for their seat opens inside the window.
      await press(seat.getByTestId('tables-seat-change'));
      await expect(tables.dialog).toBeVisible();
      await expectInside(tables.dialog, 'the change-placement dialog');
      await expectFits(page, 'the Assignments page, its dialog open');
    });
  });
}
