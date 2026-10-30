/**
 * The vendor drawer's History tab (E40/F01/S04): everything the market's history holds about that
 * vendor, newest first, in the words Manage market's History section uses, and no tab for a person
 * the history's row refuses.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { ref } from 'vue';

import MarketHistory from '@/components/MarketHistory.vue';
import VendorDrawer from '@/components/VendorDrawer.vue';
import { IntakeMode, MarketPhase, type Market } from '@/assets/types/datatypes';
import { MarketAction } from '@/utils/marketActions';
import type { MarketHistoryEntry } from '@/utils/marketHistory';
import { useVendorDetails } from '@/utils/vendorDetails';
import type { VendorTab } from '@/utils/vendorDrawer';
import { answersRefusing } from './support/servedAnswers';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));

vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  return { ...actual, api };
});

const RouterLinkStub = {
  props: ['to'],
  template: '<a :href="JSON.stringify(to)"><slot /></a>',
};

const ANA = 'ana@ember.test';
const BEN = 'ben@ember.test';

function entry(id: string, minutes: number, overrides: Partial<MarketHistoryEntry> = {}) {
  return {
    id,
    actor: 'dana@ember.test',
    at: new Date(Date.UTC(2026, 10, 1, 9, minutes)).toISOString(),
    action: 'write-vendor-notes',
    kind: 'note',
    vendors: [ANA],
    subject: {},
    detail: null,
    ...overrides,
  } satisfies MarketHistoryEntry;
}

/** Answers each read of the history with `pages` in order, every other read with nothing. */
function serve(...pages: Array<{ entries: MarketHistoryEntry[]; next: string | null }>) {
  const asked: string[] = [];
  api.get.mockImplementation(async (url: string) => {
    if (!url.includes('/history')) return { data: {} };
    asked.push(url);
    const page = pages[Math.min(asked.length - 1, pages.length - 1)];
    return {
      data: {
        ...page,
        vendorNames: { [ANA]: 'Ana Rivera', [BEN]: 'Ben Okafor' },
        ...(url.includes('before=') ? {} : { actors: ['dana@ember.test'], groups: [] }),
      },
    };
  });
  return asked;
}

let wrapper: VueWrapper | null = null;

beforeEach(() => {
  setActivePinia(createPinia());
  api.get.mockReset();
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = '';
});

describe('one vendor’s history', () => {
  function mountFor(vendor: string) {
    wrapper = mount(MarketHistory, {
      props: { marketId: 'market-1', path: IntakeMode.Form, vendor },
      global: { stubs: { RouterLink: RouterLinkStub } },
    });
    return wrapper;
  }

  it('asks for that vendor’s entries alone, and older ones keep to them', async () => {
    const asked = serve(
      { entries: [entry('e2', 2), entry('e1', 1)], next: 'cursor-1' },
      { entries: [entry('e0', 0)], next: null },
    );
    const history = mountFor('Ana@Ember.test');
    await flushPromises();

    expect(asked).toEqual(['/markets/market-1/history?vendor=ana%40ember.test']);
    expect(history.findAll('[data-testid="market-history-entry"]')).toHaveLength(2);

    await history.get('[data-testid="market-history-load-more"]').trigger('click');
    await flushPromises();

    expect(asked.at(-1)).toBe('/markets/market-1/history?vendor=ana%40ember.test&before=cursor-1');
    expect(history.findAll('[data-testid="market-history-entry"]')).toHaveLength(3);
  });

  it('draws no filters, since it is already narrowed to the one vendor', async () => {
    serve({ entries: [entry('e1', 1)], next: null });
    const history = mountFor(ANA);
    await flushPromises();

    for (const filter of ['who', 'kind', 'vendor', 'from', 'to', 'clear']) {
      expect(history.find(`[data-testid="market-history-${filter}"]`).exists()).toBe(false);
    }
  });

  it('names the vendor as text, and links another vendor in the entry to their drawer', async () => {
    serve({
      entries: [
        entry('e1', 1, {
          action: 'assign',
          kind: 'swapped',
          vendors: [ANA, BEN],
          detail: {
            date: '2026-11-19',
            seats: [
              { email: ANA, table_code: 'A3' },
              { email: BEN, table_code: 'B7' },
            ],
          },
        }),
      ],
      next: null,
    });
    const history = mountFor(ANA);
    await flushPromises();

    expect(history.get('[data-testid="market-history-sentence"]').text()).toBe(
      `dana@ember.test swapped Ana Rivera ${ANA} and Ben Okafor ${BEN} - now at A3 and B7 on Nov 19, 2026`,
    );
    expect(history.get('[data-testid="market-history-own-vendor"]').text()).toContain(ANA);
    const links = history.findAll('[data-testid="market-history-vendor-link"]');
    expect(links).toHaveLength(1);
    expect(links[0].text()).toContain(BEN);
  });

  it('says so when nothing about the vendor has been recorded', async () => {
    serve({ entries: [], next: null });
    const history = mountFor(ANA);
    await flushPromises();

    expect(history.get('[data-testid="market-history-empty"]').text()).toBe(
      'Nothing has been recorded about this vendor yet.',
    );
  });
});

