import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';

import MarketSetupView from '@/views/MarketSetupView.vue';
import PhaseControlPanel from '@/components/PhaseControlPanel.vue';

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
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
 */
async function savedPayloadAfterAdvancing() {
  const wrapper = mount(MarketSetupView, { shallow: true });
  wrapper
    .findComponent(PhaseControlPanel)
    .vm.$emit('phase-advanced', SERVER_MARKET_AFTER_TRANSITION);
  await wrapper.vm.$nextTick();

  api.put.mockClear();
  await wrapper.get('[data-testid="market-setup-next-button"]').trigger('click');
  await wrapper.vm.$nextTick();

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

    wrapper
      .findComponent(PhaseControlPanel)
      .vm.$emit('phase-advanced', SERVER_MARKET_AFTER_TRANSITION);
    await wrapper.vm.$nextTick();

    const stored = JSON.parse(localStorage.getItem('market') ?? '{}');
    expect(stored.phase).toBe('applications_open');
    expect(stored.isDraft).toBe(false);
  });
});
