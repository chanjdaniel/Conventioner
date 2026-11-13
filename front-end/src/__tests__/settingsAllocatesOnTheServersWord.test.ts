/**
 * Settings' Allocate tables reads where a run may happen from the server alone (T316).
 *
 * The server alone says whether a run may happen (the served `assignRefusalReason`, which also
 * refuses a run once results are published), so the button reads the person's answer for the
 * Assignment row, then that reason, and waits for the market's read before it offers anything.
 *
 * And it says "again" only once a table allocation has been run: on pins only nothing has been
 * allocated yet, so the button and its line read as the first run (the coordinator's wording).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import MarketSetupView from '@/views/MarketSetupView.vue';
import { MarketAction } from '@/utils/marketActions';
import type { Allocation } from '@/assets/types/datatypes';
import { marketRoute, marketRouter, serveMarket } from './support/marketScreen';
import { answersRefusing } from './support/servedAnswers';

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn() }));

vi.mock('vue-router', () => ({
  useRouter: () => marketRouter(),
  useRoute: () => marketRoute('settings'),
}));
vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  return { ...actual, api };
});

const DATE = '2026-11-18';
const PLAN = {
  priority: [],
  marketDates: [{ date: DATE }],
  tiers: [],
  locations: [],
  sections: [],
  assignmentOptions: {},
};
const PUBLISHED =
  'Results are published, so the table allocation is settled: applicants have been told whether ' +
  'they have a table, and allocating again could move them. Change a single assignment on the ' +
  'Assignments page instead.';

function row(email: string, handPlaced: boolean) {
  return {
    email,
    date: DATE,
    tableCode: `T-${email}`,
    location: 'Hall',
    section: 'Hall',
    tier: 'Gold',
    tableChoice: 'Full Table',
    handPlaced,
  };
}

function serveTheMarket(market: Record<string, unknown>) {
  serveMarket(api.get, {
    id: 'market-1',
    name: 'Riverside',
    phase: 'assignment',
    setupObject: PLAN,
    assignRefusalReason: null,
    actionRefusals: answersRefusing(),
    ...market,
  });
}

function mountSettings() {
  return mount(MarketSetupView, {
    shallow: true,
    global: {
      stubs: {
        MarketFrame: false,
        MarketAssignmentTab: false,
        ElementSettingContainer: {
          template: '<div><slot name="setting-title" /><slot name="setting-content" /></div>',
        },
      },
    },
  });
}

async function settings(market: Record<string, unknown>) {
  serveTheMarket(market);
  const wrapper = mountSettings();
  await flushPromises();
  return wrapper;
}

const button = (wrapper: ReturnType<typeof mountSettings>) =>
  wrapper.get('[data-testid="market-setup-assign-button"]');
const keeps = (wrapper: ReturnType<typeof mountSettings>) =>
  wrapper.find('[data-testid="market-setup-rerun-keeps"]');
const hint = (wrapper: ReturnType<typeof mountSettings>) =>
  wrapper.find('[data-testid="market-setup-assign-phase-hint"]');

beforeEach(() => {
  setActivePinia(createPinia());
  api.get.mockReset();
  api.put.mockReset();
  api.post.mockReset();
});

describe("Allocate tables waits for the server's word", () => {
  it('offers nothing to press before the market is read', async () => {
    // A read that never lands: nothing of the market is known, so no copy of the rule decides.
    api.get.mockImplementation(() => new Promise(() => {}));
    const wrapper = mountSettings();
    await flushPromises();

    const run = wrapper.find('[data-testid="market-setup-assign-button"]');
    if (run.exists()) expect(run.attributes('disabled')).toBeDefined();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('offers the run where the server serves no refusal', async () => {
    const wrapper = await settings({ allocation: 'none' });

    expect(button(wrapper).attributes('disabled')).toBeUndefined();
    expect(hint(wrapper).exists()).toBe(false);
  });

  it('refuses with the served sentence after results are published, in the assignment phase', async () => {
    // The phase alone said a run may happen here; the server says it may not.
    const wrapper = await settings({
      allocation: 'published',
      assignRefusalReason: PUBLISHED,
      assignmentObject: { vendorAssignments: [row('ana@example.com', false)] },
    });

    expect(button(wrapper).attributes('disabled')).toBeDefined();
    expect(hint(wrapper).text()).toBe(PUBLISHED);
    expect(keeps(wrapper).exists()).toBe(false);
  });

  it('follows the served refusal, not the phase', async () => {
    const served = 'Whatever the server says.';
    const wrapper = await settings({ phase: 'offers', assignRefusalReason: served });

    expect(button(wrapper).attributes('disabled')).toBeDefined();
    expect(hint(wrapper).text()).toBe(served);
  });

  it("puts the person's own answer first", async () => {
    const wrapper = await settings({
      actionRefusals: answersRefusing(MarketAction.Assign),
      assignRefusalReason: null,
    });

    // A person the Assignment row refuses is offered no button at all (E39/F01/S03).
    expect(wrapper.find('[data-testid="market-setup-assign-button"]').exists()).toBe(false);
  });
});

describe('Allocate tables says "again" only once tables were allocated', () => {
  it('reads as the first run on pins only, keeping the hand assignments', async () => {
    const wrapper = await settings({
      allocation: 'pinned',
      assignmentObject: { vendorAssignments: [row('ana@example.com', true)] },
    });

    expect(button(wrapper).text()).toBe('Allocate tables');
    expect(keeps(wrapper).text()).toBe(
      'Keeps your 1 hand assignment; allocates tables for everyone else.',
    );
  });

  it('counts every hand assignment on pins only', async () => {
    const wrapper = await settings({
      allocation: 'pinned',
      assignmentObject: {
        vendorAssignments: [row('ana@example.com', true), row('ben@example.com', true)],
      },
    });

    expect(keeps(wrapper).text()).toBe(
      'Keeps your 2 hand assignments; allocates tables for everyone else.',
    );
  });

  it.each<Allocation>(['current', 'stale'])(
    'runs again once a run exists (%s), keeping the hand assignments',
    async (allocation) => {
      const wrapper = await settings({
        allocation,
        assignmentObject: {
          vendorAssignments: [row('ana@example.com', true), row('ben@example.com', false)],
        },
      });

      expect(button(wrapper).text()).toBe('Allocate tables again');
      expect(keeps(wrapper).text()).toBe(
        'Keeps your 1 hand assignment; allocates tables for everyone else again.',
      );
    },
  );

  it('runs again for everyone once a run with no hand assignment exists', async () => {
    const wrapper = await settings({
      allocation: 'current',
      assignmentObject: { vendorAssignments: [row('ben@example.com', false)] },
    });

    expect(button(wrapper).text()).toBe('Allocate tables again');
    expect(keeps(wrapper).text()).toBe('Allocates tables for everyone again.');
  });

  it('reads as the first run with nothing assigned, and says nothing is kept', async () => {
    const wrapper = await settings({ allocation: 'none' });

    expect(button(wrapper).text()).toBe('Allocate tables');
    expect(keeps(wrapper).exists()).toBe(false);
  });
});
