import type { EssentialFormOptions, FormField, SetupObject } from '@/assets/types/datatypes';
import { getFormattedDate } from '@/utils/utils';

/**
 * The essential form questions: the ones the product owns and every application form asks. This
 * mirrors the back-end contract in `back-end/essential_fields.py`, which is the single owner of
 * it - the reserved keys, labels, offering derivation, and validation here must say what the back
 * end will say, only sooner.
 *
 * Most are answers the solver reads directly, which is why they cannot be removed. The name is
 * the one that is essential because identity is, not because the solver needs it (E13/F01/S01).
 */

/** Custom builder fields may never use this prefix; the keys belong to the essential answers. */
export const ESSENTIAL_KEY_PREFIX = 'essential_';

/**
 * Identity, and the one essential question asked unconditionally: every other is gated on the
 * market plan offering something to answer about, and who you are does not depend on the plan.
 *
 * ONE field, never first + last - the names organizers already collect arrive whole, and
 * splitting on whitespace guesses wrong on every "van der Berg" and mononym.
 */
export const FULL_NAME_KEY = 'essential_full_name';

export const AVAILABLE_DATES_KEY = 'essential_available_dates';
export const MAX_DATES_KEY = 'essential_max_dates';
export const TIER_PREFERENCE_KEY = 'essential_tier_preference';
export const TABLE_CHOICE_KEY = 'essential_table_choice';
export const TABLE_SHARE_EMAIL_KEY = 'essential_table_share_email';
export const SECTION_RANKING_KEY = 'essential_section_ranking';
export const TABLE_TYPE_RANKING_KEY = 'essential_table_type_ranking';

export const FULL_NAME_LABEL = 'Full name';
export const AVAILABLE_DATES_LABEL = 'Available dates';
export const MAX_DATES_LABEL = 'Number of dates you want';
export const TIER_PREFERENCE_LABEL = 'Tier preference';
export const TABLE_CHOICE_LABEL = 'Table choice';
export const TABLE_SHARE_EMAIL_LABEL = 'Table-share partner';

/**
 * Every table holds one full-table vendor or two halves, so these three are the whole space.
 * Unlike the other offerings this one is not plan-derived - the organizer does not choose it.
 */
/**
 * STUB until the floorplan ships. Table type is a property of an individual TABLE, not of its
 * section - any table in any section may be any type - so only a floorplan can truly describe it,
 * and the floorplan GUI is out of MVP scope. Every market offers exactly one type, so the ranking
 * is suppressed by the fewer-than-two rule and the question is never asked.
 */
export const STUB_TABLE_TYPE = 'Standard';

/**
 * The value stored, and the sentence the applicant reads beside it. Mirrors
 * `TABLE_CHOICE_LABELS` in `back-end/essential_fields.py`, which is the same pairing and must
 * stay in step: the CSV importer matches an imported column against the label, so a label that
 * differs by a word here is a column that no longer matches there.
 */
export const TABLE_CHOICES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'full', label: 'A whole table to myself' },
  { value: 'half', label: 'Half a table, shared' },
  { value: 'either', label: 'Either is fine' },
];
export const SECTION_RANKING_LABEL = 'Section preference';
export const TABLE_TYPE_RANKING_LABEL = 'Table type preference';

export const EMPTY_ESSENTIAL_OPTIONS: EssentialFormOptions = {
  dates: [],
  sections: [],
  tableTypes: [],
  tiers: [],
  unasked: [],
};

/**
 * The only essential questions a market may declare it does not ask (E01/F06).
 * Mirrors `UNASKABLE_ESSENTIAL_KEYS` in `back-end/essential_fields.py`.
 *
 * Both are rankings, and that is the whole rule: the solver gives a vendor their best-ranked
 * option still open and never excludes anyone for a ranking, so a uniform default changes nothing
 * but the tie-break. Dates, tiers and table choice are constraints - a default there invents a
 * commitment the applicant never made.
 */
export const UNASKABLE_ESSENTIAL_KEYS: readonly string[] = [
  SECTION_RANKING_KEY,
  TABLE_TYPE_RANKING_KEY,
];

/**
 * The stored shape of a dates-and-tiers answer, whichever way the form asked for it.
 *
 * Mirrors `reconciled_dates_and_tiers` in `back-end/essential_fields.py`, which is the authority.
 *
 * There are two ways to ask. A PER-DATE GRID is what an organizer's own form produces - one
 * question per day whose cell carries the tiers, or nothing when the vendor cannot attend - so it
 * answers availability too: the dates you named tiers for are the dates you are available. A FLAT
 * LIST is what a form that asked once produces, and it means those tiers on every available date.
 *
 * Anything else is carried through untouched, because a missing or unrecognised answer is the
 * validator's to refuse in the applicant's own words.
 */