describe('the drawer’s History tab', () => {
  function market(refused: MarketAction[]): Market {
    return {
      id: 'market-1',
      name: 'Riverside',
      phase: MarketPhase.Assignment,
      intakeMode: 'csv',
      roles: {},
      actionRefusals: answersRefusing(...refused),
    } as unknown as Market;
  }

  async function openDrawer(tab: VendorTab, refused: MarketAction[] = []) {
    const shown = market(refused);
    const details = useVendorDetails(ref('market-1'), ref(shown));
    wrapper = mount(VendorDrawer, {
      props: { market: shown, details, email: ANA, tab },
      global: { stubs: { RouterLink: RouterLinkStub, Teleport: true } },
      attachTo: document.body,
    });
    await flushPromises();
    return wrapper;
  }

  const historyRead = () =>
    api.get.mock.calls.map(([url]) => String(url)).filter((url) => url.includes('history'));

  it('reads the market’s history narrowed to the vendor', async () => {
    serve({ entries: [entry('e1', 1)], next: null });
    const drawer = await openDrawer('history');

    expect(drawer.findAll('[role="tab"]').map((tab) => tab.text())).toEqual([
      'Application',
      'Assignments',
      'History',
    ]);
    expect(historyRead()).toEqual(['/markets/market-1/history?vendor=ana%40ember.test']);
    expect(drawer.get('[data-testid="vendor-drawer-panel-history"]').text()).toContain(
      'dana@ember.test changed the note on Ana Rivera',
    );
  });

  it('holds no History tab for a person the history’s row refuses, and never asks for it', async () => {
    // An owner may raise reading the history above a Viewer, who still opens the drawer.
    serve({ entries: [entry('e1', 1)], next: null });
    const drawer = await openDrawer('history', [MarketAction.ReadHistory]);

    expect(drawer.findAll('[role="tab"]').map((tab) => tab.text())).toEqual([
      'Application',
      'Assignments',
    ]);
    // A link to the History tab opens on the Application tab rather than on a refusal.
    expect(drawer.find('[data-testid="vendor-drawer-panel-history"]').exists()).toBe(false);
    expect(drawer.get('[data-testid="vendor-drawer-panel-application"]').exists()).toBe(true);
    expect(
      drawer.get('[data-testid="vendor-drawer-tab-application"]').attributes('aria-selected'),
    ).toBe('true');
    expect(historyRead()).toEqual([]);
  });

  it('steps with the arrow keys over the tabs it holds', async () => {
    serve({ entries: [], next: null });
    const drawer = await openDrawer('assignments', [MarketAction.ReadHistory]);

    await drawer.get('[role="tablist"]').trigger('keydown', { key: 'ArrowRight' });

    expect(drawer.emitted('update:tab')).toEqual([['application']]);
  });
});
