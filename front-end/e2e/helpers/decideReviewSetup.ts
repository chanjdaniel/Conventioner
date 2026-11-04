import type { APIRequestContext } from '@playwright/test';

/**
 * Decides a draft's review setup through its own writes, as an organizer's two "none" buttons on
 * Review setup do (T206): nothing leads the card, and no answer rejects an application. Review
 * waits on both, so every shared seed that leaves a draft ready for Review calls this, and a spec
 * that takes a draft into Review by its own request calls it first; a spec about the decisions
 * asks its seed to leave them undecided.
 *
 * `request` holds the session of someone who may change the form (the seed's owner).
 */
export async function decideReviewSetup(
  request: APIRequestContext,
  baseURL: string,
  marketId: string,
): Promise<void> {
  const writes: [string, Record<string, unknown>][] = [
    ['review-highlights', { keys: [], nothingLeadsTheCard: true }],
    ['rejection-rules', { rules: [], noAutomaticRejections: true }],
  ];
  for (const [path, data] of writes) {
    const res = await request.put(`${baseURL}/markets/${marketId}/${path}`, { data });
    if (!res.ok()) {
      throw new Error(`Deciding ${path} failed: ${res.status()} ${await res.text()}`);
    }
  }
}
