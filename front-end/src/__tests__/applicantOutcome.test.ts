/**
 * Two outcomes after the results are published (E36/F05/S02), worded once.
 */
import { describe, expect, it } from 'vitest';
import { outcomeHeadline, seatLine } from '@/utils/applicantOutcome';

describe('what an applicant reads', () => {
  it('has a table, or did not get assigned', () => {
    expect(outcomeHeadline({ outcome: 'has_a_table' })).toBe('You have a table');
    expect(outcomeHeadline({ outcome: 'not_assigned' })).toBe('You did not get assigned');
  });

  it('reads nothing before the results are published', () => {
    expect(outcomeHeadline({ outcome: null })).toBeNull();
    expect(outcomeHeadline({})).toBeNull();
  });

  it('names each seat by its date, table and place', () => {
    expect(
      seatLine({
        date: '2026-11-21',
        tableCode: 'A 3',
        tableChoice: 'Half Table (Left)',
        section: 'A',
        location: 'Upper Atrium',
      }),
    ).toMatch(/November 21, 2026: A 3, left half, Upper Atrium$/);
  });
});
