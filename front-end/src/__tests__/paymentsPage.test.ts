import { describe, expect, it } from 'vitest';
import {
  PAYMENTS_SHOWN,
  owingCounted,
  paidOwingNothing,
  paymentsFilters,
  paymentsShownFrom,
  paymentsSortFrom,
  paymentsSortQuery,
  shownVendors,
  vendorShownIn,
  type PaymentsVendor,
} from '@/utils/paymentsPage';

// Each with the state the server read (`balance_state` in back-end/payments.py).
const ANA: PaymentsVendor = {
  email: 'ana@example.com',
  owedCents: 7000,
  paidCents: 3500,
  balanceState: 'owes',
};
const BEN: PaymentsVendor = {
  email: 'ben@example.com',
  owedCents: 3000,
  paidCents: 3000,
  balanceState: 'paid',
};
const CY: PaymentsVendor = {
  email: 'cy@example.com',
  owedCents: 1750,
  paidCents: 2500,
  balanceState: 'over',
};
const DEE: PaymentsVendor = {
  email: 'dee@example.com',
  owedCents: 0,
  paidCents: 0,
  balanceState: null,
};
const NAMES = { 'ana@example.com': 'Zed Ana', 'cy@example.com': 'Alice Cy' };
const ALL = [ANA, BEN, CY, DEE];
const priced = { currency: 'CAD', vendors: ALL };
/** A market without prices: nobody owes, whatever they paid. */
const unpriced = {
  currency: null,
  vendors: ALL.map((v) => ({ ...v, owedCents: 0, balanceState: null })),
};

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
    expect(ALL.filter((v) => vendorShownIn(v, 'over'))).toEqual([CY]);
    expect(ALL.filter((v) => vendorShownIn(v, null))).toEqual(ALL);
  });

  it("lists by the server's state, the one the export's payment filter reads", () => {
    // The page does not read the amounts again: a state the server sent is the one it lists.
    const told: PaymentsVendor = { ...ANA, balanceState: 'paid' };
    expect(vendorShownIn(told, 'paid')).toBe(true);
    expect(vendorShownIn(told, 'owes')).toBe(false);
  });

  it('puts a vendor who owes nothing and paid nothing in no filter', () => {
    for (const shown of ['owes', 'paid', 'over'] as const) {
      expect(vendorShownIn(DEE, shown)).toBe(false);
    }
    expect(vendorShownIn(DEE, null)).toBe(true);
  });

  it('offers no filter on a market without prices where nobody owes (Daniel, finding 3)', () => {
    // Nothing is owed there, so whoever paid would all be "Paid more than owed": the refunds
    // filter would be everyone.
    expect(paymentsFilters(priced)).toEqual(PAYMENTS_SHOWN);
    expect(paymentsFilters(unpriced)).toEqual([]);
  });

  it('offers the filters on a market without prices where an amount owed was set by hand', () => {
    // The reading follows the account, not the market (finding 10).
    const setByHand = { currency: null, vendors: [{ ...DEE, owedCents: 2000 }] };
    expect(paymentsFilters(setByHand)).toEqual(PAYMENTS_SHOWN);
    expect(paymentsShownFrom('owes', setByHand)).toBe('owes');
  });

  it('offers the filters on a market without prices where a refund went beyond what was paid', () => {
    // A negative net paid is money owed back to the market (finding 14).
    const refundedBeyond = { currency: null, vendors: [{ ...DEE, paidCents: -1500 }] };
    expect(owingCounted(refundedBeyond)).toBe(true);
    expect(paymentsShownFrom('owes', refundedBeyond)).toBe('owes');
  });

  it('ignores a filter in the address on a market without prices where nobody owes', () => {
    expect(paymentsShownFrom('over', unpriced)).toBeNull();
    expect(paymentsShownFrom('over', priced)).toBe('over');
  });

  it('reads the filter from the address, and nothing for anything else', () => {
    expect(paymentsShownFrom('owes', priced)).toBe('owes');
    expect(paymentsShownFrom('over', priced)).toBe('over');
    expect(paymentsShownFrom('more', priced)).toBeNull();
    expect(paymentsShownFrom('refund', priced)).toBeNull();
    expect(paymentsShownFrom(undefined, priced)).toBeNull();
    expect(paymentsShownFrom(['owes'], priced)).toBeNull();
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
  it('finds someone going by another name by the name on their identification', () => {
    const found = (legalNames?: Record<string, string>) =>
      shownVendors(
        ALL,
        { shown: null, search: 'marchetti', names: NAMES, legalNames },
        { key: 'vendor', descending: false },
      ).map((v) => v.email);
    expect(found()).toEqual([]);
    expect(found({ [BEN.email]: 'Ben Marchetti' })).toEqual([BEN.email]);
  });

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

describe("the market's money caption", () => {
  // "Paid" holds what a vendor whose account compares with nothing paid, so it is said only where
  // one did (T153 review finding 15).
  const ben = { ...BEN, owedCents: 0, balanceState: null };

  it('is drawn where a vendor owing nothing on a market without prices paid', () => {
    expect(paidOwingNothing({ currency: null, vendors: [{ ...ANA, owedCents: 2000 }, ben] })).toBe(
      true,
    );
  });

  it('is not drawn where every vendor who paid owes', () => {
    const owing = { currency: null, vendors: [{ ...ANA, owedCents: 2000 }, DEE] };
    expect(paidOwingNothing(owing)).toBe(false);
  });

  it('is not drawn where a vendor owing nothing was refunded beyond what they paid', () => {
    // A negative amount paid is owed back (finding 14): it compares, and reads "Owes".
    expect(paidOwingNothing({ currency: null, vendors: [{ ...DEE, paidCents: -1500 }] })).toBe(
      false,
    );
  });

  it('is not drawn on a market with prices', () => {
    expect(paidOwingNothing({ currency: 'CAD', vendors: [ben] })).toBe(false);
    expect(paidOwingNothing(null)).toBe(false);
  });
});
