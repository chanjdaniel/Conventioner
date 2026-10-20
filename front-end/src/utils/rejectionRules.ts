import type { Ref } from 'vue';
import { api } from '@/utils/api';
import { useSavedOnTheMarket } from '@/utils/savedOnTheMarket';
import type { Market, RejectionRule } from '@/assets/types/datatypes';

/** Which answers reject an application automatically, written whole on every change (E33/F03/S01). */
export function useRejectionRules(market: Ref<Market | null | undefined>) {
  const { value, error, save } = useSavedOnTheMarket<RejectionRule>(
    market,
    (held) => held.rejectionRules,
    async (id, rules) => {
      const response = await api.put(`/markets/${id}/rejection-rules`, { rules });
      return response.data?.rejectionRules ?? rules;
    },
    'Could not save the automatic rejections.',
  );
  return { rules: value, error, save };
}
