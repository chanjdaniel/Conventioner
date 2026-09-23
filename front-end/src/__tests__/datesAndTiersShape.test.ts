import { describe, expect, it } from 'vitest';
import { reconciledDatesAndTiers } from '@/utils/essentialFields';

/**
 * The front-end half of one rule (E19/F01/S01). `reconciled_dates_and_tiers` in
 * `back-end/essential_fields.py` is the authority; these assert the mirror agrees with it, because
 * the drift would surface as the solver rejecting answers the form had just accepted.
 */
describe('a dates-and-tiers answer reaches one stored shape', () => {
  it('spreads a flat tier answer over every available date', () => {
    expect(reconciledDatesAndTiers(['Gold', 'Silver'], ['2026-11-17', '2026-11-21'])).toEqual({
      tiers: { '2026-11-17': ['Gold', 'Silver'], '2026-11-21': ['Gold', 'Silver'] },
      dates: ['2026-11-17', '2026-11-21'],
    });
  });

  it('does not share one array between dates', () => {
    const { tiers } = reconciledDatesAndTiers(['Gold'], ['2026-11-17', '2026-11-21']);
    (tiers as Record<string, string[]>)['2026-11-17'].push('Silver');

    expect((tiers as Record<string, string[]>)['2026-11-21']).toEqual(['Gold']);
  });

  it('reads availability off a grid when nothing else answers it', () => {
    // The dates you named tiers for are the dates you are available.
    expect(
      reconciledDatesAndTiers(
        { '2026-11-17': ['Gold'], '2026-11-21': [], '2026-11-22': ['Silver'] },
        [],
      ),
    ).toEqual({
      tiers: { '2026-11-17': ['Gold'], '2026-11-21': [], '2026-11-22': ['Silver'] },
      dates: ['2026-11-17', '2026-11-22'],
    });
  });

  it('leaves an availability answer that was given on its own', () => {
    expect(
      reconciledDatesAndTiers({ '2026-11-17': ['Gold'] }, ['2026-11-17', '2026-11-21']),
    ).toEqual({ tiers: { '2026-11-17': ['Gold'] }, dates: ['2026-11-17', '2026-11-21'] });
  });

  it('carries anything else through untouched, for the validator to refuse', () => {
    expect(reconciledDatesAndTiers(null, ['2026-11-17'])).toEqual({
      tiers: null,
      dates: ['2026-11-17'],
    });
  });
});
