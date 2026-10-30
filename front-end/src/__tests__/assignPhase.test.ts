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
    expect(assignRefusal('draft')).toContain('take its applications in');
  });

  // In words true of both paths: a Google Form market has no move called "close" (E32/F02/S01).
  it('tells an organizer whose applications are still coming in to review them', () => {
    expect(assignRefusal('applications_open')).toContain('Review them');
    expect(assignRefusal('applications_open')).not.toMatch(/close/i);
  });

  it('sends an organizer past assignment to the Assignments page, not back to Assign', () => {
    // The answer is settled and the vendors have been told; changing one placement is what is
    // wanted, and the Assignments page is where that happens (E11/F03, E22/F04/S04).
    for (const phase of ['offers', 'market_days']) {
      expect(assignRefusal(phase)).toContain('Assignments page');
    }
  });

  it('tells closed applications to review, not to close them (E30/F01/S02)', () => {
    expect(assignRefusal('applications_closed')).toContain('Applications are closed');
    expect(assignRefusal('applications_closed')).not.toContain('still coming in');
  });

  it('gives an archived market the archived reason, where no placement can change', () => {
    expect(assignRefusal('archived')).toContain('archived');
    expect(assignRefusal('archived')).not.toContain('Assignments page');
  });

  it('treats a market with no phase as a draft, which is what an unmigrated one is', () => {
    expect(assignRefusal(undefined)).toBe(assignRefusal('draft'));
  });
});
