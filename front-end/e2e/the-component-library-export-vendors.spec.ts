import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { eachWindow, expectLaidOut, openEntry } from './helpers/componentLibrary';
import { inTheWindow } from './helpers/phoneWindow';
import { settle } from './helpers/settle';
import { VendorExportDialog } from './pages/VendorExportDialog';

/**
 * The component library's `export-vendors` entry (T200, T217): the product's own form, mounted on the
 * fixture's market of 43 columns and six answer filters, at a desk and on a phone, so what is
 * critiqued there is what ships. A column is found and added, one removed, one moved up by its button
 * and one dragged, an answer filters, each filter narrows the file, and the tray stays in view while
 * the body scrolls. Nothing asks the server.
 *
 * The counts are the fixture's: 359 vendors, 181 who sell stickers, 110 open and 62 of those.
 */
const STICKERS = 181;
const OPEN = 110;
const REJECTED = 64;
const OPEN_WITH_STICKERS = 62;
/** Seated on the first date: 31 in the North Wing, the rest in the South. */
const FIRST_DATE = '2024-04-22';
/** The longest column's label, so a row shows what the list does with one. */
const LONGEST =
  'I understand that a vendor who does not come, without telling the team, will not be refunded, and may not be offered a table at a later fair.';
const LONGEST_ID = 'answer:i_understand_that_a_vendor_who_does_not';
/** Someone whose chosen name is the first part of their full one. */
const CHOSEN = { name: 'Angela', full: 'Angela Lee' };
/** Someone whose answer begins with a formula's lead. */
const WITH_A_HANDLE = { email: 'mary.li13@example.com', twitter: "'@examplemaryli13" };
/** The question with 228 answers. */
const WORK = 'what_kinds_of_work_will_you_sell';
const ANSWER_FILTERS = [
  WORK,
  'i_certify_that_i_designed_and_made_the',
  'are_you_an_example_college_student',
  'which_clubs_are_you_in',
  'i_understand_that_tables_and_days_cannot',
  'i_understand_that_a_vendor_who_does_not',
];
const GROUPS = ['vendor', 'answers', 'assignment', 'payment', 'discord'] as const;

