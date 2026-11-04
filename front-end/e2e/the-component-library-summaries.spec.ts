import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { eachWindow, expectLaidOut, openEntry } from './helpers/componentLibrary';
import { inTheWindow } from './helpers/phoneWindow';

/**
 * The component library's `summaries` entry (T200): L4's reviewers as one line beside today's real
 * panel, whose "and 9 more" opens Change reviewers, and L3's reviewed list in a dialog, at a desk and
 * on a phone. A reviewer is added and removed through the combobox, a change lands only on Save, the
 * dialog's body scrolls under its pinned title and actions with its shades, and a reviewed
 * application is found in the frame.
 */

/** The fixture's 12 reviewers, by address, as the market keeps them. */
const addresses = [
  'robert.bailey11@example.com',
  'chloe.walker32@example.com',
  'nora.fischer34@example.com',
  'elijah.perez35@example.com',
  'goran.khan51@example.com',
  'freya.bell54@example.com',
  'connor.collins91@example.com',
  'zach.murphy99@example.com',
  'claire.gomez107@example.com',
  'jasmine.alvarez129@example.com',
  'amy.li139@example.com',
  'charles.wang150@example.com',
];
/** Someone with access who is not a reviewer yet. */
const newcomer = 'daniela.morgan1@example.com';
/** Every verdict the fixture holds: 160 approved and 64 rejected. */
const REVIEWED = 224;
/** A reviewed application past the first page. */
const reviewedPastThePage = { name: 'Brandon Lin', email: 'brandon.lin196@example.com' };
/** The first people with access, the names line's short names. */
const [ana, ben, cai, dee] = ['Daniela Morgan', 'Evan Wilson', 'Faith Martin', 'Ellen Ho'];

const LINE = 'library-l4-line';
const CHANGE = 'library-l4-dialog';
const line = (page: Page) => page.getByTestId(LINE);
const more = (page: Page) => page.getByTestId(`${LINE}-more`);
const body = (page: Page, dialog: string) => page.getByTestId(`${dialog}-body`);
const chips = (page: Page) => page.getByTestId('library-l4-picker-chip');
const chipRemove = (page: Page, address: string) =>
  page.getByRole('button', { name: `Remove ${address}`, exact: true });
const chosenCount = (page: Page) => page.getByTestId('library-l4-chosen-count');

const lineWords = (chosen: readonly string[]) =>
  `${chosen.length} reviewers: ${chosen.slice(0, 3).join(', ')} and ${chosen.length - 3} more`;

/** The top and bottom of a thing, inside the window. */
async function expectInTheWindow(page: Page, thing: Locator, what: string) {
  const box = (await thing.boundingBox())!;
  const { height } = page.viewportSize()!;
  expect(box.y, `${what}: its top is in the window`).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height, `${what}: its bottom is in the window`).toBeLessThanOrEqual(height);
}

/** Scrolls the body end to end: a shade only while there is more that way, the pinned parts held. */
async function expectBodyScrollsUnderPinnedParts(page: Page, dialog: string, pinned: Locator[]) {
  const scroller = body(page, dialog);
  const shade = (edge: string) => page.getByTestId(`${dialog}-shade-${edge}`);

  const { scrollHeight, clientHeight } = await scroller.evaluate((el) => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }));
  expect(scrollHeight, 'the body has more than it shows').toBeGreaterThan(clientHeight);
  await scroller.evaluate((el) => (el.scrollTop = 0));
  await expect(shade('bottom')).toBeVisible();
  await expect(shade('top')).toHaveCount(0);

  await scroller.evaluate((el) => (el.scrollTop = el.scrollHeight));
  await expect(shade('top')).toBeVisible();
  await expect(shade('bottom')).toHaveCount(0);

  await expect(page.getByTestId(`${dialog}-window`)).toHaveJSProperty('scrollTop', 0);
  for (const part of pinned) await expectInTheWindow(page, part, 'a pinned part');
}

