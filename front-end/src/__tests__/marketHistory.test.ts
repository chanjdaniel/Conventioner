/**
 * The market's history, in words (E40/F01/S03): each entry a sentence the screen words from the
 * structured entry, which opens to show before and after.
 */
import { describe, expect, it } from 'vitest';
import {
  dayEnds,
  dayStarts,
  entryChanges,
  entryParts,
  valueText,
  type MarketHistoryEntry,
  type MarketHistoryPart,
} from '@/utils/marketHistory';

const NAMES = { 'ana@ember.test': 'Ana Rivera', 'ben@ember.test': 'Ben Okafor' };

function entry(overrides: Partial<MarketHistoryEntry>): MarketHistoryEntry {
  return {
    id: 'e1',
    actor: 'dana@ember.test',
    at: '2026-11-01T10:00:00+00:00',
    action: 'assign',
    kind: 'placed',
    vendors: ['ana@ember.test'],
    subject: {},
    detail: {},
    ...overrides,
  };
}

/** The sentence as text, a vendor as "[name]". */
function said(parts: MarketHistoryPart[]): string {
  return parts
    .map((part) => (part.kind === 'text' ? part.text : `[${part.name || part.email}]`))
    .join('');
}

function sentence(overrides: Partial<MarketHistoryEntry>, labels = {}): string {
  return said(entryParts(entry(overrides), NAMES, labels));
}

describe('what an entry says', () => {
  it('words a move from one seat to another', () => {
    expect(
      sentence({
        detail: {
          date: '2026-11-19',
          table_code: 'B7',
          table_choice: 'Full Table',
          before: { table_code: 'A3', table_choice: 'Full Table' },
        },
      }),
    ).toBe(
      'dana@ember.test moved [Ana Rivera] from A3 (Full Table) to B7 (Full Table) on Nov 19, 2026',
    );
  });

  it('words a placement with no seat left, or none known, without a "from"', () => {
    const placed = { date: '2026-11-19', table_code: 'B7', table_choice: 'Full Table' };
    expect(sentence({ detail: { ...placed, before: null } })).toBe(
      'dana@ember.test placed [Ana Rivera] at B7 (Full Table) on Nov 19, 2026',
    );
    expect(sentence({ detail: placed })).toBe(
      'dana@ember.test placed [Ana Rivera] at B7 (Full Table) on Nov 19, 2026',
    );
  });

  it('words a verdict by its status', () => {
    expect(
      sentence({
        action: 'give-verdicts',
        kind: 'verdict',
        detail: { before: { status: 'open' }, after: { status: 'reviewer_approved' } },
      }),
    ).toBe('dana@ember.test set [Ana Rivera] to Approved');
  });

  it('words a selection of verdicts naming each vendor', () => {
    expect(
      sentence({
        action: 'give-verdicts',
        kind: 'verdicts',
        vendors: ['ana@ember.test', 'ben@ember.test'],
        detail: {
          before: { a1: { status: 'open' }, a2: { status: 'open' } },
          after: { a1: { status: 'reviewer_rejected' }, a2: { status: 'reviewer_rejected' } },
        },
      }),
    ).toBe('dana@ember.test set 2 applications to Rejected: [Ana Rivera], [Ben Okafor]');
  });

  it('words a setup change by the fields it changed', () => {
    expect(
      sentence({
        action: 'change-setup',
        kind: 'plan',
        vendors: [],
        detail: {
          before: { tiers: [], market_dates: [] },
          after: { tiers: [1], market_dates: [1] },
        },
      }),
    ).toBe('dana@ember.test changed Market Setup: tiers and market dates');
  });

  it('words a role change by the person and both roles', () => {
    expect(
      sentence({
        action: 'manage-editors-and-viewers',
        kind: 'role_changed',
        vendors: [],
        subject: { user_id: 'u1', email: 'priya@ember.test' },
        detail: { before: { role: 'viewer' }, after: { role: 'editor' } },
      }),
    ).toBe('dana@ember.test changed priya@ember.test from Viewer to Editor');
  });

  it('words a phase move by both phases', () => {
    expect(
      sentence({
        action: 'move-phase',
        kind: null,
        vendors: [],
        detail: { before: { phase: 'review' }, after: { phase: 'assignment' } },
      }),
    ).toBe('dana@ember.test moved the market from Review to Assignment');
  });

  it('words a check-in made on the public page as the vendor’s own', () => {
    expect(
      sentence({
        actor: null,
        action: 'check-in',
        kind: 'checked_in',
        subject: { date: '2026-11-19' },
        detail: {
          before: { checked_in: false },
          after: { checked_in: true },
          via: 'check_in_page',
        },
      }),
    ).toBe('[Ana Rivera] checked in on the check-in page on Nov 19, 2026');
  });

  it('words an applicant’s own application as theirs', () => {
    expect(sentence({ actor: 'ana@ember.test', action: 'apply', kind: 'submitted' })).toBe(
      '[Ana Rivera] applied',
    );
  });

  it('names a change it has no words for by its row of the table', () => {
    expect(
      sentence(
        { action: 'record-payment', kind: null, vendors: ['ben@ember.test'] },
        { 'record-payment': 'Record a payment' },
      ),
    ).toBe('dana@ember.test made a change: Record a payment, about [Ben Okafor]');
  });

  it('draws a vendor with no name as their address', () => {
    const [, , vendor] = entryParts(
      entry({ vendors: ['cy@ember.test'], detail: { table_code: 'A1' } }),
      NAMES,
    );
    expect(vendor).toEqual({ kind: 'vendor', name: '', email: 'cy@ember.test' });
  });
});

describe('what an entry opens to', () => {
  it('shows each changed field before and after, and what else it recorded', () => {
    expect(
      entryChanges(
        entry({
          action: 'move-phase',
          kind: null,
          detail: { before: { phase: 'offers' }, after: { phase: 'market_days' }, swept: 3 },
        }),
      ),
    ).toEqual({
      changed: [{ field: 'Phase', before: 'Offers', after: 'Market Days' }],
      recorded: [{ field: 'Swept', value: '3' }],
    });
  });

  it('shows a placement’s seat left and seat taken, or that the seat left is unknown', () => {
    expect(
      entryChanges(entry({ detail: { date: '2026-11-19', table_code: 'B7', before: null } }))
        .changed,
    ).toEqual([{ field: 'Seat', before: 'none', after: 'B7' }]);
    expect(entryChanges(entry({ detail: { table_code: 'B7' } })).changed).toEqual([
      { field: 'Seat', before: 'unknown', after: 'B7' },
    ]);
  });

  it('shows a detail with no before and after as what it recorded', () => {
    expect(
      entryChanges(
        entry({ action: 'import-applications', kind: 'imported', detail: { row_count: 12 } }),
      ),
    ).toEqual({ changed: [], recorded: [{ field: 'Row count', value: '12' }] });
  });

  it('draws a value as words, and cuts a long one', () => {
    expect(valueText(null)).toBe('none');
    expect(valueText(true)).toBe('yes');
    expect(valueText({ a: 1 })).toBe('{"a":1}');
    expect(valueText('x'.repeat(300))).toHaveLength(241);
  });
});

describe('a date range', () => {
  it('runs from the start of the first day to the start of the day after the last', () => {
    const from = new Date(dayStarts('2026-11-19'));
    const to = new Date(dayEnds('2026-11-19'));
    expect([from.getDate(), from.getHours()]).toEqual([19, 0]);
    expect([to.getDate(), to.getHours()]).toEqual([20, 0]);
  });
});
