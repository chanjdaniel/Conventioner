/**
 * Assignment history is the market's History narrowed to assignments (T224): every read asks that
 * kind of change, whose filter is not drawn or counted, in a dialog that reads afresh each time it
 * opens, offered only to whoever may read the history.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import AssignmentHistoryDialog from '@/components/AssignmentHistoryDialog.vue';
import MarketHistory from '@/components/MarketHistory.vue';
import ResultSummary from '@/components/ResultSummary.vue';
import { IntakeMode, MarketPhase, type Market } from '@/assets/types/datatypes';
import { MarketAction } from '@/utils/marketActions';
import type { MarketHistoryEntry } from '@/utils/marketHistory';
import { installIntersectionObserver } from './support/intersection';
import { answersRefusing } from './support/servedAnswers';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));

vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  return { ...actual, api };
});
vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-router')>();
  return {
    ...actual,
    useRoute: () => ({ path: '/markets/market-1/assignments', query: {}, matched: [] }),
    useRouter: () => ({ replace: vi.fn(), resolve: () => ({ path: '/markets/market-1/vendors' }) }),
  };
});

const RouterLinkStub = {
  props: ['to'],
  template: '<a :href="JSON.stringify(to)"><slot /></a>',
};
const global = { stubs: { RouterLink: RouterLinkStub } };

const ASSIGNMENT = { days: ['2026-11-19', '2026-11-20'] };

function placed(id: string, minutes: number): MarketHistoryEntry {
  return {
    id,
    actor: 'dana@ember.test',
    at: new Date(Date.UTC(2026, 10, 1, 9, minutes)).toISOString(),
    action: 'assign',
    kind: 'placed',
    vendors: ['ana@ember.test'],
    subject: { date: '2026-11-19', table_code: `A${minutes}` },
    detail: { date: '2026-11-19', table_code: `A${minutes}`, before: null },
  };
}

/** Answers each read of the history with `pages`, in order, and records what it was asked. */
function serve(...pages: Array<{ entries: MarketHistoryEntry[]; next: string | null }>) {
  const asked: string[] = [];
  api.get.mockImplementation(async (url: string) => {
    asked.push(url);
    const page = pages[Math.min(asked.length - 1, pages.length - 1)];
    return {
      data: {
        ...page,
        vendorNames: { 'ana@ember.test': 'Ana Rivera' },
        actors: ['dana@ember.test'],
        groups: [{ group: 'Assignment', actions: [{ id: 'assign', label: 'Run the assignment' }] }],
      },
    };
  });
  return asked;
}

function market(overrides: Partial<Market> = {}): Market {
  return {
    id: 'market-1',
    name: 'Riverside Spring',
    phase: MarketPhase.Assignment,
    intakeMode: IntakeMode.Form,
    roles: {},
    setupObject: {
      marketDates: [{ date: '2026-11-19' }, { date: '2026-11-20' }],
      tiers: [],
      locations: [],
      sections: [],
      priority: [],
    },
    applicationForm: { fields: [] },
    permissionTable: [],
    actionRefusals: answersRefusing(),
    ...overrides,
  } as unknown as Market;
}

let open: VueWrapper | null = null;

beforeEach(() => {
  setActivePinia(createPinia());
  api.get.mockReset();
  api.get.mockResolvedValue({ data: {} });
});

afterEach(() => {
  open?.unmount();
  open = null;
  document.body.innerHTML = '';
});

function mountList() {
  open = mount(MarketHistory, {
    props: { marketId: 'market-1', path: IntakeMode.Form, assignment: ASSIGNMENT, box: 'parent' },
    global,
  });
  return open;
}

describe('the history, narrowed to assignments', () => {
  it('asks for the Assignment kind on every read, the next page and a filter included', async () => {
    const view = installIntersectionObserver();
    const asked = serve(
      { entries: [placed('e2', 2)], next: 'cursor-2' },
      { entries: [placed('e1', 1)], next: null },
    );
    const wrapper = mountList();
    await flushPromises();
    await view.showSentinels();

    await wrapper.find('[data-testid="market-history-from"]').setValue('2026-10-01');
    await flushPromises();

    expect(asked).toEqual([
      '/markets/market-1/history?group=Assignment',
      '/markets/market-1/history?group=Assignment&before=cursor-2',
      `/markets/market-1/history?group=Assignment&since=${encodeURIComponent(
        new Date(2026, 9, 1).toISOString(),
      )}`,
    ]);
  });

  it('draws no kind of change, and that kind alone offers nothing to clear', async () => {
    serve({ entries: [placed('e1', 1)], next: null });
    const wrapper = mountList();
    await flushPromises();

    expect(wrapper.find('[data-testid="market-history-kind"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="market-history-clear"]').exists()).toBe(false);
  });

  it('keeps the kind when the filters are cleared', async () => {
    const asked = serve({ entries: [placed('e1', 1)], next: null });
    const wrapper = mountList();
    await flushPromises();
    await wrapper.find('[data-testid="market-history-from"]').setValue('2026-10-01');
    await flushPromises();

    await wrapper.find('[data-testid="market-history-clear"]').trigger('click');
    await flushPromises();

    expect(asked.at(-1)).toBe('/markets/market-1/history?group=Assignment');
    expect(wrapper.find('[data-testid="market-history-clear"]').exists()).toBe(false);
  });

  it('says no assignment has changed when nothing is there, and no match under a filter', async () => {
    serve({ entries: [], next: null });
    const wrapper = mountList();
    await flushPromises();
    const empty = () => wrapper.find('[data-testid="market-history-empty"]').text();

    expect(empty()).toBe('No assignments have been changed yet.');

    await wrapper.find('[data-testid="market-history-from"]').setValue('2026-10-01');
    await flushPromises();

    expect(empty()).toBe('No change matches these filters.');
  });

  it('links a vendor to the Vendors page, where the drawer opens on them', async () => {
    serve({ entries: [placed('e1', 1)], next: null });
    const wrapper = mountList();
    await flushPromises();

    const link = wrapper.find('[data-testid="market-history-vendor-link"]');
    expect(link.attributes('href')).toBe(
      JSON.stringify({
        path: '/markets/market-1/vendors',
        query: { vendor: 'ana@ember.test' },
      }),
    );
  });

  it('leaves Manage market asking for every kind, with the filter drawn', async () => {
    const asked = serve({ entries: [placed('e1', 1)], next: null });
    open = mount(MarketHistory, {
      props: { marketId: 'market-1', path: IntakeMode.Form },
      global,
    });
    await flushPromises();

    expect(asked).toEqual(['/markets/market-1/history']);
    expect(open.find('[data-testid="market-history-kind"]').exists()).toBe(true);
  });
});

