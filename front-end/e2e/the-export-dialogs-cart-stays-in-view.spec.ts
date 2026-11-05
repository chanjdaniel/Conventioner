import type { Locator, Page } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL, LoginPage } from './fixtures';
import { barsDrawn, barWidth, withClassicBars } from './helpers/classicBars';
import { PHONE_AND_DESK } from './helpers/phoneWindow';
import {
  seedApplicationWithStatus,
  seedPhaseMarket,
  transitionMarket,
} from './helpers/seedPhaseMarket';
import { settle } from './helpers/settle';
import { ApplicationsAllPage } from './pages/ApplicationsAllPage';
import { VendorExportDialog } from './pages/VendorExportDialog';

/**
 * Export vendors keeps what the file will hold in view (T191's F02, F03 and F14).
 *
 * It was 38rem wide and taller than the window, with its order and preview under every filter, and
 * on a browser drawing classic bars the bar lay over the order's corners and its "Move down"
 * buttons. Now it is broad, no taller than 80% of the window, and only the choosing scrolls: the
 * cart and the buttons are pinned, with nothing scrolled to reach them.
 */

let marketId: string;

test.beforeAll(async ({ request }) => {
  ({ marketId } = await seedPhaseMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password, {
    intakeMode: 'form',
  }));
  await transitionMarket(request, BACKEND_URL, TEST_USER.email, marketId, 'applications');
  for (const name of ['ana', 'ben', 'cy', 'dee', 'eve']) {
    seedApplicationWithStatus(marketId, 'reviewer_approved', `${name}@ember.test`);
  }
});

async function openExport(page: Page): Promise<VendorExportDialog> {
  const all = new ApplicationsAllPage(page);
  await all.goto(marketId);
  await all.exportButton.click();
  const dialog = new VendorExportDialog(page);
  await expect(dialog.summary).toHaveText('5 vendors, 3 columns');
  return dialog;
}

/** Wholly inside the window, read where it rests. */
async function expectInTheWindow(page: Page, thing: Locator, what: string) {
  await settle(page);
  const box = (await thing.boundingBox())!;
  const { width, height } = page.viewportSize()!;
  expect(box.y, `${what}: its top`).toBeGreaterThanOrEqual(0);
  expect(box.x, `${what}: its left`).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height, `${what}: its bottom`).toBeLessThanOrEqual(height);
  expect(box.x + box.width, `${what}: its right`).toBeLessThanOrEqual(width);
}

/** Inside the box that clips it, so a person can see all of it. */
async function expectWithin(thing: Locator, frame: Locator, what: string) {
  const inner = (await thing.boundingBox())!;
  const outer = (await frame.boundingBox())!;
  expect(inner.y, `${what}: its top`).toBeGreaterThanOrEqual(outer.y);
  expect(inner.y + inner.height, `${what}: its bottom`).toBeLessThanOrEqual(
    outer.y + outer.height + 0.5,
  );
  expect(inner.x + inner.width, `${what}: its right`).toBeLessThanOrEqual(outer.x + outer.width);
}

