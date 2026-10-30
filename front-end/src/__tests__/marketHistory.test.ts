/**
 * The market's history, in words (E40/F01/S03): each entry a sentence the screen words from the
 * structured entry, which opens to show before and after.
 */
import { describe, expect, it } from 'vitest';
import { IntakeMode } from '@/assets/types/datatypes';
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
  it('words an assignment to a vendor with no table, or one from before the table left was kept', () => {
    const assigned = { date: '2026-11-19', table_code: 'B7', table_choice: 'Full Table' };
    for (const detail of [assigned, { ...assigned, before: null }]) {
      expect(sentence({ detail })).toBe(
        'dana@ember.test assigned [Ana Rivera] at B7 (Full Table) on Nov 19, 2026',
      );
    }
  });

  it('words a move as a move, from the table left to the table taken', () => {
    const detail = {
      date: '2026-11-19',
      table_code: 'B7',
      table_choice: 'Full Table',
      before: { table_code: 'A3', table_choice: 'Full Table' },
    };
    expect(sentence({ detail })).toBe(
      'dana@ember.test moved [Ana Rivera] from A3 to B7 (Full Table) on Nov 19, 2026',
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

  it('words a change of verdict by what it was and what it became (E38/F06/S01)', () => {
    expect(
      sentence({
        action: 'change-verdicts',
        kind: 'verdict',
        detail: { before: { status: 'reviewer_approved' }, after: { status: 'reviewer_rejected' } },
      }),
    ).toBe('dana@ember.test changed [Ana Rivera] from Approved to Rejected');
  });

  it('words a selection that changed verdicts as a selection', () => {
    expect(
      sentence({
        action: 'change-verdicts',
        kind: 'verdicts',
        vendors: ['ana@ember.test', 'ben@ember.test'],
        detail: {
          before: { a1: { status: 'reviewer_approved' }, a2: { status: 'open' } },
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

  it('words a phase move by both phases, as the market’s path names them', () => {
    const move = entry({
      action: 'move-phase',
      kind: null,
      vendors: [],
      detail: { before: { phase: 'applications' }, after: { phase: 'assignment' } },
    });
    expect(said(entryParts(move, NAMES, {}, IntakeMode.Csv))).toBe(
      'dana@ember.test moved the market from Review to Assignment',
    );
    expect(said(entryParts(move, NAMES, {}, IntakeMode.Form))).toBe(
      'dana@ember.test moved the market from Applications to Assignment',
    );
  });

  it('words a stop of applications as a stop', () => {
    expect(
      sentence({
        action: 'stop-applications',
        kind: null,
        vendors: [],
        detail: { before: { applications_stopped: false }, after: { applications_stopped: true } },
      }),
    ).toBe('dana@ember.test stopped taking applications');
  });

  it('words taking applications again as a resume', () => {
    expect(
      sentence({
        action: 'stop-applications',
        kind: null,
        vendors: [],
        detail: { before: { applications_stopped: true }, after: { applications_stopped: false } },
      }),
    ).toBe('dana@ember.test took applications again');
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

  it('words an update of a vendor’s info by who updated whose', () => {
    expect(
      sentence({
        action: 'update-vendor-info',
        kind: null,
        vendors: ['ana@ember.test'],
        detail: { before: { category: 'Crafts' }, after: { category: 'Food' } },
      }),
    ).toBe('dana@ember.test updated the info of [Ana Rivera]');
  });

  it('says a change it has no words and no row label for is a change, never its id', () => {
    expect(sentence({ action: 'record-payment', kind: null, vendors: ['ben@ember.test'] })).toBe(
      'dana@ember.test made a change, about [Ben Okafor]',
    );
    expect(sentence({ action: 'record-payment', kind: null, vendors: [] })).toBe(
      'dana@ember.test made a change',
    );
  });

  it('draws a vendor with no name as their address', () => {
    const [, , vendor] = entryParts(
      entry({ vendors: ['cy@ember.test'], detail: { table_code: 'A1' } }),
      NAMES,
    );
    expect(vendor).toEqual({ kind: 'vendor', name: '', email: 'cy@ember.test' });
  });
});

describe('who reviews which application (E38/F07/S02)', () => {
  const SAM = 'sam@example.com';
  const KAI = 'kai@example.com';

  function reviewers(before: string[], after: string[]): MarketHistoryEntry {
    return entry({
      action: 'choose-reviewers',
      kind: 'reviewers',
      vendors: [],
      detail: { before: { reviewers: before }, after: { reviewers: after } },
    });
  }

  function dealt(to: Array<string | null>, from: Array<string | null> = []): MarketHistoryEntry {
    const vendors = ['ana@ember.test', 'ben@ember.test', 'cy@ember.test'].slice(0, to.length);
    const ids = vendors.map((_vendor, index) => `app-${index}`);
    return entry({
      action: 'choose-reviewers',
      kind: 'dealt',
      vendors,
      subject: { application_ids: ids },
      detail: {
        cause: 'reviewers_changed',
        before: Object.fromEntries(ids.map((id, i) => [id, { reviewer: from[i] ?? null }])),
        after: Object.fromEntries(ids.map((id, i) => [id, { reviewer: to[i] }])),
      },
    });
  }

  it('words a first choice of reviewers by who was chosen', () => {
    expect(said(entryParts(reviewers([], ['a@x.test', 'b@x.test', 'c@x.test']), NAMES))).toBe(
      'dana@ember.test chose the reviewers: a@x.test, b@x.test and c@x.test',
    );
  });

  it('words a change of reviewers by who was added and who was removed', () => {
    expect(
      said(entryParts(reviewers(['a@x.test', 'b@x.test'], ['b@x.test', 'c@x.test']), NAMES)),
    ).toBe('dana@ember.test changed the reviewers: added c@x.test, removed a@x.test');
    expect(said(entryParts(reviewers(['a@x.test'], ['a@x.test', 'c@x.test']), NAMES))).toBe(
      'dana@ember.test changed the reviewers: added c@x.test',
    );
  });

  it('words taking every reviewer away as such', () => {
    expect(said(entryParts(reviewers(['a@x.test'], []), NAMES))).toBe(
      'dana@ember.test removed every reviewer',
    );
  });

  it('words a deal of one application by the vendor and whom it went to', () => {
    expect(said(entryParts(dealt([SAM]), NAMES))).toBe(
      `dana@ember.test dealt the application of [Ana Rivera] to ${SAM}`,
    );
  });

  it('words a deal of many by how many and among how many reviewers', () => {
    expect(said(entryParts(dealt([SAM, KAI, SAM]), NAMES))).toBe(
      'dana@ember.test dealt 3 open applications among 2 reviewers',
    );
  });

  it('words a deal back to first come, first served as such', () => {
    expect(said(entryParts(dealt([null, null], [SAM, KAI]), NAMES))).toBe(
      'dana@ember.test returned 2 open applications to first come, first served',
    );
    expect(said(entryParts(dealt([null], [SAM]), NAMES))).toBe(
      'dana@ember.test returned the application of [Ana Rivera] to first come, first served',
    );
  });

  it('words a deal of many as the vendor’s own line in their own history', () => {
    const many = dealt([SAM, KAI, SAM]);

    expect(said(entryParts(many, NAMES, {}, IntakeMode.Csv, 'ben@ember.test'))).toBe(
      `dana@ember.test dealt the application to ${KAI}`,
    );
    expect(
      said(
        entryParts(dealt([null, null], [SAM, KAI]), NAMES, {}, IntakeMode.Csv, 'BEN@ember.test'),
      ),
    ).toBe('dana@ember.test returned the application to first come, first served');
  });

  it('opens a deal to each vendor’s reviewer before and after, and the vendor’s own alone', () => {
    const many = dealt([SAM, KAI], [null, SAM]);

    expect(entryChanges(many)).toEqual({
      changed: [
        { field: 'ana@ember.test', before: 'none', after: SAM },
        { field: 'ben@ember.test', before: SAM, after: KAI },
      ],
      recorded: [],
    });
    expect(entryChanges(many, {}, IntakeMode.Csv, 'ben@ember.test').changed).toEqual([
      { field: 'Reviewer', before: SAM, after: KAI },
    ]);
  });

  it('words an applicant’s own arrival as their application dealt, never as their deal', () => {
    const arrived = {
      ...dealt([SAM]),
      action: 'apply',
      actor: 'ana@ember.test',
      detail: {
        cause: 'arrived',
        before: { 'app-0': { reviewer: null } },
        after: { 'app-0': { reviewer: SAM } },
      },
    };

    expect(said(entryParts(arrived, NAMES))).toBe(
      `The application of [Ana Rivera] was dealt to ${SAM} as it arrived`,
    );
    expect(said(entryParts(arrived, NAMES, {}, IntakeMode.Csv, 'ana@ember.test'))).toBe(
      `The application was dealt to ${SAM} as it arrived`,
    );
  });

  it('words an organizer’s write that dealt what arrived by who made it', () => {
    const imported = { ...dealt([SAM, KAI]), action: 'import-applications' };

    expect(said(entryParts(imported, NAMES))).toBe(
      'dana@ember.test dealt 2 open applications among 2 reviewers',
    );
  });

  it('opens a change of reviewers to the lists before and after', () => {
    expect(entryChanges(reviewers(['a@x.test'], ['a@x.test', 'c@x.test'])).changed).toEqual([
      { field: 'Reviewers', before: 'a@x.test', after: 'a@x.test, c@x.test' },
    ]);
    expect(entryChanges(reviewers(['a@x.test'], [])).changed).toEqual([
      { field: 'Reviewers', before: 'a@x.test', after: 'none' },
    ]);
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
      kind: 'placed',
      vendors: ['ana@ember.test'],
      stored: { date: '2026-11-19', table_code: 'B7', before: { table_code: 'A3' } },
      trail: { date: '2026-11-19', tableCode: 'B7', before: { tableCode: 'A3' } },
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

  it('shows a phase before and after as the market’s path names it', () => {
    const move = entry({
      action: 'move-phase',
      kind: null,
      vendors: [],
      detail: { before: { phase: 'applications' }, after: { phase: 'assignment' } },
    });
    expect(entryChanges(move, {}, IntakeMode.Csv).changed).toEqual([
      { field: 'Phase', before: 'Review', after: 'Assignment' },
    ]);
    expect(entryChanges(move, {}, IntakeMode.Form).changed).toEqual([
      { field: 'Phase', before: 'Applications', after: 'Assignment' },
    ]);
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
