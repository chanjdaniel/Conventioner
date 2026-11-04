import { describe, it, expect, vi, afterEach } from 'vitest';
import { defineComponent, h, ref } from 'vue';
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

  const wrapper = mount(Parent);

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
    expect(wrapper.get('label[for="form-builder-add-from-file"]').text()).toBe(
      'Add from your file',
    );

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
