/**
 * The searchable picker (E38/F08/S03): a field that narrows a list of choices as it is typed in,
 * grouped where the list is, and worked from the keyboard alone. The placement dialog's two vendor
 * pickers are its first use; it is a primitive, so it knows nothing of vendors.
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import SearchPicker, { type PickerGroup, type PickerOption } from '@/components/SearchPicker.vue';

const GROUPS: PickerGroup[] = [
  {
    label: 'Fits this seat',
    testid: 'fits',
    options: [
      { value: 'ana@example.com', label: 'Ana Ceramics (ana@example.com)' },
      { value: 'ben@example.com', label: 'Ben Prints (ben@example.com)' },
    ],
  },
  {
    label: 'Added by hand',
    testid: 'added',
    options: [{ value: 'walk.in@example.com', label: 'Walk-in Wares (walk.in@example.com)' }],
  },
];

const finds = (option: PickerOption, words: string) =>
  option.label.toLowerCase().includes(words.toLowerCase());

function picker(modelValue = '', groups = GROUPS) {
  const wrapper = mount(SearchPicker, {
    props: {
      modelValue,
      groups,
      finds,
      label: 'Who sits here',
      placeholder: 'Type a name…',
      testid: 'who',
      'onUpdate:modelValue': (value: string) => wrapper.setProps({ modelValue: value }),
    },
    attachTo: document.body,
  });
  return wrapper;
}

const field = (wrapper: ReturnType<typeof picker>) => wrapper.get('[data-testid="who-input"]');
const shown = (wrapper: ReturnType<typeof picker>) =>
  wrapper.findAll('[role="option"]').map((option) => option.attributes('data-value'));
const chosen = (wrapper: ReturnType<typeof picker>) =>
  wrapper.emitted('update:modelValue')?.at(-1)?.[0];

describe('the searchable picker', () => {
  it('is a combobox named by its label, its list closed until asked for', () => {
    const wrapper = picker();
    const input = field(wrapper);

    expect(input.attributes('role')).toBe('combobox');
    expect(input.attributes('aria-expanded')).toBe('false');
    expect(wrapper.get(`label[for="${input.attributes('id')}"]`).text()).toBe('Who sits here');
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('opens on a click, showing every choice in its groups', async () => {
    const wrapper = picker();
    await field(wrapper).trigger('click');

    expect(field(wrapper).attributes('aria-expanded')).toBe('true');
    expect(wrapper.get('[role="listbox"]').attributes('aria-label')).toBe('Who sits here');
    expect(shown(wrapper)).toEqual(['ana@example.com', 'ben@example.com', 'walk.in@example.com']);
    expect(wrapper.findAll('[role="group"]').map((group) => group.text())).toEqual([
      expect.stringContaining('Fits this seat'),
      expect.stringContaining('Added by hand'),
    ]);
    wrapper.unmount();
  });

  it('narrows as it is typed in, keeping every group and saying where none match', async () => {
    const wrapper = picker();
    await field(wrapper).setValue('cer');

    expect(shown(wrapper)).toEqual(['ana@example.com']);
    const added = wrapper.get('[data-testid="added"]');
    expect(added.text()).toContain('Added by hand');
    expect(added.text()).toContain('None match "cer".');
    wrapper.unmount();
  });

  it('says so when nothing at all matches', async () => {
    const wrapper = picker('', [GROUPS[0]!]);
    await field(wrapper).setValue('zzz');

    expect(shown(wrapper)).toEqual([]);
    expect(wrapper.get('[data-testid="who-none"]').text()).toBe('Nobody matches "zzz".');
    wrapper.unmount();
  });

  it('never opens when there are no choices at all', async () => {
    const wrapper = picker('', [
      { label: 'Fits this seat', testid: 'fits', options: [] },
      { label: 'Added by hand', testid: 'added', options: [] },
    ]);
    await field(wrapper).trigger('click');
    expect(field(wrapper).attributes('aria-expanded')).toBe('false');
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="who-none"]').exists()).toBe(false);

    await field(wrapper).setValue('ana');
    expect(field(wrapper).attributes('aria-expanded')).toBe('false');
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="who-none"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('is worked by the arrow keys and Enter, the active choice announced', async () => {
    const wrapper = picker();
    const input = field(wrapper);
    await input.trigger('keydown', { key: 'ArrowDown' });
    expect(input.attributes('aria-activedescendant')).toBe(
      wrapper.findAll('[role="option"]')[0]!.attributes('id'),
    );

    await input.trigger('keydown', { key: 'ArrowDown' });
    await input.trigger('keydown', { key: 'ArrowDown' });
    // Held at the last, rather than wrapping round to the first.
    await input.trigger('keydown', { key: 'ArrowDown' });
    await input.trigger('keydown', { key: 'ArrowUp' });
    const enter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
    input.element.dispatchEvent(enter);
    await wrapper.vm.$nextTick();

    expect(chosen(wrapper)).toBe('ben@example.com');
    // Enter chose, so it did not also submit the dialog the picker stands in.
    expect(enter.defaultPrevented).toBe(true);
    expect(input.attributes('aria-expanded')).toBe('false');
    expect((input.element as HTMLInputElement).value).toBe('Ben Prints (ben@example.com)');
    wrapper.unmount();
  });

  it('makes the first match active as it is typed in, so Enter takes it', async () => {
    const wrapper = picker();
    await field(wrapper).setValue('walk');
    await field(wrapper).trigger('keydown', { key: 'Enter' });

    expect(chosen(wrapper)).toBe('walk.in@example.com');
    wrapper.unmount();
  });

  it('leaves Enter to the dialog while the list is closed', async () => {
    const wrapper = picker('ana@example.com');
    const enter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
    field(wrapper).element.dispatchEvent(enter);

    expect(enter.defaultPrevented).toBe(false);
    wrapper.unmount();
  });

  it('closes on Escape without closing the dialog, and leaves the next Escape to it', async () => {
    const wrapper = picker();
    const reachedWindow: string[] = [];
    const listen = (event: KeyboardEvent) => reachedWindow.push(event.key);
    window.addEventListener('keydown', listen);

    await field(wrapper).trigger('click');
    field(wrapper).element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    await wrapper.vm.$nextTick();
    expect(field(wrapper).attributes('aria-expanded')).toBe('false');
    expect(reachedWindow).toEqual([]);

    field(wrapper).element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    expect(reachedWindow).toEqual(['Escape']);
    window.removeEventListener('keydown', listen);
    wrapper.unmount();
  });

  it('is chosen from by a click, the field then naming the choice', async () => {
    const wrapper = picker();
    await field(wrapper).trigger('click');
    await wrapper.findAll('[role="option"]')[2]!.trigger('click');

    expect(chosen(wrapper)).toBe('walk.in@example.com');
    expect(field(wrapper).attributes('aria-expanded')).toBe('false');
    expect((field(wrapper).element as HTMLInputElement).value).toBe(
      'Walk-in Wares (walk.in@example.com)',
    );
    wrapper.unmount();
  });

  it('marks the choice made, and lets it go once the words no longer name it', async () => {
    const wrapper = picker('ben@example.com');
    expect((field(wrapper).element as HTMLInputElement).value).toBe('Ben Prints (ben@example.com)');
    await field(wrapper).trigger('click');
    expect(wrapper.get('[aria-selected="true"]').attributes('data-value')).toBe('ben@example.com');

    await field(wrapper).setValue('Ben');
    expect(chosen(wrapper)).toBe('');
    wrapper.unmount();
  });

  it('selects the chosen label as it reopens, so typing searches afresh', async () => {
    const wrapper = picker('ben@example.com');
    const input = field(wrapper).element as HTMLInputElement;
    input.focus();
    await field(wrapper).trigger('click');

    expect([input.selectionStart, input.selectionEnd]).toEqual([0, input.value.length]);
    // Typed over the selection, the words are the new ones alone.
    await field(wrapper).setValue('walk');
    expect(shown(wrapper)).toEqual(['walk.in@example.com']);
    wrapper.unmount();
  });

  it('keeps the choice when reopened and left without typing', async () => {
    const wrapper = picker('ben@example.com');
    await field(wrapper).trigger('click');
    await field(wrapper).trigger('blur');

    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    expect((field(wrapper).element as HTMLInputElement).value).toBe('Ben Prints (ben@example.com)');
    expect(field(wrapper).attributes('aria-expanded')).toBe('false');
    wrapper.unmount();
  });

  it('empties when the choice is cleared from outside', async () => {
    const wrapper = picker('ben@example.com');
    await wrapper.setProps({ modelValue: '' });

    expect((field(wrapper).element as HTMLInputElement).value).toBe('');
    wrapper.unmount();
  });
});
