/**
 * A chart per choice question (E45/F01/S02): the server's counts read as one ledger card per
 * question, narrowed to every applicant, the approved or the assigned.
 */
import { describe, expect, it } from 'vitest';
import { answerGroup, questionLedgers, type AnswerCounts } from '@/utils/answerCounts';

const COUNTS: AnswerCounts = {
  groups: { all: 5, approved: 3, assigned: 0 },
  questions: [
    {
      key: 'selling',
      label: 'What will you be selling at the event?',
      type: 'multi_select',
      answers: {
        all: [
          { kind: 'option', answer: 'Prints', count: 2 },
          { kind: 'option', answer: 'Stickers', count: 1 },
          { kind: 'other', count: 2 },
          { kind: 'none', count: 1 },
        ],
        approved: [
          { kind: 'option', answer: 'Prints', count: 1 },
          { kind: 'option', answer: 'Stickers', count: 0 },
          { kind: 'other', count: 2 },
        ],
        assigned: [
          { kind: 'option', answer: 'Prints', count: 0 },
          { kind: 'option', answer: 'Stickers', count: 0 },
        ],
      },
    },
  ],
};

describe('a chart per choice question', () => {
  it('reads each option, then "Other" and "No answer", as a row of the card', () => {
    const [selling] = questionLedgers(COUNTS, 'all');

    expect(selling.key).toBe('selling');
    expect(selling.title).toBe('What will you be selling at the event?');
    expect(selling.rows.map((row) => [row.label, row.value, row.count])).toEqual([
      ['Prints', 'option:Prints', 2],
      ['Stickers', 'option:Stickers', 1],
      ['Other', 'other', 2],
      ['No answer', 'none', 1],
    ]);
  });

  it('shares each count among the group it is narrowed to', () => {
    const [all] = questionLedgers(COUNTS, 'all');
    const [approved] = questionLedgers(COUNTS, 'approved');

    expect(all.rows.map((row) => row.share)).toEqual([40, 20, 40, 20]);
    expect(approved.rows.map((row) => [row.label, row.count, row.share])).toEqual([
      ['Prints', 1, 33],
      ['Stickers', 0, 0],
      ['Other', 2, 67],
    ]);
  });

  it('draws each bar against the largest in its card', () => {
    const [approved] = questionLedgers(COUNTS, 'approved');

    expect(approved.rows.map((row) => row.bar)).toEqual([50, 0, 100]);
  });

  it('leads nowhere, since the All view cannot filter by an answer', () => {
    const [selling] = questionLedgers(COUNTS, 'all');

    expect(selling.rows.every((row) => row.to === undefined)).toBe(true);
  });

  it('shares nothing in a group nobody is in', () => {
    const [assigned] = questionLedgers(COUNTS, 'assigned');

    expect(assigned.rows.map((row) => row.share)).toEqual([0, 0]);
  });

  it('reads the group from the address, every applicant for one it does not know', () => {
    expect(answerGroup('approved')).toBe('approved');
    expect(answerGroup('assigned')).toBe('assigned');
    expect(answerGroup(undefined)).toBe('all');
    expect(answerGroup('everyone')).toBe('all');
  });
});
