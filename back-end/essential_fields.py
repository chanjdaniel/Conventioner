"""The essential application-form questions: the answers the assignment solver reads directly.

Every application form asks these, whatever else the organizer builds. If the assignment
algorithm reads it, it is essential - that test is mechanical, and five fields pass it:

  - email                    -- the applicant's identity; captured at sign-in, not asked here
  - essential_available_dates -- which market dates the applicant CAN attend (capability)
  - essential_max_dates       -- at most how many dates they WANT (appetite; not capability)
  - essential_section_ranking -- section preference, best first
  - essential_table_type_ranking -- table type preference, best first

This module is the single owner of that contract: the reserved answer keys, the derivation of
what the questions offer, the validation of an applicant's answers, and the freeze that stops
the offering from moving under recorded answers.

The offering is never an independent list: it is the market plan itself. Dates come from
``SetupObject.market_dates``, sections from ``SetupObject.sections``, and table types from the
market's floorplan (the latest saved one - ``floorplans_save`` overwrites ``sections`` and
``locations`` from the latest floorplan too, so its table types are the current plan's).

Freeze semantics (the D9 principle extended to the offering): while no applicant has recorded
an answer, the offering follows the market plan live - an organizer edits their plan and the
form follows. The first accepted answer freezes the offering it was validated against onto
``applicationForm.essentialOptions`` (camelCase, like the whole market document) - written
atomically before the answer itself is stored, so no answer ever lands against an unfrozen
offering - and every later read serves that snapshot, so an applicant can never have answered
a question that moved. There is deliberately no way to refresh it afterwards.
"""
from typing import Any, Dict, List, Optional, Tuple

from assignment.utils import (
    convert_keys_to_camel_case,
    convert_keys_to_snake_case,
    snake_to_camel,
)
from datatypes import EssentialFormOptions, Market
from market_documents import market_doc_field, market_doc_key

# Custom builder fields may never use this prefix: the essential answers live beside the custom
# answers in ``Application.form_data``, and a custom field that shadowed one would corrupt what
# the solver reads.
ESSENTIAL_KEY_PREFIX = "essential_"

AVAILABLE_DATES_KEY = "essential_available_dates"
MAX_DATES_KEY = "essential_max_dates"
SECTION_RANKING_KEY = "essential_section_ranking"
TABLE_TYPE_RANKING_KEY = "essential_table_type_ranking"

# The labels the applicant sees, shared with error messages so a validation failure names the
# question exactly as the form asked it.
AVAILABLE_DATES_LABEL = "Available dates"
MAX_DATES_LABEL = "Number of dates you want"
SECTION_RANKING_LABEL = "Section preference"
TABLE_TYPE_RANKING_LABEL = "Table type preference"


def _unique_names(values: Any) -> List[str]:
    """Trimmed, non-blank, order-preserving unique strings."""
    seen: List[str] = []
    if not isinstance(values, list):
        return seen
    for value in values:
        text = str(value or "").strip()
        if text and text not in seen:
            seen.append(text)
    return seen


def essential_options_from_setup(setup: Optional[Dict[str, Any]]) -> EssentialFormOptions:
    """The essential questions' offering, read from the market plan.

    ``setup`` is a snake_case dict of ``SetupObject`` (a ``model_dump()``, or a stored
    ``setupObject`` converted through ``convert_keys_to_snake_case``). A market with no plan
    yet offers nothing - the applicant form omits questions whose offering is empty.
    """
    if not isinstance(setup, dict):
        return EssentialFormOptions()

    dates = _unique_names([
        md.get("date")
        for md in setup.get("market_dates") or []
        if isinstance(md, dict)
    ])
    sections = _unique_names([
        section.get("name")
        for section in setup.get("sections") or []
        if isinstance(section, dict)
    ])

    floorplans = [fp for fp in setup.get("floorplans") or [] if isinstance(fp, dict)]
    table_types: List[str] = []
    if floorplans:
        # The latest floorplan is the current plan: floorplans_save overwrites sections and
        # locations from it, so its table types are what the plan actually offers.
        table_types = _unique_names([
            table_type.get("name")
            for table_type in floorplans[-1].get("table_types") or []
            if isinstance(table_type, dict)
        ])

    return EssentialFormOptions(dates=dates, sections=sections, table_types=table_types)


