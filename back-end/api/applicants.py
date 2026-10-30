"""Applicant-facing application endpoints and organizer monitoring endpoints.

The applicant read path and the organizer review/monitoring path are in one module because they
share the same publication gate: ``applicant_visible_status`` is the one place that decides what
an applicant sees, and the organizer endpoints bypass it so the organizer always sees the truth.

Publication gate (captain ruling 2026-07-13):
    An applicant may sign in during any phase and always see their own submitted application.
    ``reviewer_approved`` / ``reviewer_rejected`` outcomes are HIDDEN from the applicant until
    the organizer explicitly PUBLISHES results. Until publication, the applicant sees a neutral
    ``under_review`` state - never the verdict.

    An organizer must not leak a half-finished review, and must retain the ability to change their
    mind before any applicant sees an outcome. Publication is the single, deliberate,
    organizer-controlled moment the verdict becomes visible.

    The enforcement lives on the BACKEND in ``applicant_visible_status``. No client-side hiding
    is sufficient: a verdict present in the API response is an information leak in the page markup,
    the same class of bug as the login oracle closed in 5d.
"""

import logging
from datetime import datetime
from typing import Any, Dict, Iterable, List, Optional, Tuple

from client_errors import parse_failure_detail
from application_write import record_application_answers, validate_application_answers
import table_share as TableShare
from market_documents import (
    applicant_intake_market_by_slug,
    market_doc_field,
    market_from_document,
    market_serves_applicants,
)
from datatypes import (
    Application,
    ApplicationStatus,
    IntakeMode,
    Market,
    MarketPerson,
    VendorAssignmentResult,
    VerdictGiver,
    MarketPhase,
    LEGACY_STAGE_PHASES,
    applications_stopped_from_market_document,
    phase_from_market_document,
    phase_label,
)
from utils.application_token import (
    verify_application_token,
)

import api.applications as ApplicationsApi
import api.market_actions as Actions
import history as History
import review_team as ReviewTeam
import result_outcome as ResultOutcome
from assignment.utils import convert_keys_to_snake_case
from assignment.made_from import changed_since_run
import rejection_rules as RejectionRules
import essential_fields as EssentialFields

logger = logging.getLogger(__name__)


# ── Publication gate ───────────────────────────────────────────────────────

def applicant_visible_status(
    status: ApplicationStatus, results_published: bool,
) -> ApplicationStatus:
    """The status of an application as its applicant is allowed to know it.

    Every application reads ``open`` - "Submitted" - whatever is stored (E36/F05/S01). The automatic rules judge an application in the request that saves it, so
    "Under Review" beside "Submitted" told an applicant a rule had rejected them the moment they
    submitted, and editing the answers flipped it back. Publication is the single, deliberate,
    organizer-controlled moment anything more is told.

    This has to be enforced here, on the way out of the process, because anything the applicant's
    browser receives, the applicant can read: a client-side label mapped over a payload that carries
    ``reviewer_rejected`` still ships the rejection in the response body and into the page markup.
    There is no applicant-facing payload that does not pass through ``_application_response``, so
    this is the one place that decides. The organizer's view never passes through here.
    """
    # After publication the applicant reads an outcome instead - a table, or none - which the
    # response carries beside this; a verdict is never theirs to read (E36/F05/S02), so rejected
    # and approved-without-a-seat read the same.
    return ApplicationStatus.OPEN


def _application_response(
    app: Application, results_published: bool,
    placements: Iterable[VendorAssignmentResult] = (),
) -> Dict[str, Any]:
    """Serialize an application for the applicant-facing API with the publication gate applied.

    After publication it carries the applicant's outcome and their own seats (E36/F05/S02), read
    off the stored placements on every read, so a seat changed by hand shows at once.
    """
    placed = list(placements)
    outcome = (
        ResultOutcome.outcome_of(app.applicant_email, ResultOutcome.seated_from(placed))
        if results_published else None
    )
    return {
        "outcome": outcome,
        "seats": ResultOutcome.seats_of(app.applicant_email, placed) if results_published else [],
        "id": app.id,
        "marketId": app.market_id,
        "applicantEmail": app.applicant_email,
        "formData": app.form_data,
        "status": applicant_visible_status(app.status, results_published).value,
        "applicationType": app.application_type.value,
        "mainApplicationId": app.main_application_id,
        "submittedAt": app.submitted_at,
        "updatedAt": app.updated_at,
    }


