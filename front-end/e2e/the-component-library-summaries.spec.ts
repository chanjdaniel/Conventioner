import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { eachWindow, expectLaidOut, openEntry } from './helpers/componentLibrary';
import { inTheWindow } from './helpers/phoneWindow';
import { settle } from './helpers/settle';

/**
 * The component library's `summaries` entry (T200): L4's reviewers, the real panel, whose line's
 * "and 9 more" opens the whole list, the names line at each count, and L3's reviewed list in a
 * dialog, at a desk and on a phone. L3's body scrolls under its pinned title and close with its
 * shades, and a reviewed application is found in the frame. L9's real Discord report finds a vendor
 * in their group, and at 9 vendors has no field (T223).
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
/** Every verdict the fixture holds: 160 approved and 64 rejected. */
const REVIEWED = 224;
/** A reviewed application past the first page. */
const reviewedPastThePage = { name: 'Brandon Lin', email: 'brandon.lin196@example.com' };
/** L9's run: the fixture's 160 approved vendors, and one since removed. */
const IN_THE_RUN = 161;
/** The approved vendors whose Discord state says to check again, whom L9's run had not reached. */
const NOT_GIVEN_YET = [
  { name: 'Cecilia Ho', email: 'cecilia.ho112@example.com' },
  { name: 'Jamie Martinez', email: 'jamie.martinez167@example.com' },
  { name: 'Jay Alvarez', email: 'jay.alvarez171@example.com' },
  { name: 'Amy Evans', email: 'amy.evans354@example.com' },
];
/** The first people with access, on the names line. */
const [first, second, third, fourth] = [
  'Daniela Morgan',
  'Evan Wilson',
  'Faith Martin',
  'Ellen Ho',
];

const body = (page: Page, dialog: string) => page.getByTestId(`${dialog}-body`);
/** The panel that holds one of L4's states, named by its label. */
const panel = (page: Page, label: string) => page.getByRole('region', { name: label, exact: true });
/** The line on the fixture's 12 reviewers, naming these three. */
const lineWords = (named: readonly string[]) =>
  `12 reviewers: ${named.join(', ')} and 9 more reviewers`;

