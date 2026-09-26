import { describe, expect, it } from 'vitest';
import {
  addMonths,
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