def _application_response_organizer(
    app: Application, now: Optional[datetime] = None,
) -> Dict[str, Any]:
    """Serialize an application for the organizer-facing API with the raw status always visible."""
    return {
        "id": app.id,
        "marketId": app.market_id,
        "applicantEmail": app.applicant_email,
        # The answers as the organizer reads them, each update in its place (E41/F01/S01), and
        # beside them who updated which, and what the vendor wrote.
        "formData": ApplicationsApi.effective_answers(app),
        "answerUpdates": _answer_updates_payload(app),
        "status": app.status.value,
        "applicationType": app.application_type.value,
        "mainApplicationId": app.main_application_id,
        "submittedAt": app.submitted_at,
        "updatedAt": app.updated_at,
        # Who gave the verdict and when (E34/F01/S01): the organizer's, never the applicant's.
        "verdictBy": giver_payload(app.verdict_by),
        "verdictAt": app.verdict_at,
        "verdictReason": app.verdict_reason,
        "followUpOwner": app.follow_up_owner.as_wire() if app.follow_up_owner else None,
        # Who is looking at it while their claim stands (E34/F03/S02).
        "heldBy": _holder(app, now),
        # Whose share it was dealt to (E38/F07/S02), null when it never was.
        "reviewer": app.reviewer.as_wire() if app.reviewer else None,
        # Who recorded a vendor who never applied, and when (E36/F03/S01).
        "addedBy": app.added_by.as_wire() if app.added_by else None,
        "addedAt": app.added_at,
    }


def _answer_updates_payload(app: Application) -> Dict[str, Any]:
    """Each updated answer (E41/F01/S01): the value read, who updated it and when, what the vendor
    wrote, and whether that has changed since the update was made over it (a re-import, or their
    own edit), which the organizer is told."""
    theirs = app.form_data or {}
    return {
        key: {
            "value": update.value,
            "by": update.by.as_wire(),
            "at": update.at,
            "over": update.over,
            "theyWrote": theirs.get(key),
            "changedSince": theirs.get(key) != update.over,
        }
        for key, update in app.answer_updates.items()
    }


def organizer_view(doc: Dict[str, Any]) -> Dict[str, Any]:
    """A stored application as the organizer reads it."""
    return _application_response_organizer(Application(**doc))


def _holder(app: Application, now: Optional[datetime]) -> Optional[Dict[str, Any]]:
    held = ApplicationsApi.holds(
        app.held_by.model_dump() if app.held_by else None, app.held_until, now)
    return MarketPerson(**held).as_wire() if held else None


def giver_payload(by: Optional[VerdictGiver]) -> Optional[Dict[str, Any]]:
    """A verdict's giver as the organizer's views read one."""
    if by is None:
        return None
    return {"kind": by.kind, "userId": by.user_id, "email": by.email, "rule": by.rule}




# ── JWT authentication ─────────────────────────────────────────────────────


def authenticate_request(authorization_header: Optional[str]) -> Optional[Dict[str, Any]]:
    """Parse the ``Authorization: Bearer <token>`` header and return the payload.

    Called by the route handlers to authenticate applicant requests.

    Args:
        authorization_header: The raw ``Authorization`` header value.

    Returns:
        Decoded token payload dict or None if invalid.
    """
    if not authorization_header:
        return None
    parts = authorization_header.strip().split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    return verify_application_token(parts[1])


# ── Taking applications (E38/F04/S02) ──────────────────────────────────────


def takes_applications(market_doc: Dict[str, Any]) -> bool:
    """Whether this market's applicant form takes a new application now.

    Only in the stage where applications arrive, and only while the organizer has not stopped
    taking them: a stop is a fact about the form, kept beside the phase rather than as one
    (``applicationsStopped``, ADR 0005). Entering assignment closes the form whatever the fact says.
    """
    return (
        phase_from_market_document(market_doc) is MarketPhase.APPLICATIONS
        and not applications_stopped_from_market_document(market_doc)
    )


