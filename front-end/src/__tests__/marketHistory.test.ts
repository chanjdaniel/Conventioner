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
import { historyParts, type PlacementHistoryEntry } from '@/utils/placementHistory';

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
  it('words an assignment as the drawer does, the table left in its before and after', () => {
    const assigned = { date: '2026-11-19', table_code: 'B7', table_choice: 'Full Table' };
    const moved = { ...assigned, before: { table_code: 'A3', table_choice: 'Full Table' } };
    for (const detail of [assigned, { ...assigned, before: null }, moved]) {
      expect(sentence({ detail })).toBe(
        'dana@ember.test assigned [Ana Rivera] at B7 (Full Table) on Nov 19, 2026',
      );
    }
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
        detail: { before: { phase: 'applications' }, after: { phase: 'assignment' } },
      }),
    ).toBe('dana@ember.test moved the market from Applications to Assignment');
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

  it('words a change to a row of the permission table by its label and both roles', () => {
    const labels = { 'check-in': 'Check vendors in' };
    expect(
      sentence(
        {
          action: 'change-the-table',
          kind: 'permission_set',
          vendors: [],
          subject: { action: 'check-in' },
          detail: {
            before: { role: 'editor', source: 'built-in' },
            after: { role: 'admin', source: 'market' },
          },
        },
        labels,
      ),
    ).toBe('dana@ember.test changed Check vendors in from Editor to Admin');
    expect(
      sentence(
        {
          action: 'change-the-table',
          kind: 'permission_reset',
          vendors: [],
          subject: { action: 'check-in' },
          detail: {
            before: { role: 'admin', source: 'market' },
            after: { role: 'editor', source: 'built-in' },
          },
        },
        labels,
      ),
    ).toBe('dana@ember.test set Check vendors in back to its default, Editor');
  });

  it('words a reset of the whole table by the rows it returned', () => {
    const labels = { 'check-in': 'Check vendors in', 'move-phase': 'Move the phase' };
    const reset = (rows: string[]) =>
      sentence(
        {
          action: 'change-the-table',
          kind: 'permission_table_reset',
          vendors: [],
          detail: {
            before: Object.fromEntries(rows.map((id) => [id, { role: 'admin', source: 'market' }])),
            after: Object.fromEntries(
              rows.map((id) => [id, { role: 'editor', source: 'built-in' }]),
            ),
          },
        },
        labels,
      );
    expect(reset(['check-in'])).toBe(
      'dana@ember.test reset Check vendors in to its built-in default',
    );
    expect(reset(['check-in', 'move-phase'])).toBe(
      'dana@ember.test reset Check vendors in and Move the phase to their built-in defaults',
    );
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

describe('a placement, in the whole history and in the drawer', () => {
  /** One placement change as both read it: stored, as the whole history serves it, and recased,
   * as the placement trail serves it to the drawer. */
  const changes: Array<{
    kind: PlacementHistoryEntry['kind'];
    vendors: string[];
    stored: Record<string, unknown>;
    trail: PlacementHistoryEntry['detail'];
  }> = [
    {
      kind: 'placed',
      vendors: ['ana@ember.test'],
      stored: { date: '2026-11-19', table_code: 'B7', table_choice: 'Full Table' },
      trail: { date: '2026-11-19', tableCode: 'B7', tableChoice: 'Full Table' },
    },
    {
      kind: 'freed',
      vendors: ['ana@ember.test'],
      stored: { date: '2026-11-19', table_code: 'B7' },
      trail: { date: '2026-11-19', tableCode: 'B7' },
    },
    {
      kind: 'swapped',
      vendors: ['ana@ember.test', 'ben@ember.test'],
      stored: {
        date: '2026-11-19',
        seats: [
          { email: 'ana@ember.test', table_code: 'A3' },
          { email: 'ben@ember.test', table_code: 'B7' },
        ],
      },
      trail: {
        date: '2026-11-19',
        seats: [
          { email: 'ana@ember.test', tableCode: 'A3' },
          { email: 'ben@ember.test', tableCode: 'B7' },
        ],
      },
    },
    {
      kind: 'swapped',
      vendors: ['ana@ember.test', 'ben@ember.test'],
      stored: {},
      trail: {},
    },
    {
      kind: 'assigned',
      vendors: [],
      stored: { placements_written: 40, pins_preserved: 3 },
      trail: { placementsWritten: 40, pinsPreserved: 3 },
    },
  ];

  it.each(changes)('words $kind in the drawer’s words, after who and before the day', (change) => {
    const drawer = said(
      historyParts(
        {
          id: 'e1',
          actor: 'dana@ember.test',
          at: '2026-11-01T10:00:00+00:00',
          ...change,
          detail: change.trail,
        },
        NAMES,
      ),
    );
    const day = change.stored.date ? ' on Nov 19, 2026' : '';

    expect(sentence({ kind: change.kind, vendors: change.vendors, detail: change.stored })).toBe(
      `dana@ember.test ${drawer[0].toLowerCase()}${drawer.slice(1)}${day}`,
    );
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

  it('shows an assignment’s table left and table taken, or that the table left is unknown', () => {
    expect(
      entryChanges(entry({ detail: { date: '2026-11-19', table_code: 'B7', before: null } }))
        .changed,
    ).toEqual([{ field: 'Table', before: 'none', after: 'B7' }]);
    expect(entryChanges(entry({ detail: { table_code: 'B7' } })).changed).toEqual([
      { field: 'Table', before: 'unknown', after: 'B7' },
    ]);
  });

  it('names where a permission row came from in words', () => {
    expect(
      entryChanges(
        entry({
          action: 'change-the-table',
          kind: 'permission_set',
          detail: {
            before: { role: 'editor', source: 'organization' },
            after: { role: 'admin', source: 'market' },
          },
        }),
      ).changed,
    ).toEqual([
      { field: 'Role', before: 'Editor', after: 'Admin' },
      { field: 'Source', before: 'The organization’s default', after: 'This market' },
    ]);
  });

  it('opens a reset of the whole table to each row it returned, by its label, role and source', () => {
    expect(
      entryChanges(
        entry({
          action: 'change-the-table',
          kind: 'permission_table_reset',
          vendors: [],
          detail: {
            before: {
              'check-in': { role: 'admin', source: 'market' },
              'no-such-row': { role: 'owner', source: 'organization' },
            },
            after: {
              'check-in': { role: 'editor', source: 'built-in' },
              'no-such-row': { role: 'viewer', source: 'built-in' },
            },
          },
        }),
        { 'check-in': 'Check vendors in' },
      ),
    ).toEqual({
      changed: [
        { field: 'Check vendors in', before: 'Admin, This market', after: 'Editor, Built in' },
        {
          field: 'no-such-row',
          before: 'Owner, The organization’s default',
          after: 'Viewer, Built in',
        },
      ],
      recorded: [],
    });
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
