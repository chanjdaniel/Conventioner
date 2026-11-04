/**
 * Which transitions ask for confirmation, and why.
 *
 * The policy the product already had was right - `market_days` and `archived` confirm, nothing
 * else does, and those are exactly the two edges with no route back. It was hard-coded in
 * `handleTransitionClick`, so it would drift the moment the table changed. It is derived from
 * `VALID_TRANSITIONS` now, and the test that matters is the last one: adding a reverse edge stops
 * a transition confirming, without anyone touching the component.
 */
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';

import PhaseRail from '@/components/PhaseRail.vue';
import { IntakeMode, MarketPhase, type Market } from '@/assets/types/datatypes';
import { VALID_TRANSITIONS, transitionNeedsConfirmation } from '@/utils/phase';
import { MarketAction } from '@/utils/marketActions';
import { movesServedFrom } from './support/servedMoves';
import { answersRefusing } from './support/servedAnswers';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

// A move lands on its phase's page (E32/F01/S01); where is `aMoveLands.test.ts`'s to say.
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ path: '/markets/market-1/setup' }),
}));
vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  return { ...actual, api };
});

// A market whose vendors apply on its own page stops in every phase, so every edge is a move. Read
// by someone who may not choose reviewers: for anyone who may, Open applications offers them first
// (`openApplicationsOffersTheReviewers.test.ts`).
function marketIn(phase: MarketPhase, intakeMode: IntakeMode = IntakeMode.Form): Market {
  return {
    id: 'market-1',
    name: 'Riverside',
    phase,
    intakeMode,
    transitionBlockers: movesServedFrom(phase),
    actionRefusals: answersRefusing(MarketAction.ChooseReviewers),
  } as Market;
}

async function clickTransition(
  phase: MarketPhase,
  toPhase: string,
  intakeMode: IntakeMode = IntakeMode.Form,
) {
  api.post.mockReset();
  api.post.mockResolvedValue({ data: { phase: toPhase } });
  api.get.mockResolvedValue({ data: { market: {} } });

  const wrapper = mount(PhaseRail, {
    props: { market: marketIn(phase, intakeMode) },
    global: { stubs: { Teleport: true, BlockerPanel: true, PhaseBadge: true } },
  });
  // Back and destructive edges live behind the menu; only the one step onward is on the rail
  // itself (E10/F01/S01).
  const action = wrapper.find(`[data-testid="phase-transition-${toPhase}"]`);
  if (!action.exists()) {
    await wrapper.get('[data-testid="phase-rail-menu-button"]').trigger('click');
    await wrapper.vm.$nextTick();
  }
  await wrapper.get(`[data-testid="phase-transition-${toPhase}"]`).trigger('click');
  await wrapper.vm.$nextTick();
  return wrapper;
}

