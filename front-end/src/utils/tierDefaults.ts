import type { TierObject } from '@/assets/types/datatypes';

/**
 * Tiers an organizer names themselves.
 *
 * There used to be a `collectDefaultTierNames` here that scraped tier names out of the uploaded
 * spreadsheet's cell values, so the tier list could be pre-filled from whatever vendors had
 * typed. There is no spreadsheet behind a market any more, and a tier is a decision the
 * organizer makes rather than something to be inferred from answers, so there is nothing left
 * to derive and nothing to pre-fill.
 */
export function buildDefaultTierObjects(names: string[]): TierObject[] {
  return names.map((name, index) => ({
    id: index + 1,
    name,
  }));
}
