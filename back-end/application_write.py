"""Recording an applicant's answers: the one write path both intake paths use.

An application that arrived by CSV import and one submitted through the public form must be the
SAME KIND OF DOCUMENT. If they are not, the solver reads two shapes and the organizer's review
view shows two behaviours - and the drift is silent, because nothing compares them.

Three things make that fragile enough to be worth a shared function rather than a shared
intention, all of them easy to leave out of a second implementation:

  1. The essential offering is FROZEN before the answers are persisted, and the save re-validates
     when a concurrent freeze won a different offering. An answer recorded against an unfrozen
     offering can have its question moved under it by a later market-plan edit.
  2. Answers are normalised through the shared validators into their stored shapes - dates as ISO
     strings in plan order, max dates as an int, rankings best-first, accepted sets in plan order.
  3. An application with no status yet becomes ``open``, which is what puts it in front of a
     reviewer.

So this module owns the sequence, and every caller gets all three. It deliberately takes plain
documents rather than a request or a session: the CSV importer has neither.
"""

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import api.applications as ApplicationsApi
import essential_fields as EssentialFields
from datatypes import Application, ApplicationStatus
from market_documents import market_doc_field

logger = logging.getLogger(__name__)


def _asks_nothing(market_doc: Dict[str, Any], fields: List[Dict[str, Any]]) -> bool:
    """Does this market ask nothing at all, so there is genuinely no form to answer?

    A form is its custom fields PLUS the essential questions the market plan asks, and either half
    alone is a form. This used to be read off the custom fields alone, which was true only before
    the essential questions existed: a market whose form was exactly the essential questions could
    open applications - ``FormHasFieldsGuard`` says such a form asks something - and then refuse
    every application it received, by import and by applicant alike.

    ``asked_essential_keys`` is deliberately the same function the guard and the solver's input
    translation read. Three copies of "what does this market ask" would drift, and the drift shows
    up as one layer refusing what another just accepted, which is exactly the bug this replaces.
    """
    if fields:
        return False
    options = EssentialFields.effective_essential_options(market_doc)
    return not EssentialFields.asked_essential_keys(options)


NO_FORM_ERROR = "This market does not have an application form configured."


def validate_application_answers(
    market_doc: Dict[str, Any], form_data: Dict[str, Any],
) -> Optional[str]:
    """Would these answers be accepted? Returns the refusal, or None.

    Writes nothing and - importantly - does NOT freeze the offering. A dry run that froze would
    make merely looking at an import decide what the form offers for ever, which is a side effect
    no preview is allowed to have. It therefore validates against the offering as it stands; the
    real save validates again, against whichever offering actually governs by then.
    """
    application_form = market_doc_field(market_doc, "application_form")
    fields = (application_form or {}).get("fields") or []
    if _asks_nothing(market_doc, fields):
        return NO_FORM_ERROR
    error, _stored = validated_form_data(form_data, fields)
    if error:
        return error

    options = EssentialFields.effective_essential_options(market_doc)
    essential_error, _answers = EssentialFields.validated_essential_answers(form_data, options)
    return essential_error


def record_application_answers(
    markets_collection: Any,
    market_doc: Dict[str, Any],
    app_doc: Dict[str, Any],
    form_data: Dict[str, Any],
) -> Tuple[Optional[str], Optional[Application]]:
    """Validate, freeze, persist and status an applicant's answers. The whole sequence, once.

    ``market_doc`` is the raw stored (camelCase) market; ``app_doc`` the raw stored application.
    Returns ``(error_message, application)``: when the message is not None nothing was written and
    the caller must refuse the save.

    The freeze happens BEFORE the answers are persisted so no answer is ever recorded against an
    unfrozen offering, and a concurrent first save that froze a different offering is handled by
    re-validating against whichever one actually governs.
    """
    application_form = market_doc_field(market_doc, "application_form")
    fields = (application_form or {}).get("fields") or []
    if _asks_nothing(market_doc, fields):
        return NO_FORM_ERROR, None
    error, stored_form_data = validated_form_data(form_data, fields)
    if error:
        return error, None

    # The essential answers are merged last so no custom answer can ever shadow one.
    essential_options = EssentialFields.effective_essential_options(market_doc)
    essential_error, essential_answers = EssentialFields.validated_essential_answers(
        form_data, essential_options,
    )
    if essential_error:
        return essential_error, None

    market_id = market_doc.get("id", "")
    frozen_options = EssentialFields.freeze_and_effective_essential_options(
        markets_collection, market_id, essential_options,
    )
    if frozen_options != essential_options:
        essential_error, essential_answers = EssentialFields.validated_essential_answers(
            form_data, frozen_options,
        )
        if essential_error:
            return essential_error, None
    stored_form_data.update(essential_answers)

    now = datetime.now(timezone.utc).isoformat()
    submitted_at = app_doc.get("submitted_at") or now
    app_id = app_doc.get("id", "")

    ApplicationsApi.update_application_form_data(app_id, stored_form_data, submitted_at, now)
    if not app_doc.get("status"):
        ApplicationsApi.update_application_status(app_id, ApplicationStatus.OPEN)

    updated_doc = ApplicationsApi.find_application_by_id(app_id)
    return None, Application(**(updated_doc or app_doc))


def validated_form_data(
    incoming: Dict[str, Any], fields: List[Dict[str, Any]],
) -> Tuple[Optional[str], Dict[str, Any]]:
    """Validate submitted form data against field definitions.

    Returns (error_message, stored_data). When ``error_message`` is not None, the form
    should be refused. When it is None, ``stored_data`` is ready to persist.

    Field key defines identity; anything not in a field key is ignored (and
    stripped). An answer is present when it passes the field-type-specific
    "answered" test.

    An empty field list is not an error here: it means the market asks no CUSTOM question, which
    is ordinary for a market whose form is exactly the essential questions. Whether the market
    asks anything at all is ``_asks_nothing``'s question, because only it can see both halves.
    """
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
