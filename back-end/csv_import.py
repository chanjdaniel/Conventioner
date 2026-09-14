"""Importing vendors from the CSV a Google Form produced.

The organizer's form is not ours: its headers are whatever they typed, so nothing can be matched
by name. They map each column to the question it answers, and this module turns the result into
``Application`` records - the same records the public application form produces.

That sameness is the point, and it is why every row goes through
``application_write.record_application_answers`` rather than writing its own document. An imported
application and a form-submitted one are then the same kind of thing by construction, so the
solver reads one shape and the review view shows one behaviour.

One question does not always mean one column. A Google Forms CHECKBOX GRID exports one column per
option, its header carrying the question stem and the option in brackets; the same question asked
once exports as a single comma-separated column. Both mean the same thing, so both must import to
the same stored answer - which is why a mapping maps a target to one column OR to several.

Cell values are the organizer's own free text, so they rarely name the market's configuration
exactly: a form that said "Gold Tier" has to reach a tier called "Gold". Trivial differences -
surrounding space, capitalisation - are matched silently, because making someone audit those is
worse than useless. Everything left over is shown to them ONCE per distinct value, with the number
of rows it affects, and mapped by hand. The distinct values in a column are a small set, which is
what makes that cheap: three values to look at rather than two hundred rows.
"""
import csv
import io
import logging
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Sequence, Tuple, Union

import api.applications as ApplicationsApi
import essential_fields as EssentialFields
from application_write import record_application_answers, validate_application_answers
from datatypes import (
    SUBMITTED_AT_RULE_TARGET,
    Application,
    ApplicationStatus,
    ImportMapping,
    MarketPhase,
    phase_from_market_document,
)
from market_documents import market_doc_field, market_doc_key

logger = logging.getLogger(__name__)

# Not a form answer: it identifies the applicant, so it lands on the document rather than in
# ``form_data``. Every import must map it - without it a row names nobody.
# Importing is an intake operation, so it belongs to the phases where a market is taking
# applications. Once REVIEW has begun, the applicant set must stop moving under the reviewer:
# rows appearing, changing, or returning to `open` beneath someone working through a list is the
# hazard. The organizer is not stuck - `review -> applications_closed` is an existing edge, so the
# way through is to reopen, import, and move forward again. That is deliberate and visible, and it
# needs no new edges in the transition registry.
IMPORT_PHASES = (MarketPhase.APPLICATIONS_OPEN, MarketPhase.APPLICATIONS_CLOSED)


def import_phase_refusal(market_doc: Dict[str, Any]) -> Optional[str]:
    """Why this market cannot be imported into right now, or None."""
    phase = phase_from_market_document(market_doc)
    if phase in IMPORT_PHASES:
        return None
    readable = phase.value.replace("_", " ")
    if phase == MarketPhase.DRAFT:
        return (
            f"This market is still a draft, so it is not taking applications yet. "
            f"Open applications first, then import."
        )
    return (
        f"This market is in the {readable} phase, so importing would change the applicant set "
        f"under a review that has already begun. Reopen applications first (move back to "
        f"applications closed), then import."
    )


# The shapes a form export actually writes a timestamp in. Google Forms emits the spreadsheet's
# locale, and a sheet exports unpadded, so a single-digit month or hour is the norm rather than the
# exception - which is exactly what made text ordering wrong.
_SUBMITTED_AT_FORMATS = (
    "%m/%d/%Y %H:%M:%S",
    "%m/%d/%Y %I:%M:%S %p",
    "%m/%d/%Y %H:%M",
    "%m/%d/%Y %I:%M %p",
    "%m/%d/%Y",
    "%d/%m/%Y %H:%M:%S",
    "%Y/%m/%d %H:%M:%S",
)


def normalized_submitted_at(raw: Any) -> Optional[str]:
    """A submission timestamp as ISO-8601, or None when the row carries none.

    Every reader of ``submitted_at`` compares the STORED value: the solver's priority rule through
    ``_as_magnitude``, and the organizer's review queue through a Mongo sort. Both were wrong on a
    form export, in the same way and for the same reason - ``9/27/2025 9:04:01`` is neither
    parseable by ``datetime.fromisoformat`` nor orderable as text against ``9/27/2025 23:49:25``.

    The public applicant form already writes ISO, so normalising here is not a new format: it is
    the CSV path agreeing with the path that was already right. Converting at read instead would
    leave two stored shapes alive for the life of the product and fix only the reader someone
    remembered to teach.

    Raises ``ValueError`` on a value that is not a time at all. Refusing is deliberate: scoring an
    unreadable timestamp as ``math.inf`` alongside everybody else is how this stayed invisible.
    """
    if raw is None:
        return None
    text = str(raw).strip()
    if not text:
        return None

    try:
        # Already ISO - the public form's shape. Returned untouched so a round-trip is a no-op.
        datetime.fromisoformat(text.replace("Z", "+00:00"))
        return text
    except ValueError:
        pass

    for fmt in _SUBMITTED_AT_FORMATS:
        try:
            return datetime.strptime(text, fmt).isoformat()
        except ValueError:
            continue

    raise ValueError(
        f"{text!r} is not a date and time this import can read. "
        "Expected something like 9/12/2025 18:22:56 or 2025-09-12T18:22:56."
    )


# A row whose mapped timestamp will not parse. Prefixed rather than dropped, so the refusal can
# quote what the organizer actually typed.
_UNREADABLE_TIMESTAMP = "\x00unreadable:"

