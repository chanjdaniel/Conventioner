/**
 * Choose reviewers at 150 people (T204): one person found by typing their address, the chosen as
 * chips above the field, whoever is reviewing kept chosen even when the reader is not offered them.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import ReviewerPicker from '@/components/market/ReviewerPicker.vue';
import { PICKER_HINT } from '@/utils/reviewTeam';

const signedIn = vi.hoisted(() => ({ email: 'me@example.com' as string | null }));
vi.mock('@/utils/signedIn', () => ({ signedInEmail: () => signedIn.email }));

const person = (n: number) => `person-${String(n).padStart(3, '0')}@people-at-scale.test`;
const HUNDRED_AND_FIFTY = Array.from({ length: 150 }, (_, at) => person(at + 1));

function picker(
  props: {
    candidates?: string[];
    current?: string[];
    unable?: string[];
    chosen?: string[];
    disabled?: boolean;
  } = {},
) {
  const { candidates = HUNDRED_AND_FIFTY, current = [], unable, chosen = [], disabled } = props;
  const wrapper = mount(ReviewerPicker, {
    props: {
      candidates,
      current,
      unable,
      disabled,
      modelValue: chosen,
      'onUpdate:modelValue': (value: string[]) => wrapper.setProps({ modelValue: value }),
    },
    attachTo: document.body,
  });
  return wrapper;
}
type Picker = ReturnType<typeof picker>;

const field = (wrapper: Picker) => wrapper.get('[data-testid="reviewer-picker-input"]');
const chips = (wrapper: Picker) =>
  wrapper.findAll('[data-testid="reviewer-picker-chip"] > span:first-child').map((c) => c.text());
const rows = (wrapper: Picker) =>
  wrapper.findAll('[data-testid="reviewer-picker-option"]').map((r) => r.attributes('data-value'));
const rowDetail = (wrapper: Picker) =>
  wrapper.get('[data-testid="reviewer-picker-option"] .search-picker-option-detail').text();
const lastValue = (wrapper: Picker) => wrapper.props('modelValue');

async function find(wrapper: Picker, words: string) {
  await field(wrapper).setValue(words);
  await field(wrapper).trigger('keydown', { key: 'Enter' });
}

beforeEach(() => {
  signedIn.email = 'me@example.com';
});

describe('the reviewer picker', () => {
  it('is named Reviewers, its field described by the hint', () => {
    const wrapper = picker();
    const input = field(wrapper);

    expect(wrapper.get(`label[for="${input.attributes('id')}"]`).text()).toBe('Reviewers');
    const hint = wrapper.get(`[id="${input.attributes('aria-describedby')}"]`);
    expect(hint.text()).toBe(PICKER_HINT);
    wrapper.unmount();
  });

  it('chooses 3 of 150 by typing and removes one by its chip', async () => {
    const wrapper = picker();
    expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(0);

    await find(wrapper, 'person-120');
    await find(wrapper, 'person-007');
    await find(wrapper, 'person-149');
    expect(chips(wrapper)).toEqual([person(120), person(7), person(149)]);

    const remove = wrapper
      .findAll('[data-testid="reviewer-picker-chip-remove"]')
      .find((button) => button.text() === `Remove ${person(7)}`)!;
    await remove.trigger('click');

    expect(chips(wrapper)).toEqual([person(120), person(149)]);
    expect(lastValue(wrapper)).toEqual([person(120), person(149)]);
    wrapper.unmount();
  });

  it('draws the first 50 and says how many more, the chosen first', async () => {
    const wrapper = picker({ chosen: [person(120)] });
    await field(wrapper).trigger('click');

    expect(rows(wrapper)).toHaveLength(50);
    expect(rows(wrapper).slice(0, 2)).toEqual([person(120), person(1)]);
    expect(wrapper.get('[data-testid="reviewer-picker-more"]').text()).toBe(
      '100 more, type to narrow',
    );
    wrapper.unmount();
  });

  it('removes the last chip by Backspace in the empty field', async () => {
    const wrapper = picker({ chosen: [person(1), person(2)] });
    await field(wrapper).trigger('keydown', { key: 'Backspace' });

    expect(chips(wrapper)).toEqual([person(1)]);
    wrapper.unmount();
  });

  it('keeps a current reviewer the reader is not offered, chosen and offered', async () => {
    const gone = 'gone@example.com';
    const wrapper = picker({ candidates: [person(1)], current: [gone], chosen: [gone] });

    expect(chips(wrapper)).toEqual([gone]);
    await field(wrapper).trigger('click');
    expect(rows(wrapper)).toEqual([gone, person(1)]);
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    wrapper.unmount();
  });

  it('compares addresses case-folded, so a person never stands twice', async () => {
    const wrapper = picker({
      candidates: ['ana@example.com'],
      current: ['ANA@example.com'],
      chosen: ['ANA@example.com'],
    });

    expect(chips(wrapper)).toEqual(['ana@example.com']);
    await field(wrapper).trigger('click');
    expect(rows(wrapper)).toEqual(['ana@example.com']);
    await wrapper.get('[data-testid="reviewer-picker-option"]').trigger('click');

    expect(lastValue(wrapper)).toEqual([]);
    wrapper.unmount();
  });

  it("marks the reader's own address: You in the list, (you) on the chip, whatever its capitals", async () => {
    const wrapper = picker({
      candidates: ['ME@example.com', person(1)],
      chosen: ['ME@example.com'],
    });

    expect(chips(wrapper)).toEqual(['ME@example.com (you)']);
    await field(wrapper).trigger('click');
    const row = wrapper.get('[data-value="ME@example.com"]');
    expect(row.get('.search-picker-option-detail').text()).toBe('You');
    expect(wrapper.findAll('.search-picker-option-detail')).toHaveLength(1);
    wrapper.unmount();
  });

  it('marks who can no longer review here on their chip and row, whatever the capitals', async () => {
    const able = person(1);
    const gone = person(2);
    const wrapper = picker({
      candidates: [able],
      current: [gone],
      unable: [gone.toUpperCase()],
      chosen: [able, gone],
    });

    expect(chips(wrapper)).toEqual([able, `${gone} (can no longer review here)`]);
    await field(wrapper).trigger('focus');
    await field(wrapper).setValue(gone);
    expect(rowDetail(wrapper)).toBe('Can no longer review here');
    wrapper.unmount();
  });

  it('marks the reader themselves as both', async () => {
    const wrapper = picker({
      candidates: [],
      current: ['me@example.com'],
      unable: ['me@example.com'],
      chosen: ['me@example.com'],
    });

    expect(chips(wrapper)).toEqual(['me@example.com (you, can no longer review here)']);
    await field(wrapper).setValue('me@');
    expect(rowDetail(wrapper)).toBe('You, can no longer review here');
    wrapper.unmount();
  });

  it('marks no one when it is told of no one', () => {
    const wrapper = picker({ chosen: [person(1)] });

    expect(chips(wrapper)).toEqual([person(1)]);
    wrapper.unmount();
  });

  it('takes nothing while disabled', async () => {
    const wrapper = picker({ chosen: [person(1)], disabled: true });

    expect((field(wrapper).element as HTMLInputElement).disabled).toBe(true);
    const remove = wrapper.get('[data-testid="reviewer-picker-chip-remove"]');
    expect((remove.element as HTMLButtonElement).disabled).toBe(true);
    wrapper.unmount();
  });
});
