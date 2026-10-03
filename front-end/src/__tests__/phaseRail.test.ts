/**
 * The rail: the lifecycle as a band below the market header (`E10/F01`).
 *
 * It replaces a strip of coloured pills that floated above the card, labelled "Current Phase:" in
 * white on a white page, and drew every transition as an advance - including the one
 * unambiguously backwards edge in the machine.
 */
import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import PhaseRail from '@/components/PhaseRail.vue';
import { MarketPhase, type Market } from '@/assets/types/datatypes';

function railFor(phase: MarketPhase, overrides: Partial<Market> = {}) {
  return mount(PhaseRail, {
    props: {
      market: {
        id: 'market-1',
        name: 'Riverside',
        phase,
        ...overrides,
      } as Market,
    },
    global: { stubs: { Teleport: true, BlockerPanel: true } },
  });
}

describe('the spine', () => {
  it('draws every stage of the lifecycle, offers excluded', () => {
    const labels = railFor(MarketPhase.Draft)
      .findAll('.phase-step')
      .map((step) => step.attributes('data-phase'));

    expect(labels).toEqual([
      'draft',
      'applications_open',
      'applications_closed',
      'review',
      'assignment',
      'market_days',
      'archived',
    ]);
  });

  it('marks where the market is, and fills what it has passed', () => {
    const steps = railFor(MarketPhase.Review).findAll('.phase-step');
    const states = Object.fromEntries(
      steps.map((s) => [s.attributes('data-phase'), s.attributes('data-state')]),
    );

    expect(states.draft).toBe('done');
    expect(states.applications_closed).toBe('done');
    expect(states.review).toBe('current');
    expect(states.assignment).toBe('todo');
  });

  it('labels every stage in words a person reads', () => {
    const rail = railFor(MarketPhase.Draft);

    expect(rail.text()).toContain('Applications Open');
    expect(rail.text()).toContain('Market Days');
  });
});

describe('the actions', () => {
  it('puts the one step onward on the rail itself', () => {
    const rail = railFor(MarketPhase.Review);

    expect(rail.get('[data-testid="phase-transition-assignment"]').text()).toBe('Begin Assignment');
  });

  it('does not present reopening for editing as an advance', async () => {
    // The hole in the special cases this replaces: `applications_open -> draft` fell through to
    // `advance` and was drawn as the way onward.
    const rail = railFor(MarketPhase.ApplicationsOpen);

    expect(rail.find('[data-testid="phase-transition-draft"]').exists()).toBe(false);

    await rail.get('[data-testid="phase-rail-menu-button"]').trigger('click');
    const reopen = rail.get('[data-testid="phase-transition-draft"]');
    expect(reopen.attributes('data-direction')).toBe('back');
    expect(reopen.text()).toBe('Reopen for Editing');
  });

  it('keeps archiving out of the forward action, in every phase', async () => {
    for (const phase of [MarketPhase.Draft, MarketPhase.Review, MarketPhase.Assignment]) {
      const rail = railFor(phase);
      expect(rail.find('[data-testid="phase-transition-archived"]').exists()).toBe(false);

      await rail.get('[data-testid="phase-rail-menu-button"]').trigger('click');
      expect(
        rail.get('[data-testid="phase-transition-archived"]').attributes('data-direction'),
      ).toBe('end');
    }
  });

  it('offers nothing onward from the end', () => {
    const rail = railFor(MarketPhase.Archived);

    expect(rail.find('.rail-button--forward').exists()).toBe(false);
  });

  it('offers no phase move to someone whose role does not make them (bug 37)', () => {
    // Moving the phase is an admin action; an Editor or a Viewer was offered every move, and each
    // failed with a 403 in small red text under the rail.
    const rail = railFor(MarketPhase.Review, {
      adminActionsReason: 'Moving this market phase is for its owner and admins.',
    });

    expect(rail.find('.rail-button--forward').exists()).toBe(false);
    expect(rail.find('[data-testid="phase-rail-menu-button"]').exists()).toBe(false);
    // The rail still says where the market stands.
    expect(rail.find('[data-testid="phase-rail-current"]').text()).toContain('Review');
  });
});