APPLICANT_EMAIL_TARGET = "applicant_email"
APPLICANT_EMAIL_LABEL = "Applicant email"

# Also not a form answer. Google Forms emits it as the first column of every export, and a
# priority rule ordering by submission time reads it. Optional: a market with no time-based
# priority does not need it, and warning beats blocking.
SUBMITTED_AT_TARGET = "submitted_at"
SUBMITTED_AT_LABEL = "Submitted at"

# Header text Google Forms uses, so the obvious mapping can be offered rather than asked for.
_AUTO_DETECT = {
    "timestamp": SUBMITTED_AT_TARGET,
    "email address": APPLICANT_EMAIL_TARGET,
    "email": APPLICANT_EMAIL_TARGET,
}

_RANKING_ESSENTIALS = (
    EssentialFields.SECTION_RANKING_KEY,
    EssentialFields.TABLE_TYPE_RANKING_KEY,
)

_MULTI_VALUE_ESSENTIALS = (
    EssentialFields.AVAILABLE_DATES_KEY,
    EssentialFields.TIER_PREFERENCE_KEY,
    EssentialFields.SECTION_RANKING_KEY,
    EssentialFields.TABLE_TYPE_RANKING_KEY,
)


def collapse_header(header: Any) -> str:
    """A header as one line of single-spaced text.

    A real Google Forms header carries its instructions above the question, so it arrives with
    newlines and runs of spaces in it. Two places compare header text - grouping a grid, and
    restoring a saved mapping onto a fresh export - and they must agree, or a re-export that
    re-wraps a header silently fails to restore.
    """
    return " ".join(str(header).split())


# "Which days can you attend? [Saturday July 4]" - the shape Google Forms gives every grid column.
#
# DOTALL because a real grid question carries its instructions above the bracketed option, so the
# header spans lines. Without it this matched only headers short enough to fit on one - which is
# every header the tests used to write, and no header a real form produces. The five day columns of
# a real export arrived as five unrelated columns, each competing for the same single target, and
# the import could not be completed at all.
_GRID_HEADER = re.compile(r"^(?P<stem>.+?)\s*\[(?P<option>.+)\]$", re.DOTALL)


class ColumnGroup:
    """Several columns that are one question: a checkbox or multiple-choice grid."""

    def __init__(self, stem: str, columns: List[int], options: List[str]):
        self.stem = stem
        self.columns = columns
        self.options = options

    def payload(self) -> Dict[str, Any]:
        return {"stem": self.stem, "columns": self.columns, "options": self.options}


def column_groups(headers: Sequence[str]) -> List[ColumnGroup]:
    """Columns sharing a question stem, in the order the file writes them.

    A single bracketed column is NOT a group: one column is not a grid, and grouping it would
    invent structure the file does not have.
    """
    order: List[str] = []
    found: Dict[str, ColumnGroup] = {}
    for index, header in enumerate(headers):
        match = _GRID_HEADER.match(str(header).strip())
        if not match:
            continue
        # The stem labels the group in the organizer's ledger, so it is collapsed to one line.
        stem = collapse_header(match.group("stem"))
        option = collapse_header(match.group("option"))
        if stem not in found:
            found[stem] = ColumnGroup(stem, [], [])
            order.append(stem)
        found[stem].columns.append(index)
        found[stem].options.append(option)
    return [found[stem] for stem in order if len(found[stem].columns) > 1]


def _normalize(value: str) -> str:
    """The form in which two values are "the same" for matching purposes.

    Space and capitalisation are noise here: a form answer of " gold " and a tier named "Gold" are
    the same thing to everyone except a string comparison, and surfacing that as a decision would
    train the organizer to click through the whole list.
    """
    return " ".join(str(value).strip().lower().split())


class ImportTarget:
    """One thing a CSV column can be mapped to."""

    def __init__(self, key: str, label: str, required: bool, kind: str):
        self.key = key
        self.label = label
        self.required = required
        self.kind = kind  # "identity" | "essential" | "custom" | "meta"

    def payload(self) -> Dict[str, Any]:
        return {
            "key": self.key, "label": self.label,
            "required": self.required, "kind": self.kind,
        }


