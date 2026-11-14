/**
 * Assignments reads where a run may happen from the server, never from the phase (T316).
 *
 * Before an assignment is stored, the page draws the tables and says anyone assigned first keeps
 * their table only where a run may happen (E11/F02/S01). The server also refuses a run once results
 * are published, so the page asks the served `assignRefusalReason` and says it, in the server's
 * words, when there is one, rather than working the answer out from the phase.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { reactive, ref } from 'vue';

import NothingAssigned from '@/components/NothingAssigned.vue';
import ResultFilterBar from '@/components/ResultFilterBar.vue';
import ResultSummary from '@/components/ResultSummary.vue';
import ResultView from '@/views/ResultView.vue';
import { MarketPhase, type Allocation, type Market } from '@/assets/types/datatypes';
import { MarketAction } from '@/utils/marketActions';
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

  it.each<Allocation>(['published', 'changed_since_published'])(
    'is not offered after results are published (%s), in the assignment phase',
    async (allocation) => {
      const wrapper = await mountSummary(market({ allocation, assignRefusalReason: PUBLISHED }));

      expect(wrapper.find('[data-testid="result-pin-before-run"]').exists()).toBe(false);
    },
  );

  it('is not offered where the server refuses the run for its phase', async () => {
    const wrapper = await mountSummary(
      market({ phase: MarketPhase.Draft, assignRefusalReason: DRAFT }),
    );

    expect(wrapper.find('[data-testid="result-pin-before-run"]').exists()).toBe(false);
  });
});

/*
 * Every seat freed after results are published (the coordinator's answer to ticket 05's question):
 * the server's refusal sends the organizer to "the Assignments page", which is where they are, and
 * "Set the rules" offers rules that are settled. The page says what holds, and that a seat is
 * still given here, by hand, to whoever may.
 */
