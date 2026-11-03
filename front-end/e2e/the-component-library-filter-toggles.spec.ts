import type { Locator } from '@playwright/test';
import { test, expect } from './fixtures';
import { eachWindow, expectLaidOut, openEntry } from './helpers/componentLibrary';

/**
 * The component library's `filter-toggles` entry (T200): `FilterToggles` on the fixture's counts, at
 * a desk and on a phone. Application statuses read their counts and choose one at a time, a view
 * switch has no counts, and several phases press in and out; the row wraps and a label longer than
 * the row wraps inside its toggle, so nothing scrolls sideways, and a phone's toggle is a 44px target.
 */

const readOutOf = (toggles: Locator): Locator =>
  toggles.locator('xpath=ancestor::div[1]').getByTestId('read-out');
const pressedIn = (toggles: Locator): Locator => toggles.locator('button[aria-pressed="true"]');

eachWindow('the filter toggles entry', (size) => {
  test.beforeEach(async ({ page }) => {
    await openEntry(page, 'filter-toggles');
  });

  test('names what it serves, lists its places and ends with the choices left', async ({
    page,
    expectAccessible,
  }) => {
    const serves = page.getByTestId('library-serves');
    await expect(serves).toContainText('L2, L5, L6, L8, L12');
    await expect(serves).toContainText('Applications, Vendors, Payments, Attendance');

    await expect(page.getByTestId('library-toggles-place')).toHaveCount(10);

    const choices = page.getByTestId('choices-for-you');
    await expect(choices).toContainText('Counts');
    await expect(choices).toContainText('pressed look');

    await expectLaidOut(page, size, 'the filter toggles entry');
    await expectAccessible('the filter toggles entry');
  });

  test('one choice: each status reads its count, and a press moves the choice', async ({
    page,
  }) => {
    const statuses = page.getByTestId('library-toggles-statuses');
    await expect(statuses.getByRole('button')).toHaveText([
      'Any status 359',
      'Open 110',
      'Needs follow-up 25',
      'Approved 160',
      'Rejected 64',
    ]);
    await expect(page.getByRole('group', { name: 'Status', exact: true })).toBeVisible();
    await expect(readOutOf(statuses)).toHaveText('Showing: Any status, 359 applications');

    await statuses.getByRole('button', { name: 'Approved 160' }).click();
    await expect(pressedIn(statuses)).toHaveText(['Approved 160']);
    await expect(readOutOf(statuses)).toHaveText('Showing: Approved, 160 applications');
    await expect(pressedIn(statuses).locator('.filter-toggles__words')).toHaveCSS(
      'font-weight',
      '600',
    );

    await statuses.getByRole('button', { name: 'Approved 160' }).click();
    await expect(pressedIn(statuses)).toHaveText(['Approved 160']);
  });

  test('one choice: a view switch has no counts', async ({ page }) => {
    const view = page.getByTestId('library-toggles-view');
    await expect(view.getByRole('button')).toHaveText(['All', 'One by one']);

    await page.getByTestId('library-toggles-view-one').click();
    await expect(pressedIn(view)).toHaveText(['One by one']);
    await expect(readOutOf(view)).toHaveText('View: One by one');
  });

  test('several: a press takes a phase in and out, and none reads as all', async ({ page }) => {
    const phases = page.getByTestId('library-toggles-phases');
    await expect(pressedIn(phases)).toHaveText(['Applications / Review', 'Assignment']);
    await expect(readOutOf(phases)).toHaveText('Phases: Applications / Review, Assignment');

    await phases.getByRole('button', { name: 'Draft' }).click();
    await expect(pressedIn(phases)).toHaveText(['Draft', 'Applications / Review', 'Assignment']);
    await expect(readOutOf(phases)).toHaveText('Phases: Draft, Applications / Review, Assignment');

    await phases.getByRole('button', { name: 'Assignment' }).click();
    await phases.getByRole('button', { name: 'Draft' }).click();
    await phases.getByRole('button', { name: 'Applications / Review' }).click();
    await expect(pressedIn(phases)).toHaveCount(0);
    await expect(readOutOf(phases)).toHaveText('Phases: All phases');
  });

  test('a count of nothing reads as 0', async ({ page }) => {
    const nothing = page.getByTestId('library-toggles-nothing');
    await expect(nothing.getByRole('button')).toHaveText([
      'Approved 160',
      'Refused 0',
      'Cancelled 0',
    ]);
  });

  test('every toggle is a target, and every row stays inside its panel', async ({ page }) => {
    const toggles = page.getByTestId(
      /^library-toggles-(statuses|view|phases|nothing|long|reviewers)$/,
    );
    await expect(toggles).toHaveCount(6);

    const least = size.phone ? 44 : 28;
    for (const group of await toggles.all()) {
      const groupBox = (await group.boundingBox())!;
      for (const toggle of await group.getByRole('button').all()) {
        const box = (await toggle.boundingBox())!;
        const name = await toggle.innerText();
        expect(box.height, name).toBeGreaterThanOrEqual(least);
        if (size.phone) expect(box.width, name).toBeGreaterThanOrEqual(least);
        expect(box.x).toBeGreaterThanOrEqual(groupBox.x);
        expect(box.x + box.width).toBeLessThanOrEqual(groupBox.x + groupBox.width + 0.5);
      }
    }
  });

  test('a long row wraps, and a label longer than the row wraps inside its toggle', async ({
    page,
  }) => {
    const reviewers = page.getByTestId('library-toggles-reviewers').getByRole('button');
    await expect(reviewers).toHaveCount(12);
    const first = (await reviewers.first().boundingBox())!;
    const last = (await reviewers.last().boundingBox())!;
    expect(last.y).toBeGreaterThan(first.y);

    const long = page.getByTestId('library-toggles-long').getByRole('button').first();
    await long.click();
    await expect(long).toHaveAttribute('aria-pressed', 'false');
    const { scrollWidth, clientWidth } = await long.evaluate((button) => ({
      scrollWidth: button.scrollWidth,
      clientWidth: button.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

    await page.getByTestId('library-toggles-phases').getByRole('button').first().click();
    await expectLaidOut(page, size, 'the filter toggles entry, pressed');
  });
});

test('the index links the entry', async ({ page }) => {
  await openEntry(page);
  await expect(page.getByRole('link', { name: 'Filter toggles' })).toHaveAttribute(
    'href',
    '/dev/components/filter-toggles',
  );
});