def import_targets(market_doc: Dict[str, Any]) -> List[ImportTarget]:
    """Every target this market's columns can be mapped to, in the order the form asks them.

    The essential questions listed are the ones actually ASKED: a question whose offering is
    empty, or a ranking of fewer than two options, is not asked and so is not a target. Offering
    it would invite the organizer to map a column that would then be discarded.
    """
    options = EssentialFields.effective_essential_options(market_doc)
    asked = EssentialFields.asked_essential_keys(options)

    # One entry per essential question, in the order the form asks them. Which of these are
    # actually offered is NOT decided here: ``asked_essential_keys`` is the single statement of
    # that rule, and this used to re-implement it (``options.dates``, ``len(options.sections) > 1``)
    # - a second copy that could not see a market's declaration that it does not ask a question,
    # and that would have drifted from the applicant validator and the solver the moment either
    # moved.
    essential_order = (
        (EssentialFields.AVAILABLE_DATES_KEY, EssentialFields.AVAILABLE_DATES_LABEL),
        (EssentialFields.MAX_DATES_KEY, EssentialFields.MAX_DATES_LABEL),
        (EssentialFields.TABLE_CHOICE_KEY, EssentialFields.TABLE_CHOICE_LABEL),
        (EssentialFields.TABLE_SHARE_EMAIL_KEY, EssentialFields.TABLE_SHARE_EMAIL_LABEL),
        (EssentialFields.TIER_PREFERENCE_KEY, EssentialFields.TIER_PREFERENCE_LABEL),
        (EssentialFields.SECTION_RANKING_KEY, EssentialFields.SECTION_RANKING_LABEL),
        (EssentialFields.TABLE_TYPE_RANKING_KEY, EssentialFields.TABLE_TYPE_RANKING_LABEL),
    )

    targets = [
        ImportTarget(APPLICANT_EMAIL_TARGET, APPLICANT_EMAIL_LABEL, True, "identity"),
        ImportTarget(SUBMITTED_AT_TARGET, SUBMITTED_AT_LABEL, False, "meta"),
    ]
    targets += [
        ImportTarget(key, label, key in EssentialFields.REQUIRED_ESSENTIAL_KEYS, "essential")
        for key, label in essential_order
        if key in asked
    ]

    form = market_doc_field(market_doc, "application_form") or {}
    for field in form.get("fields") or []:
        key = field.get("key")
        if not key:
            continue
        targets.append(ImportTarget(
            key, field.get("label") or key, bool(field.get("required")), "custom",
        ))
    return targets


def offered_values(
    target: "ImportTarget",
    options: Any,
    field: Optional[Dict[str, Any]],
) -> Optional[List[str]]:
    """What this target will accept, or None when it accepts free text.

    A target with a closed set of values is one whose answers must name something the market
    configured; anything else - a business name, an email - is the applicant's own words and has
    nothing to match against.
    """
    if target.key == EssentialFields.AVAILABLE_DATES_KEY:
        return list(options.dates)
    if target.key == EssentialFields.TIER_PREFERENCE_KEY:
        return list(options.tiers)
    if target.key == EssentialFields.SECTION_RANKING_KEY:
        return list(options.sections)
    if target.key == EssentialFields.TABLE_TYPE_RANKING_KEY:
        return list(options.table_types)
    if target.key == EssentialFields.TABLE_CHOICE_KEY:
        return list(EssentialFields.TABLE_CHOICES)
    if target.kind == "custom" and field and field.get("type") in ("select", "multi_select"):
        return list(field.get("options") or [])
    return None


def resolve_value(
    raw: str, offered: List[str], resolutions: Dict[str, Optional[str]],
) -> Tuple[Optional[str], bool]:
    """One cell value against what the market offers.

    Returns ``(value, resolved)``. ``value`` is None when the organizer has explicitly chosen to
    ignore this value; ``resolved`` is False when nobody has said what it means yet, which is what
    blocks the import.
    """
    text = str(raw).strip()
    if not text:
        return None, True

    normalized = _normalize(text)
    for candidate in offered:
        if _normalize(candidate) == normalized:
            return candidate, True

    if text in resolutions:
        return resolutions[text], True
    for key, value in resolutions.items():
        if _normalize(key) == normalized:
            return value, True
    return None, False


def parse_csv(csv_content: str) -> Tuple[Optional[str], List[str], List[List[str]]]:
    """Split a CSV into its header row and its data rows.

    Returns ``(error, headers, rows)``. Python's reader is used rather than a split on commas
    because a Google Forms answer routinely contains one, and quoted fields spanning newlines are
    normal in a long-answer question.
    """
    try:
        parsed = list(csv.reader(io.StringIO(csv_content)))
    except csv.Error as exc:
        return f"That file could not be read as CSV: {exc}", [], []
    if not parsed:
        return "That file is empty.", [], []

    headers = [str(cell).strip() for cell in parsed[0]]
    if not any(headers):
        return "The first row of the file is empty, so there are no columns to map.", [], []
    return None, headers, parsed[1:]


def suggested_mapping(headers: List[str], targets: List[ImportTarget]) -> Dict[str, int]:
    """The mappings obvious enough to offer without asking.

    Only exact, well-known header text: Google Forms always emits ``Timestamp`` first and names
    the address column ``Email Address``. Guessing beyond that would put the organizer in the
    position of auditing our guesses, which is worse than mapping a column themselves.
    """
    target_keys = {target.key for target in targets}
    mapping: Dict[str, int] = {}
    for index, header in enumerate(headers):
        key = _AUTO_DETECT.get(header.strip().lower())
        if key and key in target_keys and key not in mapping:
            mapping[key] = index
    return mapping


# The stored mapping's own field names are camelCase like the rest of the market document, but its
# CONTENTS are data: target keys inside ``targets``, and raw cell values inside ``resolutions``.
# A blanket key conversion would rewrite those - "Gold Tier" is a value the organizer's form
# produced, not a schema key, and mangling it would silently lose the resolution it stands for.
_MAPPING_FIELDS = {"targets": "targets", "headers": "headers",
                   "resolutions": "resolutions", "saved_at": "savedAt"}


def stored_mapping(market_doc: Dict[str, Any]) -> Dict[str, Any]:
    """The mapping a previous import saved on this market, with its data keys left alone."""
    raw = market_doc_field(market_doc, "import_mapping")
    if not isinstance(raw, dict):
        return {}
    return {snake: raw.get(camel) for snake, camel in _MAPPING_FIELDS.items() if camel in raw}


