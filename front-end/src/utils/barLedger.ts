/**
 * A ledger of bars (E35/F03/S01): counts read as a card of rows, each with its share of the whole
 * and a bar against the largest in its card, so the biggest reads before the numbers do. The
 * Result page's statistics drew it first; the Stats tab reads with it too (E45/F01/S01), rather
 * than a chart library.
 */
import type { RouteLocationRaw } from 'vue-router';

/** One answer counted: what it reads as, what it stands for, how many, and where it leads. */
export interface Counted {
  label: string;
  /** What the row stands for: a date, a status, a section. */
  value: string;
  count: number;
  /** Where choosing the row goes; none for a row that leads nowhere. */
  to?: RouteLocationRaw;
}

export interface LedgerRow extends Counted {
  /** Its share of the whole, a whole percent. */
  share: number;
  /** Its bar, as a percent of the largest count in its card. */
  bar: number;
}

/** A card's rows, each with its share of `total` and its bar against the largest of them. */
export function ledgerRows(entries: Counted[], total: number): LedgerRow[] {
  const largest = Math.max(0, ...entries.map((entry) => entry.count));
  return entries.map((entry) => ({
    ...entry,
    share: total ? Math.round((entry.count / total) * 100) : 0,
    bar: largest ? (entry.count / largest) * 100 : 0,
  }));
}
