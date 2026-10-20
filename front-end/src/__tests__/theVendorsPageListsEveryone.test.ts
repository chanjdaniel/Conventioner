/**
 * The Vendors page lists every applicant (E36/F02/S04), with "Rejected only" beside "Unassigned
 * only". Unassigned keeps meaning a vendor of the run with no seat, so a rejected applicant is never
 * counted among them - the miscount bug 10 fixed by listing the run alone.
 */
import { describe, expect, it } from 'vitest';
import { inVendorsShown, vendorsShownFrom } from '@/utils/resultFilters';

const approved = { inTheRun: true, rejected: false };
const rejected = { inTheRun: false, rejected: true };

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