def restore_mapping(
    headers: Sequence[str], saved: Dict[str, Any], targets: Sequence["ImportTarget"],
) -> Tuple[Dict[str, List[int]], List[Dict[str, Any]], List[str]]:
    """Re-apply a saved mapping to this file, by header TEXT and never by position.

    Returns ``(mapping, unresolved_targets, new_headers)``. A target whose columns are not all
    present is deliberately NOT half-restored: a partly-mapped grid is worse than an unmapped one,
    because it looks answered. It is reported instead, so the screen can say which header went
    missing rather than silently mapping to the wrong one.
    """
    positions: Dict[str, List[int]] = {}
    for index, header in enumerate(headers):
        positions.setdefault(collapse_header(header), []).append(index)

    known = {target.key for target in targets}
    restored: Dict[str, List[int]] = {}
    unresolved: List[Dict[str, Any]] = []
    used: List[str] = []

    for key, saved_headers in (saved.get("targets") or {}).items():
        if key not in known:
            continue
        wanted = [collapse_header(header) for header in saved_headers or []]
        indexes: List[int] = []
        missing: List[str] = []
        taken: Dict[str, int] = {}
        for header in wanted:
            available = positions.get(header, [])
            offset = taken.get(header, 0)
            if offset < len(available):
                indexes.append(available[offset])
                taken[header] = offset + 1
            else:
                missing.append(header)
        if missing:
            unresolved.append({"target": key, "missingHeaders": missing})
            continue
        restored[key] = indexes
        used.extend(wanted)

    previous = {collapse_header(header) for header in saved.get("headers") or []}
    new_headers = [
        collapse_header(header) for header in headers
        if previous and collapse_header(header) not in previous
    ]
    return restored, unresolved, new_headers


def orders_by_submitted_at(market_doc: Dict[str, Any]) -> bool:
    """Does this market have a priority rule that reads when the application arrived?"""
    setup = market_doc_field(market_doc, "setup_object") or {}
    return any(
        (rule or {}).get("target") == SUBMITTED_AT_RULE_TARGET
        for rule in setup.get("priority") or []
    )


def inspect(market_doc: Dict[str, Any], csv_content: str, sample_rows: int = 3) -> Tuple[Dict[str, Any], int]:
    """What the mapping screen needs to render: the columns, some values, and the targets."""
    error, headers, rows = parse_csv(csv_content)
    if error:
        return {"error": error}, 400

    targets = import_targets(market_doc)
    samples = [
        [row[index] if index < len(row) else "" for row in rows[:sample_rows]]
        for index in range(len(headers))
    ]
    saved = stored_mapping(market_doc)
    restored, unresolved, new_headers = restore_mapping(headers, saved, targets)

    return {
        "headers": headers,
        "sampleValues": samples,
        "rowCount": len(rows),
        "targets": [target.payload() for target in targets],
        "groups": [group.payload() for group in column_groups(headers)],
        "suggestedMapping": suggested_mapping(headers, targets),
        # A previous import's answers, re-applied to this file.
        "restoredMapping": restored,
        "restoredResolutions": saved.get("resolutions") or {},
        "restoredTargetsMissingColumns": unresolved,
        "newHeaders": new_headers,
        "hasSavedMapping": bool(saved.get("targets")),
        # True when this market orders vendors by when they applied. The ledger warns if that rule
        # exists and no column feeds it: mapping nothing is legal, but then the rule decides
        # nothing, which is the silent no-op this story exists to end wearing a different hat.
        "ordersBySubmittedAt": orders_by_submitted_at(market_doc),
    }, 200


def _split_multi(raw: str) -> List[str]:
    return [part.strip() for part in str(raw).split(",") if part.strip()]


def _grid_option(header: str) -> str:
    """The option a grid column stands for: the text in brackets, or the whole header."""
    match = _GRID_HEADER.match(str(header).strip())
    return match.group("option").strip() if match else str(header).strip()


def _rank_key(value: str) -> Any:
    """Order a ranking grid by what its cells say.

    A multiple-choice grid records the rank in the cell - "1st choice", "2", "Top" - so that is
    the ordering information the file actually carries. Leading digits are read as a number so
    "10th" sorts after "9th"; anything else sorts as text. Ties keep the file's column order.
    """
    text = str(value).strip()
    digits = re.match(r"^(\d+)", text)
    return (0, int(digits.group(1)), "") if digits else (1, 0, text.lower())


def _grid_values(
    target: ImportTarget, headers: Sequence[str], row: Sequence[str], columns: Sequence[int],
) -> List[str]:
    """The answer a grid spells across several columns.

    A column with an empty cell was not selected. For a SET (dates, tiers) that is the whole
    story. For a RANKING the cells carry the order, so they decide it - see ``_rank_key``.
    """
    selected = [
        (index, _grid_option(headers[index]), str(row[index]).strip() if index < len(row) else "")
        for index in columns
    ]
    chosen = [entry for entry in selected if entry[2]]
    if target.key in _RANKING_ESSENTIALS:
        chosen.sort(key=lambda entry: (_rank_key(entry[2]), columns.index(entry[0])))
    return [option for _index, option, _value in chosen]


