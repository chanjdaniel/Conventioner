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
  // Always six weeks, the most any month spans: a calendar that is four weeks tall in one month
  // and six in the next moves everything under it as the organizer steps through the year, and
  // the list beside it is sized to its height (E28/F01/S01).
  while (cells.length < 42) cells.push(null);

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

/** The months by name, January first: the one list, read by every date the product spells. */
export const MONTH_NAMES = [
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

/** One line of the chosen-dates list: a month's heading, or one of its days. */
export interface DatesLine {
  kind: 'month' | 'day';
  year: number;
  month: number;
  /** "October 2026" for a heading, "Sat 3" for a day. */
  label: string;
  /** The stored `YYYY-MM-DD` of a day; empty on a heading. */
  day: string;
}

/**
 * The chosen dates, one row each under their month, flowed top to bottom into columns
 * (E28/F01/S01).
 *
 * `lines` is how many fit in a column - the calendar's height - and `columns` how many fit across.
 * A heading never ends a column: it moves to the next with its first day, since a month's name
 * with nothing under it reads as an empty month. When the dates need more columns than fit across,
 * the columns grow taller rather than running off the card.
 */
export function dateColumns(
  months: DatesMonth[],
  room: { lines: number; columns: number },
): DatesLine[][] {
  const flow: DatesLine[] = months.flatMap(({ year, month, label, days }) => [
    { kind: 'month' as const, year, month, label, day: '' },
    ...days.map((d) => ({ kind: 'day' as const, year, month, label: d.label, day: d.day })),
  ]);
  if (!flow.length) return [];

  const across = Math.max(1, Math.floor(room.columns));
  // Two is the fewest lines a column can hold and still keep a heading with its first day.
  for (let tall = Math.max(2, Math.floor(room.lines)); ; tall += 1) {
    const columns = flowInto(flow, tall);
    if (columns.length <= across) return columns;
  }
}

function flowInto(flow: DatesLine[], tall: number): DatesLine[][] {
  const columns: DatesLine[][] = [[]];
  for (const line of flow) {
    const column = columns[columns.length - 1];
    const room = tall - column.length;
    if (column.length && (room === 0 || (line.kind === 'month' && room === 1))) {
      columns.push([line]);
    } else {
      column.push(line);
    }
  }
  return columns;
}
