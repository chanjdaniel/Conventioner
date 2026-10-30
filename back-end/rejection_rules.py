"""Which answers reject an application automatically (E33/F03).

The real market rejects every applicant who does not agree to the no-show terms, or who is not a
UBC student, alumnus or another accepted affiliation, and each was a manual rejection, one card at
a time. A rule names one CHOICE question - a select, a multi-select or a checkbox of the organizer's
own, or an essential choice the market asks (the table choice, the available dates) - and the
answers to it that reject. Free text is never a rule's: a typed answer has no fixed set of values.

This module is the one statement of what a rule may say and of how it judges; when the rules may
change is ``api.markets.rejection_rules_lock_reason``, beside the assignment rules' own. The market
read serves the questions and the rules as they stand against the current form, so the review setup
offers exactly what the write will take.
"""
from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, List, Optional, Tuple

import api.applications as ApplicationsApi
import essential_fields as EssentialFields
from client_errors import BadRequestError
from datatypes import AnswerCondition, ApplicationStatus, Market, RejectionRule, VerdictGiver

#: A checkbox's two answers, as a rule names them.
TICKED = "ticked"
NOT_TICKED = "not ticked"
_CHECKBOX_ANSWERS = [{"value": TICKED, "label": "Ticked"}, {"value": NOT_TICKED, "label": "Not ticked"}]

#: The organizer's own question types a rule may name.
CHOICE_TYPES = ("select", "multi_select", "checkbox")


def _day(iso: str) -> str:
    """A market date as the applicant chose it: "Saturday, August 1, 2026"."""
    try:
        day = date.fromisoformat(iso)
    except ValueError:
        return iso
    return f"{day:%A}, {day:%B} {day.day}, {day.year}"


class Rulebook:
    """A market's rules as they stand against its current form, and the questions they may name.

    Built once per market, from the parsed ``Market``. A rule naming a question the form no longer
    asks, or an answer it no longer offers, is left out here: it can judge nothing, and the next
    write of the list carries only what stands, so a form change never makes the list unsavable.
    """

    def __init__(self, market: Market):
        form = market.application_form
        fields = sorted(form.fields if form else [], key=lambda f: f.order)
        self.labels = {f.key: f.label for f in fields}
        self.types = {f.key: f.type for f in fields}
        self.questions: List[Dict[str, Any]] = []
        for field in fields:
            if field.type not in CHOICE_TYPES:
                continue
            answers = (_CHECKBOX_ANSWERS if field.type == "checkbox"
                       else [{"value": option, "label": option} for option in field.options])
            self.questions.append({"key": field.key, "label": field.label, "answers": answers})
        options = EssentialFields.effective_essential_options_for_market(market)
        asked = EssentialFields.asked_essential_keys(options)
        if EssentialFields.TABLE_CHOICE_KEY in asked:
            self.types[EssentialFields.TABLE_CHOICE_KEY] = "select"
            self.questions.append({
                "key": EssentialFields.TABLE_CHOICE_KEY,
                "label": EssentialFields.TABLE_CHOICE_LABEL,
                "answers": [{"value": choice, "label": EssentialFields.TABLE_CHOICE_LABELS[choice]}
                            for choice in EssentialFields.TABLE_CHOICES],
            })
        if EssentialFields.AVAILABLE_DATES_KEY in asked:
            self.types[EssentialFields.AVAILABLE_DATES_KEY] = "multi_select"
            self.questions.append({
                "key": EssentialFields.AVAILABLE_DATES_KEY,
                "label": EssentialFields.AVAILABLE_DATES_LABEL,
                "answers": [{"value": day, "label": _day(day)} for day in options.dates],
            })
        self.by_key = {q["key"]: q for q in self.questions}
        self.rules: List[RejectionRule] = []
        for rule in market.rejection_rules or []:
            question = self.by_key.get(rule.key)
            if question is not None:
                offered = {a["value"] for a in question["answers"]}
                self.rules.append(RejectionRule(
                    key=rule.key, answers=[a for a in rule.answers if a in offered]))
        self.results_published = bool(market.results_published)

    def served_rules(self) -> List[Dict[str, Any]]:
        return [rule.model_dump() for rule in self.rules]

    def prepared(self, raw: Any) -> List[Dict[str, Any]]:
        """The rules a write may store. Raises BadRequestError, in words for the organizer, for a
        rule on a question that is not a choice, an answer the question does not offer, or two rules
        on one question.

        A rule with no answer yet is kept: the organizer picks the question first, then the answers,
        and it rejects nothing until they do.
        """
        if not isinstance(raw, list):
            raise BadRequestError("rules must be a list.")
        rules: List[Dict[str, Any]] = []
        for rule in raw:
            key = str((rule or {}).get("key") or "").strip()
            question = self.by_key.get(key)
            if question is None:
                if key in self.labels:
                    raise BadRequestError(
                        f"'{self.labels[key]}' is answered in the applicant's own words, so no "
                        "answer to it can reject an application automatically.")
                raise BadRequestError(
                    f"This market's form has no question {key!r} with answers to choose.")
            if any(existing["key"] == key for existing in rules):
                raise BadRequestError(f"'{question['label']}' has one rule, which names every answer "
                                 "that rejects.")
            values = [a["value"] for a in question["answers"]]
            answers: List[str] = []
            for answer in (rule.get("answers") or []):
                answer = str(answer)
                if answer not in values:
                    raise BadRequestError(
                        f"'{question['label']}' does not offer the answer {answer!r}.")
                if answer not in answers:
                    answers.append(answer)
            rules.append({"key": key, "answers": answers})
        return rules

    def rejecting(self, form_data: Dict[str, Any]) -> Optional[Tuple[str, str]]:
        """The first rule these answers meet, as ``(rule key, reason)``, or None.

        The reason is the organizer's, whole, in the words the applicant chose from: "Did not tick
        “I understand that no-shows”", "Answered “Not a UBC student” to “Are you a UBC student?”".
        A question the application holds no answer to meets no rule: a checkbox added since it was
        written, or a column an import left out, is not an unticked box.
        """
        for rule in self.rules:
            met = self.met(rule, form_data)
            if not met:
                continue
            field_type = self.types[rule.key]
            question = self.by_key[rule.key]
            if field_type == "checkbox":
                verb = "Did not tick" if met[0] == NOT_TICKED else "Ticked"
                return rule.key, f"{verb} “{question['label']}”"
            labels = {a["value"]: a["label"] for a in question["answers"]}
            return rule.key, f"Answered “{labels.get(met[0], met[0])}” to “{question['label']}”"
        return None


    def met(self, condition: AnswerCondition, form_data: Dict[str, Any]) -> List[str]:
        """The answers in ``form_data`` that meet ``condition``, in the order given; none for a
        condition with no answer ticked yet, on a question the form does not ask as a choice, or
        that the application holds no answer to. A price group's conditions are judged here as
        well as the rules (E43/F01/S02), so both read an answer alike."""
        if not condition.answers or condition.key not in self.by_key \
                or condition.key not in form_data:
            return []
        values = _answer_values(self.types[condition.key], form_data[condition.key])
        return [value for value in values if value in condition.answers]

    def broken(self, condition: AnswerCondition) -> bool:
        """Whether ``condition`` names a question the form no longer asks as a choice, or an answer
        the question no longer offers. The rules simply leave out what the form no longer has (see
        ``__init__``); a price group's condition is kept and shown, since it decides what a vendor
        pays (E43/F01/S02)."""
        question = self.by_key.get(condition.key)
        if question is None:
            return True
        offered = {answer["value"] for answer in question["answers"]}
        return any(answer not in offered for answer in condition.answers)


