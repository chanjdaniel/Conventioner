/**
 * The lifecycle spine the rail draws, and which way each transition moves along it.
 *
 * Derived from `VALID_TRANSITIONS` rather than listed beside it (`E10/F01/S01`): a second list
 * is the drift `_validate_registry()` refuses on the server.
 */
import { describe, expect, it } from 'vitest';
import { phaseSpine, transitionDirection, VALID_TRANSITIONS } from '@/utils/phase';

describe('the spine', () => {
  it('is the lifecycle in order, ending at archived', () => {
    expect(phaseSpine()).toEqual([
      'draft',
      'applications_open',
      'applications_closed',
      'review',
      'assignment',
      'market_days',
      'archived',
    ]);
  });

  it('leaves offers off it', () => {
    // Nothing in the product sets `assignment_sent`, so the edge is real in the table and dead
    // in practice. Drawing it would show a stage no market will reach.
    expect(phaseSpine()).not.toContain('offers');
  });

  it('follows the table rather than a copy of it', () => {
    const shortened = VALID_TRANSITIONS.filter(
      ([from, to]) => !(from === 'applications_closed' && to === 'review'),
    );

    expect(phaseSpine(shortened)).toEqual([
      'draft',
      'applications_open',
      'applications_closed',
      'archived',
    ]);
  });

  it('stops rather than guessing when the table forks', () => {
    const forked: Array<[string, string]> = [...VALID_TRANSITIONS, ['draft', 'review']];

    expect(phaseSpine(forked)).toEqual(['draft', 'archived']);
  });
});

describe('which way a transition goes', () => {
  it('calls the next stage forward', () => {
    expect(transitionDirection('review', 'assignment')).toBe('forward');
    expect(transitionDirection('assignment', 'market_days')).toBe('forward');
  });

  it('calls reopening for editing backwards, which the old special cases did not', () => {
    // `applications_open -> draft` is the one unambiguously backwards edge in the machine, and
    // it fell through to `advance` - drawn as the way onward.
    expect(transitionDirection('applications_open', 'draft')).toBe('back');
    expect(transitionDirection('applications_closed', 'applications_open')).toBe('back');
    expect(transitionDirection('review', 'applications_closed')).toBe('back');
  });

  it('calls archiving the end, from every phase', () => {
    for (const from of phaseSpine()) {
      expect(transitionDirection(from, 'archived')).toBe('end');
    }
  });

  it('calls a phase off the spine aside, neither forward nor back', () => {
    expect(transitionDirection('assignment', 'offers')).toBe('aside');
  });
});
