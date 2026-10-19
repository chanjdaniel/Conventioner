"""Which answers reject an application automatically (E33/F03).

The real market rejects every applicant who does not agree to the no-show terms, or who is not a
UBC student, alumnus or another accepted affiliation, and each was a manual rejection, one card at
a time. A rule names one CHOICE question - a select, a multi-select or a checkbox of the organizer's
own, or the essential table choice - and the answers to it that reject. Free text is never a rule's:
a typed answer has no fixed set of values to name.

This module is the one statement of what a rule may say; when the rules may change is
``api.markets.rejection_rules_lock_reason``, beside the assignment rules' own. The market read serves
both (``rejectionQuestions``, ``rejectionRulesLockReason``), so the review setup offers exactly what
the write will take.
"""
from typing import Any, Dict, List, Optional

import essential_fields as EssentialFields
from datatypes import Market

#: A checkbox's two answers, as a rule names them.
TICKED = "ticked"
NOT_TICKED = "not ticked"
_CHECKBOX_ANSWERS = [{"value": TICKED, "label": "Ticked"}, {"value": NOT_TICKED, "label": "Not ticked"}]

#: The organizer's own question types a rule may name.
CHOICE_TYPES = ("select", "multi_select", "checkbox")

def rejection_questions(market: Market) -> List[Dict[str, Any]]:
    """Every question a rule may name, in the form's order, with the answers it offers.

    Each is ``{key, label, answers: [{value, label}]}``: the value is what a rule stores and what an
    application's answer is compared with; the label is the words the applicant chose from.
    """
    form = market.application_form
    questions = []
    for field in sorted(form.fields if form else [], key=lambda f: f.order):
        if field.type not in CHOICE_TYPES:
            continue
        answers = (_CHECKBOX_ANSWERS if field.type == "checkbox"
                   else [{"value": option, "label": option} for option in field.options])
        questions.append({"key": field.key, "label": field.label, "answers": answers})
    questions.append({
        "key": EssentialFields.TABLE_CHOICE_KEY,
        "label": EssentialFields.TABLE_CHOICE_LABEL,
        "answers": [{"value": choice, "label": EssentialFields.TABLE_CHOICE_LABELS[choice]}
                    for choice in EssentialFields.TABLE_CHOICES],
    })
    return questions


def prepared_rules(market: Market, raw: Any) -> List[Dict[str, Any]]:
    """The rules a write may store, judged against ``market``'s form. Raises ValueError, in words
    for the organizer, for a rule on a question that is not a choice, an answer the question does
    not offer, or two rules on one question.

    A rule with no answer yet is kept: the organizer picks the question first, then the answers,
    and it rejects nothing until they do.
    """
    if not isinstance(raw, list):
        raise ValueError("rules must be a list.")
    offered = {q["key"]: q for q in rejection_questions(market)}
    labels = {f.key: f.label for f in (market.application_form.fields
                                       if market.application_form else [])}
    rules: List[Dict[str, Any]] = []
    for rule in raw:
        key = str((rule or {}).get("key") or "").strip()
        question = offered.get(key)
        if question is None:
            if key in labels:
                raise ValueError(
                    f"'{labels[key]}' is answered in the applicant's own words, so no answer to it "
                    "can reject an application automatically.")
            raise ValueError(f"This market's form has no question {key!r} with answers to choose.")
        if any(existing["key"] == key for existing in rules):
            raise ValueError(f"'{question['label']}' has one rule, which names every answer that "
                             "rejects.")
        values = [a["value"] for a in question["answers"]]
        answers: List[str] = []
        for answer in (rule.get("answers") or []):
            answer = str(answer)
            if answer not in values:
                raise ValueError(f"'{question['label']}' does not offer the answer {answer!r}.")
            if answer not in answers:
                answers.append(answer)
        rules.append({"key": key, "answers": answers})
    return rules
