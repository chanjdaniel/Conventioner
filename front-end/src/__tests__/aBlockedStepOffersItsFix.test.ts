/**
 * A blocked step offers its fix as the main button (E32/F01/S02).
 *
 * A refused move was drawn disabled, with its first blocker as a sentence and a small "Fix it"
 * link, so the one obvious button on the rail was one that could not be pressed. While the move is
 * refused for a reason a page of the market resolves, the main button is that work, named by the
 * guard ("Add a location"), and the move waits disabled beside it. Whether a move is refused is
 * still the server's to say.
 */
import { describe, expect, it, vi } from 'vitest';
import { mount, RouterLinkStub } from '@vue/test-utils';

import PhaseRail from '@/components/PhaseRail.vue';
import { MarketPhase, type Market, type PreconditionResult } from '@/assets/types/datatypes';

const here = vi.hoisted(() => ({ path: '/markets/market-1/form' }));

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => here,
}));

const NO_LOCATION: PreconditionResult = {
  id: 'setup_has_a_location',
  passed: false,
  message: 'This market has no location. Add one on Market Setup.',
  resolutionLink: 'setup',
  resolutionLabel: 'Add a location',
};

const ASKS_NOTHING: PreconditionResult = {
  id: 'form_has_fields',
  passed: false,
  message: 'The application form asks nothing.',
  resolutionLink: null,
  resolutionLabel: null,
};

function railFor(
  blockers: PreconditionResult[],
  overrides: Partial<Market> = {},
  at = '/markets/market-1/form',
) {
  here.path = at;
  return mount(PhaseRail, {
    props: {
      market: {
        id: 'market-1',
        name: 'Riverside',
        phase: MarketPhase.Draft,
        transitionBlockers: { [MarketPhase.ApplicationsOpen]: blockers },
        ...overrides,
      } as Market,
    },
    global: { stubs: { Teleport: true, BlockerPanel: true, RouterLink: RouterLinkStub } },
  });
}

const move = '[data-testid="phase-transition-applications_open"]';
const fix = '[data-testid="phase-rail-fix"]';

describe('a refused move offers its fix', () => {
  it('as the main button, named by the guard, leading to its page', () => {
    const rail = railFor([NO_LOCATION]);

    const button = rail.get(fix);
    expect(button.text()).toBe('Add a location');
    expect(button.getComponent(RouterLinkStub).props('to')).toBe('/markets/market-1/setup');
    expect(button.classes()).toContain('rail-button--forward');
  });

  it('with the move waiting disabled beside it, saying why', () => {
    const rail = railFor([NO_LOCATION]);

    const waiting = rail.get(move);
    expect(waiting.attributes('disabled')).toBeDefined();
    expect(waiting.classes()).not.toContain('rail-button--forward');
    expect(waiting.classes()).toContain('btn--secondary');
    expect(waiting.attributes('aria-describedby')).toBe('phase-rail-next');
  });

  it('once, not again as a link in the sentence', () => {
    const rail = railFor([NO_LOCATION]);

    expect(rail.get('[data-testid="phase-rail-next"]').text()).toContain('no location');
    expect(rail.find('[data-testid="phase-rail-next-link"]').exists()).toBe(false);
  });

  it('and the move is the main button again once nothing refuses it', () => {
    const rail = railFor([]);

    expect(rail.find(fix).exists()).toBe(false);
    expect(rail.get(move).attributes('disabled')).toBeUndefined();
    expect(rail.get(move).classes()).toContain('rail-button--forward');
  });
});

describe('before a run', () => {
  const NOT_RUN: PreconditionResult = {
    id: 'assignment_computed',
    passed: false,
    message: 'No assignment has been computed for this market. Run the assignment first.',
    resolutionLink: 'assignment',
    resolutionLabel: 'Run the assignment',
  };

  it('Publish waits on running the assignment, offered from any other page', () => {
    const rail = railFor(
      [],
      {
        phase: MarketPhase.Assignment,
        transitionBlockers: { [MarketPhase.MarketDays]: [NOT_RUN] },
      },
      '/markets/market-1/applications',
    );

    const button = rail.get(fix);
    expect(button.text()).toBe('Run the assignment');
    expect(button.getComponent(RouterLinkStub).props('to')).toBe('/markets/market-1/assignment');
    expect(
      rail.get('[data-testid="phase-transition-market_days"]').attributes('disabled'),
    ).toBeDefined();
  });
});

describe('no fix is offered', () => {
  it('for a reason no one page resolves: the sentence says it', () => {
    const rail = railFor([ASKS_NOTHING]);

    expect(rail.find(fix).exists()).toBe(false);
    expect(rail.get('[data-testid="phase-rail-next"]').text()).toContain('asks nothing');
  });

  it('on the page that holds the fix, which is already in front of the organizer', () => {
    const rail = railFor([NO_LOCATION], {}, '/markets/market-1/setup');

    expect(rail.find(fix).exists()).toBe(false);
    expect(rail.get(move).attributes('disabled')).toBeDefined();
  });

  it('to someone the move is not theirs to make, whose sentence still names where it is fixed', () => {
    const rail = railFor([NO_LOCATION], { adminActionsReason: 'Only an admin moves the market.' });

    expect(rail.find(fix).exists()).toBe(false);
    expect(rail.get('[data-testid="phase-rail-next-link"]').text()).toBe('Add a location');
  });
});
