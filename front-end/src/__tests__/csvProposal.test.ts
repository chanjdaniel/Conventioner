import { describe, expect, it } from 'vitest';
import {
  dateInYear,
  initialYear,
  ledgerRows,
  proposalCounts,
  weekdayNote,
  type Proposal,
  type ProposedColumn,
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
    expect(initialYear(proposal([], { dates, year: 2025 }).plan, new Date(2026, 8, 27))).toEqual({
      year: 2025,
      fits: true,
    });
  });

  it('opens on this year, with a warning, when no year fits', () => {
    expect(initialYear(proposal([], { dates, year: null }).plan, new Date(2026, 8, 27))).toEqual({
      year: 2026,
      fits: false,
    });
  });

  it('says which weekday it read the year from', () => {
    expect(weekdayNote(dates, 2025)).toBe('Monday, November 17 is a Monday in 2025');
    expect(weekdayNote([{ ...dates[0], weekday: null }], 2025)).toBe('');
  });

  it('makes a market date of a month and a day', () => {
    expect(dateInYear(dates[0], 2025)).toBe('2025-11-17');
  });
});
