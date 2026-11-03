/**
 * The Payments group's words (E44/F01): a vendor's payments, refunds and what they owe, and what
 * they owed taken back when the assignment seats them again.
 *
 * Reads:
 * - `record-payment/`
 * - `record-payment/*`, the rows of any kind
 * - `adjust-paid/refund_recorded`
 * - `adjust-paid/payment_edited`
 * - `adjust-paid/payment_removed`
 * - `adjust-paid/*`, the rows of any kind
 * - `change-owed/owed_set`
 * - `change-owed/owed_calculated`
 * - `change-owed/*`, the rows of any kind
 * - `assign/owed_taken_back`, its sentence and its rows
 */
import type { MarketHistoryEntry } from '@/utils/marketHistory';
import { formatPrice } from '@/utils/pricing';
import { getShortDate } from '@/utils/utils';
import {
  asDetail,
  day,
  sentence,
  str,
  valueText,
  type EntryChanges,
  type HistoryReaders,
} from './shared';

/** An amount of a payment entry, in the currency its subject names: "$35.00", or "-$15.00" for a refund. */
function entryMoney(entry: MarketHistoryEntry, cents: unknown): string {
  const amount = Number(cents);
  const money = formatPrice(Math.abs(amount), str(entry.subject.currency) || 'CAD');
  return amount < 0 ? `-${money}` : money;
}

/** A payment entry's fields, as the Payment tab names them (E44/F01). */
const PAYMENT_FIELDS: Record<string, string> = {
  cents: 'Amount',
  owed_cents: 'Amount owed',
  method: 'Paid by',
  paid_on: 'Paid on',
  note: 'Note',
};

/** A payment entry's field as the Payment tab writes it: money, a method, a day, or a note. */
function paymentValue(entry: MarketHistoryEntry, key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return 'none';
  if (key === 'cents' || key === 'owed_cents') return entryMoney(entry, value);
  if (key === 'method') return value === 'cash' ? 'Cash' : 'E-transfer';
  if (key === 'paid_on') return getShortDate(str(value));
  return valueText(value);
}

/** Whether an entry is about a refund: its subject says, since an edit records only the fields
 * it changed, and a refund's note changed alone carries no amount. */
function isRefund(entry: MarketHistoryEntry): boolean {
  return entry.subject.payment_kind === 'refund';
}

/** A payment entry's rows: each field the Payment tab names that it set, and the day it is for. */
function paymentChanges(entry: MarketHistoryEntry): EntryChanges {
  const detail = asDetail(entry.detail);
  const before = asDetail(detail.before);
  const after = asDetail(detail.after);
  const keys = Object.keys(PAYMENT_FIELDS).filter((key) => key in before || key in after);
  return {
    changed: keys.map((key) => ({
      field: PAYMENT_FIELDS[key],
      before: paymentValue(entry, key, before[key]),
      after: paymentValue(entry, key, after[key]),
    })),
    recorded: entry.subject.date ? [{ field: 'Date', value: day(entry.subject.date) }] : [],
  };
}

// A vendor's payments (E44/F01): the vendor last where a possessive would follow them.
export const readers: HistoryReaders = {
  'record-payment/': {
    parts(entry, context) {
      const { actor, text, vendor, after } = sentence(entry, context);
      return [actor, text(`recorded a payment of ${entryMoney(entry, after.cents)} from `), vendor];
    },
  },
  'record-payment/*': { changes: paymentChanges },
  'adjust-paid/refund_recorded': {
    parts(entry, context) {
      const { actor, text, vendor, after } = sentence(entry, context);
      return [
        actor,
        text(`recorded a refund of ${entryMoney(entry, Math.abs(Number(after.cents)))} to `),
        vendor,
      ];
    },
  },
  'adjust-paid/payment_edited': {
    parts(entry, context) {
      const { actor, text, vendor } = sentence(entry, context);
      return [
        actor,
        text(isRefund(entry) ? 'changed a refund to ' : 'changed a payment from '),
        vendor,
      ];
    },
  },
  'adjust-paid/payment_removed': {
    parts(entry, context) {
      const { actor, text, vendor } = sentence(entry, context);
      return [
        actor,
        text(isRefund(entry) ? 'removed a refund to ' : 'removed a payment from '),
        vendor,
      ];
    },
  },
  'adjust-paid/*': { changes: paymentChanges },
  'change-owed/owed_set': {
    parts(entry, context) {
      const { actor, text, vendor, after, onDay } = sentence(entry, context);
      return [
        actor,
        text('set what '),
        vendor,
        text(` owes${onDay(entry.subject.date)} to ${entryMoney(entry, after.owed_cents)}`),
      ];
    },
  },
  'change-owed/owed_calculated': {
    parts(entry, context) {
      const { actor, text, vendor, onDay } = sentence(entry, context);
      return [
        actor,
        text('set what '),
        vendor,
        text(` owes${onDay(entry.subject.date)} back to the calculated price`),
      ];
    },
  },
  'change-owed/*': { changes: paymentChanges },
  'assign/owed_taken_back': {
    parts(entry, context) {
      const { actor, text, vendor, before, onDay } = sentence(entry, context);
      return [
        actor,
        text('seated '),
        vendor,
        text(
          ` again${onDay(entry.subject.date)}, taking back the ${entryMoney(entry, before.owed_cents)}` +
            ' set when the table was freed',
        ),
      ];
    },
    changes: paymentChanges,
  },
};
