/**
 * The Stats tab's Check-in (T201): who has come, from Market Days on. The server counts it
 * (`count_check_in` in `back-end/market_stats.py`, by `check_in_counts` beside the Attendance
 * roster): per market date the vendors expected and those checked in, as the door counts its day,
 * and `came`, the vendors checked in on any date; `null` until the market has reached Market Days.
 *
 * Here those counts become the section's card, a row per market day drawn as a `MeterBar` of
 * checked in, its mark at the day's expected, every row on one scale, the card's largest expected,
 * so the days compare. Beside each row, how many are missing, linking to Attendance on that day
 * (`?date=`), in the door's words: "not yet" while the day may still come, "did not come" once it
 * is over, past or archived. A day with nobody missing says so and links nowhere, and a day nobody
 * is assigned to draws no bar.
 */
import type { RouteLocationRaw } from 'vue-router';
import { MarketPhase } from '@/assets/types/datatypes';
import { marketPath } from '@/utils/market';
import { calendarToday } from '@/utils/marketGuide';
import { getFormattedDate } from '@/utils/utils';

export interface CheckInDay {
  /** The plan's own spelling of the date. */
  date: string;
  /** The vendors the stored assignment seats that day, a seat each, as the door counts them. */
  expected: number;
  checkedIn: number;
}

/** The server's `checkIn`; `null` until the market has reached Market Days. */
export interface CheckInCounts {
  dates: CheckInDay[];
  /** The vendors checked in on any date, each once. */
  came: number;
}

export interface CheckInRow {
  key: string;
  label: string;
  /** The row's text: "18 of 24 checked in", or "Nobody is assigned". */
  words: string;
  /** Checked in, drawn as the bar; `null` on a day nobody is assigned to, so no bar. */
  checkedIn: number | null;
  /** Expected, drawn as the bar's mark. */
  expected: number;
  /** Those not in, beside the row; `null` on a day nobody is assigned to. */
  missing: { words: string; to: RouteLocationRaw | null } | null;
}

export interface CheckInCard {
  rows: CheckInRow[];
  /** What every bar of the card is drawn against: its largest expected. */
  scale: number;
}

/** The check-in card; `null` before Market Days or for a plan of no date. */
export function checkInRows(
  checkIn: CheckInCounts | null,
  marketId: string,
  phase: string,
  today: string = calendarToday(),
): CheckInCard | null {
  if (!checkIn?.dates.length) return null;
  const attendance = marketPath(marketId, 'attendance');
  return {
    rows: checkIn.dates.map(({ date, expected, checkedIn }) => {
      const label = getFormattedDate(date) ?? date;
      if (!expected) {
        return {
          key: date,
          label,
          words: 'Nobody is assigned',
          checkedIn: null,
          expected,
          missing: null,
        };
      }
      const left = expected - checkedIn;
      const over = phase === MarketPhase.Archived || date < today;
      return {
        key: date,
        label,
        words: `${checkedIn} of ${expected} checked in`,
        checkedIn,
        expected,
        missing: left
          ? {
              words: `${left} ${over ? 'did not come' : 'not yet'}`,
              to: { path: attendance, query: { date } },
            }
          : { words: 'Everyone is in', to: null },
      };
    }),
    scale: Math.max(0, ...checkIn.dates.map((day) => day.expected)),
  };
}
