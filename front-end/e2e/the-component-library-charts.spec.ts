import { test, expect } from './fixtures';
import { rowLayout } from './helpers/barLedger';
import { eachWindow, expectLaidOut, openEntry } from './helpers/componentLibrary';
import { inTheWindow } from './helpers/phoneWindow';

/**
 * The component library's `charts` entry (T201), at a desk and on a phone: the Stats tab's charts on
 * the fixture's data, starting with its answers' bars, each answer one line in a card wider than
 * 32rem and stacked below it, folded past 8 with the most chosen first.
 */

/** The fixture's question, its answers most chosen first. */
const ANSWERS = 228;
const MOST_CHOSEN = 'Stickers';
const SECOND_CHOSEN = 'Art prints';
const QUESTION = 'What kinds of work will you sell?';
const SHOWN = 8;

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
