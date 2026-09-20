/**
 * A market date reads the same wherever an essential question shows one.
 *
 * `formattedEssentialDate` used to append the year itself, because the `getFormattedDate` of the
 * day carried none. E09/F04/S02 - the "one date format" story - gave `getFormattedDate` the year
 * and left this caller appending a second one, so every applicant-facing date read
 * "Saturday, November 21, 2026, 2026" (E14/F01/S01).
 */
import { describe, expect, it } from 'vitest';
import { applicationAnswerRows, formattedEssentialDate } from '@/utils/essentialFields';
import { getFormattedDate } from '@/utils/utils';

const DATES = ['2026-11-21', '2026-01-01', '2026-12-31'];

describe('a market date on an essential question', () => {
  it.each(DATES)('prints its year exactly once: %s', (date) => {
    const year = date.slice(0, 4);
    const occurrences = formattedEssentialDate(date).split(year).length - 1;

    expect(occurrences).toBe(1);
  });

  /**
   * Catches decoration this side of the seam - a year, a weekday, a "(market day)" - that the
   * count above would miss. It cannot catch a change to `getFormattedDate` itself, which moves
   * both sides together; the count above is what holds that end.
   */
  it.each(DATES)('adds nothing to the product date format: %s', (date) => {
    expect(formattedEssentialDate(date)).toBe(getFormattedDate(date));
  });

  it('shows an unreadable stored date verbatim rather than blanking it', () => {
    expect(formattedEssentialDate('not-a-date')).toBe('not-a-date');
  });
});

describe('a stored answer read back', () => {
  it('separates dates so each one can be told from the next', () => {
    const { essential } = applicationAnswerRows({
      essential_available_dates: ['2026-11-21', '2026-11-22'],
    });
    const value = essential.find((r) => r.key === 'essential_available_dates')!.value;

    expect(value).toBe('Saturday, November 21, 2026 · Sunday, November 22, 2026');
  });

  it('prints the per-date tier answer without doubling its year', () => {
    const { essential } = applicationAnswerRows({
      essential_tier_preference: { '2026-11-21': ['Gold'], '2026-11-22': ['Silver'] },
    });
    const value = essential.find((r) => r.key === 'essential_tier_preference')!.value;

    expect(value).toBe('Saturday, November 21, 2026: Gold · Sunday, November 22, 2026: Silver');
  });
});
