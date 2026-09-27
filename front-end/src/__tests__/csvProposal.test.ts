import { describe, expect, it } from 'vitest';
import {
  correct,
  dateInYear,
  draftFrom,
  draftRows,
  notAsked,
  setCeiling,
  settle,
  takenBy,
  toggleOption,
  weekdaysFit,
  initialYear,
  ledgerRows,
  proposalCounts,
  weekdayNote,
  type Proposal,
  type ProposedColumn,
  type ProposedField,
} from '@/utils/csvProposal';

function column(index: number, overrides: Partial<ProposedColumn> = {}): ProposedColumn {
  return {
    index,
    header: `Question ${index}`,
    group: null,
    answered: 10,
    firstAnswers: ['a', 'b'],
    fate: 'custom',
    essential: null,
    leftOut: null,
    why: 'A question of your own',
    check: [],
    field: {
      key: `question_${index}`,
      label: `Question ${index}`,
      helpText: null,
      type: 'text',
      required: false,
      options: [],
      unlistedOptions: 0,
      upload: false,
      optionsByType: {},
    },
    ...overrides,
  };
}

function proposal(columns: ProposedColumn[], plan: Partial<Proposal['plan']> = {}): Proposal {
  return {
    rowCount: 10,
    responses: 10,
    columns,
    plan: {
      dates: [],
      year: null,
      tiers: [],
      ceiling: null,
      disagreements: [],
      check: [],
      ...plan,
    },
    notAsked: [],
    typesafe: { asked: false },
  };
}

const TIERS = 'For each day, choose your tiers';

describe('ledgerRows', () => {
  it('keeps the file order, one row per column', () => {
    const rows = ledgerRows(proposal([column(0), column(1), column(2)]));
    expect(rows.map((r) => r.indexes)).toEqual([[0], [1], [2]]);
  });

  it('reads a grid as one row, naming its columns beneath its stem', () => {
    const grid = (index: number, day: string) =>
      column(index, {
        header: `${TIERS} [${day}]`,
        group: TIERS,
        fate: 'essential',
        essential: 'essential_tier_preference',
        answered: 8 + index,
      });
    const rows = ledgerRows(
      proposal([column(0), grid(1, 'Monday, March 23'), grid(2, 'Tuesday, March 24'), column(3)]),
    );
    expect(rows.map((r) => r.indexes)).toEqual([[0], [1, 2], [3]]);
    expect(rows[1].header).toBe(TIERS);
    expect(rows[1].members).toEqual(['Monday, March 23', 'Tuesday, March 24']);
    expect(rows[1].answered).toBe(10);
  });

  it('carries every check reason its columns were marked with, once', () => {
    const rows = ledgerRows(
      proposal([
        column(0, { group: 'G', header: 'G [a]', check: ['Read as a column your team added'] }),
        column(1, { group: 'G', header: 'G [b]', check: ['Read as a column your team added'] }),
      ]),
    );
    expect(rows[0].check).toEqual(['Read as a column your team added']);
  });
});

describe('proposalCounts', () => {
  it('counts the rows to check and what each column becomes', () => {
    const counts = proposalCounts(
      proposal(
        [
          column(0, { fate: 'submitted_at', field: null }),
          column(1, { fate: 'essential', essential: 'essential_full_name' }),
          column(2, { check: ['Could allow several answers'] }),
          column(3, { fate: 'left_out', leftOut: 'organizer', check: ['Read as a column'] }),
        ],
        { check: ["Couldn't reach TypeSafe"] },
      ),
    );
    expect(counts).toEqual({ toCheck: 3, essential: 1, custom: 1, leftOut: 1 });
  });
});

describe('the year', () => {
  const dates = [
    { text: 'Monday, November 17', month: 11, day: 17, weekday: 0, from: 'header', matches: null },
  ];

  it('opens on the year the weekdays fit', () => {
    expect(initialYear(proposal([], { dates, year: 2025 }).plan, new Date(2026, 8, 27))).toBe(2025);
  });

  it('opens on this year when no year fits', () => {
    expect(initialYear(proposal([], { dates, year: null }).plan, new Date(2026, 8, 27))).toBe(2026);
  });

  it('says which weekday it read the year from', () => {
    expect(weekdayNote(dates, 2025)).toBe('Monday, November 17 is a Monday in 2025');
    expect(weekdayNote(dates, 2026)).toBe('Monday, November 17 is a Tuesday in 2026, not a Monday');
    expect(weekdayNote([{ ...dates[0], weekday: null }], 2025)).toBe('');
  });

  it('makes a market date of a month and a day', () => {
    expect(dateInYear(dates[0], 2025)).toBe('2025-11-17');
  });
});

