import type { EssentialFormOptions, FormField } from '@/assets/types/datatypes';
import { api } from '@/utils/api';
import { EMPTY_ESSENTIAL_OPTIONS } from '@/utils/essentialFields';

export interface PublicApplicationForm {
  marketName: string;
  fields: FormField[];
  essentialOptions: EssentialFormOptions;
  phaseLabel: string;
  isOpen: boolean;
  /**
   * The request did not answer. Distinct from a market that answered "not open": a caller that
   * conflates them tells the applicant their market is closed when in truth we never asked it.
   */
  failed: boolean;
  /**
   * The applicant surface answered, and has nothing at this slug: no such market, or one whose
   * vendors are imported rather than applying. The two are deliberately indistinguishable.
   *
   * Distinct from `failed` for the same reason `failed` is distinct from "not open": a timeout on
   * a bad connection is not a market that does not exist, and telling a visitor it is sends them
   * away from a page that would have loaded on the next try.
   */
  notFound: boolean;
}

/**
 * How long an applicant waits for this before being told it did not load. Generous, because a
 * phone on a bad connection is the normal case, but bounded - an unbounded request leaves the
 * page on its loading state for ever, with nothing to retry and nothing to read.
 */
const REQUEST_TIMEOUT_MS = 15000;

/** Fetch the market's public information for applicant screens. */
export async function fetchPublicApplicationForm(
  marketSlug: string,
): Promise<PublicApplicationForm> {
  try {
    const { data } = await api.get(`/public/markets/${marketSlug}/application-form`, {
      timeout: REQUEST_TIMEOUT_MS,
    });
    const form = data.application_form || data.applicationForm || {};
    const essential = data.essential_options || data.essentialOptions || {};
    return {
      marketName: data.market_name || data.marketName || '',
      fields: form.fields ?? [],
      essentialOptions: {
        dates: essential.dates ?? [],
        sections: essential.sections ?? [],
        tableTypes: essential.tableTypes ?? [],
        tiers: essential.tiers ?? [],
      },
      phaseLabel: data.phase_label || data.phaseLabel || '',
      isOpen: data.is_open === true || data.isOpen === true,
      failed: false,
      notFound: false,
    };
  } catch (err: unknown) {
    const status =
      err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { status?: number } }).response?.status
        : undefined;
    return {
      marketName: '',
      fields: [],
      essentialOptions: EMPTY_ESSENTIAL_OPTIONS,
      phaseLabel: '',
      isOpen: false,
      failed: true,
      notFound: status === 404,
    };
  }
}
