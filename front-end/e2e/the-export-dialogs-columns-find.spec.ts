import type { Locator, Page } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { mongoEval } from './helpers/mongo';
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
 * Export vendors finds a column by typing (T217's F14): a find field over the groups, each label on
 * one line with its whole text on hover and in the cart, so a market's columns take a short height
 * and a long question's text takes one line. On a phone, where nothing hovers, a label wraps.
 */

const QUESTION = 'stall_sharing';
const LONG_LABEL =
  'If you are sharing a stall with someone else, tell us who they are and what each of you will sell';
const COLUMN = `answer:${QUESTION}`;

let marketId: string;

test.beforeAll(async ({ request }) => {
  ({ marketId } = await seedPhaseMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password, {
    intakeMode: 'form',
  }));
  mongoEval(
    `db.markets.updateOne({ id: ${JSON.stringify(marketId)} }, { $push: { 'application_form.fields': ${JSON.stringify(
      { key: QUESTION, label: LONG_LABEL, type: 'text', required: false, order: 99 },
    )} } })`,
  );
  await transitionMarket(request, BACKEND_URL, TEST_USER.email, marketId, 'applications');
  seedApplicationWithStatus(marketId, 'reviewer_approved', 'ana@ember.test');
  seedApplicationWithStatus(marketId, 'reviewer_approved', 'ben@ember.test');
});

async function openExport(page: Page): Promise<VendorExportDialog> {
  const all = new ApplicationsAllPage(page);
  await all.goto(marketId);
  await all.exportButton.click();
  const dialog = new VendorExportDialog(page);
  await expect(dialog.summary).toHaveText('2 vendors, 3 columns');
  return dialog;
}

/** Its words, the box a tick's label draws them in. */
const wordsOf = (tick: Locator) => tick.locator('xpath=following-sibling::span');

const lineHeightOf = (words: Locator) =>
  words.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));

/** Counts what asks for the file itself, not its preview, from here on. */
function countDownloads(page: Page): () => number {
  let asked = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/vendor-export$/.test(request.url())) asked += 1;
  });
  return () => asked;
}

for (const { name, use, phone } of PHONE_AND_DESK) {
  test.describe(name, () => {
    test.use(use);

    test('typing narrows the columns, each heading kept while it has matches', async ({
      authenticatedPage: page,
      expectAccessible,
    }) => {
      const dialog = await openExport(page);
      await expect(dialog.group('vendor')).toBeVisible();
      await expect(dialog.group('answers')).toBeVisible();

      await dialog.columnsFind.fill('EMAIL');
      await expect(dialog.group('vendor').locator('legend')).toHaveText('Vendor');
      await expect(dialog.group('vendor').getByRole('checkbox')).toHaveCount(1);
      await expect(dialog.column('email')).toBeChecked();
      await expect(dialog.group('answers')).toHaveCount(0);

      await dialog.columnsFind.fill('sharing a stall');
      await expect(dialog.group('answers').getByRole('checkbox')).toHaveCount(1);
      await expect(dialog.group('vendor')).toHaveCount(0);
      await settle(page);
      await expectAccessible('the export dialog, its columns narrowed');

      await dialog.columnsFind.fill('no such column');
      await expect(dialog.columnsNone).toHaveText('Nothing matches "no such column".');
      await expect(page.getByTestId('vendor-export-window').getByRole('checkbox')).toHaveCount(0);

      await dialog.columnsFind.fill('');
      await expect(dialog.columnsNone).toHaveCount(0);
      await expect(dialog.group('vendor')).toBeVisible();
      await expect(dialog.group('answers')).toBeVisible();
    });

    test(
      phone
        ? 'a long label wraps, whole, since nothing hovers here'
        : 'a long label is one line with an ellipsis, its whole text on hover',
      async ({ authenticatedPage: page }) => {
        const dialog = await openExport(page);
        const tick = dialog.column(COLUMN);
        const words = wordsOf(tick);
        await tick.scrollIntoViewIfNeeded();
        await settle(page);

        await expect(words).toHaveText(LONG_LABEL);
        await expect(words).toHaveAttribute('title', LONG_LABEL);

        const box = (await words.boundingBox())!;
        const line = await lineHeightOf(words);
        const cut = await words.evaluate((el) => el.scrollWidth > el.clientWidth);
        if (phone) {
          expect(box.height, 'it wraps').toBeGreaterThan(line * 1.5);
          expect(cut, 'nothing behind an ellipsis').toBe(false);
        } else {
          expect(box.height, 'one line').toBeLessThan(line * 1.5);
          expect(cut, 'the rest behind an ellipsis').toBe(true);
          await expect(words).toHaveCSS('text-overflow', 'ellipsis');
        }

        // A press on its words ticks it, however they are drawn.
        await words.click();
        await expect(tick).toBeChecked();
      },
    );
  });
}

