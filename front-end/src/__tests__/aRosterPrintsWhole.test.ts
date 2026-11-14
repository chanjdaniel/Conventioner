/**
 * A printed roster is whole (T318).
 *
 * Paper is the door's only fallback when the venue's network or the back end fails, so the sheet
 * Print roster prints lists every vendor of the chosen date, by table, whatever the Show toggle and
 * the search on screen leave out: a sheet printed with "Not yet" chosen, or a name typed in the
 * search, would leave the door without the vendors it hid.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { reactive, ref } from 'vue';

import AttendanceStatusView from '@/views/AttendanceStatusView.vue';
import { MarketPhase, type Market } from '@/assets/types/datatypes';
import { calendarToday } from '@/utils/marketGuide';
import { getFormattedDate } from '@/utils/utils';
import { answersRefusing } from './support/servedAnswers';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));

vi.mock('vue-router', () => ({
  useRoute: () => route,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  return { ...actual, api };
});
vi.mock('@/utils/openMarket', () => ({
  useOpenMarket: () => ({ market: ref(MARKET), status: ref('loaded'), refresh: vi.fn() }),
}));
vi.mock('@/utils/vendorDetails', () => ({
  useVendorDetails: () => ({ loaded: { value: false }, load: vi.fn() }),
}));

const route = reactive({ params: { marketId: 'market-1' }, query: {} });

const TODAY = calendarToday();
const ARRIVED = '2099-08-01T09:41:00Z';
const ANA = 'ana@example.com';
const BEN = 'ben@example.com';
const CY = 'cy@example.com';
const DEE = 'dee@example.com';
const ED = 'ed@example.com';

const MARKET = {
  id: 'market-1',
  name: 'Spring Market',
  phase: MarketPhase.MarketDays,
  actionRefusals: answersRefusing(),
} as unknown as Market;

function row(email: string, name: string, tableCode: string | null, more: object = {}) {
  return {
    date: TODAY,
    vendorEmail: email,
    vendorName: name,
    tableCode,
    tableChoice: tableCode ? 'Full Table' : null,
    section: tableCode ? 'Main Hall' : null,
    location: tableCode ? 'Main Hall' : null,
    state: 'expected',
    checkedInTableCode: null,
    checkedInAt: null,
    checkedInBy: null,
    checkedInVia: null,
    ...more,
  };
}

/** Today's roster as the server serves it, by table: Ana scanned in, Ben and Cy not yet, Ed here
 *  with no table today, and Dee seated on another day. */
const ROSTER = {
  dates: [TODAY, '2099-12-31'],
  roster: [
    row(ANA, 'Ana Clay', 'A1', {
      state: 'here',
      checkedInTableCode: 'A1',
      checkedInAt: ARRIVED,
      checkedInVia: 'door_code',
    }),
    row(BEN, 'Ben Wood', 'A2'),
    row(CY, '', 'A3'),
    row(ED, 'Ed Stone', null, {
      state: 'here_without_seat',
      checkedInTableCode: 'A9',
      checkedInAt: ARRIVED,
      checkedInVia: 'door_code',
    }),
    { ...row(DEE, 'Dee Glass', 'A1'), date: '2099-12-31' },
  ],
};

async function open(): Promise<VueWrapper> {
  const wrapper = mount(AttendanceStatusView, {
    attachTo: document.body,
    global: {
      stubs: {
        MarketFrame: { template: '<div><slot /></div>' },
        VendorDrawer: true,
        DoorCodeScreen: true,
        VendorNotes: true,
        teleport: true,
      },
    },
  });
  await flushPromises();
  return wrapper;
}

function sheet(wrapper: VueWrapper) {
  return wrapper.get('[data-testid="attendance-print-sheet"]');
}

function printed(wrapper: VueWrapper): (string | undefined)[] {
  return sheet(wrapper)
    .findAll('[data-testid="attendance-print-row"]')
    .map((one) => one.attributes('data-vendor'));
}

function here(wrapper: VueWrapper, email: string) {
  return sheet(wrapper).get(
    `[data-testid="attendance-print-row"][data-vendor="${email}"] [data-testid="attendance-print-here"]`,
  );
}

enableAutoUnmount(afterEach);

beforeEach(() => {
  vi.resetAllMocks();
  route.query = {};
  localStorage.setItem('user', JSON.stringify({ email: 'org@example.com' }));
  api.get.mockImplementation((url: string) =>
    Promise.resolve({ data: url === '/markets/market-1/attendance' ? ROSTER : {} }),
  );
});