def applicant_phase_label(market_doc: Dict[str, Any]) -> str:
    """The phase as an applicant reads it. A stopped form reads as a market whose applications have
    closed, the words such a market showed before the stage was one phase."""
    phase = phase_from_market_document(market_doc)
    if phase is MarketPhase.APPLICATIONS and not takes_applications(market_doc):
        return "Applications Closed"
    return phase_label(phase)


# ── Public (unauthenticated) endpoints ─────────────────────────────────────


def get_public_application_form(
    market_slug: str,
) -> Tuple[Dict[str, Any], int]:
    """Return the public application form for a market.

    Accessible without authentication. The form is returned for every market the applicant intake
    lookup serves - a form market, in every phase but draft (``APPLICANT_SURFACE_PHASES``) - alongside
    the phase and an ``is_open`` flag that says whether the market is still taking applications. It
    is not gated on applications being open, on purpose: the applicant dashboard renders stored
    answers against this field list, so a market that has closed still has to be able to hand it
    over (bug 20).

    Args:
        market_slug: The URL-safe slug of the market.

    Returns:
        Tuple of (response_body, status_code).
    """
    if not market_slug or not market_slug.strip():
        return {"error": "Market identifier is required."}, 400

    from db_config import get_database
    db = get_database()
    market_doc = applicant_intake_market_by_slug(
        db["markets"],
        market_slug,
        fields=(
            "id", "name", "phase", "applicationForm", "resultsPublished", "setupObject",
            "applicationsStopped",
        ),
    )
    if not market_doc:
        return {"error": "Market not found. Check the URL and try again."}, 404

    phase = phase_from_market_document(market_doc)
    application_form = market_doc_field(market_doc, "application_form")

    form_payload = None
    if application_form:
        fields = []
        for i, f in enumerate(application_form.get("fields", [])):
            fields.append({
                "key": f.get("key", ""),
                "label": f.get("label", ""),
                "type": f.get("type", "text"),
                "required": f.get("required", False),
                "options": f.get("options", []),
                "helpText": f.get("helpText"),
                "order": f.get("order", i),
            })
        form_payload = {"fields": fields}

    essential_options = EssentialFields.effective_essential_options(market_doc)

    return {
        "application_form": form_payload,
        "essential_options": EssentialFields.essential_options_payload(essential_options),
        "market_name": market_doc.get("name", ""),
        "phase": phase.value,
        "is_open": takes_applications(market_doc),
        "phase_label": applicant_phase_label(market_doc),
    }, 200


# ── Applicant (JWT-authenticated) endpoints ────────────────────────────────


def get_applicant_application(
    market_slug: str, token_payload: Dict[str, Any],
) -> Tuple[Dict[str, Any], int]:
    """Return the authenticated applicant's application data for this market.

    The status is passed through ``applicant_visible_status`` so the publication gate is enforced
    on the applicant read path.

    Args:
        market_slug: The URL-safe slug of the market.
        token_payload: Decoded JWT payload from ``verify_application_token``.

    Returns:
        Tuple of (response_body, status_code).
    """
    # Verify the token belongs to this market
    from db_config import get_database
    db = get_database()
    market_doc = applicant_intake_market_by_slug(
        db["markets"], market_slug, fields=("id", "resultsPublished", "assignmentObject"))
    if not market_doc:
        return {"error": "Market not found."}, 404

    market_id = market_doc.get("id", "")
    token_market_id = token_payload.get("market_id", "")
    if token_market_id != market_id:
        return {"error": "Your sign-in is for a different market. Please sign in again."}, 403

    # Found by its identity - this market, this address - which is what the token proves. A vendor
    # who has signed in but not yet applied has none, and that is an answer, not an error.
    app_doc = ApplicationsApi.find_application_by_email(market_id, token_payload.get("email", ""))
    if not app_doc:
        return {"application": None}, 200

    app = Application(**app_doc)
    results_published = bool(market_doc.get("resultsPublished"))
    return {"application": _application_response(
        app, results_published, _stored_placements(market_doc))}, 200


def _stored_placements(market_doc: Dict[str, Any]) -> List[VendorAssignmentResult]:
    """The seats a market document stores, as the outcome is read off them (E36/F05/S02)."""
    rows = (market_doc_field(market_doc, "assignment_object") or {}).get("vendorAssignments") or []
    return [VendorAssignmentResult(**convert_keys_to_snake_case(row)) for row in rows]


