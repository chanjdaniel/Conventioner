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
import { MarketPhase, type Market } from '@/assets/types/datatypes';
import { VALID_TRANSITIONS, transitionNeedsConfirmation } from '@/utils/phase';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  return { ...actual, api };
});

function marketIn(phase: MarketPhase): Market {
  return { id: 'market-1', name: 'Riverside', phase } as Market;
}

async function clickTransition(phase: MarketPhase, toPhase: string) {
  api.post.mockReset();
  api.post.mockResolvedValue({ data: { phase: toPhase } });
  api.get.mockResolvedValue({ data: { market: {} } });

  const wrapper = mount(PhaseRail, {
    props: { market: marketIn(phase) },
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

    expect(wrapper.find('[data-testid="sweep-confirm-dialog"]').exists()).toBe(true);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('archiving confirms: `archived` has no outbound edge at all', async () => {
    const wrapper = await clickTransition(MarketPhase.Draft, 'archived');

    expect(wrapper.find('[data-testid="archive-confirm-dialog"]').exists()).toBe(true);
    expect(api.post).not.toHaveBeenCalled();
  });

  it.each([
    [MarketPhase.Draft, 'applications_open'],
    [MarketPhase.ApplicationsOpen, 'applications_closed'],
    [MarketPhase.ApplicationsClosed, 'review'],
    [MarketPhase.Review, 'assignment'],
  ])('a reversible step fires on one click: %s -> %s', async (from, to) => {
    await clickTransition(from, to);

    expect(api.post).toHaveBeenCalledWith(expect.stringContaining('/transition'), { toPhase: to });
  });
});

describe('the decision is the table, not a list of phases', () => {
  it('confirms exactly the two phases with no route back', () => {
    const confirming = [
      'draft',
      'applications_open',
      'applications_closed',
      'review',
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
