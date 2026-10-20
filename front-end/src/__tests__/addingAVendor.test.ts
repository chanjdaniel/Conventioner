/**
 * A vendor who never applied, added by hand (E36/F03/S01), says who added them where a verdict would
 * say who gave it.
 */
import { describe, expect, it } from 'vitest';
import { addedLine } from '@/utils/verdicts';

describe('who added a vendor', () => {
  it('names them, and when', () => {
    expect(
      addedLine({ addedBy: { email: 'alex@market.test' }, addedAt: '2026-11-18T09:00:00' }),
    ).toMatch(/^Added by alex@market\.test, /);
  });

  it('says nothing of an applicant, who applied', () => {
    expect(addedLine({ addedBy: null, addedAt: null })).toBeNull();
  });
});