def save_applicant_application(
    market_slug: str, token_payload: Dict[str, Any], form_data: Dict[str, Any],
) -> Tuple[Dict[str, Any], int]:
    """Save or update the authenticated applicant's application for this market.

    Validates the form data against the market's application form fields, and the essential
    answers against what the essential questions offer (``essential_fields``). Refuses
    submission unless the market takes applications (``takes_applications``).
    The applicant owns their answers but never ``status``.

    The first successful save freezes the essential offering onto the market's stored form
    (``freeze_and_effective_essential_options``), atomically and before the answers are
    persisted, so later market-plan edits can never move a question an applicant has already
    answered and no answer is ever recorded against an unfrozen offering.

    Args:
        market_slug: The URL-safe slug of the market.
        token_payload: Decoded JWT payload from ``verify_application_token``.
        form_data: The form answers keyed by field keys.

    Returns:
        Tuple of (response_body, status_code).
    """
    if not isinstance(form_data, dict):
        return {"error": "Form answers must be an object keyed by field key."}, 400

    from db_config import get_database
    db = get_database()

    market_doc = applicant_intake_market_by_slug(
        db["markets"],
        market_slug,
        fields=(
            "id", "phase", "applicationForm", "resultsPublished", "setupObject",
            "applicationsStopped",
        ),
    )
    if not market_doc:
        return {"error": "Market not found."}, 404

    market_id = market_doc.get("id", "")
    token_market_id = token_payload.get("market_id", "")
    if token_market_id != market_id:
        return {"error": "Your sign-in is for a different market."}, 403

    if not takes_applications(market_doc):
        return {
            "error": f"Applications are no longer open for this market. "
                     f"The market is in the {applicant_phase_label(market_doc)} phase.",
        }, 403

    email = token_payload.get("email", "")
    existing = ApplicationsApi.find_application_by_email(market_id, email)

    # A first save creates the application (E26/F07/S01) - and only once the answers would be
    # accepted, so a refused first try leaves nothing behind for the organizer to review as an
    # empty application (the importer learned that as bug 5).
    if existing is None:
        refusal = validate_application_answers(market_doc, form_data)
        if refusal:
            return {"error": refusal}, 422
    app_doc = existing or ApplicationsApi.find_or_create_application(Application(
        market_id=market_id,
        applicant_email=email,
        form_data={},
        status=ApplicationStatus.OPEN,
    )).model_dump()

    # Validation, the offering freeze, the write and the status all live in one place, so an
    # imported application and a form-submitted one cannot drift apart.
    error, app = record_application_answers(db["markets"], market_doc, app_doc, form_data)
    if error:
        # Only reachable for a new application if the offering froze differently between the
        # check and the write; the application made for these answers must not outlive them.
        if existing is None:
            ApplicationsApi.delete_application(app_doc.get("id", ""))
        return {"error": error}, 422

    answered = app_doc.get("form_data") or {}

    # The market's rules judge it as it arrives (E33/F03/S02); the applicant is told nothing of it.
    # Read whole, through the canonical parse: the applicant's projection carries only what they see.
    market = market_from_document(db["markets"].find_one({"id": market_id}))
    verdicts = RejectionRules.judge(RejectionRules.Rulebook(market), market_id, app.id)
    # After the rules, so the entry says what they did to it: no rule records an entry of its own.
    saved = app
    History.record_applicant(
        market_id, email, History.EDITED if existing else History.SUBMITTED, app.id,
        lambda: _with_rules(History.changes(answered, saved.form_data or {}), verdicts))
    # Then dealt to the next reviewer in turn, if reviewers are chosen and it is still open
    # (E38/F07/S03): the applicant's own save is the arrival, so it is recorded as theirs.
    ReviewTeam.deal_arrivals(market, email, History.APPLY)
    if verdicts.rejected:
        app = Application(**ApplicationsApi.find_application_by_id(app.id))

    results_published = bool(market_doc.get("resultsPublished"))
    return {"application": _application_response(
        app, results_published, market.assignment_object.vendor_assignments or [])}, 200


# ── Organizer (session-authenticated) endpoints ────────────────────────────


