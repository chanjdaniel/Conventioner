import { ref, watch, type Ref } from 'vue';
import { api, getApiErrorMessage } from '@/utils/api';
import { useMarketStore } from '@/stores/market';
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
  const highlights = ref<string[]>([...(market.value?.reviewHighlights ?? [])]);
  const error = ref('');

  /**
   * Which save is the current one. Every toggle sends its own PUT, so two quick clicks put two in
   * flight at once - and the responses are not promised in order. Applying whichever landed LAST
   * wrote the older list over the newer one: mark two answers quickly and the second silently came
   * back off. A stale response is ignored rather than raced against.
   */
  let latestSave = 0;

  watch(
    () => market.value?.reviewHighlights,
    (stored) => {
      if (stored) highlights.value = [...stored];
    },
  );

  /**
   * Take the saved list, and have the store re-read the market the rest of the app reads.
   *
   * Without the re-read the mark saved and the REVIEW CARD DID NOT MOVE: the queue reads
   * `market.reviewHighlights`, and the store still held the list as it was before the click. It
   * used to patch the list onto the market in place; a write is followed by asking the server now
   * (E21/F02/S02).
   */
  function adopt(stored: string[]) {
    highlights.value = [...stored];
    void useMarketStore().refresh();
  }

  async function save(keys: string[]) {
    const id = market.value?.id;
    if (!id) return;
    const previous = [...highlights.value];
    const save = (latestSave += 1);
    highlights.value = keys;
    error.value = '';
    try {
      const response = await api.put(`/markets/${id}/review-highlights`, { keys });
      if (save !== latestSave) return;
      adopt(response.data?.reviewHighlights ?? keys);
    } catch (err: unknown) {
      if (save !== latestSave) return;
      highlights.value = previous;
      error.value = getApiErrorMessage(err, 'Could not save what a reviewer reads first.');
    }
  }

  return { highlights, error, save };
}
