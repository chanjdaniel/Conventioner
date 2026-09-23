import { describe, expect, it } from 'vitest';
import {
  addMonths,
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
