/**
 * Month arithmetic for choosing market dates (E18/F01/S02).
 *
 * A MARKET DATE IS A CALENDAR DAY, NOT AN INSTANT. A stored `YYYY-MM-DD` must render as the same
 * day for every viewer regardless of their timezone, which is why `getFormattedDate` formats with
 * pure UTC maths and why a market date must never be parsed through a local-offset constructor.
 *
 * A calendar does month arithmetic rather than just formatting, which makes it the most likely
 * place in the product to reintroduce that bug: `new Date(2026, 10, 1)` is midnight LOCAL, so in
 * Tokyo it is already the 1st while in Honolulu it is still October. Everything here is UTC, and
 * days are carried as strings so there is no instant to misread.
 *
 * `e2e/date-display-timezone.spec.ts` pins this across Honolulu, Los Angeles and Tokyo.
 */

/** A calendar day as `YYYY-MM-DD`, built without touching local time. */
export function isoDay(year: number, month: number, day: number): string {
  const mm = String(month + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

/** The parts of a stored calendar day, or null when the string is not one. */
export function dayParts(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? '').trim());
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) - 1, day: Number(match[3]) };
}

/** How many days a month has, by UTC arithmetic: day 0 of the next month is the last of this one. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** Which weekday a month starts on, 0 = Sunday. */
export function firstWeekday(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 1)).getUTCDay();
}

/** Step a year/month pair, carrying across December without constructing a local date. */
export function addMonths(
  year: number,
  month: number,
  delta: number,
): { year: number; month: number } {
  const total = year * 12 + month + delta;
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
}

/**
 * The weeks of a month as calendar days, padded with nulls so each row is seven cells.
 *
 * Days are STRINGS, not Dates: a grid of instants is a grid waiting to be read in the wrong
 * timezone, and nothing here needs an instant.
 */
export function monthGrid(year: number, month: number): Array<Array<string | null>> {
  const cells: Array<string | null> = Array(firstWeekday(year, month)).fill(null);
  for (let day = 1; day <= daysInMonth(year, month); day += 1) {
    cells.push(isoDay(year, month, day));
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: Array<Array<string | null>> = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** The month a set of chosen days sits in, or today's - read in UTC, like everything else. */
export function monthOf(days: string[]): { year: number; month: number } {
  const first = days.map(dayParts).find(Boolean);
  if (first) return { year: first.year, month: first.month };
  const now = new Date();
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() };
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface DatesMonth {
  year: number;
  month: number;
  /** "October 2026": the year on every month, so a market crossing a new year reads right. */
  label: string;
  /** "Sat 3". */
  days: Array<{ day: string; label: string }>;
}

/**
 * The chosen dates, one group per month, in date order (E23/F02/S01).
 *
 * A market's dates grow by months rather than by dates in the list beside the calendar, so a
 * 20-date market is five lines. Weekdays come from UTC arithmetic like everything in this file.
 */
export function datesByMonth(days: string[]): DatesMonth[] {
  const unique = [...new Set(days)].filter((day) => dayParts(day)).sort();
  const months: DatesMonth[] = [];
  for (const day of unique) {
    const { year, month, day: date } = dayParts(day)!;
    let group = months[months.length - 1];
    if (!group || group.year !== year || group.month !== month) {
      group = { year, month, label: `${MONTH_NAMES[month]} ${year}`, days: [] };
      months.push(group);
    }
    const weekday = new Date(Date.UTC(year, month, date)).getUTCDay();
    group.days.push({ day, label: `${WEEKDAY_SHORT[weekday]} ${date}` });
  }
  return months;
}
