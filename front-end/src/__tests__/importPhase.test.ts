/**
 * Whether a market can be imported into, said before the organizer picks a file (E38/F04/S01).
 *
 * A Google Form market's first import, in draft, is its way into Review, and in Review a Redo import
 * reads the whole file again; from assignment on nothing more is imported. A draft whose setup would
 * keep it out of Review is told what it lacks, by the move's own served blockers.
 */
import { describe, expect, it } from 'vitest';
import type { Market, PreconditionResult } from '@/assets/types/datatypes';
import { canImportInto, firstImportBlockers, importRefusal } from '@/utils/importPhase';

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

const NO_DATES: PreconditionResult = {
  id: 'setup_has_dates',
  passed: false,
  message: "This market has no market dates. Pick them on Market Setup's calendar.",
  resolutionLink: 'setup',
  resolutionLabel: 'Pick market dates',
};
const NO_TABLES: PreconditionResult = {
  id: 'every_tier_has_tables',
  passed: false,
  message: 'This market has no tables yet. Add a section with tables on Market Setup.',
  resolutionLink: 'setup',
  resolutionLabel: 'Add tables',
};

function market(phase: string, blockers: PreconditionResult[] = []): Market {
  return { id: 'm1', phase, transitionBlockers: { applications: blockers } } as unknown as Market;
}

function formMarket(phase: string, blockers: PreconditionResult[] = []): Market {
  return { ...market(phase, blockers), intakeMode: 'form' } as Market;
}

/** `import_refusal`'s sentence in `back-end/csv_import.py`, word for word. */
const FORM_MARKET_REFUSAL =
  'This market takes applications on its own page, so nothing is imported into it.';

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

  it('names every blocker at once, in the order the guards serve them (T205/F09)', () => {
    expect(
      importRefusal(market('draft', [NO_DATES, NO_LOCATION, NO_TABLES, NOTHING_IMPORTED])),
    ).toBe(`${NO_DATES.message} ${NO_LOCATION.message} ${NO_TABLES.message}`);
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

  it('refuses a market whose vendors apply on its page in every phase, before its plan, as the server does', () => {
    for (const phase of ['draft', 'applications', 'assignment']) {
      expect(importRefusal(formMarket(phase, [NO_DATES, NO_LOCATION, NOTHING_IMPORTED]))).toBe(
        FORM_MARKET_REFUSAL,
      );
    }
  });
});

describe('firstImportBlockers', () => {
  it("is every served blocker of the move into Review but the import's own, in order", () => {
    expect(
      firstImportBlockers(market('draft', [NO_DATES, NOTHING_IMPORTED, NO_LOCATION, NO_TABLES])),
    ).toEqual([NO_DATES, NO_LOCATION, NO_TABLES]);
  });

  it('is empty for a draft waiting on nothing but the import', () => {
    expect(firstImportBlockers(market('draft', [NOTHING_IMPORTED]))).toEqual([]);
  });

  it('is empty past draft, where an import moves nothing', () => {
    for (const phase of ['applications', 'assignment', 'market_days', 'archived']) {
      expect(firstImportBlockers(market(phase, [NO_LOCATION]))).toEqual([]);
    }
  });

  it('reads a market with no phase as a draft, and no market as waiting on nothing', () => {
    const noPhase = { id: 'm1', transitionBlockers: { applications: [NO_LOCATION] } };
    expect(firstImportBlockers(noPhase as unknown as Market)).toEqual([NO_LOCATION]);
    expect(firstImportBlockers(null)).toEqual([]);
  });

  it('is empty for a market whose vendors apply on its page, which takes no import at all', () => {
    expect(firstImportBlockers(formMarket('draft', [NO_DATES, NO_LOCATION]))).toEqual([]);
  });
});
