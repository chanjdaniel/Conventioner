/**
 * Assignments reads where a run may happen from the server, never from the phase (T316).
 *
 * Before an assignment is stored, the page draws the tables and says anyone assigned first keeps
 * their table only where a run may happen (E11/F02/S01). It worked that out from the phase alone
 * (`assignPhase.ts`), while the server also refuses a run once results are published: so a market
 * published with nothing stored offered a pin before a run the server would refuse. Each now asks
 * the served `assignRefusalReason`, and says it, in the server's words, when there is one.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { reactive, ref } from 'vue';

import NothingAssigned from '@/components/NothingAssigned.vue';
import ResultFilterBar from '@/components/ResultFilterBar.vue';
import ResultSummary from '@/components/ResultSummary.vue';
import ResultView from '@/views/ResultView.vue';
import { MarketPhase, type Allocation, type Market } from '@/assets/types/datatypes';
import type { MarketTableRow } from '@/utils/resultFilters';
import { answersRefusing } from './support/servedAnswers';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));
const opened = vi.hoisted(() => ({ market: null as unknown }));

vi.mock('vue-router', () => ({
  useRoute: () => route,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  return { ...actual, api };
});
vi.mock('@/utils/openMarket', () => ({
  useOpenMarket: () => ({ market: opened.market, status: ref('loaded'), refresh: vi.fn() }),
}));
vi.mock('@/utils/vendorDetails', () => ({
  useVendorDetails: () => ({ loaded: { value: false }, load: vi.fn() }),
}));

const route = reactive({ params: { marketId: 'market-1' }, query: {} });

const DATE = '2099-08-01';
const PUBLISHED =
  'Results are published, so the table allocation is settled: applicants have been told whether ' +
  'they have a table, and allocating again could move them. Change a single assignment on the ' +
  'Assignments page instead.';
const DRAFT =
  'This market is still a draft. Plan it, take its applications in and review them - tables are ' +
  'allocated once the market reaches the assignment phase.';

/** A market with nothing stored, as the server serves it. */
function market(overrides: Partial<Market> = {}): Market {
  return {
    id: 'market-1',
    name: 'Spring Market',
    phase: MarketPhase.Assignment,
    allocation: 'none' as Allocation,
    assignRefusalReason: null,
    actionRefusals: answersRefusing(),
    setupObject: { marketDates: [{ date: DATE }], sections: [], tiers: [], locations: [] },
    assignmentObject: { vendorAssignments: [] },
    ...overrides,
  } as unknown as Market;
}

const EMPTY_TABLE: MarketTableRow = {
  date: DATE,
  assignment: [],
  assignmentSlots: [null, null],
  location: 'Main Hall',
  section: 'Main Hall',
  tableChoice: '',
  tableCode: 'Main Hall 1',
  tier: 'Gold',
};

enableAutoUnmount(beforeEach);

beforeEach(() => {
  localStorage.setItem('user', JSON.stringify('organizer@example.com'));
  api.get.mockReset().mockImplementation(async (url: string) => {
    if (url.endsWith('/tables')) {
      return { data: { rows: [EMPTY_TABLE], vendorNames: {}, vendors: [] } };
    }
    throw new Error(`unexpected read ${url}`);
  });
});

describe("Nothing assigned says why a run cannot happen, in the server's words", () => {
  const mountNote = (shown: Market) =>
    mount(NothingAssigned, {
      props: { market: shown, testid: 'result-empty' },
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    });

  it('offers the run where the server serves no refusal', () => {
    const note = mountNote(market());

    expect(note.text()).toBe('Nothing assigned yet. Set the rules and allocate tables.');
  });

  it('says the served refusal, and offers only the rules', () => {
    const note = mountNote(market({ phase: MarketPhase.Draft, assignRefusalReason: DRAFT }));

    expect(note.text()).toBe(`Nothing assigned yet. ${DRAFT} Set the rules.`);
  });

  it('says why a published market cannot run, though its phase is assignment', () => {
    const note = mountNote(market({ allocation: 'published', assignRefusalReason: PUBLISHED }));

    expect(note.text()).toBe(`Nothing assigned yet. ${PUBLISHED} Set the rules.`);
  });
});

describe('the pin-before-run line is offered only where a run may happen', () => {
  const PIN_LINE =
    'Anyone you assign below first keeps their table: allocating tables assigns everyone else around them.';

  async function mountSummary(shown: Market) {
    const wrapper = mount(ResultSummary, {
      props: { market: shown },
      shallow: true,
      global: { stubs: { NothingAssigned: false, RouterLink: { template: '<a><slot /></a>' } } },
    });
    await flushPromises();
    return wrapper;
  }

  it('is offered with nothing stored and no refusal', async () => {
    const wrapper = await mountSummary(market());

    expect(wrapper.get('[data-testid="result-pin-before-run"]').text()).toBe(PIN_LINE);
  });

  it('is not offered after results are published, in the assignment phase', async () => {
    const wrapper = await mountSummary(
      market({ allocation: 'published', assignRefusalReason: PUBLISHED }),
    );

    expect(wrapper.get('[data-testid="result-empty"]').text()).toContain(PUBLISHED);
    expect(wrapper.find('[data-testid="result-pin-before-run"]').exists()).toBe(false);
  });

  it('is not offered where the server refuses the run for its phase', async () => {
    const wrapper = await mountSummary(
      market({ phase: MarketPhase.Draft, assignRefusalReason: DRAFT }),
    );

    expect(wrapper.find('[data-testid="result-pin-before-run"]').exists()).toBe(false);
  });
});

describe('the tables are drawn before a run only where a run may happen', () => {
  async function mountPage(shown: Market) {
    opened.market = ref(shown);
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
    return wrapper;
  }

  it('draws them with nothing stored and no refusal, for pinning', async () => {
    const wrapper = await mountPage(market());

    expect(wrapper.findComponent(ResultFilterBar).exists()).toBe(true);
  });

  it('draws none after results are published with nothing stored, in the assignment phase', async () => {
    const wrapper = await mountPage(
      market({ allocation: 'published', assignRefusalReason: PUBLISHED }),
    );

    expect(wrapper.findComponent(ResultFilterBar).exists()).toBe(false);
    expect(wrapper.text()).not.toContain('No tables found');
  });

  it('draws them once rows are stored, whatever the refusal', async () => {
    const wrapper = await mountPage(
      market({
        allocation: 'published',
        assignRefusalReason: PUBLISHED,
        assignmentObject: {
          vendorAssignments: [
            {
              email: 'ana@example.com',
              date: DATE,
              tableCode: 'Main Hall 1',
              location: 'Main Hall',
              section: 'Main Hall',
              tier: 'Gold',
              tableChoice: 'Full Table',
            },
          ],
        } as unknown as Market['assignmentObject'],
      }),
    );

    expect(wrapper.findComponent(ResultFilterBar).exists()).toBe(true);
  });
});
