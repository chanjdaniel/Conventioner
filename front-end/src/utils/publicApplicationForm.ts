import type { EssentialFormOptions, FormField } from '@/assets/types/datatypes';
import { api } from '@/utils/api';
import { EMPTY_ESSENTIAL_OPTIONS } from '@/utils/essentialFields';

export interface PublicApplicationForm {
  marketName: string;
  fields: FormField[];
  essentialOptions: EssentialFormOptions;
  phaseLabel: string;
  isOpen: boolean;
}

/**
 * Fetch the market's public information for applicant screens.
 *
 * Tries the public application-form endpoint. When the endpoint is not yet
 * wired (current 5d backend has login-only), returns an empty form so views
 * degrade gracefully.
 */
export async function fetchPublicApplicationForm(
  marketSlug: string,
): Promise<PublicApplicationForm> {
  try {
    const { data } = await api.get(`/public/markets/${marketSlug}/application-form`);
    const form = data.application_form || data.applicationForm || {};
    const essential = data.essential_options || data.essentialOptions || {};
    return {
      marketName: data.market_name || data.marketName || '',
      fields: form.fields ?? [],
      essentialOptions: {
        dates: essential.dates ?? [],
        sections: essential.sections ?? [],
        tableTypes: essential.tableTypes ?? [],
      },
      phaseLabel: data.phase_label || data.phaseLabel || '',
      isOpen: data.is_open === true || data.isOpen === true,
    };
  } catch {
    return {
      marketName: '',
      fields: [],
      essentialOptions: EMPTY_ESSENTIAL_OPTIONS,
      phaseLabel: '',
      isOpen: false,
    };
  }
}