def _whole_number_text(text: str) -> str:
    """A count as the form wrote it, reduced to the number in it.

    A real form asks "maximum number of days you wish to booth" with a dropdown reading "2 days",
    so the cell is never a bare integer. Normalised at the boundary for the same reason the
    timestamp is: the alternative is every reader knowing about the word.

    Deliberately narrow - the number must START the value, so "2 days" is 2 and "about two" stays
    exactly as written and is refused by validation. Guessing at prose would be worse than
    refusing it.
    """
    match = re.match(r"^\s*(\d+)\s*[a-zA-Z]*\s*$", text)
    return match.group(1) if match else text


def _tier_grid(
    headers: Sequence[str], row: Sequence[str], columns: Sequence[int],
) -> Dict[str, List[str]]:
    """A per-date tier answer, which is the shape a real form's day grid already has.

    One column per market date, and the CELL holds the tiers accepted on that date - "Gold,
    Silver", or "None" when the vendor is not available. So the bracketed option is the date and
    the value is the answer, which is the reverse of every other grid: elsewhere a non-empty cell
    means "this option was selected" and the option itself is the answer.

    That reversal is why tier gets its own reader. It is also why tier can be per-date at all
    (E01/F05): the form was always asking it that way.
    """
    per_date: Dict[str, List[str]] = {}
    for index in columns:
        date = _grid_option(headers[index])
        cell = str(row[index]).strip() if index < len(row) else ""
        tiers = [name for name in _split_multi(cell) if name.lower() != "none"]
        if tiers:
            per_date[date] = tiers
    return per_date


def _coerce(target: ImportTarget, raw: str, field: Optional[Dict[str, Any]]) -> Any:
    """One cell, as the answer shape its target expects.

    Multi-value answers arrive comma-separated in a single column, which is what a Google Form
    checkbox question exports. The grid shape - one column per option - is the next story.
    """
    text = str(raw or "").strip()
    if target.key in _MULTI_VALUE_ESSENTIALS:
        return _split_multi(text)
    if target.key == EssentialFields.MAX_DATES_KEY:
        return _whole_number_text(text)
    if target.kind == "custom" and field:
        field_type = field.get("type", "text")
        if field_type == "multi_select":
            return _split_multi(text)
        if field_type == "checkbox":
            return text.lower() in ("true", "yes", "1", "checked")
        if field_type == "number":
            return text
    return text


def _raw_values(
    target: ImportTarget,
    headers: Sequence[str],
    row: Sequence[str],
    indexes: Sequence[int],
    field: Optional[Dict[str, Any]],
) -> Any:
    """A target's answer for one row, before its values are matched against the market."""
    if len(indexes) > 1:
        if target.key == EssentialFields.TIER_PREFERENCE_KEY:
            return _tier_grid(headers, row, indexes)
        return _grid_values(target, headers, row, indexes)
    index = indexes[0]
    cell = row[index] if index < len(row) else ""
    return _coerce(target, cell, field)


def unserved_required(targets: Sequence[ImportTarget], resolved: Dict[str, Any]) -> List[ImportTarget]:
    """Required targets this mapping does not answer.

    One statement, because there were two: ``preview_values`` and ``import_applications`` each
    decided it, and only one of them knew that a per-date tier grid answers availability as well
    (``_assembled_rows`` reads the dates from it). The other refused the very shape a real form has.
    """
    satisfied = set(resolved)
    if len(resolved.get(EssentialFields.TIER_PREFERENCE_KEY) or []) > 1:
        satisfied.add(EssentialFields.AVAILABLE_DATES_KEY)
    return [t for t in targets if t.required and t.key not in satisfied]


def _matched_tiers_by_date(
    value: Any, options: Any, resolutions: Dict[str, Optional[str]],
) -> Tuple[Any, List[str]]:
    """Match a per-date tier answer, whose keys and values are drawn from different offerings.

    A tier grid is the one answer with two vocabularies in it: the KEYS are market dates, spelled
    however the form's column headings spelled them ("Monday, November 17"), and the VALUES are
    tier names. Each half is matched against its own offering, so the organizer resolves a date
    heading once and a tier name once - not once per row, and never the two confused for each
    other.
    """
    if not isinstance(value, dict):
        return _matched(value, list(options.tiers or []), resolutions)

    kept: Dict[str, List[str]] = {}
    unmatched: List[str] = []
    for raw_date, raw_tiers in value.items():
        date, date_unmatched = _matched(raw_date, list(options.dates or []), resolutions)
        tiers, tier_unmatched = _matched(list(raw_tiers or []), list(options.tiers or []), resolutions)
        unmatched.extend(date_unmatched)
        unmatched.extend(tier_unmatched)
        if date and tiers:
            kept[date] = tiers
    return kept, unmatched


def _matched(
    value: Any, offered: List[str], resolutions: Dict[str, Optional[str]],
) -> Tuple[Any, List[str]]:
    """Apply the market's own names to a target's answer.

    Returns ``(value, unmatched)``. Values the organizer chose to ignore are dropped; values
    nobody has spoken for are returned in ``unmatched``, which is what blocks the import.
    """
    if isinstance(value, list):
        kept: List[str] = []
        unmatched: List[str] = []
        for item in value:
            resolved, known = resolve_value(item, offered, resolutions)
            if not known:
                unmatched.append(str(item).strip())
            elif resolved is not None:
                kept.append(resolved)
        return kept, unmatched

    resolved, known = resolve_value(value, offered, resolutions)
    if not known:
        return value, [str(value).strip()]
    return (resolved if resolved is not None else ""), []


