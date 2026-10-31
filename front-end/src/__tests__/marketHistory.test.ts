/**
 * The market's history, in words (E40/F01/S03): each entry a sentence the screen words from the
 * structured entry, which opens to show before and after.
 */
import { describe, expect, it } from 'vitest';
import { IntakeMode, type FormField, type RejectionQuestion } from '@/assets/types/datatypes';
import {
  dayEnds,
  dayStarts,
  entryChanges,
  addressParts,
  entryParts,
  fieldName,
  soleColumn,
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

  it("words a copy of the organization's defaults by the rows it changed", () => {
    expect(
      sentence(
        {
          action: 'change-the-table',
          kind: 'permission_table_copied',
          vendors: [],
          detail: {
            before: {
              'check-in': { role: 'editor', source: 'built-in' },
              'move-phase': { role: 'owner', source: 'market' },
            },
            after: {
              'check-in': { role: 'admin', source: 'organization' },
              'move-phase': { role: 'admin', source: 'built-in' },
            },
          },
        },
        { 'check-in': 'Check vendors in', 'move-phase': 'Move the phase' },
      ),
    ).toBe(
      "dana@ember.test copied the organization's defaults, changing Check vendors in and Move the phase",
    );
  });

  it('words an applicant’s own application as theirs', () => {
    expect(sentence({ actor: 'ana@ember.test', action: 'apply', kind: 'submitted' })).toBe(
      '[Ana Rivera] applied',
    );
  });

  it('words keeping an update over a changed answer as keeping it', () => {
    expect(
      sentence({ action: 'update-vendor-info', kind: 'kept', vendors: ['ben@ember.test'] }),
    ).toBe('dana@ember.test kept their update to the info of [Ben Okafor]');
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
    expect(entryChanges(many, {}, IntakeMode.Csv, [], 'ben@ember.test').changed).toEqual([
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

  /** A deal of a removed reviewer's follow-up beside an open application (E38/F07/S02). */
  function handedOn(): MarketHistoryEntry {
    return entry({
      action: 'choose-reviewers',
      kind: 'dealt',
      vendors: ['ana@ember.test', 'ben@ember.test'],
      subject: { application_ids: ['app-0', 'app-1'] },
      detail: {
        cause: 'reviewers_changed',
        before: { 'app-0': { reviewer: KAI }, 'app-1': { reviewer: KAI, follow_up_owner: KAI } },
        after: { 'app-0': { reviewer: SAM }, 'app-1': { reviewer: SAM, follow_up_owner: SAM } },
      },
    });
  }

  it('words a deal that handed on a follow-up by both counts', () => {
    expect(said(entryParts(handedOn(), NAMES))).toBe(
      'dana@ember.test dealt 1 open application and 1 follow-up among 1 reviewer',
    );
  });

  it('words a follow-up dealt on by who held it before, in the vendor’s own history too', () => {
    const one = {
      ...handedOn(),
      vendors: ['ben@ember.test'],
      subject: { application_ids: ['app-1'] },
    };

    expect(said(entryParts(one, NAMES))).toBe(
      `dana@ember.test dealt the follow-up of [Ben Okafor] from ${KAI} to ${SAM}`,
    );
    expect(said(entryParts(handedOn(), NAMES, {}, IntakeMode.Csv, 'ben@ember.test'))).toBe(
      `dana@ember.test dealt the follow-up from ${KAI} to ${SAM}`,
    );
    expect(entryChanges(handedOn(), {}, IntakeMode.Csv, [], 'ben@ember.test').changed).toEqual([
      { field: 'Reviewer', before: KAI, after: SAM },
      { field: 'Follow-up owner', before: KAI, after: SAM },
    ]);
  });

  it('opens a change of reviewers to the lists before and after, one address a line', () => {
    expect(entryChanges(reviewers(['a@x.test'], ['a@x.test', 'c@x.test'])).changed).toEqual([
      { field: 'Reviewers', before: 'a@x.test', after: 'a@x.test\nc@x.test' },
    ]);
    expect(entryChanges(reviewers(['a@x.test'], [])).changed).toEqual([
      { field: 'Reviewers', before: 'a@x.test', after: 'none' },
    ]);
  });
});

describe('an applicant’s answers, before and after', () => {
  const FIELDS = [
    { key: 'business_name', label: 'Business name', type: 'text', order: 0 },
  ] as unknown as FormField[];
  const applied = (action = 'apply', kind: string | null = 'submitted'): MarketHistoryEntry =>
    entry({
      action,
      kind,
      detail: {
        before: {},
        after: {
          business_name: 'Ember Ceramics',
          essential_available_dates: ['2099-08-01'],
          essential_tier_preference: { '2099-08-01': ['Gold', 'Silver'] },
          essential_table_choice: 'half',
          // The table-share question's three storage keys read as one answer, the partner's.
          essential_table_share_email: 'kai@example.com',
          essential_table_share_also: ['lee@example.com'],
          // Stored empty, so it differs from absent, but reads as nothing either way.
          essential_preferred_name: '',
        },
        rejected_by_rules: false,
      },
    });

  it('names each question as the form asks it, and reads each answer as a person would', () => {
    const { changed } = entryChanges(applied(), {}, IntakeMode.Form, [], '', FIELDS);

    // As the form asks them: the essential questions first, then the organizer's own.
    expect(changed.map((row) => row.field)).toEqual([
      'Available dates',
      'Tier preference',
      'Table choice',
      'Table-share partner',
      'Business name',
    ]);
    expect(changed.map((row) => row.after)).toEqual([
      'Saturday, August 1, 2099',
      'Saturday, August 1, 2099: Gold, Silver',
      expect.stringMatching(/half/i),
      'kai@example.com',
      'Ember Ceramics',
    ]);
    expect(changed.every((row) => row.before === 'none')).toBe(true);
  });

  it('puts the organizer’s own questions in the form’s order, and anything else after', () => {
    const fields = [
      { key: 'shop', label: 'Shop', type: 'text', order: 1 },
      { key: 'wares', label: 'What do you sell?', type: 'text', order: 0 },
    ] as unknown as FormField[];
    const answers = entry({
      action: 'apply',
      kind: 'submitted',
      detail: {
        before: {},
        after: { gone: 'x', shop: 'Ember', wares: 'Pots', essential_full_name: 'Ana Rivera' },
      },
    });

    expect(
      entryChanges(answers, {}, IntakeMode.Form, [], '', fields).changed.map((row) => row.field),
    ).toEqual(['Full name', 'What do you sell?', 'Shop', 'Gone']);
  });

  it('reads an organizer’s update of a vendor’s info the same way', () => {
    const { changed } = entryChanges(
      applied('update-vendor-info', null),
      {},
      IntakeMode.Form,
      [],
      '',
      FIELDS,
    );

    expect(changed.at(-1)).toEqual({
      field: 'Business name',
      before: 'none',
      after: 'Ember Ceramics',
    });
  });
});

describe('how a before and after is drawn', () => {
  it('drops the Before column when every Before is none, naming an applicant’s answers so', () => {
    const rows = (...befores: string[]) =>
      befores.map((before, i) => ({ field: `f${i}`, before, after: 'x' }));

    expect(soleColumn(entry({ action: 'apply', kind: 'submitted' }), rows('none', 'none'))).toBe(
      'Answer',
    );
    expect(soleColumn(entry({ action: 'add-vendor', kind: null }), rows('none'))).toBe('After');
    // An arrival's deal is recorded under the applicant's action, but a reviewer is no answer.
    expect(soleColumn(entry({ action: 'apply', kind: 'dealt' }), rows('none'))).toBe('After');
    expect(soleColumn(entry({ action: 'apply', kind: 'edited' }), rows('none', 'Gold'))).toBeNull();
    expect(soleColumn(entry({}), [])).toBeNull();
  });

  it('marks each address in a value, so it breaks, if at all, only before its @', () => {
    expect(addressParts('Dealt to rv-ana@example.com, and bo@x.test')).toEqual([
      { kind: 'text', text: 'Dealt to ' },
      { kind: 'address', local: 'rv-ana', domain: '@example.com' },
      { kind: 'text', text: ', and ' },
      { kind: 'address', local: 'bo', domain: '@x.test' },
    ]);
    expect(addressParts('none')).toEqual([{ kind: 'text', text: 'none' }]);
  });
});

describe('a field’s name', () => {
  it('spells a follow-up’s owner as the chips and a deal do', () => {
    expect(fieldName('follow_up_owner')).toBe('Follow-up owner');
    expect(fieldName('review_highlights')).toBe('Review highlights');
  });
});

describe('a verdict on an application dealt to a reviewer (E38/F07/S02)', () => {
  const SAM = 'sam@example.com';
  const verdict = (dealtTo?: string, action = 'give-verdicts'): MarketHistoryEntry =>
    entry({
      action,
      kind: 'verdict',
      subject: { application_id: 'a1' },
      detail: {
        before: { status: 'open' },
        after: { status: 'reviewer_approved' },
        ...(dealtTo ? { dealt_to: dealtTo } : {}),
      },
    });

  it('names whose share it was when someone else decided it', () => {
    expect(said(entryParts(verdict(SAM), NAMES))).toBe(
      `dana@ember.test set [Ana Rivera] to Approved, dealt to ${SAM}`,
    );
    expect(said(entryParts(verdict(SAM), NAMES, {}, IntakeMode.Csv, 'ana@ember.test'))).toBe(
      `dana@ember.test set [Ana Rivera] to Approved, dealt to ${SAM}`,
    );
  });

  it('adds nothing when the reviewer decided their own, or it was never dealt', () => {
    expect(said(entryParts(verdict('dana@ember.test'), NAMES))).toBe(
      'dana@ember.test set [Ana Rivera] to Approved',
    );
    expect(said(entryParts(verdict(), NAMES))).toBe('dana@ember.test set [Ana Rivera] to Approved');
  });

  it('names it on a change of verdict too', () => {
    expect(
      said(
        entryParts(
          {
            ...verdict(SAM, 'change-verdicts'),
            detail: {
              before: { status: 'reviewer_rejected' },
              after: { status: 'reviewer_approved' },
              dealt_to: SAM,
            },
          },
          NAMES,
        ),
      ),
    ).toBe(`dana@ember.test changed [Ana Rivera] from Rejected to Approved, dealt to ${SAM}`);
  });

  it('names it beside each vendor of a selection dealt to someone else', () => {
    const selection = entry({
      action: 'give-verdicts',
      kind: 'verdicts',
      vendors: ['ana@ember.test', 'ben@ember.test'],
      subject: { application_ids: ['a1', 'a2'] },
      detail: {
        before: { a1: { status: 'open' }, a2: { status: 'open' } },
        after: { a1: { status: 'reviewer_rejected' }, a2: { status: 'reviewer_rejected' } },
        dealt_to: { a1: SAM, a2: 'dana@ember.test' },
      },
    });

    expect(said(entryParts(selection, NAMES))).toBe(
      `dana@ember.test set 2 applications to Rejected: [Ana Rivera] (dealt to ${SAM}), [Ben Okafor]`,
    );
    expect(entryChanges(selection).recorded).toEqual([
      { field: 'Dealt to', value: `ana@ember.test: ${SAM}, ben@ember.test: dana@ember.test` },
    ]);
  });

  it('opens a verdict to whose share it was', () => {
    expect(entryChanges(verdict(SAM)).recorded).toEqual([{ field: 'Dealt to', value: SAM }]);
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

  it('shows an essential answer an organizer updated by its question, as the review card does', () => {
    expect(
      entryChanges(
        entry({
          action: 'update-vendor-info',
          kind: null,
          detail: {
            before: { essential_tier_preference: { '2099-08-01': ['Gold'] } },
            after: { essential_tier_preference: { '2099-08-01': ['Silver'] } },
            rejected_by_rules: false,
            returned_by_rules: false,
          },
        }),
      ).changed,
    ).toEqual([
      {
        field: 'Tier preference',
        before: 'Saturday, August 1, 2099: Gold',
        after: 'Saturday, August 1, 2099: Silver',
      },
    ]);
  });

  it('reads the table-share answer as one row in the vendor’s words, never its storage keys', () => {
    expect(
      entryChanges(
        entry({
          action: 'update-vendor-info',
          kind: null,
          detail: {
            before: {
              essential_table_share_email: 'ana@example.com',
              essential_table_share_also: ['bea@example.com'],
              essential_table_share_answer: 'Seat me with Ana',
            },
            after: {
              essential_table_share_email: 'bea@example.com',
              essential_table_share_also: [],
              essential_table_share_answer: 'Seat me with Bea',
            },
          },
        }),
      ).changed,
    ).toEqual([
      { field: 'Table-share partner', before: 'Seat me with Ana', after: 'Seat me with Bea' },
    ]);
  });

  it('reads a table-share answer kept only as the address under the same row', () => {
    expect(
      entryChanges(
        entry({
          action: 'update-vendor-info',
          kind: null,
          detail: {
            before: { essential_table_share_email: 'ana@example.com' },
            after: { essential_table_share_email: 'bea@example.com' },
          },
        }),
      ).changed,
    ).toEqual([
      { field: 'Table-share partner', before: 'ana@example.com', after: 'bea@example.com' },
    ]);
  });

  it('shows no table-share row that reads the same before and after', () => {
    expect(
      entryChanges(
        entry({
          action: 'update-vendor-info',
          kind: null,
          detail: {
            before: { essential_table_share_also: ['bea@example.com'] },
            after: { essential_table_share_also: [] },
          },
        }),
      ).changed,
    ).toEqual([]);
  });

  it('never names the table-share storage keys as rows', () => {
    expect(
      entryChanges(
        entry({
          action: 'update-vendor-info',
          kind: null,
          detail: {
            before: {
              essential_table_share_answer: 'Seat me with Ana',
              essential_table_share_also: ['bea@example.com'],
            },
            after: {
              essential_table_share_answer: 'Seat me with Bea',
              essential_table_share_also: [],
            },
          },
        }),
      ).changed,
    ).toEqual([
      { field: 'Table-share partner', before: 'Seat me with Ana', after: 'Seat me with Bea' },
    ]);
  });

  it('opens an update taken away because their answer matches it, under its question', () => {
    expect(
      entryChanges(
        entry({
          action: 'update-vendor-info',
          kind: null,
          detail: {
            matched: { business_name: 'Ember Ceramics' },
            rejected_by_rules: false,
            returned_by_rules: false,
          },
        }),
      ).recorded[0],
    ).toEqual({ field: 'Their answer now matches: Business name', value: 'Ember Ceramics' });
  });

  it('opens a kept update to each answer kept, under its question', () => {
    expect(
      entryChanges(
        entry({
          action: 'update-vendor-info',
          kind: 'kept',
          detail: {
            kept: {
              essential_table_share_email: 'ana@example.com',
              essential_table_share_also: [],
              essential_table_share_answer: 'Seat me with Ana, ana@example.com',
              business_name: 'Ember Ceramics',
            },
            rejected_by_rules: false,
            returned_by_rules: false,
          },
        }),
      ).recorded.slice(0, 2),
    ).toEqual([
      { field: 'Kept: Table-share partner', value: 'Seat me with Ana, ana@example.com' },
      { field: 'Kept: Business name', value: 'Ember Ceramics' },
    ]);
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

  it("opens a copy of the organization's defaults to each row it changed", () => {
    expect(
      entryChanges(
        entry({
          action: 'change-the-table',
          kind: 'permission_table_copied',
          vendors: [],
          detail: {
            before: { 'check-in': { role: 'editor', source: 'built-in' } },
            after: { 'check-in': { role: 'admin', source: 'organization' } },
          },
        }),
        { 'check-in': 'Check vendors in' },
      ).changed,
    ).toEqual([
      {
        field: 'Check vendors in',
        before: 'Editor, Built in',
        after: 'Admin, The organization’s default',
      },
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

describe('the Discord card and its check, in words (E46/F01/S02, S03)', () => {
  const discord = (kind: string, detail: Record<string, unknown>, extra = {}) =>
    entry({ action: 'connect-discord', kind, vendors: [], detail, ...extra });
  const SERVER = { guild_id: '2909267986263572999', guild_name: 'Market Vendors' };
  const NONE = { guild_id: null, guild_name: null };
  const FORM = [
    { key: 'discord_username', label: 'Discord Username', type: 'text' },
  ] as unknown as FormField[];

  it('words connecting and disconnecting by the server’s name, never its id', () => {
    expect(
      said(entryParts(discord('discord_connected', { before: NONE, after: SERVER }), NAMES)),
    ).toBe('dana@ember.test connected the market to the Discord server “Market Vendors”');
    expect(
      said(entryParts(discord('discord_disconnected', { before: SERVER, after: NONE }), NAMES)),
    ).toBe('dana@ember.test disconnected the market from the Discord server “Market Vendors”');
  });

  it('words a choice on the card by what it changed', () => {
    const detail = {
      before: { role_id: null, role_name: null, invite_link: null },
      after: { role_id: 'r-vendor', role_name: 'Vendor', invite_link: 'https://discord.gg/abc' },
    };
    expect(said(entryParts(discord('discord', detail), NAMES))).toBe(
      'dana@ember.test changed the Discord card: role and invite link',
    );
  });

  it('opens to the names and the question’s label, never an id or a key', () => {
    const detail = {
      before: { ...NONE, role_id: null, role_name: null, username_question: null },
      after: {
        ...SERVER,
        role_id: 'r-vendor',
        role_name: 'Vendor',
        username_question: 'discord_username',
        username_question_label: 'Discord Username',
      },
    };
    expect(entryChanges(discord('discord_connected', detail))).toEqual({
      changed: [
        { field: 'Server', before: 'none', after: 'Market Vendors' },
        { field: 'Role', before: 'none', after: 'Vendor' },
        { field: 'Username question', before: 'none', after: 'Discord Username' },
      ],
      recorded: [],
    });
  });

  it('names a question recorded without its label by the form, or says it left the form', () => {
    const detail = (key: string) => ({
      before: { username_question: null },
      after: { username_question: key },
    });
    const question = (key: string) =>
      entryChanges(discord('discord', detail(key)), {}, IntakeMode.Csv, [], '', FORM).changed;
    expect(question('discord_username')).toEqual([
      { field: 'Username question', before: 'none', after: 'Discord Username' },
    ]);
    expect(question('old_key')).toEqual([
      { field: 'Username question', before: 'none', after: '“old_key” (no longer on the form)' },
    ]);
  });

  const check = entry({
    action: 'connect-discord',
    kind: 'discord_checked',
    vendors: ['ana@ember.test', 'ben@ember.test'],
    subject: { application_ids: ['app-ana', 'app-ben'] },
    detail: {
      before: { 'app-ana': null, 'app-ben': 'in_server' },
      after: { 'app-ana': 'not_found', 'app-ben': 'has_role' },
      addresses: { 'app-ana': 'ana@ember.test', 'app-ben': 'ben@ember.test' },
      counts: { has_role: 1, in_server: 2, not_found: 1, no_username: 0 },
    },
  });

  it('words a check by how many it found in each state', () => {
    expect(said(entryParts(check, NAMES))).toBe(
      'dana@ember.test checked who is in the Discord server: 1 has the role, 2 in the server, 1 not found',
    );
  });

  it('words a check as the vendor’s own line in their own history', () => {
    expect(said(entryParts(check, NAMES, {}, IntakeMode.Csv, 'ben@ember.test'))).toBe(
      'dana@ember.test checked who is in the Discord server: Has the role',
    );
    expect(entryChanges(check, {}, IntakeMode.Csv, [], 'Ana@ember.test').changed).toEqual([
      { field: 'Discord', before: 'not checked', after: 'Not found' },
    ]);
  });

  it('reads each vendor’s address by id, so one with no address shifts no other', () => {
    const withoutAnAddress = entry({
      ...check,
      vendors: ['ben@ember.test'],
      detail: { ...check.detail, addresses: { 'app-ana': '', 'app-ben': 'ben@ember.test' } },
    });
    expect(
      entryChanges(withoutAnAddress, {}, IntakeMode.Csv, [], 'ben@ember.test').changed,
    ).toEqual([{ field: 'Discord', before: 'In the server', after: 'Has the role' }]);
    expect(entryChanges(withoutAnAddress).changed).toEqual([
      { field: 'A vendor with no address', before: 'not checked', after: 'Not found' },
      { field: 'ben@ember.test', before: 'In the server', after: 'Has the role' },
    ]);
  });

  it('opens a check to each vendor whose state changed, and the counts', () => {
    expect(entryChanges(check)).toEqual({
      changed: [
        { field: 'ana@ember.test', before: 'not checked', after: 'Not found' },
        { field: 'ben@ember.test', before: 'In the server', after: 'Has the role' },
      ],
      recorded: [
        { field: 'Has the role', value: '1' },
        { field: 'In the server', value: '2' },
        { field: 'Not found', value: '1' },
        { field: 'No username', value: '0' },
      ],
    });
  });
});
