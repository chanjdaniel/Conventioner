import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';

import AmendFormDialog from '@/components/application/AmendFormDialog.vue';
import { EMPTY_ESSENTIAL_OPTIONS } from '@/utils/essentialFields';

describe('AmendFormDialog', () => {
  it('refuses a key the import reads as something else before anything is sent (E38/F02)', async () => {
    const wrapper = mount(AmendFormDialog, {
      props: {
        open: true,
        marketId: 'market-1',
        applicationForm: { fields: [] },
        essentialOptions: EMPTY_ESSENTIAL_OPTIONS,
        suggestedFieldLabel: 'Submitted at',
        intakeIsForm: false,
      },
      global: { stubs: { teleport: true } },
    });
    await wrapper.vm.$nextTick();

    expect(
      (wrapper.get('[data-testid="amend-form-key-input"]').element as HTMLInputElement).value,
    ).toBe('submitted_at');
    expect(wrapper.get('[data-testid="amend-form-key-error"]').text()).toBe(
      'Key "submitted_at" is reserved: the import reads that column as when they applied. Choose another key.',
    );
    // The error grows the dialog as a key is typed, so its top is held rather than its centre.
    expect(wrapper.get('.dialog-container').classes()).toContain('dialog-container--anchored');
  });

  it('names each question it can stop asking, never its key', async () => {
    const wrapper = mount(AmendFormDialog, {
      props: {
        open: true,
        marketId: 'market-1',
        applicationForm: { fields: [] },
        essentialOptions: EMPTY_ESSENTIAL_OPTIONS,
        intakeIsForm: false,
      },
      global: { stubs: { teleport: true } },
    });
    await wrapper.vm.$nextTick();

    const toggle = wrapper.get('[data-testid="amend-form-unask-essential_request"]');
    expect(toggle.text()).toBe('Stop asking Anything else you need from us?');
  });
});
