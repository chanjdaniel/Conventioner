/**
 * A market's vendor page, `/<slug>` (ADR 0021): what it reads before sign-in, and which sections
 * it shows a signed-in vendor in each state of the market.
 */
import type { Application } from '@/assets/types/datatypes';
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
