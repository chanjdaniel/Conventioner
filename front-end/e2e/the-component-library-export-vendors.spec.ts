import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { eachWindow, expectLaidOut, openEntry } from './helpers/componentLibrary';
import { inTheWindow } from './helpers/phoneWindow';
import { settle } from './helpers/settle';

/**
 * The component library's `export-vendors` entry (T200): the export dialog redesigned, broad, its
 * body scrolling under a pinned title, tray and actions, at a desk and on a phone. A column is found
 * and added in each variant, one removed, one moved up by its button and one dragged, an answer
 * filters, each filter narrows the file, and the tray stays in view while the body scrolls. Nothing
 * asks the server.
 *
 * The counts are the fixture's: 359 vendors, 181 who sell stickers, 110 open and 62 of those.
 */
const DIALOG = 'library-export-dialog';
const STICKERS = 181;
const OPEN = 110;
const OPEN_WITH_STICKERS = 62;
/** Seated on the first date: 31 in the North Wing, the rest in the South. */
const FIRST_DATE = '2024-04-22';
/** The longest column's label, so a row shows what the list does with one. */
const LONGEST =
  'I understand that a vendor who does not come, without telling the team, will not be refunded, and may not be offered a table at a later fair.';
const LONGEST_ID = 'answer:i_understand_that_a_vendor_who_does_not';

const dialog = (page: Page) => page.getByTestId(`${DIALOG}-window`);
const body = (page: Page) => page.getByTestId(`${DIALOG}-body`);
const tray = (page: Page) => page.getByTestId(`${DIALOG}-tray`);
const summary = (page: Page) => page.getByTestId('library-export-summary');
const orderRows = (page: Page) => page.getByTestId('library-export-order-row');
const header = (page: Page) => page.getByTestId('library-export-preview-header').locator('th');
const previewRows = (page: Page) => page.getByTestId('library-export-preview-row');
const answerField = (page: Page, at: number) =>
  page.getByTestId(`library-export-answer-${at}-input`);

/** The chosen columns' names, as the order list reads them with its row's buttons left out. */
const orderWords = (page: Page) => page.locator('.export-cart__label');

/** The bottom of a thing is inside the window, and its top. */
async function expectInView(page: Page, thing: Locator, what: string) {
  await settle(page);
  const box = (await thing.boundingBox())!;
  const { height } = page.viewportSize()!;
  expect(box.y, `${what}: its top is in the window`).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height, `${what}: its bottom is in the window`).toBeLessThanOrEqual(height);
}

