import { describe, expect, it } from 'vitest';
import { datesTheyNeed, datesWithinReach } from '@/utils/datesWithinReach';

const DATES = ['2026-11-18', '2026-11-19', '2026-11-20'];

/**
 * How many dates a vendor could have had: what the Vendors list counts their placements against.
 * It counted against the market's dates, so a vendor who asked for one and got it read "1 / 3"
 * (2026-10-18 dry run).
 */
describe('datesWithinReach', () => {
  it('is the dates they can attend when they set no limit', () => {
    const answers = { essential_available_dates: ['2026-11-18', '2026-11-20'] };
    expect(datesWithinReach(answers, DATES, null)).toBe(2);
  });

  it('is bounded by their own limit', () => {
    const answers = { essential_available_dates: DATES, essential_max_dates: 1 };
    expect(datesWithinReach(answers, DATES, null)).toBe(1);
  });

  it("is bounded by the market's ceiling", () => {
    const answers = { essential_available_dates: DATES, essential_max_dates: 3 };
    expect(datesWithinReach(answers, DATES, 2)).toBe(2);
  });

  it('counts only dates the market has', () => {
    const answers = { essential_available_dates: ['2026-11-18', '2025-01-01'] };
    expect(datesWithinReach(answers, DATES, null)).toBe(1);
  });

  it('reads a limit imported as text', () => {
    const answers = { essential_available_dates: DATES, essential_max_dates: '2' };
    expect(datesWithinReach(answers, DATES, null)).toBe(2);
  });

  it('is zero for answers that name no date', () => {
    expect(datesWithinReach({}, DATES, null)).toBe(0);
  });
});

/**
 * A vendor added by hand answered nothing, and needs a table on every market day (E38/F08/S02):
 * their count reads "0 of 3 dates" until seated, never "0 of 0".
 */
describe('datesTheyNeed', () => {
  it('is every market day for a vendor added by hand, whatever the ceiling', () => {
    expect(datesTheyNeed({ answers: {}, added: true }, DATES, 1)).toBe(3);
  });

  it('is the dates within reach for anyone who applied', () => {
    const answers = { essential_available_dates: DATES, essential_max_dates: 1 };
    expect(datesTheyNeed({ answers, added: false }, DATES, null)).toBe(1);
  });
});