/** The top and bottom of a thing, inside the window. */
async function expectInTheWindow(page: Page, thing: Locator, what: string) {
  await settle(page);
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

  test('names what it serves, draws the real panel for L4, and ends with the choices left', async ({
    page,
    expectAccessible,
  }) => {
    await expect(page.getByTestId('library-serves')).toContainText('L3, L4, L9');

    const twelve = panel(page, 'Twelve reviewers');
    await expect(twelve.getByTestId('reviewers-line')).toHaveText(lineWords(addresses.slice(0, 3)));
    await expect(twelve.getByTestId('reviewers-change')).toHaveCount(0);
    await expect(page.getByText('as well, and their "and 9 more" opens that dialog')).toBeVisible();

    const choices = page.getByTestId('choices-for-you');
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
    await expect(page.getByTestId('library-names-1')).toHaveText(`1 reviewer: ${first}`);
    await expect(page.getByTestId('library-names-3')).toHaveText(
      `3 reviewers: ${first}, ${second} and ${third}`,
    );
    await expect(page.getByTestId('library-names-3-more')).toHaveCount(0);
    await expect(page.getByTestId('library-names-4')).toHaveText(
      `4 reviewers: ${first}, ${second}, ${third} and 1 more reviewer`,
    );
    await expect(page.getByTestId('library-names-all')).toContainText('and 147 more');
    await expect(page.getByTestId('library-named-1')).toHaveText(
      `12 reviewers: ${first} and 11 more reviewers`,
    );
    await expect(page.getByTestId('library-named-5')).toContainText(fourth!);

    await press(page.getByTestId('library-names-12-more'));
    const readOut = page.getByRole('region', { name: 'Twelve names' }).getByTestId('read-out');
    await expect(readOut).toHaveText('More pressed: 1');
  });

  test('"and 9 more" opens every reviewer, read only, and focus comes back to it', async ({
    page,
    expectAccessible,
  }) => {
    const twelve = panel(page, 'Twelve reviewers');
    const more = twelve.getByTestId('reviewers-line-more');
    await expect(more).toHaveAccessibleName('and 9 more reviewers');
    await press(more);

    const list = page.getByTestId('reviewers-all-window');
    await expect(list).toBeVisible();
    await expect(list.getByTestId('reviewers-person')).toHaveText(addresses);
    await expectLaidOut(page, size, 'the read-only list');
    await expectAccessible('the read-only list');

    await page.keyboard.press('Escape');
    await expect(list).toHaveCount(0);
    await expect(more).toBeFocused();
  });

  test('who can no longer review leads the line, and it says how many more are folded', async ({
    page,
  }) => {
    const chip = 'Can no longer review here';
    const one = panel(page, 'One can no longer review: named first');
    await expect(one.getByTestId('reviewers-line')).toHaveText(
      lineWords([`${addresses[6]} ${chip}`, addresses[0]!, addresses[1]!]),
    );
    await expect(one.getByTestId('reviewers-unable-more')).toHaveCount(0);

    const five = panel(page, 'Five can no longer review: two folded');
    await expect(five.getByTestId('reviewers-unable')).toHaveCount(3);
    await expect(five.getByTestId('reviewers-unable-more')).toHaveText(
      '2 more can no longer review here',
    );
    await expect(five.getByTestId('reviewers-line')).toContainText(`${addresses[1]} ${chip}`);
  });

  test('three are all said with no button, and none chosen says what it means', async ({
    page,
  }) => {
    const three = panel(page, 'Three: all said, no button');
    await expect(three.getByTestId('reviewers-line')).toHaveText(
      `3 reviewers: ${addresses[0]}, ${addresses[1]} and ${addresses[2]}`,
    );
    await expect(three.getByTestId('reviewers-line-more')).toHaveCount(0);

    const none = panel(page, 'None chosen');
    await expect(none.getByTestId('reviewers-none')).toContainText('No reviewers chosen');
    await expect(none.getByTestId('reviewers-line')).toHaveCount(0);
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

  test("L9's dialog finds a vendor in their group, and at 9 reads with no field", async ({
    page,
    expectAccessible,
  }) => {
    const find = page.getByTestId('vendors-role-report-list-find');
    const count = page.getByTestId('vendors-role-report-list-count');
    const rows = page.getByTestId('vendors-role-report-vendor');
    const heads = page.getByTestId('vendors-role-report-group').locator('.role-report-group-head');
    const head = (outcome: string, whole: number) => new RegExp(`^${outcome}\\s*${whole}$`);
    const close = page.getByTestId('vendors-role-report-who-close-button');

    // The fixture's 160 approved and one since removed, each by their Discord state.
    const whole = panel(page, 'A run over every approved vendor');
    await press(whole.getByTestId('vendors-role-report-open'));
    await expect(find).toBeFocused();
    await expect(count).toHaveText(`Showing 50 of ${IN_THE_RUN}`);
    await expect(rows).toHaveCount(50);
    await expect(heads).toHaveText([head('Given', 37), head('Already had it', 85)]);
    await expect(page.getByTestId('vendors-role-report-group').first()).toContainText(
      'A vendor no longer listed',
    );
    await expectLaidOut(page, size, "L9's dialog");
    await expectAccessible("L9's dialog");

    const wanted = NOT_GIVEN_YET[0]!;
    await find.fill(wanted.name);
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText(wanted.email);
    await expect(heads).toHaveText([head('Not given yet', NOT_GIVEN_YET.length)]);
    await expect(page.getByTestId('vendors-role-report-reason')).toContainText(
      'ran out of its time',
    );
    await press(close);

    // Nine read at a glance: every group, no field and no count.
    const short = panel(page, 'A run over 8: no field');
    await press(short.getByTestId('vendors-role-report-open'));
    await expect(rows).toHaveCount(9);
    await expect(heads).toHaveText([
      head('Given', 2),
      head('Already had it', 4),
      head('Not found', 1),
      head('No username', 2),
    ]);
    await expect(find).toHaveCount(0);
    await expect(count).toHaveCount(0);
    await expectAccessible("L9's short dialog");
  });
});
