// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';

import ValueFixes, { type ValueFix } from '@/components/ValueFixes.vue';
import { IGNORE_VALUE } from '@/utils/valueFixes';

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
  const offering = (count: number) => Array.from({ length: count }, (_, at) => `Answer ${at}`);
  const fixes = (props: Record<string, unknown>) =>
    mount(ValueFixes, {
      props: { resolutionFor: () => '', testid: 'import', ...props } as never,
      attachTo: document.body,
    });
  const entry = (name: string, offered: string[], target = 'selling'): ValueFix => ({
    target,
    value: name,
    rows: 1,
    offered,
  });

  it('draws a select with a name of its own, as every form field has', () => {
    const wrapper = mount(ValueFixes, {
      props: { entries: [value('Platinum')], resolutionFor: () => '', testid: 'import' },
    });
    expect(wrapper.get('[data-testid="import-fix-Platinum"]').attributes('name')).toBe(
      'import-fix-essential_tier_preference-Platinum',
    );
  });

  it('is named for the value, in a label the eye need not read', () => {
    const wrapper = fixes({ entries: [entry('Platinum', offering(12))] });
    expect(wrapper.get('label').text()).toBe('What Platinum means');
    expect(wrapper.get('label').classes()).toContain('visually-hidden');
    wrapper.unmount();
  });

  it('keeps its select for a question of 12 answers, "Ignore this value" first after "Choose…"', () => {
    const wrapper = fixes({ entries: [entry('Platinum', offering(12))] });
    const options = wrapper.findAll('select[data-testid="import-fix-Platinum"] option');
    expect(options.map((option) => option.text()).slice(0, 3)).toEqual([
      'Choose…',
      'Ignore this value',
      'Answer 0',
    ]);
    expect(options).toHaveLength(14);
    wrapper.unmount();
  });

  it('draws a field for a question of 13, with no option element', () => {
    const wrapper = fixes({ entries: [entry('Platinum', offering(13))] });
    expect(wrapper.find('select').exists()).toBe(false);
    expect(wrapper.findAll('option')).toHaveLength(0);
    expect(wrapper.get('[data-testid="import-fix-Platinum-input"]').attributes('placeholder')).toBe(
      'Choose…',
    );
    wrapper.unmount();
  });

  it('finds an answer by typing and writes it, with "Ignore this value" always in reach', async () => {
    const wrapper = fixes({ entries: [entry('Platinum', offering(129))] });
    const input = wrapper.get('[data-testid="import-fix-Platinum-input"]');
    await input.trigger('click');
    const rows = wrapper.findAll('[data-testid="import-fix-Platinum-option"]');
    expect(rows).toHaveLength(50);
    expect(rows[0]!.text()).toBe('Ignore this value');
    expect(rows[0]!.attributes('data-value')).toBe(IGNORE_VALUE);

    await input.setValue('Answer 128');
    await input.trigger('keydown', { key: 'Enter' });
    expect(wrapper.emitted('resolve')?.at(-1)).toEqual(['selling', 'Platinum', 'Answer 128']);
    wrapper.unmount();
  });

  it('writes nothing for words not chosen, and offers no row of their own', async () => {
    const wrapper = fixes({ entries: [entry('Platinum', offering(129))] });
    const input = wrapper.get('[data-testid="import-fix-Platinum-input"]');
    await input.setValue('Hand-poured soap');
    expect(wrapper.findAll('[data-testid="import-fix-Platinum-option"]')).toHaveLength(0);
    expect(wrapper.text()).not.toContain('Use "');

    await input.trigger('blur');
    expect((input.element as HTMLInputElement).value).toBe('');
    expect(wrapper.emitted('resolve')).toBeUndefined();
    wrapper.unmount();
  });

  it('names a choice made through its label, as a date reads', async () => {
    const wrapper = fixes({
      entries: [entry('Platinum', offering(13))],
      resolutionFor: () => 'Answer 3',
      labelFor: (_target: string, choice: string) => `Called ${choice}`,
    });
    const input = wrapper.get('[data-testid="import-fix-Platinum-input"]');
    expect((input.element as HTMLInputElement).value).toBe('Called Answer 3');
    wrapper.unmount();
  });

  it('builds one list of choices for the rows that share one, across renders', async () => {
    const labelFor = vi.fn((_target: string, choice: string) => choice);
    const offered = offering(129);
    const entries = Array.from({ length: 5 }, (_, at) => entry(`Value ${at}`, [...offered]));
    const wrapper = fixes({ entries, labelFor });
    expect(labelFor).toHaveBeenCalledTimes(129);

    await wrapper.setProps({ entries: entries.map((one) => ({ ...one })) });
    expect(labelFor).toHaveBeenCalledTimes(129);
    wrapper.unmount();
  });

  it('keeps apart two values of one target offered different answers', async () => {
    // A tier grid: its day headings are offered the dates, its cells the tiers (bug 26).
    const dates = ['2099-08-01', '2099-08-08'];
    const tiers = ['Gold', 'Silver'];
    const wrapper = fixes({
      entries: [
        entry('Second Saturday', dates, 'essential_tier_preference'),
        entry('Bronze', tiers, 'essential_tier_preference'),
      ],
    });
    const options = (name: string) =>
      wrapper
        .findAll(`select[data-testid="import-fix-${name}"] option`)
        .map((option) => option.attributes('value'));
    expect(options('Second Saturday')).toEqual(['', IGNORE_VALUE, ...dates]);
    expect(options('Bronze')).toEqual(['', IGNORE_VALUE, ...tiers]);
    wrapper.unmount();
  });

  it('draws every value that waits, and six of those decided until "Show all"', async () => {
    const entries = Array.from({ length: 9 }, (_, at) => entry(`Value ${at}`, offering(13)));
    const waiting = fixes({ entries });
    expect(waiting.findAll('[data-testid="import-unmatched-value"]')).toHaveLength(9);
    waiting.unmount();

    const decided = fixes({ entries, decided: true });
    expect(decided.findAll('[data-testid="import-unmatched-value"]')).toHaveLength(6);
    await decided.get('[data-testid="import-show-all"]').trigger('click');
    expect(decided.findAll('[data-testid="import-unmatched-value"]')).toHaveLength(9);
    decided.unmount();
  });
});
