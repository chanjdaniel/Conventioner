/**
 * A reviewer holds the card they look at (E34/F03/S02): the next card is the server's to hand
 * out, claimed for them; the claim is renewed while it stays open and let go on leaving.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { CLAIM_RENEWAL_MS, IDLE_AFTER_MS, useReviewClaims } from '@/utils/reviewClaims';

const api = vi.hoisted(() => ({ post: vi.fn(), put: vi.fn(), delete: vi.fn() }));
vi.mock('@/utils/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/api')>()),
  api,
}));

beforeEach(() => {
  vi.useFakeTimers();
  api.post.mockResolvedValue({ data: { application: { id: 'app-2' } } });
  api.put.mockResolvedValue({ data: { held: true } });
  api.delete.mockResolvedValue({ data: { held: false } });
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('the card a reviewer holds', () => {
  it('is asked of the server, after the one moved on from', async () => {
    const claims = useReviewClaims(ref('market-1'));

    const app = await claims.next('app-1', true);

    expect(api.post).toHaveBeenCalledWith('/markets/market-1/review/next', {
      after: 'app-1',
      includeFollowUps: true,
    });
    expect(app?.id).toBe('app-2');
    expect(claims.held.value).toBe('app-2');
  });

  it('is renewed while it stays open, and let go on leaving', async () => {
    const claims = useReviewClaims(ref('market-1'));
    await claims.next(null, false);

    await vi.advanceTimersByTimeAsync(CLAIM_RENEWAL_MS);
    expect(api.put).toHaveBeenCalledWith('/markets/market-1/applications/app-2/claim');

    claims.release();
    expect(api.delete).toHaveBeenCalledWith('/markets/market-1/applications/app-2/claim');
    await vi.advanceTimersByTimeAsync(CLAIM_RENEWAL_MS * 2);
    expect(api.put).toHaveBeenCalledTimes(1);
  });

  it('holds nothing when every card left is held by someone else', async () => {
    api.post.mockResolvedValue({ data: { application: null } });
    const claims = useReviewClaims(ref('market-1'));

    expect(await claims.next(null, false)).toBeNull();
    expect(claims.held.value).toBeNull();
  });
});

describe('an idle reviewer', () => {
  it('stops renewing, so the card lapses to someone else', async () => {
    const claims = useReviewClaims(ref('market-1'));
    await claims.next(null, false);

    await vi.advanceTimersByTimeAsync(IDLE_AFTER_MS + CLAIM_RENEWAL_MS);

    // Renewed only while within five minutes of the last thing they did.
    expect(api.put.mock.calls.length).toBeLessThan(IDLE_AFTER_MS / CLAIM_RENEWAL_MS);
    const before = api.put.mock.calls.length;
    await vi.advanceTimersByTimeAsync(CLAIM_RENEWAL_MS * 3);
    expect(api.put.mock.calls.length).toBe(before);
  });

  it('keeps holding while they are at it', async () => {
    const claims = useReviewClaims(ref('market-1'));
    await claims.next(null, false);

    for (let minute = 0; minute < 8; minute++) {
      claims.touch();
      await vi.advanceTimersByTimeAsync(CLAIM_RENEWAL_MS);
    }

    expect(api.put).toHaveBeenCalledTimes(8);
  });
});
