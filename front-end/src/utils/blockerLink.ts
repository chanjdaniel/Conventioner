import type { Market, PreconditionResult } from '@/assets/types/datatypes';
import { resolutionPath } from '@/utils/market';
import { mayTake } from '@/utils/marketActions';

/**
 * Where a blocker's fix is done, as a path of this market, or null where no link should be offered.
 *
 * A link is offered only for someone the market's table lets take the action it leads to
 * (T142): a link to work that is not theirs sends them to a page that refuses it. A blocker that
 * names no page or no action, as from an older server, offers none. The blocker is said either
 * way; this decides only the link.
 *
 * The one rule for every list of blockers, so no two lists of them disagree on who is sent where.
 * Whether the link leads somewhere from the page it is read on is the reader's to judge
 * (`BlockerPanel` drops a link to the page already open).
 */
export function blockerLink(
  market: Pick<Market, 'id' | 'actionRefusals'>,
  blocker: PreconditionResult,
): string | null {
  if (!blocker.resolutionLink || !mayTake(market, blocker.resolutionAction)) return null;
  return resolutionPath(market.id, blocker.resolutionLink);
}
