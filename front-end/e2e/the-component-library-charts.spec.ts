import { test, expect } from './fixtures';
import { rowLayout } from './helpers/barLedger';
import { eachWindow, expectLaidOut, openEntry } from './helpers/componentLibrary';
import { inTheWindow } from './helpers/phoneWindow';

/**
 * The component library's `charts` entry (T201), at a desk and on a phone: the Stats tab's charts on
 * the fixture's data. Its 359 applications over time, a column a day from the opening to the close
 * and a column a week over a long intake, each one image named by its sentence with its numbers in a
 * table; the review as one split bar read by its legend; the room, a meter bar a day and a tier
 * with its mark at the tables, read by its words; and the answers' bars, each answer one
 * line in a card wider than 32rem and stacked below it, folded past 8 with the most chosen first.
 */

/** The fixture's question, its answers most chosen first. */
const ANSWERS = 228;
const MOST_CHOSEN = 'Stickers';
const SECOND_CHOSEN = 'Art prints';
const QUESTION = 'What kinds of work will you sell?';
const SHOWN = 8;

/** The fixture's 359 applications came in over 17 days, Feb 25 to Mar 12, 2024. */
const BY_DAY = '359 applications from Feb 23 to Mar 15, 2024, most on Mar 4: 31';
const BY_WEEK =
  '359 applications from Dec 25, 2023 to Mar 17, 2024, most in the week of Mar 4 to 10: 179';

