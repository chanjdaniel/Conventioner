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
from typing import Any, Dict, List, NamedTuple, Optional, Tuple, Union

import api.applications as ApplicationsApi
import essential_fields as EssentialFields
from datatypes import ApplicationForm, ApplicationStatus, Market, RejectionRule, VerdictGiver
from market_documents import market_doc_field

class Rulebook(NamedTuple):
    """What judging reads of a market: its form and its rules - all a stored projection need carry,
    and what a ``Market`` has under the same names."""
    application_form: Optional[ApplicationForm]
    rejection_rules: List[RejectionRule]

    @classmethod
    def from_document(cls, document: Dict[str, Any]) -> "Rulebook":
        form = market_doc_field(document, "application_form")
        rules = market_doc_field(document, "rejection_rules") or []
        return cls(ApplicationForm(**form) if form else None,
                   [RejectionRule(**rule) for rule in rules])


Judged = Union[Market, Rulebook]

#: A checkbox's two answers, as a rule names them.
TICKED = "ticked"
NOT_TICKED = "not ticked"
_CHECKBOX_ANSWERS = [{"value": TICKED, "label": "Ticked"}, {"value": NOT_TICKED, "label": "Not ticked"}]

#: The organizer's own question types a rule may name.
CHOICE_TYPES = ("select", "multi_select", "checkbox")

def rejection_questions(market: Judged) -> List[Dict[str, Any]]:
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


def prepared_rules(market: Judged, raw: Any) -> List[Dict[str, Any]]:
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


# --- Judging applications (E33/F03/S02) ----------------------------------------------------------

#: The statuses a rule may judge: nobody has decided them yet.
UNDECIDED = (ApplicationStatus.OPEN.value, ApplicationStatus.UNDER_REVIEW.value)


def _answer_values(field_type: str, raw: Any) -> List[str]:
    """An application's answer as the values a rule names: a checkbox's is whether it was ticked,
    and one never answered was not."""
    if field_type == "checkbox":
        return [TICKED if raw is True else NOT_TICKED]
    if isinstance(raw, list):
        return [str(value) for value in raw]
    return [str(raw)] if raw not in (None, "") else []


def rejecting(market: Judged, form_data: Dict[str, Any]) -> Optional[Tuple[str, str]]:
    """The first rule these answers meet, as ``(rule key, reason)``, or None.

    The reason is the organizer's, in the words the applicant chose from: "Did not tick “I understand
    that no-shows”", "Answered “Not a UBC student” to “Are you a UBC student?”".
    """
    questions = {q["key"]: q for q in rejection_questions(market)}
    types = {f.key: f.type for f in (market.application_form.fields
                                     if market.application_form else [])}
    for rule in market.rejection_rules or []:
        question = questions.get(rule.key)
        if question is None or not rule.answers:
            continue
        field_type = types.get(rule.key, "select")
        met = [v for v in _answer_values(field_type, form_data.get(rule.key)) if v in rule.answers]
        if not met:
            continue
        if field_type == "checkbox":
            verb = "Did not tick" if met[0] == NOT_TICKED else "Ticked"
            return rule.key, f"{verb} “{question['label']}”"
        labels = {a["value"]: a["label"] for a in question["answers"]}
        return rule.key, f"Answered “{labels.get(met[0], met[0])}” to “{question['label']}”"
    return None


def judge(market: Judged, market_id: str, application_ids: Optional[List[str]] = None) -> int:
    """Apply the market's rules to its undecided applications and to those a rule rejected; or to
    ``application_ids`` alone, as each arrives. Returns how many it rejected.

    An undecided application a rule meets is stored rejected, the rule its giver and the answer its
    reason. One a rule rejected that no rule meets any longer returns to undecided; one another rule
    meets keeps its rejection under that rule. A verdict a person gave is never read here at all.
    """
    rejected = 0
    for doc in ApplicationsApi.list_applications_for_market(market_id):
        if application_ids is not None and doc.get("id") not in application_ids:
            continue
        given_by = (doc.get("verdict_by") or {}).get("kind")
        by_rule = (doc.get("status") == ApplicationStatus.REVIEWER_REJECTED.value
                   and given_by == "rule")
        if doc.get("status") not in UNDECIDED and not by_rule:
            continue
        met = rejecting(market, doc.get("form_data") or {})
        if met is None:
            if by_rule:
                ApplicationsApi.update_application_status(doc["id"], ApplicationStatus.OPEN)
            continue
        rule_key, reason = met
        if by_rule and doc["verdict_by"].get("rule") == rule_key \
                and doc.get("verdict_reason") == reason:
            continue
        ApplicationsApi.update_application_status(
            doc["id"], ApplicationStatus.REVIEWER_REJECTED,
            by=VerdictGiver(kind="rule", rule=rule_key), reason=reason)
        rejected += 1
    return rejected
