/**
 * Every export is offered on the table's Export CSV row (E39/F01/S02, E42/F01/S01).
 *
 * The Vendors page's and the All view's Export, and Result's Download CSV, were drawn for everyone
 * who could open the page: right while the row's default is Viewer, the same as Read, but a market
 * that raised the row would have offered a button whose file the server refuses with a 403.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import VendorsView from '@/views/VendorsView.vue';
import ApplicationsAll from '@/components/application/ApplicationsAll.vue';
import ResultSummary from '@/components/ResultSummary.vue';
import type { Market } from '@/assets/types/datatypes';
import { MarketAction } from '@/utils/marketActions';
import { answersRefusing } from './support/servedAnswers';
import { MARKET_ID, serveMarket } from './support/marketScreen';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useRoute: () => ({ name: 'market-vendors', params: { marketId: MARKET_ID }, query: {} }),
}));
vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  return { ...actual, api };
});
vi.mock('@/utils/applicantApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/applicantApi')>();
  return { ...actual, fetchMarketApplications: vi.fn(() => Promise.resolve([])) };
});
vi.mock('@/utils/signedIn', () => ({ signedInEmail: () => 'owner@market.test' }));

/** A market in market days with one run behind it, answering the export row with `refused`. */
function market(refused: string | null): Market {
  return {
    id: MARKET_ID,
    name: 'Riverside Spring',
    phase: 'market_days',
    roles: {},
    setupObject: { marketDates: [], tiers: [], locations: [], sections: [], priority: [] },
    assignmentObject: {
      vendorAssignments: [{ email: 'ana@thistle.test', date: '2026-11-18', tableCode: 'A1' }],
      assignmentDate: '2026-10-01',
    },
    applicationForm: { fields: [] },
    actionRefusals: { ...answersRefusing(), [MarketAction.ExportCsv]: refused },
  } as unknown as Market;
}

const REFUSED = 'Only someone else may export-csv.';

beforeEach(() => {
  setActivePinia(createPinia());
  api.get.mockReset();
  api.get.mockResolvedValue({ data: {} });
});

describe.each([
  [null, true],
  [REFUSED, false],
])('with the export row answering %s', (refused, offered) => {
  it(`the Vendors page ${offered ? 'offers' : 'hides'} Export`, async () => {
    serveMarket(api.get, market(refused) as unknown as Record<string, unknown>);

    const wrapper = mount(VendorsView, {
      shallow: true,
      global: { stubs: { MarketFrame: false } },
    });
    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="vendors-add-button"]').exists()).toBe(true);
    });

    expect(wrapper.find('[data-testid="vendors-export-button"]').exists()).toBe(offered);
  });

  it(`the All view ${offered ? 'offers' : 'hides'} Export`, async () => {
    const wrapper = mount(ApplicationsAll, { props: { market: market(refused) }, shallow: true });
    await flushPromises();

    expect(wrapper.find('[data-testid="applications-all-count"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="applications-all-export-button"]').exists()).toBe(offered);
  });

  it(`Result ${offered ? 'offers' : 'hides'} Download CSV`, async () => {
    const wrapper = mount(ResultSummary, { props: { market: market(refused) }, shallow: true });
    await flushPromises();

    expect(wrapper.find('[data-testid="result-history-button"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="result-download-csv-button"]').exists()).toBe(offered);
  });
});
