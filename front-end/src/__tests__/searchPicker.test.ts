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

describe('a capped match list', () => {
  /** Five in the first group and four in the second, each findable by its letter and number. */
  const CAPPED: PickerGroup[] = [
    {
      label: 'Fits this seat',
      testid: 'fits',
      options: [1, 2, 3, 4, 5].map((n) => ({ value: `a${n}`, label: `Aster ${n}` })),
    },
    {
      label: 'Added by hand',
      testid: 'added',
      options: [1, 2, 3, 4].map((n) => ({ value: `b${n}`, label: `Birch ${n}` })),
    },
  ];

  function capped(cap: number, modelValue = '', groups = CAPPED) {
    const wrapper = mount(SearchPicker, {
      props: {
        modelValue,
        groups,
        finds,
        cap,
        label: 'Who sits here',
        testid: 'who',
        'onUpdate:modelValue': (value: string) => wrapper.setProps({ modelValue: value }),
      },
      attachTo: document.body,
    });
    return wrapper;
  }

  const more = (wrapper: ReturnType<typeof capped>) => wrapper.find('[data-testid="who-more"]');
  const activeValue = (wrapper: ReturnType<typeof capped>) => {
    const id = field(wrapper).attributes('aria-activedescendant');
    return id ? wrapper.get(`[id="${id}"]`).attributes('data-value') : undefined;
  };

  it('draws at most the cap, counted across the groups in order, and says how many more', async () => {
    const wrapper = capped(7);
    await field(wrapper).trigger('click');

    expect(shown(wrapper)).toEqual(['a1', 'a2', 'a3', 'a4', 'a5', 'b1', 'b2']);
    expect(wrapper.get('[data-testid="fits"]').findAll('[role="option"]')).toHaveLength(5);
    expect(wrapper.get('[data-testid="added"]').findAll('[role="option"]')).toHaveLength(2);
    expect(more(wrapper).text()).toBe('2 more, type to narrow');
    wrapper.unmount();
  });

  it('keeps the line out of the options, and at the end of the list', async () => {
    const wrapper = capped(7);
    await field(wrapper).trigger('click');

    const list = wrapper.get('[role="listbox"]').element;
    expect(list.lastElementChild).toBe(more(wrapper).element);
    expect(more(wrapper).attributes('role')).toBe('presentation');
    expect(wrapper.findAll('[role="option"]').map((option) => option.text())).not.toContain(
      '2 more, type to narrow',
    );
    wrapper.unmount();
  });

  it('counts the matches as words are typed, and drops the line once they fit', async () => {
    const wrapper = capped(2);
    await field(wrapper).trigger('click');
    expect(more(wrapper).text()).toBe('7 more, type to narrow');

    // Nine in all, five of them Aster: the count is of what the words find.
    await field(wrapper).setValue('aster');
    expect(shown(wrapper)).toEqual(['a1', 'a2']);
    expect(more(wrapper).text()).toBe('3 more, type to narrow');

    await field(wrapper).setValue('birch');
    expect(shown(wrapper)).toEqual(['b1', 'b2']);
    expect(more(wrapper).text()).toBe('2 more, type to narrow');

    // Under the cap, all of them are drawn, so nothing is left to say.
    await field(wrapper).setValue('aster 3');
    expect(shown(wrapper)).toEqual(['a3']);
    expect(more(wrapper).exists()).toBe(false);
    wrapper.unmount();
  });

  it('draws no line when exactly the cap match', async () => {
    const wrapper = capped(9);
    await field(wrapper).trigger('click');

    expect(shown(wrapper)).toHaveLength(9);
    expect(more(wrapper).exists()).toBe(false);
    wrapper.unmount();
  });

  it('leaves the line out of the keys: they stop at the last row drawn', async () => {
    const wrapper = capped(3);
    const input = field(wrapper);
    await input.trigger('keydown', { key: 'ArrowDown' });
    expect(activeValue(wrapper)).toBe('a1');

    for (let press = 0; press < 5; press++) await input.trigger('keydown', { key: 'ArrowDown' });
    expect(activeValue(wrapper)).toBe('a3');

    await input.trigger('keydown', { key: 'Enter' });
    expect(chosen(wrapper)).toBe('a3');
    wrapper.unmount();
  });

  it('does not say a group has no match when the cap alone left it out', async () => {
    const wrapper = capped(3);
    await field(wrapper).trigger('click');

    expect(wrapper.find('[data-testid="added"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('None match');
    expect(more(wrapper).text()).toBe('6 more, type to narrow');
    wrapper.unmount();
  });

  it('still says so of a group the words find nothing in', async () => {
    const wrapper = capped(2);
    await field(wrapper).setValue('birch');

    expect(wrapper.get('[data-testid="fits"]').text()).toContain('None match "birch".');
    expect(shown(wrapper)).toEqual(['b1', 'b2']);
    wrapper.unmount();
  });

  it('points the field at the line while it shows, for a reader that stays on the field', async () => {
    const wrapper = capped(3);
    expect(field(wrapper).attributes('aria-describedby')).toBeUndefined();

    await field(wrapper).trigger('click');
    expect(field(wrapper).attributes('aria-describedby')).toBe(more(wrapper).attributes('id'));

    await field(wrapper).setValue('aster 1');
    expect(field(wrapper).attributes('aria-describedby')).toBeUndefined();
    wrapper.unmount();
  });

  describe('reopened on a choice past the cap', () => {
    it('selects the label, so typing searches afresh', async () => {
      const wrapper = capped(3, 'b4');
      const input = field(wrapper).element as HTMLInputElement;
      expect(input.value).toBe('Birch 4');
      input.focus();
      await field(wrapper).trigger('click');

      expect(shown(wrapper)).toEqual(['a1', 'a2', 'a3']);
      expect([input.selectionStart, input.selectionEnd]).toEqual([0, input.value.length]);
      wrapper.unmount();
    });

    it('makes no row active, so Enter keeps the choice rather than taking the first', async () => {
      const wrapper = capped(3, 'b4');
      await field(wrapper).trigger('click');
      expect(field(wrapper).attributes('aria-activedescendant')).toBeUndefined();

      await field(wrapper).trigger('keydown', { key: 'Enter' });
      expect(wrapper.emitted('update:modelValue')).toBeUndefined();
      expect(field(wrapper).attributes('aria-expanded')).toBe('false');
      expect((field(wrapper).element as HTMLInputElement).value).toBe('Birch 4');
      wrapper.unmount();
    });

    it('starts the keys at the first row', async () => {
      const wrapper = capped(3, 'b4');
      await field(wrapper).trigger('click');
      await field(wrapper).trigger('keydown', { key: 'ArrowDown' });

      expect(activeValue(wrapper)).toBe('a1');
      wrapper.unmount();
    });

    it('reaches the choice once the words bring it under the cap', async () => {
      const wrapper = capped(3, 'b4');
      await field(wrapper).trigger('click');
      await field(wrapper).setValue('birch 4');
      expect(shown(wrapper)).toEqual(['b4']);
      expect(activeValue(wrapper)).toBe('b4');

      await field(wrapper).trigger('keydown', { key: 'Enter' });
      expect(chosen(wrapper)).toBe('b4');
      expect((field(wrapper).element as HTMLInputElement).value).toBe('Birch 4');
      wrapper.unmount();
    });
  });

  it('marks a choice the cap still draws, and makes it active', async () => {
    const wrapper = capped(3, 'a2');
    await field(wrapper).trigger('click');

    expect(wrapper.get('[aria-selected="true"]').attributes('data-value')).toBe('a2');
    expect(activeValue(wrapper)).toBe('a2');
    wrapper.unmount();
  });
});

describe('without a cap', () => {
  it('draws every choice, and no line', async () => {
    const many: PickerOption[] = Array.from({ length: 300 }, (_, n) => ({
      value: `v${n}`,
      label: `Choice ${n}`,
    }));
    const wrapper = picker('', [{ options: many }]);
    await field(wrapper).trigger('click');

    expect(shown(wrapper)).toHaveLength(300);
    expect(wrapper.find('[data-testid="who-more"]').exists()).toBe(false);
    expect(field(wrapper).attributes('aria-describedby')).toBeUndefined();
    wrapper.unmount();
  });
});

describe('several choices', () => {
  const ANSWERS: PickerGroup[] = [
    {
      options: [
        { value: 'ana', label: 'Ana Ceramics' },
        { value: 'ben', label: 'Ben Prints' },
        { value: 'cai', label: 'Cai Ceramics' },
        { value: 'dee', label: 'Dee Candles' },
      ],
    },
  ];

  function several(modelValue: string[] = [], extra: { cap?: number } = {}) {
    const wrapper = mount(SearchPicker, {
      props: {
        multiple: true,
        modelValue,
        groups: ANSWERS,
        finds,
        label: 'Who reviews',
        testid: 'who',
        'onUpdate:modelValue': (value: string | string[]) =>
          wrapper.setProps({ modelValue: value }),
        ...extra,
      },
      attachTo: document.body,
    });
    return wrapper;
  }
  type Several = ReturnType<typeof several>;

  const input = (wrapper: Several) => wrapper.get('[data-testid="who-input"]');
  const element = (wrapper: Several) => input(wrapper).element as HTMLInputElement;
  const chipWords = (wrapper: Several) =>
    wrapper.findAll('[data-testid="who-chip"] > span:first-child').map((chip) => chip.text());
  const removeButton = (wrapper: Several, name: string) => {
    const button = wrapper
      .findAll('[data-testid="who-chip-remove"]')
      .find((candidate) => candidate.text() === name);
    if (!button) throw new Error(`No button named ${name}`);
    return button;
  };
  const row = (wrapper: Several, value: string) =>
    wrapper.get(`[role="option"][data-value="${value}"]`);
  const arrays = (wrapper: Several) =>
    wrapper.emitted('update:modelValue')?.map(([value]) => value);
  const rows = (wrapper: Several) =>
    wrapper.findAll('[role="option"]').map((option) => option.attributes('data-value'));

  it('shows each chosen as a chip above the field, with a remove button named for it', () => {
    const wrapper = several(['cai', 'ana']);

    expect(chipWords(wrapper)).toEqual(['Cai Ceramics', 'Ana Ceramics']);
    expect(wrapper.findAll('[data-testid="who-chip"]').every((chip) => chip.classes('chip'))).toBe(
      true,
    );
    expect(wrapper.findAll('[data-testid="who-chip-remove"]').map((b) => b.text())).toEqual([
      'Remove Cai Ceramics',
      'Remove Ana Ceramics',
    ]);
    expect(wrapper.get('[data-testid="who-chip-remove"]').attributes('type')).toBe('button');

    const chips = wrapper.get('[data-testid="who-chips"]').element;
    const position = chips.compareDocumentPosition(input(wrapper).element);
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    wrapper.unmount();
  });

  it('names the chips by the picker, and draws no chips with none chosen', () => {
    const none = several();
    expect(none.find('[data-testid="who-chips"]').exists()).toBe(false);
    none.unmount();

    const wrapper = several(['ana']);
    expect(wrapper.get('[data-testid="who-chips"]').attributes('aria-label')).toBe(
      'Who reviews, chosen',
    );
    wrapper.unmount();
  });

  it('shows a chosen value no option offers as a chip of its own words', () => {
    const wrapper = several(['gone@example.com']);
    expect(chipWords(wrapper)).toEqual(['gone@example.com']);
    wrapper.unmount();
  });

  it('holds the words only: a choice never fills the field', async () => {
    const wrapper = several(['ana']);
    expect(element(wrapper).value).toBe('');

    await input(wrapper).trigger('click');
    await row(wrapper, 'ben').trigger('click');
    expect(element(wrapper).value).toBe('');
    wrapper.unmount();
  });

  it('adds a choice by a click, emits the array, and stays open', async () => {
    const wrapper = several(['ana']);
    await input(wrapper).trigger('click');
    await row(wrapper, 'cai').trigger('click');

    expect(arrays(wrapper)).toEqual([['ana', 'cai']]);
    expect(chipWords(wrapper)).toEqual(['Ana Ceramics', 'Cai Ceramics']);
    expect(wrapper.find('[role="listbox"]').exists()).toBe(true);
    expect(input(wrapper).attributes('aria-expanded')).toBe('true');
    wrapper.unmount();
  });

  it('chooses several in a row by the keys, and Enter stays with the list', async () => {
    const wrapper = several();
    await input(wrapper).trigger('click');
    await input(wrapper).trigger('keydown', { key: 'Enter' });
    await input(wrapper).trigger('keydown', { key: 'ArrowDown' });
    const held = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true });
    element(wrapper).dispatchEvent(held);
    await wrapper.vm.$nextTick();

    expect(held.defaultPrevented).toBe(true);
    expect(arrays(wrapper)).toEqual([['ana'], ['ana', 'ben']]);
    expect(wrapper.find('[role="listbox"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it('keeps a chosen option in the list, marked chosen, and the list says it takes several', async () => {
    const wrapper = several(['ben']);
    await input(wrapper).trigger('click');

    expect(wrapper.get('[role="listbox"]').attributes('aria-multiselectable')).toBe('true');
    expect(rows(wrapper)).toEqual(['ana', 'ben', 'cai', 'dee']);
    expect(row(wrapper, 'ben').attributes('aria-selected')).toBe('true');
    expect(row(wrapper, 'ana').attributes('aria-selected')).toBe('false');
    expect(row(wrapper, 'ben').find('svg').exists()).toBe(true);
    expect(row(wrapper, 'ana').find('svg').exists()).toBe(false);
    wrapper.unmount();
  });

  it('removes a choice when it is chosen again, by a click or by Enter', async () => {
    const wrapper = several(['ana', 'ben']);
    await input(wrapper).trigger('click');
    await row(wrapper, 'ana').trigger('click');
    expect(arrays(wrapper)).toEqual([['ben']]);

    // The active row is the first; the keys walk to Ben, who is chosen.
    await input(wrapper).trigger('keydown', { key: 'ArrowDown' });
    await input(wrapper).trigger('keydown', { key: 'Enter' });
    expect(arrays(wrapper)).toEqual([['ben'], []]);
    expect(wrapper.find('[data-testid="who-chips"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("removes a choice by its chip's button", async () => {
    const wrapper = several(['ana', 'ben', 'cai']);
    await removeButton(wrapper, 'Remove Ben Prints').trigger('click');

    expect(arrays(wrapper)).toEqual([['ana', 'cai']]);
    expect(chipWords(wrapper)).toEqual(['Ana Ceramics', 'Cai Ceramics']);
    wrapper.unmount();
  });

  it('gives focus on from a removed chip to the next, the last, then the field', async () => {
    const wrapper = several(['ana', 'ben']);
    const focused = () => document.activeElement?.textContent?.trim();

    (removeButton(wrapper, 'Remove Ana Ceramics').element as HTMLElement).focus();
    await removeButton(wrapper, 'Remove Ana Ceramics').trigger('click');
    await wrapper.vm.$nextTick();
    expect(focused()).toContain('Remove Ben Prints');

    await removeButton(wrapper, 'Remove Ben Prints').trigger('click');
    await wrapper.vm.$nextTick();
    expect(document.activeElement).toBe(element(wrapper));
    wrapper.unmount();
  });

  it('leaves the field focused and the list open when a pointer removes a chip', async () => {
    const wrapper = several(['ana', 'ben']);
    element(wrapper).focus();
    await input(wrapper).trigger('click');
    await input(wrapper).setValue('cer');

    const button = removeButton(wrapper, 'Remove Ana Ceramics');
    const press = new MouseEvent('mousedown', { cancelable: true, bubbles: true });
    button.element.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);
    await button.trigger('click');
    await wrapper.vm.$nextTick();

    expect(document.activeElement).toBe(element(wrapper));
    expect(element(wrapper).value).toBe('cer');
    expect(wrapper.find('[role="listbox"]').exists()).toBe(true);
    wrapper.unmount();
  });

  describe('Backspace', () => {
    it('removes the last chip from an empty field', async () => {
      const wrapper = several(['ana', 'ben']);
      await input(wrapper).trigger('keydown', { key: 'Backspace' });

      expect(arrays(wrapper)).toEqual([['ana']]);
      wrapper.unmount();
    });

    it("is the field's own while it holds words", async () => {
      const wrapper = several(['ana', 'ben']);
      await input(wrapper).setValue('c');
      const key = new KeyboardEvent('keydown', { key: 'Backspace', cancelable: true });
      element(wrapper).dispatchEvent(key);

      expect(key.defaultPrevented).toBe(false);
      expect(arrays(wrapper)).toBeUndefined();
      wrapper.unmount();
    });

    it('takes no chip while it is held down, so clearing words stops at the field', async () => {
      const wrapper = several(['ana', 'ben']);
      await input(wrapper).trigger('keydown', { key: 'Backspace', repeat: true });

      expect(arrays(wrapper)).toBeUndefined();
      wrapper.unmount();
    });

    it('emits nothing with nothing chosen', async () => {
      const wrapper = several();
      await input(wrapper).trigger('keydown', { key: 'Backspace' });

      expect(arrays(wrapper)).toBeUndefined();
      wrapper.unmount();
    });
  });

  describe('the words', () => {
    it('never touch the choices', async () => {
      const wrapper = several(['ana']);
      await input(wrapper).setValue('cer');
      await input(wrapper).setValue('');

      expect(arrays(wrapper)).toBeUndefined();
      expect(chipWords(wrapper)).toEqual(['Ana Ceramics']);
      wrapper.unmount();
    });

    it('narrow the list, and stay selected after a choice, so the next word replaces them', async () => {
      const wrapper = several();
      element(wrapper).focus();
      await input(wrapper).setValue('ceramics');
      expect(rows(wrapper)).toEqual(['ana', 'cai']);

      await row(wrapper, 'ana').trigger('click');
      expect(rows(wrapper)).toEqual(['ana', 'cai']);
      expect(element(wrapper).value).toBe('ceramics');
      expect(element(wrapper).selectionStart).toBe(0);
      expect(element(wrapper).selectionEnd).toBe('ceramics'.length);

      await input(wrapper).trigger('keydown', { key: 'ArrowDown' });
      await input(wrapper).trigger('keydown', { key: 'Enter' });
      expect(arrays(wrapper)).toEqual([['ana'], ['ana', 'cai']]);
      wrapper.unmount();
    });

    it('go when the field is left, since nothing was chosen by them', async () => {
      const wrapper = several(['ana']);
      await input(wrapper).setValue('cer');
      await input(wrapper).trigger('blur');

      expect(element(wrapper).value).toBe('');
      expect(wrapper.find('[role="listbox"]').exists()).toBe(false);
      await input(wrapper).trigger('click');
      expect(rows(wrapper)).toEqual(['ana', 'ben', 'cai', 'dee']);
      wrapper.unmount();
    });
  });

  it('closes the list on Enter when nothing matches, and on Escape, choosing nothing', async () => {
    const wrapper = several(['ana']);
    await input(wrapper).setValue('nothing like this');
    await input(wrapper).trigger('keydown', { key: 'Enter' });
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false);

    await input(wrapper).setValue('cer');
    const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    element(wrapper).dispatchEvent(escape);
    await wrapper.vm.$nextTick();
    expect(escape.defaultPrevented).toBe(true);
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false);
    expect(arrays(wrapper)).toBeUndefined();
    wrapper.unmount();
  });

  it('leaves Enter to the form while the list is closed', () => {
    const wrapper = several(['ana']);
    const enter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
    element(wrapper).dispatchEvent(enter);

    expect(enter.defaultPrevented).toBe(false);
    expect(arrays(wrapper)).toBeUndefined();
    wrapper.unmount();
  });

  describe('with a cap', () => {
    it('draws up to the cap, counts the rest, and marks what it draws', async () => {
      const wrapper = several(['ben'], { cap: 2 });
      await input(wrapper).trigger('click');

      expect(rows(wrapper)).toEqual(['ana', 'ben']);
      expect(wrapper.get('[data-testid="who-more"]').text()).toBe('2 more, type to narrow');
      expect(row(wrapper, 'ben').attributes('aria-selected')).toBe('true');
      wrapper.unmount();
    });

    it('keeps a choice past the cap as a chip, reached again by the words', async () => {
      const wrapper = several(['dee'], { cap: 2 });
      await input(wrapper).trigger('click');
      expect(rows(wrapper)).toEqual(['ana', 'ben']);
      expect(chipWords(wrapper)).toEqual(['Dee Candles']);

      await input(wrapper).setValue('candles');
      expect(rows(wrapper)).toEqual(['dee']);
      expect(row(wrapper, 'dee').attributes('aria-selected')).toBe('true');

      await input(wrapper).trigger('keydown', { key: 'Enter' });
      expect(arrays(wrapper)).toEqual([[]]);
      wrapper.unmount();
    });

    it('walks only what it draws, and a choice past the cap never takes the keys', async () => {
      const wrapper = several(['dee'], { cap: 2 });
      await input(wrapper).trigger('click');
      await input(wrapper).trigger('keydown', { key: 'Enter' });

      expect(arrays(wrapper)).toEqual([['dee', 'ana']]);
      wrapper.unmount();
    });
  });
});

describe('with no match', () => {
  it('says nobody, unless the caller has a word of its own', async () => {
    const one = mount(SearchPicker, {
      props: {
        modelValue: '',
        groups: [GROUPS[0]!],
        finds,
        label: 'Who',
        testid: 'who',
      },
    });
    await one.get('[data-testid="who-input"]').setValue('zzz');
    expect(one.get('[data-testid="who-none"]').text()).toBe('Nobody matches "zzz".');
    await one.setProps({ noneWord: 'Nothing' });
    expect(one.get('[data-testid="who-none"]').text()).toBe('Nothing matches "zzz".');
    one.unmount();
  });
});

describe('one choice', () => {
  it('draws no chips, says nothing of several, and marks no row with a tick', async () => {
    const wrapper = picker('ana@example.com');
    await field(wrapper).trigger('click');

    expect(wrapper.find('[data-testid="who-chips"]').exists()).toBe(false);
    expect(wrapper.get('[role="listbox"]').attributes('aria-multiselectable')).toBeUndefined();
    expect(wrapper.find('[role="option"] svg').exists()).toBe(false);
    wrapper.unmount();
  });

  it('leaves Backspace to the field', async () => {
    const wrapper = picker('');
    await field(wrapper).trigger('keydown', { key: 'Backspace' });

    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    wrapper.unmount();
  });
});
