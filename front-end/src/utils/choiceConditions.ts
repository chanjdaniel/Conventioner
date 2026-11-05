/**
 * Conditions on a vendor's answers to the market's choice questions (`ChoiceConditions.vue`), as
 * `back-end/rejection_rules.py`'s `Rulebook.broken` judges them: the server is the authority, and
 * this only says on the screen what it will say.
 */
import type { AnswerCondition, RejectionQuestion } from '@/assets/types/datatypes';

/** The answers `condition` names that its question does not offer; all of them with no question. */
export function goneAnswers(
  questions: readonly RejectionQuestion[],
  condition: AnswerCondition,
): string[] {
  const offered = questions.find((q) => q.key === condition.key)?.answers ?? [];
  return condition.answers.filter((value) => !offered.some((answer) => answer.value === value));
}

/** Whether `condition` names a question not among `questions`, or an answer it does not offer. */
export function brokenCondition(
  questions: readonly RejectionQuestion[],
  condition: AnswerCondition,
): boolean {
  if (!questions.some((q) => q.key === condition.key)) return true;
  return goneAnswers(questions, condition).length > 0;
}
