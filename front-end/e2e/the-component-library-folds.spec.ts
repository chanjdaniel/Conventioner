import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { eachWindow, expectLaidOut, openEntry } from './helpers/componentLibrary';
import { inTheWindow } from './helpers/phoneWindow';
import { settle } from './helpers/settle';

/**
 * The component library's `folds` entry (T200), at a desk and on a phone: L11's bars folded past 10
 * beside today's every bar, and L7's seats by date and section, each section folded past 20. The bars
 * and a section unfold in place and fold again, the focus going to the first new row and then staying
 * on the button, which stays in the window.
 */

/** The fixture's question, its answers most chosen first. */
const ANSWERS = 228;
const MOST_CHOSEN = 'Stickers';
const SECOND_CHOSEN = 'Art prints';
/** The fixture's seats: four dates, each with these sections. */
const DATES = ['2024-04-22', '2024-04-23', '2024-04-24', '2024-04-25'];
const NORTH = 31;
const SOUTH = 28;

const bars = (page: Page, testid: string) => page.getByTestId(testid);
const foldOf = (page: Page, testid: string) => page.getByTestId(`${testid}-fold`);
const section = (date: string, wing: string) => `library-l7-${date}-${wing}`;
const seats = (page: Page, testid: string) => page.getByTestId(`${testid}-row`);

/** The button's top and bottom, inside the window and clear of the shell's sticky header. */
async function expectButtonInTheWindow(page: Page, button: Locator, what: string) {
  await settle(page);
  const box = (await button.boundingBox())!;
  const { height } = page.viewportSize()!;
  expect(box.y, `${what}: its top is in the window`).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height, `${what}: its bottom is in the window`).toBeLessThanOrEqual(height);
  // What is on top at its middle is the button, not a header pinned over it.
  const onTop = await button.evaluate((element) => {
    const { x, y, width, height: tall } = element.getBoundingClientRect();
    const top = document.elementFromPoint(x + width / 2, y + tall / 2);
    return Boolean(top && (element === top || element.contains(top)));
  });
  expect(onTop, `${what}: nothing covers it`).toBe(true);
}

