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

Scope so far: cell values already name what the market offers. Values that need resolving against
the plan are the story that follows.
"""
import csv
import io
import logging
import re
from typing import Any, Dict, List, Optional, Sequence, Tuple, Union

import api.applications as ApplicationsApi
import essential_fields as EssentialFields
from application_write import record_application_answers
from datatypes import Application, ApplicationStatus
from market_documents import market_doc_field

logger = logging.getLogger(__name__)

# Not a form answer: it identifies the applicant, so it lands on the document rather than in
# ``form_data``. Every import must map it - without it a row names nobody.
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


# "Which days can you attend? [Saturday July 4]" - the shape Google Forms gives every grid column.
_GRID_HEADER = re.compile(r"^(?P<stem>.+?)\s*\[(?P<option>.+)\]$")


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
        stem = match.group("stem").strip()
        option = match.group("option").strip()
        if stem not in found:
            found[stem] = ColumnGroup(stem, [], [])
            order.append(stem)
        found[stem].columns.append(index)
        found[stem].options.append(option)
    return [found[stem] for stem in order if len(found[stem].columns) > 1]


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
    targets = [
        ImportTarget(APPLICANT_EMAIL_TARGET, APPLICANT_EMAIL_LABEL, True, "identity"),
        ImportTarget(SUBMITTED_AT_TARGET, SUBMITTED_AT_LABEL, False, "meta"),
    ]

    if options.dates:
        targets.append(ImportTarget(
            EssentialFields.AVAILABLE_DATES_KEY, EssentialFields.AVAILABLE_DATES_LABEL,
            True, "essential",
        ))
        targets.append(ImportTarget(
            EssentialFields.MAX_DATES_KEY, EssentialFields.MAX_DATES_LABEL, True, "essential",
        ))
        targets.append(ImportTarget(
            EssentialFields.TABLE_CHOICE_KEY, EssentialFields.TABLE_CHOICE_LABEL,
            True, "essential",
        ))
        targets.append(ImportTarget(
            EssentialFields.TABLE_SHARE_EMAIL_KEY, EssentialFields.TABLE_SHARE_EMAIL_LABEL,
            False, "essential",
        ))
    if options.tiers:
        targets.append(ImportTarget(
            EssentialFields.TIER_PREFERENCE_KEY, EssentialFields.TIER_PREFERENCE_LABEL,
            True, "essential",
        ))
    if len(options.sections) > 1:
        targets.append(ImportTarget(
            EssentialFields.SECTION_RANKING_KEY, EssentialFields.SECTION_RANKING_LABEL,
            True, "essential",
        ))
    if len(options.table_types) > 1:
        targets.append(ImportTarget(
            EssentialFields.TABLE_TYPE_RANKING_KEY, EssentialFields.TABLE_TYPE_RANKING_LABEL,
            True, "essential",
        ))

    form = market_doc_field(market_doc, "application_form") or {}
    for field in form.get("fields") or []:
        key = field.get("key")
        if not key:
            continue
        targets.append(ImportTarget(
            key, field.get("label") or key, bool(field.get("required")), "custom",
        ))
    return targets


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
    return {
        "headers": headers,
        "sampleValues": samples,
        "rowCount": len(rows),
        "targets": [target.payload() for target in targets],
        "groups": [group.payload() for group in column_groups(headers)],
        "suggestedMapping": suggested_mapping(headers, targets),
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


def _coerce(target: ImportTarget, raw: str, field: Optional[Dict[str, Any]]) -> Any:
    """One cell, as the answer shape its target expects.

    Multi-value answers arrive comma-separated in a single column, which is what a Google Form
    checkbox question exports. The grid shape - one column per option - is the next story.
    """
    text = str(raw or "").strip()
    if target.key in _MULTI_VALUE_ESSENTIALS:
        return _split_multi(text)
    if target.key == EssentialFields.MAX_DATES_KEY:
        return text
    if target.key == EssentialFields.TABLE_CHOICE_KEY:
        return text.lower()
    if target.kind == "custom" and field:
        field_type = field.get("type", "text")
        if field_type == "multi_select":
            return _split_multi(text)
        if field_type == "checkbox":
            return text.lower() in ("true", "yes", "1", "checked")
        if field_type == "number":
            return text
    return text


def import_applications(
    markets_collection: Any,
    market_doc: Dict[str, Any],
    csv_content: str,
    mapping: Dict[str, int],
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

    missing = [t.label for t in targets if t.required and t.key not in resolved]
    if missing:
        return {
            "error": "Every required question needs a column before anything can be imported. "
                     f"Still unmapped: {', '.join(missing)}.",
            "unmappedRequired": [t.key for t in targets if t.required and t.key not in resolved],
        }, 422

    form = market_doc_field(market_doc, "application_form") or {}
    fields_by_key = {f.get("key"): f for f in form.get("fields") or [] if f.get("key")}
    market_id = market_doc.get("id", "")

    created = 0
    updated = 0
    failures: List[Dict[str, Any]] = []

    for offset, row in enumerate(rows):
        # Row 1 is the header, so the first data row is row 2 in the organizer's spreadsheet.
        row_number = offset + 2

        def cell(key: str) -> str:
            indexes = resolved.get(key)
            if not indexes:
                return ""
            index = indexes[0]
            return row[index] if index < len(row) else ""

        email = str(cell(APPLICANT_EMAIL_TARGET) or "").strip().lower()
        if not email:
            failures.append({"row": row_number, "email": "", "error": "No email address."})
            continue

        form_data: Dict[str, Any] = {}
        for key, indexes in resolved.items():
            if key in (APPLICANT_EMAIL_TARGET, SUBMITTED_AT_TARGET):
                continue
            target = by_key[key]
            if len(indexes) > 1:
                form_data[key] = _grid_values(target, headers, row, indexes)
            else:
                form_data[key] = _coerce(target, cell(key), fields_by_key.get(key))

        existing = ApplicationsApi.find_application_by_email(market_id, email)
        submitted_at = str(cell(SUBMITTED_AT_TARGET) or "").strip()
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

        if existing:
            updated += 1
        else:
            created += 1

    return {
        "created": created,
        "updated": updated,
        "skipped": len(failures),
        "rowCount": len(rows),
        "failures": failures,
    }, 200
