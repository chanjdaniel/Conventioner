/**
 * A layout's save, in the market's history (T257 ticket 02): the `floorplan` entry names its
 * location and says what the save did, from `layout.describe_change`'s detail; ticket 04 adds the
 * tables added, removed, moved and turned, and ticket 05 a section renumbered, its colour, its
 * label, and the `floorplan_removed` entry of a layout taken with its location.
 */
import { describe, expect, it } from 'vitest';
import {
  entryChanges,
  entryParts,
  type MarketHistoryEntry,
  type MarketHistoryPart,
} from '@/utils/marketHistory';

function saved(
  detail: Record<string, unknown>,
  location: string | null = 'Upper Hall',
): MarketHistoryEntry {
  return {
    id: 'e1',
    actor: 'dana@ember.test',
    at: '2026-11-01T10:00:00+00:00',
    action: 'change-setup',
    kind: 'floorplan',
    vendors: [],
    subject: { floorplan_id: 'fp-1', location },
    detail,
  };
}

function said(entry: MarketHistoryEntry): string {
  return entryParts(entry, { names: {}, labels: {} })
    .map((part: MarketHistoryPart) => (part.kind === 'text' ? part.text : `[${part.name}]`))
    .join('');
}

describe("a layout's save reads in words", () => {
  it('says a first save started the layout', () => {
    expect(said(saved({ started: true }))).toBe("dana@ember.test started Upper Hall's layout");
  });

  it('says a scale set for the first time calibrated the layout', () => {
    expect(said(saved({ scale: { before: null, after: 36 } }))).toBe(
      "dana@ember.test calibrated Upper Hall's layout to 36.0 m across",
    );
  });

  it('says a scale changed recalibrated it', () => {
    expect(said(saved({ scale: { before: 30, after: 36 } }))).toBe(
      "dana@ember.test recalibrated Upper Hall's layout to 36.0 m across",
    );
  });

  it('says a recalibration by a few centimetres to the centimetre', () => {
    expect(said(saved({ scale: { before: 30, after: 30.04 } }))).toBe(
      "dana@ember.test recalibrated Upper Hall's layout to 30.04 m across",
    );
    expect(entryChanges(saved({ scale: { before: 30, after: 30.004 } }))).toEqual({
      changed: [{ field: 'Metres across', before: '30.000 m', after: '30.004 m' }],
      recorded: [],
    });
  });

  it('says how many tables were given another type', () => {
    expect(said(saved({ retyped: 2 }))).toBe(
      'dana@ember.test changed the type of 2 tables in Upper Hall',
    );
  });

  it('says a new image replaced the floorplan image', () => {
    expect(said(saved({ image: 'replaced' }))).toBe(
      "dana@ember.test replaced Upper Hall's floorplan image",
    );
  });

  it('joins what one save did', () => {
    expect(said(saved({ image: 'replaced', scale: { before: 30, after: 12.5 } }))).toBe(
      "dana@ember.test replaced Upper Hall's floorplan image and recalibrated Upper Hall's " +
        'layout to 12.5 m across',
    );
  });

  it('says how many tables were added to each section', () => {
    expect(said(saved({ added: { 'Silver aisle': 12 } }))).toBe(
      'dana@ember.test added 12 tables to Silver aisle in Upper Hall',
    );
    expect(said(saved({ added: { 'Gold row': 1, 'Silver aisle': 2 } }))).toBe(
      'dana@ember.test added 1 table to Gold row in Upper Hall and added 2 tables to Silver ' +
        'aisle in Upper Hall',
    );
  });

  it('says how many were removed, the renumbering that closed the gap left unsaid', () => {
    expect(said(saved({ removed: { 'Gold row': 1 }, renumbered: ['Gold row'] }))).toBe(
      'dana@ember.test removed 1 table from Gold row in Upper Hall',
    );
  });

  it('says tables of no section are in none', () => {
    expect(said(saved({ added: { 'in no section': 2 } }))).toBe(
      'dana@ember.test added 2 tables in no section in Upper Hall',
    );
  });

  it('says how many tables were moved and how many turned', () => {
    expect(said(saved({ moved: 3 }))).toBe('dana@ember.test moved 3 tables in Upper Hall');
    expect(said(saved({ turned: 1 }))).toBe('dana@ember.test turned 1 table in Upper Hall');
    expect(said(saved({ moved: 2, turned: 2 }))).toBe(
      'dana@ember.test moved 2 tables in Upper Hall and turned 2 tables in Upper Hall',
    );
  });

  it('says a move in a layout whose location is gone without a place', () => {
    expect(said(saved({ moved: 1 }, null))).toBe('dana@ember.test moved 1 table');
  });

  it('names a layout whose location is gone as a layout', () => {
    expect(said(saved({ started: true }, null))).toBe('dana@ember.test started a layout');
  });

  it('says which sections were renumbered', () => {
    expect(said(saved({ renumbered: ['Gold row'] }))).toBe(
      'dana@ember.test renumbered Gold row in Upper Hall',
    );
    expect(said(saved({ renumbered: ['Gold row', 'Silver aisle'] }))).toBe(
      'dana@ember.test renumbered Gold row and Silver aisle in Upper Hall',
    );
  });

  it('says tables changed section, the numbers that followed left unsaid', () => {
    expect(
      said(
        saved({
          added: { 'Silver aisle': 3 },
          removed: { 'Gold row': 3 },
          renumbered: ['Gold row'],
        }),
      ),
    ).toBe(
      'dana@ember.test added 3 tables to Silver aisle in Upper Hall and ' +
        'removed 3 tables from Gold row in Upper Hall',
    );
  });

  it('says whose colour changed, and whose label moved', () => {
    expect(said(saved({ colours: ['Gold row'] }))).toBe(
      "dana@ember.test changed Gold row's colour in Upper Hall",
    );
    expect(said(saved({ colours: ['Gold row', 'Silver aisle'] }))).toBe(
      'dana@ember.test changed the colours of Gold row and Silver aisle in Upper Hall',
    );
    expect(said(saved({ labels: ['Gold row'] }))).toBe(
      "dana@ember.test moved Gold row's label in Upper Hall",
    );
    expect(said(saved({ labels: ['Gold row', 'Silver aisle'] }))).toBe(
      'dana@ember.test moved the labels of Gold row and Silver aisle in Upper Hall',
    );
  });

  it('says a save it has no words for yet changed the layout', () => {
    expect(said(saved({ walls: 2 }))).toBe("dana@ember.test changed Upper Hall's layout");
  });

  it('opens to the metres across before and after', () => {
    expect(entryChanges(saved({ scale: { before: 30, after: 36 } }))).toEqual({
      changed: [{ field: 'Metres across', before: '30.0 m', after: '36.0 m' }],
      recorded: [],
    });
  });

  it('reads an entry of the beta, with its two sides, as it did', () => {
    expect(
      said({
        ...saved({ before: { tables: 1 }, after: { tables: 2 } }),
        subject: { floorplan_id: 'f' },
      }),
    ).toBe('dana@ember.test saved a floorplan to the market');
  });
});

