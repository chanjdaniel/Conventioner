import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { AxiosError } from 'axios';

import AmendFormDialog from '@/components/application/AmendFormDialog.vue';
import { MARKET_CHANGED_CODE } from '@/utils/api';
import { EMPTY_ESSENTIAL_OPTIONS } from '@/utils/essentialFields';

const api = vi.hoisted(() => ({ put: vi.fn() }));
vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  return { ...actual, api };
});

const SENTENCE =
  'This market changed while you were working on it, so your change was not saved. ' +
  'Reload to see the latest, then make your change again.';
const SHOP = {
  key: 'shop_name',
  label: 'Shop',
  type: 'text',
  required: false,
  options: [],
  order: 0,
};

beforeEach(() => {
  api.put.mockReset();
});

describe('AmendFormDialog', () => {
  it('refuses a key the import reads as something else before anything is sent (E38/F02)', async () => {
    const wrapper = mount(AmendFormDialog, {
      props: {
        open: true,
        marketId: 'market-1',
        applicationForm: { fields: [] },
        formRevision: 0,
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
        formRevision: 0,
        essentialOptions: EMPTY_ESSENTIAL_OPTIONS,
        intakeIsForm: false,
      },
      global: { stubs: { teleport: true } },
    });
    await wrapper.vm.$nextTick();

    const toggle = wrapper.get('[data-testid="amend-form-unask-essential_request"]');
    expect(toggle.text()).toBe('Stop asking Anything else you need from us?');
  });

  /** Mounted to add a question for a column with nowhere to go, then saved. */
  async function saveANewQuestion() {
    const wrapper = mount(AmendFormDialog, {
      props: {
        open: true,
        marketId: 'market-1',
        applicationForm: { fields: [SHOP] },
        formRevision: 3,
        essentialOptions: EMPTY_ESSENTIAL_OPTIONS,
        suggestedFieldLabel: 'Website',
      },
      global: { stubs: { teleport: true } },
    });
    await wrapper.vm.$nextTick();
    await wrapper.get('[data-testid="amend-form-submit-button"]').trigger('submit');
    await flushPromises();
    return wrapper;
  }

  it('sends the revision of the form it read with its save (ADR 0024)', async () => {
    api.put.mockResolvedValue({ data: { application_form: { fields: [SHOP] }, formRevision: 4 } });

    const wrapper = await saveANewQuestion();

    expect(api.put).toHaveBeenCalledTimes(1);
    const [url, body] = api.put.mock.calls[0]!;
    expect(url).toBe('/markets/market-1/application-form');
    expect(body.formRevision).toBe(3);
    expect(body.fields.map((f: { key: string }) => f.key)).toEqual(['shop_name', 'website']);
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('a save refused as the market changed says so, stays open and asks for the form again', async () => {
    api.put.mockRejectedValue(
      Object.assign(new AxiosError('refused'), {
        response: { status: 409, data: { error: SENTENCE, code: MARKET_CHANGED_CODE } },
      }),
    );

    const wrapper = await saveANewQuestion();

    expect(wrapper.get('[data-testid="amend-form-error"]').text()).toBe(SENTENCE);
    expect(wrapper.emitted('changed')).toHaveLength(1);
    expect(wrapper.emitted('close')).toBeUndefined();
    expect(wrapper.emitted('amended')).toBeUndefined();
  });
});
