import { describe, expect, it } from 'vitest';
import { MARKET_SURFACES, surfaceForPhase } from '@/utils/marketSurface';
import { MarketPhase } from '@/assets/types/datatypes';

describe('the workspace opens the surface the phase is worked on', () => {
  it('opens a draft on the PLAN, not the form', () => {
    // The finding asked for the opposite. Ticket 01 settled that the plan comes first and the form
    // is built from it - the back end says the offering "is never an independent list: it is the
    // market plan itself" - so the original rule is backwards and does not survive.
    expect(surfaceForPhase(MarketPhase.Draft)).toBe('setup');
  });

  it('gives the three application phases ONE surface', () => {
    // Measured rather than assumed (ticket 11): recording a verdict has no phase gate, importing
    // spans two of the three, and applications-closed changes nothing for a CSV market.
    const surfaces = [
      MarketPhase.ApplicationsOpen,
      MarketPhase.ApplicationsClosed,
      MarketPhase.Review,
    ].map(surfaceForPhase);

    expect(new Set(surfaces)).toEqual(new Set(['applications']));
  });

  it('takes assignment and everything after it to the assignment surface', () => {
    for (const phase of [
      MarketPhase.Assignment,
      MarketPhase.Offers,
      MarketPhase.MarketDays,
      MarketPhase.Archived,
    ]) {
      expect(surfaceForPhase(phase), phase).toBe('assignment');
    }
  });

  it('still gives a workspace to a phase this build does not recognise', () => {
    // The plan is editable in every phase, so it is the one surface that is never wrong to show -
    // the same defensiveness the rail already has.
    for (const unknown of [undefined, null, '', 'a_phase_from_the_future']) {
      expect(MARKET_SURFACES).toContain(surfaceForPhase(unknown));
    }
  });

  it('names every phase, so a new one is a decision and not a default', () => {
    const named = Object.values(MarketPhase).filter(
      (phase) => surfaceForPhase(phase) === surfaceForPhase('a_phase_from_the_future'),
    );
    // Only draft may share the fallback's answer; anything else falling through is unnamed.
    expect(named).toEqual([MarketPhase.Draft]);
  });
});