eachWindow('the charts entry', (size) => {
  const { press } = inTheWindow(size);

  test.beforeEach(async ({ page }) => {
    await openEntry(page, 'charts');
  });

  test('names what it serves and draws the answers folded past 8, most chosen first', async ({
    page,
    expectAccessible,
  }) => {
    await expect(page.getByTestId('library-serves')).toContainText('Stats');

    const rows = page.getByTestId('library-charts-answers');
    await expect(rows).toHaveCount(SHOWN);
    await expect(rows.first()).toContainText(MOST_CHOSEN);
    await expect(rows.nth(1)).toContainText(SECOND_CHOSEN);
    await expect(page.getByTestId('library-charts-answers-fold')).toHaveText(
      `${ANSWERS - SHOWN} more answers to ${QUESTION}`,
    );

    await expectLaidOut(page, size, 'the charts entry');
    await expectAccessible('the charts entry');
  });

  test('applications over time: a column a day, the quiet days gaps, its numbers a table', async ({
    page,
  }) => {
    const plot = page.getByTestId('library-charts-days-plot');
    await expect(plot).toHaveAttribute('role', 'img');
    await expect(plot).toHaveAttribute('aria-label', BY_DAY);
    // Opened two days before the first response and closed three after the last.
    const columns = page.getByTestId('library-charts-days-column');
    await expect(columns).toHaveCount(22);
    const counts = await columns.evaluateAll((all) => all.map((c) => c.getAttribute('data-count')));
    expect(counts.slice(0, 2)).toEqual(['0', '0']);
    expect(counts.slice(-3)).toEqual(['0', '0', '0']);
    await expect(page.getByTestId('library-charts-days-most')).toHaveText('31');
    await expect(page.getByTestId('library-charts-days-axis')).toHaveText(/Feb 23\s*Mar 15/);

    // Every column inside its card, however narrow the phone: none past the card's edge.
    const plotBox = (await plot.boundingBox())!;
    const last = (await columns.last().boundingBox())!;
    expect(last.x + last.width).toBeLessThanOrEqual(plotBox.x + plotBox.width + 0.5);

    const rows = page.getByTestId('library-charts-days-row');
    await expect(rows.first()).toBeHidden();
    await press(page.getByTestId('library-charts-days-numbers').getByText('Numbers by day'));
    await expect(rows).toHaveCount(22);
    await expect(rows.first()).toHaveText(/Fri, Feb 23, 2024\s*0/);
    await expect(rows.nth(10)).toHaveText(/Mon, Mar 4, 2024\s*31/);
  });

  test('a long intake is a column a week, Monday to Sunday', async ({ page }) => {
    await expect(page.getByTestId('library-charts-weeks-plot')).toHaveAttribute(
      'aria-label',
      BY_WEEK,
    );
    await expect(page.getByTestId('library-charts-weeks-column')).toHaveCount(12);
    await press(page.getByTestId('library-charts-weeks-numbers').getByText('Numbers by week'));
    await expect(page.getByTestId('library-charts-weeks-row').first()).toHaveText(
      /^Dec 25 to 31, 2023\s*0$/,
    );
  });

  test('the review is one split bar, read by its legend, a zero told and not linked', async ({
    page,
  }) => {
    const bar = page.getByTestId('library-charts-review-bar');
    await expect(bar).toHaveAttribute('aria-hidden', 'true');
    await expect(page.getByTestId('library-charts-review-bar-part')).toHaveCount(4);
    await expect(page.getByTestId('library-charts-review')).toHaveText([
      'Open: 110, 31% of applications',
      'Needs follow-up: 25, 7% of applications',
      'Approved: 160, 45% of applications',
      'Rejected: 64, 18% of applications',
    ]);
    // The parts share the bar by count, the gaps between them coming out of every part alike.
    const widths = await page
      .getByTestId('library-charts-review-bar-part')
      .evaluateAll((parts) => parts.map((part) => part.getBoundingClientRect().width));
    const whole = widths.reduce((sum, width) => sum + width, 0);
    expect(widths[2] / whole).toBeCloseTo(160 / 359, 1);

    const zero = page.locator(
      '[data-testid="library-charts-review-zero"][data-value="needs_follow_up"]',
    );
    await expect(zero).toHaveText('Needs follow-up: 0, 0% of applications');
    await expect(zero.locator('xpath=self::a')).toHaveCount(0);
    await expect(page.getByTestId('library-charts-review-zero-bar-part')).toHaveCount(3);
  });

  test('the room is a meter bar a row, read by its words, the mark at the tables and past it the attention fill', async ({
    page,
  }) => {
    const days = page.getByTestId('library-charts-room-days');
    await expect(days).toHaveText([
      'Monday, April 22, 2024: 190 asking, 59 tables',
      'Tuesday, April 23, 2024: 166.5 asking, 59 tables',
      'Wednesday, April 24, 2024: 184 asking, 59 tables',
      'Thursday, April 25, 2024: 171 asking, 59 tables',
    ]);
    await expect(page.getByTestId('library-charts-room-tiers')).toHaveText([
      'Gold: 538 asking, 124 table-days',
      'Silver: 438.5 asking, 112 table-days',
      'Bronze: 232 asking, 0 table-days',
    ]);
    await expect(page.getByTestId('library-charts-room-days-bar').first()).toHaveAttribute(
      'aria-hidden',
      'true',
    );

    // One scale for the card, its largest asked: Monday's bar fills its track, the mark a third
    // of the way along it, and what is past the mark in the attention fill.
    const monday = days.first();
    const track = (await monday.getByTestId('library-charts-room-days-bar').boundingBox())!;
    const mark = (await monday.getByTestId('library-charts-room-days-mark').boundingBox())!;
    expect((mark.x + mark.width / 2 - track.x) / track.width).toBeCloseTo(59 / 190, 1);
    const past = monday.getByTestId('library-charts-room-days-past');
    await expect(past).toHaveCSS('background-color', 'rgb(189, 134, 25)');
    const pastBox = (await past.boundingBox())!;
    expect(pastBox.x + pastBox.width).toBeCloseTo(track.x + track.width, 0);

    // Before anyone applies: the tables alone, no bar.
    await expect(page.getByTestId('library-charts-room-empty').first()).toHaveText(
      'Monday, April 22, 2024: 59 tables',
    );
    await expect(page.getByTestId('library-charts-room-empty-bar')).toHaveCount(0);
  });

  test('an answer is one line in a wide card at a desk, and stacks on a phone', async ({
    page,
  }) => {
    const rows = page.getByTestId('library-charts-answers');
    await expect(rows).toHaveCount(SHOWN);
    for (const row of await rows.all()) {
      expect(await rowLayout(row), await row.innerText()).toBe(size.phone ? 'stacked' : 'one line');
    }
    if (!size.phone) {
      // One scale for the card: every bar starts and ends where the others do.
      const tracks = await page.getByTestId('library-charts-answers-bar').evaluateAll((bars) =>
        bars.map((bar) => {
          const { left, right } = bar.getBoundingClientRect();
          return `${Math.round(left)}-${Math.round(right)}`;
        }),
      );
      expect(new Set(tracks).size, 'the bars share one track').toBe(1);
    }
  });

  test('a card narrower than 32rem stacks its rows at either width', async ({ page }) => {
    const rows = page.getByTestId('library-charts-narrow');
    await expect(rows).toHaveCount(SHOWN);
    for (const row of await rows.all()) {
      expect(await rowLayout(row), await row.innerText()).toBe('stacked');
    }
  });

  test('a short question shows every answer, with no button', async ({ page }) => {
    await expect(page.getByTestId('library-charts-short')).toHaveCount(5);
    await expect(page.getByTestId('library-charts-short-fold')).toHaveCount(0);
  });

  test('the answers unfold in place and fold again, keeping one line each', async ({
    page,
    expectAccessible,
  }) => {
    const rows = page.getByTestId('library-charts-answers');
    const fold = page.getByTestId('library-charts-answers-fold');

    await press(fold);
    await expect(rows).toHaveCount(ANSWERS);
    await expect(fold).toHaveText(`Show fewer answers to ${QUESTION}`);
    const focusIsOnItsItem = await rows
      .nth(SHOWN)
      .evaluate((row) => row.parentElement === document.activeElement);
    expect(focusIsOnItsItem, 'the first new row has the focus').toBe(true);
    expect(await rowLayout(rows.nth(ANSWERS - 1))).toBe(size.phone ? 'stacked' : 'one line');
    await expectLaidOut(page, size, 'the answers unfolded');
    await expectAccessible('the answers unfolded');

    await fold.scrollIntoViewIfNeeded();
    await press(fold);
    await expect(rows).toHaveCount(SHOWN);
    await expect(fold).toBeFocused();
  });
});
