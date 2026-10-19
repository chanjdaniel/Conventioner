import type { Ref } from 'vue';
import { api } from '@/utils/api';
import { useSavedOnTheMarket } from '@/utils/savedOnTheMarket';
import type { Market } from '@/assets/types/datatypes';

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
 */
export function useReviewHighlights(market: Ref<Market | null | undefined>) {
  const { value, error, save } = useSavedOnTheMarket<string>(
    market,
    (held) => held.reviewHighlights,
    async (id, keys) => {
      const response = await api.put(`/markets/${id}/review-highlights`, { keys });
      return response.data?.reviewHighlights ?? keys;
    },
    'Could not save what a reviewer reads first.',
  );
  return { highlights: value, error, save };
}
