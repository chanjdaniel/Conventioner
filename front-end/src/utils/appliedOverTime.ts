/**
 * Applications over time, as the Stats tab's column chart draws them (T201): how many applied in
 * each day, or each week once the span passes six weeks, so quiet days show as gaps and a late rush
 * stands out.
 *
 * The window runs from the day applications opened (`openedAt`, the phase record's first entry into
 * them), or the first response if that came earlier, as a Google Form's can, to today while the
 * market takes them, a market sent back to them included, or else to the day they closed
 * (`closedAt`). A market out of applications whose record holds no close ends at its last response,
 * so a market that predates the record does not run on to today. A response after the close still
 * shows: the window never cuts one off.
 *
 * A day is the reader's calendar day, as every "today" in the app is (`calendarToday`): the server
 * keeps no time zone for a market, so it sends times and the page makes them days. The days are
 * then carried as `YYYY-MM-DD` strings with UTC arithmetic, so no instant can shift them again.
 */
import { MarketPhase } from '@/assets/types/datatypes';
import { MONTH_NAMES, WEEKDAY_SHORT, dayParts, isoDay } from '@/utils/calendarMonth';
import { DAY_MS } from '@/utils/utils';
import { calendarToday } from '@/utils/marketGuide';

/** What the server sends of when they applied (`back-end/market_stats.py`). */
export interface IntakeTimes {
  /** When each that was not added by hand applied, as stored. */
  submittedAt: string[];
  /** When applications opened and closed, from the phase record; null where it holds none. */
  openedAt: string | null;
  closedAt: string | null;
}

export interface Bucket {
  /** Its first and last day, `YYYY-MM-DD`; the same day for a day's bucket. */
  start: string;
  end: string;
  /** Under the axis: "Oct 3", a week by its Monday. */
  label: string;
  /** In the table: "Sat, Oct 3, 2026", or "Sep 28 to Oct 4, 2026". */
  name: string;
  count: number;
}

export interface AppliedOverTime {
  unit: 'day' | 'week';
  buckets: Bucket[];
  /** Every response with a time it could read. */
  total: number;
  /** The chart in one sentence, for a reader who cannot see it. */
  summary: string;
}

/** Past this many days a column is a week, so the columns stay readable on a phone. */
const MOST_DAYS = 42;


/** A time as a day in the reader's calendar, or null when it is not a time. */
function readersDay(time: string | null | undefined): string | null {
  if (!time) return null;
  const at = new Date(time);
  return Number.isNaN(at.getTime()) ? null : calendarToday(at);
}

function utc(day: string): number {
  const { year, month, day: date } = dayParts(day)!;
  return Date.UTC(year, month, date);
}

function fromUtc(ms: number): string {
  const at = new Date(ms);
  return isoDay(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
}

function addDays(day: string, days: number): string {
  return fromUtc(utc(day) + days * DAY_MS);
}

/** The Monday of the week a day falls in. */
function monday(day: string): string {
  const weekday = new Date(utc(day)).getUTCDay();
  return addDays(day, -((weekday + 6) % 7));
}

function monthDay(day: string): string {
  const { month, day: date } = dayParts(day)!;
  return `${MONTH_NAMES[month].slice(0, 3)} ${date}`;
}

function year(day: string): number {
  return dayParts(day)!.year;
}

/** Two days as a span, what they share said once: "Sep 7 to 13", "Aug 31 to Sep 6". */
function span(start: string, end: string, withYear: boolean): string {
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  if (year(start) !== year(end)) {
    return `${monthDay(start)}, ${year(start)} to ${monthDay(end)}, ${year(end)}`;
  }
  const tail = sameMonth ? String(dayParts(end)!.day) : monthDay(end);
  return `${monthDay(start)} to ${tail}${withYear ? `, ${year(end)}` : ''}`;
}

function dayName(day: string): string {
  return `${WEEKDAY_SHORT[new Date(utc(day)).getUTCDay()]}, ${monthDay(day)}, ${year(day)}`;
}

/**
 * The last day of the window: today while the market takes applications, a market sent back to
 * them included, so the quiet days since show; else the close, else the last response.
 */
function lastDay(times: IntakeTimes, phase: string, today: string, lastResponse: string): string {
  const end =
    phase === MarketPhase.Applications ? today : (readersDay(times.closedAt) ?? lastResponse);
  return end < lastResponse ? lastResponse : end;
}

/** The chart's buckets and summary, or null when nobody applied with a time to draw. */
export function appliedOverTime(
  times: IntakeTimes,
  phase: string,
  today: string = calendarToday(),
): AppliedOverTime | null {
  const days = times.submittedAt.map(readersDay).filter((day): day is string => day !== null);
  if (!days.length) return null;
  days.sort();

  const opened = readersDay(times.openedAt);
  const first = opened && opened < days[0] ? opened : days[0];
  const last = lastDay(times, phase, today, days[days.length - 1]);
  const unit = (utc(last) - utc(first)) / DAY_MS + 1 > MOST_DAYS ? 'week' : 'day';

  const perDay = new Map<string, number>();
  for (const day of days) perDay.set(day, (perDay.get(day) ?? 0) + 1);

  const buckets: Bucket[] = [];
  if (unit === 'day') {
    for (let day = first; day <= last; day = addDays(day, 1)) {
      buckets.push({
        start: day,
        end: day,
        label: monthDay(day),
        name: dayName(day),
        count: perDay.get(day) ?? 0,
      });
    }
  } else {
    for (let start = monday(first); start <= last; start = addDays(start, 7)) {
      const end = addDays(start, 6);
      let count = 0;
      for (let day = start; day <= end; day = addDays(day, 1)) count += perDay.get(day) ?? 0;
      buckets.push({ start, end, label: monthDay(start), name: span(start, end, true), count });
    }
  }

  return { unit, buckets, total: days.length, summary: summary(buckets, unit, days.length) };
}

/** "36 applications from Oct 1 to Nov 11, 2026, most on Oct 3: 12". */
function summary(buckets: Bucket[], unit: 'day' | 'week', total: number): string {
  const counted = `${total} ${total === 1 ? 'application' : 'applications'}`;
  const from = buckets[0].start;
  const to = buckets[buckets.length - 1].end;
  if (from === to) return `${counted} on ${monthDay(from)}, ${year(from)}`;

  // The first of the largest, when two tie.
  const most = buckets.reduce((best, bucket) => (bucket.count > best.count ? bucket : best));
  const when =
    unit === 'day'
      ? `on ${monthDay(most.start)}`
      : `in the week of ${span(most.start, most.end, false)}`;
  return `${counted} from ${span(from, to, true)}, most ${when}: ${most.count}`;
}
