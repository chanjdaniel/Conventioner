import type { Page } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL, LoginPage, TablesPage } from './fixtures';
import { barsDrawn, barWidth, pageBarWidth, withClassicBars } from './helpers/classicBars';
import { openEntry } from './helpers/componentLibrary';
import { seedPublishedMarketWithAssignments } from './helpers/seeds';

/**
 * Nothing in the app draws a scroll bar but the page itself and a text field (T217).
 *
 * A browser that draws classic bars gave a dialog's bar the room inside its window, which squared its
 * right corners and lay over the export dialog's list. Each of these opens something that overflows
 * on such a browser, and finds no room given to a bar on its scroller or anywhere else, with the
 * page's own bar still drawn.
 */

/** Scrolls and overflows: a test that measured a box with nothing to scroll would pass on nothing. */
async function expectOverflowing(page: Page, testid: string) {
  const scroller = page.getByTestId(testid);
  await expect
    .poll(() => scroller.evaluate((el) => el.scrollHeight - el.clientHeight), `${testid} overflows`)
    .toBeGreaterThan(1);
  return scroller;
}

async function expectNoBarButThePage(page: Page, scrollerTestid: string) {
  const scroller = await expectOverflowing(page, scrollerTestid);
  expect(await barWidth(scroller), `${scrollerTestid}'s bar`).toBe(0);
  expect(await barsDrawn(page), 'what draws a bar under body').toEqual([]);
  await expect.poll(() => pageBarWidth(page), "the page's own bar").toBeGreaterThan(0);
}

test.describe('on a browser that draws classic scroll bars', () => {
  test('a dialog scrolling whole draws no bar and keeps its round corners', async ({
    playwright,
    baseURL,
  }) => {
    await withClassicBars({ playwright, baseURL }, { width: 1280, height: 720 }, async (page) => {
      await openEntry(page, 'dialog');
      await page
        .getByRole('region', { name: 'A short dialog: the whole window scrolls' })
        .getByRole('button')
        .click();
      const window = page.getByTestId('library-window-window');
      await expect(window).toBeVisible();

      await expectNoBarButThePage(page, 'library-window-scroll');
      const corners = await window.evaluate((el) => {
        const style = getComputedStyle(el);
        return [style.borderTopRightRadius, style.borderBottomRightRadius];
      });
      expect(corners).toEqual(['10px', '10px']);
    });
  });

  test('a dialog scrolling its body draws no bar', async ({ playwright, baseURL }) => {
    await withClassicBars({ playwright, baseURL }, { width: 1280, height: 720 }, async (page) => {
      await openEntry(page, 'dialog');
      await page
        .getByRole('region', { name: 'A long dialog: only the body' })
        .getByRole('button')
        .click();
      await expect(page.getByTestId('library-body-window')).toBeVisible();

      await expectNoBarButThePage(page, 'library-body-body');
    });
  });

  test('the vendor drawer draws no bar', async ({ playwright, baseURL, request }) => {
    const seed = await seedPublishedMarketWithAssignments(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );
    await withClassicBars({ playwright, baseURL }, { width: 1280, height: 400 }, async (page) => {
      const login = new LoginPage(page);
      await login.goto();
      await login.fillEmail(TEST_USER.email);
      await login.fillPassword(TEST_USER.password);
      await login.clickSubmit();
      await page.waitForURL('**/dashboard');

      const tables = new TablesPage(page);
      await tables.goto(seed.marketId);
      const seat = page.getByTestId('tables-seat-occupied').first();
      await expect(seat).toBeVisible({ timeout: 10000 });
      await tables.openVendor(seat);
      await expect(page.getByTestId('vendors-detail-panel')).toBeVisible();

      await expectNoBarButThePage(page, 'vendors-detail-content');
    });
  });

  test('a text field keeps its bar, and the page keeps its bar and its gutter', async ({
    playwright,
    baseURL,
  }) => {
    await withClassicBars({ playwright, baseURL }, { width: 1280, height: 720 }, async (page) => {
      await openEntry(page, 'dialog');
      const html = await page.evaluate(() => {
        const style = getComputedStyle(document.documentElement);
        return { width: style.scrollbarWidth, gutter: style.scrollbarGutter };
      });
      expect(html).toEqual({ width: 'auto', gutter: 'stable' });
      // Once the entry has drawn: a page with nothing to scroll keeps a bar's room but draws none.
      await expect.poll(() => pageBarWidth(page), "the page's own bar").toBeGreaterThan(0);

      // The one kind of field that scrolls, overflowing here whatever a screen happens to hold.
      const barOfAField = await page.evaluate(() => {
        const field = document.createElement('textarea');
        field.rows = 2;
        field.value = 'A long answer.\n'.repeat(50);
        document.body.append(field);
        const bar = field.offsetWidth - field.clientWidth;
        field.remove();
        return bar;
      });
      // More than its two borders.
      expect(barOfAField).toBeGreaterThan(2);
    });
  });
});
