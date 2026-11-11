/**
 * Applications All in a frame (T223, L2): a reviewer finds one of hundreds by name or address, reads
 * how many are shown of how many, and every verdict stays on rows in front of them. The real
 * `ListFrame` under the real screen, on a route that follows the address.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { reactive } from 'vue';

import ApplicationsAll from '@/components/application/ApplicationsAll.vue';
import { ApplicationStatus, type Application, type Market } from '@/assets/types/datatypes';
import { FULL_NAME_KEY, PREFERRED_NAME_KEY } from '@/utils/essentialFields';
import { MarketAction } from '@/utils/marketActions';
import { answersRefusing } from './support/servedAnswers';

const fetchMarketApplications = vi.fn();
const reviewSelection = vi.fn();
const route = reactive({ query: {} as Record<string, string> });
const replace = vi.hoisted(() => vi.fn());

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
  useRoute: () => route,
}));
vi.mock('@/utils/applicantApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/applicantApi')>();
  return {
    ...actual,
    fetchMarketApplications: (id: string) => fetchMarketApplications(id),
    reviewSelection: (...args: unknown[]) => reviewSelection(...args),
  };
});
vi.mock('@/utils/signedIn', () => ({ signedInEmail: () => 'owner@market.test' }));

const pad = (n: number) => String(n).padStart(3, '0');

function application(n: number, change: Partial<Application> = {}): Application {
  return {
    id: `app-${pad(n)}`,
    marketId: 'm1',
    applicantEmail: `vendor-${pad(n)}@market.test`,
    status: ApplicationStatus.Open,
    formData: { [FULL_NAME_KEY]: `Person ${pad(n)}` },
    submittedAt: `2026-09-15T14:20:18.${pad(n)}Z`,
    ...change,
  } as unknown as Application;
}
const many = (count: number) => Array.from({ length: count }, (_, at) => application(at + 1));

const MARKET = {
  id: 'm1',
  phase: 'applications',
  roles: {},
  applicationForm: { fields: [] },
  actionRefusals: {
    ...answersRefusing(),
    [MarketAction.GiveVerdicts]: null,
    [MarketAction.ChangeVerdicts]: null,
    [MarketAction.ExportCsv]: null,
  },
} as unknown as Market;

beforeEach(() => {
  setActivePinia(createPinia());
  route.query = {};
  replace.mockReset();
  replace.mockImplementation(({ query }: { query: Record<string, string> }) => {
    route.query = query;
  });
  reviewSelection.mockReset();
  reviewSelection.mockResolvedValue({ written: [], skipped: [] });
  fetchMarketApplications.mockReset();
  fetchMarketApplications.mockResolvedValue(many(120));
});

async function allView(market: Market = MARKET) {
  const wrapper = mount(ApplicationsAll, {
    props: { market },
    attachTo: document.body,
    global: {
      stubs: {
        VendorDrawer: {
          name: 'VendorDrawer',
          emits: ['infoUpdated'],
          template: '<div><slot name="actions" /></div>',
          methods: { entryFor: () => null, loadNotes: () => undefined },
        },
        ExportVendorsDialog: {
          name: 'ExportVendorsDialog',
          props: ['open', 'seed', 'marketId'],
          template: '<div />',
        },
        FollowUpDialog: true,
        ListFreshness: {
          name: 'ListFreshness',
          emits: ['refresh'],
          template: '<div />',
        },
        Teleport: true,
      },
    },
  });
  await flushPromises();
  return wrapper;
}

type View = Awaited<ReturnType<typeof allView>>;

const count = (wrapper: View) => wrapper.get('[data-testid="applications-all-list-count"]').text();
const rows = (wrapper: View) => wrapper.findAll('[data-testid="applications-all-row"]');
const more = (wrapper: View) => wrapper.get('[data-testid="applications-all-list-more"]');
const selectAll = (wrapper: View) => wrapper.get('[data-testid="applications-all-select-all"]');
const selection = (wrapper: View) => wrapper.find('[data-testid="applications-all-selection"]');
const ticked = (wrapper: View) =>
  wrapper
    .findAll<HTMLInputElement>('[data-testid="applications-all-tick"]')
    .filter((tick) => tick.element.checked).length;
async function find(wrapper: View, words: string) {
  await wrapper.get('[data-testid="applications-all-list-find"]').setValue(words);
  await flushPromises();
}
async function go(query: Record<string, string>) {
  route.query = query;
  await flushPromises();
}

describe('the find field', () => {
  it('is labelled, and finds by address', async () => {
    const wrapper = await allView();
    const label = wrapper.findAll('label').find((one) => one.attributes('for')?.endsWith('-find'))!;
    expect(label.text()).toBe('Find by name or address');
    await find(wrapper, 'VENDOR-007');
    expect(count(wrapper)).toBe('1 of 120 matches "VENDOR-007"');
    expect(rows(wrapper)).toHaveLength(1);
  });

  it('finds by the legal name and the preferred one, capitals aside', async () => {
    fetchMarketApplications.mockResolvedValue([
      application(1, {
        formData: { [FULL_NAME_KEY]: 'Sasha Quill', [PREFERRED_NAME_KEY]: 'Bo' },
      } as Partial<Application>),
      ...many(20).slice(1),
    ]);
    const wrapper = await allView();
    await find(wrapper, 'quill');
    expect(rows(wrapper)).toHaveLength(1);
    await find(wrapper, 'BO');
    expect(rows(wrapper)).toHaveLength(1);
  });

  it('holds its words in the address as search, with the rest of the query', async () => {
    route.query = { status: 'undecided' };
    const wrapper = await allView();
    await find(wrapper, 'person');
    expect(replace).toHaveBeenLastCalledWith({ query: { status: 'undecided', search: 'person' } });
    await find(wrapper, '');
    expect(replace).toHaveBeenLastCalledWith({ query: { status: 'undecided' } });
  });

  it('opens on the words in the address', async () => {
    route.query = { search: 'person 009' };
    const wrapper = await allView();
    expect(count(wrapper)).toBe('1 of 120 matches "person 009"');
  });
});

describe('the count line and the first page', () => {
  it('says how many of the whole, under a filter', async () => {
    fetchMarketApplications.mockResolvedValue([
      ...many(110),
      ...many(249).map((app, at) =>
        application(at + 111, { status: ApplicationStatus.ReviewerApproved }),
      ),
    ]);
    route.query = { status: 'undecided' };
    const wrapper = await allView();
    expect(count(wrapper)).toBe('Showing 50 of 110 (359 in all)');
    expect(rows(wrapper)).toHaveLength(50);
    expect(more(wrapper).text()).toBe('Show 50 more');
  });

  it('keeps the old count words out of the screen', async () => {
    const wrapper = await allView();
    expect(wrapper.find('[data-testid="applications-all-count"]').exists()).toBe(false);
  });

  it('reads every application once nothing narrows them', async () => {
    fetchMarketApplications.mockResolvedValue(many(5));
    const wrapper = await allView();
    expect(count(wrapper)).toBe('5 applications');
  });

  it('holds "Find by name or address" back on a short list', async () => {
    fetchMarketApplications.mockResolvedValue(many(12));
    const wrapper = await allView();
    expect(wrapper.find('[data-testid="applications-all-list-find"]').exists()).toBe(false);
  });
});

describe('the place in the list', () => {
  async function onTheSecondPage() {
    const wrapper = await allView();
    await more(wrapper).trigger('click');
    await flushPromises();
    expect(rows(wrapper)).toHaveLength(100);
    return wrapper;
  }

  it('hands the focus to the first new row', async () => {
    const wrapper = await onTheSecondPage();
    expect(document.activeElement).toBe(rows(wrapper)[50]!.element);
    wrapper.unmount();
  });

  it('folds back on a filter', async () => {
    const wrapper = await onTheSecondPage();
    await go({ status: 'undecided' });
    expect(rows(wrapper)).toHaveLength(50);
    wrapper.unmount();
  });

  it('folds back on Mine', async () => {
    const wrapper = await onTheSecondPage();
    await go({ mine: '1' });
    expect(wrapper.find('[data-testid="applications-all-list-empty"]').exists()).toBe(true);
    await go({});
    expect(rows(wrapper)).toHaveLength(50);
    wrapper.unmount();
  });

  it('folds back on new words', async () => {
    const wrapper = await onTheSecondPage();
    await find(wrapper, 'person');
    expect(rows(wrapper)).toHaveLength(50);
    wrapper.unmount();
  });

  it('holds through a Refresh that changes a row', async () => {
    const wrapper = await onTheSecondPage();
    fetchMarketApplications.mockResolvedValue([
      application(1, { status: ApplicationStatus.ReviewerApproved }),
      ...many(120).slice(1),
    ]);
    wrapper.findComponent({ name: 'ListFreshness' }).vm.$emit('refresh');
    await flushPromises();
    expect(fetchMarketApplications).toHaveBeenCalledTimes(2);
    expect(rows(wrapper)).toHaveLength(100);
    wrapper.unmount();
  });

  it('holds through the half-minute re-read', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      const wrapper = await onTheSecondPage();
      vi.advanceTimersByTime(30_000);
      await flushPromises();
      expect(fetchMarketApplications).toHaveBeenCalledTimes(2);
      expect(rows(wrapper)).toHaveLength(100);
      wrapper.unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Select all', () => {
  it('names the rows it ticks while capped, and ticks only those', async () => {
    const wrapper = await allView();
    expect(selectAll(wrapper).text()).toBe('Select all 50 shown');
    await selectAll(wrapper).trigger('click');
    expect(selection(wrapper).text()).toContain('50 applications selected');
    expect(ticked(wrapper)).toBe(50);
    wrapper.unmount();
  });

  it('reads as it did with every row shown', async () => {
    fetchMarketApplications.mockResolvedValue(many(50));
    const wrapper = await allView();
    expect(selectAll(wrapper).text()).toBe('Select all');
    wrapper.unmount();
  });

  it('counts the rows on screen after "Show 50 more", leaving the new ones unticked', async () => {
    const wrapper = await allView();
    await selectAll(wrapper).trigger('click');
    await more(wrapper).trigger('click');
    await flushPromises();
    expect(selectAll(wrapper).text()).toBe('Select all 100 shown');
    expect(selection(wrapper).text()).toContain('50 applications selected');
    await selectAll(wrapper).trigger('click');
    expect(selection(wrapper).text()).toContain('100 applications selected');
    wrapper.unmount();
  });

  it('says it left out only the rows on screen', async () => {
    const held = { heldBy: { email: 'someone@market.test' } } as Partial<Application>;
    fetchMarketApplications.mockResolvedValue([
      application(1, held),
      ...many(100).slice(1),
      // Past the cap: never on screen, so never counted as left out.
      application(101, held),
      application(102, held),
    ]);
    const wrapper = await allView();
    await selectAll(wrapper).trigger('click');
    expect(wrapper.get('[data-testid="applications-all-select-all-skipped"]').text()).toBe(
      '1 application not selected: another reviewer has it open.',
    );
    expect(selection(wrapper).text()).toContain('49 applications selected');
    wrapper.unmount();
  });

  it('sends a verdict only on the rows on screen', async () => {
    const wrapper = await allView();
    await selectAll(wrapper).trigger('click');
    await wrapper.get('[data-testid="applications-all-selection-approve"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-testid="applications-all-confirm-submit-button"]').trigger('click');
    await flushPromises();
    expect(reviewSelection).toHaveBeenCalledOnce();
    const sent = reviewSelection.mock.calls[0]![1] as Application[];
    expect(sent.map((app) => app.id)).toEqual(many(50).map((app) => app.id));
    wrapper.unmount();
  });

  it('draws nothing when the words find no row', async () => {
    const wrapper = await allView();
    await find(wrapper, 'nobody at all');
    expect(wrapper.find('[data-testid="applications-all-select-all"]').exists()).toBe(false);
    wrapper.unmount();
  });
});

describe('a tick leaves with its row', () => {
  const tick = async (wrapper: View, at: number) => {
    await wrapper.findAll('[data-testid="applications-all-tick"]')[at]!.setValue(true);
  };

  it('when words take the row off the screen, and does not come back with it', async () => {
    const wrapper = await allView();
    await tick(wrapper, 0);
    await tick(wrapper, 1);
    expect(selection(wrapper).text()).toContain('2 applications selected');
    await find(wrapper, 'person 002');
    expect(selection(wrapper).text()).toContain('1 application selected');
    await find(wrapper, '');
    expect(selection(wrapper).text()).toContain('1 application selected');
    wrapper.unmount();
  });

  it('when a filter folds the list back past it', async () => {
    fetchMarketApplications.mockResolvedValue(many(120));
    const wrapper = await allView();
    await more(wrapper).trigger('click');
    await flushPromises();
    await tick(wrapper, 70);
    expect(selection(wrapper).text()).toContain('1 application selected');
    await go({ status: 'undecided' });
    expect(rows(wrapper)).toHaveLength(50);
    expect(selection(wrapper).exists()).toBe(false);
    wrapper.unmount();
  });

  it('forgets what Select all left out when the words change', async () => {
    fetchMarketApplications.mockResolvedValue([
      application(1, { heldBy: { email: 'someone@market.test' } } as Partial<Application>),
      ...many(20).slice(1),
    ]);
    const wrapper = await allView();
    await selectAll(wrapper).trigger('click');
    expect(wrapper.find('[data-testid="applications-all-select-all-skipped"]').exists()).toBe(true);
    await find(wrapper, 'person 001');
    expect(wrapper.find('[data-testid="applications-all-select-all-skipped"]').exists()).toBe(
      false,
    );
    wrapper.unmount();
  });
});

describe('the states', () => {
  it('reads the failed read, with the filters still there, and counts nothing', async () => {
    fetchMarketApplications.mockRejectedValueOnce({ isAxiosError: true, request: {} });
    const wrapper = await allView();
    expect(wrapper.get('[data-testid="applications-read-failed"]').text()).toContain(
      'You seem to be offline.',
    );
    expect(wrapper.find('[data-testid="applications-all-list-count"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="applications-all-filter-all"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it('says it is loading, with the filters still there', async () => {
    fetchMarketApplications.mockReturnValue(new Promise(() => undefined));
    const wrapper = await allView();
    expect(wrapper.get('[data-testid="applications-all-list-loading"]').text()).toBe(
      'Loading applications…',
    );
    expect(wrapper.find('[data-testid="applications-all-filter-all"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it('tells nothing come in from nothing matching', async () => {
    fetchMarketApplications.mockResolvedValue([]);
    const none = await allView();
    expect(none.get('[data-testid="applications-all-empty"]').text()).toBe(
      'No applications received yet.',
    );
    none.unmount();

    fetchMarketApplications.mockResolvedValue(many(3));
    route.query = { status: ApplicationStatus.ReviewerRejected };
    const unmatched = await allView();
    expect(unmatched.get('[data-testid="applications-all-empty"]').text()).toBe(
      'No application matches.',
    );
    expect(unmatched.find('[data-testid="applications-all-filter-all"]').exists()).toBe(true);
    unmatched.unmount();
  });

  it('drops the ticks when a read fails and takes the rows away', async () => {
    const wrapper = await allView();
    await selectAll(wrapper).trigger('click');
    expect(selection(wrapper).exists()).toBe(true);
    fetchMarketApplications.mockRejectedValue({ isAxiosError: true, request: {} });
    wrapper.findComponent({ name: 'VendorDrawer' }).vm.$emit('infoUpdated', application(1));
    await flushPromises();
    expect(wrapper.find('[data-testid="applications-read-failed"]').exists()).toBe(true);
    expect(rows(wrapper)).toHaveLength(0);
    expect(selection(wrapper).exists()).toBe(false);
    wrapper.unmount();
  });
});

describe('Export', () => {
  it('opens on the words as well as the filter and Mine', async () => {
    route.query = { status: 'undecided', mine: '1', search: '  person ' };
    const wrapper = await allView();
    await wrapper.get('[data-testid="applications-all-export-button"]').trigger('click');
    const seed = wrapper.findComponent({ name: 'ExportVendorsDialog' }).props('seed');
    expect(seed).toMatchObject({ statuses: ['open'], mine: true, search: 'person' });
    wrapper.unmount();
  });
});
