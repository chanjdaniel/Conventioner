/**
 * Which surface of the market workspace a phase is worked on (E18/F02/S02).
 *
 * The workspace used to open on the plan whatever the market was doing - `tabFromRoute` fell back
 * to `'setup'` unconditionally and never looked at the market - so an organizer returning to a
 * market mid-review landed on its dates.
 *
 * The original finding asked for the opposite of what ships here: it wanted a market to open on
 * the application form until that was finalized, then on the plan. Ticket 01 settled that the plan
 * comes FIRST and the form is built from it, so that rule is backwards and does not survive. What
 * replaces it is this: open the surface the phase is worked on.
 *
 * Three phases share one surface, which ticket 11 settled by measuring rather than assuming:
 * recording a verdict has no phase gate at all, importing spans two of the three, and
 * applications-closed changes nothing for a CSV market. Three screens would have meant two
 * near-identical ones on every market this product currently serves.
 */
import { MarketPhase } from '@/assets/types/datatypes';

export type MarketSurface = 'setup' | 'form' | 'applications' | 'assignment';

export const MARKET_SURFACES: MarketSurface[] = ['setup', 'form', 'applications', 'assignment'];

/**
 * The surface a market in this phase is worked on.
 *
 * `draft` opens on the PLAN rather than the form, because the form is built from the plan - the
 * back end states it outright: the essential questions' offering "is never an independent list: it
 * is the market plan itself". Which of draft's two stages the surface itself opens at is the draft
 * page's own business (E18/F01/S01).
 */
export function surfaceForPhase(phase: string | undefined | null): MarketSurface {
  switch (phase) {
    case MarketPhase.Draft:
      return 'setup';
    case MarketPhase.ApplicationsOpen:
    case MarketPhase.ApplicationsClosed:
    case MarketPhase.Review:
      return 'applications';
    case MarketPhase.Assignment:
    case MarketPhase.Offers:
    case MarketPhase.MarketDays:
    case MarketPhase.Archived:
      return 'assignment';
    default:
      // A phase this build does not recognise still gets a workspace. The plan is editable in
      // every phase, so it is the one surface that is never wrong to show.
      return 'setup';
  }
}

/** Whether this surface is where the market's current phase is worked on. */
export function isCurrentSurface(
  surface: MarketSurface,
  phase: string | undefined | null,
): boolean {
  return surfaceForPhase(phase) === surface;
}