describe('a market that left the spine', () => {
  it('says in words that it is over, rather than only striking the rail through', () => {
    // The prototype settled this: strikethrough alone reads as stopped, not as archived - a
    // reader cannot tell a deliberately-ended rail from a broken one.
    const rail = railFor(MarketPhase.Archived);

    expect(rail.get('[data-testid="phase-rail-frozen"]').text()).toContain(
      'This market is archived',
    );
  });

  function statesOf(rail: ReturnType<typeof railFor>) {
    return Object.fromEntries(
      rail
        .findAll('.phase-step')
        .map((s) => [s.attributes('data-phase'), s.attributes('data-state')]),
    );
  }

  function archivedHaving(phasesReached: string[], phaseRecordComplete = true) {
    return railFor(MarketPhase.Archived, { phasesReached, phaseRecordComplete });
  }

  it('freezes at the furthest stage its record reached, and says what became of it', () => {
    const assigned = archivedHaving(['draft', 'applications_open', 'assignment', 'archived']);

    expect(assigned.get('[data-testid="phase-rail-frozen"]').text()).toContain('never published');
    const states = statesOf(assigned);
    expect(states.assignment).toBe('done');
    expect(states.market_days).toBe('frozen');
  });

  it('says a market that ran ran, which evidence alone never could (bug 8)', () => {
    const ran = archivedHaving(['draft', 'assignment', 'market_days', 'archived']);

    expect(ran.get('[data-testid="phase-rail-frozen"]').text()).toContain(
      'It was published and ran its market days.',
    );
    expect(statesOf(ran).market_days).toBe('done');
  });

  it('says a market opened applications though it went back to draft after', () => {
    const reopened = archivedHaving(['draft', 'applications_open', 'archived']);

    expect(reopened.text()).toContain('It opened applications but was never assigned.');
  });

  it('says it was abandoned when its record never left draft', () => {
    expect(archivedHaving(['draft', 'archived']).text()).toContain(
      'abandoned before it opened applications',
    );
  });

  describe('when the market predates its record', () => {
    it('says what it can prove and nothing about what it cannot', () => {
      const rail = archivedHaving(['draft', 'assignment', 'archived'], false);
      const note = rail.get('[data-testid="phase-rail-frozen"]').text();

      expect(note).toContain('It was assigned.');
      expect(note).not.toContain('never');
    });

    it('strikes nothing through, since a stage it is not known to have reached is unknown', () => {
      const states = statesOf(archivedHaving(['draft', 'assignment', 'archived'], false));

      expect(states.assignment).toBe('done');
      expect(states.market_days).toBe('todo');
    });

    it('says only that it is archived when it can prove nothing', () => {
      const note = archivedHaving(['draft', 'archived'], false)
        .get('[data-testid="phase-rail-frozen"]')
        .text();

      expect(note.trim()).toBe('This market is archived.');
    });
  });
});

describe('the check-in URL', () => {
  it('is on the rail once the market is published', () => {
    const rail = railFor(MarketPhase.MarketDays, { slug: 'riverside-market' });

    expect(rail.get('[data-testid="phase-rail-checkin"]').text()).toContain(
      '/riverside-market/check-in',
    );
  });

  it('is absent before publishing, because it would be a link to a 404', () => {
    for (const phase of [MarketPhase.Draft, MarketPhase.Review, MarketPhase.Assignment]) {
      expect(
        railFor(phase, { slug: 'riverside-market' })
          .find('[data-testid="phase-rail-checkin"]')
          .exists(),
      ).toBe(false);
    }
  });

  it('copies in one action', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    const rail = railFor(MarketPhase.MarketDays, { slug: 'riverside-market' });
    await rail.get('[data-testid="phase-rail-checkin-copy"]').trigger('click');

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('/riverside-market/check-in'));
    vi.unstubAllGlobals();
  });
});

describe('a phase the lifecycle does not draw', () => {
  it('gets its stage back when a market is actually in it', () => {
    // `offers` is off the spine because nothing sets `assignment_sent`. A market that reached it
    // anyway must still be marked somewhere: a rail with no marker says nothing about where the
    // market stands.
    const rail = railFor(MarketPhase.Offers);
    const phases = rail.findAll('.phase-step').map((s) => s.attributes('data-phase'));

    expect(phases).toContain('offers');
    // At the place the transition table puts it - after the phase it is reached from.
    expect(phases.indexOf('offers')).toBe(phases.indexOf('assignment') + 1);
    expect(rail.get('[data-testid="phase-rail-current"]').attributes('data-phase')).toBe('offers');
  });

  it('is absent from every market that is not in it', () => {
    for (const phase of [MarketPhase.Assignment, MarketPhase.MarketDays, MarketPhase.Archived]) {
      const phases = railFor(phase)
        .findAll('.phase-step')
        .map((s) => s.attributes('data-phase'));
      expect(phases).not.toContain('offers');
    }
  });
});
