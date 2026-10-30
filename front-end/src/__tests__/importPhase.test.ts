/**
 * Whether a market can be imported into, said before the organizer picks a file (E38/F04/S01).
 *
 * A Google Form market's first import, in draft, is its way into Review, and in Review a Redo import
 * reads the whole file again; from assignment on nothing more is imported. A draft whose setup would
 * keep it out of Review is told what it lacks, by the move's own served blockers.
 */
import { describe, expect, it } from 'vitest';
import type { Market, PreconditionResult } from '@/assets/types/datatypes';
import { canImportInto, importRefusal } from '@/utils/importPhase';

const NOTHING_IMPORTED: PreconditionResult = {
  id: 'responses_imported',
  passed: false,
  message: "Nothing has been imported yet. Import your Google Form's responses first.",
  resolutionLink: 'import',
  resolutionLabel: 'Import responses',
};
const NO_LOCATION: PreconditionResult = {
  id: 'setup_has_a_location',
  passed: false,
  message: 'This market has no location. Add one on Market Setup.',
  resolutionLink: 'setup',
  resolutionLabel: 'Add a location',
};

function market(phase: string, blockers: PreconditionResult[] = []): Market {
  return { id: 'm1', phase, transitionBlockers: { applications: blockers } } as unknown as Market;
}

describe('importRefusal', () => {
  it('refuses nothing in a ready draft or in Review', () => {
    expect(importRefusal(market('draft', [NOTHING_IMPORTED]))).toBeNull();
    expect(importRefusal(market('applications'))).toBeNull();
    expect(canImportInto('draft')).toBe(true);
    expect(canImportInto('applications')).toBe(true);
  });

  it("tells a draft what would keep it out of Review, never the import's own wait", () => {
    expect(importRefusal(market('draft', [NO_LOCATION, NOTHING_IMPORTED]))).toBe(
      NO_LOCATION.message,
    );
  });

  it('takes nothing from assignment on', () => {
    for (const phase of ['assignment', 'market_days', 'archived']) {
      const reason = importRefusal(market(phase));
      expect(reason).toContain('no more applications');
      expect(canImportInto(phase)).toBe(false);
    }
  });

  it('names whatever phase it is given, rather than a list it has to be kept in step with', () => {
    expect(importRefusal(market('market_days'))).toContain('market days phase');
    expect(importRefusal(market('archived'))).toContain('archived phase');
  });

  it('reads a market with no phase as a draft, as the server does', () => {
    expect(canImportInto(null)).toBe(true);
    expect(importRefusal(null)).toBeNull();
  });
});
