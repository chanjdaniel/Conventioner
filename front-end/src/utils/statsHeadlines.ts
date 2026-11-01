/**
 * The Stats tab's headlines (E45/F01/S03): the market's state in figures at the top of the page,
 * each linking to the page that shows the same figure, with that page's filter.
 *
 * Counted on the server by those pages' own code (`back-end/market_stats.py`): the table-days used
 * and the vendors unassigned are the Assignments page's strip, the table-days free its grid's
 * "Empty" count, and the amounts owed, paid and still owed the Payments page's figures. Placements
 * come once an assignment is stored, money only where the market sets prices and the Payments page
 * has someone to count; the server sends `null` for either otherwise, and it is left out.
 *
 * A zero that would open a filter listing nothing is told but not linked, as the Assignments page's
 * counts cannot be chosen at zero (E28/F02/S01).
 */
import type { RouteLocationRaw } from 'vue-router';
import { marketPath } from '@/utils/market';
import { money } from '@/utils/payments';

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

export interface Headline {
  id: 'used' | 'free' | 'unassigned' | 'owed' | 'paid' | 'stillOwed';
  /** The figure, drawn large. */
  figure: string;
  /** What it counts, after it. */
  words: string;
  /** Where it is worked on, or null for a zero whose filter would list nothing. */
  to: RouteLocationRaw | null;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

export function statsHeadlines(headlines: Headlines, marketId: string): Headline[] {
  const found: Headline[] = [];
  const { placements, money: owing } = headlines;
  if (placements) {
    const assignments = marketPath(marketId, 'assignments');
    found.push(
      {
        id: 'used',
        figure: String(placements.tableDaysUsed),
        words: `of ${placements.tableDays} ${plural(placements.tableDays, 'table-day', 'table-days')} used`,
        to: assignments,
      },
      {
        id: 'free',
        figure: String(placements.tableDaysFree),
        words: `${plural(placements.tableDaysFree, 'table-day', 'table-days')} free`,
        to: placements.tableDaysFree ? { path: assignments, query: { status: 'empty' } } : null,
      },
      {
        id: 'unassigned',
        figure: String(placements.unassigned),
        words: `${plural(placements.unassigned, 'vendor', 'vendors')} unassigned`,
        to: placements.unassigned
          ? { path: marketPath(marketId, 'vendors'), query: { show: 'unassigned' } }
          : null,
      },
    );
  }
  if (owing) {
    const payments = marketPath(marketId, 'payments');
    const amount = (cents: number) => money(cents, { currency: owing.currency });
    found.push(
      { id: 'owed', figure: amount(owing.owedCents), words: 'owed', to: payments },
      { id: 'paid', figure: amount(owing.paidCents), words: 'paid', to: payments },
      {
        id: 'stillOwed',
        figure: amount(owing.stillOwedCents),
        words: 'still owed',
        to: owing.stillOwedCents ? { path: payments, query: { show: 'owes' } } : null,
      },
    );
  }
  return found;
}
