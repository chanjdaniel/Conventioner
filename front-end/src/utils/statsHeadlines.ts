/**
 * The Stats tab's strip (T201): three or four big-number tiles chosen by the market's phase, the
 * figures that matter in it, each a link to where it is worked on.
 *
 * - Draft: none, so no strip.
 * - Applications: who applied (the Applications tab's All view), who is open to review (its Open
 *   filter, on every reviewer's share, as the review's split bar counts it), and the table-days
 *   asked of the room (the Room section on this page).
 * - Assignment, and results sent: the table-days used (Assignments), who is unassigned (Vendors on
 *   "Unassigned only") and what is still owed (Payments on "Owes").
 * - Market Days: those checked in and those not yet in on the day counted (Attendance on that day),
 *   and what is still owed. The day counted is today when it is a market date, else the next ahead,
 *   else the last, in the reader's calendar, and the tile names it; once it is over its missing
 *   "did not come", in the door's words.
 * - Archived: the vendors who came (Attendance), the table-days used, and what was paid (Payments).
 *
 * Each figure is the server's (`back-end/market_stats.py`), counted by the page it links to, and a
 * tile whose figure is absent is left out: placements before an assignment is stored, money without
 * prices, check-in before Market Days, the room in a plan of no date. A zero whose link would list
 * nothing is told but not linked, as the Assignments page's counts cannot be chosen at zero
 * (E28/F02/S01).
 */
import type { RouteLocationRaw } from 'vue-router';
import { MarketPhase } from '@/assets/types/datatypes';
import { applicantStats } from '@/utils/applicantStats';
import { marketPath } from '@/utils/market';
import { calendarToday } from '@/utils/marketGuide';
import type { MarketStats } from '@/utils/marketStats';
import { money } from '@/utils/payments';
import { getShortDate } from '@/utils/utils';

/** The Assignments page's figures, as the server counts them. */
export interface PlacementHeadlines {
  tableDaysUsed: number;
  tableDays: number;
  tableDaysFree: number;
  unassigned: number;
}

/** The Payments page's figures, in cents, in the market's currency. */
export interface MoneyHeadlines {
  currency: string;
  owedCents: number;
  paidCents: number;
  stillOwedCents: number;
}

export interface Headlines {
  placements: PlacementHeadlines | null;
  money: MoneyHeadlines | null;
}

/** Where a tile leads: another page, or a section of this one, by its element's id. */
export type TileLink = { route: RouteLocationRaw } | { section: string };

export interface Tile {
  id:
    | 'applied'
    | 'open'
    | 'asked'
    | 'used'
    | 'unassigned'
    | 'stillOwed'
    | 'checkedIn'
    | 'notYet'
    | 'came'
    | 'paid';
  /** The figure, drawn large. */
  figure: string;
  /** What it counts, under it. */
  words: string;
  /** Where it is worked on, or null for a zero whose link would list nothing. */
  link: TileLink | null;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/** A link to `route`, or none for a zero. */
function unlessZero(count: number, route: RouteLocationRaw): TileLink | null {
  return count ? { route } : null;
}

/** Words kept on one line, so a narrow tile breaks before a date, never inside it ("Aug / 1"). */
function whole(words: string): string {
  return words.replace(/ /g, '\u00a0');
}

/** The market date counted: today when it is one, else the next ahead, else the last. */
function dayCounted<T extends { date: string }>(dates: T[], today: string): T | null {
  const sorted = [...dates].sort((a, b) => a.date.localeCompare(b.date));
  return sorted.find((day) => day.date >= today) ?? sorted.at(-1) ?? null;
}

export function statsHeadlines(
  phase: string,
  stats: MarketStats,
  marketId: string,
  today: string = calendarToday(),
): Tile[] {
  const { placements, money: owing } = stats.headlines;
  const amount = (cents: number) => money(cents, { currency: owing!.currency });
  const payments = marketPath(marketId, 'payments');
  const attendance = marketPath(marketId, 'attendance');

  const used = (): Tile[] =>
    placements
      ? [
          {
            id: 'used',
            figure: String(placements.tableDaysUsed),
            words: `of ${placements.tableDays} ${plural(placements.tableDays, 'table-day', 'table-days')} used`,
            link: { route: marketPath(marketId, 'assignments') },
          },
        ]
      : [];
  const stillOwed = (): Tile[] =>
    owing
      ? [
          {
            id: 'stillOwed',
            figure: amount(owing.stillOwedCents),
            words: 'still owed',
            link: unlessZero(owing.stillOwedCents, { path: payments, query: { show: 'owes' } }),
          },
        ]
      : [];

  switch (phase) {
    case MarketPhase.Applications: {
      const { total, byStatus } = applicantStats(stats.applicants, marketId);
      const open = byStatus.find((part) => part.value === 'undecided')!;
      const tiles: Tile[] = [
        {
          id: 'applied',
          figure: String(total),
          words: 'applied',
          link: unlessZero(total, {
            path: marketPath(marketId, 'applications'),
            query: { view: 'all' },
          }),
        },
        {
          id: 'open',
          figure: String(open.count),
          words: 'open to review',
          link: open.to ? unlessZero(open.count, open.to) : null,
        },
      ];
      if (stats.room?.dates.length) {
        const asked = stats.room.dates.reduce((sum, day) => sum + day.asked, 0);
        const tables = stats.room.dates.reduce((sum, day) => sum + day.tables, 0);
        tiles.push({
          id: 'asked',
          figure: String(asked),
          words: `of ${tables} ${plural(tables, 'table-day', 'table-days')} asked`,
          link: { section: 'stats-room' },
        });
      }
      return tiles;
    }
    case MarketPhase.Assignment:
    case MarketPhase.Offers:
      return [
        ...used(),
        ...(placements
          ? [
              {
                id: 'unassigned' as const,
                figure: String(placements.unassigned),
                words: 'unassigned',
                link: unlessZero(placements.unassigned, {
                  path: marketPath(marketId, 'vendors'),
                  query: { show: 'unassigned' },
                }),
              },
            ]
          : []),
        ...stillOwed(),
      ];
    case MarketPhase.MarketDays: {
      const day = stats.checkIn ? dayCounted(stats.checkIn.dates, today) : null;
      if (!day) return stillOwed();
      const there = { path: attendance, query: { date: day.date } };
      const left = day.expected - day.checkedIn;
      return [
        {
          id: 'checkedIn',
          figure: String(day.checkedIn),
          words: `of ${day.expected} checked in, ${whole(getShortDate(day.date))}`,
          link: unlessZero(day.expected, there),
        },
        {
          id: 'notYet',
          figure: String(left),
          words: day.date < today ? 'did not come' : 'not yet in',
          link: unlessZero(left, there),
        },
        ...stillOwed(),
      ];
    }
    case MarketPhase.Archived:
      return [
        ...(stats.checkIn
          ? [
              {
                id: 'came' as const,
                figure: String(stats.checkIn.came),
                words: `${plural(stats.checkIn.came, 'vendor', 'vendors')} came`,
                link: { route: attendance },
              },
            ]
          : []),
        ...used(),
        ...(owing
          ? [
              {
                id: 'paid' as const,
                figure: amount(owing.paidCents),
                words: 'paid',
                link: { route: payments },
              },
            ]
          : []),
      ];
    default:
      return [];
  }
}
