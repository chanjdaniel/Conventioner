/**
 * A vendor's payments (E44/F01/S01): what they owe for each table-day, the payments an organizer
 * recorded, and how the two compare, as the drawer's Payment tab reads them.
 *
 * The back end is the authority: it prices each table-day from the seat the vendor holds, keeps the
 * line of a freed table, and adds up both totals (`back-end/payments.py`). This only reads, words
 * and records.
 */
import { api } from '@/utils/api';
import { formatPrice } from '@/utils/pricing';
import { getFormattedDate, getTimestampDate } from '@/utils/utils';

/** How the organizers take a payment (Daniel, T92 Q7), as the server names each. */
export const PAYMENT_METHODS: readonly { id: PaymentMethod; label: string }[] = [
  { id: 'e-transfer', label: 'E-transfer' },
  { id: 'cash', label: 'Cash' },
];

export type PaymentMethod = 'e-transfer' | 'cash';

/** One table-day: the seat, or the seat as it was freed, and what is owed for it. */
export interface PaymentLine {
  date: string;
  tableCode: string;
  tier: string;
  tableChoice: string;
  /** The price group that set its price (E43/F01/S02), "Everyone else", or null on a card with
   * no groups. */
  group?: string | null;
  /** What the pricing calculates for the seat; null where it has no price. */
  priceCents: number | null;
  /** What is owed for the day: the price, unless someone set it by hand. */
  owedCents: number | null;
  owedSetBy: string | null;
  owedSetAt: string | null;
  /** The table was freed; the line stays, still owed (Q26). */
  freed: boolean;
  /** When and by whom it was freed; null for a seat held now. */
  freedAt: string | null;
  freedBy: string | null;
}

export interface Payment {
  id: string;
  /** A payment the vendor made, or a refund given back to them, whose `cents` is negative. */
  kind: 'payment' | 'refund';
  cents: number;
  method: PaymentMethod;
  /** The day it was paid, `YYYY-MM-DD`. */
  paidOn: string;
  note: string;
  recordedBy: string;
  recordedAt: string;
  /** The last edit, when it was edited (E44/F01/S02). */
  editedBy: string | null;
  editedAt: string | null;
  /** Taken out of the amount paid; it is kept, and shown so. */
  removedBy: string | null;
  removedAt: string | null;
}

export interface VendorAccount {
  /** The market's currency; null on a market that sets no prices. */
  currency: string | null;
  lines: PaymentLine[];
  payments: Payment[];
  owedCents: number;
  paidCents: number;
}

export interface NewPayment {
  cents: number;
  method: PaymentMethod;
  paidOn: string;
  note: string;
}

/** The currency an amount is shown in where the market names none: the card's own default. */
const DEFAULT_CURRENCY = 'CAD';

/** An amount in the account's currency; a refund's negative amount reads "-$15". */
export function money(cents: number, account: Pick<VendorAccount, 'currency'>): string {
  const amount = formatPrice(Math.abs(cents), account.currency ?? DEFAULT_CURRENCY);
  return cents < 0 ? `-${amount}` : amount;
}

/**
 * How what they paid compares with what they owe: "Owes $27", "Paid in full", or "Paid $15 more
 * than owed", the case where a refund is to be issued (Q26). Nothing owed and nothing paid is
 * "Nothing owed".
 */
export function balanceText(account: VendorAccount): string {
  const balance = account.owedCents - account.paidCents;
  if (balance > 0) return `Owes ${money(balance, account)}`;
  if (balance < 0) return `Paid ${money(-balance, account)} more than owed`;
  return account.owedCents > 0 ? 'Paid in full' : 'Nothing owed';
}

/** Whether they owe, are square, or paid more: the comparison's tone. */
export function balanceState(account: VendorAccount): 'owing' | 'settled' | 'overpaid' {
  const balance = account.owedCents - account.paidCents;
  return balance > 0 ? 'owing' : balance < 0 ? 'overpaid' : 'settled';
}

/** A line's seat as it reads: "North Wing 1, Gold, full table", and the price group that set its price
 * where the card has groups, as the date card names it: "…, Example College student + club member". */
export function seatText(line: PaymentLine): string {
  const size = /half/i.test(line.tableChoice) ? 'half table' : 'full table';
  return [line.tableCode, line.tier.trim(), size, line.group ?? ''].filter(Boolean).join(', ');
}

