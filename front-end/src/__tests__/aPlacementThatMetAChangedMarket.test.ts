/**
 * The Tables page, meeting "market changed" from a placement, reads the grid again (ADR 0024).
 *
 * A placement, a move, a swap and a free each hold the assignment's revision and the phase they
 * read; when another change landed first (another organizer's placement, an archive), the server
 * stores nothing and answers its one 409, `{"error": <the sentence>, "code": "market_changed"}`.
 * The page reads the tables and any open vendor's details again, as after a success, so the seat's
 * dialog shows who sits where now, and the sentence stands in the dialog's error line. The store's
 * market is read again by the market-changed interceptor, as for every write
 * (`aMarketThatChangedUnderAWrite.test.ts`).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { AxiosError } from 'axios';
import { reactive, ref } from 'vue';

import PlacementDialog from '@/components/PlacementDialog.vue';
import ResultSeat from '@/components/ResultSeat.vue';
import ResultView from '@/views/ResultView.vue';
import { MarketPhase, type Market } from '@/assets/types/datatypes';
import { MARKET_CHANGED_CODE } from '@/utils/api';
import type { MarketTableRow } from '@/utils/resultFilters';
import { answersRefusing } from './support/servedAnswers';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));
const refreshMarket = vi.hoisted(() => vi.fn());
const details = vi.hoisted(() => ({ loaded: { value: false }, load: vi.fn() }));

vi.mock('vue-router', () => ({
  useRoute: () => route,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  return { ...actual, api };
});
vi.mock('@/utils/openMarket', () => ({
  useOpenMarket: () => ({ market: ref(MARKET), status: ref('loaded'), refresh: refreshMarket }),
}));
vi.mock('@/utils/vendorDetails', () => ({ useVendorDetails: () => details }));

const route = reactive({ params: { marketId: 'market-1' }, query: {} });

const SENTENCE =
  'This market changed while you were working on it, so your change was not saved. ' +
  'Reload to see the latest, then make your change again.';
const DATE = '2099-08-01';
const ANA = 'ana@example.com';
const BEN = 'ben@example.com';

const MARKET = {
  id: 'market-1',
  name: 'Spring Market',
  phase: MarketPhase.Assignment,
  actionRefusals: answersRefusing(),
  setupObject: { marketDates: [{ date: DATE }], sections: [], tiers: [], locations: [] },
  assignmentObject: { vendorAssignments: [] },
} as unknown as Market;

function table(occupant: string | null): MarketTableRow {
  return {
    date: DATE,
    assignment: occupant ? [occupant] : [],
    assignmentSlots: [occupant, occupant],
    location: 'Main Hall',
    section: 'Main Hall',
    tableChoice: occupant ? 'Full Table' : '',
    tableCode: 'Main Hall 1',
    tier: 'Gold',
  };
}

/** The tables the server holds; a change landed meanwhile sets it. */
let served: MarketTableRow[] = [];

function tablesReads(): number {
  return api.get.mock.calls.filter(([url]) => String(url).endsWith('/tables')).length;
}

function refusedWith(data: Record<string, unknown>, meanwhile?: () => void) {
  return async () => {
    meanwhile?.();
    throw Object.assign(new AxiosError('refused'), { response: { status: 409, data } });
  };
}

async function placeAnaInTheEmptyTable() {
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
  wrapper.findComponent(PlacementDialog).vm.$emit('place', { email: ANA, seat: 'Full Table' });
  await flushPromises();
  return wrapper;
}

enableAutoUnmount(beforeEach);

beforeEach(() => {
  localStorage.setItem('user', JSON.stringify('organizer@example.com'));
  served = [table(null)];
  details.loaded.value = false;
  details.load.mockReset();
  refreshMarket.mockReset();
  api.get.mockReset().mockImplementation(async (url: string) => {
    if (url.endsWith('/tables')) return { data: { rows: served, vendorNames: {}, vendors: [] } };
    throw new Error(`unexpected read ${url}`);
  });
  api.put.mockReset();
});

describe('a placement refused because the market changed', () => {
  it('reads the tables again and says the sentence in the seat dialog', async () => {
    api.put.mockImplementation(
      refusedWith({ error: SENTENCE, code: MARKET_CHANGED_CODE }, () => {
        served = [table(BEN)];
      }),
    );

    const wrapper = await placeAnaInTheEmptyTable();

    expect(api.put).toHaveBeenCalledTimes(1);
    expect(tablesReads()).toBe(2);
    const dialog = wrapper.findComponent(PlacementDialog);
    expect(dialog.exists()).toBe(true);
    expect(dialog.props('errorMessage')).toBe(SENTENCE);
    expect(dialog.props('busy')).toBe(false);
    // The dialog's lists come from the tables read again: Ben, seated meanwhile, is in them.
    expect(dialog.props('seated')).toEqual([expect.objectContaining({ email: BEN })]);
  });

  it("reads an open vendor's details again", async () => {
    details.loaded.value = true;
    api.put.mockImplementation(refusedWith({ error: SENTENCE, code: MARKET_CHANGED_CODE }));

    await placeAnaInTheEmptyTable();

    expect(details.load).toHaveBeenCalledTimes(1);
  });

  it('leaves the market to the interceptor, which reads it once for every refused write', async () => {
    api.put.mockImplementation(refusedWith({ error: SENTENCE, code: MARKET_CHANGED_CODE }));

    await placeAnaInTheEmptyTable();

    expect(refreshMarket).not.toHaveBeenCalled();
  });
});

describe('a placement refused because the seat was taken meanwhile', () => {
  it('reads the tables and the market again, and keeps the refusal in the seat dialog', async () => {
    const taken = `${BEN} already holds Main Hall 1 (Full Table) on ${DATE}.`;
    api.put.mockImplementation(refusedWith({ error: taken }));

    const wrapper = await placeAnaInTheEmptyTable();

    expect(tablesReads()).toBe(2);
    expect(refreshMarket).toHaveBeenCalledTimes(1);
    expect(wrapper.findComponent(PlacementDialog).props('errorMessage')).toBe(taken);
  });
});

describe('a placement refused for another reason', () => {
  it('reads nothing again', async () => {
    const unknown = 'That seat is not on this market’s plan.';
    api.put.mockImplementation(() => {
      throw Object.assign(new AxiosError('refused'), {
        response: { status: 400, data: { error: unknown } },
      });
    });

    const wrapper = await placeAnaInTheEmptyTable();

    expect(tablesReads()).toBe(1);
    expect(refreshMarket).not.toHaveBeenCalled();
    expect(details.load).not.toHaveBeenCalled();
    expect(wrapper.findComponent(PlacementDialog).props('errorMessage')).toBe(unknown);
  });
});

describe('a placement that lands', () => {
  it('closes the dialog and reads the tables and the market again', async () => {
    api.put.mockResolvedValue({ data: { placement: {} } });

    const wrapper = await placeAnaInTheEmptyTable();

    expect(wrapper.findComponent(PlacementDialog).exists()).toBe(false);
    expect(tablesReads()).toBe(2);
    expect(refreshMarket).toHaveBeenCalledTimes(1);
  });
});
