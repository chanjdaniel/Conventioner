import { describe, expect, it } from 'vitest';
import {
  addMonths,
  dateColumns,
  datesByMonth,
  dayParts,
  daysInMonth,
  firstWeekday,
  isoDay,
  monthGrid,
} from '@/utils/calendarMonth';

describe('month arithmetic for market dates', () => {
  it('builds a calendar day as a string, never as an instant', () => {
    // `new Date(2026, 10, 1)` is midnight LOCAL - the 1st in Tokyo and still October in Honolulu.
    expect(isoDay(2026, 10, 1)).toBe('2026-11-01');
    expect(isoDay(2026, 0, 9)).toBe('2026-01-09');
  });

  it('round-trips a stored day', () => {
    expect(dayParts('2026-07-31')).toEqual({ year: 2026, month: 6, day: 31 });
    expect(dayParts('not a day')).toBeNull();
  });

  it('knows how long a month is, including February in a leap year', () => {
    expect(daysInMonth(2026, 1)).toBe(28);
    expect(daysInMonth(2028, 1)).toBe(29);
    expect(daysInMonth(2026, 10)).toBe(30);
    expect(daysInMonth(2026, 11)).toBe(31);
  });

  it('carries across December in both directions', () => {
    expect(addMonths(2026, 11, 1)).toEqual({ year: 2027, month: 0 });
    expect(addMonths(2026, 0, -1)).toEqual({ year: 2025, month: 11 });
    expect(addMonths(2026, 5, 12)).toEqual({ year: 2027, month: 5 });
  });

  it('starts each month on the right weekday', () => {
    // 1 November 2026 is a Sunday; 1 July 2026 is a Wednesday.
    expect(firstWeekday(2026, 10)).toBe(0);
    expect(firstWeekday(2026, 6)).toBe(3);
  });

  it('lays a month out in whole weeks, padded rather than ragged', () => {
    const weeks = monthGrid(2026, 10);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    expect(weeks.flat().filter(Boolean)).toHaveLength(30);
    expect(weeks[0][0]).toBe('2026-11-01');
    expect(weeks.flat().filter(Boolean).at(-1)).toBe('2026-11-30');
  });

  it('puts every day in the month it belongs to, at both edges', () => {
    // The first and last cells are where a local-offset bug shows up first.
    const july = monthGrid(2026, 6).flat().filter(Boolean) as string[];
    expect(july[0]).toBe('2026-07-01');
    expect(july.at(-1)).toBe('2026-07-31');
    expect(july.every((day) => day.startsWith('2026-07'))).toBe(true);
  });

  it('is always six weeks, so the calendar holds one height from month to month', () => {
    // February 2026 starts on a Sunday and fills exactly four weeks; August 2026 needs six.
    expect(monthGrid(2026, 1)).toHaveLength(6);
    expect(monthGrid(2026, 7)).toHaveLength(6);
    expect(monthGrid(2026, 9)).toHaveLength(6);
    expect(monthGrid(2026, 1).flat().filter(Boolean)).toHaveLength(28);
  });
});

/**
 * The chosen dates, one line per month, beside the calendar (E23/F02/S01). A 20-date market reads
 * as five lines rather than twenty, and each month says its year, so a market that crosses into a
 * new one never shows "Sat, Jan 2" with nothing to say which January.
 */
describe('the chosen dates, grouped by month', () => {
  it('groups by month in date order, whatever order they were chosen in', () => {
    const months = datesByMonth(['2026-11-07', '2026-10-10', '2026-10-03', '2026-11-01']);
    expect(months.map((m) => m.label)).toEqual(['October 2026', 'November 2026']);
    expect(months[0].days).toEqual([
      { day: '2026-10-03', label: 'Sat 3' },
      { day: '2026-10-10', label: 'Sat 10' },
    ]);
    expect(months[1].days.map((d) => d.label)).toEqual(['Sun 1', 'Sat 7']);
  });

  it('keeps the year on every month, across a new year', () => {
    const months = datesByMonth(['2027-01-02', '2026-12-26']);
    expect(months.map((m) => m.label)).toEqual(['December 2026', 'January 2027']);
    expect(months.map((m) => [m.year, m.month])).toEqual([
      [2026, 11],
      [2027, 0],
    ]);
  });

  it('names each day by UTC arithmetic, the same in every timezone', () => {
    // 1 November 2026 is a Sunday everywhere; a local-offset parse makes it Saturday in Honolulu.
    expect(datesByMonth(['2026-11-01'])[0].days[0].label).toBe('Sun 1');
  });

  it('ignores a repeat and anything that is not a calendar day', () => {
    const months = datesByMonth(['2026-10-03', '2026-10-03', '', 'not a date']);
    expect(months).toHaveLength(1);
    expect(months[0].days).toHaveLength(1);
  });

  it('is empty for a market with no dates', () => {
    expect(datesByMonth([])).toEqual([]);
  });
});

/**
 * The chosen dates, one row each, flowing top to bottom in columns no taller than the calendar
 * (E28/F01/S01). A line is a month heading or a day; a heading never ends a column, since a month's
 * name with none of its days under it reads as an empty month.
 */
describe('the chosen dates, flowed into columns', () => {
  const lines = (columns: ReturnType<typeof dateColumns>) =>
    columns.map((column) => column.map((line) => line.label));

  it('is one column when everything fits', () => {
    const months = datesByMonth(['2026-10-03', '2026-10-10', '2026-11-07']);
    expect(lines(dateColumns(months, { lines: 10, columns: 4 }))).toEqual([
      ['October 2026', 'Sat 3', 'Sat 10', 'November 2026', 'Sat 7'],
    ]);
  });

  it('fills a column to its height, then the next', () => {
    const months = datesByMonth(['2026-10-03', '2026-10-10', '2026-10-17', '2026-10-24']);
    expect(lines(dateColumns(months, { lines: 3, columns: 4 }))).toEqual([
      ['October 2026', 'Sat 3', 'Sat 10'],
      ['Sat 17', 'Sat 24'],
    ]);
  });

  it('carries a heading that would end a column over to the next, with its first day', () => {
    const months = datesByMonth(['2026-10-03', '2026-10-10', '2026-11-07']);
    expect(lines(dateColumns(months, { lines: 4, columns: 4 }))).toEqual([
      ['October 2026', 'Sat 3', 'Sat 10'],
      ['November 2026', 'Sat 7'],
    ]);
  });

  it('grows the columns taller rather than running past the width it has', () => {
    const days = Array.from({ length: 12 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`);
    const columns = dateColumns(datesByMonth(days), { lines: 3, columns: 2 });
    expect(columns).toHaveLength(2);
    expect(columns.flat()).toHaveLength(13);
    expect(columns[0].length).toBeGreaterThanOrEqual(columns[1].length);
  });

  it('says which month each line belongs to, so a heading can show its month', () => {
    const [column] = dateColumns(datesByMonth(['2026-12-26', '2027-01-02']), {
      lines: 10,
      columns: 1,
    });
    expect(column.map((line) => [line.kind, line.year, line.month])).toEqual([
      ['month', 2026, 11],
      ['day', 2026, 11],
      ['month', 2027, 0],
      ['day', 2027, 0],
    ]);
  });

  it('is no columns for a market with no dates, and survives a nonsense room', () => {
    expect(dateColumns([], { lines: 10, columns: 3 })).toEqual([]);
    const months = datesByMonth(['2026-10-03', '2026-10-10']);
    expect(lines(dateColumns(months, { lines: 0, columns: 0 }))).toEqual([
      ['October 2026', 'Sat 3', 'Sat 10'],
    ]);
  });
});