def effective_essential_options(market_doc: Dict[str, Any]) -> EssentialFormOptions:
    """What the essential questions offer for this market, frozen or live.

    A stored snapshot (``applicationForm.essentialOptions``) wins: it is what an applicant's
    recorded answers were validated against, and it never moves. Absent one, the offering is
    the market plan as it stands.

    Callers hand in the raw stored (camelCase) market document; the projection must include
    ``applicationForm`` and ``setupObject``.
    """
    form_doc = market_doc_field(market_doc, "application_form")
    if isinstance(form_doc, dict):
        snapshot = form_doc.get(snake_to_camel("essential_options"))
        if isinstance(snapshot, dict):
            return essential_options_from_snapshot(snapshot)

    setup_doc = market_doc_field(market_doc, "setup_object")
    setup = convert_keys_to_snake_case(setup_doc) if isinstance(setup_doc, dict) else None
    return essential_options_from_setup(setup)


def effective_essential_options_for_market(market: Market) -> EssentialFormOptions:
    """``effective_essential_options`` over a parsed ``Market``: same rule, other representation.

    A frozen snapshot on the form wins; absent one, the offering is the market plan as it
    stands.
    """
    form = market.application_form
    if form is not None and form.essential_options is not None:
        return form.essential_options
    setup = market.setup_object.model_dump() if market.setup_object else None
    return essential_options_from_setup(setup)


def essential_options_from_snapshot(snapshot: Dict[str, Any]) -> EssentialFormOptions:
    """Parse a stored (camelCase) ``essentialOptions`` snapshot."""
    data = convert_keys_to_snake_case(snapshot)
    return EssentialFormOptions(
        dates=_unique_names(data.get("dates")),
        sections=_unique_names(data.get("sections")),
        table_types=_unique_names(data.get("table_types")),
    )


def essential_options_payload(options: EssentialFormOptions) -> Dict[str, Any]:
    """The camelCase wire/persisted shape of an offering."""
    return convert_keys_to_camel_case(options.model_dump())


def freeze_essential_options(
    markets_collection: Any, market_id: str, options: EssentialFormOptions,
) -> None:
    """Persist the offering the first recorded answer was validated against.

    Written once: the filter matches only while no snapshot is stored - ``None`` in a Mongo
    filter matches both a missing key and the explicit ``null`` the form save writes - so the
    first applicant save is the freeze point and concurrent saves cannot fight over it. The
    form must already be an object on the document - a dot-path ``$set`` onto a market with no
    form would conjure a fieldless one.
    """
    form_key = market_doc_key("application_form")
    snapshot_key = f"{form_key}.{snake_to_camel('essential_options')}"
    markets_collection.update_one(
        {
            "id": market_id,
            form_key: {"$type": "object"},
            snapshot_key: None,
        },
        {"$set": {snapshot_key: essential_options_payload(options)}},
    )


def freeze_and_effective_essential_options(
    markets_collection: Any, market_id: str, options: EssentialFormOptions,
) -> EssentialFormOptions:
    """Freeze the offering and return the one that actually governs the save.

    Called before an applicant's answers are persisted, so no answer can ever be recorded
    against an unfrozen offering. The freeze attempt is atomic and first-writer-wins; the
    re-read serves whichever snapshot won (ours, or a concurrent save's). A caller must
    re-validate its answers when the returned offering differs from the one it validated
    against, because that means another save froze a different offering first.
    """
    freeze_essential_options(markets_collection, market_id, options)
    form_key = market_doc_key("application_form")
    setup_key = market_doc_key("setup_object")
    market_doc = markets_collection.find_one(
        {"id": market_id}, {form_key: 1, setup_key: 1},
    )
    return effective_essential_options(market_doc or {})


# -- Applicant answer validation ---------------------------------------------------------------


