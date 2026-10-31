/**
 * The Payments page (E44/F02/S01): the market's money at a glance, who has yet to pay, and whose
 * refund is to be issued.
 *
 * The server counts it (`market_payments` in `back-end/api/payments.py`): every vendor with a
 * table-day line or a payment, with what they owe and what they paid, as their Payment tab reads
 * them, and the market's figures, also by tier and by date. This reads it, and keeps which vendors
 * the list shows, and in what order, in the page's address.
 */
import type { LocationQuery, LocationQueryValue } from 'vue-router';
import { api } from '@/utils/api';
import { balanceState } from '@/utils/payments';
import { vendorHeadline, vendorMatches, type VendorNames } from '@/utils/vendorIdentity';

/** One vendor on the page: what they owe and what they paid, in cents. */
export interface PaymentsVendor {
  email: string;
  owedCents: number;
  paidCents: number;
}

/** What the page counts: the amount owed, the amount paid, and the two sides of the difference. */
export interface PaymentsFigures {
  owedCents: number;
  paidCents: number;
  /** What vendors who have not paid in full still owe. */
  stillOwedCents: number;
  /** What vendors paid beyond what they owe: refunds to issue (Q26). */
  paidMoreCents: number;
}

export interface MarketPayments {
  /** The market's currency; null on a market that sets no prices. */
  currency: string | null;
  vendors: PaymentsVendor[];
  totals: PaymentsFigures;
  /** By tier, in the market's order; `tier` null for what vendors holding no table paid. */
  byTier: (PaymentsFigures & { tier: string | null })[];
  /** By date; `date` null for what vendors holding no table paid. */
  byDate: (PaymentsFigures & { date: string | null })[];
}

export async function loadMarketPayments(marketId: string): Promise<MarketPayments> {
  return (await api.get<MarketPayments>(`/markets/${encodeURIComponent(marketId)}/payments`)).data;
}

/** The list's filters (Q26: "something the organizer can filter for and know to issue refunds"),
 * in the address as `show`. */
export type PaymentsShown = 'owes' | 'paid' | 'more';

export const PAYMENTS_SHOWN: readonly { id: PaymentsShown; label: string }[] = [
  { id: 'owes', label: 'Owes' },
  { id: 'paid', label: 'Paid in full' },
  { id: 'more', label: 'Paid more than owed' },
];

const STATE_SHOWN = { owing: 'owes', settled: 'paid', overpaid: 'more' } as const;

type QueryValue = LocationQueryValue | LocationQueryValue[] | undefined;

export function paymentsShownFrom(value: QueryValue): PaymentsShown | null {
  return PAYMENTS_SHOWN.find((f) => f.id === value)?.id ?? null;
}

/**
 * Whether a vendor is in the state a filter lists, as their Payment tab words it: "Owes $27",
 * "Paid $15 more than owed", or "Paid in full", square with something owed. A vendor who owes
 * nothing and paid nothing ("Nothing owed": every day freed with its price taken off, or set to $0)
 * is in none, the one rule the export's money filter keeps too (E42/F01/S04).
 */
export function vendorShownIn(vendor: PaymentsVendor, shown: PaymentsShown | null): boolean {
  if (!shown) return true;
  if (!vendor.owedCents && !vendor.paidCents) return false;
  return STATE_SHOWN[balanceState(vendor)] === shown;
}

/** The list's columns, each sortable; in the address as `sort`, and `order=desc`. */
export type PaymentsSortKey = 'vendor' | 'owed' | 'paid' | 'difference';
export interface PaymentsSort {
  key: PaymentsSortKey;
  descending: boolean;
}

const SORT_KEYS: readonly PaymentsSortKey[] = ['vendor', 'owed', 'paid', 'difference'];
const DEFAULT_SORT: PaymentsSort = { key: 'vendor', descending: false };

export function paymentsSortFrom(query: LocationQuery): PaymentsSort {
  const key = SORT_KEYS.find((k) => k === query.sort);
  return key ? { key, descending: query.order === 'desc' } : DEFAULT_SORT;
}

/**
 * The address's sort once a column's heading is pressed: the column sorted already turns its
 * order; another starts at its own, the vendor A to Z and an amount largest first. The default
 * leaves the address bare.
 */
export function paymentsSortQuery(
  sort: PaymentsSort,
  key: PaymentsSortKey,
): { sort?: PaymentsSortKey; order?: 'desc' } {
  const descending = sort.key === key ? !sort.descending : key !== 'vendor';
  if (key === DEFAULT_SORT.key && descending === DEFAULT_SORT.descending) return {};
  return descending ? { sort: key, order: 'desc' } : { sort: key };
}

function amount(vendor: PaymentsVendor, key: Exclude<PaymentsSortKey, 'vendor'>): number {
  if (key === 'owed') return vendor.owedCents;
  if (key === 'paid') return vendor.paidCents;
  return vendor.owedCents - vendor.paidCents;
}

/** The vendors the list shows: in the filter's state, matching the search by name or address,
 * in the sort's order, a tie by vendor. */
export function shownVendors(
  vendors: readonly PaymentsVendor[],
  { shown, search, names }: { shown: PaymentsShown | null; search: string; names: VendorNames },
  sort: PaymentsSort,
): PaymentsVendor[] {
  const label = (v: PaymentsVendor) => vendorHeadline(v.email, names).toLowerCase();
  const byVendor = (a: PaymentsVendor, b: PaymentsVendor) => label(a).localeCompare(label(b));
  const order = sort.descending ? -1 : 1;
  return vendors
    .filter((v) => vendorShownIn(v, shown) && vendorMatches(search, v.email, names))
    .sort((a, b) => {
      if (sort.key === 'vendor') return order * byVendor(a, b);
      return order * (amount(a, sort.key) - amount(b, sort.key)) || byVendor(a, b);
    });
}
