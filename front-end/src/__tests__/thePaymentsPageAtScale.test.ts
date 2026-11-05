/**
 * Payments in a frame (T223, L6): the table with its sort, filters and search stands as it was and
 * draws 50 rows at a time, while every figure on the page still counts every vendor. The real
 * `ListFrame` under the real screen, on a route that follows the address.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { computed, reactive, ref } from 'vue';

import PaymentsView from '@/views/PaymentsView.vue';
import type { MarketPayments, PaymentsVendor } from '@/utils/paymentsPage';

const loadMarketPayments = vi.fn();
const route = reactive({
  params: { marketId: 'm1' },
  query: {} as Record<string, string>,
});
const replace = vi.hoisted(() => vi.fn());

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
  useRoute: () => route,
}));
vi.mock('@/utils/signedIn', () => ({ signedInEmail: () => 'owner@market.test' }));
vi.mock('@/utils/openMarket', () => ({
  useOpenMarket: () => ({
    market: computed(() => ({ id: 'm1', phase: 'assignment', roles: {} })),
  }),
}));
vi.mock('@/utils/vendorDetails', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/vendorDetails')>();
  return {
    ...actual,
    useVendorDetails: () => ({
      vendorNames: ref({}),
      legalNames: ref({}),
      load: vi.fn(() => Promise.resolve()),
    }),
  };
});
vi.mock('@/utils/vendorDrawer', () => ({
  useVendorDrawer: () => ({
    email: ref(null),
    tab: ref('payment'),
    open: vi.fn(),
    close: vi.fn(),
    setTab: vi.fn(),
  }),
}));
vi.mock('@/utils/paymentsPage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/paymentsPage')>();
  return { ...actual, loadMarketPayments: (id: string) => loadMarketPayments(id) };
});

const pad = (n: number) => String(n).padStart(3, '0');

/** 120 vendors in turn owing, square and paid more, each of them owed $30.00. */
function vendor(n: number): PaymentsVendor {
  const state = (['owes', 'paid', 'over'] as const)[n % 3]!;
  const paidCents = { owes: 1000, paid: 3000, over: 4000 }[state] + n;
  return {
    email: `vendor-${pad(n)}@market.test`,
    owedCents: 3000,
    paidCents,
    balanceState: state,
  };
}
const VENDORS = Array.from({ length: 120 }, (_, at) => vendor(at + 1));

/** Figures only the server could give, so a page that summed its rows would read otherwise. */
const FIGURES = {
  owedCents: 360000,
  paidCents: 321234,
  stillOwedCents: 80000,
  paidMoreCents: 41234,
};
const ANSWER = {
  currency: 'CAD',
  totals: FIGURES,
  byTier: [{ tier: 'Gold', ...FIGURES }],
  byDate: [{ date: '2099-08-01', ...FIGURES }],
  vendors: VENDORS,
} as unknown as MarketPayments;

beforeEach(() => {
  setActivePinia(createPinia());
  route.query = {};
  replace.mockReset();
  replace.mockImplementation(({ query }: { query: Record<string, string> }) => {
    route.query = query;
  });
  loadMarketPayments.mockReset();
  loadMarketPayments.mockResolvedValue(ANSWER);
});

async function mounted() {
  const wrapper = mount(PaymentsView, {
    attachTo: document.body,
    global: {
      stubs: {
        MarketFrame: { template: '<div><slot name="pinned" /><slot /></div>' },
        NothingAssigned: true,
        RouterLink: true,
        VendorDrawer: true,
      },
    },
  });
  await flushPromises();
  return wrapper;
}
type Mounted = Awaited<ReturnType<typeof mounted>>;

const byTestid = (wrapper: Mounted, testid: string) => wrapper.find(`[data-testid="${testid}"]`);
const words = (wrapper: Mounted, testid: string) => byTestid(wrapper, testid).text();
const rows = (wrapper: Mounted) => wrapper.findAll('[data-testid="payments-row"]');
const firstEmail = (wrapper: Mounted) => rows(wrapper)[0]!.attributes('data-email');

async function showMore(wrapper: Mounted): Promise<void> {
  await byTestid(wrapper, 'payments-list-more').trigger('click');
  await flushPromises();
}

