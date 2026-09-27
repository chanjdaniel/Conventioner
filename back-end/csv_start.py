"""Confirming a draft started from a Google Form's responses (E24/F03/S03).

The organizer has reviewed the proposal (``csv_proposal``) and corrected it; confirm writes, in one
update of the market document, everything the ledger holds:

- **the plan facts**: the file's dates in the confirmed year and its tiers, only where the plan has
  none - the plan's own values win - and the ceiling on days per vendor;
- **the form**: each question of the organizer's own, in the file's order, with its label, help
  text, key, type, required flag and the options kept, and the rankings no column answers declared
  not asked;
- **the import mapping**, in the import's own format (``csv_import.mapping_payload``), so the first
  import of a later export opens with every column restored and every value matched.

It writes through the same judgements as the plan's and the form's own writes
(``prepared_plan``, ``prepared_application_form``) - the form lock above all - and then as one
``$set``, conditioned on the market still being a draft whose form has no questions of its own, so a
confirm either writes all of it or none of it.

The file is sent again rather than kept between the proposal and the confirm: the server never
stores it, and re-reading it is how confirm knows the columns without trusting the browser's copy
of them. The organizer's choices are the only thing the request adds.
"""
import copy
from datetime import date
from typing import Any, Dict, List, Optional, Set, Tuple

import api.markets as MarketsApi
import csv_import as CsvImport
import csv_proposal as CsvProposal
import essential_fields as EssentialFields
from market_documents import (
    market_doc_field, market_doc_filter, market_doc_key, market_from_document,
)

# The browser's "ignore this value", stored as None in a mapping's resolutions.
IGNORE_VALUE = "__ignore__"

CHOICE_TYPES = ("select", "multi_select")


class ConfirmRefused(ValueError):
    """The request cannot be written as it stands; the message says why."""


def _ledger_rows(columns: List[Dict[str, Any]]) -> Dict[int, List[int]]:
    """The ledger's rows by their first column: a grid's consecutive columns are one row, as the
    ledger shows them (``front-end/src/utils/csvProposal.ts``)."""
    rows: Dict[int, List[int]] = {}
    first: Optional[int] = None
    grid: Optional[str] = None
    for column in columns:
        if column["group"] and first is not None and grid == column["group"]:
            rows[first].append(column["index"])
            continue
        first, grid = column["index"], column["group"]
        rows[first] = [column["index"]]
    return rows


def _choices(proposal: Dict[str, Any], sent: Any) -> Dict[int, Dict[str, Any]]:
    """What each ledger row becomes: the organizer's choice where they sent one, else the proposal."""
    by_row = {c["index"]: c for c in proposal["columns"]}
    sent_by_row = {
        int(choice["column"]): choice for choice in sent or []
        if isinstance(choice, dict) and isinstance(choice.get("column"), int)
    }
    choices: Dict[int, Dict[str, Any]] = {}
    for first in _ledger_rows(proposal["columns"]):
        column = by_row[first]
        field = column["field"] or {}
        default = {
            "fate": column["fate"], "essential": column["essential"],
            "type": field.get("type", "text"), "required": field.get("required", False),
            "kept": [o["value"] for o in field.get("options", []) if o["keep"]],
        }
        choice = {**default, **{k: v for k, v in sent_by_row.get(first, {}).items()
                                if k in default}}
        if choice["fate"] not in (CsvProposal.FATE_SUBMITTED_AT, CsvProposal.FATE_APPLICANT_EMAIL,
                                  CsvProposal.FATE_ESSENTIAL, CsvProposal.FATE_CUSTOM,
                                  CsvProposal.FATE_LEFT_OUT):
            raise ConfirmRefused(f"Column {first + 1} cannot become {choice['fate']!r}.")
        if choice["fate"] == CsvProposal.FATE_CUSTOM and not column["field"]:
            raise ConfirmRefused(f"Column {first + 1} has no answers to make a question of.")
        choices[first] = choice
    return choices


def _target(choice: Dict[str, Any], key: Optional[str]) -> Optional[str]:
    """The import target a row maps to, or None for a row left out."""
    fate = choice["fate"]
    if fate in (CsvProposal.FATE_SUBMITTED_AT, CsvProposal.FATE_APPLICANT_EMAIL):
        return fate
    if fate == CsvProposal.FATE_ESSENTIAL:
        return choice["essential"]
    if fate == CsvProposal.FATE_CUSTOM:
        return key
    return None


