import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { ensureTestOrg, loginViaApi, seedMarketWithVendors } from './helpers/seeds';
import { savePlan } from './helpers/savePlan';
import { marketSetupPath } from './helpers/marketScreens';
import type { Page } from '@playwright/test';

/**
 * The market dates sit beside their calendar (E23/F02/S01, from the-plan-uses-its-space ticket
 * 02), a row each under their month (E28/F01/S01).
 *
 * The chosen dates used to be chips centred under a 420px calendar in a 1,330px card, leaving most
 * of its width empty, then chips on one line per month. They are one row per date now, flowing top
 * to bottom into columns no taller than the calendar, and every month says its year.
 */

/** Twenty Saturdays and Sundays from October 2026 into February 2027: five months, two years. */
const DATES = Array.from({ length: 20 }, (_, i) => {
  const day = new Date(Date.UTC(2026, 9, 3 + i * 7 + (i % 5 === 4 ? 1 : 0)));
  return { date: day.toISOString().slice(0, 10) };
});

const PLAN = {
  priority: [],
  marketDates: DATES,
  tiers: [{ id: 1, name: 'Standard' }],
  locations: [{ name: 'Main Hall' }],
  sections: [
    { name: 'Hall', location: { name: 'Main Hall' }, tier: { id: 1, name: 'Standard' }, count: 10 },
  ],
  assignmentOptions: { maxAssignmentsPerVendor: null, maxHalfTableProportionPerSection: null },
};

async function geometry(page: Page) {
  return page.evaluate(() => {
    const box = (id: string) =>
      (document.querySelector(`[data-testid="${id}"]`) as HTMLElement).getBoundingClientRect();
    const calendar = box('setup-dates-calendar');
    const list = box('setup-dates-summary');
    const columns = Array.from(document.querySelectorAll('[data-testid="setup-dates-column"]')).map(
      (column) => ({
        left: Math.round(column.getBoundingClientRect().left),
        lines: Array.from(column.children).map((line) => ({
          text: (line.textContent ?? '').replace('×', '').trim(),
          month: line.classList.contains('dates-month'),
          top: Math.round(line.getBoundingClientRect().top),
        })),
      }),
    );
    return {
      columns,
      calendarRight: Math.round(calendar.right),
      calendarBottom: Math.round(calendar.bottom),
      calendarLeft: Math.round(calendar.left),
      listLeft: Math.round(list.left),
      listTop: Math.round(list.top),
      listBottom: Math.round(list.bottom),
    };
  });
}

test.describe('The market dates, a row each beside the calendar', () => {
  let marketId: string;

  test.beforeEach(async ({ request }) => {
    await ensureTestOrg(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
    const seeded = await seedMarketWithVendors(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );
    marketId = seeded.marketId;
    await loginViaApi(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
    await savePlan(request, BACKEND_URL, TEST_USER.email, marketId, PLAN);
  });

  test('twenty dates are a row each, in columns beside the calendar, no taller than it', async ({
    authenticatedPage: page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(marketSetupPath(marketId, 'setup'));
    await expect(page.getByTestId('setup-dates-count')).toHaveText('20 market days', {
      timeout: 15000,
    });

    await expect(page.getByTestId('setup-dates-month-name')).toHaveText([
      'October 2026',
      'November 2026',
      'December 2026',
      'January 2027',
      'February 2027',
    ]);
    // A day reads short, and says the whole date on hover.
    await expect(page.getByTestId('setup-dates-date-display-0')).toContainText('Sat 3');
    await expect(page.getByTestId('setup-dates-date-display-0')).toHaveAttribute(
      'title',
      'Saturday, October 3, 2026',
    );

    const g = await geometry(page);
    expect(g.listLeft, 'the list sits beside the calendar').toBeGreaterThan(g.calendarRight);
    expect(g.listBottom, 'the list is no taller than the calendar').toBeLessThanOrEqual(
      g.calendarBottom,
    );

    const lines = g.columns.flatMap((column) => column.lines);
    expect(
      lines.filter((line) => !line.month),
      'one row per date',
    ).toHaveLength(20);
    expect(g.columns.length, 'more than one column').toBeGreaterThan(1);
    for (const column of g.columns) {
      expect(column.lines.at(-1)?.month, 'no heading alone at the foot of a column').toBe(false);
      const tops = column.lines.map((line) => line.top);
      expect(tops, 'top to bottom').toEqual([...tops].sort((a, b) => a - b));
    }
    const lefts = g.columns.map((column) => column.left);
    expect(lefts, 'then the next column, to the right').toEqual([...lefts].sort((a, b) => a - b));
    // Read in order, the rows are the dates in order.
    expect(
      lines
        .filter((line) => !line.month)
        .map((line) => line.text)
        .slice(0, 3),
    ).toEqual(['Sat 3', 'Sat 10', 'Sat 17']);
  });

  test('a month moves the calendar to it and is marked; × removes a day', async ({
    authenticatedPage: page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(marketSetupPath(marketId, 'setup'));
    await expect(page.getByTestId('setup-dates-month')).toHaveText('October 2026', {
      timeout: 15000,
    });

    const january = page.getByTestId('setup-dates-month-name').filter({ hasText: 'January 2027' });
    await january.click();
    await expect(page.getByTestId('setup-dates-month')).toHaveText('January 2027');
    await expect(january).toHaveAttribute('aria-current', 'date');

    await page.getByTestId('setup-dates-remove-2026-10-03').click();
    await expect(page.getByTestId('setup-dates-count')).toHaveText('19 market days');
    await expect(page.getByTestId('setup-dates-day-2026-10-03')).toHaveCount(0);
  });

  /**
   * The app holds a 1000px minimum width, at which the dates card still has room for both, so the
   * room is narrowed directly: the rule follows the room the card has, not the window.
   */
  test('with too little room beside the calendar, the list goes under it', async ({
    authenticatedPage: page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(marketSetupPath(marketId, 'setup'));
    await expect(page.getByTestId('setup-dates-count')).toBeVisible({ timeout: 15000 });
    await page.addStyleTag({ content: '[data-testid="setup-dates"] { width: 600px; }' });

    const g = await geometry(page);
    expect(g.listTop).toBeGreaterThanOrEqual(g.calendarBottom);
    expect(g.listLeft).toBe(g.calendarLeft);
  });
});
