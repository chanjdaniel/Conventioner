/**
 * The Tables page tells a seat's dialog whether results are published, by the served `allocation`
 * (T316), so the dialog can say what a change does to a vendor's page.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { reactive, ref } from 'vue';

import PlacementDialog from '@/components/PlacementDialog.vue';
import ResultSeat from '@/components/ResultSeat.vue';
import ResultView from '@/views/ResultView.vue';
import { MarketPhase, type Allocation, type Market } from '@/assets/types/datatypes';
import type { MarketTableRow } from '@/utils/resultFilters';
import { answersRefusing } from './support/servedAnswers';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));
const market = vi.hoisted(() => ({ value: null as unknown }));

vi.mock('vue-router', () => ({
  useRoute: () => route,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  return { ...actual, api };
});
vi.mock('@/utils/openMarket', () => ({
  useOpenMarket: () => ({ market: ref(market.value), status: ref('loaded'), refresh: vi.fn() }),
}));
vi.mock('@/utils/vendorDetails', () => ({
  useVendorDetails: () => ({ loaded: { value: false }, load: vi.fn() }),
}));

const route = reactive({ params: { marketId: 'market-1' }, query: {} });

const DATE = '2099-08-01';
const ANA = 'ana@example.com';

function served(allocation: Allocation): Market {
  return {
    id: 'market-1',
    name: 'Spring Market',
    phase: MarketPhase.Assignment,
    allocation,
    actionRefusals: answersRefusing(),
    setupObject: { marketDates: [{ date: DATE }], sections: [], tiers: [], locations: [] },
    assignmentObject: { vendorAssignments: [] },
  } as unknown as Market;
}

const ROW: MarketTableRow = {
  date: DATE,
  assignment: [ANA],
  assignmentSlots: [ANA, ANA],
  location: 'Main Hall',
  section: 'Main Hall',
  tableChoice: 'Full Table',
  tableCode: 'Main Hall 1',
  tier: 'Gold',
};

async function openTheSeat(allocation: Allocation) {
  market.value = served(allocation);
  const wrapper = mount(ResultView, {
    global: {
      stubs: {
        MarketFrame: { template: '<div><slot /></div>' },
        ResultSummary: true,
        ResultFilterBar: true,
        VendorDrawer: true,
        PlacementDialog: true,
        ResultSeat: true,
      },
    },
  });
  await flushPromises();
  wrapper.findComponent(ResultSeat).vm.$emit('open');
  await flushPromises();
  return wrapper.findComponent(PlacementDialog);
}

enableAutoUnmount(beforeEach);

beforeEach(() => {
  localStorage.setItem('user', JSON.stringify('organizer@example.com'));
  api.get.mockReset().mockImplementation(async (url: string) => {
    if (url.endsWith('/tables')) return { data: { rows: [ROW], vendorNames: {}, vendors: [] } };
    throw new Error(`unexpected read ${url}`);
  });
});

describe("a seat's dialog after results", () => {
  it.each<Allocation>(['published', 'changed_since_published'])(
    'is told results are out on %s',
    async (allocation) => {
      expect((await openTheSeat(allocation)).props('resultsOut')).toBe(true);
    },
  );

  it.each<Allocation>(['none', 'pinned', 'current', 'stale'])(
    'is told they are not on %s',
    async (allocation) => {
      expect((await openTheSeat(allocation)).props('resultsOut')).toBe(false);
    },
  );
});
