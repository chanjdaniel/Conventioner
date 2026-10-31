import { describe, expect, it } from 'vitest';
import {
  PAYMENTS_SHOWN,
  paymentsShownFrom,
  paymentsSortFrom,
  paymentsSortQuery,
  shownVendors,
  vendorShownIn,
  type PaymentsVendor,
} from '@/utils/paymentsPage';

const ANA: PaymentsVendor = { email: 'ana@example.com', owedCents: 7000, paidCents: 3500 };
const BEN: PaymentsVendor = { email: 'ben@example.com', owedCents: 3000, paidCents: 3000 };
const CY: PaymentsVendor = { email: 'cy@example.com', owedCents: 1750, paidCents: 2500 };
const DEE: PaymentsVendor = { email: 'dee@example.com', owedCents: 0, paidCents: 0 };
const NAMES = { 'ana@example.com': 'Zed Ana', 'cy@example.com': 'Alice Cy' };
const ALL = [ANA, BEN, CY, DEE];

describe('the Payments page filters', () => {
  it('names each in the words of the Payment tab', () => {
    expect(PAYMENTS_SHOWN.map((f) => f.label)).toEqual([
      'Owes',
      'Paid in full',
      'Paid more than owed',
    ]);
  });

  it('lists exactly the vendors in each state', () => {
    expect(ALL.filter((v) => vendorShownIn(v, 'owes'))).toEqual([ANA]);
    // Paid in full is square with something owed; a vendor who owes nothing and paid nothing reads
    // "Nothing owed" on their tab, and is in no filter, as in the export's money filter (E42/F01/S04).
    expect(ALL.filter((v) => vendorShownIn(v, 'paid'))).toEqual([BEN]);
    expect(ALL.filter((v) => vendorShownIn(v, 'more'))).toEqual([CY]);
    expect(ALL.filter((v) => vendorShownIn(v, null))).toEqual(ALL);
  });

  it('puts a vendor who owes nothing and paid nothing in no filter', () => {
    for (const shown of ['owes', 'paid', 'more'] as const) {
      expect(vendorShownIn(DEE, shown)).toBe(false);
    }
    expect(vendorShownIn(DEE, null)).toBe(true);
  });

  it('reads the filter from the address, and nothing for anything else', () => {
    expect(paymentsShownFrom('owes')).toBe('owes');
    expect(paymentsShownFrom('more')).toBe('more');
    expect(paymentsShownFrom('refund')).toBeNull();
    expect(paymentsShownFrom(undefined)).toBeNull();
    expect(paymentsShownFrom(['owes'])).toBeNull();
  });
});

describe('the Payments page sort', () => {
  it('is by vendor, A to Z, until another is asked', () => {
    expect(paymentsSortFrom({})).toEqual({ key: 'vendor', descending: false });
    expect(paymentsSortFrom({ sort: 'nonsense' })).toEqual({ key: 'vendor', descending: false });
    expect(paymentsSortFrom({ sort: 'difference', order: 'desc' })).toEqual({
      key: 'difference',
      descending: true,
    });
  });

  it('sorts by name where there is one, else by address', () => {
    const sorted = shownVendors(
      ALL,
      { shown: null, search: '', names: NAMES },
      {
        key: 'vendor',
        descending: false,
      },
    );
    expect(sorted.map((v) => v.email)).toEqual([CY.email, BEN.email, DEE.email, ANA.email]);
  });

  it('sorts by each amount, a tie by vendor', () => {
    const by = (key: 'owed' | 'paid' | 'difference', descending: boolean) =>
      shownVendors(ALL, { shown: null, search: '', names: {} }, { key, descending }).map(
        (v) => v.email,
      );
    expect(by('owed', true)).toEqual([ANA.email, BEN.email, CY.email, DEE.email]);
    expect(by('paid', false)).toEqual([DEE.email, CY.email, BEN.email, ANA.email]);
    // The difference is what is still owed: paid more than owed sorts below square.
    expect(by('difference', true)).toEqual([ANA.email, BEN.email, DEE.email, CY.email]);
  });

  it('a column asked again turns its order; a new column starts at its own', () => {
    expect(paymentsSortQuery({ key: 'vendor', descending: false }, 'vendor')).toEqual({
      sort: 'vendor',
      order: 'desc',
    });
    // An amount starts largest first, the vendor A to Z; the default leaves the address bare.
    expect(paymentsSortQuery({ key: 'vendor', descending: false }, 'owed')).toEqual({
      sort: 'owed',
      order: 'desc',
    });
    expect(paymentsSortQuery({ key: 'owed', descending: true }, 'vendor')).toEqual({});
    expect(paymentsSortQuery({ key: 'owed', descending: true }, 'owed')).toEqual({ sort: 'owed' });
  });
});

describe('the Payments page search', () => {
  it('finds by name or address, within the filter', () => {
    const found = (search: string, shown: 'owes' | null = null) =>
      shownVendors(ALL, { shown, search, names: NAMES }, { key: 'vendor', descending: false }).map(
        (v) => v.email,
      );
    expect(found('alice')).toEqual([CY.email]);
    expect(found('ben@')).toEqual([BEN.email]);
    expect(found('example', 'owes')).toEqual([ANA.email]);
  });
});
