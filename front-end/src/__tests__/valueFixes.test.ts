// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';

import ValueFixes, { type ValueFix } from '@/components/ValueFixes.vue';

/**
 * Whose decisions the import lists (E30/F02/S01): a market started from its Google Form arrives
 * with the start's, and the list called them "already decided" as though the organizer had.
 */
function titleOf(entries: ValueFix[]): string {
  const wrapper = mount(ValueFixes, {
    props: { entries, resolutionFor: () => '', decided: true, testid: 'import-decided' },
  });
  return wrapper.get('[data-testid="import-decided-title"]').text();
}

const value = (name: string, decidedBy?: string): ValueFix => ({
  target: 'essential_tier_preference',
  value: name,
  rows: 1,
  offered: ['Gold'],
  decidedBy,
});
const START = 'set aside when your form was started';

describe('the decided values', () => {
  it("name the start once, when every one is the start's", () => {
    expect(titleOf([value('Platinum', START), value('Bronze', START)])).toBe(
      '2 values set aside when your form was started - change any that are wrong',
    );
  });

  it("say how many are the start's, once the organizer has changed some", () => {
    expect(titleOf([value('Platinum', START), value('Bronze')])).toBe(
      '2 values already decided, 1 when your form was started - change any that are wrong',
    );
  });

  it("say only that they are decided, when none is the start's", () => {
    expect(titleOf([value('Platinum')])).toBe(
      '1 value already decided - change any that are wrong',
    );
  });
});

describe('a value to fix', () => {
  it('draws a select with a name of its own, as every form field has', () => {
    const wrapper = mount(ValueFixes, {
      props: { entries: [value('Platinum')], resolutionFor: () => '', testid: 'import' },
    });
    expect(wrapper.get('[data-testid="import-fix-Platinum"]').attributes('name')).toBe(
      'import-fix-essential_tier_preference-Platinum',
    );
  });
});
