/**
 * A vendor's payments as the drawer's Payment tab words them (E44/F01/S01).
 */
import { describe, expect, it } from 'vitest';
import {
  balanceState,
  balanceText,
  methodLabel,
  seatText,
  today,
  type PaymentLine,
  type VendorAccount,
} from '@/utils/payments';

function account(owedCents: number, paidCents: number, currency: string | null = 'CAD') {
  return { currency, lines: [], payments: [], owedCents, paidCents } satisfies VendorAccount;
}

const LINE: PaymentLine = {
  date: '2099-05-07',
  tableCode: 'Atrium 1',
  tier: 'Gold',
  tableChoice: 'Full Table',
  priceCents: 3500,
  owedCents: 3500,
  owedSetBy: null,
  owedSetAt: null,
  freed: false,
};

describe('how what they paid compares with what they owe', () => {
  it('says what they still owe', () => {
    expect(balanceText(account(7000, 4300))).toBe('Owes $27');
    expect(balanceState(account(7000, 4300))).toBe('owing');
  });

  it('says they paid in full', () => {
    expect(balanceText(account(7000, 7000))).toBe('Paid in full');
    expect(balanceState(account(7000, 7000))).toBe('settled');
  });

  it('says how much more than owed they paid, the case for a refund', () => {
    expect(balanceText(account(3500, 5000))).toBe('Paid $15 more than owed');
    expect(balanceState(account(3500, 5000))).toBe('overpaid');
  });

  it('says nothing is owed when nothing is owed or paid', () => {
    expect(balanceText(account(0, 0))).toBe('Nothing owed');
  });

  it('keeps the cents where there are any', () => {
    expect(balanceText(account(3001, 1500))).toBe('Owes $15.01');
  });

  it('reads an unpriced market in the card’s own default currency', () => {
    expect(balanceText(account(0, 2500, null))).toBe('Paid $25 more than owed');
  });
});

describe('a line’s seat', () => {
  it('names the table, the tier and the size', () => {
    expect(seatText(LINE)).toBe('Atrium 1, Gold, full table');
    expect(
      seatText({ ...LINE, tableCode: 'Landing 2', tier: 'Silver', tableChoice: 'Half Table' }),
    ).toBe('Landing 2, Silver, half table');
  });

  it('leaves out a tier the table has none of', () => {
    expect(seatText({ ...LINE, tier: '' })).toBe('Atrium 1, full table');
  });
});

describe('a payment', () => {
  it('names its method as the organizer says it', () => {
    expect(methodLabel('e-transfer')).toBe('E-transfer');
    expect(methodLabel('cash')).toBe('Cash');
  });

  it('starts at today in the organizer’s own calendar', () => {
    expect(today(new Date(2099, 3, 1, 23, 30))).toBe('2099-04-01');
  });
});
