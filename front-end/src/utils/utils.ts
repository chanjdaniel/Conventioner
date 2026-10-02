import { MONTH_NAMES } from './calendarMonth';
/**
 * How a date is written, everywhere.
 *
 * Two kinds of date exist in this product and they must not be formatted by the same code:
 *
 * A **market date** is a calendar day ("YYYY-MM-DD"). The market happens on that day where the
 * market is, so every viewer on earth must see the same day. Formatted with pure UTC math and
 * never converted through a timezone. (An earlier implementation pinned the string to a
 * hardcoded -08:00 offset and rendered it in the viewer's local timezone, which showed the
 * previous day to anyone west of UTC-8. `front-end/e2e/date-display-timezone.spec.ts` pins this.)
 *
 * A **timestamp** is an instant - when an application was submitted, when a vendor checked in.
 * That one *is* local to whoever is reading it, because it answers "when did this happen to me".
 *
 * There is one long form and one short form of each, and nothing formats a date any other way.
 * There used to be ten copies of this spread across the views, and a market date was written five
 * different ways across six screens - including one, the editor where you type it in, that left
 * the year off entirely, so a 2026 market and a 2025 market were indistinguishable at the point
 * of entry.
 */

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const MONTHS = MONTH_NAMES;

/** A calendar day as a UTC instant, or null when the string is not one. */
function calendarDay(dateString: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateString ?? '').trim());
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * A market date in full: "Saturday, November 21, 2026".
 *
 * Returns null for an empty string, and the input unchanged for anything that is not a calendar
 * day - a heading the organizer typed themselves is better shown as they wrote it than as
 * "Invalid Date".
 */
export function getFormattedDate(dateString: string): string | null {
  if (!dateString) return null;
  const date = calendarDay(dateString);
  if (!date) return dateString;
  const month = MONTHS[date.getUTCMonth()];
  return `${DAYS[date.getUTCDay()]}, ${month} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

/** A market date where a column heading or a stat row has no room for the long form: "Nov 21, 2026". */
export function getShortDate(dateString: string): string {
  const date = calendarDay(dateString);
  if (!date) return String(dateString ?? '');
  return `${shortMonth(date)} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

/**
 * When a market runs, in one line: "Nov 21-22, 2026".
 *
 * An organizer identifies a market by when it *runs*, which is why this is on the market row
 * where the creation date used to be. It is a range of the earliest and latest day, in the same
 * family as the short form above rather than a fourth spelling of a date: month abbreviated, year
 * always present, day-of-month collapsed when the two ends share a month and a year.
 *
 * A range says every day between its ends, so two days that are not consecutive are named both -
 * "Oct 3 and 10, 2026" - and a span with gaps in it says how many days it holds (bug 14). "Oct
 * 3-10, 2026" read as eight days for a market on two Saturdays.
 */
export function getDateRange(dates: readonly string[] | undefined | null): string {
  const days = (dates ?? [])
    .map((date) => calendarDay(date))
    .filter((day): day is Date => day !== null)
    .sort((a, b) => a.getTime() - b.getTime());

  if (days.length === 0) return 'Not set';

  const first = days[0];
  const last = days[days.length - 1];
  if (first.getTime() === last.getTime()) {
    return `${shortMonth(first)} ${first.getUTCDate()}, ${first.getUTCFullYear()}`;
  }
  if (days.length === 2 && !consecutive(first, last)) return pair(first, last, ' and ', ' and ');
  const extra = days.length > 2 ? ` (${days.length} days)` : '';
  return pair(first, last, '-', ' - ') + extra;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function consecutive(day: Date, next: Date): boolean {
  return next.getTime() - day.getTime() === DAY_MS;
}

function shortMonth(day: Date): string {
  return MONTHS[day.getUTCMonth()].slice(0, 3);
}

/**
 * Two days with what they share said once: the year always, the month when it is the same.
 * `tight` joins two days of one month ("3-10"), `spaced` anything longer ("Oct 31 - Nov 7").
 */
function pair(first: Date, last: Date, tight: string, spaced: string): string {
  const a = `${shortMonth(first)} ${first.getUTCDate()}`;
  const b = `${shortMonth(last)} ${last.getUTCDate()}`;
  if (first.getUTCFullYear() !== last.getUTCFullYear()) {
    return `${a}, ${first.getUTCFullYear()}${spaced}${b}, ${last.getUTCFullYear()}`;
  }
  if (first.getUTCMonth() !== last.getUTCMonth()) {
    return `${a}${spaced}${b}, ${last.getUTCFullYear()}`;
  }
  return `${a}${tight}${last.getUTCDate()}, ${last.getUTCFullYear()}`;
}

/**
 * A CSV column's heading on one line. A Google Form writes the question as asked, line breaks and
 * all, and both ledgers that show one clamp it to two lines with the whole of it as hover text.
 */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** An instant as a Date, or null when it is not one. */
function instant(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** The day an instant fell on, in the reader's own timezone: "Nov 21, 2026". */
export function getTimestampDate(iso: string | null | undefined): string {
  const at = instant(iso);
  if (!at) return iso ? String(iso) : '';
  return at.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * The time of day an instant fell on: "7:20 AM".
 *
 * No seconds. A check-in confirmation read "9/15/2026, 7:20:18 AM", which is a machine's idea of
 * a time; nobody says the seconds out loud, and offering them invites reading precision into a
 * number that has none.
 */
export function getTimestampTime(iso: string | null | undefined): string {
  const at = instant(iso);
  if (!at) return iso ? String(iso) : '';
  return at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** An instant in full: "Nov 21, 2026 at 7:20 AM". */
export function getFormattedTimestamp(iso: string | null | undefined): string {
  const at = instant(iso);
  if (!at) return iso ? String(iso) : '';
  return `${getTimestampDate(iso)} at ${getTimestampTime(iso)}`;
}
