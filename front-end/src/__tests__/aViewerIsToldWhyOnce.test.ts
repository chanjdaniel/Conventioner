import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import MarketFrame from '@/components/MarketFrame.vue';
import MarketAssignmentTab from '@/components/market/MarketAssignmentTab.vue';
import MarketPlanTab from '@/components/market/MarketPlanTab.vue';
import { IntakeMode, MarketPhase, type Market, type SetupObject } from '@/assets/types/datatypes';

/**
 * A person who may change nothing on a market is told why once, by the frame, on every page of it
 * (T15). Each screen drops its controls on `readOnlyReason`, and only Market Setup said why: a
 * Viewer met a Result page whose seats were plain text and took it for broken.
 */
const route = vi.hoisted(() => ({
  current: { name: 'market-result', params: { marketId: 'market-1' } as Record<string, unknown> },
}));

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useRoute: () => route.current,
}));

const VIEWER = 'You can view this market but not change it.';

function market(overrides: Partial<Market> = {}): Market {
  return {
    id: 'market-1',
    name: 'Riverside',
    phase: MarketPhase.MarketDays,
    readOnlyReason: VIEWER,
    ...overrides,
  } as Market;
}

function mountFrame(shown: Market) {
  return mount(MarketFrame, {
    props: { market: shown },
    slots: { default: '<div data-testid="the-page">The page</div>' },
    global: { stubs: { MarketBar: true, PhaseRail: true, MarketPages: true, MarketArrival: true } },
  });
}

const note = (wrapper: ReturnType<typeof mountFrame>) =>
  wrapper.find('[data-testid="market-read-only"]');

describe('the frame says why a person may change nothing', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    route.current = { name: 'market-result', params: { marketId: 'market-1' } };
  });

  it('says it once, above the page, to a Viewer on a live market', () => {
    const wrapper = mountFrame(market());

    expect(wrapper.findAll('[data-testid="market-read-only"]')).toHaveLength(1);
    expect(note(wrapper).text()).toBe(VIEWER);
    expect(wrapper.find('[data-testid="the-page"]').exists()).toBe(true);
    // Under the rail and the pinned block, above the page it explains.
    const html = wrapper.html();
    expect(html.indexOf('market-read-only')).toBeGreaterThan(html.indexOf('market-frame'));
    expect(html.indexOf('market-read-only')).toBeLessThan(html.indexOf('the-page'));
  });

  it('says it on Market Setup too', () => {
    route.current = { name: 'market-setup', params: { marketId: 'market-1', page: 'setup' } };

    expect(note(mountFrame(market())).text()).toBe(VIEWER);
  });

  it('leaves an archived market to the rail, which already says it', () => {
    const wrapper = mountFrame(
      market({ phase: MarketPhase.Archived, readOnlyReason: 'This market is archived.' }),
    );

    expect(note(wrapper).exists()).toBe(false);
  });

  it("says nothing beside a tab's own note, which stands in for the page", () => {
    route.current = { name: 'attendance-status', params: { marketId: 'market-1' } };
    const wrapper = mountFrame(market({ phase: MarketPhase.Draft }));

    expect(wrapper.find('[data-testid="market-tab-note"]').exists()).toBe(true);
    expect(note(wrapper).exists()).toBe(false);
  });

  it('says nothing to someone who may change the market', () => {
    expect(note(mountFrame(market({ readOnlyReason: null }))).exists()).toBe(false);
  });
});

/*
 * So a page says only its own lock: the plan's settled setup, the form's, the rules'. Each used to
 * say the person's reason too, so a Viewer on Market Setup read the frame's sentence twice.
 */
