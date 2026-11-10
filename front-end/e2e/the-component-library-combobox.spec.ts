import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { sweep } from './helpers/contrastSweep';
import { eachWindow, expectLaidOut, openEntry } from './helpers/componentLibrary';

/**
 * The component library's `combobox` entry (T200): `SearchPicker` grown with a cap, on the
 * fixture's 150 people and 228 options, at a desk and on a phone. C7 finds a person past the cap
 * by their family name or their address, by the keys and by a click; the line under a capped list counts what is left, stays in view as the list
 * scrolls, and is never a choice. C5 chooses reviewers as chips, every choice opening ticked at the
 * top, removed by a chip's button and by Backspace, and C10 chooses among the 228 answers. C1 fixes the
 * import's values through `ChoiceField`, a select at 12 answers and a field at 13, by typing and
 * choosing, its words clearing when they choose nothing, with every value still waiting shown and
 * those already decided behind "Show all". C2 draws a target another column holds muted, found by
 * words and taken by neither a press nor the keys. C3 keeps a new answer as typed, and a field whose words
 * are its value writes them as they are typed and keeps them when it is left.
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

  test('names what it serves, with no choice left to ask', async ({ page }) => {
    const entry = page.getByTestId('library-entry-combobox');
    await expect(entry).toContainText('C2, C6, C7, C8, C9, C12, C13 and C14');

    await expect(page.getByTestId('choices-for-you')).toHaveCount(0);
    await expectLaidOut(page, size, 'the combobox entry');
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

  test('the list shades the edge with more beyond it, and goes at the end', async ({ page }) => {
    const c7 = picker(page, 'library-c7');
    await c7.field.click();

    const rows = page.getByTestId('library-c7-list-rows');
    const top = page.getByTestId('library-c7-list-shade-top');
    const bottom = page.getByTestId('library-c7-list-shade-bottom');
    await expect(bottom).toBeVisible();
    await expect(top).toHaveCount(0);

    // Its foot stands on the line under the list, which no shade lies over.
    const shade = (await bottom.boundingBox())!;
    const line = (await c7.more.boundingBox())!;
    expect(shade.y + shade.height).toBeCloseTo(line.y, 0);

    await rows.hover();
    await page.mouse.wheel(0, 1000);
    await expect(top).toBeVisible();
    await expect(bottom).toBeVisible();

    await page.mouse.wheel(0, 100000);
    await expect(bottom).toHaveCount(0);
    await expect(top).toBeVisible();
    await expect(c7.more).toBeVisible();
  });

  test('the keys bring the active row into view, its words clear of a shade', async ({ page }) => {
    const c7 = picker(page, 'library-c7');
    await c7.field.click();

    const rows = page.getByTestId('library-c7-list-rows');
    const words = c7.list.locator('.search-picker-option--active .search-picker-option-label');
    const box = async (locator: Locator) => (await locator.boundingBox())!;
    const list = await box(rows);
    const DEPTH = 12;

    // Far enough to scroll, and short of the last row, where the bottom shade has gone.
    const down = 20;
    for (let press = 0; press < down; press++) {
      await c7.field.press('ArrowDown');
      const seen = await box(words);
      expect(seen.y + seen.height, `row ${press + 2}, going down`).toBeLessThanOrEqual(
        list.y + list.height - DEPTH + 0.5,
      );
      expect(seen.y, `row ${press + 2}, going down`).toBeGreaterThanOrEqual(list.y);
    }
    expect(await rows.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

    // Back up, short of the first row, where the top shade has gone.
    for (let press = 0; press < down - 1; press++) {
      await c7.field.press('ArrowUp');
      const seen = await box(words);
      expect(seen.y, `row ${down - press}, going up`).toBeGreaterThanOrEqual(list.y + DEPTH - 0.5);
    }

    // Held down to the last row, and held up to the first: the shade has gone at each end.
    for (let press = 0; press < 60; press++) await c7.field.press('ArrowDown');
    await expect(page.getByTestId('library-c7-list-shade-bottom')).toHaveCount(0);
    for (let press = 0; press < 60; press++) await c7.field.press('ArrowUp');
    await expect(page.getByTestId('library-c7-list-shade-top')).toHaveCount(0);
  });

  test('a row under the pointer stays where it stands', async ({ page }) => {
    const c7 = picker(page, 'library-c7');
    await c7.field.click();

    const rows = page.getByTestId('library-c7-list-rows');
    const list = (await rows.boundingBox())!;
    const scrolled = () => rows.evaluate((el) => el.scrollTop);
    const before = await scrolled();
    // Moved a pixel at a time along the list's foot, under its shade.
    for (const x of [20, 21, 22, 23]) await page.mouse.move(list.x + x, list.y + list.height - 4);
    await expect(c7.list.locator('.search-picker-option--active')).toBeVisible();
    expect(await scrolled()).toBe(before);
  });

  test('Tab leaves the field for what follows it, and the open list is no stop', async ({
    page,
  }) => {
    const c7 = picker(page, 'library-c7');
    await c7.field.click();
    await expect(c7.more).toBeVisible();

    await c7.field.press('Tab');

    await expect(c7.list).toHaveCount(0);
    const onAControl = await page.evaluate(() =>
      document.activeElement?.matches('a, button, input, select, textarea, [tabindex="0"]'),
    );
    expect(onAControl).toBe(true);
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
    await expect(under.options.nth(2)).toHaveText(/^[^\s@]+@example\.com$/);
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

  test('a list over what follows moves nothing', async ({ page }) => {
    const over = picker(page, 'library-list-over');
    const readOut = readOutOf(page, 'library-list-over');
    /** Where it stands on the page, since a click on the field may scroll to it. */
    const where = () =>
      readOut.evaluate((element) => {
        const { x, y } = element.getBoundingClientRect();
        return { x, y: y + window.scrollY };
      });
    const before = await where();

    await over.field.click();

    await expect(over.options).toHaveCount(50);
    expect(await where()).toEqual(before);
    await expectLaidOut(page, size, 'a list over what follows');
  });

  test('a choice that holds stays under words, and the field names it again', async ({ page }) => {
    const holds = picker(page, 'library-holds');
    const readOut = readOutOf(page, 'library-holds');
    const chosen = await holds.field.inputValue();
    await expect(readOut).toHaveText(`Chosen: ${chosen}`);

    await holds.field.fill(FAMILY_NAME);
    await expect(holds.options).toHaveCount(3);
    await expect(readOut).toHaveText(`Chosen: ${chosen}`);
    await holds.field.press('Escape');
    await expect(holds.field).toHaveValue(chosen);

    await holds.field.fill(FAMILY_NAME);
    await holds.options.first().click();
    await expect(holds.field).toHaveValue(/Phillips/);
    await expect(readOut).toContainText('Phillips');
  });

  test('a picker with no choices never opens', async ({ page }) => {
    const none = picker(page, 'library-no-choices');
    await none.field.click();

    await expect(none.field).toHaveAttribute('aria-expanded', 'false');
    await expect(none.list).toHaveCount(0);
  });

  test('several choices name what they serve', async ({ page }) => {
    await expect(page.getByTestId('library-entry-combobox')).toContainText('C5, C10, C11 and C12');
  });

  test('C5 opens with its 12 chips, and every choice ticked at the top of the list', async ({
    page,
  }) => {
    const c5 = picker(page, 'library-c5');
    await expect(c5.chips).toHaveCount(12);
    // By address, as an account holds no name.
    await expect(c5.chips.first()).toContainText('@example.com');

    await c5.field.click();
    await expect(c5.options).toHaveCount(50);
    const ticked = c5.list.getByRole('option', { selected: true });
    await expect(ticked).toHaveCount(12);
    for (let at = 0; at < 12; at++) {
      await expect(c5.options.nth(at)).toHaveAttribute('aria-selected', 'true');
    }
    await expect(c5.options.nth(12)).toHaveAttribute('aria-selected', 'false');
  });

  test('a press past an open list lands on what lies below it', async ({ page }) => {
    const c7 = picker(page, 'library-c7');
    const below = picker(page, 'library-options');
    await c7.field.click();
    await expect(c7.list).toBeVisible();

    await below.field.click();

    await expect(c7.list).toBeHidden();
    await expect(below.field).toBeFocused();
    await expect(below.list).toBeVisible();
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
    for (const expected of [13, 14, 15]) {
      await free.first().click();
      await expect(c5.chips).toHaveCount(expected);
      await expect(c5.list).toBeVisible();
      await expect(c5.options).toHaveCount(50);
    }
    const shown = (await readOut.textContent())!.replace('Chosen:', '').trim();
    const [first, second, third] = shown.split(', ').slice(-3) as [string, string, string];
    await expect(c5.chips.last()).toContainText(third);

    await expectLaidOut(page, size, 'C5 with fifteen chips, open');
    await expectAccessible('C5 with fifteen chips, open');

    // A chip's button: the list stays open and the field keeps its focus.
    await page.getByTestId('library-c5-chip-remove').nth(13).click();
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
    const ticks = page.getByTestId('library-c5-option-tick');
    const ticked = await ticks.count();
    const row = c5.list.getByRole('option', { selected: true }).first();
    const value = await row.getAttribute('data-value');
    await expect(row.getByTestId('library-c5-option-tick')).toBeVisible();

    await row.click();

    await expect(c5.chips).toHaveCount(11);
    await expect(ticks).toHaveCount(ticked - 1);
    await expect(c5.list.locator(`[data-value="${value}"]`)).toHaveAttribute(
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
    // The line stands beside the list, not in it: a listbox holds options and groups only.
    await expect(c10.list.getByRole('listbox')).not.toContainText('Nothing matches');
    await expectAccessible('C10 open, nothing matches');
    await c10.field.blur();
    await expect(c10.field).toHaveValue('');
    await expect(c10.chips).toHaveCount(2);
  });

  test('choices past the cap lead the list, ticked, and the words find them', async ({ page }) => {
    const past = picker(page, 'library-several-past-cap');
    await expect(past.chips).toHaveCount(2);
    await past.field.click();
    await expect(past.options).toHaveCount(50);
    await expect(past.list.getByRole('option', { selected: true })).toHaveCount(2);
    await expect(past.options.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(past.options.nth(2)).toHaveAttribute('aria-selected', 'false');

    await past.field.fill('lily.chang121@');
    await expect(past.options).toHaveCount(1);
    await expect(past.options.first()).toHaveAttribute('aria-selected', 'true');
    await past.field.press('Enter');
    await expect(past.chips).toHaveCount(1);
    await expect(readOutOf(page, 'library-several-past-cap')).not.toContainText('lily.chang121@');
  });

  test("a chip's own words read (you), the list beside them saying You", async ({ page }) => {
    const mine = picker(page, 'library-chip-words');
    await expect(mine.chips.first()).toContainText('(you)');
    await expect(mine.chips.first().getByRole('button')).not.toContainText('(you)');
    await mine.field.click();
    await expect(mine.options.first()).toContainText('You');
  });

  test("a person's row and chip draw their address as the product's do", async ({ page }) => {
    const mine = picker(page, 'library-chip-words');
    await mine.field.click();
    for (const words of [
      mine.chips.first().locator('.search-picker-chip-label'),
      mine.chips.nth(1).locator('.search-picker-chip-label'),
      mine.options.first().locator('.search-picker-option-label'),
      mine.options.nth(1).locator('.search-picker-option-label'),
    ]) {
      await expect(words.locator('.email-address')).toHaveCount(2);
    }
  });

  test('disabled, it takes nothing', async ({ page }) => {
    const off = picker(page, 'library-disabled');
    await expect(off.field).toBeDisabled();
    for (const button of await off.chips.getByRole('button').all()) {
      await expect(button).toBeDisabled();
    }
    await expect(off.list).toHaveCount(0);
  });

  test('a choice no longer offered is its own words, and can be removed', async ({ page }) => {
    const gone = picker(page, 'library-not-offered');
    const words = (await readOutOf(page, 'library-not-offered').textContent())!;
    const address = words.split(', ').at(-1)!;
    await expect(gone.chips.last()).toContainText(address);

    await page.getByTestId('library-not-offered-chip-remove').last().click();
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

  test('typed text names what it serves', async ({ page }) => {
    await expect(page.getByTestId('library-entry-combobox')).toContainText('C3 and F08');
  });

  test('words differing from an option only in capitals take it, and leaving keeps them', async ({
    page,
  }) => {
    const c3 = picker(page, 'library-c3');
    const readOut = readOutOf(page, 'library-c3');

    await c3.field.fill('stickers');
    await expect(c3.options.first()).toHaveText('Stickers');
    await expect(c3.list).not.toContainText('Use "');
    await c3.field.press('Tab');
    await expect(readOut).toHaveText('Answer: Stickers');
    await expect(c3.field).toHaveValue('Stickers');

    await c3.field.fill('Hand-poured candles from Example');
    await c3.field.press('Tab');
    await expect(readOut).toHaveText('Answer: Hand-poured candles from Example');
    await expect(c3.field).toHaveValue('Hand-poured candles from Example');
  });

  test('a pick-from-list field clears words not chosen', async ({ page }) => {
    const c7 = picker(page, 'library-c7');
    await c7.field.fill('not a person');
    await c7.field.press('Tab');
    await expect(c7.field).toHaveValue('');
  });

  test('C1 is a select at 12 answers and a field at 13', async ({ page }) => {
    const select = page.getByTestId('library-c1-select');
    // The question's first 12, "Choose…" and "Ignore this value".
    await expect(select.locator('select').locator('option')).toHaveCount(14);
    await expect(select.locator('option').nth(1)).toHaveText('Ignore this value');
    const answer = (await select.locator('option').nth(2).getAttribute('value'))!;
    await select.locator('select').selectOption(answer);
    await expect(select.getByTestId('read-out')).toHaveText(`Fix: ${answer}`);

    const field = page.getByTestId('library-c1-field');
    await expect(field.locator('select')).toHaveCount(0);
    await expect(field.locator('option')).toHaveCount(0);
    await field.locator('[data-testid$="-input"]').click();
    // The question's first 13, and "Ignore this value", all under the cap.
    const rows = field.locator('[data-testid$="-option"]');
    await expect(rows).toHaveCount(14);
    await expect(rows.first()).toHaveText('Ignore this value');
    await rows.nth(1).click();
    await expect(field.getByTestId('read-out')).toHaveText(`Fix: ${answer}`);
  });

  test('every word on the entry reaches AA, a value fix on its tint and its open list too', async ({
    page,
  }) => {
    await expect(page.getByTestId('library-c1-field')).toContainText('did not match');
    await picker(page, 'library-c1-fix-0').field.click();
    await expect(picker(page, 'library-c1-fix-0').options).toHaveCount(50);
    const { failures, checked } = await sweep(page);
    expect(checked).toBeGreaterThan(0);
    expect(failures).toEqual([]);
  });

  test('C1 fixes two values by typing and choosing, and words not chosen clear', async ({
    page,
    expectAccessible,
  }) => {
    const fix = (at: number) => picker(page, `library-c1-fix-${at}`);
    const readOut = (at: number) => readOutOf(page, `library-c1-fix-${at}`);
    const fixed = page.getByTestId('library-c1-fixed');
    await expect(readOut(0)).toHaveText('Fix: nothing');
    await expect(fixed).toHaveText('Fixed: 0 of 7');

    // By the keys: the first match is the row the keys start on.
    await fix(0).field.fill('sticker');
    const match = (await fix(0).options.first().textContent())!.trim();
    await fix(0).field.press('Enter');
    await expect(fix(0).field).toHaveValue(match);
    await expect(readOut(0)).toHaveText(`Fix: ${match}`);

    // By a click, with the row's whole list capped until the words narrow it.
    await fix(1).field.click();
    await expect(fix(1).options).toHaveCount(50);
    await expect(fix(1).more).toHaveText('179 more, type to narrow');
    await expectLaidOut(page, size, 'a value fix open');
    await expectAccessible('a value fix open, capped');
    await fix(1).field.fill('Keychains');
    await expect(fix(1).options.first()).toHaveText('Keychains');
    await fix(1).options.first().click();
    await expect(fix(1).field).toHaveValue('Keychains');
    await expect(readOut(1)).toHaveText('Fix: Keychains');

    // Words that are no answer offer no row of their own, and go on leaving the field.
    await fix(2).field.fill('Hand-poured soap');
    await expect(fix(2).options).toHaveCount(0);
    await expect(fix(2).none).toHaveText('Nothing matches "Hand-poured soap".');
    await fix(2).field.press('Tab');
    await expect(fix(2).field).toHaveValue('');
    await expect(fix(2).list).toHaveCount(0);
    await expect(readOut(2)).toHaveText('Fix: nothing');

    await expect(fixed).toHaveText('Fixed: 2 of 7');
    await expectLaidOut(page, size, 'two values fixed');
  });

  test('C1 opens its list over the rows below, and no row moves', async ({ page }) => {
    const fix = picker(page, 'library-c1-fix-1');
    const below = picker(page, 'library-c1-fix-2').field;
    await fix.field.scrollIntoViewIfNeeded();
    const before = await below.boundingBox();

    await fix.field.click();
    await expect(fix.options.first()).toBeVisible();
    expect(await below.boundingBox()).toEqual(before);

    const field = (await fix.field.boundingBox())!;
    const list = (await fix.list.boundingBox())!;
    expect(list.x + list.width).toBeCloseTo(field.x + field.width, 0);
    expect(list.x).toBeGreaterThanOrEqual(0);
  });

  test('C13 lets the role it holds go, and offers that only while one holds', async ({ page }) => {
    const c13 = picker(page, 'library-c13-none');
    await c13.field.click();
    await expect(c13.options.first()).toHaveText('No role');
    await c13.options.first().click();
    await expect(c13.field).toHaveValue('');
    await expect(c13.field).toHaveAttribute('placeholder', 'Choose a role');
    await c13.field.click();
    await expect(c13.options.first()).not.toHaveText('No role');
    await c13.field.press('Escape');
  });

  test('C12 adds each choice and stands ready for the next, "<All others>" first', async ({
    page,
    expectAccessible,
  }) => {
    const c12 = picker(page, 'library-c12');
    await c12.field.click();
    await expect(c12.options).toHaveCount(50);
    await expect(c12.options.first()).toHaveText('<All others>');
    await expectLaidOut(page, size, 'C12 open');
    await expectAccessible('C12 open');

    await c12.options.nth(1).click();
    await expect(c12.list).toHaveCount(0);
    await expect(c12.field).toHaveValue('');
    await expect(c12.field).toBeFocused();

    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(c12.field).toHaveValue('');
    await expect(c12.field).toBeFocused();
    await expect(readOutOf(page, 'library-c12')).toContainText('<All others>');

    await page.keyboard.press('ArrowDown');
    await expect(c12.options.first()).not.toHaveText('<All others>');
  });

  test('C2 shows a taken target, which neither a press nor the keys take', async ({
    page,
    expectAccessible,
  }) => {
    const c2 = picker(page, 'library-c2');
    await expect(c2.field).toHaveValue('Ignore this column');
    await c2.field.fill('confirm');

    const taken = c2.options;
    await expect(taken).toHaveCount(1);
    await expect(taken).toHaveAttribute('aria-disabled', 'true');
    await expect(taken).toContainText('Mapped from "I certify that I designed');
    await expectLaidOut(page, size, 'C2 open on a taken target');
    await expectAccessible('C2 open on a taken target');
    const { failures } = await sweep(page);
    expect(failures).toEqual([]);

    // Forced, since Playwright itself will not press what is `aria-disabled`; a person can.
    await taken.click({ force: true });
    await c2.field.press('Enter');
    await c2.field.press('Tab');
    await expect(c2.field).toHaveValue('Ignore this column');
    await expect(readOutOf(page, 'library-c2')).toHaveText('Maps to: Ignored');

    // The first row these words find is taken, so Enter takes the first that is not.
    await c2.field.fill('an');
    await expect(c2.options.first()).toHaveAttribute('data-value', 'email');
    await c2.field.press('Enter');
    await expect(readOutOf(page, 'library-c2')).toHaveText('Maps to: dates');
  });

  test('C1 can ignore a value, as today', async ({ page }) => {
    const fix = picker(page, 'library-c1-fix-3');
    await fix.field.click();
    await expect(fix.options.first()).toHaveText('Ignore this value');
    await fix.field.press('Enter');
    await expect(fix.field).toHaveValue('Ignore this value');
    await expect(readOutOf(page, 'library-c1-fix-3')).toHaveText('Fix: Ignore this value');
  });

  test('C1 shows every waiting value, and 6 decided then "Show all 36", fixes kept', async ({
    page,
  }) => {
    const rows = page.getByTestId('library-c1-value');
    const button = page.getByTestId('library-c1-show-all');
    const fixed = page.getByTestId('library-c1-fixed');
    await expect(page.getByTestId('library-c1-waiting')).toHaveText('7 values still waiting');
    await expect(page.getByTestId('library-c1-decided')).toHaveText('36 values already decided');
    await expect(rows).toHaveCount(7 + 6);
    await expect(button).toHaveText('Show all 36');
    await expect(readOutOf(page, 'library-c1-fix-6')).toHaveText('Fix: nothing');
    await expect(readOutOf(page, 'library-c1-fix-7')).toHaveText('Fix: Ignore this value');

    await picker(page, 'library-c1-fix-5').field.fill('Stickers');
    await picker(page, 'library-c1-fix-5').field.press('Enter');

    await button.click();
    await expect(rows).toHaveCount(43);
    await expect(button).toHaveText('Show fewer');
    await expectLaidOut(page, size, 'every value to fix');

    const lastRow = picker(page, 'library-c1-fix-42');
    await lastRow.field.fill('Keychains');
    await lastRow.field.press('Enter');
    await expect(readOutOf(page, 'library-c1-fix-42')).toHaveText('Fix: Keychains');
    await expect(fixed).toHaveText('Fixed: 1 of 7');

    await button.click();
    await expect(rows).toHaveCount(7 + 6);
    await expect(button).toHaveText('Show all 36');
    await expect(fixed).toHaveText('Fixed: 1 of 7');
    await expect(picker(page, 'library-c1-fix-5').field).toHaveValue(/Stickers/);
  });

  test('C3 keeps a new answer as typed, and offers no row for one it has', async ({ page }) => {
    const c3 = picker(page, 'library-c3');
    const readOut = readOutOf(page, 'library-c3');

    await c3.field.fill('Stickers');
    await expect(c3.options.first()).toHaveText('Stickers');
    await expect(c3.list).not.toContainText('Use "');

    await c3.field.fill('Hand-poured soap');
    await expect(c3.options).toHaveText(['Use "Hand-poured soap"']);
    await c3.options.first().click();
    await expect(c3.field).toHaveValue('Hand-poured soap');
    await expect(readOut).toHaveText('Answer: Hand-poured soap');
  });

  test('a kept answer shows in the field, and Enter keeps it', async ({ page }) => {
    const kept = picker(page, 'library-typed-kept');
    await expect(kept.field).not.toHaveValue('');
    const words = await kept.field.inputValue();

    await kept.field.click();
    await expect(kept.options).toHaveCount(50);
    await kept.field.press('Enter');
    await expect(kept.field).toHaveValue(words);
    await expect(readOutOf(page, 'library-typed-kept')).toHaveText(`Answer: ${words}`);
  });

  test('with no options yet, the list opens for words', async ({ page }) => {
    const none = picker(page, 'library-typed-first');
    await none.field.click();
    await expect(none.list).toHaveCount(0);

    await none.field.fill('A first answer');
    await expect(none.options).toHaveText(['Use "A first answer"']);
    await none.field.press('Enter');
    await expect(readOutOf(page, 'library-typed-first')).toHaveText('Answer: A first answer');
  });

  test('words left in a field whose words are its value reach the read-out', async ({
    page,
    expectAccessible,
  }) => {
    const written = picker(page, 'library-words-value');
    const readOut = readOutOf(page, 'library-words-value');

    await written.field.click();
    await expect(written.options).toHaveCount(228);
    await expectLaidOut(page, size, 'a field whose words are its value, open');
    await expectAccessible('a field whose words are its value, open');

    await written.field.pressSequentially('Hand-poured ');
    await expect(written.field).toHaveValue('Hand-poured ');
    await expect(readOut).toHaveText('Answer: Hand-poured');
    await expect(written.options.first()).toHaveText('Use "Hand-poured"');

    await written.field.pressSequentially('soap ');
    await expect(readOut).toHaveText('Answer: Hand-poured soap');

    await written.field.press('Escape');
    await expect(written.list).toHaveCount(0);
    await expect(written.field).toHaveValue('Hand-poured soap ');

    await written.field.blur();
    await expect(written.field).toHaveValue('Hand-poured soap');
    await expect(readOut).toHaveText('Answer: Hand-poured soap');

    await written.field.fill('');
    await expect(readOut).toHaveText('Answer: nothing');
  });

  test("a row's words stand in the middle of its height", async ({ page }) => {
    const written = picker(page, 'library-words-value');
    await written.field.click();
    const off = await written.options.first().evaluate((row) => {
      const words = row.querySelector('.search-picker-option-label')!.getBoundingClientRect();
      const box = row.getBoundingClientRect();
      return Math.abs(words.top + words.height / 2 - (box.top + box.height / 2));
    });
    expect(off).toBeLessThanOrEqual(1);
  });

  test("a chosen row's tick stands on the first line of its words, however they wrap", async ({
    page,
  }) => {
    const long = picker(page, 'library-long-chips');
    // Past the cap until typed for: the longest answers, chosen, so their rows carry a tick.
    await expect(long.chips).toHaveCount(3);
    const [longest] = (await long.chips.allInnerTexts()).sort((a, b) => b.length - a.length);
    await long.field.fill(longest!.trim().slice(0, 20));
    const rows = long.options.filter({ has: page.locator('.search-picker-option-tick') });
    await expect(rows.first()).toBeVisible();
    // No answer in the fixture is long enough to wrap by itself, so the list is narrowed to make it.
    await long.list.evaluate((list) => {
      list.style.width = '140px';
    });
    const measured = await rows.evaluateAll((elements) =>
      elements.map((element) => {
        const range = document.createRange();
        range.selectNodeContents(element.querySelector('.search-picker-option-label')!);
        const rects = [...range.getClientRects()];
        const tick = element.querySelector('.search-picker-option-tick')!.getBoundingClientRect();
        return {
          off: Math.abs(rects[0]!.top + rects[0]!.height / 2 - (tick.top + tick.height / 2)),
          lines: new Set(rects.map((rect) => Math.round(rect.top))).size,
        };
      }),
    );
    expect(Math.max(...measured.map(({ off }) => off))).toBeLessThanOrEqual(1);
    expect(Math.max(...measured.map(({ lines }) => lines))).toBeGreaterThan(1);
  });

  test('several, a typed answer is a chip of its own', async ({ page, expectAccessible }) => {
    const chips = picker(page, 'library-typed-chips');
    const readOut = readOutOf(page, 'library-typed-chips');

    await chips.field.fill('Hand-poured soap');
    await chips.field.press('Enter');
    await expect(chips.chips).toHaveCount(1);
    await expect(chips.chips.first()).toContainText('Hand-poured soap');
    await expect(readOut).toHaveText('Chosen: Hand-poured soap');
    await expect(chips.options.first()).toHaveAttribute('aria-selected', 'true');
    await expectLaidOut(page, size, 'a typed answer as a chip');
    await expectAccessible('a typed answer as a chip, open');

    await chips.field.fill('Stickers');
    await chips.field.press('Enter');
    await expect(chips.chips).toHaveCount(2);

    await page.getByTestId('library-typed-chips-chip-remove').first().click();
    await expect(readOut).toHaveText('Chosen: Stickers');
  });
});
