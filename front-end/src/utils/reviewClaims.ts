import { getCurrentInstance, onUnmounted, ref, type Ref } from 'vue';
import { api } from '@/utils/api';
import type { Application } from '@/assets/types/datatypes';

/** How often the open card's claim is renewed: well inside the server's five-minute lease. */
export const CLAIM_RENEWAL_MS = 60_000;

/**
 * The card a reviewer holds (E34/F03/S02).
 *
 * The next card is the server's to hand out - the next undecided application nobody else holds,
 * claimed as it is handed over - so two reviewers pressing Next together walk different cards. The
 * claim is renewed while the card stays open, and let go on leaving; a verdict lets it go on the
 * server. A claim never refuses a verdict: what keeps verdicts consistent is that each is written
 * only on what its reviewer saw (S01).
 */
export function useReviewClaims(marketId: Ref<string>) {
  const held = ref<string | null>(null);
  let renewal: ReturnType<typeof setInterval> | null = null;

  function stopRenewing() {
    if (renewal !== null) clearInterval(renewal);
    renewal = null;
  }

  async function renew() {
    const id = held.value;
    if (!id || !marketId.value) return;
    try {
      const { data } = await api.put(`/markets/${marketId.value}/applications/${id}/claim`);
      if (!data?.held && held.value === id) held.value = null;
    } catch {
      // A missed renewal costs nothing until the lease runs out; the next one tries again.
    }
  }

  /** Hand over the next card after `after`, claimed; null when every one left is held elsewhere. */
  async function next(
    after: string | null,
    includeFollowUps: boolean,
  ): Promise<Application | null> {
    const { data } = await api.post(`/markets/${marketId.value}/review/next`, {
      after,
      includeFollowUps,
    });
    const app = (data?.application ?? null) as Application | null;
    held.value = app?.id ?? null;
    stopRenewing();
    if (app) renewal = setInterval(() => void renew(), CLAIM_RENEWAL_MS);
    return app;
  }

  /** Let go of the held card: leaving the review, or the tab. */
  function release() {
    const id = held.value;
    stopRenewing();
    held.value = null;
    if (id && marketId.value) {
      void api.delete(`/markets/${marketId.value}/applications/${id}/claim`).catch(() => undefined);
    }
  }

  if (getCurrentInstance()) onUnmounted(release);
  return { held, next, release };
}