def list_market_applications(market_id: str) -> Tuple[Dict[str, Any], int]:
    """Return every application for a market. Organizer only, always sees raw status."""
    parsed: List[Application] = []
    for doc in ApplicationsApi.list_applications_for_market(market_id):
        try:
            parsed.append(Application(**doc))
        except Exception as e:
            # Where it failed and never the input, which holds the applicant's answers.
            logger.warning(
                "Failed to parse application %s: %s", doc.get("id", "?"), parse_failure_detail(e),
            )

    # Whether each table-share request can be met depends on the market's other applications, so
    # it is derived here, where all of them are in hand, and never stored (E27/F01/S03).
    unpaired = TableShare.why_unpaired(
        [_share_request(app) for app in parsed],
        answered={
            app.applicant_email for app in parsed
            if EssentialFields.answered_table_share(app.form_data or {})
        },
    )
    result = []
    for app in parsed:
        notice = unpaired.get(app.applicant_email)
        result.append({
            **_application_response_organizer(app),
            "tableShareNotice": notice.as_payload() if notice else None,
        })
    return {"applications": result}, 200


def _share_request(app: Application) -> TableShare.ShareRequest:
    answers = app.form_data or {}
    return TableShare.ShareRequest(
        email=app.applicant_email,
        table_choice=answers.get(EssentialFields.TABLE_CHOICE_KEY),
        partners=(
            str(answers.get(EssentialFields.TABLE_SHARE_EMAIL_KEY) or ""),
            *(str(a) for a in answers.get(EssentialFields.TABLE_SHARE_ALSO_KEY) or []),
        ),
        taking_part=app.status not in _NOT_TAKING_PART,
    )


# Applications nobody will be seated from: the solver reads approved ones, and these never will be.
_NOT_TAKING_PART = (ApplicationStatus.REVIEWER_REJECTED, ApplicationStatus.CANCELLED)


#: What a reviewer did to an application, in the words a refused reviewer is told (E34/F03/S01).
_DONE_SINCE = {
    ApplicationStatus.REVIEWER_APPROVED.value: "approved this application",
    ApplicationStatus.REVIEWER_REJECTED.value: "rejected this application",
    ApplicationStatus.NEEDS_FOLLOW_UP.value: "marked this application as needing a follow-up",
}
_STATUS_WORD = {
    ApplicationStatus.REVIEWER_APPROVED.value: "approved",
    ApplicationStatus.REVIEWER_REJECTED.value: "rejected",
    ApplicationStatus.NEEDS_FOLLOW_UP.value: "needing a follow-up",
}


def seen_from(raw: Any) -> Optional[Dict[str, Any]]:
    """What a reviewer saw of an application, from the wire's ``{status, verdictAt, updatedAt}``,
    or None when they sent nothing (E34/F03/S01)."""
    if not isinstance(raw, dict):
        return None
    return {"status": raw.get("status"), "verdict_at": raw.get("verdictAt"),
            "updated_at": raw.get("updatedAt")}


def _changed_since_seen(doc: Dict[str, Any], seen: Optional[Dict[str, Any]] = None) -> str:
    """Who changed an application since a reviewer opened it, and to what (E34/F03/S01)."""
    if (seen and seen.get("status") == doc.get("status")
            and (seen.get("verdict_at") or None) == (doc.get("verdict_at") or None)):
        return "Its answers changed since you opened it."
    done = _DONE_SINCE.get(str(doc.get("status")))
    by = doc.get("verdict_by") or {}
    if done and by.get("kind") == "rule":
        return (f"An automatic rejection {_STATUS_WORD[str(doc.get('status'))]} this application "
                "since you opened it.")
    if done and by.get("email"):
        return f"{by['email']} {done} since you opened it."
    return "This application changed since you opened it."