def _form(proposal: Dict[str, Any], choices: Dict[int, Dict[str, Any]]) -> Dict[str, Any]:
    """The organizer's own questions, in the file's order, and the rankings nothing answers."""
    by_row = {c["index"]: c for c in proposal["columns"]}
    fields = []
    for first, choice in sorted(choices.items()):
        if choice["fate"] != CsvProposal.FATE_CUSTOM:
            continue
        field = by_row[first]["field"]
        field_type, options = choice["type"], []
        if field_type in CHOICE_TYPES:
            read = (field.get("optionsByType") or {}).get(field_type) or {"options": []}
            kept = set(choice["kept"] or [])
            options = [o["value"] for o in read["options"] if o["value"] in kept]
            # A choice with nothing kept to choose from is a question answered in words; the ledger
            # says so before confirm, rather than the whole confirm failing on it.
            if not options:
                field_type = "text"
        fields.append({
            "key": field["key"], "label": field["label"], "help_text": field["helpText"],
            "type": field_type, "required": bool(choice["required"]), "options": options,
            "order": len(fields),
        })
    answered = {c["essential"] for c in choices.values() if c["fate"] == CsvProposal.FATE_ESSENTIAL}
    unasked = [key for key in EssentialFields.UNASKABLE_ESSENTIAL_KEYS if key not in answered]
    return {"fields": fields, "unasked_essentials": unasked}


def _date_in_year(found: Dict[str, Any], year: int) -> Optional[str]:
    try:
        return date(year, found["month"], found["day"]).isoformat()
    except ValueError:
        return None


def _plan(market_doc: Dict[str, Any], proposal: Dict[str, Any], year: Optional[int],
          ceiling: Optional[int]) -> Dict[str, Any]:
    """The plan with the file's facts where it has none: the plan's own values win."""
    setup = copy.deepcopy(market_doc_field(market_doc, "setup_object") or {})
    setup.setdefault("priority", [])
    setup.setdefault("locations", [])
    setup.setdefault("sections", [])
    setup.setdefault("assignmentOptions", {})
    plan = proposal["plan"]
    if not setup.get("marketDates") and plan["dates"]:
        if year is None:
            raise ConfirmRefused("Say which year the file's dates are in.")
        setup["marketDates"] = [{"date": d} for d in
                                (_date_in_year(found, year) for found in plan["dates"]) if d]
    setup.setdefault("marketDates", [])
    if not setup.get("tiers") and plan["tiers"]:
        setup["tiers"] = [{"id": i, "name": t["name"]} for i, t in enumerate(plan["tiers"])]
    setup.setdefault("tiers", [])
    # The plan's own ceiling wins, as its dates and tiers do.
    if ceiling is not None and not setup["assignmentOptions"].get("maxAssignmentsPerVendor"):
        setup["assignmentOptions"] = {**setup["assignmentOptions"],
                                      "maxAssignmentsPerVendor": int(ceiling)}
    return setup


# The targets whose answers name the market's days, and the one whose answers name its tiers. A
# tier grid is both: its bracket texts are days and its cells are tiers.
DATE_TARGETS = (EssentialFields.AVAILABLE_DATES_KEY, EssentialFields.TIER_PREFERENCE_KEY)
TIER_TARGETS = (EssentialFields.TIER_PREFERENCE_KEY,)


def _resolutions(
    would_be: Dict[str, Any], csv_content: str, mapping: Dict[str, List[int]],
    proposal: Dict[str, Any], year: Optional[int], settled: Dict[str, Dict[str, str]],
) -> Dict[str, Dict[str, Optional[str]]]:
    """Every value the import would stop to ask about, answered now where it can be.

    ``would_be`` is the market as confirm would leave it. In a target that names the market's days,
    a day as the file names it becomes the date the confirmed year makes of it, or the plan's own
    date it is; a day or a tier the plan lacks is what the organizer settled it to - or, unsettled,
    is left for the import to ask about, since the organizer was shown it and did not decide.

    What is left is a value the proposal never offered: fewer than 3 applicants gave it, so it is
    not in the plan or the form (a TEST row's "TEST"), or it is a rare option the organizer did not
    keep. That is saved as ignored, so the import does not ask again about what the organizer
    already chose to leave out.
    """
    preview, _ = CsvImport.preview_values(would_be, csv_content, mapping, {})
    # A tier grid's entries offer the tiers even for its dates, so a day is checked against the
    # plan's own dates rather than against what the entry offers.
    plan_dates = set(EssentialFields.effective_essential_options(would_be).dates)
    days = {CsvImport.normalize_value(found["text"]): found for found in proposal["plan"]["dates"]}
    disputed = {(d["kind"], CsvImport.normalize_value(d["value"]))
                for d in proposal["plan"]["disagreements"]}

    resolutions: Dict[str, Dict[str, Optional[str]]] = {}
    for entry in preview.get("unmatched", []):
        target, value = entry["target"], entry["value"]
        normalized = CsvImport.normalize_value(value)
        kind = ("date" if target in DATE_TARGETS and (normalized in days
                                                      or CsvProposal.parse_date(value))
                else "tier" if target in TIER_TARGETS else None)
        if kind and value in (settled.get(kind) or {}):
            picked = settled[kind][value]
            resolutions.setdefault(target, {})[value] = None if picked == IGNORE_VALUE else picked
        elif kind and (kind, normalized) in disputed:
            continue  # shown to the organizer, not decided: the import asks
        elif kind == "date":
            resolutions.setdefault(target, {})[value] = _day(value, days, year, plan_dates)
        else:
            resolutions.setdefault(target, {})[value] = None
    return resolutions


