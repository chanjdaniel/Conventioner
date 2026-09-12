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
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from market_documents import (
    market_doc_field,
    published_market_by_slug,
)
from datatypes import (
    Application,
    ApplicationStatus,
    MarketPhase,
    phase_from_market_document,
)
from utils.application_token import (
    verify_application_token,
)

import api.applications as ApplicationsApi
import essential_fields as EssentialFields

logger = logging.getLogger(__name__)


# ── Publication gate ───────────────────────────────────────────────────────

# The states of a review the organizer has not finished delivering. A reviewer recording a verdict
# is not the organizer sending it, and until the organizer acts outward via the publish-results
# endpoint, the applicant is told only that the application is under review.
#
# This has to be enforced here, on the way out of the process, because anything the applicant's
# browser receives, the applicant can read: a client-side label mapped over a payload that carries
# ``reviewer_rejected`` still ships the rejection in the response body and into the page markup.
# There is no applicant-facing payload that does not pass through ``_application_response``, so this
# is the one place that decides, and nothing downstream of it may reintroduce the raw value.
REVIEW_IN_PROGRESS_STATUSES = frozenset({
    ApplicationStatus.UNDER_REVIEW,
    ApplicationStatus.REVIEWER_APPROVED,
    ApplicationStatus.REVIEWER_REJECTED,
})


def applicant_visible_status(
    status: ApplicationStatus, results_published: bool,
) -> ApplicationStatus:
    """The status of an application as its applicant is allowed to know it.

    An organizer must not leak a half-finished review, and must retain the ability to change their
    mind before any applicant sees an outcome. Publication is the single, deliberate,
    organizer-controlled moment the verdict becomes visible.

    Until results are published, every working state of an unfinished review is collapsed to
    ``under_review`` so the applicant cannot distinguish a provisional acceptance from a
    provisional rejection. After publication the applicant sees the actual verdict.

    The organizer's view goes directly to the stored status and does not pass through here at all,
    so the organizer always sees the truth.
    """
    if not results_published and status in REVIEW_IN_PROGRESS_STATUSES:
        return ApplicationStatus.UNDER_REVIEW
    return status


