import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';

import MarketSetupView from '@/views/MarketSetupView.vue';
import PhaseRail from '@/components/PhaseRail.vue';
import ElementMarketDates from '@/components/elements/ElementMarketDates.vue';

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  // The open tab lives in the URL now (E10/F03/S01).
  useRoute: () => ({ query: {} }),
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

function storePlannedMarket() {
  localStorage.setItem(
    'market',
    JSON.stringify({
      id: 'market-1',
      name: 'Riverside Spring',
      phase: 'draft',
      setupObject: PLANNED_SETUP,
      applicationForm: null,
    }),
  );
}

beforeEach(() => {
  localStorage.clear();
  api.get.mockReset();
  api.put.mockReset();
});

/**
 * Advance the phase, then make the view SAVE, and report what it sent.
 *
 * Asserting on local storage alone would be vacuous: the old handler never wrote there, so the
 * untouched original still carried the options and the assertion passed while the defect stood.
 * What the next save sends is the thing that actually reaches the server.
 *
 * The save used to be the wizard's Next button. The plan is one page now (E10/F02/S01), so it is
 * a plan edit that saves - debounced, hence the timers.
 */
async function savedPayloadAfterAdvancing() {
  vi.useFakeTimers();
  // The setting container has to render its slots, or the plan's editors never mount and there is
  // nothing to emit an edit from.
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
  wrapper.findComponent(PhaseRail).vm.$emit('phase-advanced', SERVER_MARKET_AFTER_TRANSITION);
  await wrapper.vm.$nextTick();

  api.put.mockClear();
  // Any plan edit; the payload is what matters, not which field moved.
  wrapper.findComponent(ElementMarketDates).vm.$emit('update:setupObject', PLANNED_SETUP);
  await wrapper.vm.$nextTick();
  await vi.advanceTimersByTimeAsync(1000);
  vi.useRealTimers();

  expect(api.put).toHaveBeenCalled();
  return api.put.mock.calls[0][1];
}

describe('advancing a phase does not discard the organizer\u2019s unsaved plan', () => {
  it('the next save still carries the assignment options the organizer typed', async () => {
    storePlannedMarket();

    const saved = await savedPayloadAfterAdvancing();

    expect(saved.setupObject.assignmentOptions).toEqual({
      maxAssignmentsPerVendor: 2,
      maxHalfTableProportionPerSection: 100,
    });
  });

  it('the next save still carries the tiers and sections that were planned', async () => {
    storePlannedMarket();

    const saved = await savedPayloadAfterAdvancing();

    expect(saved.setupObject.sections).toHaveLength(1);
    expect(saved.setupObject.tiers[0].name).toBe('Gold');
  });

  it('still takes the new phase from the server, which is what the transition decided', async () => {
    storePlannedMarket();
    const wrapper = mount(MarketSetupView, { shallow: true });

    wrapper.findComponent(PhaseRail).vm.$emit('phase-advanced', SERVER_MARKET_AFTER_TRANSITION);
    await wrapper.vm.$nextTick();

    const stored = JSON.parse(localStorage.getItem('market') ?? '{}');
    expect(stored.phase).toBe('applications_open');
    expect(stored.isDraft).toBe(false);
  });
});
