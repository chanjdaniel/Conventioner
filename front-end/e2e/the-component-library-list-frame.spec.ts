import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { eachWindow, expectLaidOut, openEntry } from './helpers/componentLibrary';
import { inTheWindow } from './helpers/phoneWindow';

/**
 * The component library's `list-frame` entry (T200): `ListFrame` on every fixture application (L2)
 * and the 150 people with access (L1), at a desk and on a phone. An application is found by a family
 * name, narrowed by a status, unfolded page by page until the count line reads all, and the words
 * outlive a reload; the first paint draws one page; each state reads as it should.
 */

const rowsOf = (page: Page, testid: string) => page.getByTestId(`${testid}-row`);
const countOf = (page: Page, testid: string) => page.getByTestId(`${testid}-count`);

eachWindow('the list frame entry', (size) => {
  test.beforeEach(async ({ page }) => {
    await openEntry(page, 'list-frame');
  });

  test('names what it serves and draws one page first', async ({ page, expectAccessible }) => {
    await expect(page.getByTestId('library-serves')).toContainText('L1, L2, L5, L6, L10, L12, C6');

    await expect(countOf(page, 'library-l2')).toHaveText('Showing 50 of 359');
    await expect(rowsOf(page, 'library-l2')).toHaveCount(50);
    await expect(page.getByTestId('library-application-row')).toHaveCount(50);
    await expect(countOf(page, 'library-l1')).toHaveText('Showing 50 of 150');
    await expect(rowsOf(page, 'library-l1')).toHaveCount(50);

    await expectLaidOut(page, size, 'the list frame entry');
    await expectAccessible('the list frame entry');
  });

  test('finds by a family name, filters by a status, unfolds to all, and a reload keeps the words', async ({
    page,
  }) => {
    const { press } = inTheWindow(size);
    const find = page.getByTestId('library-l2-find');
    const count = countOf(page, 'library-l2');
    const rows = rowsOf(page, 'library-l2');

    await expect(find).toHaveAccessibleName('Find by name or address');

    // Typed key by key: each keystroke writes the address, and none may be lost to it.
    await find.pressSequentially('singh');
    await expect(count).toHaveText('9 of 359 match "singh"');
    await expect(rows).toHaveCount(9);
    await expect(page.getByTestId('library-application-name').first()).toContainText('Singh');
    await expect(page).toHaveURL(/[?&]search=singh(&|$)/);

    await page.reload();
    await expect(find).toHaveValue('singh');
    await expect(count).toHaveText('9 of 359 match "singh"');

    await press(page.getByTestId('library-l2-status-reviewer_approved'));
    await expect(count).toHaveText('4 of 160 match "singh"');
    await expect(rows).toHaveCount(4);
    await expect(rows.getByTestId('library-application-status')).toHaveText(
      Array(4).fill('Approved'),
    );

    await find.fill('');
    await expect(page).not.toHaveURL(/[?&]search=/);
    await expect(count).toHaveText('Showing 50 of 160 (359 in all)');

    const more = page.getByTestId('library-l2-more');
    await expect(more).toHaveText('Show 50 more');
    await press(more);
    await expect(count).toHaveText('Showing 100 of 160 (359 in all)');
    await press(more);
    await expect(count).toHaveText('Showing 150 of 160 (359 in all)');
    await expect(more).toHaveText('Show 10 more');
    await press(more);
    await expect(count).toHaveText('160 of 359 applications');
    await expect(rows).toHaveCount(160);
    await expect(more).toHaveCount(0);
    await expectLaidOut(page, size, 'every approved application unfolded');

    await find.fill('s');
    await expect(rows).toHaveCount(50);
  });

  test('the last page hands the focus on, so Tab goes on to the new rows', async ({ page }) => {
    const more = page.getByTestId('library-l2-more');
    await page.getByTestId('library-l2-status-reviewer_rejected').click();
    await expect(more).toHaveText('Show 14 more');
    await more.focus();
    await page.keyboard.press('Enter');
    await expect(more).toHaveCount(0);
    const row = rowsOf(page, 'library-l2').nth(50);
    await expect(row).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(row.getByTestId('library-application-tick')).toBeFocused();
  });

  test('a narrow filter leaves the field where it is, since the threshold counts the whole list', async ({
    page,
  }) => {
    const { press } = inTheWindow(size);
    const find = page.getByTestId('library-l2-find');
    const count = countOf(page, 'library-l2');

    await page.getByTestId('library-l2-assigned').click();
    await press(page.getByTestId('library-l2-assigned-option').nth(2));
    await press(page.getByTestId('library-l2-status-needs_follow_up'));
    await expect(count).toHaveText(/^\d of 359 applications$/);
    await expect(find).toBeVisible();
  });

  test('a change of filter folds the list back to its first page', async ({ page }) => {
    const { press } = inTheWindow(size);
    const rows = rowsOf(page, 'library-l2');
    await press(page.getByTestId('library-l2-more'));
    await expect(rows).toHaveCount(100);

    await press(page.getByTestId('library-l2-status-reviewer_approved'));
    await expect(rows).toHaveCount(50);
  });

  test('"Assigned to" narrows to one reviewer\'s share, and the toggles count that share', async ({
    page,
  }) => {
    const { press } = inTheWindow(size);
    const picker = page.getByTestId('library-l2-assigned');
    const count = countOf(page, 'library-l2');

    await picker.click();
    const options = page.getByTestId('library-l2-assigned-option');
    await options.first().waitFor();
    // Me, Anyone and the 11 other reviewers: past a native select's short set.
    await expect(options).toHaveCount(13);
    await expect(options.first()).toHaveText('Me');
    await expect(options.nth(1)).toHaveText('Anyone');
    const reviewer = options.nth(2);
    const address = (await reviewer.innerText()).trim();
    expect(address).toMatch(/^[^\s@]+@example\.com$/);
    await press(reviewer);
    await expect(count).toHaveText('30 of 359 applications');
    await expect(rowsOf(page, 'library-l2')).toHaveCount(30);
    await expect(page.getByTestId('library-l2-status-all')).toHaveText('Any status 30');
    // The read-out and every row say the one address, as the real filter's label and rows do.
    await expect(page.getByTestId('read-out').filter({ hasText: 'Filters:' })).toHaveText(
      `Filters: Any status, assigned to ${address}`,
    );
    await expect(rowsOf(page, 'library-l2').first()).toContainText(`Reviewer: ${address}`);
  });

  test('"Assigned to" finds a reviewer by their address, and not by a name no account holds', async ({
    page,
  }) => {
    const field = page.getByTestId('library-l2-assigned-input');
    const options = page.getByTestId('library-l2-assigned-option');
    await expect(field).toHaveAttribute('placeholder', 'Type an address…');
    await field.click();
    const address = (await options.nth(2).innerText()).trim();

    await field.fill(address.toUpperCase());
    await expect(options).toHaveText([address]);

    await field.fill('Chloe Walker');
    await expect(options).toHaveCount(0);
    await expect(page.getByTestId('library-l2-assigned-list')).toContainText(
      'None match "Chloe Walker".',
    );

    // "Me" is the reader's own, so their address finds it, and the reader's rows say "you".
    await field.fill('robert.bailey11@example.com');
    await expect(options).toHaveText(['Me']);
    await inTheWindow(size).press(options.first());
    await expect(page.getByTestId('library-l2-count')).toHaveText('30 of 359 applications');
    await expect(page.getByTestId('library-l2-row').first()).toContainText('Reviewer: you');
  });

  test("today's view chooses with the same picker: Me, Anyone, then addresses", async ({
    page,
  }) => {
    const { press } = inTheWindow(size);
    await press(page.getByTestId('library-l2-view-today'));
    const today = page.getByTestId('library-l2-today');
    const field = today.getByTestId('library-l2-today-assigned-input');
    const options = today.getByTestId('library-l2-today-assigned-option');
    await press(field);
    await expect(options).toHaveCount(13);
    const words = await options.allInnerTexts();
    expect(words.slice(0, 2)).toEqual(['Me', 'Anyone']);
    for (const address of words.slice(2)) expect(address).toMatch(/^[^\s@]+@example\.com$/);
    await expectLaidOut(page, size, "today's filter, its list open");

    // One line for the label, even with the longest address chosen.
    const longest = words.reduce((a, b) => (b.length > a.length ? b : a));
    await field.fill(longest);
    await expect(options).toHaveText([longest]);
    await field.press('Enter');
    await expect(field).toHaveValue(longest);
    const label = today.locator('label').filter({ hasText: 'Assigned to' });
    const lines = await label.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return range.getClientRects().length;
    });
    expect(lines).toBe(1);
    await expectLaidOut(page, size, "today's filter on the longest address");
    await expect(today.getByTestId('library-application-row')).toHaveCount(30);
    await expect(today.getByTestId('library-application-row').first()).toContainText(
      `Reviewer: ${longest}`,
    );
  });

  test('words in "Assigned to" only search: the reviewer holds, and the field names them again', async ({
    page,
  }) => {
    const { press } = inTheWindow(size);
    const field = page.getByTestId('library-l2-assigned-input');
    const count = countOf(page, 'library-l2');
    const filters = page.getByTestId('read-out').filter({ hasText: 'Filters:' });
    await field.click();
    const reviewer = page.getByTestId('library-l2-assigned-option').nth(2);
    const address = (await reviewer.innerText()).trim();
    await press(reviewer);
    await expect(count).toHaveText('30 of 359 applications');

    await field.click();
    await field.fill('zzz');
    await expect(page.getByTestId('library-l2-assigned-list')).toContainText('None match "zzz".');
    await expect(count).toHaveText('30 of 359 applications');
    await expect(filters).toContainText(`assigned to ${address}`);

    await field.press('Escape');
    await expect(field).toHaveValue(address);

    await field.fill('zzz');
    await page.getByTestId('library-l2-status-all').focus();
    await expect(field).toHaveValue(address);
    await expect(filters).toContainText(`assigned to ${address}`);
    await expect(rowsOf(page, 'library-l2').first()).toBeVisible();
  });

  test("a switch shows today's every row on the same filters, and back", async ({ page }) => {
    const { press } = inTheWindow(size);
    await press(page.getByTestId('library-l2-status-needs_follow_up'));
    await expect(countOf(page, 'library-l2')).toHaveText('25 of 359 applications');

    await press(page.getByTestId('library-l2-view-today'));
    const today = page.getByTestId('library-l2-today');
    await expect(page.getByTestId('library-l2')).toHaveCount(0);
    await expect(today.getByTestId('library-l2-today-count')).toHaveText('25 of 359');
    await expect(today.getByTestId('library-application-row')).toHaveCount(25);

    await press(today.getByTestId('library-l2-today-status-all'));
    await expect(today.getByTestId('library-application-row')).toHaveCount(359);
    await expectLaidOut(page, size, "today's every row");

    await press(page.getByTestId('library-l2-view-proposed'));
    await expect(rowsOf(page, 'library-l2')).toHaveCount(50);
  });

  test('a row opens, and the line says so', async ({ page }) => {
    const { press } = inTheWindow(size);
    const row = page.getByTestId('library-application-row').first();
    const name = await row.getByTestId('library-application-name').innerText();
    await press(row);
    await expect(page.getByTestId('read-out').filter({ hasText: 'Opened:' })).toHaveText(
      `Opened: ${name}`,
    );
  });

  test('a tick leaves with its row, whether words or a filter take it off the screen', async ({
    page,
  }) => {
    const { press } = inTheWindow(size);
    const selected = page.getByTestId('read-out').filter({ hasText: 'Selected:' });
    const rows = rowsOf(page, 'library-l2');
    await expect(selected).toHaveText('Selected: nothing');

    await rows.first().getByTestId('library-application-tick').check();
    await rows.nth(1).getByTestId('library-application-tick').check();
    await expect(selected).toHaveText('Selected: 2');

    const name = await rows.first().getByTestId('library-application-name').innerText();
    await page.getByTestId('library-l2-find').fill(name);
    await expect(selected).toHaveText('Selected: 1');
    await page.getByTestId('library-l2-find').fill('');
    await expect(selected).toHaveText('Selected: 1');

    await press(page.getByTestId('library-l2-status-reviewer_approved'));
    await rows.first().getByTestId('library-application-tick').check();
    await press(page.getByTestId('library-l2-status-reviewer_rejected'));
    await expect(selected).toHaveText('Selected: nothing');
  });

  test('Select all ticks the rows on screen, and says how many while capped', async ({ page }) => {
    const { press } = inTheWindow(size);
    const selected = page.getByTestId('read-out').filter({ hasText: 'Selected:' });
    const select = page.getByTestId('library-l2-select-all');
    await expect(select).toHaveText('Select all 50 shown');
    await press(select);
    await expect(selected).toHaveText('Selected: 50');

    await press(page.getByTestId('library-l2-more'));
    await expect(select).toHaveText('Select all 100 shown');
    await expect(selected).toHaveText('Selected: 50');

    await page.getByTestId('library-l2-find').fill('singh');
    await expect(select).toHaveText('Select all');
    await expect(rowsOf(page, 'library-l2')).toHaveCount(9);
    await expectLaidOut(page, size, 'Select all, narrowed');
  });

  test('the people: found by address, each row a role select, unfolded to 150', async ({
    page,
  }) => {
    const { press } = inTheWindow(size);
    const count = countOf(page, 'library-l1');
    const rows = rowsOf(page, 'library-l1');

    const first = rows.first();
    const role = first.getByTestId('library-l1-role');
    await expect(role.getByRole('option')).toHaveText(['Owner', 'Admin', 'Editor', 'Viewer']);
    await role.selectOption({ label: 'Editor' });
    const address = await first.getByTestId('library-l1-address').innerText();
    await expect(role).toHaveAccessibleName(`${address}'s role`);
    await expect(page.getByTestId('read-out').filter({ hasText: 'Last change:' })).toHaveText(
      `Last change: ${address} is now Editor`,
    );

    const more = page.getByTestId('library-l1-more');
    await press(more);
    await expect(count).toHaveText('Showing 100 of 150');
    await press(more);
    await expect(count).toHaveText('150 people');
    await expect(rows).toHaveCount(150);
    await expect(more).toHaveCount(0);

    await page.getByTestId('library-l1-find').fill('example.com');
    await expect(count).toHaveText('150 of 150 match "example.com"');
    await expect(rows).toHaveCount(50);
    await expect(page).not.toHaveURL(/example\.com/);
  });

  test('each state reads as it should', async ({ page }) => {
    const { press } = inTheWindow(size);
    await expect(page.getByTestId('library-state-loading-loading')).toHaveText(
      'Loading applications…',
    );

    const failed = page.getByTestId('library-state-failed-read-failed');
    await expect(failed).toContainText('You seem to be offline.');
    await press(page.getByTestId('library-state-failed-retry'));
    await expect(page.getByTestId('read-out').filter({ hasText: 'Try again pressed:' })).toHaveText(
      'Try again pressed: 1',
    );

    await expect(page.getByTestId('library-state-empty-empty')).toHaveText(
      'No applications received yet.',
    );

    await expect(page.getByTestId('library-state-no-match-find')).toHaveValue('Zanzibar');
    await expect(countOf(page, 'library-state-no-match')).toHaveText('Nothing matches "Zanzibar"');
    await expect(rowsOf(page, 'library-state-no-match')).toHaveCount(0);

    await expect(page.getByTestId('library-state-at-threshold-find')).toHaveCount(0);
    await expect(countOf(page, 'library-state-at-threshold')).toHaveText('12 people');
    await expect(page.getByTestId('library-state-past-threshold-find')).toBeVisible();
    await expect(countOf(page, 'library-state-past-threshold')).toHaveText('13 people');
  });
});