def _assembled_rows(
    market_doc: Dict[str, Any],
    headers: Sequence[str],
    rows: Sequence[Sequence[str]],
    resolved: Dict[str, List[int]],
    resolutions: Dict[str, Dict[str, Optional[str]]],
) -> List[Tuple[int, str, str, Dict[str, Any]]]:
    """Every row as ``(spreadsheet line, email, submitted_at, form_data)``.

    Row 1 is the header, so the first data row is line 2 in the organizer's own file - which is
    what they need in order to find it.
    """
    options = EssentialFields.effective_essential_options(market_doc)
    by_key = {t.key: t for t in import_targets(market_doc)}
    form = market_doc_field(market_doc, "application_form") or {}
    fields_by_key = {f.get("key"): f for f in form.get("fields") or [] if f.get("key")}

    assembled = []
    for offset, row in enumerate(rows):
        def cell(key: str) -> str:
            indexes = resolved.get(key)
            if not indexes:
                return ""
            index = indexes[0]
            return row[index] if index < len(row) else ""

        form_data: Dict[str, Any] = {}
        for key, indexes in resolved.items():
            if key in (APPLICANT_EMAIL_TARGET, SUBMITTED_AT_TARGET):
                continue
            target = by_key.get(key)
            if target is None:
                continue
            field = fields_by_key.get(key)
            value = _raw_values(target, headers, row, indexes, field)
            if key == EssentialFields.TIER_PREFERENCE_KEY and isinstance(value, dict):
                value, _unmatched = _matched_tiers_by_date(
                    value, options, resolutions.get(key, {}),
                )
            else:
                offered = offered_values(target, options, field)
                if offered is not None:
                    value, _unmatched = _matched(value, offered, resolutions.get(key, {}))
            form_data[key] = value

        # Tier is answered PER DATE (E01/F05). A grid already says it that way - one column per
        # date, tiers in the cell - but a form that asked once ("which tiers will you accept?")
        # gives a flat list, which means those tiers on every date the vendor is available. Expanded
        # here rather than in ``_coerce`` because only the assembled row knows both answers.
        tier_answer = form_data.get(EssentialFields.TIER_PREFERENCE_KEY)
        if isinstance(tier_answer, list):
            dates = form_data.get(EssentialFields.AVAILABLE_DATES_KEY) or []
            form_data[EssentialFields.TIER_PREFERENCE_KEY] = {
                date: list(tier_answer) for date in dates
            }
        elif isinstance(tier_answer, dict) and not form_data.get(
            EssentialFields.AVAILABLE_DATES_KEY
        ):
            # A real form asks one question per day whose cell carries the tiers, or "None" when
            # the vendor cannot attend. That single grid answers BOTH questions, so availability is
            # read from it rather than demanding a second column the form never had: the dates you
            # named tiers for are the dates you are available. The two are still stored separately
            # and still have to agree - this is what makes them agree by construction.
            form_data[EssentialFields.AVAILABLE_DATES_KEY] = [
                date for date, names in tier_answer.items() if names
            ]

        # Normalised here, at the boundary, so every reader downstream compares one shape. A value
        # that is not a time is carried as the sentinel below and refused by ``_row_faults`` with
        # its line number, rather than silently becoming "no timestamp".
        raw_submitted = str(cell(SUBMITTED_AT_TARGET) or "").strip()
        try:
            submitted_at = normalized_submitted_at(raw_submitted) or ""
        except ValueError:
            submitted_at = _UNREADABLE_TIMESTAMP + raw_submitted

        assembled.append((
            offset + 2,
            str(cell(APPLICANT_EMAIL_TARGET) or "").strip().lower(),
            submitted_at,
            form_data,
        ))
    return assembled


def _row_faults(
    market_doc: Dict[str, Any], assembled: Sequence[Tuple[int, str, str, Dict[str, Any]]],
) -> List[Dict[str, Any]]:
    """Rows that would be refused, each with the reason and its line in the organizer's file."""
    faults = []
    for line, email, submitted_at, form_data in assembled:
        if not email:
            faults.append({"row": line, "email": "", "error": "No email address."})
            continue
        if submitted_at.startswith(_UNREADABLE_TIMESTAMP):
            raw = submitted_at[len(_UNREADABLE_TIMESTAMP):]
            faults.append({
                "row": line, "email": email,
                "error": f"{raw!r} is not a date and time this import can read.",
            })
            continue
        error = validate_application_answers(market_doc, form_data)
        if error:
            faults.append({"row": line, "email": email, "error": error})
    return faults