eachWindow('the summaries entry', (size) => {
  const { press } = inTheWindow(size);

  test.beforeEach(async ({ page }) => {
    await openEntry(page, 'summaries');
  });

  test('names what it serves, draws both sides of L4, and ends with the choices left', async ({
    page,
    expectAccessible,
  }) => {
    await expect(page.getByTestId('library-serves')).toContainText('L3, L4, L9');

    const today = page.getByRole('region', { name: 'Today: every reviewer listed', exact: true });
    await expect(today.getByTestId('reviewers-person')).toHaveText(addresses);
    await expect(line(page)).toHaveText(lineWords(addresses));

    const choices = page.getByTestId('choices-for-you');
    await expect(choices).toContainText('Names named before "and N more"');
    await expect(choices).toContainText('Bars before the fold');
    await expect(choices).toContainText('in place or in a dialog');
    await expect(choices).toContainText('rows before a group');

    await expectLaidOut(page, size, 'the summaries entry');
    await expectAccessible('the summaries entry');
  });

  test('each count reads as one sentence, and a button only past what it names', async ({
    page,
  }) => {
    await expect(page.getByTestId('library-names-0')).toHaveText('No reviewers');
    await expect(page.getByTestId('library-names-1')).toHaveText(`1 reviewer: ${ana}`);
    await expect(page.getByTestId('library-names-3')).toHaveText(
      `3 reviewers: ${ana}, ${ben} and ${cai}`,
    );
    await expect(page.getByTestId('library-names-3-more')).toHaveCount(0);
    await expect(page.getByTestId('library-names-4')).toHaveText(
      `4 reviewers: ${ana}, ${ben}, ${cai} and 1 more`,
    );
    await expect(page.getByTestId('library-names-all')).toContainText('and 147 more');
    await expect(page.getByTestId('library-named-1')).toHaveText(
      `12 reviewers: ${ana} and 11 more`,
    );
    await expect(page.getByTestId('library-named-5')).toContainText(dee!);

    await press(page.getByTestId('library-names-12-more'));
    const readOut = page.getByRole('region', { name: 'Twelve names' }).getByTestId('read-out');
    await expect(readOut).toHaveText('More pressed: 1');
  });

  test('"and 9 more" opens the dialog on the field, whose body scrolls under its pinned parts', async ({
    page,
    expectAccessible,
  }) => {
    await press(more(page));
    await expect(page.getByTestId(`${CHANGE}-window`)).toBeVisible();
    await expect(page.getByTestId('library-l4-picker-input')).toBeFocused();
    await expect(chips(page)).toHaveCount(12);
    await expect(chosenCount(page)).toHaveText('12 reviewers');
    await expect(page.getByTestId('library-l4-reviewer')).toHaveText(addresses);

    await expectBodyScrollsUnderPinnedParts(page, CHANGE, [
      page.getByRole('heading', { name: 'Change reviewers', exact: true }),
      page.getByTestId(`${CHANGE}-close-button`),
      page.getByTestId(`${CHANGE}-cancel-button`),
      page.getByTestId(`${CHANGE}-submit-button`),
    ]);
    await expectAccessible('Change reviewers, scrolled');

    await page.keyboard.press('Escape');
    await expect(page.getByTestId(`${CHANGE}-window`)).toHaveCount(0);
    await expect(more(page)).toBeFocused();
  });

  test('a reviewer added and removed through the combobox lands on Save, and Cancel leaves it', async ({
    page,
  }) => {
    const field = page.getByTestId('library-l4-picker-input');
    const submit = page.getByTestId(`${CHANGE}-submit-button`);

    await press(more(page));
    await field.fill(newcomer);
    await press(page.getByTestId('library-l4-picker-option').first());
    await expect(chips(page)).toHaveCount(13);
    await expect(chosenCount(page)).toHaveText('13 reviewers');
    await expect(page.getByTestId('library-l4-reviewer').last()).toHaveText(newcomer);
    // Past the threshold the frame gains its field, which finds the one just added.
    const find = page.getByTestId('library-l4-chosen-find');
    await find.fill(newcomer);
    await expect(chosenCount(page)).toHaveText(`1 of 13 matches "${newcomer}"`);
    await find.fill('');

    // Nothing lands until Save.
    await expect(line(page)).toHaveText(lineWords(addresses));
    await press(submit);
    await expect(page.getByTestId(`${CHANGE}-window`)).toHaveCount(0);
    await expect(line(page)).toHaveText(lineWords([...addresses, newcomer]));
    await expect(more(page)).toBeFocused();

    await press(more(page));
    await press(chipRemove(page, newcomer));
    await expect(chips(page)).toHaveCount(12);
    await expect(chosenCount(page)).toHaveText('12 reviewers');
    await press(chipRemove(page, addresses[0]!));
    await press(page.getByTestId(`${CHANGE}-cancel-button`));
    await expect(line(page)).toHaveText(lineWords([...addresses, newcomer]));

    await press(more(page));
    await press(chipRemove(page, newcomer));
    await press(submit);
    await expect(line(page)).toHaveText(lineWords(addresses));
  });

  test('saving down to three takes the button, and focus goes to Change reviewers', async ({
    page,
  }) => {
    await press(more(page));
    for (const address of addresses.slice(3)) await press(chipRemove(page, address));
    await expect(chosenCount(page)).toHaveText('3 reviewers');
    await press(page.getByTestId(`${CHANGE}-submit-button`));

    await expect(line(page)).toHaveText(
      `3 reviewers: ${addresses[0]}, ${addresses[1]} and ${addresses[2]}`,
    );
    await expect(more(page)).toHaveCount(0);
    await expect(page.getByTestId('library-l4-change')).toBeFocused();
  });

  test('nobody chosen says what it means, and the button says Choose', async ({ page }) => {
    await press(page.getByTestId('library-l4-change'));
    for (const address of addresses) await press(chipRemove(page, address));
    await expect(page.getByTestId('library-l4-chosen-empty')).toContainText('No reviewers chosen');
    await press(page.getByTestId(`${CHANGE}-submit-button`));

    await expect(page.getByTestId('library-l4-none')).toContainText('No reviewers chosen');
    await expect(line(page)).toHaveCount(0);
    await expect(page.getByTestId('library-l4-change')).toHaveText('Choose reviewers');
    await expect(page.getByTestId('library-l4-change')).toBeFocused();
    await expectLaidOut(page, size, 'nobody chosen');
  });

  test("L3's dialog finds a reviewed application, shows more, and forgets its words", async ({
    page,
    expectAccessible,
  }) => {
    const opener = page.getByTestId('library-l3-open');
    const dialog = 'library-l3-dialog';
    const count = page.getByTestId('library-l3-count');
    const rows = page.getByTestId('library-l3-row');
    const find = page.getByTestId('library-l3-find');
    const url = page.url();

    await expect(opener).toHaveText(`Show ${REVIEWED} reviewed`);
    await press(opener);
    await expect(find).toBeFocused();
    await expect(count).toHaveText(`Showing 50 of ${REVIEWED}`);
    await expect(rows).toHaveCount(50);
    await expectAccessible("L3's dialog");

    await expectBodyScrollsUnderPinnedParts(page, dialog, [
      page.getByRole('heading', { name: 'Reviewed applications', exact: true }),
      page.getByTestId(`${dialog}-close-button`),
    ]);

    await press(page.getByTestId('library-l3-more'));
    await expect(rows).toHaveCount(100);
    await expect(rows.nth(50)).toBeFocused();
    await expect(count).toHaveText(`Showing 100 of ${REVIEWED}`);

    const wanted = reviewedPastThePage;
    await find.pressSequentially(wanted.email);
    await expect(count).toHaveText(`1 of ${REVIEWED} matches "${wanted.email}"`);
    await expect(rows).toHaveCount(1);
    await expect(page.getByTestId('library-l3-name')).toHaveText(wanted.name);
    // The address holds no words of a dialog's.
    expect(page.url()).toBe(url);

    await press(page.getByTestId(`${dialog}-close-button`));
    await expect(opener).toBeFocused();
    await press(opener);
    await expect(find).toHaveValue('');
    await expect(rows).toHaveCount(50);
  });
});
