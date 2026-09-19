/**
 * `essential_full_name` on the applicant's side, and its agreement with the back end.
 *
 * `front-end/src/utils/essentialFields.ts` mirrors `back-end/essential_fields.py`, and the mirror
 * is load-bearing: a key or a label that differs by a character is a form the applicant fills in
 * and the server then refuses. The literals below are the back end's, written out rather than
 * imported, which is the only way a mirror test can fail when the two drift.
 */
import { describe, expect, it } from 'vitest';
import {
  FULL_NAME_KEY,
  FULL_NAME_LABEL,
  UNASKABLE_ESSENTIAL_KEYS,
  applicationAnswerRows,
  essentialValidationErrors,
} from '@/utils/essentialFields';
import type { EssentialFormOptions } from '@/assets/types/datatypes';

const NO_PLAN: EssentialFormOptions = {
  dates: [],
  sections: [],
  tableTypes: [],
  tiers: [],
  unasked: [],
};

const A_PLAN: EssentialFormOptions = {
  dates: ['2026-08-01'],
  sections: ['Main Hall', 'Garden'],
  tableTypes: ['Standard'],
  tiers: ['Gold'],
  unasked: [],
};

describe('the mirror agrees with the back end', () => {
  it('uses the key the server stores the answer under', () => {
    expect(FULL_NAME_KEY).toBe('essential_full_name');
  });

  it('uses the label the server names the question by when it refuses a save', () => {
    expect(FULL_NAME_LABEL).toBe('Full name');
  });

  it('does not admit the name to the questions a market may declare unasked', () => {
    // `UNASKABLE_ESSENTIAL_KEYS` admits only rankings, and identity is not one.
    expect(UNASKABLE_ESSENTIAL_KEYS).not.toContain(FULL_NAME_KEY);
  });
});

describe('the applicant is asked for a name whatever the plan offers', () => {
  it('requires one on a market with no dates, no tiers and no sections', () => {
    const errors = essentialValidationErrors(NO_PLAN, {});

    expect(errors[FULL_NAME_KEY]).toBe("'Full name' is required.");
  });

  it('requires one on a market with a full plan too', () => {
    const errors = essentialValidationErrors(A_PLAN, {});

    expect(errors[FULL_NAME_KEY]).toBe("'Full name' is required.");
  });

  it('refuses whitespace, the way the server does', () => {
    expect(essentialValidationErrors(NO_PLAN, { [FULL_NAME_KEY]: '   ' })[FULL_NAME_KEY]).toBe(
      "'Full name' is required.",
    );
  });

  it('accepts a name, and says nothing else about a market that offers nothing', () => {
    const errors = essentialValidationErrors(NO_PLAN, { [FULL_NAME_KEY]: 'Ana Rivera' });

    expect(errors).toEqual({});
  });

  it('takes a whole name whole, however it is written', () => {
    for (const name of ['Jan van der Berg', 'Maria del Carmen Ruiz', 'Prince']) {
      expect(essentialValidationErrors(NO_PLAN, { [FULL_NAME_KEY]: name })).toEqual({});
    }
  });
});

describe('an answer reads back as a named question', () => {
  it('names the answer and puts it first, where the form asks it', () => {
    const { essential } = applicationAnswerRows({ [FULL_NAME_KEY]: 'Ana Rivera' }, []);

    expect(essential[0]).toMatchObject({
      key: FULL_NAME_KEY,
      label: FULL_NAME_LABEL,
      value: 'Ana Rivera',
      custom: false,
    });
  });
});
