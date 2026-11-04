// @vitest-environment happy-dom
/**
 * One choice from a set that can grow (T223): a native select at 12 choices or fewer, a capped
 * `SearchPicker` past that, the same to its screen either way.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import ChoiceField, { COMBOBOX_PAST } from '@/components/ChoiceField.vue';
import { LIST_FIND_FROM } from '@/components/ListFrame.vue';
import type { PickerGroup } from '@/components/SearchPicker.vue';

const choices = (count: number): PickerGroup[] => [
  {
    options: Array.from({ length: count }, (_, at) => ({
      value: `v${at}`,
      label: `Answer ${at}`,
    })),
  },
];

function field(props: Record<string, unknown> = {}) {
  const wrapper = mount(ChoiceField, {
    props: {
      modelValue: '',
      groups: choices(12),
      label: 'What it means',
      testid: 'fix',
      'onUpdate:modelValue': (value: string) => wrapper.setProps({ modelValue: value }),
      ...props,
    },
    attachTo: document.body,
  });
  return wrapper;
}
type Field = ReturnType<typeof field>;
const select = (wrapper: Field) => wrapper.find('select[data-testid="fix"]');
const picker = (wrapper: Field) => wrapper.find('.search-picker[data-testid="fix"]');
const input = (wrapper: Field) => wrapper.get('[data-testid="fix-input"]');

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('the threshold', () => {
  it("is the list frame's own number, so the app has one", () => {
    expect(COMBOBOX_PAST).toBe(LIST_FIND_FROM);
    expect(COMBOBOX_PAST).toBe(12);
  });

  it('is a select at 12 choices', () => {
    const wrapper = field({ groups: choices(12) });
    expect(select(wrapper).exists()).toBe(true);
    expect(picker(wrapper).exists()).toBe(false);
    expect(wrapper.findAll('option')).toHaveLength(12);
  });

  it('is a field at 13, with no option element anywhere', () => {
    const wrapper = field({ groups: choices(13) });
    expect(select(wrapper).exists()).toBe(false);
    expect(picker(wrapper).exists()).toBe(true);
    expect(wrapper.findAll('option')).toHaveLength(0);
  });

  it('counts across the groups', () => {
    const groups = [...choices(7), ...choices(6)];
    expect(picker(field({ groups })).exists()).toBe(true);
  });

  it('lets wholeCount decide when given, on either side of what is drawn', () => {
    const fewDrawn = field({ groups: choices(3), wholeCount: 13 });
    expect(picker(fewDrawn).exists()).toBe(true);
    const manyDrawn = field({ groups: choices(13), wholeCount: 12 });
    expect(select(manyDrawn).exists()).toBe(true);
  });
});

describe('at 12 or fewer, the select', () => {
  it('carries the test id, the name and the words given', () => {
    const wrapper = field({ name: 'import-fix-a', describedBy: 'the-hint' });
    const element = select(wrapper);
    expect(element.classes()).toEqual(expect.arrayContaining(['field', 'field--select']));
    expect(element.attributes('name')).toBe('import-fix-a');
    expect(element.attributes('aria-describedby')).toBe('the-hint');
  });

  it('is named by its label, in view or hidden', () => {
    const shown = field();
    const label = shown.get('label');
    expect(label.classes()).toContain('field-label');
    expect(label.attributes('for')).toBe(select(shown).attributes('id'));
    expect(label.text()).toBe('What it means');

    const hidden = field({ hideLabel: true });
    expect(hidden.get('label').classes()).toContain('visually-hidden');
    expect(hidden.get('label').attributes('for')).toBe(select(hidden).attributes('id'));
  });

  it('draws the placeholder as its empty row, and no empty row without one', () => {
    const withRow = field({ groups: choices(2), placeholder: 'Choose…' });
    expect(withRow.findAll('option').map((option) => option.text())).toEqual([
      'Choose…',
      'Answer 0',
      'Answer 1',
    ]);
    expect(withRow.findAll('option')[0]!.attributes('value')).toBe('');

    const without = field({ groups: choices(2) });
    expect(without.findAll('option').map((option) => option.text())).toEqual([
      'Answer 0',
      'Answer 1',
    ]);
  });

  it('draws a named group as an optgroup, an unnamed one as bare rows, and no empty group', () => {
    const wrapper = field({
      groups: [
        { options: [{ value: 'first', label: 'First' }] },
        { label: 'Essential', options: [{ value: 'name', label: 'Full name' }] },
        { label: 'Nothing here', options: [] },
      ],
    });
    const groups = wrapper.findAll('optgroup');
    expect(groups.map((group) => group.attributes('label'))).toEqual(['Essential']);
    expect(groups[0]!.findAll('option').map((option) => option.text())).toEqual(['Full name']);
    expect(select(wrapper).element.children[0]!.tagName).toBe('OPTION');
  });

  it('shows the value and writes what is chosen', async () => {
    const wrapper = field({ modelValue: 'v3' });
    expect((select(wrapper).element as HTMLSelectElement).value).toBe('v3');

    await select(wrapper).setValue('v5');
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['v5']);
  });

  it('takes nothing while disabled', () => {
    const wrapper = field({ disabled: true });
    expect(select(wrapper).attributes('disabled')).toBeDefined();
  });
});

describe('past 12, the field', () => {
  const many = choices(60);

  it('is named by its label, hidden if asked, and carries the words given', () => {
    const wrapper = field({
      groups: many,
      hideLabel: true,
      placeholder: 'Choose…',
      describedBy: 'the-hint',
    });
    expect(wrapper.get('label').classes()).toContain('visually-hidden');
    expect(input(wrapper).attributes('placeholder')).toBe('Choose…');
    expect(input(wrapper).attributes('aria-describedby')).toBe('the-hint');
  });

  it('draws 50 and says how many more, the list lying over what follows', async () => {
    const wrapper = field({ groups: many });
    await input(wrapper).trigger('click');
    expect(wrapper.findAll('[data-testid="fix-option"]')).toHaveLength(50);
    expect(wrapper.get('[data-testid="fix-more"]').text()).toBe('10 more, type to narrow');
    expect(picker(wrapper).classes()).toContain('search-picker--list-over');
  });

  it('finds by the label by default, capitals aside, and says "Nothing" for none', async () => {
    const wrapper = field({ groups: many });
    await input(wrapper).setValue('aNSWER 42');
    expect(wrapper.findAll('[data-testid="fix-option"]').map((row) => row.text())).toEqual([
      'Answer 42',
    ]);
    await input(wrapper).setValue('nowhere');
    expect(wrapper.get('[data-testid="fix-none"]').text()).toBe('Nothing matches "nowhere".');
  });

  it('finds by what the screen says, given finds', async () => {
    const wrapper = field({
      groups: many,
      finds: (option: { value: string }, words: string) => option.value === words,
    });
    await input(wrapper).setValue('v7');
    expect(wrapper.findAll('[data-testid="fix-option"]').map((row) => row.text())).toEqual([
      'Answer 7',
    ]);
  });

  it('offers no words of its own, and words not chosen clear on leaving', async () => {
    const wrapper = field({ groups: many });
    await input(wrapper).setValue('Hand-poured soap');
    expect(wrapper.text()).not.toContain('Use "');
    await input(wrapper).trigger('blur');
    expect((input(wrapper).element as HTMLInputElement).value).toBe('');
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
  });

  it('with writes, holds a choice under words until another is taken', async () => {
    const wrapper = field({ groups: many, writes: true, modelValue: 'v1' });
    await input(wrapper).setValue('Answer 2');
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();

    await input(wrapper).trigger('blur');
    expect((input(wrapper).element as HTMLInputElement).value).toBe('Answer 1');

    await input(wrapper).setValue('Answer 2');
    await wrapper.findAll('[data-testid="fix-option"]')[0]!.trigger('click');
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['v2']);
  });

  it('without writes, the first word lets the choice go', async () => {
    const wrapper = field({ groups: many, modelValue: 'v1' });
    await input(wrapper).setValue('Answer');
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['']);
  });

  it('takes nothing while disabled', () => {
    const wrapper = field({ groups: many, disabled: true });
    expect(input(wrapper).attributes('disabled')).toBeDefined();
  });
});

describe('open()', () => {
  const opener = (wrapper: Field) => (wrapper.vm as unknown as { open(): boolean }).open;

  it('at the field: takes the focus and opens the list', async () => {
    const wrapper = field({ groups: choices(13) });
    expect(opener(wrapper)()).toBe(true);
    await flushPromises();
    expect(document.activeElement).toBe(input(wrapper).element);
    expect(wrapper.find('[data-testid="fix-list"]').exists()).toBe(true);
  });

  it('at the field: answers false where the field takes nothing', async () => {
    const wrapper = field({ groups: choices(13), disabled: true });
    expect(opener(wrapper)()).toBe(false);
    await flushPromises();
    expect(wrapper.find('[data-testid="fix-list"]').exists()).toBe(false);
  });

  it('at the select: focuses it and shows its list', () => {
    const wrapper = field();
    const element = select(wrapper).element as HTMLSelectElement;
    const showPicker = vi.fn();
    element.showPicker = showPicker;

    expect(opener(wrapper)()).toBe(true);
    expect(document.activeElement).toBe(element);
    expect(showPicker).toHaveBeenCalledOnce();
  });

  it('at the select: answers false where the browser has no showPicker', () => {
    const wrapper = field();
    const element = select(wrapper).element as HTMLSelectElement;
    Object.defineProperty(element, 'showPicker', { value: undefined, configurable: true });

    expect(opener(wrapper)()).toBe(false);
    expect(document.activeElement).toBe(element);
  });

  it('at the select: answers false where the browser refuses', () => {
    const wrapper = field();
    const element = select(wrapper).element as HTMLSelectElement;
    element.showPicker = () => {
      throw new DOMException('Refused', 'NotAllowedError');
    };

    expect(opener(wrapper)()).toBe(false);
  });
});
