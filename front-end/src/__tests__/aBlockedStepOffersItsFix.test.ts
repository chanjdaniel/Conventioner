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
import {
  ADMIN_ANSWERS,
  answersRefusing,
  EDITOR_ANSWERS,
  VIEWER_ANSWERS,
} from './support/servedAnswers';
import { MarketAction } from '@/utils/marketActions';

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
  resolutionAction: MarketAction.ChangeSetup,
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
        transitionBlockers: { [MarketPhase.Applications]: blockers },
        actionRefusals: answersRefusing(),
        ...overrides,
      } as Market,
    },
    global: { stubs: { Teleport: true, BlockerPanel: true, RouterLink: RouterLinkStub } },
  });
}

const move = '[data-testid="phase-transition-applications"]';
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
    message: 'No tables have been allocated for this market. Allocate tables first.',
    resolutionLink: 'settings',
    resolutionLabel: 'Allocate tables',
    resolutionAction: MarketAction.Assign,
  };

  it('Publish waits on allocating tables, offered from any other page', () => {
    const rail = railFor(
      [],
      {
        phase: MarketPhase.Assignment,
        transitionBlockers: { [MarketPhase.MarketDays]: [NOT_RUN] },
      },
      '/markets/market-1/applications',
    );

    const button = rail.get(fix);
    expect(button.text()).toBe('Allocate tables');
    expect(button.getComponent(RouterLinkStub).props('to')).toBe('/markets/market-1/settings');
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
    const rail = railFor([NO_LOCATION], {
      actionRefusals: answersRefusing(MarketAction.MovePhase),
    });

    expect(rail.find(fix).exists()).toBe(false);
    expect(rail.get('[data-testid="phase-rail-next-link"]').text()).toBe('Add a location');
  });
});

/*
 * The rail offers a remedy or a step only to someone who may take the action it leads to (T142):
 * the rail told a Viewer "Pick market dates", a link to a page where every control was disabled.
 * The sentence still says where the market stands, for everyone.
 */
describe('a remedy or a step is offered only to someone who may take it', () => {
  const NO_DATES: PreconditionResult = {
    id: 'setup_has_dates',
    passed: false,
    message: 'This market has no dates. Pick them on Market Setup.',
    resolutionLink: 'setup',
    resolutionLabel: 'Pick market dates',
    resolutionAction: MarketAction.ChangeSetup,
  };
  const next = '[data-testid="phase-rail-next"]';
  const nextLink = '[data-testid="phase-rail-next-link"]';
  const draftMissingDates = (actionRefusals: Record<string, string | null>) =>
    railFor([NO_DATES], { actionRefusals }, '/markets/market-1/tools');

  it('a Viewer reads where a draft missing dates stands, and is offered no step', () => {
    const rail = draftMissingDates(VIEWER_ANSWERS);

    expect(rail.get(next).text()).toContain('no dates');
    expect(rail.find(fix).exists()).toBe(false);
    expect(rail.find(nextLink).exists()).toBe(false);
  });

  it('an Editor, who may change the setup, is still led to pick the dates', () => {
    const rail = draftMissingDates(EDITOR_ANSWERS);

    expect(rail.find(fix).exists()).toBe(false);
    const link = rail.get(nextLink);
    expect(link.text()).toBe('Pick market dates');
    expect(link.getComponent(RouterLinkStub).props('to')).toBe('/markets/market-1/setup');
  });

  it('an Admin is offered the fix as before', () => {
    const rail = draftMissingDates(ADMIN_ANSWERS);

    expect(rail.get(fix).text()).toBe('Pick market dates');
    expect(rail.find(nextLink).exists()).toBe(false);
  });

  it('an Admin whose table refuses the setup is offered neither the fix nor the link', () => {
    const rail = draftMissingDates(answersRefusing(MarketAction.ChangeSetup));

    expect(rail.get(next).text()).toContain('no dates');
    expect(rail.find(fix).exists()).toBe(false);
    expect(rail.find(nextLink).exists()).toBe(false);
    expect(rail.get(move).attributes('disabled')).toBeDefined();
  });

  it('a blocker that names no action, from an older server, offers nothing', () => {
    const older = { ...NO_DATES, resolutionAction: undefined };
    const rail = railFor([older], { actionRefusals: ADMIN_ANSWERS }, '/markets/market-1/tools');

    expect(rail.find(fix).exists()).toBe(false);
    expect(rail.find(nextLink).exists()).toBe(false);
  });

  describe('at the door, from another tab', () => {
    const door = (actionRefusals: Record<string, string | null>) =>
      railFor(
        [],
        { phase: MarketPhase.MarketDays, transitionBlockers: {}, actionRefusals },
        '/markets/market-1/tools',
      );

    it('a Viewer, who may not check vendors in, is offered no "Go there"', () => {
      const rail = door(VIEWER_ANSWERS);

      expect(rail.get(next).text()).toContain('Check vendors in at the door.');
      expect(rail.find(nextLink).exists()).toBe(false);
    });

    it('an Editor, who may, is', () => {
      const rail = door(EDITOR_ANSWERS);

      const link = rail.get(nextLink);
      expect(link.text()).toBe('Go there');
      expect(link.getComponent(RouterLinkStub).props('to')).toBe('/markets/market-1/attendance');
    });
  });
});