describe('a transition confirms when it cannot be undone', () => {
  it('publishing confirms: `market_days` reaches only `archived`', async () => {
    const wrapper = await clickTransition(MarketPhase.Assignment, 'market_days');

    expect(wrapper.find('[data-testid="sweep-confirm-window"]').exists()).toBe(true);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('archiving confirms: `archived` has no outbound edge at all', async () => {
    const wrapper = await clickTransition(MarketPhase.Draft, 'archived');

    expect(wrapper.find('[data-testid="archive-confirm-window"]').exists()).toBe(true);
    expect(api.post).not.toHaveBeenCalled();
  });

  it.each([
    [MarketPhase.Draft, 'applications'],
    [MarketPhase.Applications, 'assignment'],
  ])('a reversible step fires on one click: %s -> %s', async (from, to) => {
    await clickTransition(from, to);

    expect(api.post).toHaveBeenCalledWith(expect.stringContaining('/transition'), { toPhase: to });
  });
});

describe('Back to review asks first, by its edge (T207)', () => {
  const back = (path: IntakeMode = IntakeMode.Form) =>
    clickTransition(MarketPhase.Assignment, MarketPhase.Applications, path);
  const paragraphs = (wrapper: Awaited<ReturnType<typeof back>>) =>
    wrapper.findAll('[data-testid="back-to-review-confirm-window"] p').map((p) => p.text());

  it('is offered in the menu as a move back', async () => {
    const wrapper = mount(PhaseRail, {
      props: { market: marketIn(MarketPhase.Assignment) },
      global: { stubs: { Teleport: true, BlockerPanel: true, PhaseBadge: true } },
    });
    await wrapper.get('[data-testid="phase-rail-menu-button"]').trigger('click');
    const item = wrapper.get('[data-testid="phase-transition-applications"]');

    expect(item.text()).toBe('Back to review');
    expect(item.attributes('data-direction')).toBe('back');
  });

  it('opens its own dialog rather than moving on one click', async () => {
    const wrapper = await back();

    const dialog = wrapper.get('[data-testid="back-to-review-confirm-window"]');
    expect(dialog.text()).toContain('Back to review?');
    expect(wrapper.get('[data-testid="back-to-review-confirm-submit-button"]').text()).toBe(
      'Back to review',
    );
    expect(
      wrapper.get('[data-testid="back-to-review-confirm-submit-button"]').classes(),
    ).not.toContain('btn--destructive');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('says what it does, on a form market', async () => {
    expect(paragraphs(await back())).toEqual([
      'The review opens again: verdicts can be given and changed, and the automatic rejections can change.',
      'The tables you allocated are kept, but they no longer count. Once every application is decided, begin assignment and allocate tables again before you publish results.',
      'A seat you placed by hand stays, even for a vendor you then reject. Free it on Assignments.',
      'Applications stay closed. To take new ones, choose Take applications again under More…',
    ]);
  });

  it('says the same on a Google Form market, which publishes results too, with no applications line', async () => {
    expect(paragraphs(await back(IntakeMode.Csv))).toEqual([
      'The review opens again: verdicts can be given and changed, and the automatic rejections can change.',
      'The tables you allocated are kept, but they no longer count. Once every application is decided, begin assignment and allocate tables again before you publish results.',
      'A seat you placed by hand stays, even for a vendor you then reject. Free it on Assignments.',
    ]);
  });

  it('moves once confirmed', async () => {
    const wrapper = await back();

    await wrapper.get('[data-testid="back-to-review-confirm-window"] form').trigger('submit');

    expect(api.post).toHaveBeenCalledWith(expect.stringContaining('/transition'), {
      toPhase: 'applications',
    });
  });

  it('leaves the market where it is on Cancel', async () => {
    const wrapper = await back();

    await wrapper.get('[data-testid="back-to-review-confirm-cancel-button"]').trigger('click');
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="back-to-review-confirm-window"]').exists()).toBe(false);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('is disabled with the guard’s reason once results are published', async () => {
    const reason =
      'Results are published: applicants have read whether they have a table, so the review cannot reopen. To change who has a table, place or free a seat on Assignments.';
    const market = {
      ...marketIn(MarketPhase.Assignment),
      transitionBlockers: {
        ...movesServedFrom(MarketPhase.Assignment),
        applications: [{ id: 'results_not_published', passed: false, message: reason }],
      },
    } as Market;
    api.post.mockReset();
    const wrapper = mount(PhaseRail, {
      props: { market },
      global: { stubs: { Teleport: true, BlockerPanel: true, PhaseBadge: true } },
    });
    await wrapper.get('[data-testid="phase-rail-menu-button"]').trigger('click');

    const item = wrapper.get('[data-testid="phase-transition-applications"]');
    expect(item.attributes('aria-disabled')).toBe('true');
    expect(item.get('[data-testid="phase-transition-reason"]').text()).toBe(reason);
    await item.trigger('click');
    expect(wrapper.find('[data-testid="back-to-review-confirm-window"]').exists()).toBe(false);
    expect(api.post).not.toHaveBeenCalled();
  });
});

describe('the decision is the table, not a list of phases', () => {
  it('confirms exactly the two phases with no route back', () => {
    const confirming = [
      'draft',
      'applications',
      'assignment',
      'offers',
      'market_days',
      'archived',
    ].filter((phase) => transitionNeedsConfirmation(phase));

    expect(confirming).toEqual(['market_days', 'archived']);
  });

  it('stops confirming a transition the moment the table gains a reverse edge', () => {
    // The whole point of deriving it. Nobody touches the panel for this to be true.
    expect(transitionNeedsConfirmation('market_days')).toBe(true);

    const withAWayBack: Array<[string, string]> = [
      ...VALID_TRANSITIONS,
      ['market_days', 'assignment'],
    ];

    expect(transitionNeedsConfirmation('market_days', withAWayBack)).toBe(false);
  });

  it('does not count an edge into `archived` as a way back', () => {
    // Every phase can be archived, so reading any outbound edge as reversibility would mean
    // nothing ever confirmed.
    expect(transitionNeedsConfirmation('archived', [['archived', 'archived']])).toBe(true);
  });

  it('confirms a phase the table says nothing about, rather than assuming a way back', () => {
    expect(transitionNeedsConfirmation('some_phase_nobody_added_an_edge_for')).toBe(true);
  });
});