test.describe('at a desk', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('the dialog holds its top as what the field finds shrinks it and grows it', async ({
    authenticatedPage: page,
  }) => {
    const dialog = await openExport(page);
    await settle(page);
    const at = (await dialog.window.boundingBox())!.y;

    for (const words of ['email', 'no such column', 'n', '']) {
      await dialog.columnsFind.fill(words);
      await settle(page);
      expect((await dialog.window.boundingBox())!.y, `with "${words}" typed`).toBe(at);
    }
  });

  test('what the words find is in view with the cart at its tallest, the body at its shortest', async ({
    authenticatedPage: page,
  }) => {
    const dialog = await openExport(page);
    await dialog.column(COLUMN).check();
    await dialog.column('preferredName').check();
    await expect(dialog.summary).toHaveText('2 vendors, 5 columns');
    await settle(page);

    /** Wholly between the body's top and bottom, where a person can see it. */
    const expectInTheBody = async (thing: Locator, what: string) => {
      await settle(page);
      const inner = (await thing.boundingBox())!;
      const outer = (await dialog.body.boundingBox())!;
      expect(inner.y, `${what}: its top`).toBeGreaterThanOrEqual(outer.y);
      expect(inner.y + inner.height, `${what}: its bottom`).toBeLessThanOrEqual(
        outer.y + outer.height,
      );
    };

    // A person scrolls until the field shows, at the body's foot, and presses it; Playwright's own
    // click would scroll it to the middle.
    await dialog.body.evaluate((el) => el.scrollTo({ top: 0 }));
    await settle(page);
    const hidden = (await dialog.columnsFind.boundingBox())!;
    const body = (await dialog.body.boundingBox())!;
    const past = hidden.y + hidden.height - (body.y + body.height);
    await dialog.body.evaluate((el, by) => el.scrollBy({ top: by }), past);
    await settle(page);
    const field = (await dialog.columnsFind.boundingBox())!;
    await page.mouse.click(field.x + 20, field.y + 2);
    await page.keyboard.type('a');
    await expectInTheBody(dialog.columnsFind, 'the field');
    await expectInTheBody(dialog.column('name'), 'the first of many');

    await dialog.columnsFind.fill('');
    await page.keyboard.type('email');
    await expectInTheBody(dialog.columnsFind, 'the field');
    await expectInTheBody(dialog.column('email'), 'the one column found');

    await dialog.columnsFind.fill('');
    await page.keyboard.type('no such column');
    await expectInTheBody(dialog.columnsFind, 'the field');
    await expectInTheBody(dialog.columnsNone, 'the words saying so');
  });

  test('a tick puts the column at the end of the order, and takes it out, the words held', async ({
    authenticatedPage: page,
  }) => {
    const dialog = await openExport(page);

    await dialog.columnsFind.fill('sharing');
    await dialog.column(COLUMN).check();
    await expect(dialog.orderLabels).toHaveText(['Name', 'Email', 'Status', LONG_LABEL]);
    await expect(dialog.summary).toHaveText('2 vendors, 4 columns');
    await expect(dialog.columnsFind).toHaveValue('sharing');

    // Its whole text is in the cart, where a long question reads in full.
    const inTheCart = dialog.orderLabels.last();
    const clipped = await inTheCart.evaluate(
      (el) => el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight,
    );
    expect(clipped, 'the cart cuts none of it').toBe(false);

    await dialog.column(COLUMN).uncheck();
    await expect(dialog.orderLabels).toHaveText(['Name', 'Email', 'Status']);
    await expect(dialog.columnsFind).toHaveValue('sharing');
  });

  test('a column moved and removed in the cart stays ticked or unticked in the list', async ({
    authenticatedPage: page,
  }) => {
    const dialog = await openExport(page);

    await dialog.columnsFind.fill('email');
    await dialog.moveUp('email');
    await expect(dialog.orderLabels).toHaveText(['Email', 'Name', 'Status']);
    await expect(dialog.column('email'), 'moved').toBeChecked();
    await expect(dialog.columnsFind).toHaveValue('email');

    // The server's answer to the move replaces what is offered, and starts nothing over.
    await expect(dialog.previewHeader.getByRole('columnheader')).toHaveText([
      'Email',
      'Name',
      'Status',
    ]);
    await expect(dialog.columnsFind).toHaveValue('email');
    await expect(dialog.group('vendor').getByRole('checkbox')).toHaveCount(1);

    await dialog.removeButton('email').click();
    await expect(dialog.orderLabels).toHaveText(['Name', 'Status']);
    await expect(dialog.column('email'), 'removed').not.toBeChecked();
    await expect(dialog.columnsFind).toHaveValue('email');

    await dialog.column('email').check();
    await expect(dialog.orderLabels, 'back at the end').toHaveText(['Name', 'Status', 'Email']);
  });

  test('Enter in the find field or on a tick does nothing', async ({ authenticatedPage: page }) => {
    const dialog = await openExport(page);
    const downloads = countDownloads(page);

    await dialog.columnsFind.fill('email');
    await dialog.columnsFind.press('Enter');
    await expect(dialog.window).toBeVisible();
    await expect(dialog.columnsFind).toHaveValue('email');

    await dialog.column('email').focus();
    await page.keyboard.press('Enter');
    await expect(dialog.window).toBeVisible();
    await expect(dialog.column('email'), 'Enter is not a press of the tick').toBeChecked();

    // Space still is, and the answer to it comes after any download those keys would have asked for.
    await page.keyboard.press('Space');
    await expect(dialog.summary).toHaveText('2 vendors, 2 columns');
    expect(downloads(), 'what asked for the file').toBe(0);

    // Enter on Download CSV still downloads, so the counting above can see one.
    await dialog.downloadButton.focus();
    const download = page.waitForEvent('download');
    await page.keyboard.press('Enter');
    await download;
    expect(downloads()).toBe(1);
  });

  test('the words go on closing', async ({ authenticatedPage: page }) => {
    const dialog = await openExport(page);
    await dialog.columnsFind.fill('email');

    await dialog.cancelButton.click();
    await expect(dialog.window).toBeHidden();
    await new ApplicationsAllPage(page).exportButton.click();
    await expect(dialog.summary).toHaveText('2 vendors, 3 columns');

    await expect(dialog.columnsFind).toHaveValue('');
    await expect(dialog.group('answers')).toBeVisible();
  });
});