describe('the Payments page at 120 vendors', () => {
  it('draws 50 rows under its table head, says so and offers the next page', async () => {
    const wrapper = await mounted();
    expect(rows(wrapper)).toHaveLength(50);
    expect(wrapper.findAll('.payments-table--vendors thead th')).toHaveLength(4);
    expect(words(wrapper, 'payments-list-count')).toBe('Showing 50 of 120');
    expect(words(wrapper, 'payments-list-more')).toBe('Show 50 more');
    wrapper.unmount();
  });

  it('counts every vendor in every figure, whatever the rows on screen', async () => {
    const wrapper = await mounted();
    expect(rows(wrapper)).toHaveLength(50);

    // The server's figures, as it counted them.
    expect(words(wrapper, 'payments-total-owedCents')).toContain('$3,600.00');
    expect(words(wrapper, 'payments-total-paidCents')).toContain('$3,212.34');
    expect(words(wrapper, 'payments-total-stillOwedCents')).toContain('$800.00');
    expect(words(wrapper, 'payments-total-paidMoreCents')).toContain('$412.34');
    expect(words(wrapper, 'payments-by-tier-row')).toContain('$3,212.34');
    expect(words(wrapper, 'payments-by-date-row')).toContain('$3,212.34');

    // The toolbar's, which the page counts itself: 40 of each state, none of them cut to the 50.
    expect(words(wrapper, 'payments-summary')).toBe('120 vendors');
    expect(words(wrapper, 'payments-show-owes')).toBe('Owes (40)');
    expect(words(wrapper, 'payments-show-paid')).toBe('Paid in full (40)');
    expect(words(wrapper, 'payments-show-over')).toBe('Paid more than owed (40)');

    await byTestid(wrapper, 'payments-show-owes').trigger('click');
    await flushPromises();
    expect(rows(wrapper)).toHaveLength(40);
    expect(words(wrapper, 'payments-summary')).toBe('40 of 120 vendors shown');
    expect(words(wrapper, 'payments-show-paid')).toBe('Paid in full (40)');
    expect(words(wrapper, 'payments-total-paidCents')).toContain('$3,212.34');
    wrapper.unmount();
  });

  it('hands the focus to the first new row', async () => {
    const wrapper = await mounted();
    await showMore(wrapper);
    expect(rows(wrapper)).toHaveLength(100);
    expect(words(wrapper, 'payments-list-count')).toBe('Showing 100 of 120');
    const firstNew = rows(wrapper)[50]!;
    expect(firstNew.attributes('data-list-row')).toBeDefined();
    expect(firstNew.attributes('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(firstNew.element);
    wrapper.unmount();
  });

  it('says nothing of the cap once every row is drawn, the toolbar counting them', async () => {
    const wrapper = await mounted();
    await showMore(wrapper);
    await showMore(wrapper);
    expect(rows(wrapper)).toHaveLength(120);
    expect(byTestid(wrapper, 'payments-list-count').exists()).toBe(false);
    expect(byTestid(wrapper, 'payments-list-more').exists()).toBe(false);
    wrapper.unmount();
  });

  it('starts a new sort from the first page, in either direction, its first rows the point of it', async () => {
    const wrapper = await mounted();
    await showMore(wrapper);
    await byTestid(wrapper, 'payments-sort-paid').trigger('click');
    await flushPromises();
    expect(rows(wrapper)).toHaveLength(50);
    expect(firstEmail(wrapper)).toBe('vendor-119@market.test');
    expect(wrapper.find('th[aria-sort="descending"]').text()).toContain('Paid');

    await showMore(wrapper);
    await byTestid(wrapper, 'payments-sort-paid').trigger('click');
    await flushPromises();
    expect(rows(wrapper)).toHaveLength(50);
    expect(wrapper.find('th[aria-sort="ascending"]').text()).toContain('Paid');
    wrapper.unmount();
  });

  it('folds back on a filter and on new words, not on spaces after them', async () => {
    const wrapper = await mounted();
    const search = byTestid(wrapper, 'payments-search');

    await showMore(wrapper);
    await byTestid(wrapper, 'payments-show-owes').trigger('click');
    await flushPromises();
    await byTestid(wrapper, 'payments-show-owes').trigger('click');
    await flushPromises();
    expect(rows(wrapper)).toHaveLength(50);

    await search.setValue('vendor');
    await flushPromises();
    await showMore(wrapper);
    expect(rows(wrapper)).toHaveLength(100);
    await search.setValue('vendor ');
    await flushPromises();
    expect(rows(wrapper)).toHaveLength(100);
    await search.setValue('vendor-');
    await flushPromises();
    expect(rows(wrapper)).toHaveLength(50);
    wrapper.unmount();
  });

  it('holds its place when the payments are read again', async () => {
    const wrapper = await mounted();
    await showMore(wrapper);
    expect(rows(wrapper)).toHaveLength(100);

    // A payment recorded in the drawer: the page reads the market's money again.
    const after = {
      ...ANSWER,
      vendors: VENDORS.map((v, at) => (at ? v : { ...v, paidCents: v.paidCents + 500 })),
      totals: { ...FIGURES, paidCents: FIGURES.paidCents + 500 },
    };
    loadMarketPayments.mockResolvedValueOnce(after);
    wrapper.findComponent({ name: 'VendorDrawer' }).vm.$emit('payment-changed');
    await flushPromises();
    expect(words(wrapper, 'payments-total-paidCents')).toContain('$3,217.34');
    expect(rows(wrapper)).toHaveLength(100);
    expect(words(wrapper, 'payments-list-count')).toBe('Showing 100 of 120');
    wrapper.unmount();
  });

  it('says what it said when the words find nobody, the toolbar still counting', async () => {
    route.query = { search: 'nobody' };
    const wrapper = await mounted();
    expect(rows(wrapper)).toHaveLength(0);
    expect(words(wrapper, 'payments-none-shown')).toBe('No vendor matches "nobody".');
    expect(words(wrapper, 'payments-summary')).toBe('0 of 120 vendors shown');
    expect(byTestid(wrapper, 'payments-list').exists()).toBe(false);
    wrapper.unmount();
  });
});
