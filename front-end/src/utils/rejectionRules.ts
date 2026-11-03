import type { Ref } from 'vue';
import { api } from '@/utils/api';
import { useSavedOnTheMarket } from '@/utils/savedOnTheMarket';
import type { Market, RejectionQuestion, RejectionRule } from '@/assets/types/datatypes';

/**
 * The rules that reject some application (T206): those on a question the form still asks naming an
 * answer it still offers. A rule with no answer ticked rejects nobody.
 */
export function rejectingRules(
  rules: RejectionRule[],
  questions: RejectionQuestion[],
): RejectionRule[] {
  const offered = new Map(questions.map((q) => [q.key, new Set(q.answers.map((a) => a.value))]));
  return rules.filter((rule) => rule.answers.some((answer) => offered.get(rule.key)?.has(answer)));
}

/**
 * Whether these rules decide the automatic rejections (T206): one of them rejects some application.
 * The mirror of `Rulebook.decided` in `back-end/rejection_rules.py`, which the guard on leaving
 * draft reads.
 */
export function rulesDecide(rules: RejectionRule[], questions: RejectionQuestion[]): boolean {
  return rejectingRules(rules, questions).length > 0;
}

/**
 * Which answers reject an application automatically, written whole on every change (E33/F03/S01).
 *
 * It also holds the organizer's choice that no answer rejects automatically (T206), written by
 * `chooseNone` and replaced by the next rule.
 */
export function useRejectionRules(market: Ref<Market | null | undefined>) {
  const { value, none, error, save, chooseNone } = useSavedOnTheMarket<RejectionRule>(
    market,
    (held) => held.rejectionRules,
    async (id, rules, noAutomaticRejections) => {
      const response = await api.put(`/markets/${id}/rejection-rules`, {
        rules,
        noAutomaticRejections,
      });
      return {
        list: response.data?.rejectionRules ?? rules,
        none: response.data?.noAutomaticRejections ?? noAutomaticRejections,
      };
    },
    'Could not save the automatic rejections.',
    (held) => held.noAutomaticRejections ?? false,
  );
  return { rules: value, noAutomaticRejections: none, error, save, chooseNone };
}