describe('the Assignment history dialog', () => {
  function mountDialog(opened: boolean) {
    open = mount(AssignmentHistoryDialog, {
      props: { open: opened, market: market() },
      attachTo: document.body,
      global,
    });
    return open;
  }

  it('reads nothing while closed, and reads again each time it opens', async () => {
    const asked = serve({ entries: [placed('e1', 1)], next: null });
    const wrapper = mountDialog(false);
    await flushPromises();
    expect(asked).toEqual([]);

    await wrapper.setProps({ open: true });
    await flushPromises();
    await wrapper.setProps({ open: false });
    await flushPromises();
    await wrapper.setProps({ open: true });
    await flushPromises();

    expect(asked).toEqual([
      '/markets/market-1/history?group=Assignment',
      '/markets/market-1/history?group=Assignment',
    ]);
  });

  it('scrolls the entries in its own body, with no box of the list inside it', async () => {
    serve({ entries: [placed('e1', 1)], next: null });
    mountDialog(true);
    await flushPromises();

    const body = document.querySelector('[data-testid="assignment-history-dialog-body"]');
    expect(body?.querySelector('[data-testid="market-history-entry"]')).not.toBeNull();
    expect(body?.querySelector('[data-testid="market-history-box-shade-bottom"]')).toBeNull();
    expect(body?.querySelector('.scroll-box')).toBeNull();
    expect(document.querySelector('[data-testid="assignment-history-dialog-scroll"]')).toBeNull();
  });

  it("names a change it has no words for by the market's own label for the row", async () => {
    serve({
      entries: [{ ...placed('e1', 1), kind: 'a_kind_with_no_words_yet', vendors: [] }],
      next: null,
    });
    open = mount(AssignmentHistoryDialog, {
      props: {
        open: true,
        market: market({
          permissionTable: [{ id: 'assign', label: 'Our own label' }],
        } as unknown as Partial<Market>),
      },
      attachTo: document.body,
      global,
    });
    await flushPromises();

    const sentence = document.querySelector('[data-testid="market-history-sentence"]');
    expect(sentence?.textContent).toContain('Our own label');
  });
});

describe('the Assignment history button', () => {
  const ran = {
    assignmentObject: {
      vendorAssignments: [{ email: 'ana@ember.test', date: '2026-11-19', tableCode: 'A1' }],
      assignmentDate: '2026-10-01',
    },
  };

  describe.each([
    ['before a run', {}],
    ['after a run', ran],
  ])('%s', (_when, assignment) => {
    it('is offered to whoever may read the history, and opens the dialog', async () => {
      serve({ entries: [placed('e1', 1)], next: null });
      open = mount(ResultSummary, {
        props: { market: market({ ...assignment } as Partial<Market>) },
        attachTo: document.body,
        global,
      });
      await flushPromises();

      await open.find('[data-testid="result-history-button"]').trigger('click');
      await flushPromises();

      expect(
        document.querySelector('[data-testid="assignment-history-dialog-window"]'),
      ).not.toBeNull();
    });

    it('is not offered to someone below the row, and nothing reads the history', async () => {
      const asked: string[] = [];
      api.get.mockImplementation(async (url: string) => {
        asked.push(url);
        return { data: {} };
      });
      open = mount(ResultSummary, {
        props: {
          market: market({
            ...assignment,
            actionRefusals: answersRefusing(MarketAction.ReadHistory),
          } as Partial<Market>),
        },
        attachTo: document.body,
        global,
      });
      await flushPromises();

      expect(open.find('[data-testid="result-history-button"]').exists()).toBe(false);
      expect(asked.filter((url) => url.includes('/history'))).toEqual([]);
    });
  });
});