/**
 * Where a line's number came from, under its day: the seat it prices, and for a freed seat that it
 * was freed and when (Daniel: "from Sunday, now deleted"): "North Wing 1, Gold, full table - table
 * freed" and "Oct 30, 2026", the day apart so the screen keeps it on one line.
 */
export function lineSource(line: PaymentLine): { text: string; freedOn: string | null } {
  if (!line.freed) return { text: seatText(line), freedOn: null };
  return {
    text: `${seatText(line)} - table freed`,
    freedOn: line.freedAt ? getTimestampDate(line.freedAt) : null,
  };
}

/**
 * An entry as it reads, "Cash, paid" and "Friday, April 3, 2099", or "Refund by e-transfer, given"
 * and its day: the day apart, so the screen keeps it on one line.
 */
export function entryText(payment: Payment): { text: string; day: string } {
  const day = getFormattedDate(payment.paidOn) ?? payment.paidOn;
  if (payment.kind === 'refund') {
    return { text: `Refund by ${methodLabel(payment.method).toLowerCase()}, given`, day };
  }
  return { text: `${methodLabel(payment.method)}, paid`, day };
}

/** The last change to an entry since it was recorded, "Edited by …" or "Removed by …", shown
 * under "Recorded by …"; null for an entry as it was recorded. */
export function entryChange(payment: Payment): { verb: string; by: string; at: string } | null {
  if (payment.removedAt) {
    return { verb: 'Removed', by: payment.removedBy ?? '', at: payment.removedAt };
  }
  if (payment.editedAt) return { verb: 'Edited', by: payment.editedBy ?? '', at: payment.editedAt };
  return null;
}

export function methodLabel(method: PaymentMethod): string {
  return PAYMENT_METHODS.find((m) => m.id === method)?.label ?? method;
}

/** Today in the organizer's own calendar, `YYYY-MM-DD`: what a new payment's date starts at. */
export function today(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function accountPath(marketId: string, email: string): string {
  return `/markets/${encodeURIComponent(marketId)}/payments/${encodeURIComponent(email)}`;
}

export async function loadAccount(marketId: string, email: string): Promise<VendorAccount> {
  return (await api.get<VendorAccount>(accountPath(marketId, email))).data;
}

/** Record one payment; answers the account as it now reads. */
export async function recordPayment(
  marketId: string,
  email: string,
  payment: NewPayment,
): Promise<VendorAccount> {
  return (await api.post<VendorAccount>(accountPath(marketId, email), payment)).data;
}

/** Record money given back, the same fields as a payment (an Admin's, E44/F01/S02). */
export async function recordRefund(
  marketId: string,
  email: string,
  refund: NewPayment,
): Promise<VendorAccount> {
  return (await api.post<VendorAccount>(`${accountPath(marketId, email)}/refunds`, refund)).data;
}

function entryPath(marketId: string, paymentId: string): string {
  return `/markets/${encodeURIComponent(marketId)}/payment-entries/${encodeURIComponent(paymentId)}`;
}

export async function editPayment(
  marketId: string,
  paymentId: string,
  payment: NewPayment,
): Promise<VendorAccount> {
  return (await api.put<VendorAccount>(entryPath(marketId, paymentId), payment)).data;
}

export async function removePayment(marketId: string, paymentId: string): Promise<VendorAccount> {
  return (await api.delete<VendorAccount>(entryPath(marketId, paymentId))).data;
}

function owedPath(marketId: string, email: string, date: string): string {
  return `${accountPath(marketId, email)}/owed/${encodeURIComponent(date)}`;
}

/** Set what one table-day owes; $0 waives it. */
export async function setAmountOwed(
  marketId: string,
  email: string,
  date: string,
  cents: number,
): Promise<VendorAccount> {
  return (await api.put<VendorAccount>(owedPath(marketId, email, date), { cents })).data;
}

/** Take back an amount set by hand: the day owes its calculated price again. */
export async function useCalculatedPrice(
  marketId: string,
  email: string,
  date: string,
): Promise<VendorAccount> {
  return (await api.delete<VendorAccount>(owedPath(marketId, email, date))).data;
}