def _application_response(
    app: Application, results_published: bool,
) -> Dict[str, Any]:
    """Serialize an application for the applicant-facing API with the publication gate applied."""
    return {
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


def _application_response_organizer(app: Application) -> Dict[str, Any]:
    """Serialize an application for the organizer-facing API with the raw status always visible."""
    return {
        "id": app.id,
        "marketId": app.market_id,
        "applicantEmail": app.applicant_email,
        "formData": app.form_data,
        "status": app.status.value,
        "applicationType": app.application_type.value,
        "mainApplicationId": app.main_application_id,
        "submittedAt": app.submitted_at,
        "updatedAt": app.updated_at,
    }




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


# ── Public (unauthenticated) endpoints ─────────────────────────────────────


def get_public_application_form(
    market_slug: str,
) -> Tuple[Dict[str, Any], int]:
    """Return the public application form for a market.

    Accessible without authentication. The form is returned for every published market, in every
    phase, alongside the phase and an ``is_open`` flag that says whether the market is still taking
    applications. It is not phase-gated on purpose: the applicant dashboard renders stored answers
    against this field list, so a market that has closed still has to be able to hand it over.

    Args:
        market_slug: The URL-safe slug of the market.

    Returns:
        Tuple of (response_body, status_code).
    """
    if not market_slug or not market_slug.strip():
        return {"error": "Market identifier is required."}, 400

    from db_config import get_database
    db = get_database()
    market_doc = published_market_by_slug(
        db["markets"],
        market_slug,
        fields=("id", "name", "phase", "applicationForm", "resultsPublished", "setupObject"),
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
        "is_open": phase == MarketPhase.APPLICATIONS_OPEN,
        "phase_label": phase.value.replace("_", " ").title(),
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
    market_doc = published_market_by_slug(db["markets"], market_slug, fields=("id", "resultsPublished"))
    if not market_doc:
        return {"error": "Market not found."}, 404

    market_id = market_doc.get("id", "")
    token_market_id = token_payload.get("market_id", "")
    if token_market_id != market_id:
        return {"error": "Your sign-in is for a different market. Please sign in again."}, 403

    app_id = token_payload.get("application_id", "")
    app_doc = ApplicationsApi.find_application_by_id(app_id)
    if not app_doc:
        return {"error": "Application not found."}, 404

    # Verify the application belongs to the token's email
    if app_doc.get("applicant_email") != token_payload.get("email"):
        return {"error": "Application not found."}, 404

    app = Application(**app_doc)
    results_published = bool(market_doc.get("resultsPublished"))
    return {"application": _application_response(app, results_published)}, 200


def save_applicant_application(
    market_slug: str, token_payload: Dict[str, Any], form_data: Dict[str, Any],
) -> Tuple[Dict[str, Any], int]:
    """Save or update the authenticated applicant's application for this market.

    Validates the form data against the market's application form fields, and the essential
    answers against what the essential questions offer (``essential_fields``). Refuses
    submission when the market is not in ``applications_open``.
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

    market_doc = published_market_by_slug(
        db["markets"],
        market_slug,
        fields=("id", "phase", "applicationForm", "resultsPublished", "setupObject"),
    )
    if not market_doc:
        return {"error": "Market not found."}, 404

    market_id = market_doc.get("id", "")
    token_market_id = token_payload.get("market_id", "")
    if token_market_id != market_id:
        return {"error": "Your sign-in is for a different market."}, 403

    phase = phase_from_market_document(market_doc)
    if phase != MarketPhase.APPLICATIONS_OPEN:
        phase_label = phase.value.replace("_", " ").title()
        return {
            "error": f"Applications are no longer open for this market. "
                     f"The market is in the {phase_label} phase.",
        }, 403

    app_id = token_payload.get("application_id", "")
    app_doc = ApplicationsApi.find_application_by_id(app_id)
    if not app_doc:
        return {"error": "Application not found."}, 404

    if app_doc.get("applicant_email") != token_payload.get("email"):
        return {"error": "Application not found."}, 404

    # Validate form data against the application form fields
    application_form = market_doc_field(market_doc, "application_form")
    fields = (application_form or {}).get("fields") or []
    error, stored_form_data = _validated_form_data(form_data, fields)
    if error:
        return {"error": error}, 422

    # Validate the essential answers against what the questions offered. The essential answers
    # are merged last so no custom answer can ever shadow one.
    essential_options = EssentialFields.effective_essential_options(market_doc)
    essential_error, essential_answers = EssentialFields.validated_essential_answers(
        form_data, essential_options,
    )
    if essential_error:
        return {"error": essential_error}, 422

    # Freeze BEFORE persisting, so no answer is ever recorded against an unfrozen offering.
    # A concurrent first save may have frozen a different offering; when the governing one
    # differs from what we validated against, re-validate against it.
    frozen_options = EssentialFields.freeze_and_effective_essential_options(
        db["markets"], market_id, essential_options,
    )
    if frozen_options != essential_options:
        essential_error, essential_answers = EssentialFields.validated_essential_answers(
            form_data, frozen_options,
        )
        if essential_error:
            return {"error": essential_error}, 422
    stored_form_data.update(essential_answers)

    now = datetime.now(timezone.utc).isoformat()

    submitted_at = app_doc.get("submitted_at") or now

    ApplicationsApi.update_application_form_data(
        app_id, stored_form_data,
        submitted_at, now,
    )
    if not app_doc.get("status"):
        ApplicationsApi.update_application_status(app_id, ApplicationStatus.OPEN)

    updated_doc = ApplicationsApi.find_application_by_id(app_id)
    app = Application(**updated_doc) if updated_doc else Application(**app_doc)
    results_published = bool(market_doc.get("resultsPublished"))
    return {"application": _application_response(app, results_published)}, 200


# ── Organizer (session-authenticated) endpoints ────────────────────────────


def list_market_applications(market_id: str) -> Tuple[Dict[str, Any], int]:
    """Return every application for a market. Organizer only, always sees raw status."""
    apps = ApplicationsApi.list_applications_for_market(market_id)
    result: List[Dict[str, Any]] = []
    for doc in apps:
        try:
            app = Application(**doc)
            result.append(_application_response_organizer(app))
        except Exception as e:
            logger.warning("Failed to parse application %s: %s", doc.get("id", "?"), e)
    return {"applications": result}, 200


def review_application(
    market_id: str, application_id: str, new_status: ApplicationStatus,
) -> Tuple[Dict[str, Any], int]:
    """Record a review verdict on an application. Organizer only, always sees raw status.

    The verdict is written but NOT revealed to the applicant until results are published.
    """
    if new_status not in (ApplicationStatus.REVIEWER_APPROVED, ApplicationStatus.REVIEWER_REJECTED):
        return {"error": f"Invalid review status: {new_status.value}"}, 400

    app_doc = ApplicationsApi.find_application_by_id(application_id)
    if not app_doc or app_doc.get("market_id") != market_id:
        return {"error": "Application not found for this market."}, 404

    found = ApplicationsApi.update_application_status(application_id, new_status)
    if not found:
        return {"error": "Application not found."}, 404

    app_doc["status"] = new_status.value
    app = Application(**app_doc)
    return {"application": _application_response_organizer(app)}, 200


def publish_results(market_id: str) -> Tuple[Dict[str, Any], int]:
    """Flip the results_published flag on a market, making verdicts visible to applicants.

    This is the single, deliberate, organizer-controlled moment the review verdicts become
    visible to the applicants who hold them. Before this call, every approved and rejected
    application reads as ``under_review`` to its applicant. After it, applicants see their
    actual outcome.
    """
    from db_config import get_database
    db = get_database()

    doc = db["markets"].find_one({"id": market_id})
    if not doc:
        return {"error": "Market not found."}, 404

    phase = phase_from_market_document(doc)
    if phase == MarketPhase.DRAFT:
        return {"error": "Cannot publish results on a draft market."}, 409

    already_published = bool(doc.get("resultsPublished"))
    if already_published:
        return {"error": "Results are already published."}, 409

    db["markets"].update_one(
        {"id": market_id},
        {"$set": {"resultsPublished": True}},
    )
    return {"results_published": True}, 200


# ── Form validation (shared between applicant and organizer) ───────────────

def _validated_form_data(
    incoming: Dict[str, Any], fields: List[Dict[str, Any]],
) -> Tuple[Optional[str], Dict[str, Any]]:
    """Validate submitted form data against field definitions.

    Returns (error_message, stored_data). When ``error_message`` is not None, the form
    should be refused. When it is None, ``stored_data`` is ready to persist.

    Field key defines identity; anything not in a field key is ignored (and
    stripped). An answer is present when it passes the field-type-specific
    "answered" test.
    """
    if not fields:
        return "This market does not have an application form configured.", {}

    stored: Dict[str, Any] = {}

    for field_def in fields:
        key = field_def.get("key")
        if not key:
            continue
        field_type = field_def.get("type", "text")
        required = field_def.get("required", False)
        label = field_def.get("label", key)

        raw = incoming.get(key)
        answered = _is_answered(raw, field_type)

        if not answered:
            if required:
                return f"'{label}' is required.", {}
            stored[key] = _unanswered_value(field_type)
            continue

        # Type-specific validation
        if field_type == "number":
            try:
                stored[key] = _as_number(raw)
            except (TypeError, ValueError) as e:
                return f"'{label}' must be a number: {e}", {}
            continue

        if field_type in ("select", "multi_select"):
            options = field_def.get("options") or []
            if field_type == "select":
                raw_str = str(raw).strip()
                if raw_str not in options:
                    return f"'{label}' must be one of: {', '.join(options)}", {}
                stored[key] = raw_str
            else:
                if not isinstance(raw, list):
                    return f"'{label}' requires one or more selections.", {}
                for val in raw:
                    if str(val).strip() not in options:
                        return f"'{label}' contains an invalid option: {val}", {}
                stored[key] = [str(v).strip() for v in raw]
            continue

        if field_type == "checkbox":
            if not isinstance(raw, bool):
                return f"'{label}' must be true or false.", {}
            stored[key] = raw
            continue

        # text, email, date: store as trimmed string
        if not isinstance(raw, str):
            return f"'{label}' must be text.", {}
        stored[key] = raw.strip()

    return None, stored


def _is_answered(value: Any, field_type: str) -> bool:
    """Whether a submitted value counts as an answer for a field of this type.

    "Present in the payload" is not the same as "answered", and the difference is type-shaped:
    an unticked mandatory consent checkbox arrives as ``False`` and an untouched mandatory
    multi_select as ``[]``, both of which are non-null, non-empty-string values that a purely
    null/blank test waves through.
    """
    if value is None:
        return False
    if isinstance(value, str):
        return value.strip() != ""
    if isinstance(value, list):
        return len(value) > 0
    if field_type == "checkbox":
        return value is True
    return True


def _unanswered_value(field_type: str) -> Any:
    """What an unanswered field of this type stores."""
    if field_type == "number":
        return None
    if field_type == "checkbox":
        return False
    if field_type == "multi_select":
        return []
    return ""


def _as_number(value: Any) -> Any:
    """The numeric value of an answer to a ``number`` field. Raises if it is not one."""
    if isinstance(value, bool):
        raise TypeError("a boolean is not a number")
    if isinstance(value, int):
        number: Any = value
    elif isinstance(value, str):
        text = value.strip()
        try:
            number = int(text)
        except ValueError:
            number = float(text)
    else:
        number = float(value)
    if isinstance(number, float):
        if number != number or number in (float("inf"), float("-inf")):
            raise ValueError("not a finite number")
    if isinstance(number, float) and number.is_integer():
        return int(number)
    return number
