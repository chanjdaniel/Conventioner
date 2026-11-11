/**
 * A layout's save that did not land says why, and what to do (T257 ticket 02).
 */
import { describe, expect, it } from 'vitest';
import { SAVE_FAILED, STALE_LAYOUT, saveRefusal } from '@/components/layout/layoutSave';

function refused(status: number | null, error?: string) {
  return Object.assign(new Error('refused'), {
    isAxiosError: true,
    response: status === null ? undefined : { status, data: error ? { error } : {} },
  });
}

describe("a layout save's refusal", () => {
  it('asks for a reload when another save landed first', () => {
    expect(saveRefusal(refused(409, STALE_LAYOUT))).toEqual({
      kind: 'stale',
      message: STALE_LAYOUT,
    });
  });

  it("says another 409's sentence as a failure", () => {
    expect(saveRefusal(refused(409, 'The setup has settled.'))).toEqual({
      kind: 'failed',
      message: 'The setup has settled.',
    });
  });

  it("says the server's sentence for a refusal", () => {
    expect(saveRefusal(refused(400, 'Every table must stand inside the floorplan.'))).toEqual({
      kind: 'failed',
      message: 'Every table must stand inside the floorplan.',
    });
  });

  it('says the one failure sentence when no answer came, or the server failed', () => {
    for (const err of [refused(null), refused(500), refused(502, 'Bad gateway')]) {
      expect(saveRefusal(err)).toEqual({ kind: 'failed', message: SAVE_FAILED });
    }
  });
});