def preview_values(
    market_doc: Dict[str, Any],
    csv_content: str,
    mapping: Dict[str, Any],
    resolutions: Optional[Dict[str, Dict[str, Optional[str]]]] = None,
) -> Tuple[Dict[str, Any], int]:
    """Which cell values do not name anything this market offers, and how often each appears.

    Writes nothing. One entry per DISTINCT value, because that is the unit the organizer decides
    on - the same "Gold Tier" in two hundred rows is one decision, not two hundred.
    """
    error, headers, rows = parse_csv(csv_content)
    if error:
        return {"error": error}, 400

    resolutions = resolutions or {}
    options = EssentialFields.effective_essential_options(market_doc)
    targets = {t.key: t for t in import_targets(market_doc)}
    form = market_doc_field(market_doc, "application_form") or {}
    fields_by_key = {f.get("key"): f for f in form.get("fields") or [] if f.get("key")}

    tally: Dict[Tuple[str, str], int] = {}
    order: List[Tuple[str, str]] = []
    for row in rows:
        for key, value in mapping.items():
            target = targets.get(key)
            if target is None:
                continue
            indexes = value if isinstance(value, list) else [value]
            if not all(isinstance(i, int) and 0 <= i < len(headers) for i in indexes):
                continue
            offered = offered_values(target, options, fields_by_key.get(key))
            if offered is None:
                continue
            raw = _raw_values(target, headers, row, indexes, fields_by_key.get(key))
            if key == EssentialFields.TIER_PREFERENCE_KEY and isinstance(raw, dict):
                _kept, unmatched = _matched_tiers_by_date(raw, options, resolutions.get(key, {}))
            else:
                _kept, unmatched = _matched(raw, offered, resolutions.get(key, {}))
            for item in unmatched:
                slot = (key, item)
                if slot not in tally:
                    tally[slot] = 0
                    order.append(slot)
                tally[slot] += 1

    unmatched_payload = [
        {
            "target": key,
            "targetLabel": targets[key].label,
            "value": item,
            "rows": tally[(key, item)],
            "offered": offered_values(targets[key], options, fields_by_key.get(key)) or [],
        }
        for key, item in order
    ]

    result: Dict[str, Any] = {
        "rowCount": len(rows),
        "unmatched": unmatched_payload,
        "validRows": 0,
        "failures": [],
    }

    # Row-by-row validity is only meaningful once the mapping is complete and every value has been
    # spoken for: before that, every row would fail for the same reason and the list would say
    # nothing the mapping rail is not already saying.
    resolved = {
        key: (value if isinstance(value, list) else [value])
        for key, value in mapping.items()
        if isinstance(value, (int, list)) and not isinstance(value, bool)
    }
    unserved = unserved_required(list(targets.values()), resolved)
    if unmatched_payload or unserved:
        return result, 200

    assembled = _assembled_rows(market_doc, headers, rows, resolved, resolutions)
    failures = _row_faults(market_doc, assembled)
    result["failures"] = failures
    result["validRows"] = len(rows) - len(failures)
    result.update(_merge_shape(market_doc.get("id", ""), assembled, failures, market_doc))
    return result, 200


def _would_return_to_review(
    market_doc: Dict[str, Any], existing: Optional[Dict[str, Any]], form_data: Dict[str, Any],
) -> bool:
    """Would importing this row invalidate a review that has already happened?

    Only for an application already APPROVED: nothing else has a verdict to invalidate. The
    comparison is against NORMALISED answers on both sides, so a re-export that merely reformats a
    value is not a change - treating it as one would un-approve a market's worth of vendors for
    nothing.
    """
    if not existing:
        return False
    if existing.get("status") != ApplicationStatus.REVIEWER_APPROVED.value:
        return False

    options = EssentialFields.effective_essential_options(market_doc)
    error, incoming = EssentialFields.validated_essential_answers(form_data, options)
    if error:
        return False
    return EssentialFields.solver_relevant_change(existing.get("form_data") or {}, incoming)


