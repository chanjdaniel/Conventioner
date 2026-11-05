/**
 * Who reviews a market's applications (E38/F07/S02, ADR 0020).
 *
 * An Admin or the owner chooses reviewers, and the server deals every open application among them,
 * round robin in the order they arrived (`back-end/review_team.py`). The market read serves the
 * reviewers to every reader (`reviewTeam`) and whom the reader may choose (`reviewerCandidates`),
 * so the panel and the picker decide nothing themselves.
 */
import { toRaw } from 'vue';
import type { Market } from '@/assets/types/datatypes';
import { useMarketStore } from '@/stores/market';
import { api } from '@/utils/api';

/** What the picker and the panel say, alike wherever they are drawn. */
export const NONE_CHOSEN = 'No reviewers chosen. Everyone reviews first come, first served.';
/** Of a chosen reviewer who no longer holds a role on the market: dealt nothing until removed. */
export const CAN_NO_LONGER_REVIEW = 'Can no longer review here';
export const PICKER_HINT =
  'Choose no one and everyone reviews first come, first served. You can choose reviewers later from the Applications tab.';
export const RESHUFFLE =
  'Saving deals every open application again among the reviewers you choose. Decided applications stay where they are, and so do follow-ups, unless their owner is no longer a reviewer.';

/** The market's chosen reviewers' addresses, in the order they are dealt to. */
export function reviewerAddresses(market: Pick<Market, 'reviewTeam'> | null | undefined): string[] {
  return (market?.reviewTeam?.reviewers ?? []).map((reviewer) => reviewer.email);
}

/**
 * The team last written over each market object. A read that fails or is overtaken leaves that market
 * held, and starting from what it says would offer the team before the write, which saving writes
 * back and deals again. Every read that lands is a new object, so an entry ends by itself; it is here
 * and not on a screen because a tab switch remounts the panel, with the same market still held, and
 * a second try at the first import or at opening applications starts over on it.
 */
const writtenOver = new WeakMap<object, readonly string[]>();

/** A write of the team the server has not answered, which outlives the screen that started it. */
interface TeamWrite {
  team: readonly string[];
  answer: Promise<number>;
}
const unanswered = new Map<string, TeamWrite>();

/** The write of this market's team still unanswered, so a panel drawn during it can hold on it. */
export function unansweredWrite(marketId: string): TeamWrite | undefined {
  return unanswered.get(marketId);
}

/**
 * Whom a change of reviewers starts from, and what a choice is compared with: the team being written,
 * else the team written over this market, else what it says.
 */
export function teamToChange(market: Market | null | undefined): string[] {
  if (!market) return [];
  const known = unanswered.get(market.id)?.team ?? writtenOver.get(toRaw(market));
  return known ? [...known] : reviewerAddresses(market);
}

/**
 * Whom the picker lists: every candidate, and every current reviewer even when the reader is not
 * offered them, so a reviewer is never dropped by saving without touching them. Sorted, each once.
 */
export function pickerChoices(candidates: readonly string[], current: readonly string[]): string[] {
  const seen = new Map<string, string>();
  for (const address of [...candidates, ...current]) {
    const key = address.trim().toLowerCase();
    if (key && !seen.has(key)) seen.set(key, address.trim());
  }
  return [...seen.keys()].sort().map((key) => seen.get(key) as string);
}

/** Whether a choice is that team: the same addresses, in any order and any case. */
export function sameTeam(chosen: readonly string[], team: readonly string[]): boolean {
  const key = (addresses: readonly string[]) =>
    [...new Set(addresses.map((address) => address.trim().toLowerCase()))].sort().join('\n');
  return key(chosen) === key(team);
}

async function writeTeam(marketId: string, team: readonly string[]): Promise<number> {
  const response = await api.put<{ dealt: number }>(
    `/markets/${encodeURIComponent(marketId)}/reviewers`,
    { reviewers: team },
  );
  // Over the market held now: one a read landed during the write may have replaced the one before it.
  const held = useMarketStore().market;
  if (held?.id === marketId) writtenOver.set(toRaw(held), team);
  return response.data?.dealt ?? 0;
}

/** Choose the market's reviewers, the whole team; none removes every one. Answers how many the
 * choice dealt. */
export function chooseReviewers(marketId: string, reviewers: readonly string[]): Promise<number> {
  const team = [...reviewers];
  const write: TeamWrite = {
    team,
    answer: writeTeam(marketId, team).finally(() => {
      if (unanswered.get(marketId) === write) unanswered.delete(marketId);
    }),
  };
  unanswered.set(marketId, write);
  return write.answer;
}
