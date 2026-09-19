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

const MONTHS = [
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
  const month = MONTHS[date.getUTCMonth()].slice(0, 3);
  return `${month} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
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