def review_application(
    market_id: str, application_id: str, new_status: ApplicationStatus, by: VerdictGiver,
    owner: Optional[MarketPerson] = None, seen: Optional[Dict[str, Any]] = None,
    change_refused: Optional[str] = None,
) -> Tuple[Dict[str, Any], int]:
    """Record a review verdict on an application, and who gave it (E34/F01/S01). Organizer only,
    always sees raw status.

    The verdict is written but NOT revealed to the applicant until results are published.

    ``seen`` is the application as the reviewer saw it - its status and its verdict's time - and the
    verdict is written only if it still is (E34/F03/S01). Two reviewers at once used to mean the last
    verdict silently won; now the second is refused with a 409 naming who changed it and to what,
    and the application as it stands, so they decide again on what is really there.

    A write on an application already approved or rejected changes a verdict, the table's change
    row (E38/F06/S01): ``change_refused`` is that row's refusal of this reviewer, or None while they
    may. An application they saw decided is then refused with it, a 403; one decided since they saw
    it is the 409 above, never written over.
    """
    if new_status not in ApplicationsApi.MARKED_STATUSES:
        return {"error": f"Invalid review status: {new_status.value}"}, 400

    app_doc = ApplicationsApi.find_application_by_id(application_id)
    if not app_doc or app_doc.get("market_id") != market_id:
        return {"error": "Application not found for this market."}, 404
    if change_refused and ApplicationsApi.is_decided(seen or app_doc):
        return {"error": change_refused}, 403

    written = ApplicationsApi.update_application_status(
        application_id, new_status, by=by, owner=owner, if_unchanged_since=seen,
        unless_decided=bool(change_refused))
    if not written:
        now = ApplicationsApi.find_application_by_id(application_id)
        if now is None:
            return {"error": "Application not found."}, 404
        return {
            "error": _changed_since_seen(now, seen),
            "application": _application_response_organizer(Application(**now)),
        }, 409

    stored = ApplicationsApi.find_application_by_id(application_id)
    History.record(
        market_id, by.email, _verdict_row([app_doc]), kind=History.VERDICT,
        vendors=[app_doc.get("applicant_email")], subject={"application_id": application_id},
        detail=lambda: {"before": _verdict_state(app_doc), "after": _verdict_state(stored),
                        **_dealt_to(app_doc)},
    )
    app = Application(**stored)
    return {"application": _application_response_organizer(app)}, 200


def _verdict_row(before: List[Dict[str, Any]]) -> "Actions.Action":
    """The table's row a reviewer's write took, for its history entry: changing a verdict when any
    application it wrote was decided, else giving one (E38/F06/S01)."""
    if any(ApplicationsApi.is_decided(doc) for doc in before):
        return Actions.CHANGE_VERDICTS
    return Actions.GIVE_VERDICTS


def _with_rules(
    answers: Optional[Dict[str, Any]], verdicts: RejectionRules.Judged,
) -> Optional[Dict[str, Any]]:
    """An applicant's changed answers, and whether the rules rejected or returned the application
    as they landed; answers saved unchanged record nothing."""
    if not answers:
        return None
    return {**answers, "rejected_by_rules": bool(verdicts.rejected),
            "returned_by_rules": bool(verdicts.returned)}


def _dealt_to(doc: Dict[str, Any]) -> Dict[str, Any]:
    """Whom the application was dealt to, for a verdict's entry beside who gave it (E38/F07/S02):
    ``dealt_to``, the reviewer's address, when it has one, and nothing otherwise."""
    reviewer = (doc.get("reviewer") or {}).get("email")
    return {"dealt_to": reviewer} if reviewer else {}


def _each_dealt_to(docs: Iterable[Dict[str, Any]]) -> Dict[str, Any]:
    """``_dealt_to`` for a selection's entry: by application id, for those that were dealt."""
    dealt = {doc["id"]: _dealt_to(doc)["dealt_to"] for doc in docs if _dealt_to(doc)}
    return {"dealt_to": dealt} if dealt else {}


def _verdict_state(doc: Dict[str, Any]) -> Dict[str, Any]:
    """What a verdict changes, for its history entry: the status, and the follow-up's owner while
    there is one. Recorded whole even when a verdict is given again, since each one is recorded."""
    owner = (doc.get("follow_up_owner") or {}).get("email")
    return {"status": doc.get("status"), **({"follow_up_owner": owner} if owner else {})}


