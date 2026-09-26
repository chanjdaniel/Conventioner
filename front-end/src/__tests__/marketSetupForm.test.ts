import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import MarketSetupView from '@/views/MarketSetupView.vue';
import FormBuilder from '@/components/application/FormBuilder.vue';
import type { ApplicationForm } from '@/assets/types/datatypes';
import { MARKET_ID, marketRoute, serveMarket } from './support/marketScreen';
import { useMarketStore } from '@/stores/market';

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
/**
 * What the application-form endpoint answers. The market itself is served by `GET /markets/:id`
 * (the store fetches it, E21/F02/S02); every other read goes here, so a test can still make the
 * form's own load hang or answer.
 */
const formApi = vi.hoisted(() => vi.fn());

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  // The market's id and the open tab both live in the URL (E10/F03/S01, E21/F02/S02).
  useRoute: () => marketRoute(),
}));

vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  return { ...actual, api };
});

const EMPTY_SETUP_OBJECT = {
  priority: [],
  marketDates: [],
  tiers: [],
  locations: [],
  sections: [],
  assignmentOptions: {},
};

/**
 * Serve the market, and with it the form's lock: it rides on the market every screen reads, which
 * the store re-reads after every write (E21/F02/S03). `null` is an editable form.
 */
function storeMarket(applicationForm: ApplicationForm | null, lockReason: string | null = null) {
  serveMarket(
    api.get,
    {
      id: MARKET_ID,
      name: 'Riverside',
      setupObject: EMPTY_SETUP_OBJECT,
      applicationForm,
      applicationFormLockReason: lockReason,
    },
    (url) => formApi(url),
  );
}

function formWith(key: string, label: string): ApplicationForm {
  return {
    fields: [{ key, label, type: 'text', required: false, options: [], order: 0 }],
  };
}

/**
 * Mount the view on its Application Form tab with every child component stubbed, except the two
 * that have to render for the builder to be reachable: the form tab, which owns the form since
 * E18/F02/S01, and the setting container, which renders the slot the builder lives in.
 */
async function mountOnFormTab() {
  const wrapper = mount(MarketSetupView, {
    shallow: true,
    global: {
      stubs: {
        // The frame renders the bar and the tabs' content in its slots (E21/F04/S01).
        MarketFrame: false,
        MarketFormTab: false,
        ElementSettingContainer: {
          template: '<div><slot name="setting-title" /><slot name="setting-content" /></div>',
        },
      },
    },
  });
  // The store fetches the market first; the tab bar exists once it has arrived.
  await vi.waitFor(() => wrapper.get('[data-testid="market-setup-form-tab"]'));
  await wrapper.get('[data-testid="market-setup-form-tab"]').trigger('click');
  return wrapper;
}

const builderOf = (wrapper: ReturnType<typeof mount>) => wrapper.findComponent(FormBuilder);

beforeEach(() => {
  setActivePinia(createPinia());
  formApi.mockReset();
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
    formApi.mockReturnValue(
      new Promise((resolve) => {
        resolveGet = resolve;
      }),
    );

    const wrapper = await mountOnFormTab();

    // The load is still in flight: the form is not *known* to be editable yet.
    expect(builderOf(wrapper).props('readonly')).toBe(true);
    expect(wrapper.find('[data-testid="form-builder-save-button"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="form-builder-loading"]').exists()).toBe(true);

    resolveGet({ data: { application_form: formWith('shop_name', 'Shop') } });
    await flushPromises();

    expect(builderOf(wrapper).props('readonly')).toBe(false);
    expect(wrapper.find('[data-testid="form-builder-save-button"]').exists()).toBe(true);
  });

  it('never offers to edit a locked form, even for an instant', async () => {
    storeMarket(formWith('shop_name', 'Shop'), 'Applications have been submitted.');
    formApi.mockResolvedValue({ data: { application_form: formWith('shop_name', 'Shop') } });

    const wrapper = await mountOnFormTab();
    expect(builderOf(wrapper).props('readonly')).toBe(true);

    await flushPromises();

    expect(builderOf(wrapper).props('readonly')).toBe(true);
    expect(wrapper.get('[data-testid="form-builder-lock-banner"]').text()).toContain(
      'Applications have been submitted.',
    );
  });

  /**
   * The reported bug (the-market-frame ticket 02): open applications from the rail and Add field
   * stayed live; reopen and the lock notice named a phase the rail contradicted - until the
   * organizer changed tabs. The lock is on the market now, so a re-read is all it takes.
   */
  it('follows the lock the moment the market changes, without leaving the tab', async () => {
    storeMarket(formWith('shop_name', 'Shop'));
    formApi.mockResolvedValue({ data: { application_form: formWith('shop_name', 'Shop') } });
    const wrapper = await mountOnFormTab();
    await flushPromises();
    expect(builderOf(wrapper).props('readonly')).toBe(false);

    // Applications open: the rail's transition makes the store re-read the market.
    storeMarket(formWith('shop_name', 'Shop'), 'Only while the market is in draft phase.');
    await useMarketStore().refresh();
    await flushPromises();
    expect(builderOf(wrapper).props('readonly')).toBe(true);
    expect(wrapper.get('[data-testid="form-builder-lock-banner"]').text()).toContain(
      'Only while the market is in draft phase.',
    );

    // Reopened: editable again, and no notice left over from the phase before.
    storeMarket(formWith('shop_name', 'Shop'));
    await useMarketStore().refresh();
    await flushPromises();
    expect(builderOf(wrapper).props('readonly')).toBe(false);
    expect(wrapper.find('[data-testid="form-builder-lock-banner"]').exists()).toBe(false);
  });

  it('does not reclassify an auto-derived key as hand-edited when the form is saved', async () => {
    storeMarket(null);
    formApi.mockResolvedValue({ data: { application_form: null } });

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
    formApi.mockResolvedValue({ data: { application_form: form } });
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
    formApi.mockResolvedValue({
      data: { application_form: formWith('shop_name', 'Shop') },
    });

    const wrapper = await mountOnFormTab();
    await flushPromises();

    expect(builderOf(wrapper).props('keyTouched')).toEqual([true]);
  });
});
