import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

import MarketSetupView from '@/views/MarketSetupView.vue';
import FormBuilder from '@/components/application/FormBuilder.vue';
import type { ApplicationForm } from '@/assets/types/datatypes';

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  return { ...actual, api };
});

const EMPTY_SETUP_OBJECT = {
  colNames: [],
  colValues: [],
  colInclude: [],
  enumPriorityOrder: [],
  priority: [],
  marketDates: [],
  tiers: [],
  locations: [],
  sections: [],
  assignmentOptions: {},
};

function storeMarket(applicationForm: ApplicationForm | null) {
  localStorage.setItem(
    'market',
    JSON.stringify({ id: 'market-1', setupObject: EMPTY_SETUP_OBJECT, applicationForm }),
  );
}

function formWith(key: string, label: string): ApplicationForm {
  return {
    fields: [{ key, label, type: 'text', required: false, options: [], order: 0 }],
  };
}

/**
 * Mount the view on its Application Form tab with every child component stubbed, except that the
 * setting container still renders its slots - the form builder lives in one.
 */
async function mountOnFormTab() {
  const wrapper = mount(MarketSetupView, {
    shallow: true,
    global: {
      stubs: {
        ElementSettingContainer: {
          template: '<div><slot name="setting-title" /><slot name="setting-content" /></div>',
        },
      },
    },
  });
  await wrapper.get('[data-testid="market-setup-form-tab"]').trigger('click');
  return wrapper;
}

const builderOf = (wrapper: ReturnType<typeof mount>) => wrapper.findComponent(FormBuilder);

beforeEach(() => {
  localStorage.clear();
  api.get.mockReset();
  api.put.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('MarketSetupView application form', () => {
  it('keeps the builder read-only until the server has reported the lock state', async () => {
    storeMarket(formWith('shop_name', 'Shop'));
    let resolveGet: (value: unknown) => void = () => {};
    api.get.mockReturnValue(
      new Promise((resolve) => {
        resolveGet = resolve;
      }),
    );

    const wrapper = await mountOnFormTab();

    // The load is still in flight: the form is not *known* to be editable yet.
    expect(builderOf(wrapper).props('readonly')).toBe(true);
    expect(wrapper.find('[data-testid="form-builder-save-button"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="form-builder-loading"]').exists()).toBe(true);

    resolveGet({ data: { application_form: formWith('shop_name', 'Shop'), lock_reason: null } });
    await flushPromises();

    expect(builderOf(wrapper).props('readonly')).toBe(false);
    expect(wrapper.find('[data-testid="form-builder-save-button"]').exists()).toBe(true);
  });

  it('never offers to edit a locked form, even for an instant', async () => {
    storeMarket(formWith('shop_name', 'Shop'));
    api.get.mockResolvedValue({
      data: {
        application_form: formWith('shop_name', 'Shop'),
        lock_reason: 'Applications have been submitted.',
      },
    });

    const wrapper = await mountOnFormTab();
    expect(builderOf(wrapper).props('readonly')).toBe(true);

    await flushPromises();

    expect(builderOf(wrapper).props('readonly')).toBe(true);
    expect(wrapper.get('[data-testid="form-builder-lock-banner"]').text()).toContain(
      'Applications have been submitted.',
    );
  });

  it('does not reclassify an auto-derived key as hand-edited when the form is saved', async () => {
    storeMarket(null);
    api.get.mockResolvedValue({ data: { application_form: null, lock_reason: null } });

    const wrapper = await mountOnFormTab();
    await flushPromises();

    // The organizer adds a field and lets its key derive from a mistyped label.
    const typo = formWith('bsuiness_name', 'Bsuiness Name');
    builderOf(wrapper).vm.$emit('update:keyTouched', [false]);
    builderOf(wrapper).vm.$emit('update:applicationForm', typo);
    await flushPromises();

    api.put.mockResolvedValue({ data: { application_form: typo } });
    await wrapper.get('[data-testid="form-builder-save-button"]').trigger('click');
    await flushPromises();

    expect(api.put).toHaveBeenCalledTimes(1);
    // Saving is not the organizer typing the key: the key must still track the label.
    expect(builderOf(wrapper).props('keyTouched')).toEqual([false]);
  });

  it('keeps the confirmation up for a full 2s after a save that closely follows another', async () => {
    vi.useFakeTimers();
    const form = formWith('shop_name', 'Shop');
    storeMarket(form);
    api.get.mockResolvedValue({ data: { application_form: form, lock_reason: null } });
    api.put.mockResolvedValue({ data: { application_form: form } });

    const wrapper = await mountOnFormTab();
    await flushPromises();

    const saved = () => wrapper.find('[data-testid="form-builder-save-success"]').exists();
    const save = async () => {
      await wrapper.get('[data-testid="form-builder-save-button"]').trigger('click');
      await flushPromises();
    };

    await save();
    expect(saved()).toBe(true);

    // A second save lands before the first save's reset timer would have fired.
    vi.advanceTimersByTime(1500);
    await save();
    expect(saved()).toBe(true);

    // The first save's stale timer must not blank the second save's confirmation.
    vi.advanceTimersByTime(900);
    await flushPromises();
    expect(saved()).toBe(true);

    // The second save's own timer still clears it on schedule.
    vi.advanceTimersByTime(1100);
    await flushPromises();
    expect(saved()).toBe(false);
  });

  it('treats every key of a form loaded from the server as the organizer own', async () => {
    storeMarket(null);
    api.get.mockResolvedValue({
      data: { application_form: formWith('shop_name', 'Shop'), lock_reason: null },
    });

    const wrapper = await mountOnFormTab();
    await flushPromises();

    expect(builderOf(wrapper).props('keyTouched')).toEqual([true]);
  });
});