eachWindow('the export-vendors entry', (size) => {
  const { press, expectInside } = inTheWindow(size);

  async function open(page: Page, variant: 'checklist' | 'combobox' = 'checklist') {
    await press(page.getByTestId(`library-export-variant-${variant}`));
    await press(page.getByTestId('library-export-open'));
    await expect(dialog(page)).toBeVisible();
  }

  /** On a phone the tray is folded to its summary line; a test reading it opens it first. */
  async function openTray(page: Page) {
    if (size.phone) await press(page.getByTestId('library-export-cart-toggle'));
  }

  test.beforeEach(async ({ page }) => {
    await openEntry(page, 'export-vendors');
  });

  test('names what it serves and ends with the choices left', async ({
    page,
    expectAccessible,
  }) => {
    await expect(page.getByTestId('library-serves')).toContainText('The export dialog, C11, F03');
    const choices = page.getByTestId('choices-for-you');
    await expect(choices).toContainText('The column choice');
    await expect(choices).toContainText('What the tray holds');
    await expect(choices).toContainText("The preview's rows");
    await expect(choices).toContainText('The tray folded on a phone');
    await expectLaidOut(page, size, 'the export-vendors entry');
    await expectAccessible('the export-vendors entry');
  });

  test('opens broad, on its first field, and never taller than the window', async ({
    page,
    expectAccessible,
  }) => {
    await open(page);
    await expect(page.getByTestId('library-export-search')).toBeFocused();

    const box = (await dialog(page).boundingBox())!;
    const window = page.viewportSize()!;
    // 60rem at a desk; a phone's window less its gutter.
    expect(box.width).toBe(size.phone ? window.width - 32 : 960);
    expect(box.height).toBeLessThanOrEqual(window.height - 48);
    await expectInside(dialog(page), 'the dialog');

    await expectLaidOut(page, size, 'the dialog');
    await expectAccessible('the dialog');
  });

  test('the title, tray and actions stay in view while the body scrolls end to end', async ({
    page,
  }) => {
    await open(page);
    const pinned = [
      page.getByRole('heading', { name: 'Export vendors', exact: true }),
      page.getByTestId(`${DIALOG}-close-button`),
      tray(page),
      summary(page),
      page.getByTestId(`${DIALOG}-cancel-button`),
      page.getByTestId(`${DIALOG}-submit-button`),
    ];
    const scroller = body(page);
    const { scrollHeight, clientHeight } = await scroller.evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));
    expect(scrollHeight, 'the body has more than it shows').toBeGreaterThan(clientHeight);

    await expect(page.getByTestId(`${DIALOG}-shade-bottom`)).toBeVisible();
    for (const part of pinned) await expectInView(page, part, 'at the top, a pinned part');

    await scroller.evaluate((el) => (el.scrollTop = el.scrollHeight));
    await expect(page.getByTestId(`${DIALOG}-shade-top`)).toBeVisible();
    await expect(page.getByTestId(`${DIALOG}-shade-bottom`)).toHaveCount(0);
    for (const part of pinned) await expectInView(page, part, 'at the end, a pinned part');
    await expect(dialog(page)).toHaveJSProperty('scrollTop', 0);
  });

  for (const variant of ['checklist', 'combobox'] as const) {
    test(`${variant}: starts from the product's default columns and the first 3 vendors`, async ({
      page,
    }) => {
      await open(page, variant);
      await expect(summary(page)).toHaveText('359 vendors, 3 columns');
      await openTray(page);
      await expect(orderWords(page)).toHaveText(['Name', 'Email', 'Status']);
      await expect(header(page)).toHaveText(['Name', 'Email', 'Status']);
      await expect(previewRows(page)).toHaveCount(3);
      await expect(previewRows(page).first()).toContainText('Angela Lee');
      await expectLaidOut(page, size, `${variant}, the tray open`);
    });
  }

  test('the checklist: finding a column keeps only its group, and a tick adds it', async ({
    page,
  }) => {
    await open(page, 'checklist');
    await openTray(page);
    const find = page.getByTestId('library-export-columns-find');
    const group = (id: string) => page.getByTestId(`library-export-group-${id}`);

    for (const id of ['vendor', 'answers', 'assignment', 'payment', 'discord']) {
      await expect(group(id)).toBeVisible();
    }
    await expect(page.getByTestId('library-export-column-email')).toBeChecked();

    await find.fill('amount owed');
    await expect(group('payment').getByRole('heading', { name: 'Payment' })).toBeVisible();
    await expect(group('payment').getByRole('checkbox')).toHaveCount(1);
    for (const id of ['vendor', 'answers', 'assignment', 'discord']) {
      await expect(group(id)).toHaveCount(0);
    }

    await press(page.getByTestId('library-export-column-owed'));
    await expect(orderWords(page)).toHaveText(['Name', 'Email', 'Status', 'Amount owed']);
    await expect(header(page)).toHaveText(['Name', 'Email', 'Status', 'Amount owed']);
    await expect(summary(page)).toHaveText('359 vendors, 4 columns');
    await expect(previewRows(page).first().locator('td').last()).toHaveText('$0.00');

    // Enter only looks: it never downloads what the person was looking through.
    await find.press('Enter');
    await expect(dialog(page)).toBeVisible();

    await find.fill('zzz');
    await expect(page.getByTestId('library-export-columns-none')).toHaveText(
      'Nothing matches "zzz".',
    );

    // Unticking takes it out again.
    await find.fill('amount owed');
    await press(page.getByTestId('library-export-column-owed'));
    await expect(orderWords(page)).toHaveText(['Name', 'Email', 'Status']);
    await expect(summary(page)).toHaveText('359 vendors, 3 columns');
  });

  test('the combobox: finding a column in its group adds it, and its chip removes it', async ({
    page,
  }) => {
    await open(page, 'combobox');
    await openTray(page);
    const field = page.getByTestId('library-export-columns-input');
    const chips = page.getByTestId('library-export-columns-chip');
    await expect(chips).toHaveText(['Name', 'Email', 'Status'].map((w) => new RegExp(`^${w}`)));

    await press(field);
    const list = page.getByTestId('library-export-columns-list');
    for (const heading of ['Vendor', 'Answers', 'Assignment', 'Payment', 'Discord']) {
      await expect(list.getByText(heading, { exact: true })).toBeVisible();
    }
    await field.fill('amount owed');
    const option = page.getByTestId('library-export-columns-option');
    await expect(option).toHaveText(['Amount owed']);
    await press(option);

    await expect(orderWords(page)).toHaveText(['Name', 'Email', 'Status', 'Amount owed']);
    await expect(summary(page)).toHaveText('359 vendors, 4 columns');
    await expect(chips).toHaveCount(4);

    await press(chips.filter({ hasText: 'Email' }).getByRole('button'));
    await expect(orderWords(page)).toHaveText(['Name', 'Status', 'Amount owed']);
    await expect(header(page)).toHaveText(['Name', 'Status', 'Amount owed']);
    await expect(summary(page)).toHaveText('359 vendors, 3 columns');

    await page.getByTestId('library-export-columns-input').press('Enter');
    await expect(dialog(page)).toBeVisible();
  });

  test('a move button changes the order, the preview with it, and holds the focus', async ({
    page,
  }) => {
    await open(page);
    await openTray(page);
    const up = (id: string) => page.getByTestId(`library-export-order-up-${id}`);
    const down = (id: string) => page.getByTestId(`library-export-order-down-${id}`);

    await expect(up('name')).toBeDisabled();
    await expect(down('status')).toBeDisabled();
    await expect(up('email')).toHaveAccessibleName('Move Email up');

    await press(up('status'));
    await expect(orderWords(page)).toHaveText(['Name', 'Status', 'Email']);
    await expect(header(page)).toHaveText(['Name', 'Status', 'Email']);
    await expect(previewRows(page).first().locator('td')).toHaveText([
      'Angela Lee',
      'Open',
      'angela.lee0@example.com',
    ]);
    await expect(up('status')).toBeFocused();

    // At the top its up is disabled, so the focus goes to its down rather than the page.
    await page.keyboard.press('Enter');
    await expect(orderWords(page)).toHaveText(['Status', 'Name', 'Email']);
    await expect(down('status')).toBeFocused();
    await expect(up('status')).toBeDisabled();
  });

  test("a cart row's remove takes the column out, and the focus goes on", async ({ page }) => {
    await open(page);
    await openTray(page);
    const remove = page.getByTestId('library-export-remove-email');
    await expect(remove).toHaveAccessibleName('Remove Email');
    await press(remove);
    await expect(orderWords(page)).toHaveText(['Name', 'Status']);
    await expect(page.getByTestId('library-export-column-email')).not.toBeChecked();
    await expect(page.getByTestId('library-export-remove-status')).toBeFocused();

    await press(page.getByTestId('library-export-remove-status'));
    await expect(page.getByTestId('library-export-remove-name')).toBeFocused();
    await press(page.getByTestId('library-export-remove-name'));
    await expect(orderWords(page)).toHaveCount(0);

    // Nothing chosen: nothing to download, and the tray says what to do.
    await expect(summary(page)).toHaveText('359 vendors, 0 columns');
    await expect(page.getByTestId('library-export-order-none')).toBeVisible();
    await expect(page.getByTestId(`${DIALOG}-submit-button`)).toBeDisabled();
    await expect(page.getByTestId('library-export-preview')).toHaveCount(0);
  });

  test('the longest label is whole in the cart: its row is never clipped on the right', async ({
    page,
  }) => {
    await open(page);
    await openTray(page);
    await press(page.getByTestId(`library-export-column-${LONGEST_ID}`));
    await expect(orderWords(page).last()).toHaveText(LONGEST);

    const row = orderRows(page).last();
    const list = page.getByTestId('library-export-order');
    await row.scrollIntoViewIfNeeded();
    const listBox = (await list.boundingBox())!;
    const down = (await row.getByRole('button', { name: /down$/ }).boundingBox())!;
    expect(down.x + down.width, 'its last button is inside the list').toBeLessThanOrEqual(
      listBox.x + listBox.width,
    );
    for (const scroller of [tray(page), body(page)]) {
      const sideways = await scroller.evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(sideways, 'nothing runs past it on the right').toBeLessThanOrEqual(0);
    }
    await expectLaidOut(page, size, 'the longest label in the cart');
  });

  test('an answer filters through its combobox, among 228, by typing', async ({ page }) => {
    await open(page);
    await openTray(page);
    const field = answerField(page, 0);

    await press(field);
    await expect(page.getByTestId('library-export-answer-0-more')).toHaveText(
      '178 more, type to narrow',
    );
    await field.fill('stickers');
    await press(
      page.getByTestId('library-export-answer-0-option').filter({ hasText: /^Stickers$/ }),
    );
    await expect(page.getByTestId('library-export-answer-0-chip')).toHaveCount(1);
    await expect(summary(page)).toHaveText(`${STICKERS} vendors, 3 columns`);
    await expect(previewRows(page).nth(1)).toContainText('Philip Lopez');

    // With the status: both must hold.
    await press(page.getByTestId('library-export-status-open'));
    await expect(summary(page)).toHaveText(`${OPEN_WITH_STICKERS} vendors, 3 columns`);

    await press(page.getByTestId('library-export-answer-0-chip-remove'));
    await expect(summary(page)).toHaveText(`${OPEN} vendors, 3 columns`);
  });

  test('every filter narrows the file, and one that finds nobody says so', async ({ page }) => {
    await open(page);
    await openTray(page);
    const vendors = (count: number) =>
      expect(summary(page)).toHaveText(`${count} vendor${count === 1 ? '' : 's'}, 3 columns`);

    await page.getByTestId('library-export-search').fill('LOPEZ');
    await vendors(5);
    await page.getByTestId('library-export-search').fill('');

    await press(page.getByTestId('library-export-status-open'));
    await press(page.getByTestId('library-export-status-rejected'));
    await vendors(110 + 64);
    await press(page.getByTestId('library-export-status-open'));
    await press(page.getByTestId('library-export-status-rejected'));

    await press(page.getByTestId('library-export-status-added'));
    await vendors(0);
    await expect(page.getByTestId('library-export-no-vendor')).toHaveText(
      'No vendor matches these filters.',
    );
    await expect(page.getByTestId('library-export-preview')).toHaveCount(0);
    await press(page.getByTestId('library-export-status-added'));

    await page.getByTestId('library-export-mine').check({ force: size.phone });
    await vendors(1);
    await page.getByTestId('library-export-mine').uncheck({ force: size.phone });

    await press(page.getByTestId('library-export-discord-not_found'));
    await vendors(60);
    await press(page.getByTestId('library-export-discord-not_found'));

    await page.getByTestId('library-export-payment').selectOption('owes');
    await vendors(40);
    await page.getByTestId('library-export-payment').selectOption('');

    // The assignment's selects come as today's do: only once they would mean something.
    await expect(page.getByTestId('library-export-date')).toHaveCount(0);
    await page.getByTestId('library-export-placed').selectOption('unplaced');
    await expect(page.getByTestId('library-export-section')).toHaveCount(0);
    await vendors(224);
    await page.getByTestId('library-export-date').selectOption(FIRST_DATE);
    await vendors(300);
    await page.getByTestId('library-export-placed').selectOption('placed');
    await vendors(59);
    await page.getByTestId('library-export-section').selectOption('North Wing');
    await vendors(31);
    await page.getByTestId('library-export-tier').selectOption('Silver');
    await vendors(0);
    await page.getByTestId('library-export-tier').selectOption('Gold');
    await page.getByTestId('library-export-size').selectOption('half');
    await vendors(0);
    await page.getByTestId('library-export-size').selectOption('full');
    await vendors(31);
  });

  test('a seat, a payment and Discord each write their cell', async ({ page }) => {
    await open(page);
    await openTray(page);
    const find = page.getByTestId('library-export-columns-find');
    for (const [words, id] of [
      ['Tue 23 Apr - table', 'date:2024-04-23:table'],
      ['Thu 25 Apr - tier', 'date:2024-04-25:tier'],
      ['Thu 25 Apr - half', 'date:2024-04-25:size'],
      ['Dates assigned', 'datesPlaced'],
      ['Price group', 'priceGroup'],
      ['Still owed', 'stillOwed'],
      ['Discord state', 'discordState'],
      ['Discord username', 'discordUsername'],
      ['Business Name', 'answer:business_name'],
    ] as const) {
      await find.fill(words);
      await press(page.getByTestId(`library-export-column-${id}`));
    }
    await expect(previewRows(page).nth(2).locator('td')).toHaveText([
      'Brian Singh',
      'brian.singh2@example.com',
      'Approved',
      'S27',
      'Gold',
      'Full table',
      '2',
      'Silver, Gold',
      '$40.00',
      'In the server',
      'examplebriansingh2',
      'Wren Lab',
    ]);
  });

  test('Download only reads out what it would export, and asks no server', async ({ page }) => {
    const asked: string[] = [];
    page.on('request', (request) => {
      const { pathname } = new URL(request.url());
      if (pathname.startsWith('/api')) asked.push(request.url());
    });

    await open(page);
    await openTray(page);
    await press(page.getByTestId('library-export-order-up-status'));
    await press(page.getByTestId('library-export-status-open'));
    await press(page.getByTestId(`${DIALOG}-submit-button`));

    await expect(dialog(page)).toHaveCount(0);
    await expect(
      page.getByRole('region', { name: 'Open it on either column choice' }).getByTestId('read-out'),
    ).toHaveText(`Download CSV would export: ${OPEN} vendors, 3 columns: Name, Status, Email`);
    await expect(page.getByTestId('library-export-open')).toBeFocused();
    expect(asked).toEqual([]);
  });

  test('Cancel and Escape leave nothing, and it starts afresh each time', async ({ page }) => {
    await open(page);
    await openTray(page);
    await press(page.getByTestId('library-export-status-open'));
    await press(page.getByTestId('library-export-remove-email'));
    await press(page.getByTestId(`${DIALOG}-cancel-button`));
    await expect(dialog(page)).toHaveCount(0);
    await expect(
      page.getByRole('region', { name: 'Open it on either column choice' }).getByTestId('read-out'),
    ).toHaveText('Download CSV would export: nothing');

    await press(page.getByTestId('library-export-open'));
    await expect(summary(page)).toHaveText('359 vendors, 3 columns');
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
  });

  test('the tray folds on a phone, and at a desk has no fold', async ({ page }) => {
    await open(page);
    const toggle = page.getByTestId('library-export-cart-toggle');
    const order = page.getByTestId('library-export-order');
    if (!size.phone) {
      await expect(toggle).toBeHidden();
      await expect(order).toBeVisible();
      await expect(page.getByTestId('library-export-preview')).toBeVisible();
      return;
    }
    await expect(order).toBeHidden();
    await expect(page.getByTestId('library-export-preview')).toBeHidden();
    await expect(summary(page)).toHaveText('359 vendors, 3 columns');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toHaveText('Show the file');
    const folded = (await tray(page).boundingBox())!;
    const window = page.viewportSize()!;
    expect(folded.height, 'the body keeps the room').toBeLessThan(window.height * 0.15);

    await press(toggle);
    await expect(order).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle).toHaveText('Hide the file');
    await expectLaidOut(page, size, 'the tray open on a phone');

    // The bar keeps its place under the thumb, and no row shows beneath it as the tray scrolls.
    await tray(page).evaluate((el) => (el.scrollTop = 40));
    await settle(page);
    const bar = (await page.locator('.export-cart__bar').boundingBox())!;
    const open_ = (await tray(page).boundingBox())!;
    expect(Math.round(bar.y + bar.height)).toBe(Math.round(open_.y + open_.height));

    await press(toggle);
    await expect(order).toBeHidden();
  });

  test('the ordered list on its own: both ends of one row, and what a slot draws', async ({
    page,
    expectAccessible,
  }) => {
    await expect(page.getByTestId('library-order-one-list-up-name')).toBeDisabled();
    await expect(page.getByTestId('library-order-one-list-down-name')).toBeDisabled();

    const several = page.getByTestId('library-order-several');
    await press(page.getByTestId('library-order-several-list-down-name'));
    await expect(several.getByTestId('read-out')).toHaveText(
      'In order: Preferred name, Name, Email, Status',
    );

    await expect(page.getByTestId('library-order-slot-list-row').first()).toContainText('1. Email');
    await expect(page.getByTestId('library-order-slot-list-row').first()).toContainText('Vendor');
    await expectLaidOut(page, size, 'the ordered list');
    await expectAccessible('the ordered list');
  });
});

test.describe('dragging a row, at a desk', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('the handle sets the order, the preview with it', async ({ page }) => {
    await openEntry(page, 'export-vendors');
    await page.getByTestId('library-export-open').click();
    await expect(dialog(page)).toBeVisible();

    const rows = orderRows(page);
    const handle = (await rows.nth(2).locator('.drag-handle').boundingBox())!;
    const x = handle.x + handle.width / 2;
    await page.mouse.move(x, handle.y + handle.height / 2);
    await page.mouse.down();
    // A row at a time, the list settling between, as a hand would take it.
    for (const over of [rows.nth(1), rows.first()]) {
      const box = (await over.boundingBox())!;
      await page.mouse.move(x, box.y + box.height / 2, { steps: 8 });
      await settle(page);
    }
    await page.mouse.up();

    await expect(orderWords(page)).toHaveText(['Status', 'Name', 'Email']);
    await expect(header(page)).toHaveText(['Status', 'Name', 'Email']);
  });
});
