/**
 * A market's vendor page, `/<slug>` (ADR 0022): what it reads before sign-in, and which sections
 * it shows a signed-in vendor in each state of the market.
 */
import type { Application, Market } from '@/assets/types/datatypes';
import { IntakeMode, MarketPhase } from '@/assets/types/datatypes';
import { api } from '@/utils/api';
import { APPLICANT_READ_TIMEOUT_MS } from '@/utils/applicantApi';
import { outcomeHeadline } from '@/utils/applicantOutcome';

/** What `GET /public/markets/<slug>/vendor-page` answers for a market that has a page. */
export interface VendorPageInfo {
  marketName: string;
  intakeMode: IntakeMode;
  phase: MarketPhase;
  takesApplications: boolean;
  resultsPublished: boolean;
  marketDates: string[];
  /** Archived after it ran: the page is the record of where its vendors sat. */
  ended: boolean;
  /** The date "Remember me" would end, `YYYY-MM-DD`, or null once the market's last date passed. */
  rememberUntil: string | null;
}

/**
 * What reading it found: the page, none (`notFound`: no market here, or one with no vendor page,
 * which answer alike), or `failed` when the request never answered, which is neither.
 */
export interface VendorPageRead {
  page: VendorPageInfo | null;
  notFound: boolean;
  failed: boolean;
}

export async function fetchVendorPage(marketSlug: string): Promise<VendorPageRead> {
  try {
    const { data } = await api.get(`/public/markets/${marketSlug}/vendor-page`, {
      timeout: APPLICANT_READ_TIMEOUT_MS,
    });
    return { page: data as VendorPageInfo, notFound: false, failed: false };
  } catch (err: unknown) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    return { page: null, notFound: status === 404, failed: status !== 404 };
  }
}

/**
 * What the application section shows a signed-in vendor:
 * - `apply`: none yet, and the market takes applications - "Apply";
 * - `edit`: their answers, with "Edit" while the market takes applications;
 * - `answers`: their answers, read-only;
 * - `closed`: none, and the market no longer takes any;
 * - `none`: the market has no application at all (its vendors are imported).
 */
export type ApplicationSection = 'apply' | 'edit' | 'answers' | 'closed' | 'none';

export function applicationSection(
  page: Pick<VendorPageInfo, 'intakeMode' | 'takesApplications'>,
  application: Application | null,
): ApplicationSection {
  if (page.intakeMode !== IntakeMode.Form) return 'none';
  if (!application) return page.takesApplications ? 'apply' : 'closed';
  return page.takesApplications ? 'edit' : 'answers';
}

/**
 * The status a signed-in vendor reads at the top: "Submitted" until results are published, then
 * their outcome; null when they have no application to have a status.
 */
export function statusHeadline(application: Application | null): string | null {
  if (!application) return null;
  return outcomeHeadline(application) ?? 'Submitted';
}

/** The sentence for a vendor with no application at a market that is not taking applications. */
export const NO_APPLICATION_CLOSED =
  'You have no application at this market, and it is not taking applications.';

/**
 * The sentence for a signed-in address with no vendor at a Google Form market: its vendors are
 * the organizer's form responses, so the address to sign in with is the one the response gave.
 */
export function noVendorAtThisAddress(marketName: string): string {
  return `There's no application from this address at ${marketName}. Use the address you gave on the market's form, or ask the organizer.`;
}

type MarketState = Pick<Market, 'intakeMode' | 'phase' | 'resultsPublished' | 'phasesReached'>;

/** Has this market reached its market days, by its phase now or the record the server served? */
function reachedMarketDays(market: MarketState): boolean {
  return (
    market.phase === MarketPhase.MarketDays ||
    (market.phasesReached ?? []).includes(MarketPhase.MarketDays)
  );
}

/**
 * Does this market's vendor page answer now? The server's gate (`vendor_page_market_by_slug`),
 * stated for the organizer's screens: never in draft; a market whose vendors apply on its page in
 * every other phase; a Google Form market once its results are published or it reached its market
 * days, which covers one that went live before it could publish them.
 */
export function hasVendorPage(market: MarketState): boolean {
  if (!market.phase || market.phase === MarketPhase.Draft) return false;
  if (market.intakeMode === IntakeMode.Form) return true;
  return Boolean(market.resultsPublished) || reachedMarketDays(market);
}

/**
 * Is its address one to share, as the rail offers it? While it has a page, and once archived only
 * for a market that ran: its page is then the record of where its vendors sat.
 */
export function sharesVendorPage(market: MarketState): boolean {
  if (!hasVendorPage(market)) return false;
  return market.phase !== MarketPhase.Archived || reachedMarketDays(market);
}