def _answer_values(field_type: str, raw: Any) -> List[str]:
    """An application's answer as the values a rule names: a checkbox's is whether it was ticked."""
    if field_type == "checkbox":
        return [TICKED if raw is True else NOT_TICKED]
    if isinstance(raw, list):
        return [str(value) for value in raw]
    return [str(raw)] if raw not in (None, "") else []


@dataclass(frozen=True)
class Judged:
    """What one judging changed: how many applications the rules rejected, and how many a rule had
    rejected that it returned to undecided. The write that judged counts both in its history entry,
    since no rule is a person to record an entry of its own."""

    rejected: int = 0
    returned: int = 0

    def counts(self) -> Dict[str, int]:
        return {"rejected": self.rejected, "returned": self.returned}


def judge(
    book: Rulebook, market_id: str, application_id: Optional[str] = None, overturns: bool = True,
) -> Judged:
    """Apply the rules to the market's undecided applications and to those a rule rejected; or to
    ``application_id`` alone, as it arrives. Returns how many it rejected and returned.

    An undecided application a rule meets is stored rejected, the rule its giver and the answer its
    reason. One a rule rejected that no rule meets any longer returns to undecided - unless the
    results are published, when its applicant has seen the rejection and it stands, or unless
    ``overturns`` is false: returning it overturns an automatic rejection, which a person's write
    does only when the table's change row is theirs (E38/F06/S01). Every write is
    conditioned on the application being as it was read, so a person's verdict that lands in
    between is never overwritten.
    """
    rejected = returned = 0
    for doc in ApplicationsApi.judgeable_applications(market_id, application_id):
        by_rule = doc.get("status") == ApplicationStatus.REVIEWER_REJECTED.value
        # What the organizer reads, an update of an answer in its place (E41/F01/S01).
        met = book.rejecting(ApplicationsApi.effective_answers(doc))
        if met is None:
            if by_rule and overturns and not book.results_published \
                    and ApplicationsApi.update_application_status(
                        doc["id"], ApplicationStatus.OPEN, if_unchanged_since=doc):
                returned += 1
            continue
        rule_key, reason = met
        if by_rule and (doc.get("verdict_by") or {}).get("rule") == rule_key \
                and doc.get("verdict_reason") == reason:
            continue
        if ApplicationsApi.update_application_status(
                doc["id"], ApplicationStatus.REVIEWER_REJECTED,
                by=VerdictGiver(kind="rule", rule=rule_key), reason=reason,
                if_unchanged_since=doc):
            rejected += 1
    return Judged(rejected=rejected, returned=returned)
