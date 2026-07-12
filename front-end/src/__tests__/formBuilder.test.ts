import { describe, it, expect, vi, afterEach } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { mount } from '@vue/test-utils';

import FormBuilder from '@/components/application/FormBuilder.vue';
import type { ApplicationForm } from '@/assets/types/datatypes';

/**
 * Mirrors how MarketSetupView owns the form and the hand-edited-key flags: child emits, parent
 * re-feeds them as props. `mounted` mirrors the `v-if` on the Application Form tab, so a test can
 * tab away and back and see whether state that must outlive the builder actually does.
 */
function mountWithParent(initial: ApplicationForm | null, readonly = false) {
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
      fields: [
        { key: 'shop', label: 'Shop', type: 'text', required: true, options: [], order: 0 },
      ],
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