def review_selection(
    market_id: str, selection: List[Tuple[str, Optional[Dict[str, Any]]]],
    new_status: ApplicationStatus, by: VerdictGiver, change_refused: Optional[str] = None,
) -> Tuple[Dict[str, Any], int]:
    """One verdict for a ticked selection (E34/F04/S02). Organizer only.

    Each is written as a single verdict is, only on what the reviewer saw (``seen``, F03/S01); one
    another reviewer holds open is not written at all, nor one of another market. The answer says
    which were written and, for each skipped, why - never an action on "everything matching". One
    already at the status asked for is skipped too: a follow-up marked again would quietly change
    hands. One already approved or rejected is skipped with ``change_refused`` when it is set:
    this reviewer gives verdicts but may not change one (E38/F06/S01).
    """
    if new_status not in ApplicationsApi.MARKED_STATUSES:
        return {"error": f"Invalid review status: {new_status.value}"}, 400
    me = {"user_id": by.user_id, "email": by.email}
    written: List[str] = []
    was: Dict[str, Dict[str, Any]] = {}
    skipped: List[Dict[str, Any]] = []
    for app_id, seen in selection:
        doc = ApplicationsApi.find_application_by_id(app_id)
        if doc is None or doc.get("market_id") != market_id:
            skipped.append({"id": app_id, "email": None, "reason": "Not an application here."})
            continue
        holder = ApplicationsApi.holder_of(doc)
        if holder is not None and holder != me:
            skipped.append({"id": app_id, "email": doc.get("applicant_email"),
                            "reason": f"{holder['email']} has it open."})
            continue
        if doc.get("status") == new_status.value:
            skipped.append({"id": app_id, "email": doc.get("applicant_email"),
                            "reason": f"Already {_STATUS_WORD[new_status.value]}."})
            continue
        # Decided as they saw it, or by now: either way not theirs to change, so the row says why.
        if change_refused and (ApplicationsApi.is_decided(seen or doc)
                               or ApplicationsApi.is_decided(doc)):
            skipped.append({"id": app_id, "email": doc.get("applicant_email"),
                            "reason": change_refused})
            continue
        if ApplicationsApi.update_application_status(app_id, new_status, by=by,
                                                     if_unchanged_since=seen,
                                                     unless_decided=bool(change_refused)):
            written.append(app_id)
            was[app_id] = doc
        else:
            now = ApplicationsApi.find_application_by_id(app_id) or doc
            skipped.append({"id": app_id, "email": doc.get("applicant_email"),
                            "reason": _changed_since_seen(now, seen)})
    if written:
        # One entry for the selection, as it was one action, naming every vendor it decided.
        History.record(
            market_id, by.email, _verdict_row([was[app_id] for app_id in written]),
            kind=History.VERDICTS,
            vendors=[was[app_id].get("applicant_email") for app_id in written],
            subject={"application_ids": written},
            detail=lambda: {
                "before": {app_id: _verdict_state(was[app_id]) for app_id in written},
                "after": {
                    app_id: _verdict_state(ApplicationsApi.find_application_by_id(app_id))
                    for app_id in written
                },
                **_each_dealt_to(was[app_id] for app_id in written),
            },
        )
    return {"written": written, "skipped": skipped}, 200


def reassign_follow_up(
    market_id: str, application_id: str, owner: MarketPerson, by: str,
) -> Tuple[Dict[str, Any], int]:
    """Hand a follow-up to someone else with a role on the market (E34/F02/S01), ``by`` the
    signed-in reviewer."""
    app_doc = ApplicationsApi.find_application_by_id(application_id)
    if not app_doc or app_doc.get("market_id") != market_id:
        return {"error": "Application not found for this market."}, 404
    if not ApplicationsApi.reassign_follow_up_owner(application_id, owner):
        return {"error": "Only an application that needs a follow-up has an owner."}, 409
    History.record(
        market_id, by, Actions.GIVE_VERDICTS, kind=History.FOLLOW_UP_OWNER,
        vendors=[app_doc.get("applicant_email")], subject={"application_id": application_id},
        detail=lambda: History.changes(
            {"follow_up_owner": (app_doc.get("follow_up_owner") or {}).get("email")},
            {"follow_up_owner": owner.email},
        ),
    )
    app = Application(**ApplicationsApi.find_application_by_id(application_id))
    return {"application": _application_response_organizer(app)}, 200


NO_APPLICANTS_TO_TELL = (
    "This market takes its vendors by import, so it has no applicants to publish results to."
)