afterEach(() => {
  localStorage.clear();
});

describe('the printed roster', () => {
  it('says the market, the date in words, how many are expected and when it was printed', async () => {
    const wrapper = await open();

    expect(sheet(wrapper).get('[data-testid="attendance-print-market"]').text()).toBe(
      'Spring Market',
    );
    expect(sheet(wrapper).get('[data-testid="attendance-print-date"]').text()).toBe(
      getFormattedDate(TODAY),
    );
    expect(sheet(wrapper).get('[data-testid="attendance-print-count"]').text()).toBe('3 vendors');
    expect(sheet(wrapper).get('[data-testid="attendance-print-printed"]').text()).toMatch(
      /^Printed [A-Z][a-z]{2} \d{1,2}, \d{4} at \d{1,2}:\d{2}\s[AP]M$/,
    );
  });

  it('lists every vendor of the date by table, with a box to tick for whoever is not here', async () => {
    const wrapper = await open();

    expect(printed(wrapper)).toEqual([ANA, BEN, CY, ED]);
    const ana = sheet(wrapper).get(`[data-testid="attendance-print-row"][data-vendor="${ANA}"]`);
    expect(ana.get('[data-testid="attendance-print-table"]').text()).toBe(
      'Table A1, a whole table',
    );
    expect(ana.get('[data-testid="attendance-print-name"]').text()).toBe('Ana Clay');
    expect(ana.get('[data-testid="attendance-print-email"]').text()).toBe(ANA);
    expect(here(wrapper, ANA).text()).toMatch(/^Scanned in at /);
    expect(here(wrapper, ANA).find('[data-testid="attendance-print-box"]').exists()).toBe(false);
    expect(here(wrapper, BEN).text()).toBe('');
    expect(here(wrapper, BEN).find('[data-testid="attendance-print-box"]').exists()).toBe(true);
    // A vendor with no name on file is their address alone.
    const cy = sheet(wrapper).get(`[data-testid="attendance-print-row"][data-vendor="${CY}"]`);
    expect(cy.get('[data-testid="attendance-print-name"]').text()).toBe(CY);
    expect(cy.find('[data-testid="attendance-print-email"]').exists()).toBe(false);
  });

  it('prints whole whatever the Show toggle and the search leave on screen', async () => {
    const wrapper = await open();

    await wrapper.get('[data-testid="attendance-show-not-yet"]').trigger('click');
    await wrapper.get('[data-testid="attendance-search"]').setValue('ben');
    expect(
      wrapper
        .get('.door')
        .findAll('[data-testid="attendance-row"]')
        .map((one) => one.attributes('data-vendor')),
    ).toEqual([BEN]);

    expect(printed(wrapper)).toEqual([ANA, BEN, CY, ED]);
    expect(sheet(wrapper).get('[data-testid="attendance-print-count"]').text()).toBe('3 vendors');
  });

  it('prints who is here with no table that day under a heading of their own', async () => {
    const wrapper = await open();

    const heading = sheet(wrapper).get('[data-testid="attendance-print-unseated-heading"]');
    expect(heading.text()).toBe('Checked in, with no table on this date (1)');
    const ed = sheet(wrapper).get(`[data-testid="attendance-print-row"][data-vendor="${ED}"]`);
    expect(ed.get('[data-testid="attendance-print-table"]').text()).toBe('No table');
    expect(here(wrapper, ED).text()).toMatch(/^Scanned in at .+$/);
    // The heading stands between the seats and them.
    const html = sheet(wrapper).html();
    expect(html.indexOf(`data-vendor="${CY}"`)).toBeLessThan(html.indexOf('unseated-heading'));
    expect(html.indexOf('unseated-heading')).toBeLessThan(html.indexOf(`data-vendor="${ED}"`));
  });

  it("prints the chosen date's vendors, not another day's", async () => {
    route.query = { date: '2099-12-31' };
    const wrapper = await open();

    expect(printed(wrapper)).toEqual([DEE]);
    expect(sheet(wrapper).get('[data-testid="attendance-print-count"]').text()).toBe('1 vendor');
    expect(sheet(wrapper).find('[data-testid="attendance-print-unseated-heading"]').exists()).toBe(
      false,
    );
  });
});
