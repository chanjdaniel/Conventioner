import { AVAILABLE_DATES_KEY, MAX_DATES_KEY } from '@/utils/essentialFields';

/**
 * How many of the market's dates a vendor could have had: the ones they can attend, bounded by
 * their own "number of dates you want" and by the market's ceiling per vendor.
 *
 * The same bound the solver places within and satisfaction is measured against, so a vendor who
 * got every date they asked for reads as complete rather than as short of the market's count.
 */
export function datesWithinReach(
  answers: Record<string, unknown>,
  marketDates: readonly string[],
  ceiling: number | null | undefined,
): number {
  const offered = new Set(marketDates);
  const available = answers[AVAILABLE_DATES_KEY];
  let reach = Array.isArray(available)
    ? new Set(available.filter((date) => offered.has(String(date)))).size
    : 0;
  const own = Number(answers[MAX_DATES_KEY]);
  if (Number.isFinite(own) && own > 0) reach = Math.min(reach, own);
  if (ceiling != null && ceiling > 0) reach = Math.min(reach, ceiling);
  return reach;
}

/**
 * How many of the market's dates a vendor needs a table on (E38/F08/S02): a vendor added by hand
 * answered nothing and needs one on every market day; anyone who applied, the dates within reach.
 */
export function datesTheyNeed(
  vendor: { answers: Record<string, unknown>; added: boolean },
  marketDates: readonly string[],
  ceiling: number | null | undefined,
): number {
  return vendor.added ? marketDates.length : datesWithinReach(vendor.answers, marketDates, ceiling);
}
