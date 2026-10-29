/**
 * A seat given by hand to someone the review left out is marked wherever the other overrides
 * show (E36/F02/S03), and the drawer always says what was decided, whoever decided it.
 */
import { describe, expect, it } from 'vitest';
import { overrideText } from '@/utils/placementReason';
import { verdictLine } from '@/utils/verdicts';
import { ApplicationStatus } from '@/assets/types/datatypes';

describe('what a placement by hand overrides', () => {
  it('says first that they were not approved', () => {
    expect(overrideText(['not_approved'])).toBe('Assigned by hand, though not approved');
  });

  it('then every answer it crosses', () => {
    expect(overrideText(['tier', 'not_approved'])).toBe(
      'Assigned by hand, though not approved, and against their answer: a tier they did not accept, which sets their price',
    );
  });

  it('reads as before for an approved vendor', () => {
    expect(overrideText(['date'])).toBe(
      'Assigned by hand against their answer: a date they did not offer',
    );
  });
});

describe('the verdict a drawer shows', () => {
  it('names who gave it when that is recorded', () => {
    expect(
      verdictLine({
        status: ApplicationStatus.ReviewerRejected,
        verdictBy: { kind: 'person', userId: 'u-1', email: 'alex@market.test' },
        verdictAt: null,
        verdictReason: null,
      }),
    ).toBe('Rejected by alex@market.test');
  });

  it('still says the verdict when nobody is recorded as giving it', () => {
    expect(
      verdictLine({
        status: ApplicationStatus.ReviewerRejected,
        verdictBy: null,
        verdictAt: null,
        verdictReason: null,
      }),
    ).toBe('Rejected');
  });

  it('says nothing of an application nobody has decided', () => {
    expect(
      verdictLine({
        status: ApplicationStatus.Open,
        verdictBy: null,
        verdictAt: null,
        verdictReason: null,
      }),
    ).toBeNull();
  });
});
