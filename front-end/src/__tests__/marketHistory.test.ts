/**
 * The market's history, in words (E40/F01/S03): each entry a sentence the screen words from the
 * structured entry, which opens to show before and after.
 */
import { describe, expect, it } from 'vitest';
import { IntakeMode, type RejectionQuestion } from '@/assets/types/datatypes';
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

  it('words a change of the prices by what on the Pricing card changed (E43/F01/S02)', () => {
    expect(
      sentence({
        action: 'change-setup',
        kind: 'pricing',
        vendors: [],
        detail: {
          before: { groups: [], everyone_else: [] },
          after: {
            groups: [{ name: 'Example College student only', conditions: [], prices: [] }],
            everyone_else: [{ tier: 'Gold', cents: 3500 }],
          },
        },
      }),
    ).toBe('dana@ember.test changed the prices: price groups and "Everyone else"');
  });

  it("lists the prices' fields in the card's order, whatever order they are stored in", () => {
    expect(
      sentence({
        action: 'change-setup',
        kind: 'pricing',
        vendors: [],
        detail: {
          before: { currency: 'CAD', half_table_percent: 50, groups: [], everyone_else: [] },
          after: { currency: 'USD', half_table_percent: 40, groups: [{}], everyone_else: [{}] },
        },
      }),
    ).toBe(
      'dana@ember.test changed the prices: price groups, "Everyone else", half table\'s share and currency',
    );
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

describe("a change of the prices opens to the card's words and money (E43/F01/S02)", () => {
  /** The market's choice questions, as the market read serves them for a condition. */
  const QUESTIONS: RejectionQuestion[] = [
    {
      key: 'affiliation',
      label: 'Are you an Example College student or alumni?',
      answers: ['Current Example College student', 'Example College alumni/staff'].map((a) => ({
        value: a,
        label: a,
      })),
    },
    {
      key: 'agree_terms',
      label: 'I agree to the terms',
      answers: [
        { value: 'ticked', label: 'Ticked' },
        { value: 'not ticked', label: 'Not ticked' },
      ],
    },
    {
      key: 'essential_table_choice',
      label: 'Table choice',
      answers: [
        { value: 'full', label: 'A full table' },
        { value: 'half', label: 'Half a table, shared' },
        { value: 'either', label: 'Either is fine' },
      ],
    },
    {
      key: 'essential_available_dates',
      label: 'Available dates',
      answers: [{ value: '2099-05-07', label: 'Thursday, May 7, 2099' }],
    },
  ];

  const priced = (detail: Record<string, unknown>, currency = 'CAD') =>
    entryChanges(
      entry({
        action: 'change-setup',
        kind: 'pricing',
        vendors: [],
        subject: { currency },
        detail,
      }),
      {},
      IntakeMode.Csv,
      QUESTIONS,
    ).changed;

  const group = (name: string, conditions: unknown[], gold = 1500) => ({
    name,
    conditions,
    prices: [{ tier: 'Gold', cents: gold }],
  });

  /** One group, before and after, opened to its one row. */
  const groupRow = (before: unknown, after: unknown) =>
    priced({ before: { groups: [before] }, after: { groups: [after] } });

  it('names each field as the card does and writes its prices in the currency', () => {
    expect(
      priced({
        before: { everyone_else: [{ tier: 'Gold', cents: 3500 }], half_table_percent: 50 },
        after: {
          everyone_else: [
            { tier: 'Gold', cents: 3600 },
            { tier: 'Silver', cents: 3000 },
          ],
          half_table_percent: 40,
        },
      }),
    ).toEqual([
      { field: '"Everyone else"', before: 'Gold $35', after: 'Gold $36, Silver $30' },
      { field: "Half table's share", before: '50%', after: '40%' },
    ]);
  });

  it('writes the money in the currency the entry names, and a new currency in its own', () => {
    expect(
      priced(
        {
          before: { currency: 'USD', everyone_else: [{ tier: 'Gold', cents: 3500 }] },
          after: { currency: 'EUR', everyone_else: [{ tier: 'Gold', cents: 3500 }] },
        },
        'EUR',
      ),
    ).toEqual([
      { field: '"Everyone else"', before: 'Gold US$35', after: 'Gold €35' },
      { field: 'Currency', before: 'USD', after: 'EUR' },
    ]);
  });

  it('opens only to the groups that changed, each its own row, an added and a removed one as such', () => {
    const kept = group('Example College student only', [
      { key: 'affiliation', answers: ['Current Example College student'] },
    ]);
    expect(
      priced({
        before: {
          groups: [kept, group('Alumni', [], 2500), group('Students, first year', [], 1000)],
        },
        after: {
          groups: [kept, group('Alumni', [], 2200), group('Volunteers', [], 500)],
        },
      }),
    ).toEqual([
      {
        field: 'Group “Alumni”',
        before: 'Gold $25\nno condition yet, so it prices nobody',
        after: 'Gold $22\nno condition yet, so it prices nobody',
        hanging: true,
      },
      {
        field: 'Group “Volunteers”',
        before: 'not on the card',
        after: 'Gold $5\nno condition yet, so it prices nobody',
        hanging: true,
      },
      {
        field: 'Group “Students, first year”',
        before: 'Gold $10\nno condition yet, so it prices nobody',
        after: 'removed',
        hanging: true,
      },
    ]);
  });

  it('says so when the groups only moved', () => {
    const [a, b] = [group('A', []), group('B', [])];

    expect(priced({ before: { groups: [a, b] }, after: { groups: [b, a] } })).toEqual([
      { field: 'Order of the groups', before: 'A\nB', after: 'B\nA' },
    ]);
  });

  it('keeps a move beside a change made in the same write', () => {
    // The card's order decides which group a price names when two price a vendor alike.
    const [a, b] = [group('A', [], 1000), group('B', [], 1000)];

    expect(
      priced({ before: { groups: [a, b] }, after: { groups: [group('B', [], 900), a] } }),
    ).toEqual([
      {
        field: 'Group “B”',
        before: 'Gold $10\nno condition yet, so it prices nobody',
        after: 'Gold $9\nno condition yet, so it prices nobody',
        hanging: true,
      },
      { field: 'Order of the groups', before: 'A\nB', after: 'B\nA' },
    ]);
  });

  it('adds no order row where a group was only taken away or added last', () => {
    const [a, b, c] = [group('A', []), group('B', []), group('C', [])];
    const fields = (before: unknown[], after: unknown[]) =>
      priced({ before: { groups: before }, after: { groups: after } }).map((row) => row.field);

    expect(fields([a, b], [b])).toEqual(['Group “A”']);
    expect(fields([a, b], [a, b, c])).toEqual(['Group “C”']);
  });

  it('reads a group renamed in place as no move, wherever it stands', () => {
    const [a, b, c] = [group('A', []), group('B', []), group('C', [])];
    const fields = (before: unknown[], after: unknown[]) =>
      priced({ before: { groups: before }, after: { groups: after } }).map((row) => row.field);

    // B renamed X in the middle: removed and added, but standing where B stood.
    expect(fields([a, b, c], [a, group('X', []), c])).toEqual(['Group “X”', 'Group “B”']);
    // A taken away and X added last: no move either.
    expect(fields([a, b, c], [b, c, group('X', [])])).toEqual(['Group “X”', 'Group “A”']);
  });

  it('still says where a renamed group went when it moved too', () => {
    const [a, b, c] = [group('A', []), group('B', []), group('C', [])];

    expect(
      priced({ before: { groups: [a, b, c] }, after: { groups: [group('X', []), a, c] } }).at(-1),
    ).toEqual({ field: 'Order of the groups', before: 'A\nB\nC', after: 'X\nA\nC' });
  });

  it('says where a group added between others went', () => {
    // Its place decides which group a price names when two price a vendor alike, as a move's does.
    const [a, b, c] = [group('A', []), group('B', []), group('C', [])];

    expect(
      priced({ before: { groups: [a, b] }, after: { groups: [a, c, b] } }).map(
        ({ field, before, after }) => [field, before, after],
      ),
    ).toEqual([
      ['Group “C”', 'not on the card', 'Gold $15\nno condition yet, so it prices nobody'],
      ['Order of the groups', 'A\nB', 'A\nC\nB'],
    ]);
  });

  it("writes a condition on the organizer's own question by its label and answers", () => {
    const [row] = groupRow(
      group('Students', [{ key: 'affiliation', answers: ['Example College alumni/staff'] }]),
      group('Students', [
        {
          key: 'affiliation',
          answers: ['Current Example College student', 'Example College alumni/staff'],
        },
      ]),
    );

    expect(row.after).toBe(
      'Gold $15\nwhen “Are you an Example College student or alumni?” includes “Current Example College student” or “Example College alumni/staff”',
    );
  });

  it('writes a checkbox, Table choice and Available dates as the card offers them', () => {
    const [row] = groupRow(
      group('Shared tables', []),
      group('Shared tables', [
        { key: 'agree_terms', answers: ['ticked'] },
        { key: 'essential_table_choice', answers: ['half', 'either'] },
        { key: 'essential_available_dates', answers: ['2099-05-07'] },
      ]),
    );

    expect(row.after).toBe(
      'Gold $15\n' +
        'when “I agree to the terms” includes “Ticked”\n' +
        'and “Table choice” includes “Half a table, shared” or “Either is fine”\n' +
        'and “Available dates” includes “Thursday, May 7, 2099”',
    );
  });

  it('falls back to the stored key and value only for what the form no longer has', () => {
    const [row] = groupRow(
      group('First years', []),
      group('First years', [
        { key: 'year_of_study', answers: ['First'] },
        { key: 'affiliation', answers: ['Current Example College student', 'Faculty'] },
      ]),
    );

    expect(row.after).toBe(
      'Gold $15\n' +
        'when “year_of_study” (no longer on the form) includes “First”\n' +
        'and “Are you an Example College student or alumni?” includes “Current Example College student” or “Faculty”',
    );
  });

  it('says a condition with nothing ticked prices nobody, as the card does', () => {
    const [row] = groupRow(
      group('Students', []),
      group('Students', [{ key: 'affiliation', answers: [] }]),
    );

    expect(row.after).toBe(
      'Gold $15\nwhen “Are you an Example College student or alumni?” has no answer ticked yet, so it prices nobody',
    );
  });

  it('says none for a field an older entry recorded as null', () => {
    expect(priced({ before: { everyone_else: null }, after: { everyone_else: [] } })).toEqual([
      { field: '"Everyone else"', before: 'none', after: 'none' },
    ]);
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