/** What the entry's panel reads out of a download. */
const readOut = (page: Page) =>
  page.getByRole('region', { name: 'Open it' }).getByTestId('read-out');

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

  async function open(page: Page): Promise<VendorExportDialog> {
    const dialog = new VendorExportDialog(page);
    await press(page.getByTestId('library-export-open'));
    await expect(dialog.window).toBeVisible();
    return dialog;
  }

  /** On a phone the tray is folded to its summary line; a test reading it opens it first. */
  async function openTray(dialog: VendorExportDialog) {
    if (size.phone) await press(dialog.cartToggle);
  }

  /** The filters are folded every time it opens; a test using one unfolds them first. */
  async function openFilters(dialog: VendorExportDialog) {
    await press(dialog.filtersToggle);
    await expect(dialog.filters).toBeVisible();
  }

  test.beforeEach(async ({ page }) => {
    await openEntry(page, 'export-vendors');
  });

  test('names what it serves and leaves no choice open, each answered', async ({
    page,
    expectAccessible,
  }) => {
    await expect(page.getByTestId('library-serves')).toContainText('The export dialog, C11, F03');
    await expect(page.getByTestId('choices-for-you')).toHaveCount(0);
    await expect(page.getByTestId('library-export-variant')).toHaveCount(0);
    await expectLaidOut(page, size, 'the export-vendors entry');
    await expectAccessible('the export-vendors entry');
  });

  test("holds the fixture's market whole: 43 columns and six answer filters", async ({
    page,
    expectAccessible,
  }) => {
    const dialog = await open(page);
    await expect(page.locator('[data-testid^="vendor-export-column-"]')).toHaveCount(43);
    for (const group of GROUPS) await expect(dialog.group(group)).toBeVisible();
    await expect(dialog.filtersSummary).toHaveText('All vendors');

    await openFilters(dialog);
    await expect(
      page.locator('[data-testid^="vendor-export-answer-"][data-testid$="-input"]'),
    ).toHaveCount(ANSWER_FILTERS.length);
    for (const key of ANSWER_FILTERS) await expect(dialog.answer(key)).toBeVisible();

    await expectLaidOut(page, size, 'the filters unfolded');
    await expectAccessible('the filters unfolded');
  });

  test('opens broad, on its first control, and no taller than the shell allows', async ({
    page,
    expectAccessible,
  }) => {
    const dialog = await open(page);
    await expect(dialog.filtersToggle).toBeFocused();

    const box = (await dialog.window.boundingBox())!;
    const viewport = page.viewportSize()!;
    // 60rem and 80% of the window at a desk; a phone's window less its gutter.
    expect(box.width).toBe(size.phone ? viewport.width - 32 : 960);
    expect(box.height).toBeLessThanOrEqual(
      size.phone ? viewport.height - 32 : viewport.height * 0.8,
    );
    await expectInside(dialog.window, 'the dialog');

    await expectLaidOut(page, size, 'the dialog');
    await expectAccessible('the dialog');
  });

  test('the title, tray and actions stay in view while the body scrolls end to end', async ({
    page,
  }) => {
    const dialog = await open(page);
    const pinned = [
      page.getByRole('heading', { name: 'Export vendors', exact: true }),
      page.getByTestId('vendor-export-close-button'),
      dialog.tray,
      dialog.summary,
      dialog.cancelButton,
      dialog.downloadButton,
    ];
    const scroller = dialog.body;
    const { scrollHeight, clientHeight } = await scroller.evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));
    expect(scrollHeight, 'the body has more than it shows').toBeGreaterThan(clientHeight);

    await expect(page.getByTestId('vendor-export-shade-bottom')).toBeVisible();
    for (const part of pinned) await expectInView(page, part, 'at the top, a pinned part');

    await scroller.evaluate((el) => (el.scrollTop = el.scrollHeight));
    await expect(page.getByTestId('vendor-export-shade-top')).toBeVisible();
    await expect(page.getByTestId('vendor-export-shade-bottom')).toHaveCount(0);
    for (const part of pinned) await expectInView(page, part, 'at the end, a pinned part');
    await expect(dialog.window).toHaveJSProperty('scrollTop', 0);
  });

  test("starts from the product's default columns and the first 3 vendors", async ({ page }) => {
    const dialog = await open(page);
    await expect(dialog.summary).toHaveText('359 vendors, 3 columns');
    await openTray(dialog);
    await expect(dialog.orderLabels).toHaveText(['Name', 'Email', 'Status']);
    await expect(dialog.previewHeader.getByRole('columnheader')).toHaveText([
      'Name',
      'Email',
      'Status',
    ]);
    await expect(dialog.previewRows).toHaveCount(3);
    await expect(dialog.previewRows.first()).toContainText('Angela Lee');
    await expectLaidOut(page, size, 'the tray open');
  });

  test('finding a column keeps only its group, and a tick adds it', async ({ page }) => {
    const dialog = await open(page);
    await openTray(dialog);
    const find = dialog.columnsFind;

    for (const id of GROUPS) await expect(dialog.group(id)).toBeVisible();
    await expect(dialog.column('email')).toBeChecked();

    await find.fill('amount owed');
    await expect(
      dialog.group('payment').locator('legend').filter({ hasText: 'Payment' }),
    ).toBeVisible();
    await expect(dialog.group('payment').getByRole('checkbox')).toHaveCount(1);
    for (const id of ['vendor', 'answers', 'assignment', 'discord'] as const) {
      await expect(dialog.group(id)).toHaveCount(0);
    }

    await press(dialog.column('owed'));
    await expect(dialog.orderLabels).toHaveText(['Name', 'Email', 'Status', 'Amount owed']);
    await expect(dialog.previewHeader.getByRole('columnheader')).toHaveText([
      'Name',
      'Email',
      'Status',
      'Amount owed',
    ]);
    await expect(dialog.summary).toHaveText('359 vendors, 4 columns');
    await expect(dialog.previewRows.first().getByRole('cell').last()).toHaveText('$0.00');

    // Enter only looks: it never downloads what the person was looking through.
    await find.press('Enter');
    await expect(dialog.window).toBeVisible();

    await find.fill('zzz');
    await expect(dialog.columnsNone).toHaveText('Nothing matches "zzz".');

    // Unticking takes it out again.
    await find.fill('amount owed');
    await press(dialog.column('owed'));
    await expect(dialog.orderLabels).toHaveText(['Name', 'Email', 'Status']);
    await expect(dialog.summary).toHaveText('359 vendors, 3 columns');
  });

  test('a move button changes the order, the preview with it, and holds the focus', async ({
    page,
  }) => {
    const dialog = await open(page);
    await openTray(dialog);
    const up = (id: string) => page.getByTestId(`vendor-export-order-up-${id}`);
    const down = (id: string) => dialog.moveDownButton(id);

    await expect(up('name')).toBeDisabled();
    await expect(down('status')).toBeDisabled();
    await expect(up('email')).toHaveAccessibleName('Move Email up');

    await press(up('status'));
    await expect(dialog.orderLabels).toHaveText(['Name', 'Status', 'Email']);
    await expect(dialog.previewHeader.getByRole('columnheader')).toHaveText([
      'Name',
      'Status',
      'Email',
    ]);
    await expect(dialog.previewRows.first().getByRole('cell')).toHaveText([
      'Angela Lee',
      'Open',
      'angela.lee0@example.com',
    ]);
    await expect(up('status')).toBeFocused();

    // At the top its up is disabled, so the focus goes to its down rather than the page.
    await page.keyboard.press('Enter');
    await expect(dialog.orderLabels).toHaveText(['Status', 'Name', 'Email']);
    await expect(down('status')).toBeFocused();
    await expect(up('status')).toBeDisabled();
  });

  test("a cart row's remove takes the column out, and the focus goes on", async ({ page }) => {
    const dialog = await open(page);
    await openTray(dialog);
    const remove = dialog.removeButton('email');
    await expect(remove).toHaveAccessibleName('Remove Email');
    await press(remove);
    await expect(dialog.orderLabels).toHaveText(['Name', 'Status']);
    await expect(dialog.column('email')).not.toBeChecked();
    await expect(dialog.removeButton('status')).toBeFocused();

    await press(dialog.removeButton('status'));
    await expect(dialog.removeButton('name')).toBeFocused();
    await press(dialog.removeButton('name'));
    await expect(dialog.orderLabels).toHaveCount(0);

    // Nothing chosen: nothing to download, and the tray says what to do.
    await expect(dialog.summary).toHaveText('359 vendors, 0 columns');
    await expect(page.getByTestId('vendor-export-order-none')).toBeVisible();
    await expect(dialog.downloadButton).toBeDisabled();
    await expect(dialog.preview).toHaveCount(0);
  });

  test('the longest label is whole in the cart: its row is never clipped on the right', async ({
    page,
  }) => {
    const dialog = await open(page);
    await openTray(dialog);
    await press(dialog.column(LONGEST_ID));
    await expect(dialog.orderLabels.last()).toHaveText(LONGEST);

    const row = dialog.orderRows.last();
    const list = page.getByTestId('vendor-export-order');
    await row.scrollIntoViewIfNeeded();
    const listBox = (await list.boundingBox())!;
    const down = (await row.getByRole('button', { name: /down$/ }).boundingBox())!;
    expect(down.x + down.width, 'its last button is inside the list').toBeLessThanOrEqual(
      listBox.x + listBox.width,
    );
    for (const scroller of [dialog.tray, dialog.body]) {
      const sideways = await scroller.evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(sideways, 'nothing runs past it on the right').toBeLessThanOrEqual(0);
    }
    await expectLaidOut(page, size, 'the longest label in the cart');
  });

  test('an answer filters through its combobox, among 228, by typing', async ({ page }) => {
    const dialog = await open(page);
    await openTray(dialog);
    await openFilters(dialog);
    const answer = (part: string) => page.getByTestId(`vendor-export-answer-${WORK}-${part}`);
    const field = answer('input');

    await press(field);
    await expect(answer('more')).toHaveText('178 more, type to narrow');
    await field.fill('stickers');
    await press(answer('option').filter({ hasText: /^Stickers$/ }));
    await expect(answer('chip')).toHaveCount(1);
    await expect(dialog.summary).toHaveText(`${STICKERS} vendors, 3 columns`);
    await expect(dialog.filtersSummary).toContainText('Stickers');
    await expect(dialog.previewRows.nth(1)).toContainText('Philip Lopez');

    // With the status: both must hold.
    await press(dialog.status('open'));
    await expect(dialog.summary).toHaveText(`${OPEN_WITH_STICKERS} vendors, 3 columns`);

    await press(answer('chip-remove'));
    await expect(dialog.summary).toHaveText(`${OPEN} vendors, 3 columns`);
  });

  test('every filter narrows the file, and one that finds nobody says so', async ({ page }) => {
    const dialog = await open(page);
    await openTray(dialog);
    await openFilters(dialog);
    const select = (name: string) => page.getByTestId(`vendor-export-${name}`);
    const vendors = (count: number) =>
      expect(dialog.summary).toHaveText(`${count} vendor${count === 1 ? '' : 's'}, 3 columns`);

    await dialog.search.fill('LOPEZ');
    await vendors(5);
    // By the name they chose or their address, as the Vendors page's search finds them.
    await dialog.search.fill(CHOSEN.name);
    await vendors(1);
    await dialog.search.fill(CHOSEN.full);
    await vendors(0);
    await dialog.search.fill('');

    await press(dialog.status('open'));
    await press(dialog.status('rejected'));
    await vendors(OPEN + REJECTED);
    await press(dialog.status('open'));
    await press(dialog.status('rejected'));

    await press(dialog.status('added'));
    await vendors(0);
    await expect(page.getByTestId('vendor-export-no-vendor')).toHaveText(
      'No vendor matches these filters.',
    );
    await expect(dialog.preview).toHaveCount(0);
    await press(dialog.status('added'));

    const mine = page.locator('label', { hasText: 'Mine: the follow-ups I own' });
    await press(mine);
    await vendors(1);
    await press(mine);

    await press(dialog.discordState('not_found'));
    await vendors(60);
    await press(dialog.discordState('not_found'));

    await dialog.payment.selectOption('owes');
    await vendors(40);
    await dialog.payment.selectOption('');

    // The assignment's selects come as the product's do: only once they would mean something.
    await expect(select('date')).toHaveCount(0);
    await dialog.placed.selectOption('unplaced');
    await expect(select('section')).toHaveCount(0);
    await vendors(224);
    await select('date').selectOption(FIRST_DATE);
    await vendors(300);
    await dialog.placed.selectOption('placed');
    await vendors(59);
    await select('section').selectOption('North Wing');
    await vendors(31);
    await select('tier').selectOption('Silver');
    await vendors(0);
    await select('tier').selectOption('Gold');
    await select('size').selectOption('half');
    await vendors(0);
    await select('size').selectOption('full');
    await vendors(31);
  });

  test('a seat, a payment and Discord each write their cell', async ({ page }) => {
    const dialog = await open(page);
    await openTray(dialog);
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
      await dialog.columnsFind.fill(words);
      await press(dialog.column(id));
    }
    await expect(dialog.previewRows.nth(2).getByRole('cell')).toHaveText([
      'Brian Singh',
      'brian.singh2@example.com',
      'Approved',
      'South Wing 27',
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

  test('a cell a spreadsheet would run is written as text, and an amount as it is', async ({
    page,
  }) => {
    const dialog = await open(page);
    await openTray(dialog);
    await openFilters(dialog);
    await dialog.columnsFind.fill('Business Twitter');
    await press(dialog.column('answer:business_twitter_optional'));
    await dialog.search.fill(WITH_A_HANDLE.email);
    await expect(dialog.previewRows.first().getByRole('cell').last()).toHaveText(
      WITH_A_HANDLE.twitter,
    );

    await dialog.search.fill('');
    await dialog.payment.selectOption('over');
    await dialog.columnsFind.fill('Still owed');
    await press(dialog.column('stillOwed'));
    await expect(dialog.previewRows.first().getByRole('cell').last()).toHaveText(/^-\$\d/);
  });

  test('Enter in the name or email field only looks', async ({ page }) => {
    const dialog = await open(page);
    await openFilters(dialog);
    await dialog.search.fill('angela');
    await dialog.search.press('Enter');

    await expect(dialog.window).toBeVisible();
    await expect(dialog.search).toHaveValue('angela');
    await expect(readOut(page)).toHaveText('Download CSV would export: nothing');
  });

  test('Enter on the Mine tick only looks', async ({ page }) => {
    const dialog = await open(page);
    await openFilters(dialog);
    await dialog.mine.focus();
    await dialog.mine.press('Enter');

    await expect(dialog.window).toBeVisible();
    await expect(readOut(page)).toHaveText('Download CSV would export: nothing');
  });

  test('Download only reads out what it would export, and asks no server', async ({ page }) => {
    const asked: string[] = [];
    page.on('request', (request) => {
      const { pathname } = new URL(request.url());
      if (pathname.startsWith('/api')) asked.push(request.url());
    });

    const dialog = await open(page);
    await openTray(dialog);
    await openFilters(dialog);
    await press(page.getByTestId('vendor-export-order-up-status'));
    await press(dialog.status('open'));
    await press(dialog.downloadButton);

    await expect(dialog.window).toHaveCount(0);
    await expect(readOut(page)).toHaveText(
      `Download CSV would export: ${OPEN} vendors, 3 columns: Name, Status, Email`,
    );
    await expect(page.getByTestId('library-export-open')).toBeFocused();
    expect(asked).toEqual([]);
  });

  test('Cancel and Escape leave nothing, and it starts afresh each time', async ({ page }) => {
    const dialog = await open(page);
    await openTray(dialog);
    await openFilters(dialog);
    await press(dialog.status('open'));
    await press(dialog.removeButton('email'));
    await press(dialog.cancelButton);
    await expect(dialog.window).toHaveCount(0);
    await expect(readOut(page)).toHaveText('Download CSV would export: nothing');

    await press(page.getByTestId('library-export-open'));
    await expect(dialog.summary).toHaveText('359 vendors, 3 columns');
    await expect(dialog.filtersSummary).toHaveText('All vendors');
    await expect(dialog.filters).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(dialog.window).toHaveCount(0);
  });

  test('the tray folds on a phone, and at a desk has no fold', async ({ page }) => {
    const dialog = await open(page);
    const toggle = dialog.cartToggle;
    const order = page.getByTestId('vendor-export-order');
    if (!size.phone) {
      await expect(toggle).toBeHidden();
      await expect(order).toBeVisible();
      await expect(dialog.preview).toBeVisible();
      return;
    }
    await expect(order).toBeHidden();
    await expect(dialog.preview).toBeHidden();
    await expect(dialog.summary).toHaveText('359 vendors, 3 columns');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toHaveText('Show the file');
    const folded = (await dialog.tray.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(folded.height, 'the body keeps the room').toBeLessThan(viewport.height * 0.15);

    await press(toggle);
    await expect(order).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle).toHaveText('Hide the file');
    await expectLaidOut(page, size, 'the tray open on a phone');

    // The bar keeps its place under the thumb, and no row shows beneath it as the tray scrolls.
    await dialog.tray.evaluate((el) => (el.scrollTop = 40));
    await settle(page);
    const bar = (await page.getByTestId('vendor-export-cart-bar').boundingBox())!;
    const opened = (await dialog.tray.boundingBox())!;
    expect(Math.round(bar.y + bar.height)).toBe(Math.round(opened.y + opened.height));

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

test.describe('at 1280 wide', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('broad, no taller than 80% of the window, with the tray in view', async ({ page }) => {
    await openEntry(page, 'export-vendors');
    await page.getByTestId('library-export-open').click();
    const dialog = new VendorExportDialog(page);
    await expect(dialog.window).toBeVisible();
    const box = (await dialog.window.boundingBox())!;
    expect(box.width).toBe(960);
    expect(box.height).toBeLessThanOrEqual(800 * 0.8);
    await expectInView(page, dialog.tray, 'the tray');
  });
});

test.describe('dragging a row, at a desk', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('the handle sets the order, the preview with it', async ({ page }) => {
    await openEntry(page, 'export-vendors');
    await page.getByTestId('library-export-open').click();
    const dialog = new VendorExportDialog(page);
    await expect(dialog.window).toBeVisible();

    const rows = dialog.orderRows;
    const handle = (await rows.nth(2).getByTestId('vendor-export-order-handle').boundingBox())!;
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

    await expect(dialog.orderLabels).toHaveText(['Status', 'Name', 'Email']);
    await expect(dialog.previewHeader.getByRole('columnheader')).toHaveText([
      'Status',
      'Name',
      'Email',
    ]);
  });
});