describe('each page says only its own lock, and still offers a Viewer nothing', () => {
  const SETTLED = 'The setup is settled: it cannot change once applications have opened.';
  const SETUP = {
    priority: [],
    marketDates: [],
    tiers: [],
    locations: [],
    sections: [],
    assignmentOptions: {},
  } as unknown as SetupObject;
  const container = {
    template: '<div><slot name="setting-title" /><slot name="setting-content" /></div>',
  };

  function mountPlan(readOnly: boolean, setupLockReason: string | null) {
    return mount(MarketPlanTab, {
      props: {
        setupObject: SETUP,
        intakeMode: IntakeMode.Form,
        intakeEditable: false,
        csvStartRefusal: null,
        readOnly,
        setupLockReason,
        formQuestions: 0,
        formLockReason: null,
        choiceQuestions: [],
      },
      global: { stubs: { ElementSettingContainer: container } },
    });
  }

  it('the plan: a Viewer reads no second sentence, and every card is disabled', () => {
    const wrapper = mountPlan(true, null);

    expect(wrapper.get('fieldset').attributes('disabled')).toBeDefined();
    expect(wrapper.find('[data-testid="plan-setup-settled"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="market-read-only"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="market-setup-choose-path-button"]').exists()).toBe(false);
  });

  it('the plan: anyone reads why a settled setup cannot change', () => {
    for (const readOnly of [false, true]) {
      const wrapper = mountPlan(readOnly, SETTLED);

      expect(wrapper.get('[data-testid="plan-setup-settled"]').text()).toBe(SETTLED);
      expect(wrapper.get('fieldset').attributes('disabled')).toBeDefined();
    }
  });

  it('the plan: an editor of a draft changes it', () => {
    const wrapper = mountPlan(false, null);

    expect(wrapper.get('fieldset').attributes('disabled')).toBeUndefined();
    expect(wrapper.find('[data-testid="plan-setup-settled"]').exists()).toBe(false);
  });

  function mountAssignment(
    readOnly: boolean,
    rulesLockReason: string | null,
    mayAllocate = !readOnly,
  ) {
    return mount(MarketAssignmentTab, {
      props: {
        setupObject: SETUP,
        formFields: [],
        assignmentOptionsComplete: true,
        assignRefusalReason: null,
        assignError: '',
        assignIncomplete: [],
        marketId: 'market-1',
        readOnly,
        mayAllocate,
        rulesLockReason,
        handPlacements: null,
      },
      global: {
        stubs: {
          ElementSettingContainer: container,
          ElementAssignmentPriority: {
            props: ['readonly'],
            template: '<div data-testid="rules" />',
          },
          ElementAssignmentOptions: true,
        },
      },
    });
  }

  it('the rules: a Viewer reads no second sentence, and is offered no run', () => {
    const wrapper = mountAssignment(true, null);

    expect(wrapper.find('[data-testid="assignment-rules-settled"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="market-setup-assign-button"]').exists()).toBe(false);
    expect(wrapper.getComponent('[data-testid="rules"]').props('readonly')).toBe(true);
  });

  it('the rules: an editor may run them while they are open', () => {
    const wrapper = mountAssignment(false, null);

    expect(wrapper.find('[data-testid="market-setup-assign-button"]').exists()).toBe(true);
    expect(wrapper.getComponent('[data-testid="rules"]').props('readonly')).toBe(false);
  });

  it('the rules: Allocate tables follows the Assignment row alone, apart from the rules (E39/F01/S03)', () => {
    const mayAllocateOnly = mountAssignment(true, null, true);

    expect(mayAllocateOnly.find('[data-testid="market-setup-assign-button"]').exists()).toBe(true);
    expect(mayAllocateOnly.getComponent('[data-testid="rules"]').props('readonly')).toBe(true);

    const mayChangeOnly = mountAssignment(false, null, false);

    expect(mayChangeOnly.find('[data-testid="market-setup-assign-button"]').exists()).toBe(false);
    expect(mayChangeOnly.getComponent('[data-testid="rules"]').props('readonly')).toBe(false);
  });

  it('the rules: nothing is allocated once they are settled, whoever may allocate', () => {
    const wrapper = mountAssignment(false, 'The rules are settled.', true);

    expect(wrapper.find('[data-testid="market-setup-assign-button"]').exists()).toBe(false);
  });
});
