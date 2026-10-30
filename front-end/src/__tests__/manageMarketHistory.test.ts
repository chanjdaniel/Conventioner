/**
 * Manage market's History section (E40/F01/S03): the newest changes, older ones on "Load more",
 * each filter narrowing what the server is asked for, and no section for a person below the row.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import ManageMarketOverlay from '@/views/ManageMarketOverlay.vue';
import MarketHistory from '@/components/MarketHistory.vue';
import { MarketPhase, type Market } from '@/assets/types/datatypes';
import type { MarketHistoryEntry } from '@/utils/marketHistory';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));

vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  return { ...actual, api };
});

const RouterLinkStub = {
  props: ['to'],
  template: '<a :href="JSON.stringify(to)"><slot /></a>',
};

function assigned(id: string, minutes: number, vendor = 'ana@ember.test'): MarketHistoryEntry {
  return {
    id,
    actor: 'dana@ember.test',
    at: new Date(Date.UTC(2026, 10, 1, 9, minutes)).toISOString(),
    action: 'assign',
    kind: 'placed',
    vendors: [vendor],
    subject: {},
    detail: { date: '2026-11-19', table_code: `A${minutes}`, before: null },
  };
}

const GROUPS = [
  { group: 'Applications', actions: [{ id: 'give-verdicts', label: 'Give verdicts' }] },
  { group: 'Assignment', actions: [{ id: 'assign', label: 'Run the assignment' }] },
];

/** Answers each read of the history with `pages`, in order, and records what it was asked. */
function serve(...pages: Array<{ entries: MarketHistoryEntry[]; next: string | null }>) {
  const asked: string[] = [];
  api.get.mockImplementation(async (url: string) => {
    asked.push(url);
    const page = pages[Math.min(asked.length - 1, pages.length - 1)];
    return {
      data: {
        ...page,
        vendorNames: { 'ana@ember.test': 'Ana Rivera', 'ben@ember.test': 'Ben Okafor' },
        ...(url.includes('before=')
          ? {}
          : { actors: ['dana@ember.test', 'priya@ember.test'], groups: GROUPS }),
      },
    };
  });
  return asked;
}

function mountHistory() {
  return mount(MarketHistory, {
    props: { marketId: 'market-1' },
    global: { stubs: { RouterLink: RouterLinkStub } },
  });
}

const sentences = (wrapper: ReturnType<typeof mountHistory>) =>
  wrapper.findAll('[data-testid="market-history-sentence"]').map((p) => p.text());

beforeEach(() => {
  setActivePinia(createPinia());
  api.get.mockReset();
});

describe('the History section', () => {
  it('shows the newest page, and Load more adds the older ones beneath it', async () => {
    const asked = serve(
      { entries: [assigned('e3', 3), assigned('e2', 2)], next: 'cursor-2' },
      { entries: [assigned('e1', 1)], next: null },
    );
    const wrapper = mountHistory();
    await flushPromises();

    expect(sentences(wrapper)).toEqual([
      'dana@ember.test assigned Ana Rivera ana@ember.test at A3 on Nov 19, 2026',
      'dana@ember.test assigned Ana Rivera ana@ember.test at A2 on Nov 19, 2026',
    ]);

    await wrapper.get('[data-testid="market-history-load-more"]').trigger('click');
    await flushPromises();

    expect(asked[1]).toBe('/markets/market-1/history?before=cursor-2');
    expect(wrapper.findAll('[data-testid="market-history-entry"]')).toHaveLength(3);
    expect(wrapper.find('[data-testid="market-history-load-more"]').exists()).toBe(false);
  });

  it('asks the server again, narrowed, for each filter', async () => {
    const asked = serve({ entries: [assigned('e1', 1)], next: null });
    const wrapper = mountHistory();
    await flushPromises();

    await wrapper.get('[data-testid="market-history-who"]').setValue('priya@ember.test');
    await flushPromises();
    expect(asked.at(-1)).toBe('/markets/market-1/history?actor=priya%40ember.test');

    await wrapper.get('[data-testid="market-history-who"]').setValue('');
    await wrapper.get('[data-testid="market-history-kind"]').setValue('Assignment');
    await flushPromises();
    expect(asked.at(-1)).toBe('/markets/market-1/history?group=Assignment');

    await wrapper.get('[data-testid="market-history-kind"]').setValue('');
    await wrapper.get('[data-testid="market-history-vendor"]').setValue('Ben');
    await flushPromises();
    expect(asked.at(-1)).toBe('/markets/market-1/history?vendor=ben%40ember.test');

    await wrapper.get('[data-testid="market-history-vendor"]').setValue('');
    await wrapper.get('[data-testid="market-history-from"]').setValue('2026-11-19');
    await wrapper.get('[data-testid="market-history-to"]').setValue('2026-11-19');
    await flushPromises();
    const query = new URL(`http://x${asked.at(-1)}`).searchParams;
    expect(new Date(query.get('since')!).getDate()).toBe(19);
    expect(new Date(query.get('until')!).getDate()).toBe(20);
  });

  it('does not narrow by a vendor the filter has not settled on, and says why', async () => {
    const asked = serve({ entries: [assigned('e1', 1)], next: null });
    const wrapper = mountHistory();
    await flushPromises();

    await wrapper.get('[data-testid="market-history-vendor"]').setValue('ember');
    await flushPromises();

    expect(asked).toEqual(['/markets/market-1/history']);
    expect(wrapper.get('[data-testid="market-history-vendor-hint"]').text()).toBe(
      '2 vendors match. Keep typing, or choose one.',
    );
  });

  it('narrows to nothing, asking nothing, for a vendor the filter matches nobody by', async () => {
    const asked = serve({ entries: [assigned('e1', 1)], next: null });
    const wrapper = mountHistory();
    await flushPromises();

    await wrapper.get('[data-testid="market-history-vendor"]').setValue('Zelda');
    await flushPromises();

    expect(asked).toEqual(['/markets/market-1/history']);
    expect(wrapper.findAll('[data-testid="market-history-entry"]')).toHaveLength(0);
    expect(wrapper.get('[data-testid="market-history-empty"]').text()).toBe(
      'No change matches these filters.',
    );

    await wrapper.get('[data-testid="market-history-clear"]').trigger('click');
    await flushPromises();
    expect(wrapper.findAll('[data-testid="market-history-entry"]')).toHaveLength(1);
  });

  it('finds a vendor with no name by part of an address the history names', async () => {
    const asked = serve({ entries: [assigned('e1', 1, 'cy.vendor@ember.test')], next: null });
    const wrapper = mountHistory();
    await flushPromises();

    await wrapper.get('[data-testid="market-history-vendor"]').setValue('cy.vend');
    await flushPromises();

    expect(asked.at(-1)).toBe('/markets/market-1/history?vendor=cy.vendor%40ember.test');
    expect(
      wrapper.findAll('datalist option').map((option) => option.attributes('value')),
    ).toContain('cy.vendor@ember.test');
  });

  it('links a vendor to their drawer on the Vendors page', async () => {
    serve({ entries: [assigned('e1', 1)], next: null });
    const wrapper = mountHistory();
    await flushPromises();

    expect(
      JSON.parse(wrapper.get('[data-testid="market-history-vendor-link"]').attributes('href')!),
    ).toEqual({ path: '/markets/market-1/vendors', query: { vendor: 'ana@ember.test' } });
  });

  it('opens an entry to show before and after', async () => {
    serve({
      entries: [
        {
          ...assigned('e1', 1),
          action: 'manage-editors-and-viewers',
          kind: 'role_changed',
          vendors: [],
          subject: { user_id: 'u1', email: 'priya@ember.test' },
          detail: { before: { role: 'viewer' }, after: { role: 'editor' } },
        },
      ],
      next: null,
    });
    const wrapper = mountHistory();
    await flushPromises();
    const toggle = wrapper.get('[data-testid="market-history-toggle"]');

    expect(toggle.attributes('aria-expanded')).toBe('false');
    await toggle.trigger('click');

    expect(toggle.attributes('aria-expanded')).toBe('true');
    expect(wrapper.get('[data-testid="market-history-changes"] tbody').text()).toBe(
      'RoleViewerEditor',
    );
  });

  it('says so when nothing matches the filters', async () => {
    serve({ entries: [], next: null });
    const wrapper = mountHistory();
    await flushPromises();
    expect(wrapper.get('[data-testid="market-history-empty"]').text()).toBe(
      'Nothing has changed on this market yet.',
    );

    await wrapper.get('[data-testid="market-history-kind"]').setValue('Assignment');
    await flushPromises();
    expect(wrapper.get('[data-testid="market-history-empty"]').text()).toBe(
      'No change matches these filters.',
    );
  });
});