export function reconciledDatesAndTiers(
  tierAnswer: unknown,
  availableDates: unknown,
): { tiers: unknown; dates: unknown } {
  if (Array.isArray(tierAnswer)) {
    const dates = Array.isArray(availableDates) ? [...availableDates] : [];
    // A fresh array per date: one shared array is one edit away from changing every day at once.
    const tiers: Record<string, unknown[]> = {};
    for (const date of dates) tiers[String(date)] = [...tierAnswer];
    return { tiers, dates };
  }

  const availabilityAnswered = Array.isArray(availableDates) && availableDates.length > 0;
  if (tierAnswer && typeof tierAnswer === 'object' && !availabilityAnswered) {
    const grid = tierAnswer as Record<string, unknown[]>;
    return { tiers: grid, dates: Object.keys(grid).filter((date) => grid[date]?.length) };
  }

  return { tiers: tierAnswer, dates: availableDates };
}

/** Is this essential question one this market actually asks? */
export function isEssentialAsked(key: string, options: EssentialFormOptions): boolean {
  return !(options.unasked ?? []).includes(key);
}

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
 * sections, tiers from its tiers. Table type is stubbed to one type (see STUB_TABLE_TYPE).
 */
export function essentialOptionsFromSetup(
  setup: SetupObject | null | undefined,
): EssentialFormOptions {
  if (!setup) return EMPTY_ESSENTIAL_OPTIONS;
  return {
    dates: uniqueNames((setup.marketDates ?? []).map((d) => d.date)),
    sections: uniqueNames((setup.sections ?? []).map((s) => s.name)),
    tableTypes: [STUB_TABLE_TYPE],
    tiers: uniqueNames((setup.tiers ?? []).map((t) => t.name)),
  };
}

/**
 * A market date as the applicant reads it ("Saturday, August 1, 2026").
 *
 * It adds nothing to `getFormattedDate`. It used to append the year, because the `getFormattedDate`
 * of the day stopped at the day of the month and a market's dates can span a year boundary.
 * `E09/F04/S02` - the "one date format" story - gave `getFormattedDate` the year and left this
 * appending a second one, so every applicant-facing date read "Saturday, November 21, 2026, 2026"
 * (E14/F01/S01).
 *
 * Kept as a named function rather than inlined at its four call sites, because the name is the
 * statement that an essential question shows the product's one date format unaltered - which is
 * exactly what stopped being true. The `?? ''` narrows the empty-string case that
 * `getFormattedDate` answers with null; it is not a fallback for an unreadable date, which
 * `getFormattedDate` already returns verbatim.
 */
export function formattedEssentialDate(date: string): string {
  return getFormattedDate(date) ?? '';
}

/** One answer of an application, as a person reads it. */
export interface AnswerRow {
  key: string;
  label: string;
  value: string;
  /** The organizer's own question, rather than one of the essential ones. */
  custom: boolean;
}

/** The order the form asks the essential questions, so answers read back the way they were given. */
const ESSENTIAL_ORDER: ReadonlyArray<[string, string, (value: unknown) => unknown]> = [
  [FULL_NAME_KEY, FULL_NAME_LABEL, (v) => v],
  [
    AVAILABLE_DATES_KEY,
    AVAILABLE_DATES_LABEL,
    (v) => (Array.isArray(v) ? v.map((d) => formattedEssentialDate(String(d))) : v),
  ],
  [MAX_DATES_KEY, MAX_DATES_LABEL, (v) => v],
  // Tier is an accepted set per date, not a ranking, so each date's tiers are listed unnumbered.
  [TIER_PREFERENCE_KEY, TIER_PREFERENCE_LABEL, (v) => v],
  // Stored as a code; a reader should see the sentence the applicant picked, not `half`.
  [
    TABLE_CHOICE_KEY,
    TABLE_CHOICE_LABEL,
    (v) => TABLE_CHOICES.find((c) => c.value === v)?.label ?? v,
  ],
  [TABLE_SHARE_EMAIL_KEY, TABLE_SHARE_EMAIL_LABEL, (v) => v],
  [
    SECTION_RANKING_KEY,
    SECTION_RANKING_LABEL,
    (v) => (Array.isArray(v) ? v.map((s, i) => `${i + 1}. ${s}`) : v),
  ],
  [
    TABLE_TYPE_RANKING_KEY,
    TABLE_TYPE_RANKING_LABEL,
    (v) => (Array.isArray(v) ? v.map((t, i) => `${i + 1}. ${t}`) : v),
  ],
];

/**
 * One stored answer as text. A map is keyed by date (the tier answer), so its keys are dates.
 *
 * Both branches separate their items with the same middot the tier answer has always used. A comma
 * cannot do that job here: a list item is often a formatted date, which carries two commas of its
 * own, so `join(', ')` ran two dates together into "Saturday, November 21, 2026, Sunday, November
 * 22, 2026" - a string with no readable boundary between the entries (E14/F01/S01).
 */
function answerText(value: unknown): string {
  if (Array.isArray(value)) return value.join(' · ');
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([date, inner]) => {
        const listed = Array.isArray(inner) ? inner.join(', ') : String(inner);
        return `${formattedEssentialDate(date)}: ${listed}`;
      })
      .join(' · ');
  }
  if (value === null || value === undefined) return '';
  // A checkbox answer is a yes or a no, not a `true` (E15/F02/S01). It reached the review card as
  // the stored boolean - the one row on a card whose every other answer is written for a person.
  // `false` renders rather than dropping out: "no, I do not need power" is an answer.
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

