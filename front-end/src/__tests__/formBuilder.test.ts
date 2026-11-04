import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import { mount } from '@vue/test-utils';

import FormBuilder from '@/components/application/FormBuilder.vue';
import type { ApplicationForm, ExampleColumn, FormField } from '@/assets/types/datatypes';
import { applicationFormError } from '@/utils/applicationForm';

/**
 * Mirrors how MarketSetupView owns the form and the hand-edited-key flags: child emits, parent
 * re-feeds them as props. `mounted` mirrors the `v-if` on the Application Form tab, so a test can
 * tab away and back and see whether state that must outlive the builder actually does.
 */
function mountWithParent(
  initial: ApplicationForm | null,
  readonly = false,
  exampleColumns?: ExampleColumn[],
  attachTo?: HTMLElement,
) {
  const form = ref<ApplicationForm | null>(initial);
  const keyTouched = ref<boolean[]>((initial?.fields ?? []).map(() => true));
  const mounted = ref(true);

  const Parent = defineComponent({
    setup() {
      return () =>
        mounted.value
          ? h(FormBuilder, {
              applicationForm: form.value,
              keyTouched: keyTouched.value,
              readonly,
              exampleColumns,
              'onUpdate:applicationForm': (next: ApplicationForm) => {
                form.value = next;
              },
              'onUpdate:keyTouched': (next: boolean[]) => {
                keyTouched.value = next;
              },
            })
          : h('div');
    },
  });

  const wrapper = mount(Parent, { attachTo });

  /** Leave the Application Form tab and come back, tearing the builder down and rebuilding it. */
  async function remount() {
    mounted.value = false;
    await wrapper.vm.$nextTick();
    mounted.value = true;
    await wrapper.vm.$nextTick();
  }

  return { wrapper, form, keyTouched, remount };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('FormBuilder', () => {
  it('keeps the questions the market does not ask when a field changes (bug 29)', async () => {
    const { wrapper, form } = mountWithParent({
      fields: [],
      publishedAt: undefined,
      unaskedEssentials: ['essential_section_ranking'],
    });

    await wrapper.get('[data-testid="form-builder-add-field-button"]').trigger('click');
    await wrapper.get('[data-testid="form-field-label-input"]').setValue('Business Name');

    expect(form.value?.fields.map((f) => f.label)).toEqual(['Business Name']);
    expect(form.value?.unaskedEssentials).toEqual(['essential_section_ranking']);
  });

  it('does not re-enter its own updates when the parent feeds the form back', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { wrapper, form } = mountWithParent(null);

    await wrapper.get('[data-testid="form-builder-add-field-button"]').trigger('click');
    await wrapper.get('[data-testid="form-field-label-input"]').setValue('Business Name');
    await wrapper.get('[data-testid="form-builder-add-field-button"]').trigger('click');

    expect(form.value?.fields).toHaveLength(2);
    const recursive = warn.mock.calls.filter((c) =>
      String(c[0]).includes('Maximum recursive updates'),
    );
    expect(recursive).toEqual([]);
  });

  it('derives the key from the label as it is typed', async () => {
    const { wrapper, form } = mountWithParent(null);

    await wrapper.get('[data-testid="form-builder-add-field-button"]').trigger('click');
    expect(form.value?.fields[0].key).toBe('');

    await wrapper.get('[data-testid="form-field-label-input"]').setValue('Business Name!');

    expect(form.value?.fields[0].key).toBe('business_name');
  });

  it('re-derives an auto key when the label is corrected', async () => {
    const { wrapper, form } = mountWithParent(null);

    await wrapper.get('[data-testid="form-builder-add-field-button"]').trigger('click');
    const label = wrapper.get('[data-testid="form-field-label-input"]');

    await label.setValue('Bsuiness Name');
    expect(form.value?.fields[0].key).toBe('bsuiness_name');

    await label.setValue('Business Name');
    expect(form.value?.fields[0].key).toBe('business_name');
  });

  it('never overwrites a hand-edited key', async () => {
    const { wrapper, form } = mountWithParent(null);

    await wrapper.get('[data-testid="form-builder-add-field-button"]').trigger('click');
    await wrapper.get('[data-testid="form-field-key-input"]').setValue('custom_key');

    const label = wrapper.get('[data-testid="form-field-label-input"]');
    await label.setValue('Business Name');
    await label.trigger('blur');

    expect(form.value?.fields[0].key).toBe('custom_key');
  });

  it('hands a cleared key back to the label, as its placeholder promises', async () => {
    const { wrapper, form } = mountWithParent(null);

    await wrapper.get('[data-testid="form-builder-add-field-button"]').trigger('click');
    await wrapper.get('[data-testid="form-field-label-input"]').setValue('Business Name');

    const key = wrapper.get('[data-testid="form-field-key-input"]');
    await key.setValue('custom_key');
    await key.setValue('');
    await key.trigger('blur');

    expect(form.value?.fields[0].key).toBe('business_name');

    // ...and it tracks the label again from here on.
    await wrapper.get('[data-testid="form-field-label-input"]').setValue('Shop Name');
    expect(form.value?.fields[0].key).toBe('shop_name');
  });

  it('still re-derives an auto key after the organizer switches tabs and back', async () => {
    const { wrapper, form, remount } = mountWithParent(null);

    await wrapper.get('[data-testid="form-builder-add-field-button"]').trigger('click');
    await wrapper.get('[data-testid="form-field-label-input"]').setValue('Bsuiness Name');
    expect(form.value?.fields[0].key).toBe('bsuiness_name');

    await remount();

    await wrapper.get('[data-testid="form-field-label-input"]').setValue('Business Name');
    expect(form.value?.fields[0].key).toBe('business_name');
  });

  it('still protects a hand-edited key after the organizer switches tabs and back', async () => {
    const { wrapper, form, remount } = mountWithParent(null);

    await wrapper.get('[data-testid="form-builder-add-field-button"]').trigger('click');
    await wrapper.get('[data-testid="form-field-key-input"]').setValue('custom_key');

    await remount();

    await wrapper.get('[data-testid="form-field-label-input"]').setValue('Business Name');
    expect(form.value?.fields[0].key).toBe('custom_key');
  });

  it('keeps the hand-edited flag with its field when an earlier field is removed', async () => {
    const { wrapper, form } = mountWithParent(null);

    await wrapper.get('[data-testid="form-builder-add-field-button"]').trigger('click');
    await wrapper.get('[data-testid="form-field-key-input"]').setValue('hand_edited');
    await wrapper.get('[data-testid="form-builder-add-field-button"]').trigger('click');

    await wrapper.findAll('[data-testid="form-builder-remove-field-button"]')[0].trigger('click');

    // The surviving field never had its key touched, so it must still track its label.
    await wrapper.get('[data-testid="form-field-label-input"]').setValue('Booth Size');

    expect(form.value?.fields).toHaveLength(1);
    expect(form.value?.fields[0].key).toBe('booth_size');
  });

  it('treats a key loaded from the server as hand-edited', async () => {
    const existing: ApplicationForm = {
      fields: [
        { key: 'shop_name', label: 'Shop', type: 'text', required: false, options: [], order: 0 },
      ],
    };
    const { wrapper, form } = mountWithParent(existing);

    await wrapper.get('[data-testid="form-field-label-input"]').setValue('Storefront');

    expect(form.value?.fields[0].key).toBe('shop_name');
  });

  it('gives each added field a distinct key once labelled, even after a removal', async () => {
    const { wrapper, form } = mountWithParent(null);

    const addField = async (labelText: string) => {
      await wrapper.get('[data-testid="form-builder-add-field-button"]').trigger('click');
      const labels = wrapper.findAll('[data-testid="form-field-label-input"]');
      const last = labels[labels.length - 1];
      await last.setValue(labelText);
      await last.trigger('blur');
    };

    await addField('Alpha');
    await addField('Beta');
    await wrapper.findAll('[data-testid="form-builder-remove-field-button"]')[0].trigger('click');
    await addField('Gamma');

    const keys = form.value!.fields.map((f) => f.key);
    expect(keys).toEqual(['beta', 'gamma']);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('renumbers order contiguously as fields are added and removed', async () => {
    const { wrapper, form } = mountWithParent(null);

    for (let i = 0; i < 3; i++) {
      await wrapper.get('[data-testid="form-builder-add-field-button"]').trigger('click');
    }
    await wrapper.findAll('[data-testid="form-builder-remove-field-button"]')[1].trigger('click');

    expect(form.value!.fields.map((f) => f.order)).toEqual([0, 1]);
  });

  it('emits nothing and hides the editing affordances when readonly', async () => {
    const existing: ApplicationForm = {
      fields: [{ key: 'shop', label: 'Shop', type: 'text', required: true, options: [], order: 0 }],
    };
    const { wrapper, form } = mountWithParent(existing, true);

    expect(wrapper.find('[data-testid="form-builder-add-field-button"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="form-builder-remove-field-button"]').exists()).toBe(false);

    const label = wrapper.get('[data-testid="form-field-label-input"]');
    expect(label.attributes('disabled')).toBeDefined();
    await label.setValue('Tampered');

    expect(form.value!.fields[0].label).toBe('Shop');
  });
});

const BOOTH: ExampleColumn = {
  headers: ['Booth size'],
  key: 'booth_size',
  label: 'Booth size',
  helpText: null,
  type: 'checkbox',
  question: true,
  options: { select: ['Small', 'Large', 'Medium'], multiSelect: ['Small', 'Large', 'Medium'] },
};
const SELLS: ExampleColumn = {
  headers: ['What do you sell?'],
  key: 'what_do_you_sell',
  label: 'What do you sell?',
  helpText: null,
  type: 'multi_select',
  question: true,
  options: {
    select: ['Prints', 'Prints, Stickers', 'Stickers'],
    multiSelect: ['Prints', 'Stickers'],
  },
};
const STATUS: ExampleColumn = {
  headers: ['Status'],
  key: 'status',
  label: 'Status',
  helpText: null,
  type: 'select',
  question: false,
  options: {
    select: ['Accepted', 'Waitlist', 'Rejected'],
    multiSelect: ['Accepted', 'Waitlist', 'Rejected'],
  },
};

function question(patch: Partial<FormField>): FormField {
  return { key: '', label: '', type: 'text', required: false, options: [], order: 0, ...patch };
}

function optionValues(wrapper: ReturnType<typeof mount>): string[] {
  return wrapper
    .findAll('[data-testid="form-field-option-input"]')
    .map((input) => (input.element as HTMLInputElement).value);
}

describe('FormBuilder, on a market started from a file (E38/F02/S02)', () => {
  it('fills a question’s options from the file when it becomes a Select', async () => {
    const booth = question({ key: 'booth_size', label: 'Booth size', type: 'checkbox' });
    const { wrapper, form } = mountWithParent({ fields: [booth] }, false, [BOOTH]);

    await wrapper.get('[data-testid="form-field-type-select"]').setValue('select');

    expect(form.value!.fields[0]).toMatchObject({
      type: 'select',
      options: ['Small', 'Large', 'Medium'],
    });
    expect(optionValues(wrapper)).toEqual(['Small', 'Large', 'Medium']);
    expect(wrapper.get('[data-testid="form-field-options-from-file"]').text()).toContain(
      'answers in your file',
    );
  });

  it('fills a Multi-Select with the options inside the answers', async () => {
    const sells = question({ key: 'what_do_you_sell', label: 'What do you sell?' });
    const { wrapper, form } = mountWithParent({ fields: [sells] }, false, [SELLS]);

    await wrapper.get('[data-testid="form-field-type-select"]').setValue('select');
    expect(form.value!.fields[0].options).toEqual(['Prints', 'Prints, Stickers', 'Stickers']);
    await wrapper.get('[data-testid="form-field-type-select"]').setValue('multi_select');
    expect(form.value!.fields[0].options).toEqual(['Prints', 'Stickers']);
  });

  it('keeps an edited option through a change of type, and replaces it only when asked', async () => {
    const sells = question({
      key: 'what_do_you_sell',
      label: 'What do you sell?',
      type: 'select',
      options: ['Prints', 'Prints, Stickers', 'Stickers'],
    });
    const { wrapper, form } = mountWithParent({ fields: [sells] }, false, [SELLS]);

    await wrapper.findAll('[data-testid="form-field-option-input"]')[0].setValue('Art prints');
    await wrapper.get('[data-testid="form-field-type-select"]').setValue('multi_select');
    await wrapper.get('[data-testid="form-field-type-select"]').setValue('select');
    expect(form.value!.fields[0].options).toEqual(['Art prints', 'Prints, Stickers', 'Stickers']);

    await wrapper.get('[data-testid="form-field-use-file-options-button"]').trigger('click');
    expect(form.value!.fields[0].options).toEqual(['Prints', 'Prints, Stickers', 'Stickers']);
    expect(wrapper.find('[data-testid="form-field-use-file-options-button"]').exists()).toBe(false);
  });

  it('adds a question from a column the start left out, and offers it no more', async () => {
    const booth = question({ key: 'booth_size', label: 'Booth size', type: 'checkbox' });
    const { wrapper, form, keyTouched } = mountWithParent({ fields: [booth] }, false, [
      BOOTH,
      STATUS,
    ]);
    const add = wrapper.get('[data-testid="form-builder-add-from-file"]');
    expect(add.findAll('option').map((o) => o.text())).toEqual(['Choose a column', 'Status']);
    expect(wrapper.get('.add-from-file label').text()).toBe('Add from your file');
    expect(wrapper.get('.add-from-file label').attributes('for')).toBe(add.attributes('id'));

    await add.setValue('status');

    expect(form.value!.fields[1]).toMatchObject({
      key: 'status',
      label: 'Status',
      type: 'select',
      options: ['Accepted', 'Waitlist', 'Rejected'],
      order: 1,
    });
    // Its key is the one the saved import mapping names: relabelling it must not move it.
    expect(keyTouched.value).toEqual([true, true]);
    expect(wrapper.find('[data-testid="form-builder-add-from-file"]').exists()).toBe(false);
  });

  describe('past 12 columns the file offered (T223)', () => {
    const left = (count: number): ExampleColumn[] =>
      Array.from({ length: count }, (_, at) => ({
        headers: [`Column ${at}`],
        key: `column_${at}`,
        label: `Column ${at}`,
        helpText: null,
        type: 'text',
        question: false,
        options: { select: [], multiSelect: [] },
      }));

    it('stays a select at 12, back on its empty row after each added', async () => {
      const { wrapper, form } = mountWithParent({ fields: [] }, false, left(12));
      const add = wrapper.get('select[data-testid="form-builder-add-from-file"]');
      expect(add.findAll('option')).toHaveLength(13);

      await add.setValue('column_3');

      expect(form.value!.fields.map((f) => f.key)).toEqual(['column_3']);
      expect((add.element as HTMLSelectElement).value).toBe('');
      expect(add.findAll('option').map((o) => o.text())).not.toContain('Column 3');
    });

    it('is a field at 13, ready for the next, and a column added leaves the list', async () => {
      const attachTo = document.createElement('div');
      document.body.appendChild(attachTo);
      const { wrapper, form, keyTouched } = mountWithParent(
        { fields: [] },
        false,
        left(13),
        attachTo,
      );
      const input = wrapper.get('[data-testid="form-builder-add-from-file-input"]');
      (input.element as HTMLInputElement).focus();

      await input.setValue('Column 12');
      await input.trigger('keydown', { key: 'Enter' });

      expect(form.value!.fields.map((f) => f.key)).toEqual(['column_12']);
      expect(keyTouched.value).toEqual([true]);
      expect((input.element as HTMLInputElement).value).toBe('');
      expect(document.activeElement).toBe(input.element);

      await input.setValue('Column 12');
      expect(wrapper.find('[data-testid="form-builder-add-from-file-none"]').exists()).toBe(true);
      wrapper.unmount();
      attachTo.remove();
    });

    it('stays a field as the columns left to add fall to 12 and below', async () => {
      const taken = left(13).slice(0, 9);
      const { wrapper } = mountWithParent(
        { fields: taken.map((c, order) => question({ key: c.key, order })) },
        false,
        left(13),
      );
      expect(wrapper.find('select[data-testid="form-builder-add-from-file"]').exists()).toBe(false);
      const input = wrapper.get('[data-testid="form-builder-add-from-file-input"]');
      await input.trigger('click');
      expect(
        wrapper.findAll('[data-testid="form-builder-add-from-file-option"]').map((o) => o.text()),
      ).toEqual(['Column 9', 'Column 10', 'Column 11', 'Column 12']);
    });
  });

  it('leaves a question of no column as it always was', async () => {
    const { wrapper, form } = mountWithParent({ fields: [question({ key: 'shop' })] }, false, [
      STATUS,
    ]);

    await wrapper.get('[data-testid="form-field-type-select"]').setValue('select');

    expect(form.value!.fields[0].options).toEqual([]);
    expect(wrapper.find('[data-testid="form-field-options-from-file"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="form-field-use-file-options-button"]').exists()).toBe(false);
  });

  it('offers nothing from the file on a market not started from one, or a locked form', () => {
    const plain = mountWithParent({ fields: [] });
    expect(plain.wrapper.find('[data-testid="form-builder-add-from-file"]').exists()).toBe(false);
    const locked = mountWithParent({ fields: [] }, true, [STATUS]);
    expect(locked.wrapper.find('[data-testid="form-builder-add-from-file"]').exists()).toBe(false);
  });
});

describe('an option on a question from the file (T213)', () => {
  const COUNTED: ExampleColumn = {
    ...SELLS,
    answers: {
      select: ['Prints', 'Prints, Stickers', 'Stickers', 'Candles, Pins'],
      multiSelect: ['Prints', 'Stickers', 'Candles', 'Pins'],
    },
  };
  const sells = (patch: Partial<FormField> = {}) =>
    question({
      key: 'what_do_you_sell',
      label: 'What do you sell?',
      type: 'multi_select',
      options: [''],
      ...patch,
    });
  const COMBOBOX = '[data-testid="form-field-option"]';

  /** The rows the option at `at` lists when it is clicked with nothing typed. */
  async function listed(wrapper: ReturnType<typeof mount>, at = 0): Promise<string[]> {
    const input = wrapper.findAll('[data-testid="form-field-option-input"]')[at];
    await input.trigger('click');
    const rows = wrapper
      .findAll('[data-testid="form-field-option-option"]')
      .map((row) => row.attributes('data-value') as string);
    await input.trigger('blur');
    return rows;
  }

  it('draws a combobox, named as the plain input was, for a choice made from a column', () => {
    const { wrapper } = mountWithParent({ fields: [sells()] }, false, [COUNTED]);
    const input = wrapper.get('[data-testid="form-field-option-input"]');
    expect(input.attributes('role')).toBe('combobox');
    expect(input.attributes('placeholder')).toBe('Option 1');
    expect(wrapper.get(`${COMBOBOX} label`).text()).toBe('Option 1');
  });

  it('draws the plain input for a column with no answers for the type', () => {
    const bare = { ...SELLS, options: { select: [], multiSelect: [] } };
    const { wrapper } = mountWithParent({ fields: [sells()] }, false, [bare]);
    expect(wrapper.find(COMBOBOX).exists()).toBe(false);
    const input = wrapper.get('[data-testid="form-field-option-input"]');
    expect(input.attributes('role')).toBeUndefined();
    expect(input.attributes('aria-label')).toBe('Option 1');
  });

  it('draws the plain input for a question of no column', () => {
    const { wrapper } = mountWithParent({ fields: [sells({ key: 'shop' })] }, false, [COUNTED]);
    expect(wrapper.find(COMBOBOX).exists()).toBe(false);
    expect(wrapper.find('[data-testid="form-field-option-input"]').exists()).toBe(true);
  });

  it('draws the plain input, disabled, on a read-only form', () => {
    const { wrapper } = mountWithParent({ fields: [sells({ options: ['Prints'] })] }, true, [
      COUNTED,
    ]);
    expect(wrapper.find(COMBOBOX).exists()).toBe(false);
    const input = wrapper.get('[data-testid="form-field-option-input"]');
    expect(input.attributes('disabled')).toBeDefined();
    expect((input.element as HTMLInputElement).value).toBe('Prints');
  });

  it('keeps the combobox once no answer is left to offer, so no field changes under the caret', async () => {
    const { wrapper } = mountWithParent(
      { fields: [sells({ options: ['Prints', 'Stickers', 'Candles', ''] })] },
      false,
      [COUNTED],
    );
    const last = wrapper.findAll('[data-testid="form-field-option-input"]')[3];
    await last.setValue('Pins');
    await last.trigger('blur');
    expect(wrapper.findAll(COMBOBOX)).toHaveLength(4);
    expect(await listed(wrapper, 0)).toEqual(['Prints']);
  });

  it('lists every answer for the type but the other options, and follows the type', async () => {
    const { wrapper } = mountWithParent({ fields: [sells({ options: ['Stickers', ''] })] }, false, [
      COUNTED,
    ]);
    expect(await listed(wrapper, 1)).toEqual(['Prints', 'Candles', 'Pins']);
    expect(await listed(wrapper, 0)).toEqual(['Prints', 'Stickers', 'Candles', 'Pins']);

    await wrapper.get('[data-testid="form-field-type-select"]').setValue('select');
    expect(await listed(wrapper, 1)).toEqual(['Prints', 'Prints, Stickers', 'Candles, Pins']);
  });

  it('gives an answer back to the list when the option holding it is removed', async () => {
    const { wrapper } = mountWithParent({ fields: [sells({ options: ['Stickers', ''] })] }, false, [
      COUNTED,
    ]);
    await wrapper.findAll('[data-testid="form-field-remove-option-button"]')[0].trigger('click');
    expect(await listed(wrapper, 0)).toEqual(['Prints', 'Stickers', 'Candles', 'Pins']);
  });

  it('writes the words typed as the option, and a row chosen in their place', async () => {
    const { wrapper, form } = mountWithParent({ fields: [sells()] }, false, [COUNTED]);
    const input = wrapper.get('[data-testid="form-field-option-input"]');

    await input.setValue('Hand-made  soap ');
    expect(form.value!.fields[0].options).toEqual(['Hand-made  soap']);
    expect(applicationFormError(form.value)).toBeNull();

    await input.setValue('pin');
    const rows = wrapper.findAll('[data-testid="form-field-option-option"]');
    expect(rows.map((row) => row.attributes('data-value'))).toEqual(['pin', 'Pins']);
    await rows[1].trigger('click');
    expect(form.value!.fields[0].options).toEqual(['Pins']);
  });

  it('offers a question added from a column and retyped as a choice its answers', async () => {
    const left: ExampleColumn = {
      ...COUNTED,
      key: 'notes',
      label: 'Notes',
      type: 'text',
      question: false,
      options: { select: [], multiSelect: [] },
    };
    const { wrapper, form } = mountWithParent({ fields: [] }, false, [left]);
    await wrapper.get('[data-testid="form-builder-add-from-file"]').setValue('notes');
    await wrapper.get('[data-testid="form-field-type-select"]').setValue('multi_select');
    expect(form.value!.fields[0].options).toEqual([]);

    await wrapper.get('[data-testid="form-field-add-option-button"]').trigger('click');
    expect(await listed(wrapper)).toEqual(['Prints', 'Stickers', 'Candles', 'Pins']);
  });

  it('fills a type change and "Use the answers in your file" with the common answers only', async () => {
    const { wrapper, form } = mountWithParent(
      { fields: [question({ key: 'what_do_you_sell', type: 'checkbox' })] },
      false,
      [COUNTED],
    );
    await wrapper.get('[data-testid="form-field-type-select"]').setValue('multi_select');
    expect(form.value!.fields[0].options).toEqual(SELLS.options.multiSelect);

    await wrapper.findAll('[data-testid="form-field-option-input"]')[0].setValue('Soap');
    await wrapper.get('[data-testid="form-field-use-file-options-button"]').trigger('click');
    expect(form.value!.fields[0].options).toEqual(SELLS.options.multiSelect);
  });
});

describe('the Discord username question (E46/F01/S02)', () => {
  const ADD = '[data-testid="form-builder-add-discord-button"]';

  it('adds an optional text question for the Discord username in one click', async () => {
    const { wrapper, form, keyTouched } = mountWithParent({
      fields: [question({ key: 'shop' })],
    });

    await wrapper.get(ADD).trigger('click');

    expect(form.value!.fields[1]).toEqual({
      key: 'discord_username',
      label: 'Discord username',
      type: 'text',
      required: false,
      options: [],
      helpText: undefined,
      order: 1,
    });
    // A question like any other once added: relabelling it moves its key with it.
    expect(keyTouched.value).toEqual([true, false]);
  });

  it('is not offered once the form asks for a Discord username', async () => {
    const { wrapper } = mountWithParent({ fields: [] });

    await wrapper.get(ADD).trigger('click');

    expect(wrapper.find(ADD).exists()).toBe(false);
  });

  it('is not offered beside a text question of the organizer labelled for Discord', () => {
    const { wrapper } = mountWithParent({
      fields: [question({ key: 'handle', label: 'Your DISCORD handle', type: 'text' })],
    });

    expect(wrapper.find(ADD).exists()).toBe(false);
  });

  it('is still offered beside a Discord question that is not a text question', () => {
    const { wrapper } = mountWithParent({
      fields: [
        question({
          key: 'discord_username',
          label: 'On Discord?',
          type: 'select',
          options: ['Yes', 'No'],
        }),
      ],
    });

    expect(wrapper.find(ADD).exists()).toBe(true);
  });

  it('takes a key no other question has', async () => {
    const { wrapper, form } = mountWithParent({
      fields: [
        question({
          key: 'discord_username',
          label: 'On Discord?',
          type: 'select',
          options: ['Yes', 'No'],
        }),
      ],
    });

    await wrapper.get(ADD).trigger('click');

    expect(form.value!.fields.map((field) => field.key)).toEqual([
      'discord_username',
      'discord_username_2',
    ]);
  });

  it('is not offered on a locked form', () => {
    const { wrapper } = mountWithParent({ fields: [] }, true);

    expect(wrapper.find(ADD).exists()).toBe(false);
  });
});

describe('a question whose options fold past 20 (T223)', () => {
  const FOLD = '[data-testid="form-field-options-fold"]';
  const INPUT = '[data-testid="form-field-option-input"]';
  const ADD = '[data-testid="form-field-add-option-button"]';
  const REMOVE = '[data-testid="form-field-remove-option-button"]';
  const scrollIntoView = vi.fn();

  const named = (count: number) => Array.from({ length: count }, (_, at) => `Answer ${at + 1}`);
  const asked = (count: number): FormField =>
    question({ key: 'sells', label: 'What do you sell?', type: 'select', options: named(count) });
  /** The question's column: every option is its own answer, and two more no option holds yet. */
  const columnOf = (count: number): ExampleColumn => ({
    ...SELLS,
    key: 'sells',
    options: { select: named(count), multiSelect: named(count) },
    answers: { select: named(count + 2), multiSelect: named(count + 2) },
  });
  const drawn = (wrapper: ReturnType<typeof mount>) =>
    wrapper.findAll(INPUT).map((input) => (input.element as HTMLInputElement).value);

  beforeEach(() => {
    scrollIntoView.mockClear();
    Element.prototype.scrollIntoView = scrollIntoView;
  });

  afterEach(() => {
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    document.body.innerHTML = '';
  });

  it('draws every option and no button at 20 or fewer', () => {
    const { wrapper } = mountWithParent({ fields: [asked(20)] });

    expect(drawn(wrapper)).toEqual(named(20));
    expect(wrapper.find(FOLD).exists()).toBe(false);
  });

  it('stops at 20 past that, and unfolds in place, then folds again', async () => {
    const { wrapper, form } = mountWithParent({ fields: [asked(230)] });

    expect(drawn(wrapper)).toEqual(named(20));
    expect(wrapper.get(FOLD).text()).toContain('Show all 230 options');

    await wrapper.get(FOLD).trigger('click');
    expect(drawn(wrapper)).toEqual(named(230));
    expect(wrapper.get(FOLD).text()).toContain('Show fewer');

    await wrapper.get(FOLD).trigger('click');
    expect(drawn(wrapper)).toEqual(named(20));
    // Folding hides rows and changes nothing the question holds.
    expect(form.value!.fields[0].options).toEqual(named(230));
  });

  it('says which question it folds to a reader, since a form can have several', () => {
    const { wrapper } = mountWithParent({ fields: [asked(21)] });

    expect(wrapper.get(`${FOLD} .visually-hidden`).text()).toBe('for What do you sell?');
  });

  it('folds on a locked form too, its rows read only and its button still working', async () => {
    const { wrapper } = mountWithParent({ fields: [asked(25)] }, true);

    expect(drawn(wrapper)).toEqual(named(20));
    expect(
      wrapper.findAll(INPUT).every((input) => input.attributes('disabled') !== undefined),
    ).toBe(true);
    expect(wrapper.find(ADD).exists()).toBe(false);

    await wrapper.get(FOLD).trigger('click');
    expect(drawn(wrapper)).toEqual(named(25));
    await wrapper.get(FOLD).trigger('click');
    expect(drawn(wrapper)).toEqual(named(20));
  });

  it('hands the focus to the first new row, and brings the button back into view', async () => {
    const { wrapper } = mountWithParent({ fields: [asked(25)] }, false, undefined, document.body);

    const fold = wrapper.get(FOLD);
    await fold.trigger('click');
    await nextTick();
    const rows = wrapper.findAll('.option-row');
    expect(document.activeElement).toBe(rows[20].element);
    expect(rows[20].attributes('tabindex')).toBe('-1');
    expect(rows[19].attributes('tabindex')).toBeUndefined();
    expect(rows[21].attributes('tabindex')).toBeUndefined();

    (fold.element as HTMLButtonElement).focus();
    await fold.trigger('click');
    await nextTick();
    expect(document.activeElement).toBe(fold.element);
    expect(scrollIntoView.mock.contexts).toEqual([fold.element]);
    wrapper.unmount();
  });

  it('unfolds for "Add option" and brings the new row into view', async () => {
    const { wrapper, form } = mountWithParent({ fields: [asked(230)] });

    await wrapper.get(ADD).trigger('click');
    await nextTick();

    expect(form.value!.fields[0].options).toEqual([...named(230), '']);
    expect(drawn(wrapper)).toEqual([...named(230), '']);
    expect(wrapper.get(FOLD).text()).toContain('Show fewer');
    expect(scrollIntoView.mock.contexts).toEqual([wrapper.findAll('.option-row')[230].element]);
  });

  it('unfolds for the 21st option, so a new row never lands behind the fold', async () => {
    const { wrapper } = mountWithParent({ fields: [asked(20)] });

    await wrapper.get(ADD).trigger('click');
    await nextTick();

    expect(drawn(wrapper)).toEqual([...named(20), '']);
    expect(wrapper.get(FOLD).text()).toContain('Show fewer');
  });

  it('moves nothing for an option added above the fold or on an unfolded question', async () => {
    const { wrapper } = mountWithParent({ fields: [asked(5)] });
    await wrapper.get(ADD).trigger('click');
    await nextTick();
    expect(drawn(wrapper)).toEqual([...named(5), '']);
    expect(wrapper.find(FOLD).exists()).toBe(false);

    const unfolded = mountWithParent({ fields: [asked(25)] }).wrapper;
    await unfolded.get(FOLD).trigger('click');
    scrollIntoView.mockClear();
    await unfolded.get(ADD).trigger('click');
    await nextTick();
    expect(drawn(unfolded)).toEqual([...named(25), '']);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('keeps the fold when a row is removed, folded or unfolded', async () => {
    const { wrapper, form } = mountWithParent({ fields: [asked(25)] });

    await wrapper.findAll(REMOVE)[2].trigger('click');
    expect(form.value!.fields[0].options).toEqual(named(25).filter((_, at) => at !== 2));
    expect(drawn(wrapper)).toEqual(form.value!.fields[0].options.slice(0, 20));
    expect(wrapper.get(FOLD).text()).toContain('Show all 24 options');

    await wrapper.get(FOLD).trigger('click');
    await wrapper.findAll(REMOVE)[22].trigger('click');
    expect(drawn(wrapper)).toEqual(form.value!.fields[0].options);
    expect(form.value!.fields[0].options).toHaveLength(23);
    expect(wrapper.get(FOLD).text()).toContain('Show fewer');
  });

  it('draws no button once removing leaves 20, and every row stays', async () => {
    const { wrapper } = mountWithParent({ fields: [asked(21)] });

    await wrapper.findAll(REMOVE)[0].trigger('click');

    expect(drawn(wrapper)).toEqual(named(21).slice(1));
    expect(wrapper.find(FOLD).exists()).toBe(false);
  });

  it('acts on the right option past row 20: its value, its name and its Remove', async () => {
    const { wrapper, form } = mountWithParent({ fields: [asked(30)] });
    await wrapper.get(FOLD).trigger('click');
    const inputs = wrapper.findAll(INPUT);

    expect(inputs[24].attributes('aria-label')).toBe('Option 25');
    await inputs[24].setValue('Twenty-five, edited');
    expect(form.value!.fields[0].options[24]).toBe('Twenty-five, edited');
    expect(form.value!.fields[0].options[23]).toBe('Answer 24');

    const remove = wrapper.findAll(REMOVE)[27];
    expect(remove.attributes('aria-label')).toBe('Remove option 28');
    await remove.trigger('click');
    expect(form.value!.fields[0].options).toHaveLength(29);
    expect(form.value!.fields[0].options).not.toContain('Answer 28');
    expect(form.value!.fields[0].options[27]).toBe('Answer 29');
  });

  it('offers a row past 20 its own answer and those no option holds, and takes one', async () => {
    const field = { ...asked(30), key: 'sells', type: 'multi_select' };
    const { wrapper, form } = mountWithParent({ fields: [field] }, false, [columnOf(30)]);
    await wrapper.get(FOLD).trigger('click');

    const input = wrapper.findAll(INPUT)[24];
    await input.trigger('click');
    const rows = wrapper.findAll('[data-testid="form-field-option-option"]');
    expect(rows.map((row) => row.attributes('data-value'))).toEqual([
      'Answer 25',
      'Answer 31',
      'Answer 32',
    ]);

    await rows[2].trigger('mousedown');
    await rows[2].trigger('click');
    expect(form.value!.fields[0].options[24]).toBe('Answer 32');
    expect(form.value!.fields[0].options[23]).toBe('Answer 24');
    expect(form.value!.fields[0].options[25]).toBe('Answer 26');
  });

  it('fills from the file and says so, folded or unfolded', async () => {
    const field = { ...asked(30), key: 'sells', type: 'multi_select' };
    const column = columnOf(30);
    const { wrapper, form } = mountWithParent({ fields: [field] }, false, [column]);
    const NOTE = '[data-testid="form-field-options-from-file"]';
    const USE = '[data-testid="form-field-use-file-options-button"]';
    expect(wrapper.get(NOTE).text()).toContain('Filled from the answers in your file');
    expect(drawn(wrapper)).toEqual(named(20));

    // Edited past the fold, the note goes; folded again, the way back still works.
    await wrapper.get(FOLD).trigger('click');
    await wrapper.findAll(INPUT)[25].setValue('Words the file never held');
    expect(wrapper.find(NOTE).exists()).toBe(false);
    await wrapper.get(FOLD).trigger('click');
    expect(drawn(wrapper)).toEqual(named(20));

    await wrapper.get(USE).trigger('click');
    expect(form.value!.fields[0].options).toEqual(named(30));
    expect(wrapper.get(NOTE).text()).toContain('Filled from the answers in your file');
    expect(drawn(wrapper)).toEqual(named(20));

    // And unfolded, it stays as the reader left it.
    await wrapper.findAll(REMOVE)[0].trigger('click');
    await wrapper.get(FOLD).trigger('click');
    await wrapper.get(USE).trigger('click');
    expect(drawn(wrapper)).toEqual(named(30));
  });
});
