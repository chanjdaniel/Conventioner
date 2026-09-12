import type { EssentialFormOptions, SetupObject } from '@/assets/types/datatypes';
import { getFormattedDate } from '@/utils/utils';

/**
 * The essential form questions: the answers the assignment solver reads directly, present in
 * every application form. This mirrors the back-end contract in `back-end/essential_fields.py`,
 * which is the single owner of it - the reserved keys, labels, offering derivation, and
 * validation here must say what the back end will say, only sooner.
 */

/** Custom builder fields may never use this prefix; the keys belong to the essential answers. */
export const ESSENTIAL_KEY_PREFIX = 'essential_';

export const AVAILABLE_DATES_KEY = 'essential_available_dates';
export const MAX_DATES_KEY = 'essential_max_dates';
export const SECTION_RANKING_KEY = 'essential_section_ranking';
export const TABLE_TYPE_RANKING_KEY = 'essential_table_type_ranking';

export const AVAILABLE_DATES_LABEL = 'Available dates';
export const MAX_DATES_LABEL = 'Number of dates you want';
export const SECTION_RANKING_LABEL = 'Section preference';
export const TABLE_TYPE_RANKING_LABEL = 'Table type preference';

export const EMPTY_ESSENTIAL_OPTIONS: EssentialFormOptions = {
  dates: [],
  sections: [],
  tableTypes: [],
};

function uniqueNames(values: Array<string | null | undefined>): string[] {
  const seen: string[] = [];
  for (const value of values) {
    const text = (value ?? '').trim();
    if (text && !seen.includes(text)) seen.push(text);
  }
  return seen;
}

/**
 * What the essential questions offer, read live from the market plan. The mirror of
 * `essential_options_from_setup`: dates from the plan's market dates, sections from its
 * sections, table types from the latest floorplan (the one whose sections the plan carries).
 */
export function essentialOptionsFromSetup(
  setup: SetupObject | null | undefined,
): EssentialFormOptions {
  if (!setup) return EMPTY_ESSENTIAL_OPTIONS;
  const floorplan = setup.floorplans?.length ? setup.floorplans[setup.floorplans.length - 1] : null;
  return {
    dates: uniqueNames((setup.marketDates ?? []).map((d) => d.date)),
    sections: uniqueNames((setup.sections ?? []).map((s) => s.name)),
    tableTypes: uniqueNames((floorplan?.tableTypes ?? []).map((t) => t.name)),
  };
}

/**
 * A market date as the applicant reads it ("Saturday, August 1, 2026"), falling back to the
 * raw value. The year is spelled out because a market's dates can span a year boundary and the
 * stored ISO value is what the solver will read back.
 */
export function formattedEssentialDate(date: string): string {
  const formatted = getFormattedDate(date);
  if (!formatted) return date;
  const year = date.slice(0, 4);
  return /^\d{4}$/.test(year) ? `${formatted}, ${year}` : formatted;
}

/**
 * Client-side validation of the essential answers, mirroring the back end's
 * `validated_essential_answers` so the applicant sees what is wrong before the request leaves.
 * Questions whose offering is empty are not asked and not validated.
 *
 * STUBBED PRODUCT DECISIONS (kept in step with the back end):
 * - rankings are total - every offered option is ranked;
 * - max dates is bounded by the offered dates only, not by the applicant's own selection.
 */
export function essentialValidationErrors(
  options: EssentialFormOptions,
  formData: Record<string, unknown>,
): Record<string, string> {
  const errors: Record<string, string> = {};

  if (options.dates.length > 0) {
    const dates = formData[AVAILABLE_DATES_KEY];
    if (!Array.isArray(dates) || dates.length === 0) {
      errors[AVAILABLE_DATES_KEY] =
        `'${AVAILABLE_DATES_LABEL}' is required. Select at least one date.`;
    }

    const max = formData[MAX_DATES_KEY];
    const maxNumber = typeof max === 'string' ? Number(max.trim()) : max;
    if (max === null || max === undefined || max === '') {
      errors[MAX_DATES_KEY] = `'${MAX_DATES_LABEL}' is required.`;
    } else if (typeof maxNumber !== 'number' || !Number.isInteger(maxNumber) || maxNumber < 1) {
      errors[MAX_DATES_KEY] = `'${MAX_DATES_LABEL}' must be a whole number of at least 1.`;
    } else if (maxNumber > options.dates.length) {
      errors[MAX_DATES_KEY] =
        `'${MAX_DATES_LABEL}' cannot exceed the ${options.dates.length} date(s) this market offers.`;
    }
  }

  const rankingError = (key: string, label: string, offered: string[]) => {
    if (offered.length === 0) return;
    const ranked = formData[key];
    if (!Array.isArray(ranked) || ranked.length !== offered.length) {
      errors[key] = `'${label}' is required. Rank every option, best first.`;
    }
  };
  rankingError(SECTION_RANKING_KEY, SECTION_RANKING_LABEL, options.sections);
  rankingError(TABLE_TYPE_RANKING_KEY, TABLE_TYPE_RANKING_LABEL, options.tableTypes);

  return errors;
}