eachWindow('the folds entry', (size) => {
  const { press } = inTheWindow(size);

  test.beforeEach(async ({ page }) => {
    await openEntry(page, 'folds');
  });

  test('names what it serves, draws L11 beside today, and ends with the choices left', async ({
    page,
    expectAccessible,
  }) => {
    await expect(page.getByTestId('library-serves')).toContainText('L7, L11');

    await expect(bars(page, 'library-l11-today')).toHaveCount(ANSWERS);
    await expect(bars(page, 'library-l11')).toHaveCount(10);

    const choices = page.getByTestId('choices-for-you');
    await expect(choices).toContainText('Bars before the fold');
    await expect(choices).toContainText('Unfolding the bars in place, or in a dialog');
    await expect(choices).toContainText('Rows before a group folds');
    await expect(choices).toContainText('Unfolding a section in place');

    await expectLaidOut(page, size, 'the folds entry');
    await expectAccessible('the folds entry');
  });

  test("today's bars scroll in a box a key can reach, so the page goes on", async ({ page }) => {
    const box = page.getByTestId('library-l11-today-box');
    const { scrollHeight, clientHeight } = await box.evaluate((element) => ({
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
    }));
    expect(scrollHeight).toBeGreaterThan(clientHeight);

    await box.focus();
    await page.keyboard.press('End');
    await expect.poll(() => box.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  });

  test('the bars unfold in place, by count, and fold again', async ({ page, expectAccessible }) => {
    const rows = bars(page, 'library-l11');
    const fold = foldOf(page, 'library-l11');
    await expect(rows.first()).toContainText(MOST_CHOSEN);
    await expect(rows.nth(1)).toContainText(SECOND_CHOSEN);
    await expect(fold).toHaveText(`${ANSWERS - 10} more answers`);

    await press(fold);
    await expect(rows).toHaveCount(ANSWERS);
    await expect(fold).toHaveText('Show fewer');
    await expect(rows.first()).toContainText(MOST_CHOSEN);
    await expect(rows.nth(10).locator('xpath=..')).toBeFocused();
    await expectLaidOut(page, size, 'the bars unfolded');
    await expectAccessible('the bars unfolded');

    await fold.scrollIntoViewIfNeeded();
    await press(fold);
    await expect(rows).toHaveCount(10);
    await expect(fold).toHaveText(`${ANSWERS - 10} more answers`);
    await expect(fold).toBeFocused();
    await expectButtonInTheWindow(page, fold, 'the button, folded again');
  });

  test('the fold goes by count whatever order the rows came in', async ({ page }) => {
    const rows = bars(page, 'library-bars-order');
    await expect(rows).toHaveCount(10);
    await expect(rows.first()).toContainText(MOST_CHOSEN);
    await expect(rows.nth(1)).toContainText(SECOND_CHOSEN);
  });

  test('the bars draw no button at the fold or under it, and one past says it singly', async ({
    page,
  }) => {
    await expect(bars(page, 'library-bars-under')).toHaveCount(8);
    await expect(foldOf(page, 'library-bars-under')).toHaveCount(0);
    await expect(bars(page, 'library-bars-at')).toHaveCount(10);
    await expect(foldOf(page, 'library-bars-at')).toHaveCount(0);
    await expect(bars(page, 'library-bars-past')).toHaveCount(10);
    await expect(foldOf(page, 'library-bars-past')).toHaveText('1 more answer');
  });

  test('rows that lead somewhere fold as well, and the first new one still leads there', async ({
    page,
  }) => {
    const rows = bars(page, 'library-bars-links');
    await expect(rows).toHaveCount(2);
    await press(foldOf(page, 'library-bars-links'));
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(2)).toHaveAttribute('href', /\/dev\/components\/folds\?status=/);
  });

  test('every date holds its two sections, each folded past 20', async ({ page }) => {
    for (const date of DATES) {
      for (const [wing, heading, count] of [
        ['north', 'North Wing', NORTH],
        ['south', 'South Wing', SOUTH],
      ] as const) {
        const testid = section(date, wing);
        await expect(page.getByTestId(`${testid}-heading`)).toHaveText(heading);
        await expect(seats(page, testid)).toHaveCount(20);
        await expect(foldOf(page, testid)).toHaveText(`Show all ${count} in ${heading}`);
      }
    }
  });

  test('a section unfolds in place alone, and folds again', async ({ page, expectAccessible }) => {
    const north = section(DATES[0]!, 'north');
    const south = section(DATES[0]!, 'south');
    const fold = foldOf(page, north);

    await press(fold);
    await expect(seats(page, north)).toHaveCount(NORTH);
    await expect(fold).toHaveText('Show fewer');
    await expect(seats(page, north).nth(20)).toBeFocused();
    await expect(seats(page, south)).toHaveCount(20);
    await expect(foldOf(page, south)).toHaveText(`Show all ${SOUTH} in South Wing`);
    await expectLaidOut(page, size, 'a section unfolded');
    await expectAccessible('a section unfolded');

    await fold.scrollIntoViewIfNeeded();
    await press(fold);
    await expect(seats(page, north)).toHaveCount(20);
    await expect(fold).toHaveText(`Show all ${NORTH} in North Wing`);
    await expect(fold).toBeFocused();
    await expectButtonInTheWindow(page, fold, 'the button, folded again');
  });

  test("a seat row is the result's: its code, its size, its name and Change", async ({ page }) => {
    const row = seats(page, section(DATES[0]!, 'north')).first();
    await expect(row).toContainText('N1');
    await expect(row.locator('.chip')).toHaveText('Full Table');
    await expect(row.getByTestId('tables-seat-occupied')).toHaveCount(1);

    await press(row.getByTestId('tables-seat-change'));
    await expect(page.getByTestId('read-out').first()).toContainText('Pressed: Change N1');
    await press(row.getByTestId('tables-seat-vendor'));
    await expect(page.getByTestId('read-out').first()).toContainText('Pressed: The drawer of');
  });

  test('a group shows every row at the fold or under it, and folds one past', async ({ page }) => {
    await expect(seats(page, 'library-group-under')).toHaveCount(12);
    await expect(foldOf(page, 'library-group-under')).toHaveCount(0);
    await expect(seats(page, 'library-group-at')).toHaveCount(20);
    await expect(foldOf(page, 'library-group-at')).toHaveCount(0);
    await expect(seats(page, 'library-group-past')).toHaveCount(20);
    await expect(foldOf(page, 'library-group-past')).toHaveText('Show all 21 in North Wing');
    await expect(seats(page, 'library-group-five')).toHaveCount(5);
  });

  test('a heading longer than the line wraps inside its button', async ({ page }) => {
    const fold = foldOf(page, 'library-group-long');
    await expect(fold).toContainText('Show all 31 in');
    const { scrollWidth, clientWidth } = await fold.evaluate((element) => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }));
    expect(scrollWidth, 'nothing runs out of the button').toBeLessThanOrEqual(clientWidth);
  });
});