describe('in Manage market', () => {
  function market(readHistory: string | null): Market {
    return {
      id: 'market-1',
      name: 'Riverside',
      phase: MarketPhase.Review,
      roles: {},
      actionRefusals: { 'read-history': readHistory },
    } as unknown as Market;
  }

  async function open(readHistory: string | null) {
    api.get.mockImplementation(async (url: string) =>
      url === '/markets/market-1'
        ? { data: { market: market(readHistory) } }
        : { data: { entries: [], next: null, vendorNames: {}, actors: [], groups: [] } },
    );
    const wrapper = mount(ManageMarketOverlay, {
      props: { manageOpen: true, market: market(readHistory) },
      global: { stubs: { Teleport: true, RouterLink: RouterLinkStub } },
    });
    await flushPromises();
    return wrapper;
  }

  const historyRead = () =>
    api.get.mock.calls.filter(([url]) => String(url).startsWith('/markets/market-1/history'));

  it('holds the History section, closed, its heading in sight and nothing read', async () => {
    const wrapper = await open(null);
    const toggle = wrapper.get('[data-testid="manage-market-history-toggle"]');

    expect(wrapper.get('[data-testid="manage-market-history"] h3').text()).toBe('History');
    expect(toggle.attributes('aria-expanded')).toBe('false');
    expect(wrapper.find('[data-testid="market-history"]').exists()).toBe(false);
    expect(historyRead()).toHaveLength(0);
  });

  it('opening it reads the first page, and closing and opening again keeps its filters', async () => {
    const wrapper = await open(null);
    const toggle = wrapper.get('[data-testid="manage-market-history-toggle"]');

    await toggle.trigger('click');
    await flushPromises();
    expect(toggle.attributes('aria-expanded')).toBe('true');
    expect(wrapper.get('[data-testid="market-history"]').isVisible()).toBe(true);
    expect(historyRead()).toHaveLength(1);

    await wrapper.get('[data-testid="market-history-vendor"]').setValue('cy@ember.test');
    await flushPromises();
    await toggle.trigger('click');
    await toggle.trigger('click');
    await flushPromises();

    expect(
      (wrapper.get('[data-testid="market-history-vendor"]').element as HTMLInputElement).value,
    ).toBe('cy@ember.test');
  });

  it('holds none for a person below the row, and never asks for it', async () => {
    const wrapper = await open("Only someone who holds a role may read this market's history.");
    expect(wrapper.find('[data-testid="manage-market-history"]').exists()).toBe(false);
    expect(api.get.mock.calls.map(([url]) => url)).not.toContain('/markets/market-1/history');
  });
});
