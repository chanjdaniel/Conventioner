/**
 * The Vendors page lists every applicant (E36/F02/S04), with "Rejected only" beside "Unassigned
 * only". Unassigned means a vendor who needs a table and has none - the run's own, or one added by
 * hand (E38/F08/S02) - so a rejected applicant is never counted among them, the miscount bug 10
 * fixed by listing the run alone.
 */
import { describe, expect, it } from 'vitest';
import { inVendorsShown, vendorsShownFrom } from '@/utils/resultFilters';

const approved = { needsATable: true, rejected: false };
const rejected = { needsATable: false, rejected: true };
/** Added by hand: out of the run, and needing a table like anyone (E38/F08/S02). */
const added = { needsATable: true, rejected: false };

describe('who the Vendors page lists', () => {
  it('lists everyone, approved or not, with no choice made', () => {
    expect([approved, rejected].filter((v) => inVendorsShown(v, null))).toEqual([
      approved,
      rejected,
    ]);
  });

  it('never counts a rejected applicant as unassigned', () => {
    expect(inVendorsShown(rejected, 'unassigned')).toBe(false);
    expect(inVendorsShown(approved, 'unassigned')).toBe(true);
  });

  it('counts a vendor added by hand as unassigned, though the run never reads them', () => {
    expect(inVendorsShown(added, 'unassigned')).toBe(true);
    expect(inVendorsShown(added, 'rejected')).toBe(false);
  });

  it('lists only the rejected under "Rejected only"', () => {
    expect(inVendorsShown(rejected, 'rejected')).toBe(true);
    expect(inVendorsShown(approved, 'rejected')).toBe(false);
  });

  it('reads the choice from the address, and nothing else as one', () => {
    expect(vendorsShownFrom('unassigned')).toBe('unassigned');
    expect(vendorsShownFrom('rejected')).toBe('rejected');
    expect(vendorsShownFrom('everything')).toBeNull();
    expect(vendorsShownFrom(undefined)).toBeNull();
  });
});