def _merge_shape(
    market_id: str,
    assembled: Sequence[Tuple[int, str, str, Dict[str, Any]]],
    failures: Sequence[Dict[str, Any]],
    market_doc: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """How this file lands against the applications already here: new, updated, or absent.

    "Absent" is the interesting one. An application that exists but is not in the file is LEFT
    ALONE and merely counted: absence almost always means the organizer exported a filtered or
    partial range, not that the applicant withdrew, and inferring a withdrawal from a missing row
    would destroy review state on a guess. ``cancelled`` exists for a real withdrawal, but that is
    a deliberate act.
    """
    skipped_lines = {failure["row"] for failure in failures}
    in_file = {
        email for line, email, _submitted, _data in assembled
        if email and line not in skipped_lines
    }

    existing_by_email = {}
    for doc in ApplicationsApi.list_applications_for_market(market_id):
        address = str(doc.get("applicant_email") or "").strip().lower()
        if address:
            existing_by_email[address] = doc

    existing_emails = set(existing_by_email)
    absent = sorted(existing_emails - in_file)

    returning = []
    if market_doc is not None:
        for line, email, _submitted, data in assembled:
            if not email or line in skipped_lines:
                continue
            if _would_return_to_review(market_doc, existing_by_email.get(email), data):
                returning.append(email)

    return {
        "newRows": len(in_file - existing_emails),
        "updatedRows": len(in_file & existing_emails),
        "absentApplications": len(absent),
        "absentEmails": absent[:20],
        "returningToReview": len(returning),
        "returningEmails": sorted(returning)[:20],
    }


def import_applications(
    markets_collection: Any,
    market_doc: Dict[str, Any],
    csv_content: str,
    mapping: Dict[str, Any],
    resolutions: Optional[Dict[str, Dict[str, Optional[str]]]] = None,
) -> Tuple[Dict[str, Any], int]:
    """Turn the mapped rows into applications.

    Refuses at the MAPPING level and tolerates at the ROW level: an unmapped required target
    imports nothing, because that is a configuration error and half a form is nonsense, but one
    malformed row does not stop the other two hundred. Every skipped row is named in the result,
    since an import that looks complete with a vendor silently missing is the worst outcome
    available.
    """
    error, headers, rows = parse_csv(csv_content)
    if error:
        return {"error": error}, 400

    targets = import_targets(market_doc)
    by_key = {target.key: target for target in targets}

    unknown = [key for key in mapping if key not in by_key]
    if unknown:
        return {"error": f"Unknown mapping target(s): {', '.join(sorted(unknown))}."}, 400

    def _indexes(value: Any) -> Optional[List[int]]:
        """A mapping value is one column, or several when a grid spells one question across many."""
        if isinstance(value, bool):
            return None
        if isinstance(value, int):
            return [value]
        if isinstance(value, list) and value and all(
            isinstance(item, int) and not isinstance(item, bool) for item in value
        ):
            return list(value)
        return None

    resolved: Dict[str, List[int]] = {}
    malformed = []
    for key, value in mapping.items():
        indexes = _indexes(value)
        if indexes is None:
            malformed.append(key)
        else:
            resolved[key] = indexes
    if malformed:
        return {
            "error": f"Mapped column must be a column number: {', '.join(sorted(malformed))}.",
        }, 400

    out_of_range = [
        key for key, indexes in resolved.items()
        if any(index < 0 or index >= len(headers) for index in indexes)
    ]
    if out_of_range:
        return {
            "error": f"Mapped column is not in this file: {', '.join(sorted(out_of_range))}.",
        }, 400

    missing = [t.label for t in unserved_required(targets, resolved)]
    if missing:
        return {
            "error": "Every required question needs a column before anything can be imported. "
                     f"Still unmapped: {', '.join(missing)}.",
            "unmappedRequired": [t.key for t in unserved_required(targets, resolved)],
        }, 422

    resolutions = resolutions or {}
    options = EssentialFields.effective_essential_options(market_doc)
    form = market_doc_field(market_doc, "application_form") or {}
    fields_by_key = {f.get("key"): f for f in form.get("fields") or [] if f.get("key")}
    market_id = market_doc.get("id", "")

    # An unspoken-for value would otherwise be dropped or refused row by row, so it is settled
    # once, before anything is written.
    outstanding, _status = preview_values(market_doc, csv_content, mapping, resolutions)
    if outstanding.get("unmatched"):
        first = outstanding["unmatched"][0]
        return {
            "error": f"Some answers do not match this market yet, starting with "
                     f"'{first['value']}' under {first['targetLabel']}.",
            "unmatched": outstanding["unmatched"],
        }, 422

    created = 0
    updated = 0
    returned_to_review = 0
    failures: List[Dict[str, Any]] = []

    # Counted before the writes, so it means "already here and not in this file" rather than
    # being confused by the rows this run is about to add.
    assembled_all = _assembled_rows(market_doc, headers, rows, resolved, resolutions)
    shape_before = _merge_shape(
        market_id, assembled_all, _row_faults(market_doc, assembled_all), market_doc,
    )
    absent_before = shape_before["absentApplications"]

    for row_number, email, submitted_at, form_data in _assembled_rows(
        market_doc, headers, rows, resolved, resolutions,
    ):
        if not email:
            failures.append({"row": row_number, "email": "", "error": "No email address."})
            continue

        existing = ApplicationsApi.find_application_by_email(market_id, email)
        # Decided BEFORE the write, while the stored answers are still the ones the organizer
        # approved: afterwards there is nothing left to compare against.
        stale_review = _would_return_to_review(market_doc, existing, form_data)
        app_doc = existing or ApplicationsApi.find_or_create_application(Application(
            market_id=market_id,
            applicant_email=email,
            form_data={},
            status=ApplicationStatus.OPEN,
            submitted_at=submitted_at or None,
        )).model_dump()

        if submitted_at and not app_doc.get("submitted_at"):
            app_doc = {**app_doc, "submitted_at": submitted_at}

        row_error, _ = record_application_answers(
            markets_collection, market_doc, app_doc, form_data,
        )
        if row_error:
            failures.append({"row": row_number, "email": email, "error": row_error})
            continue

        if stale_review:
            ApplicationsApi.update_application_status(
                app_doc.get("id", ""), ApplicationStatus.OPEN,
            )
            returned_to_review += 1

        if existing:
            updated += 1
        else:
            created += 1

    # Remember how this file was read, so the next import opens ready to confirm rather than
    # asking the organizer to rebuild a dozen decisions they have already made.
    save_mapping(markets_collection, market_id, headers, resolved, resolutions)

    return {
        "created": created,
        "updated": updated,
        "skipped": len(failures),
        "rowCount": len(rows),
        "failures": failures,
        "absentApplications": absent_before,
        "returnedToReview": returned_to_review,
    }, 200


def save_mapping(
    markets_collection: Any,
    market_id: str,
    headers: Sequence[str],
    resolved: Dict[str, List[int]],
    resolutions: Dict[str, Dict[str, Optional[str]]],
) -> None:
    """Store the mapping by header text, for the next import to restore."""
    mapping = ImportMapping(
        targets={
            key: [str(headers[index]).strip() for index in indexes if index < len(headers)]
            for key, indexes in resolved.items()
        },
        headers=[str(header).strip() for header in headers],
        resolutions=resolutions,
        saved_at=datetime.now(timezone.utc).isoformat(),
    )
    dumped = mapping.model_dump()
    payload = {camel: dumped[snake] for snake, camel in _MAPPING_FIELDS.items()}
    markets_collection.update_one(
        {"id": market_id},
        {"$set": {market_doc_key("import_mapping"): payload}},
    )
