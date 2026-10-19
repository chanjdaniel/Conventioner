/**
 * Every verdict says who gave it (E34/F01/S01): "Approved by alex@market.test", with when. An
 * application decided before verdicts recorded their giver says nothing about one.
 */
import { describe, expect, it } from 'vitest';
import { ApplicationStatus } from '@/assets/types/datatypes';
import { verdictGiverLine } from '@/utils/verdicts';

const ALEX = { kind: 'person' as const, userId: 'user-alex', email: 'alex@market.test' };

describe('who gave a verdict', () => {
  it('names the person and the moment', () => {
    const line = verdictGiverLine({
      status: ApplicationStatus.ReviewerApproved,
      verdictBy: ALEX,
      verdictAt: '2026-10-19T17:04:00Z',
    });

    // In the viewer's own time zone, so the day itself is theirs.
    expect(line).toMatch(/^Approved by alex@market\.test, Oct \d+, 2026 at \d/);
  });

  it('says a rejection is the reviewer’s too', () => {
    expect(verdictGiverLine({ status: ApplicationStatus.ReviewerRejected, verdictBy: ALEX })).toBe(
      'Rejected by alex@market.test',
    );
  });

  it('says nothing of a giver nobody recorded', () => {
    expect(verdictGiverLine({ status: ApplicationStatus.ReviewerApproved })).toBeNull();
    expect(
      verdictGiverLine({ status: ApplicationStatus.ReviewerApproved, verdictBy: null }),
    ).toBeNull();
  });

  it('says a rule rejected it, and why (E33/F03/S02)', () => {
    expect(
      verdictGiverLine({
        status: ApplicationStatus.ReviewerRejected,
        verdictBy: { kind: 'rule', rule: 'no_shows' },
        verdictReason: 'Did not tick “I understand that no-shows”',
      }),
    ).toBe('Rejected automatically: Did not tick “I understand that no-shows”');
  });
});
