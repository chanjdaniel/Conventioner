import type { Ref } from 'vue';
import { api } from '@/utils/api';
import { useSavedOnTheMarket } from '@/utils/savedOnTheMarket';
import { askedEssentialAnswers } from '@/utils/essentialFields';
import type { EssentialFormOptions, FormField, Market } from '@/assets/types/datatypes';

/** An answer a mark may lead the card with, and whether it is the organizer's own question. */
export interface HighlightCandidate {
  key: string;
  label: string;
  custom: boolean;
}

/** The answers the market asks: the organizer's own questions first, then the essential ones - the
 *  card's own order. */
export function highlightCandidates(
  fields: FormField[],
  essentialOptions: EssentialFormOptions,
): HighlightCandidate[] {
  return [
    ...fields
      .filter((field) => field.key)
      .map((field) => ({ key: field.key, label: field.label || field.key, custom: true })),
    ...askedEssentialAnswers(essentialOptions).map((answer) => ({ ...answer, custom: false })),
  ];
}

/**
 * The marks that lead the card with something: those naming an answer the market asks (T206). A
 * mark may outlive its question, and one that names nothing the market asks decides nothing - the
 * mirror of `live_highlights` in `back-end/review_highlights.py`, which the guard on leaving draft
 * reads.
 */
export function liveHighlights(
  highlights: string[],
  fields: FormField[],
  essentialOptions: EssentialFormOptions,
): string[] {
  const asked = new Set(highlightCandidates(fields, essentialOptions).map((c) => c.key));
  return highlights.filter((key) => asked.has(key));
}

/**
 * Which answers a reviewer reads first, as a thing two screens can both change (E19/F03).
 *
 * The form builder authors them; the REVIEW QUEUE corrects them, which is the point of the whole
 * feature: an organizer writing a form is guessing what will matter, and a reviewer on card twelve
 * knows - by which time the form has frozen, because an application exists.
 *
 * It lives here rather than in either component so there is ONE list and one writer. Two copies of
 * this logic is exactly the divergence the feature was specified against: the queue and the builder
 * would each hold their own idea of what leads the card, and whichever saved last would win.
 *
 * It also holds the organizer's choice that nothing leads the card (T206), written by `chooseNone`
 * and replaced by the next mark; only Review setup offers that choice.
 */
export function useReviewHighlights(market: Ref<Market | null | undefined>) {
  const { value, none, error, save, chooseNone } = useSavedOnTheMarket<string>(
    market,
    (held) => held.reviewHighlights,
    async (id, keys, nothingLeadsTheCard) => {
      const response = await api.put(`/markets/${id}/review-highlights`, {
        keys,
        nothingLeadsTheCard,
      });
      return {
        list: response.data?.reviewHighlights ?? keys,
        none: response.data?.nothingLeadsTheCard ?? nothingLeadsTheCard,
      };
    },
    'Could not save what a reviewer reads first.',
    (held) => held.nothingLeadsTheCard ?? false,
  );
  return { highlights: value, nothingLeadsTheCard: none, error, save, chooseNone };
}
