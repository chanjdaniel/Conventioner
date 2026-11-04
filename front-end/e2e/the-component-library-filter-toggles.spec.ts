import type { Locator } from '@playwright/test';
import { test, expect } from './fixtures';
import { eachWindow, expectLaidOut, openEntry } from './helpers/componentLibrary';
import { inTheWindow } from './helpers/phoneWindow';

/**
 * The component library's `filter-toggles` entry (T200): `FilterToggles` on the fixture's counts, at
 * a desk and on a phone. Application statuses read their counts and choose one at a time, a view
 * switch has no counts, and several phases press in and out; pressing the chosen toggle again lets
 * it go, in every row, by pointer and by keyboard; the row wraps and a label longer than the row wraps inside its toggle, so
 * nothing scrolls sideways, and a phone's toggle is a 44px target.
 */

const readOutOf = (toggles: Locator): Locator =>
  toggles.locator('xpath=ancestor::div[1]').getByTestId('read-out');
const pressedIn = (toggles: Locator): Locator => toggles.getByRole('button', { pressed: true });

eachWindow('the filter toggles entry', (size) => {
  test.beforeEach(async ({ page }) => {
    await openEntry(page, 'filter-toggles');
  });

  test('names what it serves and lists its places, with no choices left', async ({
    page,
    expectAccessible,
  }) => {
    const serves = page.getByTestId('library-serves');
    await expect(serves).toContainText('L2, L5, L6, L8, L12');
    await expect(serves).toContainText('Applications, Vendors, Payments, Attendance');

    await expect(page.getByTestId('library-toggles-place')).toHaveCount(10);

    await expect(page.getByTestId('choices-for-you')).toHaveCount(0);

    await expectLaidOut(page, size, 'the filter toggles entry');
    await expectAccessible('the filter toggles entry');
  });

  test('one choice: each status reads its count, and a press moves the choice', async ({
    page,
  }) => {
    const { press } = inTheWindow(size);
    const statuses = page.getByTestId('library-toggles-statuses');
    const approved = page.getByTestId('library-toggles-statuses-reviewer_approved');

    await expect(statuses).toHaveAccessibleName('Status');
    await expect(statuses.getByRole('button')).toHaveText([
      'Any status 359',
      'Open 110',
      'Needs follow-up 25',
      'Approved 160',
      'Rejected 64',
    ]);
    await expect(approved).toHaveAccessibleName('Approved 160');
    await expect(readOutOf(statuses)).toHaveText('Showing: Any status, 359 applications');

    await press(approved);
    await expect(pressedIn(statuses)).toHaveText(['Approved 160']);
    await expect(readOutOf(statuses)).toHaveText('Showing: Approved, 160 applications');
    await expect(approved.getByTestId('library-toggles-statuses-words')).toHaveCSS(
      'font-weight',
      '600',
    );

    // Pressed again it lets go, back to the row's All toggle, which itself has nowhere to go.
    await press(approved);
    await expect(pressedIn(statuses)).toHaveText(['Any status 359']);
    await expect(readOutOf(statuses)).toHaveText('Showing: Any status, 359 applications');
    await press(page.getByTestId('library-toggles-statuses-all'));
    await expect(pressedIn(statuses)).toHaveText(['Any status 359']);
  });

  test("today's row beside it has no counts, and draws the same pressed look", async ({ page }) => {
    const today = page.getByTestId('library-toggles-today');
    await expect(today.getByRole('button')).toHaveText([
      'Any status',
      'Open',
      'Needs follow-up',
      'Approved',
      'Rejected',
    ]);
    const look = (toggle: Locator) =>
      toggle.evaluate((button) => {
        const { backgroundColor, borderColor, color, fontWeight } = getComputedStyle(button);
        return { backgroundColor, borderColor, color, fontWeight };
      });
    expect(await look(pressedIn(today))).toEqual(
      await look(pressedIn(page.getByTestId('library-toggles-statuses'))),
    );
  });

  test('one choice: a view switch has no counts', async ({ page }) => {
    const view = page.getByTestId('library-toggles-view');
    await expect(view.getByRole('button')).toHaveText(['All', 'One by one']);

    await inTheWindow(size).press(page.getByTestId('library-toggles-view-one'));
    await expect(pressedIn(view)).toHaveText(['One by one']);
    await expect(readOutOf(view)).toHaveText('View: One by one');

    await inTheWindow(size).press(page.getByTestId('library-toggles-view-one'));
    await expect(pressedIn(view)).toHaveText(['All']);
  });

  test('one choice with no All toggle: letting go presses nothing and reads as all', async ({
    page,
  }) => {
    const { press } = inTheWindow(size);
    const nothing = page.getByTestId('library-toggles-zero');
    await expect(pressedIn(nothing)).toHaveText(['Approved 160']);

    await press(nothing.getByRole('button', { name: 'Approved 160' }));
    await expect(pressedIn(nothing)).toHaveCount(0);
    await expect(readOutOf(nothing)).toHaveText('Showing: All');
  });

  test('several: a press takes a phase in and out, and none reads as all', async ({ page }) => {
    const { press } = inTheWindow(size);
    const phases = page.getByTestId('library-toggles-phases');
    const phase = (id: string) => page.getByTestId(`library-toggles-phases-${id}`);
    await expect(pressedIn(phases)).toHaveText(['Applications / Review', 'Assignment']);
    await expect(readOutOf(phases)).toHaveText('Phases: Applications / Review, Assignment');

    await press(phase('draft'));
    await expect(pressedIn(phases)).toHaveText(['Draft', 'Applications / Review', 'Assignment']);
    await expect(readOutOf(phases)).toHaveText('Phases: Draft, Applications / Review, Assignment');

    // Each press lands before the next: a row rewraps as a toggle's weight changes.
    await press(phase('assignment'));
    await expect(phase('assignment')).toHaveAttribute('aria-pressed', 'false');
    await press(phase('draft'));
    await expect(phase('draft')).toHaveAttribute('aria-pressed', 'false');
    await press(phase('applications'));
    await expect(phase('applications')).toHaveAttribute('aria-pressed', 'false');
    await expect(pressedIn(phases)).toHaveCount(0);
    await expect(readOutOf(phases)).toHaveText('Phases: All phases');
  });

  // A key press lands on the toggle in focus, so each kind of row keeps focus there as it lets go.
  test('by keyboard, a row with an All toggle lets go to it, focus staying put', async ({
    page,
  }) => {
    const statuses = page.getByTestId('library-toggles-statuses');
    const approved = page.getByTestId('library-toggles-statuses-reviewer_approved');

    await approved.press('Enter');
    await expect(pressedIn(statuses)).toHaveText(['Approved 160']);
    await expect(approved).toBeFocused();

    await approved.press('Space');
    await expect(approved).toHaveAttribute('aria-pressed', 'false');
    await expect(pressedIn(statuses)).toHaveText(['Any status 359']);
    await expect(approved).toBeFocused();
  });

  test('by keyboard, a row with no All toggle lets go to nothing, focus staying put', async ({
    page,
  }) => {
    const nothing = page.getByTestId('library-toggles-zero');
    const approved = nothing.getByRole('button', { name: 'Approved 160' });

    await approved.press('Space');
    await expect(pressedIn(nothing)).toHaveCount(0);
    await expect(readOutOf(nothing)).toHaveText('Showing: All');
    await expect(approved).toBeFocused();
  });

  test('by keyboard, a row of several lets one go, focus staying put', async ({ page }) => {
    const phases = page.getByTestId('library-toggles-phases');
    const assignment = page.getByTestId('library-toggles-phases-assignment');

    await assignment.press('Enter');
    await expect(pressedIn(phases)).toHaveText(['Applications / Review']);
    await expect(assignment).toBeFocused();
  });

  test('a count of nothing reads as 0', async ({ page }) => {
    const nothing = page.getByTestId('library-toggles-zero');
    await expect(nothing.getByRole('button')).toHaveText([
      'Approved 160',
      'Refused 0',
      'Cancelled 0',
    ]);
  });

  test('every toggle is a target, and every row stays inside its panel', async ({ page }) => {
    const toggles = page.getByTestId(
      /^library-toggles-(statuses|view|phases|zero|long|reviewers)$/,
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
    await expect(reviewers.first()).toHaveText(/^[^\s@]+@example\.com \d+$/);
    const first = (await reviewers.first().boundingBox())!;
    const last = (await reviewers.last().boundingBox())!;
    expect(last.y).toBeGreaterThan(first.y);

    const long = page.getByTestId('library-toggles-long').getByRole('button').first();
    await inTheWindow(size).press(long);
    await expect(long).toHaveAttribute('aria-pressed', 'false');
    const { scrollWidth, clientWidth } = await long.evaluate((button) => ({
      scrollWidth: button.scrollWidth,
      clientWidth: button.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

    await inTheWindow(size).press(page.getByTestId('library-toggles-phases-draft'));
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
