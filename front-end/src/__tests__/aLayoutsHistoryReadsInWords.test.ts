/**
 * A layout's save, in the market's history (T257 ticket 02): the `floorplan` entry names its
 * location and says what the save did, from `layout.describe_change`'s detail.
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

  it('names a layout whose location is gone as a layout', () => {
    expect(said(saved({ started: true }, null))).toBe('dana@ember.test started a layout');
  });

  it('says a save it has no words for yet changed the layout', () => {
    expect(said(saved({ colours: ['Gold row'] }))).toBe(
      "dana@ember.test changed Upper Hall's layout",
    );
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