def publish_results_refusal(market: Market) -> Optional[str]:
    """Why results cannot be published now, or None while they can (E36/F04/S01).

    Results wait for the allocation: in assignment, once a run is stored and current, so every
    applicant is told what the market will hold, and nobody's answer shifts under them through a
    later run. Served as ``publishWaitsReason``, beside the table's Publish results answer, so the
    button is offered exactly when the endpoint would take it.
    """
    if market.intake_mode is not IntakeMode.FORM:
        return NO_APPLICANTS_TO_TELL
    if market.results_published:
        return "Results are already published."
    if market.phase is not MarketPhase.ASSIGNMENT:
        return (
            "Results are published once tables have been allocated, so each applicant is told "
            "whether they have a table."
        )
    if not market.assignment_object.vendor_assignments:
        return "Allocate tables first: results tell each applicant whether they have a table."
    if changed_since_run(market):
        return (
            "The table allocation is out of date. Allocate tables again before publishing, so "
            "applicants are told what the market will hold."
        )
    return None


def applications_stop_refusal(market: Market) -> Optional[str]:
    """Why taking applications cannot be stopped or resumed now, or None while it can (E38/F04/S02).

    Inside the stage alone, and only where vendors apply on the market's own page: a Google Form
    market's form is the organizer's own, closed outside this product. Served on the market read as
    ``applicationsStopReason``, beside the table's Stop taking applications answer, so the rail
    offers the action exactly when the endpoint would take it.
    """
    if market.intake_mode is not IntakeMode.FORM:
        return "This market's vendors apply on its Google Form, so it has no application page to stop."
    if market.phase is not MarketPhase.APPLICATIONS:
        return "Applications are taken only in the Applications phase."
    return None


def set_applications_stopped(
    market_id: str, stopped: bool, by: str,
) -> Tuple[Dict[str, Any], int]:
    """Stop taking applications, or take them again, on a market whose vendors apply on its page,
    ``by`` the signed-in organizer.

    The write is conditional on the market still being where the refusal judged it, so a move into
    assignment that lands first leaves nothing to undo. Who may is the caller's to ask first.
    """
    from db_config import get_database
    db = get_database()

    doc = db["markets"].find_one({"id": market_id})
    if not doc:
        return {"error": "Market not found."}, 404
    refusal = applications_stop_refusal(market_from_document(doc))
    if refusal:
        return {"error": refusal}, 409

    result = db["markets"].update_one(
        {
            "id": market_id,
            # An old stage phase too, read as the stage until the migration has run.
            "phase": {"$in": [MarketPhase.APPLICATIONS.value, *LEGACY_STAGE_PHASES]},
            "intakeMode": IntakeMode.FORM.value,
        },
        {"$set": {"applicationsStopped": stopped}},
    )
    if not result.matched_count:
        return {"error": "This market moved while the request was in flight. Reload it and try again."}, 409
    # A stop restated records nothing.
    History.record(market_id, by, Actions.STOP_APPLICATIONS, detail=lambda: History.changes(
        {"applications_stopped": applications_stopped_from_market_document(doc)},
        {"applications_stopped": stopped}))
    return {"applications_stopped": stopped}, 200


def publish_results(market_id: str, by: str) -> Tuple[Dict[str, Any], int]:
    """Flip the results_published flag on a market, making verdicts visible to applicants.

    This is the single, deliberate, organizer-controlled moment the review verdicts become
    visible to the applicants who hold them. Before this call, every approved and rejected
    application reads as ``under_review`` to its applicant. After it, applicants see their
    actual outcome.

    Refused on a CSV market, because on one the flag has no reader: every endpoint that consults
    it goes through ``applicant_intake_market_by_slug``, which serves form-intake markets only. The
    button is hidden there too, but a hidden button is not a rule - the endpoint is reachable
    directly.
    """
    from db_config import get_database
    db = get_database()

    doc = db["markets"].find_one({"id": market_id})
    if not doc:
        return {"error": "Market not found."}, 404

    if not market_serves_applicants(doc):
        return {"error": NO_APPLICANTS_TO_TELL}, 409
    refusal = publish_results_refusal(market_from_document(doc))
    if refusal:
        return {"error": refusal}, 409

    db["markets"].update_one(
        {"id": market_id},
        {"$set": {"resultsPublished": True}},
    )
    History.record(market_id, by, Actions.PUBLISH_RESULTS,
                   detail=lambda: History.changes(
                       {"results_published": False}, {"results_published": True}))
    return {"results_published": True}, 200
