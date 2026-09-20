/**
 * A stored answer reads as an answer, not as the value it was stored in (E15/F02/S01).
 *
 * The triage card showed a checkbox answer as the raw boolean `true`. Every other answer on that
 * card is rendered for a human - dates are spelled out, tier preference is joined per date, table
 * choice reads "A whole table to myself" - so `true` was the one row that leaked its own storage.
 *
 * The fix is in `answerText`, which is the single renderer both surfaces share: the applicant's own
 * dashboard and the organizer's review card. Fixing it at a call site would have fixed one of them.
 *
 * The neighbouring cases are pinned here too, because each is a way for an answer to vanish or to
 * lie rather than to read wrongly, and they are one `if` apart from each other:
 *
 *   - `false` is an ANSWER - "no, I do not need power" - so it renders, and must not be dropped by
 *     a truthiness test on its way out.
 *   - `0` is an ANSWER, and would be dropped by the same test one character differently written.
 *   - An unanswered optional question is NOT information, and is still dropped.
 */
import { describe, expect, it } from 'vitest';
import { applicationAnswerRows } from '@/utils/essentialFields';

const POWER = {
  key: 'power_required',
  label: 'Do you need access to mains power at your table?',
  type: 'checkbox',
  required: false,
  options: [],
  order: 0,
};
const YEARS = { ...POWER, key: 'years_trading', label: 'Years trading', type: 'number', order: 1 };

function customRow(formData: Record<string, unknown>, fields = [POWER, YEARS]) {
  return applicationAnswerRows(formData, fields).custom;
}

describe('a yes/no answer reads as Yes or No', () => {
  it('renders a ticked checkbox as Yes', () => {
    expect(customRow({ power_required: true })).toEqual([
      { key: POWER.key, label: POWER.label, value: 'Yes', custom: true },
    ]);
  });

  it('renders an unticked checkbox as No rather than dropping it', () => {
    // `false` is an answer. Rendered as the string "false" it also survived a truthiness filter by
    // accident; rendered as "" it would vanish, which is a different question's answer.
    expect(customRow({ power_required: false })).toEqual([
      { key: POWER.key, label: POWER.label, value: 'No', custom: true },
    ]);
  });

  it('never shows the stored value itself', () => {
    const values = customRow({ power_required: true }).concat(customRow({ power_required: false }));
    for (const row of values) {
      expect(row.value).not.toMatch(/^(true|false)$/i);
    }
  });
});

describe('the answers next to it are not collateral', () => {
  it('keeps a numeric answer of zero', () => {
    expect(customRow({ years_trading: 0 })).toEqual([
      { key: YEARS.key, label: YEARS.label, value: '0', custom: true },
    ]);
  });

  it('still drops an unanswered optional question', () => {
    expect(customRow({ power_required: '', years_trading: null })).toEqual([]);
  });
});