def _day(value: str, days: Dict[str, Dict[str, Any]], year: Optional[int],
         plan_dates: Set[str]) -> Optional[str]:
    """The plan date a file's day is: the one it matched, or the one the year makes of it."""
    found = days.get(CsvImport.normalize_value(value))
    if found and found.get("matches"):
        return found["matches"]
    month_day = (found["month"], found["day"]) if found else CsvProposal.parse_date(value)[:2]
    made = _date_in_year({"month": month_day[0], "day": month_day[1]}, year) if year else None
    return made if made in plan_dates else None


def confirmed_update(market_doc: Dict[str, Any], csv_content: str,
                     body: Dict[str, Any]) -> Dict[str, Any]:
    """The one ``$set`` confirm writes: plan, form and mapping, judged but not yet written.

    Raises ``ConfirmRefused`` for a request that cannot be written, and lets the plan's and the
    form's own writers raise for what they refuse (``ValueError``, ``ApplicationFormLockedError``).
    """
    reason = CsvProposal.refusal(market_doc)
    if reason:
        raise ConfirmRefused(reason)
    error, headers, rows = CsvImport.parse_csv(csv_content)
    if error:
        raise ConfirmRefused(error)
    proposal = CsvProposal.proposal(headers, rows, market_doc)
    choices = _choices(proposal, body.get("rows"))

    taken: Dict[str, int] = {}
    for first, choice in choices.items():
        if choice["fate"] in (CsvProposal.FATE_CUSTOM, CsvProposal.FATE_LEFT_OUT):
            continue
        target = _target(choice, None)
        if target in taken:
            raise ConfirmRefused(
                f"Columns {taken[target] + 1} and {first + 1} cannot both answer the same thing.")
        taken[target] = first

    year = body.get("year")
    year = int(year) if isinstance(year, int) or (isinstance(year, str) and year.isdigit()) \
        else None
    ceiling = body.get("ceiling")
    ceiling = int(ceiling) if isinstance(ceiling, int) and ceiling > 0 else None

    market = market_from_document(market_doc)
    setup = _plan(market_doc, proposal, year, ceiling)
    plan_update = MarketsApi.prepared_plan(market, {"setupObject": setup})
    form = MarketsApi.prepared_application_form(market, _form(proposal, choices))

    by_row = {c["index"]: c for c in proposal["columns"]}
    ledger = _ledger_rows(proposal["columns"])
    mapping: Dict[str, List[int]] = {}
    for first, choice in choices.items():
        key = (by_row[first]["field"] or {}).get("key")
        target = _target(choice, key)
        if target:
            mapping[target] = ledger[first]

    would_be = {**market_doc, market_doc_key("setup_object"): setup,
                market_doc_key("application_form"): form}
    settled = {kind: values for kind, values in (body.get("settled") or {}).items()
               if isinstance(values, dict)}
    resolutions = _resolutions(would_be, csv_content, mapping, proposal, year, settled)
    return {
        **plan_update,
        market_doc_key("application_form"): form,
        market_doc_key("import_mapping"): CsvImport.mapping_payload(headers, mapping, resolutions),
    }


def still_startable(market_doc: Dict[str, Any]) -> Dict[str, Any]:
    """The filter a confirm writes under: the market as it was read - its id, and its phase as
    stored, so a legacy draft with no phase field is matched as the refusal judged it - and its form
    still without questions of its own. A market that changed since is written nothing."""
    phase = market_doc_key("phase")
    fields = f"{market_doc_key('application_form')}.fields"
    stored_phase = market_doc_field(market_doc, "phase")
    return {
        **market_doc_filter("id", market_doc["id"]),
        **({phase: stored_phase} if stored_phase is not None else {phase: {"$exists": False}}),
        "$and": [{"$or": [{fields: {"$exists": False}}, {fields: {"$size": 0}},
                          {market_doc_key("application_form"): None}]}],
    }


def confirm(market_doc: Dict[str, Any], body: Dict[str, Any]) -> Tuple[Dict[str, Any], int]:
    """Write everything the ledger holds, or nothing, and say which."""
    if not isinstance(body.get("csvContent"), str):
        return {"error": "csvContent is required"}, 400
    try:
        update = confirmed_update(market_doc, body["csvContent"], body)
    except ConfirmRefused as refused:
        return {"error": str(refused)}, 409
    except MarketsApi.ApplicationFormLockedError as locked:
        return {"error": str(locked)}, 409
    except ValueError as invalid:
        return {"error": str(invalid)}, 400

    result = MarketsApi.markets_collection.update_one(still_startable(market_doc),
                                                      {"$set": update})
    if not result.matched_count:
        return {"error": "This market changed since its file was read, so nothing was written. "
                         "Start again from its Market Setup."}, 409
    return {"written": True}, 200
