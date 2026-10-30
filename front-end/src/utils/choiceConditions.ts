/**
 * Conditions on a vendor's answers to the market's choice questions (`ChoiceConditions.vue`), as
 * `back-end/rejection_rules.py`'s `Rulebook.broken` judges them: the server is the authority, and
 * this only says on the screen what it will say.
 */
import type { AnswerCondition, RejectionQuestion } from '@/assets/types/datatypes';

/** Whether `condition` names a question not among `questions`, or an answer it does not offer. */
export function brokenCondition(
  questions: readonly RejectionQuestion[],
  condition: AnswerCondition,
): boolean {
  const question = questions.find((q) => q.key === condition.key);
  if (!question) return true;
  return condition.answers.some((value) => !question.answers.some((a) => a.value === value));
}
