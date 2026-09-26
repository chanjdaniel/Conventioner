import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import MarketSetupView from '@/views/MarketSetupView.vue';
import PhaseRail from '@/components/PhaseRail.vue';
import ElementMarketDates from '@/components/elements/ElementMarketDates.vue';
import { marketRoute, serveMarket } from './support/marketScreen';
import { useMarketStore } from '@/stores/market';

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  // The market's id and the open tab both live in the URL (E10/F03/S01, E21/F02/S02).
  useRoute: () => marketRoute(),
}));
vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  return { ...actual, api };
});

/**
 * The organizer's plan, with the two assignment options filled in - the edits that live on the
 * wizard's last page, which has no Next to save them.
 */
const PLANNED_SETUP = {
  priority: [],
  marketDates: [{ date: '2026-08-01' }],
  tiers: [{ id: 0, name: 'Gold' }],
  locations: [{ name: 'Main Hall' }],
  sections: [{ name: 'Riverside', count: 2 }],
  assignmentOptions: { maxAssignmentsPerVendor: 2, maxHalfTableProportionPerSection: 100 },
};

/** What the transition endpoint hands back: the market as last SAVED, with the new phase. */
const SERVER_MARKET_AFTER_TRANSITION = {
  id: 'market-1',
  name: 'Riverside Spring',
  phase: 'applications_open',
  isDraft: false,
  setupObject: {
    priority: [],
    marketDates: [{ date: '2026-08-01' }],
    tiers: [{ id: 0, name: 'Gold' }],
    locations: [{ name: 'Main Hall' }],
    sections: [{ name: 'Riverside', count: 2 }],
    assignmentOptions: {},
  },
};

/** The market as last SAVED, before the transition: the options the organizer typed are not in it. */
const SAVED_DRAFT = {
  ...SERVER_MARKET_AFTER_TRANSITION,
  phase: 'draft',
  isDraft: true,
};

beforeEach(() => {
  setActivePinia(createPinia());
  api.get.mockReset();
  api.put.mockReset();
  api.put.mockResolvedValue({ data: {} });
  serveMarket(api.get, SAVED_DRAFT);
});

afterEach(() => {
  vi.useRealTimers();
});

async function mountThePlan() {
  vi.useFakeTimers();
  // The plan tab owns the cards since E18/F02/S01, and the setting container renders the slot
  // each editor lives in - both have to be real or there is nothing to emit an edit from.
  const wrapper = mount(MarketSetupView, {
    shallow: true,
    global: {
      stubs: {
        MarketPlanTab: false,
        ElementSettingContainer: {
          template: '<div><slot name="setting-title" /><slot name="setting-content" /></div>',
        },
      },
    },
  });
  await vi.advanceTimersByTimeAsync(0);
  return wrapper;
}

/**
 * Type into the plan, advance the phase before the autosave fires, and report what the save sent.
 *
 * The transition is a write, so the store re-reads the market - and the server's copy carries the
 * plan as last SAVED, without what was just typed. The plan is the organizer's working copy, which
 * a re-read never touches (E21/F02/S02); it used to be spliced back over the server's copy by hand.
 */
async function savedPayloadAfterAdvancing() {
  const wrapper = await mountThePlan();

  wrapper.findComponent(ElementMarketDates).vm.$emit('update:setupObject', PLANNED_SETUP);
  await wrapper.vm.$nextTick();

  serveMarket(api.get, SERVER_MARKET_AFTER_TRANSITION);
  await useMarketStore().refresh();
  await vi.advanceTimersByTimeAsync(0);

  await vi.advanceTimersByTimeAsync(1000);
  expect(api.put).toHaveBeenCalled();
  return { wrapper, saved: api.put.mock.calls[0][1] };
}

describe('advancing a phase does not discard the organizer\u2019s unsaved plan', () => {
  it('the next save still carries the assignment options the organizer typed', async () => {
    const { saved } = await savedPayloadAfterAdvancing();

    expect(saved.setupObject.assignmentOptions).toEqual({
      maxAssignmentsPerVendor: 2,
      maxHalfTableProportionPerSection: 100,
    });
  });

  it('the next save still carries the tiers and sections that were planned', async () => {
    const { saved } = await savedPayloadAfterAdvancing();

    expect(saved.setupObject.sections).toHaveLength(1);
    expect(saved.setupObject.tiers[0].name).toBe('Gold');
  });

  it('still takes the new phase from the server, which is what the transition decided', async () => {
    const wrapper = await mountThePlan();

    // The rail re-reads the store once a transition lands; what the screen shows is what it got.
    serveMarket(api.get, SERVER_MARKET_AFTER_TRANSITION);
    await useMarketStore().refresh();
    await vi.advanceTimersByTimeAsync(0);

    expect(wrapper.findComponent(PhaseRail).props('market')?.phase).toBe('applications_open');
  });
});
