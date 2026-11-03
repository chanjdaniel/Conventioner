import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { eachWindow, expectLaidOut, openEntry } from './helpers/componentLibrary';

/**
 * The component library's `combobox` entry (T200): `SearchPicker` grown with a cap, on the
 * fixture's 150 people and 228 options, at a desk and on a phone. C7 finds a person past the cap
 * by their family name or their address, by the keys and by a click, beside today's native select
 * of the same 150; the line under a capped list counts what is left, stays in view as the list
 * scrolls, and is never a choice. C5 chooses reviewers as chips beside today's checkbox per person,
 * removed by a chip's button and by Backspace, and C10 chooses among the 228 answers.
 */

/** Three people share this family name, all past the first 50. */
const FAMILY_NAME = 'Phillips';

const picker = (page: Page, testid: string) => ({
  field: page.getByTestId(`${testid}-input`),
  options: page.getByTestId(`${testid}-option`),
  more: page.getByTestId(`${testid}-more`),
  list: page.getByTestId(`${testid}-list`),
  chips: page.getByTestId(`${testid}-chip`),
  none: page.getByTestId(`${testid}-none`),
});
const readOutOf = (page: Page, testid: string): Locator =>
  page.getByTestId(testid).locator('xpath=ancestor::div[1]').getByTestId('read-out');