describe('the working copy', () => {
  function choiceColumn(index: number, overrides: Partial<ProposedColumn> = {}): ProposedColumn {
    const one = [
      { value: 'Pottery', count: 9, rare: false, keep: true },
      { value: 'Pottery, Zines', count: 3, rare: false, keep: true },
      { value: 'Zines', count: 6, rare: false, keep: true },
      { value: 'VASA', count: 1, rare: true, keep: false },
    ];
    const several = [
      { value: 'Pottery', count: 12, rare: false, keep: true },
      { value: 'Zines', count: 9, rare: false, keep: true },
      { value: 'VASA', count: 1, rare: true, keep: false },
    ];
    const base = column(index, { check: ['Could allow several answers'], ...overrides });
    return {
      ...base,
      field: {
        ...(base.field as ProposedField),
        type: 'select',
        options: one,
        optionsByType: {
          select: { options: one, unlisted: 0 },
          multi_select: { options: several, unlisted: 0 },
        },
      },
    };
  }

  it('starts as the proposal', () => {
    const p = proposal([choiceColumn(0)]);
    const rows = draftRows(p, draftFrom(p));
    expect(rows[0].fate).toBe('custom');
    expect(rows[0].field?.options.filter((o) => o.keep).map((o) => o.value)).toEqual([
      'Pottery',
      'Pottery, Zines',
      'Zines',
    ]);
    expect(rows[0].check).toEqual(['Could allow several answers']);
  });

  it('keeps a rare option the organizer ticks', () => {
    const p = proposal([choiceColumn(0)]);
    const draft = draftFrom(p);
    toggleOption(draft, 0, 'VASA');
    expect(draftRows(p, draft)[0].field?.options.find((o) => o.value === 'VASA')?.keep).toBe(true);
  });

  it('turns one choice into several with the options inside the answers', () => {
    const p = proposal([choiceColumn(0)]);
    const draft = draftFrom(p);
    correct(draft, 0, { type: 'multi_select' });
    const row = draftRows(p, draft)[0];
    expect(row.field?.type).toBe('multi_select');
    expect(row.field?.options.filter((o) => o.keep).map((o) => o.value)).toEqual([
      'Pottery',
      'Zines',
    ]);
  });

  it('unticks an option kept by default after one choice is turned into several', () => {
    const p = proposal([choiceColumn(0)]);
    const draft = draftFrom(p);
    correct(draft, 0, { type: 'multi_select' });
    toggleOption(draft, 0, 'Zines');
    const kept = draftRows(p, draft)[0]
      .field?.options.filter((o) => o.keep)
      .map((o) => o.value);
    expect(kept).toEqual(['Pottery']);
    // And back: one choice keeps what it kept.
    correct(draft, 0, { type: 'select' });
    expect(
      draftRows(p, draft)[0]
        .field?.options.filter((o) => o.keep)
        .map((o) => o.value),
    ).toEqual(['Pottery', 'Pottery, Zines', 'Zines']);
  });

  it('lists as not asked every essential question no column answers now', () => {
    const p = proposal([column(0, { fate: 'essential', essential: 'essential_full_name' })]);
    const draft = draftFrom(p);
    expect(notAsked(p, draft).map((q) => q.key)).not.toContain('essential_full_name');
    correct(draft, 0, { fate: 'left_out' });
    expect(notAsked(p, draft).map((q) => q.key)).toContain('essential_full_name');
  });

  it("clears the ceiling's check once the organizer states it", () => {
    const p = proposal([], { check: ["Couldn't reach TypeSafe"] });
    const draft = draftFrom(p);
    expect(proposalCounts(p, draft).toCheck).toBe(1);
    setCeiling(draft, 2);
    expect(proposalCounts(p, draft).toCheck).toBe(0);
    expect(draft.ceiling.days).toBe(2);
  });

  it('loses its check mark once corrected, and the counts follow', () => {
    const p = proposal([choiceColumn(0), column(1)]);
    const draft = draftFrom(p);
    expect(proposalCounts(p, draft).toCheck).toBe(1);
    correct(draft, 0, { required: true });
    expect(draftRows(p, draft)[0].check).toEqual([]);
    expect(proposalCounts(p, draft).toCheck).toBe(0);
  });

  it('brings a left-out column back as a question', () => {
    const p = proposal([column(0, { fate: 'left_out', leftOut: 'organizer' })]);
    const draft = draftFrom(p);
    correct(draft, 0, { fate: 'custom' });
    expect(proposalCounts(p, draft)).toMatchObject({ custom: 1, leftOut: 0 });
  });

  it('lets one column answer an essential question, or say who applied, and no second', () => {
    const p = proposal([
      column(0, { fate: 'essential', essential: 'essential_full_name' }),
      column(1),
      column(2, { fate: 'applicant_email' }),
    ]);
    const draft = draftFrom(p);
    expect(takenBy(draft, 'essential:essential_full_name', 1)).toBe(0);
    expect(takenBy(draft, 'essential:essential_full_name', 0)).toBeNull();
    expect(takenBy(draft, 'applicant_email', 1)).toBe(2);
    expect(takenBy(draft, 'essential:essential_preferred_name', 1)).toBeNull();
  });

  it('settles a disagreement with the plan, which stops it counting', () => {
    const p = proposal([], {
      tiers: [{ name: 'Bronze', matches: null }],
      disagreements: [{ kind: 'tier', value: 'Bronze' }],
    });
    const draft = draftFrom(p);
    expect(proposalCounts(p, draft).toCheck).toBe(1);
    settle(draft, 'tier', 'Bronze', 'Silver');
    expect(proposalCounts(p, draft).toCheck).toBe(0);
    expect(draft.settled).toEqual({ tier: { Bronze: 'Silver' } });
  });
});

describe('whether the weekdays fit a year', () => {
  const monday17 = { text: 'Monday, November 17', month: 11, day: 17, weekday: 0 };
  it('says yes, no, or that nothing states a weekday', () => {
    expect(weekdaysFit([monday17], 2025)).toBe(true);
    expect(weekdaysFit([monday17], 2026)).toBe(false);
    expect(weekdaysFit([{ ...monday17, weekday: null }], 2025)).toBeNull();
  });
});
