"""An organizer updates a vendor's info (E41/F01/S01).

A vendor's answer can be wrong, misspelt or out of date, and the organizer is who finds out. Their
update is kept beside the vendor's own answer, never over it (``Application.answer_updates``), and
read in its place everywhere the organizer reads the application (``effective_answers``). Writing
over the answer would last until the next re-import, which writes the file's answers again; kept
beside it, the update outlives a re-import and the vendor's own edit, and the organizer is told
when what the vendor wrote has changed since.

An answer the assignment reads is updated here too (E41/F01/S02), behind a row of its own, "Update
info the assignment or price reads", Admin by default; the solver reads the update as every other
reader does, so the next run uses it, and an assignment already made reads as out of date.
"""
from datetime import datetime, timezone
from typing import Any, Dict, Tuple

import api.applicants as ApplicantsApi
import api.applications as ApplicationsApi
import api.market_actions as Actions
import api.markets as MarketsApi
import essential_fields as EssentialFields
import history as History
import rejection_rules as RejectionRules
from application_write import validated_answer
from client_errors import BadRequestError, ForbiddenError, NotFoundError
from datatypes import AnswerUpdate, Market, MarketPerson

NOTHING_TO_UPDATE = "Change an answer to update it."


def update_vendor_info(
    market_id: str, application_id: str, answers: Any, updater: MarketPerson,
) -> Tuple[Dict[str, Any], int]:
    """Update some of a vendor's answers, ``{question key: new answer}``, as ``updater``.

    Each answer is held to what the form holds the vendor's to, and stored as the form stores it.
    One set back to what the vendor wrote takes its update away, so "Use their answer" is an
    answer like any other; one restated as it already reads changes nothing, and keeps who made it.
    Asks ``Actions.UPDATE_VENDOR_INFO`` in any phase, and an answer the assignment reads asks
    ``Actions.UPDATE_ASSIGNMENT_OR_PRICE_INFO`` too; an archived market refuses it.
    """
    market = MarketsApi._load_market_to_change(market_id, updater.email, Actions.UPDATE_VENDOR_INFO)
    if not isinstance(answers, dict) or not answers:
        raise BadRequestError(NOTHING_TO_UPDATE)
    doc = ApplicationsApi.find_application_by_id(application_id)
    if doc is None or doc.get("market_id") != market_id:
        raise NotFoundError("Application not found for this market.")

    fields = {field.key: field for field in (market.application_form.fields
                                             if market.application_form else [])}
    theirs = doc.get("form_data") or {}
    before = ApplicationsApi.effective_answers(doc)
    essential: Dict[str, Any] = {}
    values: Dict[str, Any] = {}
    for key, raw in answers.items():
        key = str(key)
        if key in EssentialFields.UPDATABLE_ESSENTIAL_QUESTIONS:
            essential[key] = raw
            continue
        field = fields.get(key)
        if field is None:
            raise BadRequestError("That question is not on this market's form.")
        error, value = validated_answer(field.model_dump(), raw)
        if error:
            raise BadRequestError(error)
        values[key] = value
    if essential:
        _assert_may_update_what_the_assignment_reads(market, essential, updater)
        error, stored = EssentialFields.validated_essential_update(
            before, essential, EssentialFields.effective_essential_options_for_market(market),
            limit_required=(
                before.get(EssentialFields.MAX_DATES_KEY) is not None
                and theirs.get(EssentialFields.MAX_DATES_KEY) is not None))
        if error:
            raise BadRequestError(error)
        values.update(stored)

    now = datetime.now(timezone.utc).isoformat()
    standing = doc.get(ApplicationsApi.ANSWER_UPDATES_FIELD) or {}
    updates: Dict[str, AnswerUpdate] = {}
    cleared = []
    kept: Dict[str, Any] = {}
    matched: Dict[str, Any] = {}
    for key, value in values.items():
        if value == before.get(key):
            # Restated over an answer the vendor changed since: the organizer keeps their update
            # over what they wrote now, which is what "Their answer changed since your update."
            # asked of them; where what they wrote now is the update itself, the update is taken
            # away, as setting an answer back to theirs does. Restated otherwise, it changes
            # nothing and keeps who made it.
            if key in standing and _over(standing[key]) != theirs.get(key):
                if value == theirs.get(key):
                    matched[key] = value
                    cleared.append(key)
                else:
                    kept[key] = value
                    updates[key] = AnswerUpdate(
                        value=value, by=updater, at=now, over=theirs.get(key))
            continue
        if value == theirs.get(key):
            cleared.append(key)
        else:
            updates[key] = AnswerUpdate(value=value, by=updater, at=now, over=theirs.get(key))

    ApplicationsApi.write_answer_updates(application_id, updates, cleared)
    stored = ApplicationsApi.find_application_by_id(application_id) or doc
    after = ApplicationsApi.effective_answers(stored)
    # The rules judge what the organizer now reads, as they judge an applicant's own save, while
    # the review is open: they settle with the verdicts on entering assignment, and an application
    # they returned to undecided after that is one no verdict could decide again. A rule's
    # rejection the update no longer meets returns to undecided only for someone who may overturn
    # one (E38/F06/S01).
    judging = (updates or cleared) and MarketsApi.review_is_open(market.phase)
    verdicts = (RejectionRules.judge(
        RejectionRules.Rulebook(market), market_id, application_id,
        overturns=MarketsApi.may_overturn(updater.email, market))
        if judging else RejectionRules.Judged())
    moved = [key for key in values if key not in kept and key not in matched]
    History.record(
        market_id, updater.email, Actions.UPDATE_VENDOR_INFO,
        kind=(History.KEPT if kept and not (updates.keys() - kept.keys() or cleared) else None),
        vendors=[doc.get("applicant_email")], subject={"application_id": application_id},
        detail=lambda: _with_rules(
            History.changes({key: before.get(key) for key in moved},
                            {key: after.get(key) for key in moved}),
            kept, matched, verdicts),
    )
    if verdicts.rejected or verdicts.returned:
        stored = ApplicationsApi.find_application_by_id(application_id) or stored
    return {"application": ApplicantsApi.organizer_view(stored)}, 200


def _assert_may_update_what_the_assignment_reads(
    market: Market, essential: Dict[str, Any], updater: MarketPerson,
) -> None:
    """An answer the assignment reads asks its own row as well, before it is judged: whoever may
    not update it is told so rather than what is wrong with the answer."""
    written = {key for question in essential
               for key in EssentialFields.UPDATABLE_ESSENTIAL_QUESTIONS[question]}
    if not written & set(EssentialFields.SOLVER_RELEVANT_KEYS):
        return
    refused = Actions.refusal(
        Actions.UPDATE_ASSIGNMENT_OR_PRICE_INFO, updater.email, market,
        MarketsApi._load_organization(market.organization_id))
    if refused:
        raise ForbiddenError(refused)


def _over(update: Any) -> Any:
    """The vendor's answer a stored update was made over."""
    return update.over if isinstance(update, AnswerUpdate) else (update or {}).get("over")


def _with_rules(
    changed, kept: Dict[str, Any], matched: Dict[str, Any], verdicts: RejectionRules.Judged,
):
    """The answers that changed, the updates kept over what the vendor wrote since, the updates
    taken away because what they wrote since matches them, and whether the rules rejected the
    application, or returned it to undecided, as they landed; a save that did none of these records
    nothing."""
    if not changed and not kept and not matched:
        return None
    return {**(changed or {}), **({"kept": kept} if kept else {}),
            **({"matched": matched} if matched else {}),
            "rejected_by_rules": bool(verdicts.rejected),
            "returned_by_rules": bool(verdicts.returned)}
