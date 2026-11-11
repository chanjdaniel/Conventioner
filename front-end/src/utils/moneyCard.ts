/**
 * The Stats tab's Money (T201): where the money stands. The server counts it as the Payments page
 * does (`count_money` in `back-end/market_stats.py`, by `market_money`), so its figures are that
 * page's: owed, paid and still owed, in cents, in the market's currency; `null` where the market
 * sets no prices or the page has nobody to count.
 *
 * Here they become the section's card: the three figures, each to the cent (`money`), still owed a
 * link to Payments on Owes where anyone owes, a zero told and not linked; and one `MeterBar` of paid
 * against owed, its mark at owed, so a payment beyond what is owed is drawn past it.
 */
import type { RouteLocationRaw } from 'vue-router';
import { marketPath } from '@/utils/market';
import { money } from '@/utils/payments';
import type { MoneyHeadlines } from '@/utils/statsHeadlines';

export interface MoneyFigure {
  id: 'owed' | 'paid' | 'stillOwed';
  label: string;
  /** The amount, to the cent: "$1,450.00". */
  amount: string;
  /** Where it is worked on, or null. */
  to: RouteLocationRaw | null;
}

export interface MoneyCard {
  figures: MoneyFigure[];
  /** Paid against owed, as a `MeterBar` draws it. */
  bar: { words: string; value: number; mark: number; scale: number };
}

export function moneyCard(counted: MoneyHeadlines | null, marketId: string): MoneyCard | null {
  if (!counted) return null;
  const amount = (cents: number) => money(cents, { currency: counted.currency });
  const { owedCents, paidCents, stillOwedCents } = counted;
  // A refund beyond what was paid leaves the market owing; the bar has nothing paid to draw.
  const paid = Math.max(0, paidCents);
  return {
    figures: [
      { id: 'owed', label: 'Owed', amount: amount(owedCents), to: null },
      { id: 'paid', label: 'Paid', amount: amount(paidCents), to: null },
      {
        id: 'stillOwed',
        label: 'Still owed',
        amount: amount(stillOwedCents),
        to: stillOwedCents
          ? { path: marketPath(marketId, 'payments'), query: { show: 'owes' } }
          : null,
      },
    ],
    bar: {
      words: `${amount(paidCents)} of ${amount(owedCents)} paid`,
      value: paid,
      mark: owedCents,
      scale: Math.max(paid, owedCents),
    },
  };
}