const scrollTop = (scroller: Locator) => scroller.evaluate((el) => el.scrollTop);

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
]) {
  test.describe(`at ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    test('opens from Applications with the whole cart and both buttons in view, nothing scrolled', async ({
      authenticatedPage: page,
      expectAccessible,
    }) => {
      const dialog = await openExport(page);

      const box = (await dialog.window.boundingBox())!;
      expect(box.width, '60rem wide').toBe(960);
      expect(box.height, 'at most 80% of the window').toBeLessThanOrEqual(viewport.height * 0.8);

      const seen: [Locator, string][] = [
        [dialog.summary, 'the summary'],
        [dialog.previewHeader, "the preview's header"],
        [dialog.cancelButton, 'Cancel'],
        [dialog.downloadButton, 'Download CSV'],
      ];
      for (const [thing, what] of seen) {
        await expectInTheWindow(page, thing, what);
        await expectWithin(thing, dialog.window, what);
      }
      await expect(dialog.orderLabels).toHaveText(['Name', 'Email', 'Status']);
      await expect(dialog.previewHeader.getByRole('columnheader')).toHaveText([
        'Name',
        'Email',
        'Status',
      ]);
      await expect(dialog.previewRows).toHaveCount(3);
      for (const at of [0, 1, 2]) {
        await expectWithin(dialog.orderRows.nth(at), dialog.tray, `order row ${at}`);
        await expectWithin(dialog.previewRows.nth(at), dialog.tray, `preview row ${at}`);
      }
      expect(await scrollTop(dialog.body), "the body's scroll").toBe(0);
      expect(await scrollTop(dialog.tray), "the tray's scroll").toBe(0);

      await expectAccessible('the export dialog');
    });

    test('the cart stays where it is while the choosing scrolls', async ({
      authenticatedPage: page,
    }) => {
      const dialog = await openExport(page);
      await expect
        .poll(() => dialog.body.evaluate((el) => el.scrollHeight - el.clientHeight))
        .toBeGreaterThan(1);
      const before = (await dialog.tray.boundingBox())!;

      await dialog.body.hover();
      await page.mouse.wheel(0, 5000);
      await expect.poll(() => scrollTop(dialog.body)).toBeGreaterThan(0);

      expect(await dialog.tray.boundingBox()).toEqual(before);
      await expectInTheWindow(page, dialog.downloadButton, 'Download CSV');
    });
  });
}

test.describe('at a desk', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('the preview reads the columns in the order set, by a move, a drag and a remove', async ({
    authenticatedPage: page,
  }) => {
    const dialog = await openExport(page);
    const header = dialog.previewHeader.getByRole('columnheader');

    await dialog.moveUp('email');
    await expect(dialog.orderLabels).toHaveText(['Email', 'Name', 'Status']);
    await expect(header).toHaveText(['Email', 'Name', 'Status']);
    await expect(page.getByTestId('vendor-export-order-up-email')).toBeDisabled();
    await expect(dialog.moveDownButton('email'), 'the focus stays on its row').toBeFocused();

    const from = (await dialog.orderRows
      .last()
      .getByTestId('vendor-export-order-handle')
      .boundingBox())!;
    const x = from.x + from.width / 2;
    await page.mouse.move(x, from.y + from.height / 2);
    await page.mouse.down();
    // A row at a time, the list settling between, as a hand would take it.
    for (const over of [dialog.orderRows.nth(1), dialog.orderRows.first()]) {
      const box = (await over.boundingBox())!;
      await page.mouse.move(x, box.y + box.height / 2, { steps: 8 });
      await settle(page);
    }
    await page.mouse.up();
    await expect(dialog.orderLabels).toHaveText(['Status', 'Email', 'Name']);
    await expect(header).toHaveText(['Status', 'Email', 'Name']);

    await dialog.removeButton('email').focus();
    await page.keyboard.press('Enter');
    await expect(dialog.orderLabels).toHaveText(['Status', 'Name']);
    await expect(header).toHaveText(['Status', 'Name']);
    await expect(dialog.summary).toHaveText('5 vendors, 2 columns');
    await expect(dialog.removeButton('name'), 'the focus goes on to the next').toBeFocused();
    await expect(dialog.column('email')).not.toBeChecked();

    const { text } = await dialog.download();
    expect(text.slice(1).split(/\r?\n/)[0]).toBe('Status,Name');
  });

  test('no column chosen says so in the cart, and Download CSV is disabled', async ({
    authenticatedPage: page,
  }) => {
    const dialog = await openExport(page);

    for (const id of ['name', 'email', 'status']) await dialog.removeButton(id).click();

    await expect(dialog.tray).toContainText('Choose a column to export it.');
    await expect(dialog.preview).toHaveCount(0);
    await expect(dialog.summary).toHaveText('5 vendors, 0 columns');
    await expect(dialog.downloadButton).toBeDisabled();
    await expect(dialog.filtersToggle, 'the focus stays inside').toBeFocused();
  });

  test('no vendor matching says so in the cart', async ({ authenticatedPage: page }) => {
    const dialog = await openExport(page);
    await dialog.showFilters();

    await dialog.search.fill('nobody-at-all');

    await expect(dialog.summary).toHaveText('0 vendors, 3 columns');
    await expect(dialog.tray).toContainText('No vendor matches these filters.');
    await expect(dialog.preview).toHaveCount(0);
  });

  test("a failed preview's words are in the cart, and a working one takes them back", async ({
    authenticatedPage: page,
  }) => {
    const dialog = await openExport(page);
    await dialog.showFilters();
    const failed = page.getByTestId('vendor-export-preview-error');
    const preview = `**/markets/${marketId}/vendor-export/preview`;

    await page.route(preview, (route) => route.fulfill({ status: 500, json: {} }));
    await dialog.search.fill('ana');
    await expect(dialog.tray.getByTestId('vendor-export-preview-error')).toBeVisible();
    await expect(dialog.summary).toHaveCount(0);
    await expect(dialog.preview).toHaveCount(0);
    await expectInTheWindow(page, failed, 'the words');

    await page.unroute(preview);
    await dialog.search.fill('');
    await expect(failed).toHaveCount(0);
    await expect(dialog.summary).toHaveText('5 vendors, 3 columns');
  });

  test('a first preview that failed says so in the cart, with nothing left loading', async ({
    authenticatedPage: page,
  }) => {
    const all = new ApplicationsAllPage(page);
    await all.goto(marketId);
    await page.route(`**/markets/${marketId}/vendor-export/preview`, (route) =>
      route.fulfill({ status: 500, json: {} }),
    );
    await all.exportButton.click();
    const dialog = new VendorExportDialog(page);

    await expect(dialog.tray.getByTestId('vendor-export-preview-error')).toBeVisible();
    await expect(dialog.window).not.toContainText('Loading');
    await expect(dialog.downloadButton).toBeDisabled();
  });
});

test.describe('in a short window', () => {
  test.use({ viewport: { width: 1280, height: 480 } });

  test('the cart folds to its line, so the choosing has the room', async ({
    authenticatedPage: page,
  }) => {
    const dialog = await openExport(page);

    await expect(dialog.orderRows.first()).toBeHidden();
    await expect(dialog.cartToggle).toHaveText('Show the file');
    await expectInTheWindow(page, dialog.downloadButton, 'Download CSV');
    const body = (await dialog.body.boundingBox())!;
    expect(body.height, 'what is left to choose in').toBeGreaterThan(120);
  });
});

test.describe('at 640px tall, above the fold', () => {
  test.use({ viewport: { width: 1280, height: 640 } });

  test('the cart stays open, as the window has room for it', async ({
    authenticatedPage: page,
  }) => {
    const dialog = await openExport(page);

    await expect(dialog.orderRows.first()).toBeVisible();
    await expect(dialog.cartToggle).toBeHidden();
    await expectInTheWindow(page, dialog.downloadButton, 'Download CSV');
  });
});

const { use: phone } = PHONE_AND_DESK[0];

test.describe('on a phone', () => {
  test.use(phone);

  test('the cart folds to its summary, opens on "Show the file", and the buttons stay', async ({
    authenticatedPage: page,
  }) => {
    const dialog = await openExport(page);

    await expect(dialog.orderRows.first()).toBeHidden();
    await expect(dialog.preview).toBeHidden();
    await expect(dialog.cartToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(dialog.cartToggle).toHaveText('Show the file');
    await expectInTheWindow(page, dialog.summary, 'the summary');
    await expectInTheWindow(page, dialog.downloadButton, 'Download CSV');
    await expectInTheWindow(page, dialog.cancelButton, 'Cancel');
    const folded = (await dialog.tray.boundingBox())!;
    expect(folded.height, 'the body keeps the room').toBeLessThan(phone.viewport.height * 0.15);

    await dialog.cartToggle.tap();
    await expect(dialog.cartToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(dialog.cartToggle).toHaveText('Hide the file');
    await expect(dialog.orderRows.first()).toBeVisible();
    await expect(dialog.preview).toBeVisible();
    await expectInTheWindow(page, dialog.cartToggle, 'Hide the file');
    await expectInTheWindow(page, dialog.downloadButton, 'Download CSV');

    // The toggle holds its place at the tray's foot while the file above it scrolls.
    await dialog.tray.evaluate((el) => (el.scrollTop = 80));
    await settle(page);
    await expectWithin(dialog.cartToggle, dialog.tray, 'Hide the file');

    await dialog.cartToggle.tap();
    await expect(dialog.orderRows.first()).toBeHidden();
  });

  test("a failed preview's words stay in view with the cart folded", async ({
    authenticatedPage: page,
  }) => {
    const dialog = await openExport(page);
    await dialog.showFilters();
    await page.route(`**/markets/${marketId}/vendor-export/preview`, (route) =>
      route.fulfill({ status: 500, json: {} }),
    );

    await dialog.search.fill('ana');

    const failed = page.getByTestId('vendor-export-preview-error');
    await expect(failed).toBeVisible();
    await expectInTheWindow(page, failed, 'the words');
    await expect(dialog.orderRows.first()).toBeHidden();
  });
});

test.describe('on a browser that draws classic scroll bars', () => {
  test("the window's corners and the order's corners and Move down buttons are whole", async ({
    playwright,
    baseURL,
  }) => {
    await withClassicBars({ playwright, baseURL }, { width: 1440, height: 900 }, async (page) => {
      const login = new LoginPage(page);
      await login.login(TEST_USER.email, TEST_USER.password);
      await login.waitForMarkets();
      const dialog = await openExport(page);
      await expect
        .poll(() => dialog.body.evaluate((el) => el.scrollHeight - el.clientHeight))
        .toBeGreaterThan(1);
      await dialog.body.evaluate((el) => (el.scrollTop = el.scrollHeight));
      await settle(page);

      expect(await barWidth(dialog.body), "the body's bar").toBe(0);
      expect(await barWidth(dialog.tray), "the tray's bar").toBe(0);
      expect(await barsDrawn(page), 'what draws a bar under body').toEqual([]);

      const windowCorners = await dialog.window.evaluate((el) => {
        const style = getComputedStyle(el);
        return [style.borderTopRightRadius, style.borderBottomRightRadius];
      });
      expect(windowCorners).toEqual(['10px', '10px']);

      const list = page.getByTestId('vendor-export-order');
      const box = (await list.boundingBox())!;
      const tray = (await dialog.tray.boundingBox())!;
      expect(box.x + box.width, "the order's right edge").toBeLessThan(tray.x + tray.width);
      const listCorners = await list.evaluate((el) => {
        const style = getComputedStyle(el);
        return [style.borderTopRightRadius, style.borderBottomRightRadius];
      });
      expect(listCorners).toEqual(['6px', '6px']);

      const ids = await dialog.orderRows.evaluateAll((rows) =>
        rows.map((row) =>
          row
            .querySelector('[data-testid^="vendor-export-order-down-"]')!
            .getAttribute('data-testid')!,
        ),
      );
      for (const id of ids) {
        const down = page.getByTestId(id);
        const button = (await down.boundingBox())!;
        expect(button.x + button.width, `${id}: inside the list`).toBeLessThanOrEqual(
          box.x + box.width,
        );
        // What a press at its right edge lands on is the button, and nothing laid over it.
        await down.scrollIntoViewIfNeeded();
        const atItsEdge = await down.evaluate((el) => {
          const { right, top, height } = el.getBoundingClientRect();
          return document.elementFromPoint(right - 2, top + height / 2) === el;
        });
        expect(atItsEdge, `${id}: nothing lies over its right edge`).toBe(true);
      }
    });
  });
});
