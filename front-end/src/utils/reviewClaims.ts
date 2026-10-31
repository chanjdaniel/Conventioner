import { getCurrentInstance, onUnmounted, ref, type Ref } from 'vue';
import { api } from '@/utils/api';
import type { Application } from '@/assets/types/datatypes';

/** How often the open card's claim is renewed: well inside the server's five-minute lease. */
export const CLAIM_RENEWAL_MS = 60_000;
/** A reviewer idle this long stops renewing, and the server's lease runs out on the card. */
export const IDLE_AFTER_MS = 5 * 60_000;

/**
 * The card a reviewer holds (E34/F03/S02).
 *
 * The next card is the server's to hand out - the next undecided application nobody else holds,
 * claimed as it is handed over - so two reviewers pressing Next together walk different cards. The
 * claim is renewed while the reviewer is at it (`touch`), so a tab left open holds nothing after
 * five idle minutes; it is let go on leaving, and a verdict lets it go on the server. A claim never
 * refuses a reviewer's own verdict on a card: what keeps verdicts consistent is that each is written
 * only on what its reviewer saw (S01). A selection leaves out what someone else holds (F04/S02).
 *
 * Hand-outs can overlap - a Next pressed again, a verdict, a refresh - and their answers can come
 * back in either order, so only the newest is taken: an answer to one a later hand-out, or leaving,
 * overtook holds nothing and is not put up (the Next race, E38/F07/S04). Its card was claimed on
 * the server all the same, so it is let go once the newest hand-out has answered, unless that is
 * the card now held: letting go before then could release the very card the newest hands over.
 */
export function useReviewClaims(marketId: Ref<string>) {
  const held = ref<string | null>(null);
  let renewal: ReturnType<typeof setInterval> | null = null;
  let lastActive = Date.now();
  /** Bumped by every hand-out and by leaving, so an answer can tell it has been overtaken. */
  let asked = 0;
  /** `asked` when the reviewer last left: a hand-out answering after it lets its card go. */
  let left = 0;
  /** The newest hand-out that has answered: once it is `asked`, nothing newer is out. */
  let answered = 0;
  /** Cards overtaken hand-outs claimed while a newer one was still out, to let go once it answers. */
  const overtaken = new Set<string>();

  /** The reviewer did something: their card is still theirs. */
  function touch() {
    lastActive = Date.now();
  }

  function stopRenewing() {
    if (renewal !== null) clearInterval(renewal);
    renewal = null;
  }

  async function renew() {
    const id = held.value;
    if (!id || !marketId.value) return;
    // Idle: stop holding, and let the lease run out for someone else.
    if (Date.now() - lastActive >= IDLE_AFTER_MS) {
      stopRenewing();
      return;
    }
    try {
      const { data } = await api.put(`/markets/${marketId.value}/applications/${id}/claim`);
      if (!data?.held && held.value === id) held.value = null;
    } catch {
      // A missed renewal costs nothing until the lease runs out; the next one tries again.
    }
  }

  /**
   * Hand over the next card after `after`, claimed - or `want`, one asked for by name, when it is
   * free; null when every one left is held elsewhere; undefined when a later hand-out, or leaving,
   * overtook this one before it answered, so its card is not the one to put up. A chosen reviewer
   * is handed their own share first, and with `mineOnly` nothing else (E38/F07/S04).
   */
  async function next(
    after: string | null,
    includeFollowUps: boolean,
    want: string | null = null,
    mineOnly = false,
  ): Promise<Application | null | undefined> {
    touch();
    const mine = ++asked;
    let data;
    try {
      ({ data } = await api.post(`/markets/${marketId.value}/review/next`, {
        after,
        includeFollowUps,
        ...(want ? { want } : {}),
        ...(mineOnly ? { mineOnly } : {}),
      }));
    } catch (err) {
      if (mine !== asked) return undefined;
      settle(mine);
      throw err;
    }
    const app = (data?.application ?? null) as Application | null;
    if (mine !== asked) {
      // Claimed on the server for nobody's open card: let it go now if the reviewer has left or
      // the newest hand-out has answered with another, else once that one answers.
      if (app) {
        if (left === asked || (answered === asked && app.id !== held.value)) letGo(app.id);
        else if (answered !== asked) overtaken.add(app.id);
      }
      return undefined;
    }
    held.value = app?.id ?? null;
    stopRenewing();
    if (app) renewal = setInterval(() => void renew(), CLAIM_RENEWAL_MS);
    settle(mine);
    return app;
  }

  /** The newest hand-out answered: let go of what the ones it overtook claimed, but its own card. */
  function settle(mine: number) {
    answered = mine;
    for (const id of overtaken) if (id !== held.value) letGo(id);
    overtaken.clear();
  }

  /** Let go of the held card: leaving the review, or the tab. */
  function release() {
    left = ++asked;
    for (const id of overtaken) letGo(id);
    overtaken.clear();
    const id = held.value;
    stopRenewing();
    held.value = null;
    if (id) letGo(id);
  }

  function letGo(id: string) {
    if (!marketId.value) return;
    void api.delete(`/markets/${marketId.value}/applications/${id}/claim`).catch(() => undefined);
  }

  if (getCurrentInstance()) onUnmounted(release);
  return { held, next, release, touch };
}
