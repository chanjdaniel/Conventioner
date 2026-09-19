/**
 * Assign runs in the assignment phase and nowhere else (`E10/F03/S02`).
 *
 * Mirrors `assign_phase_refusal` in `back-end/api/placements.py`, which is the enforcement: the
 * endpoint is reachable directly, and a hidden button is not a rule. This is what lets the button
 * say no before it is pressed.
 */
import { describe, expect, it } from 'vitest';
import { assignRefusal, canAssignIn } from '@/utils/assignPhase';

describe('where the assignment may be run', () => {
  it('runs in the assignment phase', () => {
    expect(canAssignIn('assignment')).toBe(true);
    expect(assignRefusal('assignment')).toBeNull();
  });

  it.each([
    'draft',
    'applications_open',
    'applications_closed',
    'review',
    'offers',
    'market_days',
    'archived',
  ])('refuses in %s', (phase) => {
    expect(canAssignIn(phase)).toBe(false);
    expect(assignRefusal(phase)).toBeTruthy();
  });

  it('names a way forward from a draft, not a way back', () => {
    expect(assignRefusal('draft')).toContain('open applications');
  });

  it('tells an organizer still collecting applications to close them', () => {
    expect(assignRefusal('applications_open')).toContain('Close them');
  });

  it('sends an organizer past assignment to the Tables view, not back to Assign', () => {
    // The answer is settled and the vendors have been told; changing one placement is what is
    // wanted, and that is what the Tables view is for (E11/F03).
    for (const phase of ['offers', 'market_days', 'archived']) {
      expect(assignRefusal(phase)).toContain('Tables view');
    }
  });

  it('treats a market with no phase as a draft, which is what an unmigrated one is', () => {
    expect(assignRefusal(undefined)).toBe(assignRefusal('draft'));
  });
});