describe('Assignments after results are published, with every seat freed', () => {
  const FREED = market({ allocation: 'changed_since_published', assignRefusalReason: PUBLISHED });

  async function mountSummary(shown: Market) {
    const wrapper = mount(ResultSummary, {
      props: { market: shown },
      shallow: true,
      global: { stubs: { NothingAssigned: false, RouterLink: { template: '<a><slot /></a>' } } },
    });
    await flushPromises();
    return wrapper;
  }

  it('says nobody has a table, and to assign below, never to go to the page it is on', async () => {
    const line = (await mountSummary(FREED)).get('[data-testid="result-empty"]');

    expect(line.text()).toBe(
      'Nobody has a table. Results are published, so tables are not allocated again: assign each one below by hand.',
    );
    expect(line.text()).not.toContain('Assignments page');
    expect(line.find('a').exists()).toBe(false);
  });

  it('reads the same with a published allocation stored before T316 and no row', async () => {
    const line = (
      await mountSummary(market({ allocation: 'published', assignRefusalReason: PUBLISHED }))
    ).get('[data-testid="result-empty"]');

    expect(line.text()).toContain('assign each one below by hand.');
  });

  it('offers nothing to assign to someone who may not', async () => {
    const line = (
      await mountSummary({
        ...FREED,
        actionRefusals: answersRefusing(MarketAction.Assign),
      } as Market)
    ).get('[data-testid="result-empty"]');

    expect(line.text()).toBe(
      'Nobody has a table. Results are published, so tables are not allocated again.',
    );
  });

  it("leaves Vendors and Payments the server's sentence, which points here", () => {
    const note = mount(NothingAssigned, {
      props: { market: FREED, testid: 'vendors-empty' },
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    });

    expect(note.text()).toBe(`Nothing assigned yet. ${PUBLISHED} Set the rules.`);
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

  it('draws none where the server refuses the run for its phase, with nothing stored', async () => {
    const wrapper = await mountPage(
      market({ phase: MarketPhase.Draft, allocation: 'none', assignRefusalReason: DRAFT }),
    );

    expect(wrapper.findComponent(ResultFilterBar).exists()).toBe(false);
    expect(wrapper.text()).not.toContain('No tables found');
  });

  // Every seat freed after results are published: a seat is still given here by hand (story 9),
  // as the phase rule drew them before T316 (the coordinator's answer to ticket 05's question).
  it.each<Allocation>(['published', 'changed_since_published'])(
    'draws them after results are published (%s) with every seat freed, to give one by hand',
    async (allocation) => {
      const wrapper = await mountPage(market({ allocation, assignRefusalReason: PUBLISHED }));

      expect(wrapper.findComponent(ResultFilterBar).exists()).toBe(true);
    },
  );

  it('draws none after results are published with every seat freed, to someone who may not assign', async () => {
    const wrapper = await mountPage(
      market({
        allocation: 'changed_since_published',
        assignRefusalReason: PUBLISHED,
        actionRefusals: answersRefusing(MarketAction.Assign),
      }),
    );

    expect(wrapper.findComponent(ResultFilterBar).exists()).toBe(false);
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

/*
 * A market left in Offers with nothing stored (T316 ticket 06, the coordinator's addition): no run
 * may happen there, and the server's phase refusal sends the organizer to "the Assignments page",
 * which is where they are. The page says what holds instead, and draws the tables to whoever may
 * assign, since a seat is still given there by hand, as after results with every seat freed.
 * That a seat is given by hand, not by a run, is the server's word: the going-live blocker it
 * serves, whose remedy is Assign tables on this page; the page never reads it off the phase.
 */
describe('Assignments in a market left in Offers with nothing stored', () => {
  const SETTLED =
    'The table allocation for this market is settled. Change a single assignment on the ' +
    'Assignments page instead of allocating tables again.';
  const NOBODY_SEATED_SETTLED =
    "Nobody has a table, so this market's vendor page could not tell anyone where to stand. " +
    'The table allocation for this market is settled, so tables are not allocated again: assign ' +
    'each one by hand.';
  /** The going-live blocker the server serves where a run is refused and nobody is seated. */
  const byHand = (resolutionLink: string) => ({
    [MarketPhase.MarketDays]: [
      {
        id: 'assignment_computed',
        passed: false,
        message: NOBODY_SEATED_SETTLED,
        resolutionLink,
        resolutionLabel: resolutionLink === 'assignments' ? 'Assign tables' : 'Allocate tables',
        resolutionAction: MarketAction.Assign,
      },
    ],
  });
  const OFFERS = market({
    phase: MarketPhase.Offers,
    assignRefusalReason: SETTLED,
    transitionBlockers: byHand('assignments'),
  });
  const MAY_NOT = { ...OFFERS, actionRefusals: answersRefusing(MarketAction.Assign) } as Market;

  async function mountSummary(shown: Market) {
    const wrapper = mount(ResultSummary, {
      props: { market: shown },
      shallow: true,
      global: { stubs: { NothingAssigned: false, RouterLink: { template: '<a><slot /></a>' } } },
    });
    await flushPromises();
    return wrapper;
  }

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

  it('says nobody has a table, and to assign below, never to go to the page it is on', async () => {
    const line = (await mountSummary(OFFERS)).get('[data-testid="result-empty"]');

    expect(line.text()).toBe(
      'Nobody has a table. The table allocation for this market is settled, so tables are not allocated again: assign each one below by hand.',
    );
    expect(line.find('a').exists()).toBe(false);
  });

  it('offers nothing to assign to someone who may not', async () => {
    const line = (await mountSummary(MAY_NOT)).get('[data-testid="result-empty"]');

    expect(line.text()).toBe(
      'Nobody has a table. The table allocation for this market is settled, so tables are not allocated again.',
    );
  });

  it('draws the tables to whoever may assign, and none to someone who may not', async () => {
    expect((await mountPage(OFFERS)).findComponent(ResultFilterBar).exists()).toBe(true);
    expect((await mountPage(MAY_NOT)).findComponent(ResultFilterBar).exists()).toBe(false);
  });

  it("reads the server's remedy for going live, never the phase", async () => {
    const byARun = market({
      phase: MarketPhase.Offers,
      assignRefusalReason: SETTLED,
      transitionBlockers: byHand('settings'),
    });
    const unserved = market({ phase: MarketPhase.Offers, assignRefusalReason: SETTLED });

    for (const shown of [byARun, unserved]) {
      expect((await mountSummary(shown)).find('[data-testid="result-empty"]').text()).not.toContain(
        'Nobody has a table',
      );
      expect((await mountPage(shown)).findComponent(ResultFilterBar).exists()).toBe(false);
    }
  });

  it("leaves Vendors and Payments the server's sentence, which points at Assignments", () => {
    const note = mount(NothingAssigned, {
      props: { market: OFFERS, testid: 'vendors-empty' },
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    });

    expect(note.text()).toBe(`Nothing assigned yet. ${SETTLED} Set the rules.`);
  });
});
