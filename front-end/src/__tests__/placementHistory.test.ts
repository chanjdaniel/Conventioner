/**
 * The placement trail, in words.
 *
 * The back end stores entries structured and names each kind with an enum; the wording is here,
 * so a sentence changes without a migration (`E11/F04/S01`).
 */
import { describe, expect, it } from 'vitest';
import { historyDate, historySummary, type PlacementHistoryEntry } from '@/utils/placementHistory';

const NAMES = { 'ana@ember.test': 'Ana Rivera', 'ben@ember.test': 'Ben Okafor' };

function entry(overrides: Partial<PlacementHistoryEntry>): PlacementHistoryEntry {
  return {
    id: 'e1',
    actor: 'organizer@ember.test',
    at: '2026-08-01T10:00:00+00:00',
    kind: 'placed',
    vendors: ['ana@ember.test'],
    detail: {},
    ...overrides,
  } as PlacementHistoryEntry;
}

describe('what one entry says', () => {
  it('names the vendor and the seat for a hand placement', () => {
    const text = historySummary(
      entry({
        kind: 'placed',
        detail: { date: '2026-08-01', tableCode: 'Front 1', tableChoice: 'Full Table' },
      }),
      NAMES,
    );

    expect(text).toContain('Ana Rivera');
    expect(text).toContain('Front 1');
  });

  it('says what freeing a seat left behind', () => {
    // Recorded even though nobody was placed: this is what a vendor dropping out looks like.
    const text = historySummary(
      entry({ kind: 'freed', detail: { date: '2026-08-01', tableCode: 'Front 1' } }),
      NAMES,
    );

    expect(text).toContain('Front 1');
    expect(text).toContain('no table');
  });

  it('reads a swap as one thing that happened to two people', () => {
    const text = historySummary(
      entry({
        kind: 'swapped',
        vendors: ['ana@ember.test', 'ben@ember.test'],
        detail: {
          date: '2026-08-01',
          seats: [
            { email: 'ana@ember.test', tableCode: 'Front 2' },
            { email: 'ben@ember.test', tableCode: 'Front 1' },
          ],
        },
      }),
      NAMES,
    );

    expect(text).toContain('Ana Rivera');
    expect(text).toContain('Ben Okafor');
    expect(text).toContain('Front 2');
  });

  it('reports a solver run as one line naming what it touched', () => {
    const text = historySummary(
      entry({
        kind: 'assigned',
        vendors: [],
        detail: { placementsWritten: 47, pinsPreserved: 3 },
      }),
      NAMES,
    );

    expect(text).toBe('Ran the assignment: 47 placements written, 3 pins preserved');
  });

  it('leaves the pins out of a run that preserved none', () => {
    const text = historySummary(
      entry({ kind: 'assigned', vendors: [], detail: { placementsWritten: 1, pinsPreserved: 0 } }),
      NAMES,
    );

    expect(text).toBe('Ran the assignment: 1 placement written');
  });

  it('falls back to the address for a vendor with no stored name', () => {
    const text = historySummary(
      entry({
        vendors: ['nobody@ember.test'],
        detail: { tableCode: 'Front 1', tableChoice: 'Full Table' },
      }),
      NAMES,
    );

    expect(text).toContain('nobody@ember.test');
  });
});

describe('which date an entry is about', () => {
  it('names the market date for a placement, formatted like every other market date', () => {
    // A stored YYYY-MM-DD on screen would be a second date format (E09/F04/S02).
    expect(historyDate(entry({ detail: { date: '2026-08-01' } }))).toBe('Aug 1, 2026');
  });

  it('names none for a solver run, which is about all of them', () => {
    expect(historyDate(entry({ kind: 'assigned', detail: {} }))).toBeNull();
  });
});