eachWindow('the combobox entry', (size) => {
  test.beforeEach(async ({ page }) => {
    await openEntry(page, 'combobox');
  });

  test('names what it serves and ends with the choices left', async ({ page }) => {
    const entry = page.getByTestId('library-entry-combobox');
    await expect(entry).toContainText('C2, C6, C7, C8, C9, C13 and C14');

    const choices = page.getByTestId('choices-for-you');
    await expect(choices).toContainText('threshold');
    await expect(choices).toContainText('cap');
    await expect(choices).toContainText('match order');
    await expectLaidOut(page, size, 'the combobox entry');
  });

  test('C7 shows today beside it: a native select of all 150', async ({ page }) => {
    const today = page.getByTestId('library-c7-today');
    await expect(today.getByRole('combobox', { name: 'Who will follow up' })).toBeVisible();
    await expect(today.locator('option')).toHaveCount(150);
  });

  test('an empty field shows the cap and how many are left', async ({ page, expectAccessible }) => {
    const c7 = picker(page, 'library-c7');
    await c7.field.click();

    await expect(c7.options).toHaveCount(50);
    await expect(c7.more).toHaveText('100 more, type to narrow');
    await expectLaidOut(page, size, 'C7 open');
    await expectAccessible('C7 open, capped');
  });

  test('a family name finds them past the cap, and the keys choose', async ({ page }) => {
    const c7 = picker(page, 'library-c7');
    await c7.field.fill(FAMILY_NAME);

    await expect(c7.options).toHaveCount(3);
    await expect(c7.more).toHaveCount(0);

    await c7.field.press('ArrowDown');
    const second = (await c7.options.nth(1).locator('span').first().textContent())!.trim();
    await c7.field.press('Enter');

    await expect(c7.field).toHaveValue(second);
    await expect(readOutOf(page, 'library-c7')).toHaveText(`Chosen: ${second}`);
    await expect(c7.list).toHaveCount(0);
  });

  test('a family name finds them, and a click chooses', async ({ page }) => {
    const c7 = picker(page, 'library-c7');
    await c7.field.fill(FAMILY_NAME);

    const last = c7.options.last();
    const name = (await last.locator('span').first().textContent())!.trim();
    await last.click();

    await expect(c7.field).toHaveValue(name);
    await expect(readOutOf(page, 'library-c7')).toHaveText(`Chosen: ${name}`);
  });

  test('an address finds them too', async ({ page }) => {
    const c7 = picker(page, 'library-c7');
    await c7.field.fill('lily.chang121@');

    await expect(c7.options).toHaveCount(1);
    await c7.field.press('Enter');
    await expect(readOutOf(page, 'library-c7')).toHaveText('Chosen: Lily Chang');
  });

  test('the line stays in view, and the keys bring every row clear of it', async ({ page }) => {
    const c7 = picker(page, 'library-c7');
    await c7.field.click();

    const box = async (locator: Locator) => (await locator.boundingBox())!;
    const active = c7.list.locator('.search-picker-option--active');
    const list = await box(c7.list);
    const line = await box(c7.more);
    expect(line.y + line.height).toBeLessThanOrEqual(list.y + list.height + 1);

    // Each row the keys reach sits above the line, down the part of the list that scrolls.
    for (let press = 0; press < 12; press++) {
      await c7.field.press('ArrowDown');
      const row = await box(active);
      expect(row.y + row.height, `row ${press + 2}`).toBeLessThanOrEqual(line.y + 1);
    }

    // Held at the last row: the line is not a stop.
    for (let press = 0; press < 40; press++) await c7.field.press('ArrowDown');
    await expect(c7.options.last()).toHaveClass(/search-picker-option--active/);
    const lastRow = await box(c7.options.last());
    expect(lastRow.y + lastRow.height).toBeLessThanOrEqual((await box(c7.more)).y + 1);
  });

  test('228 options are capped, and the line counts what the words find', async ({ page }) => {
    const options = picker(page, 'library-options');
    await options.field.click();
    await expect(options.options).toHaveCount(50);
    await expect(options.more).toHaveText('178 more, type to narrow');

    await options.field.fill('sticker');
    await expect(options.options).not.toHaveCount(50);
    await expect(options.more).toHaveCount(0);
    await options.field.press('Enter');
    const chosen = await options.field.inputValue();
    expect(chosen.toLowerCase()).toContain('sticker');
    await expect(readOutOf(page, 'library-options')).toHaveText(`Chosen: ${chosen}`);
  });

  test('the cap is counted across the groups in order', async ({ page }) => {
    const grouped = picker(page, 'library-grouped');
    await grouped.field.click();

    await expect(grouped.options).toHaveCount(20);
    await expect(grouped.more).toHaveText('23 more, type to narrow');
    // Vendor's 4, Answers' 15, and one of Assignment's; Payment and Discord wait for the words.
    const headings = grouped.list.locator('.search-picker-group-label');
    await expect(headings).toHaveText(['Vendor', 'Answers', 'Assignment']);
    await expectLaidOut(page, size, 'the grouped list open');
  });

  test('a list under the cap draws no line', async ({ page }) => {
    const under = picker(page, 'library-under-cap');
    await under.field.click();

    await expect(under.options).toHaveCount(14);
    await expect(under.more).toHaveCount(0);
  });

  test('a choice past the cap is kept by Enter', async ({ page }) => {
    const past = picker(page, 'library-past-cap');
    await expect(past.field).toHaveValue('Lily Chang');
    await past.field.click();

    await expect(past.options).toHaveCount(50);
    await past.field.press('Enter');
    await expect(past.field).toHaveValue('Lily Chang');
    await expect(readOutOf(page, 'library-past-cap')).toHaveText('Chosen: Lily Chang');
  });

  test('a picker with no choices never opens', async ({ page }) => {
    const none = picker(page, 'library-no-choices');
    await none.field.click();

    await expect(none.field).toHaveAttribute('aria-expanded', 'false');
    await expect(none.list).toHaveCount(0);
  });

  test('several choices name what they serve, and the choices left', async ({ page }) => {
    await expect(page.getByTestId('library-entry-combobox')).toContainText('C5, C10, C11 and C12');
    await expect(page.getByTestId('choices-for-you')).toContainText('The chips');
  });

  test('C5 shows today beside it: a checkbox for all 150, 12 ticked', async ({ page }) => {
    const today = page.getByTestId('library-c5-today');
    await expect(today.getByRole('checkbox')).toHaveCount(150);
    await expect(today.getByRole('checkbox', { checked: true })).toHaveCount(12);
    await expect(today.getByTestId('read-out')).toHaveText('Ticked: 12 of 150');

    await expect(picker(page, 'library-c5').chips).toHaveCount(12);
  });

  test('C5 chooses three, removes one by its button and one by Backspace', async ({
    page,
    expectAccessible,
  }) => {
    const c5 = picker(page, 'library-c5');
    const readOut = readOutOf(page, 'library-c5');
    await c5.field.click();

    // Three in a row, the list open throughout and every row where it was.
    const free = c5.list.getByRole('option', { selected: false });
    const names: string[] = [];
    for (const expected of [13, 14, 15]) {
      const row = free.first();
      names.push((await row.locator('span').first().textContent())!.trim());
      await row.click();
      await expect(c5.chips).toHaveCount(expected);
      await expect(c5.list).toBeVisible();
      await expect(c5.options).toHaveCount(50);
    }
    const [first, second, third] = names as [string, string, string];
    await expect(c5.chips.last()).toContainText(third);
    await expect(readOut).toContainText(`${first}, ${second}, ${third}`);

    await expectLaidOut(page, size, 'C5 with fifteen chips, open');
    await expectAccessible('C5 with fifteen chips, open');

    // A chip's button: the list stays open and the field keeps its focus.
    await page.getByRole('button', { name: `Remove ${second}` }).click();
    await expect(c5.chips).toHaveCount(14);
    await expect(readOut).not.toContainText(second);
    await expect(c5.list).toBeVisible();
    await expect(c5.field).toBeFocused();

    // Backspace in the empty field takes the last chip.
    await page.keyboard.press('Backspace');
    await expect(c5.chips).toHaveCount(13);
    await expect(readOut).not.toContainText(third);
    await expect(readOut).toContainText(first);
  });

  test('C5 finds people by the words and chooses several of them by the keys', async ({ page }) => {
    const c5 = picker(page, 'library-c5');
    await c5.field.click();
    await c5.field.fill(FAMILY_NAME);
    await expect(c5.options).toHaveCount(3);

    const chosenBefore = await c5.chips.count();
    const selected = c5.list.getByRole('option', { selected: true });
    const selectedBefore = await selected.count();
    const firstIsChosen = (await c5.options.first().getAttribute('aria-selected')) === 'true';
    const secondIsChosen = (await c5.options.nth(1).getAttribute('aria-selected')) === 'true';

    await c5.field.press('Enter');
    await c5.field.press('ArrowDown');
    await c5.field.press('Enter');

    // Each row toggled, the words still there and still finding the same three.
    const change = (chosen: boolean) => (chosen ? -1 : 1);
    const expected = change(firstIsChosen) + change(secondIsChosen);
    await expect(c5.chips).toHaveCount(chosenBefore + expected);
    await expect(selected).toHaveCount(selectedBefore + expected);
    await expect(c5.field).toHaveValue(FAMILY_NAME);
    await expect(c5.options).toHaveCount(3);

    // The next word replaces them, and Backspace clears before it takes a chip.
    await page.keyboard.press('Backspace');
    await expect(c5.field).toHaveValue('');
    await expect(c5.chips).toHaveCount(chosenBefore + expected);
    await page.keyboard.press('Backspace');
    await expect(c5.chips).toHaveCount(chosenBefore + expected - 1);
  });

  test('a chosen row, chosen again, is taken away', async ({ page }) => {
    const c5 = picker(page, 'library-c5');
    await c5.field.click();
    const row = c5.list.getByRole('option', { selected: true }).first();
    await expect(row.locator('svg')).toBeVisible();
    const name = (await row.locator('span').first().textContent())!.trim();

    await row.click();

    await expect(c5.chips).toHaveCount(11);
    await expect(c5.list.getByRole('option', { name, exact: false }).first()).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  test('the keyboard removes a chip and goes on to the next', async ({ page }) => {
    const c5 = picker(page, 'library-c5');
    const buttons = page.getByTestId('library-c5-chip-remove');
    const second = (await buttons.nth(1).textContent())!.trim();

    await buttons.first().focus();
    await page.keyboard.press('Enter');

    await expect(c5.chips).toHaveCount(11);
    await expect(buttons.first()).toBeFocused();
    await expect(buttons.first()).toHaveText(second);
  });

  test('C10 chooses several of 228 answers, capped', async ({ page, expectAccessible }) => {
    const c10 = picker(page, 'library-c10');
    await expect(c10.chips).toHaveCount(0);
    await c10.field.click();
    await expect(c10.options).toHaveCount(50);
    await expect(c10.more).toHaveText('178 more, type to narrow');

    await c10.field.fill('print');
    const count = await c10.options.count();
    expect(count).toBeGreaterThan(1);
    await c10.field.press('Enter');
    await c10.field.press('ArrowDown');
    await c10.field.press('Enter');
    await expect(c10.chips).toHaveCount(2);
    await expect(c10.options).toHaveCount(count);
    await expectAccessible('C10 with two chips, open');

    await c10.field.fill('no answer says this');
    await expect(c10.none).toHaveText('Nothing matches "no answer says this".');
    await c10.field.blur();
    await expect(c10.field).toHaveValue('');
    await expect(c10.chips).toHaveCount(2);
  });

  test('choices past the cap stay as chips, and the words find them', async ({ page }) => {
    const past = picker(page, 'library-several-past-cap');
    await expect(past.chips).toHaveCount(2);
    await past.field.click();
    await expect(past.options).toHaveCount(50);
    await expect(past.list.getByRole('option', { selected: true })).toHaveCount(0);

    await past.field.fill('lily.chang121@');
    await expect(past.options).toHaveCount(1);
    await expect(past.options.first()).toHaveAttribute('aria-selected', 'true');
    await past.field.press('Enter');
    await expect(past.chips).toHaveCount(1);
    await expect(readOutOf(page, 'library-several-past-cap')).not.toContainText('Lily Chang');
  });

  test('a choice no longer offered is its own words, and can be removed', async ({ page }) => {
    const gone = picker(page, 'library-not-offered');
    const words = (await readOutOf(page, 'library-not-offered').textContent())!;
    const address = words.split(', ').at(-1)!;
    await expect(gone.chips.last()).toContainText(address);

    await page.getByRole('button', { name: `Remove ${address}` }).click();
    await expect(gone.chips).toHaveCount(1);
  });

  test('the longest answers wrap inside their chips, whole', async ({ page }) => {
    const long = picker(page, 'library-long-chips');
    await expect(long.chips).toHaveCount(3);
    const panel = page.getByTestId('library-long-chips');
    const room = (await panel.boundingBox())!;
    for (let at = 0; at < 3; at++) {
      const chip = (await long.chips.nth(at).boundingBox())!;
      expect(chip.x + chip.width).toBeLessThanOrEqual(room.x + room.width + 1);
    }
    await expectLaidOut(page, size, 'the longest answers as chips');
  });
});
