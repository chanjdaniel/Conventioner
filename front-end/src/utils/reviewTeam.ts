/**
 * Who reviews a market's applications (E38/F07/S02, ADR 0020).
 *
 * An Admin or the owner chooses reviewers, and the server deals every open application among them,
 * round robin in the order they arrived (`back-end/review_team.py`). The market read serves the
 * reviewers to every reader (`reviewTeam`) and whom the reader may choose (`reviewerCandidates`),
 * so the panel and the picker decide nothing themselves.
 */
import type { Market } from '@/assets/types/datatypes';
import { api } from '@/utils/api';

/** What the picker and the panel say, alike wherever they are drawn. */
export const NONE_CHOSEN = 'No reviewers chosen. Everyone reviews first come, first served.';
export const PICKER_HINT =
  'Choose no one and everyone reviews first come, first served. You can choose reviewers later from the Applications tab.';
export const RESHUFFLE =
  'Saving deals every open application again among the reviewers you choose. Decided applications stay where they are, and so do follow-ups, unless their owner is no longer a reviewer.';

/** The market's chosen reviewers' addresses, in the order they are dealt to. */
export function reviewerAddresses(market: Pick<Market, 'reviewTeam'> | null | undefined): string[] {
  return (market?.reviewTeam?.reviewers ?? []).map((reviewer) => reviewer.email);
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

/** Whether a choice is the stored team: the same addresses, in any order and any case. */
export function sameTeam(chosen: readonly string[], stored: readonly string[]): boolean {
  const key = (addresses: readonly string[]) =>
    [...new Set(addresses.map((address) => address.trim().toLowerCase()))].sort().join('\n');
  return key(chosen) === key(stored);
}

/** Choose the market's reviewers, the whole team; none removes every one. Answers how many the
 * choice dealt. */
export async function chooseReviewers(marketId: string, reviewers: string[]): Promise<number> {
  const response = await api.put<{ dealt: number }>(
    `/markets/${encodeURIComponent(marketId)}/reviewers`,
    { reviewers },
  );
  return response.data?.dealt ?? 0;
}