def validated_essential_answers(
    incoming: Dict[str, Any], options: EssentialFormOptions,
) -> Tuple[Optional[str], Dict[str, Any]]:
    """Validate an applicant's essential answers against what the form offered.

    Returns ``(error_message, stored_answers)``; when ``error_message`` is not None the save
    must be refused. Questions whose offering is empty are not asked, so they are not required
    and store their empty value.

    STUBBED PRODUCT DECISIONS (deliberately minimal until the product owner rules):
      - Rankings are TOTAL: an applicant ranks every offered section / table type, and the
        stored list must be a permutation of the offering. A partial ranking ("only the ones I
        want") is not accepted yet.
      - ``max_dates`` is bounded by the number of OFFERED dates only. Its relation to the
        applicant's own available dates is not validated here; a consumer should treat the
        effective cap as ``min(max_dates, len(available_dates))``.
    """
    stored: Dict[str, Any] = {}

    error = _validate_available_dates(incoming, options, stored)
    if error:
        return error, {}

    error = _validate_max_dates(incoming, options, stored)
    if error:
        return error, {}

    error = _validate_ranking(
        incoming, SECTION_RANKING_KEY, SECTION_RANKING_LABEL, options.sections, stored,
    )
    if error:
        return error, {}

    error = _validate_ranking(
        incoming, TABLE_TYPE_RANKING_KEY, TABLE_TYPE_RANKING_LABEL, options.table_types, stored,
    )
    if error:
        return error, {}

    return None, stored


def _validate_available_dates(
    incoming: Dict[str, Any], options: EssentialFormOptions, stored: Dict[str, Any],
) -> Optional[str]:
    if not options.dates:
        stored[AVAILABLE_DATES_KEY] = []
        return None

    raw = incoming.get(AVAILABLE_DATES_KEY)
    if raw is None or raw == []:
        return f"'{AVAILABLE_DATES_LABEL}' is required. Select at least one date."
    if not isinstance(raw, list):
        return f"'{AVAILABLE_DATES_LABEL}' requires one or more of the offered dates."

    chosen = [str(value).strip() for value in raw]
    for value in chosen:
        if value not in options.dates:
            return f"'{AVAILABLE_DATES_LABEL}' contains a date this market does not offer: {value}"
    if len(set(chosen)) != len(chosen):
        return f"'{AVAILABLE_DATES_LABEL}' repeats a date."

    # Stored in the market plan's order, so every consumer reads one canonical ordering.
    stored[AVAILABLE_DATES_KEY] = [date for date in options.dates if date in chosen]
    return None


def _validate_max_dates(
    incoming: Dict[str, Any], options: EssentialFormOptions, stored: Dict[str, Any],
) -> Optional[str]:
    if not options.dates:
        stored[MAX_DATES_KEY] = None
        return None

    raw = incoming.get(MAX_DATES_KEY)
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return f"'{MAX_DATES_LABEL}' is required."

    if isinstance(raw, bool):
        return f"'{MAX_DATES_LABEL}' must be a whole number."
    if isinstance(raw, int):
        value = raw
    elif isinstance(raw, str):
        try:
            value = int(raw.strip())
        except ValueError:
            return f"'{MAX_DATES_LABEL}' must be a whole number."
    elif isinstance(raw, float) and raw.is_integer():
        value = int(raw)
    else:
        return f"'{MAX_DATES_LABEL}' must be a whole number."

    if value < 1:
        return f"'{MAX_DATES_LABEL}' must be at least 1."
    if value > len(options.dates):
        return (
            f"'{MAX_DATES_LABEL}' cannot exceed the {len(options.dates)} date(s) "
            f"this market offers."
        )

    stored[MAX_DATES_KEY] = value
    return None


def _validate_ranking(
    incoming: Dict[str, Any],
    key: str,
    label: str,
    offered: List[str],
    stored: Dict[str, Any],
) -> Optional[str]:
    if not offered:
        stored[key] = []
        return None

    raw = incoming.get(key)
    if raw is None or raw == []:
        return f"'{label}' is required. Rank every option, best first."
    if not isinstance(raw, list):
        return f"'{label}' must be an ordered list of the offered options."

    ranked = [str(value).strip() for value in raw]
    for value in ranked:
        if value not in offered:
            return f"'{label}' contains an option this market does not offer: {value}"
    if len(set(ranked)) != len(ranked):
        return f"'{label}' repeats an option."
    if len(ranked) != len(offered):
        # Stub: total ranking required (see the module docstring).
        missing = [value for value in offered if value not in ranked]
        return f"'{label}' must rank every option. Missing: {', '.join(missing)}"

    stored[key] = ranked
    return None
