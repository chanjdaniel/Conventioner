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

  test('names what it serves, draws one page first and ends with the choices left', async ({
    page,
    expectAccessible,
  }) => {
    await expect(page.getByTestId('library-serves')).toContainText('L1, L2, L5, L6, L10, L12, C6');

    await expect(countOf(page, 'library-l2')).toHaveText('Showing 50 of 359');
    await expect(rowsOf(page, 'library-l2')).toHaveCount(50);
    await expect(page.getByTestId('library-application-row')).toHaveCount(50);
    await expect(countOf(page, 'library-l1')).toHaveText('Showing 50 of 150');
    await expect(rowsOf(page, 'library-l1')).toHaveCount(50);

    const choices = page.getByTestId('choices-for-you');
    await expect(choices).toContainText('Page size');
    await expect(choices).toContainText('Find threshold');
    await expect(choices).toContainText('count line');
    await expect(choices).toContainText('Show all');
    await expect(choices).toContainText('in the address');

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
    await expect(page).toHaveURL(/[?&]find=singh(&|$)/);

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
    await expect(page).not.toHaveURL(/[?&]find=/);
    await expect(count).toHaveText('Showing 50 of 160');

    const more = page.getByTestId('library-l2-more');
    await expect(more).toHaveText('Show 50 more');
    await press(more);
    await expect(count).toHaveText('Showing 100 of 160');
    await press(more);
    await expect(count).toHaveText('Showing 150 of 160');
    await expect(more).toHaveText('Show 10 more');
    await press(more);
    await expect(count).toHaveText('160 applications');
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
    await expect(row.getByTestId('library-application-row')).toBeFocused();
  });

  test('"Assigned to" narrows to one reviewer\'s share, and the toggles count that share', async ({
    page,
  }) => {
    const { press } = inTheWindow(size);
    const picker = page.getByTestId('library-l2-assigned');
    const count = countOf(page, 'library-l2');

    await picker.click();
    await page.getByTestId('library-l2-assigned-option').first().waitFor();
    // Me, Anyone and the 11 other reviewers: past a native select's short set.
    await expect(page.getByTestId('library-l2-assigned-option')).toHaveCount(13);
    await press(page.getByTestId('library-l2-assigned-option').nth(2));
    await expect(count).toHaveText('30 applications');
    await expect(rowsOf(page, 'library-l2')).toHaveCount(30);
    await expect(page.getByTestId('library-l2-status-all')).toHaveText('Any status 30');
  });

  test("a switch shows today's every row on the same filters, and back", async ({ page }) => {
    const { press } = inTheWindow(size);
    await press(page.getByTestId('library-l2-status-needs_follow_up'));
    await expect(countOf(page, 'library-l2')).toHaveText('25 applications');

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
    const name = await first.getByTestId('library-l1-name').innerText();
    await expect(role).toHaveAccessibleName(`${name}'s role`);
    await expect(page.getByTestId('read-out').filter({ hasText: 'Last change:' })).toHaveText(
      `Last change: ${name} is now Editor`,
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
    await expect(page).toHaveURL(/[?&]person=example\.com(&|$)/);
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