describe('a layout taken with its location reads in words', () => {
  const removed = (tables: number, location: string | null = 'Upper Hall'): MarketHistoryEntry => ({
    ...saved({ before: { tables }, after: { tables: null } }, location),
    kind: 'floorplan_removed',
  });

  it('names the location and how many tables went with it', () => {
    expect(said(removed(49))).toBe(
      "dana@ember.test removed Upper Hall's layout of 49 tables with its location",
    );
    expect(said(removed(1))).toBe(
      "dana@ember.test removed Upper Hall's layout of 1 table with its location",
    );
  });

  it('says a layout with no table as a layout', () => {
    expect(said(removed(0))).toBe("dana@ember.test removed Upper Hall's layout with its location");
  });

  it('says a layout whose location was not recorded as a layout', () => {
    expect(said(removed(3, null))).toBe(
      'dana@ember.test removed a layout of 3 tables with its location',
    );
  });
});

describe("a layout's no-table zones read in words (ticket 10)", () => {
  it('says the zones a save marked, changed and removed', () => {
    expect(said(saved({ zones: { added: 2, changed: 0, removed: 0 } }))).toBe(
      'dana@ember.test marked 2 no-table zones in Upper Hall',
    );
    expect(said(saved({ zones: { added: 0, changed: 1, removed: 1 } }))).toBe(
      'dana@ember.test changed 1 no-table zone in Upper Hall and removed 1 no-table zone in Upper Hall',
    );
  });
});

describe("the market's table types read in words (ticket 10)", () => {
  const SIX = { id: 'tt-six', name: 'Standard 6 ft', size: '183 x 76 cm' };
  const SQUARE = { id: 'tt-square', name: 'Square 4 ft', size: '122 x 122 cm' };
  const types = (before: unknown[], after: unknown[]): MarketHistoryEntry => ({
    ...saved({ before: { table_types: before }, after: { table_types: after } }),
    kind: 'table_types',
    subject: {},
  });

  it('says a type added, with its size', () => {
    expect(said(types([SIX], [SIX, SQUARE]))).toBe(
      'dana@ember.test changed the table types: added Square 4 ft (122 x 122 cm)',
    );
  });

  it('says a type renamed, resized and removed, by its id', () => {
    expect(
      said(types([SIX, SQUARE], [{ ...SIX, name: 'Trestle 6 ft', size: '180 x 75 cm' }])),
    ).toBe(
      'dana@ember.test changed the table types: renamed Standard 6 ft to Trestle 6 ft, ' +
        'resized Trestle 6 ft to 180 x 75 cm and removed Square 4 ft',
    );
  });

  it('lists the types before and after', () => {
    expect(entryChanges(types([SIX], [SIX, SQUARE]))).toEqual({
      changed: [
        {
          field: 'Table types',
          before: 'Standard 6 ft (183 x 76 cm)',
          after: 'Standard 6 ft (183 x 76 cm)\nSquare 4 ft (122 x 122 cm)',
        },
      ],
      recorded: [],
    });
  });
});
