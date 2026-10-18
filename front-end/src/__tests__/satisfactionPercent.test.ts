import { describe, expect, it } from 'vitest';
import { satisfactionPercent } from '@/utils/satisfactionPercent';

/**
 * Satisfaction rounds down: a run that missed one date in 210 is not 100% (known gap 7). Rounding
 * to nearest showed 209 of 210 as "100%", which tells the organizer nobody was short-changed.
 */
describe('satisfactionPercent', () => {
  it('never shows a missed date as 100%', () => {
    expect(satisfactionPercent(209 / 210)).toBe('99%');
  });

  it('shows every date given as 100%', () => {
    expect(satisfactionPercent(1)).toBe('100%');
  });

  it('rounds down rather than to the nearest', () => {
    expect(satisfactionPercent(0.6066)).toBe('60%');
  });

  it('does not lose a whole percent to floating point', () => {
    expect(satisfactionPercent(0.29)).toBe('29%');
  });

  it('says when there is nothing to be satisfied', () => {
    expect(satisfactionPercent(null)).toBe('Not applicable');
    expect(satisfactionPercent(undefined)).toBe('Not applicable');
  });
});