/**
 * Everything an application answered, as a person reads it.
 *
 * This lives here, with the contract it renders, because two surfaces show the same answers back:
 * the applicant's own dashboard and the organizer's review card. They order the rows differently -
 * the applicant reads the form's own order, the reviewer reads the organizer's own questions first,
 * because those are what tell applicants apart - so ordering stays with each caller and only the
 * content is shared. A second copy of the rendering drifted within one change: a table choice read
 * back as `half`, and a ranking lost its numbering.
 *
 * A blank answer is dropped rather than shown empty: an unanswered optional question is not
 * information. An answer whose question the form no longer names is still shown, under its key.
 */
export function applicationAnswerRows(
  formData: Record<string, unknown>,
  fields: readonly FormField[] = [],
): { essential: AnswerRow[]; custom: AnswerRow[] } {
  const essential: AnswerRow[] = [];
  const custom: AnswerRow[] = [];
  const seen = new Set<string>();

  const push = (
    rows: AnswerRow[],
    key: string,
    label: string,
    value: unknown,
    isCustom: boolean,
  ) => {
    seen.add(key);
    const text = answerText(value).trim();
    if (text) rows.push({ key, label, value: text, custom: isCustom });
  };

  for (const [key, label, present] of ESSENTIAL_ORDER) {
    if (key in formData) push(essential, key, label, present(formData[key]), false);
  }

  // The form's declared order, so every card lists the same questions the same way round.
  for (const field of [...fields].sort((a, b) => a.order - b.order)) {
    if (field.key in formData && !seen.has(field.key)) {
      push(custom, field.key, field.label || field.key, formData[field.key], true);
    }
  }

  // Anything left: an answer to a question the form has since dropped, or an essential question
  // this build does not know about. Shown under its key rather than silently withheld.
  for (const [key, value] of Object.entries(formData)) {
    if (seen.has(key)) continue;
    const isEssential = key.startsWith(ESSENTIAL_KEY_PREFIX);
    push(isEssential ? essential : custom, key, key.replace(/_/g, ' '), value, !isEssential);
  }

  return { essential, custom };
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

  // Asked of every applicant, whatever the plan offers, because identity does not depend on it.
  const name = formData[FULL_NAME_KEY];
  if (typeof name !== 'string' || !name.trim()) {
    errors[FULL_NAME_KEY] = `'${FULL_NAME_LABEL}' is required.`;
  }

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

  // Tier is a hard filter, not a ranking: accepting a subset is a complete answer, but accepting
  // nothing is not, since the applicant would be placeable nowhere. It is answered PER DATE
  // (E01/F05), because a tier sets the price - one set for the whole application would let someone
  // be placed at a tier they offered on one day, and charged for it, on another. Availability and
  // tier are two halves of one truth, so every available date needs an answer.
  if (options.tiers.length > 0) {
    const byDate = formData[TIER_PREFERENCE_KEY];
    const answered = (date: string) => {
      const on = (byDate as Record<string, unknown> | undefined)?.[date];
      return Array.isArray(on) && on.length > 0;
    };
    const dates = Array.isArray(formData[AVAILABLE_DATES_KEY])
      ? (formData[AVAILABLE_DATES_KEY] as string[])
      : [];
    const unanswered = dates.filter((date) => !answered(date));
    if (!dates.length || unanswered.length) {
      errors[TIER_PREFERENCE_KEY] = dates.length
        ? `'${TIER_PREFERENCE_LABEL}' is missing for ${unanswered.join(', ')}. Choose at least one tier for each, or mark it as a day you cannot attend.`
        : `'${TIER_PREFERENCE_LABEL}' is required. Select at least one tier.`;
    }
  }

  // Table choice follows max dates: gated on the dates offering, since a market with no dates
  // has nothing to be assigned to. Required when asked - there is no safe default between
  // holding a whole table for someone who would have shared and halving one for someone who
  // would not. The partner email is deliberately never an error; naming nobody is the norm.
  if (options.dates.length > 0) {
    const choice = formData[TABLE_CHOICE_KEY];
    if (typeof choice !== 'string' || !TABLE_CHOICES.some((c) => c.value === choice)) {
      errors[TABLE_CHOICE_KEY] = `'${TABLE_CHOICE_LABEL}' is required.`;
    }
  }

  // Fewer than two options is not a question - there is exactly one order. Rankings only: a
  // single offered date or tier is still asked, since the applicant may not want it.
  const rankingError = (key: string, label: string, offered: string[]) => {
    if (offered.length < 2) return;
    const ranked = formData[key];
    if (!Array.isArray(ranked) || ranked.length !== offered.length) {
      errors[key] = `'${label}' is required. Rank every option, best first.`;
    }
  };
  rankingError(SECTION_RANKING_KEY, SECTION_RANKING_LABEL, options.sections);
  rankingError(TABLE_TYPE_RANKING_KEY, TABLE_TYPE_RANKING_LABEL, options.tableTypes);

  return errors;
}
