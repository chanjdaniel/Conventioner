/**
 * The refusal used to be one hard-coded sentence - "move the market back to applications closed" -
 * shown in both directions. From a draft the organizer has to move *forward*, and
 * `applications_closed` is not one of the transitions offered to them from there, so the advice
 * named a control that was not on their screen.
 */
import { describe, expect, it } from 'vitest';
import { canImportInto, importRefusal } from '@/utils/importPhase';

describe('importRefusal', () => {
  it('refuses nothing in the two phases that take applications', () => {
    expect(importRefusal('applications_open')).toBeNull();
    expect(importRefusal('applications_closed')).toBeNull();
    expect(canImportInto('applications_open')).toBe(true);
  });

  it('sends a draft forward, which is the only direction it can go', () => {
    const reason = importRefusal('draft');

    expect(reason).toContain('Open applications first');
    expect(reason).not.toContain('back');
  });

  it('sends a market in review back, by the name of the move the rail offers', () => {
    const reason = importRefusal('review');

    expect(reason).toContain('Return to Applications Closed');
    expect(reason).toContain('review phase');
  });

  it('offers no way back past review, where the transition table has none (bug 42)', () => {
    for (const phase of ['assignment', 'market_days', 'archived']) {
      const reason = importRefusal(phase);
      expect(reason).toContain('no more applications');
      expect(reason).not.toContain('Applications Closed');
    }
  });

  it('names whatever phase it is given, rather than a list it has to be kept in step with', () => {
    expect(importRefusal('market_days')).toContain('market days phase');
    expect(importRefusal('archived')).toContain('archived phase');
  });

  it('treats a market whose phase is unknown as a draft, which is the safe read', () => {
    expect(importRefusal(undefined)).toContain('still a draft');
    expect(canImportInto(null)).toBe(false);
  });
});
