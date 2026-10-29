"""The market's vendors, exported to a CSV (E42/F01/S01).

An organizer exports the vendors a page shows, choosing the columns, as a file for a Google Sheet and
a mail merge (YAMM). The dialog that asks starts from the page's filters; the file is built here from
the filters it sends, so what is exported is what the server holds, and the preview it shows first
is the same rows, cut to three.

A vendor is an application of the market, one row each, whatever its status: the review's lists are
exported as well as the assignment's. Where they sit is read from the stored placements the
Assignments page draws (``derive_market_table_rows``), so a filter on a seat finds what that page
shows.

A cell holding the applicant's own text is written so no spreadsheet runs it (``as_text_cell``): the
file is a new way out for applicants' data, and a name beginning with ``=`` is a formula to Sheets.
"""
import csv
import io
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple

import api.applications as ApplicationsApi
import api.market_actions as Actions
import api.markets as MarketsApi
import essential_fields as EssentialFields
from assignment.csv_output import as_text_cell
from client_errors import BadRequestError
from datatypes import Application, ApplicationStatus, FormField, Market
from utils.request_body import string_field

logger = logging.getLogger(__name__)

#: The rows the dialog shows before the download.
PREVIEW_ROWS = 3

#: Spreadsheets read accents in a UTF-8 file only when it says it is one.
BYTE_ORDER_MARK = "\ufeff"


class ExportInvalid(BadRequestError):
    """A filter or a column the dialog could not have sent. A 400."""


# The statuses a vendor is filtered and shown by, in the organizer's words. "Added by hand" is its
# own, though the adding approves them: they never applied, so no review approved them.
STATUSES: List[Tuple[str, str]] = [
    ("open", "Open"),
    ("follow_up", "Needs follow-up"),
    ("approved", "Approved"),
    ("rejected", "Rejected"),
    ("added", "Added by hand"),
]
_STATUS_LABELS = dict(STATUSES)

_STATUS_OF = {
    ApplicationStatus.OPEN: "open",
    ApplicationStatus.UNDER_REVIEW: "open",
    ApplicationStatus.NEEDS_FOLLOW_UP: "follow_up",
    ApplicationStatus.REVIEWER_APPROVED: "approved",
    ApplicationStatus.REVIEWER_REJECTED: "rejected",
}


def status_of(application: Application) -> Optional[str]:
    """Which of ``STATUSES`` an application is, or None for a status the review no longer gives."""
    if application.added_by:
        return "added"
    return _STATUS_OF.get(application.status)


def _status_text(application: Application) -> str:
    status = status_of(application)
    if status:
        return _STATUS_LABELS[status]
    return application.status.value.replace("_", " ").capitalize()


# ── columns ───────────────────────────────────────────────────────────────────

ANSWER_PREFIX = "answer:"

#: Ticked when the dialog opens: who, how to reach them, and where they stand.
DEFAULT_COLUMNS = ["name", "email", "status"]

#: The questions a vendor is filtered by an answer to: those with options to choose among.
CHOICE_TYPES = ("select", "multi_select", "checkbox")


@dataclass(frozen=True)
class Column:
    id: str
    label: str
    cell: Callable[["Vendor"], str]


@dataclass
class Vendor:
    """One application, and where it sits: ``{date: table row}``."""

    application: Application
    seats: Dict[str, Any] = field(default_factory=dict)

    @property
    def email(self) -> str:
        return self.application.applicant_email.strip().lower()

    @property
    def answers(self) -> Dict[str, Any]:
        """Every answer, keyed by question: the one place the export reads them."""
        return self.application.form_data or {}


def answer_text(value: Any) -> str:
    """An answer as one cell: a multi-select's options joined by ", ", a box Yes or No."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, list):
        return ", ".join(str(item) for item in value if item is not None)
    return str(value)


def _answer_values(value: Any) -> List[str]:
    """An answer as the options it chose, to filter by."""
    if isinstance(value, list):
        return [answer_text(item) for item in value]
    text = answer_text(value)
    return [text] if text else []


def _organizers_questions(market: Market) -> List[FormField]:
    """The form's own questions in the order it asks them: the essential ones are the plan's, and
    the two names among them are columns of their own."""
    fields = market.application_form.fields if market.application_form else []
    return sorted(
        (f for f in fields if not f.key.startswith(EssentialFields.ESSENTIAL_KEY_PREFIX)),
        key=lambda f: f.order,
    )


def offered_columns(market: Market) -> List[Column]:
    """Every column the market's vendors can be exported with, in the order the dialog lists them."""
    def answer(key: str) -> Callable[[Vendor], str]:
        return lambda vendor: answer_text(vendor.answers.get(key))

    return [
        Column("name", "Name", answer(EssentialFields.FULL_NAME_KEY)),
        Column("preferredName", "Preferred name", answer(EssentialFields.PREFERRED_NAME_KEY)),
        Column("email", "Email", lambda vendor: vendor.application.applicant_email.strip()),
        Column("status", "Status", lambda vendor: _status_text(vendor.application)),
        *(
            Column(f"{ANSWER_PREFIX}{question.key}", question.label or question.key,
                   answer(question.key))
            for question in _organizers_questions(market)
        ),
    ]


def offered_questions(market: Market) -> List[Dict[str, Any]]:
    """The questions a vendor may be filtered by an answer to, with the options each offers."""
    return [
        {
            "key": question.key,
            "label": question.label or question.key,
            "options": ["Yes", "No"] if question.type == "checkbox" else list(question.options),
        }
        for question in _organizers_questions(market)
        if question.type in CHOICE_TYPES
    ]


def _chosen_columns(asked: Any, offered: List[Column]) -> List[Column]:
    if asked is None:
        asked = DEFAULT_COLUMNS
    if not isinstance(asked, list) or not asked:
        raise ExportInvalid("Choose at least one column to export.")
    by_id = {column.id: column for column in offered}
    chosen = []
    for column_id in asked:
        if not isinstance(column_id, str) or column_id not in by_id:
            raise ExportInvalid("A column asked for is not one this market offers.")
        chosen.append(by_id[column_id])
    return chosen


# ── filters ───────────────────────────────────────────────────────────────────

PLACED = ("", "placed", "unplaced")
SIZES = ("", "full", "half")


@dataclass(frozen=True)
class Filters:
    """What narrows the vendors, as the dialog shows it; an empty value narrows nothing.

    ``placed`` is "placed" or "unplaced", on ``date`` or, with none, on any date. A section, a tier
    and a size describe a seat, so they hold only of the vendors placed, and of the same seat.
    ``answers`` is a choice question's options, any of which the vendor chose.
    """

    statuses: Tuple[str, ...] = ()
    placed: str = ""
    date: str = ""
    section: str = ""
    tier: str = ""
    size: str = ""
    search: str = ""
    answers: Dict[str, Tuple[str, ...]] = field(default_factory=dict)


def _text(body: Dict[str, Any], key: str, allowed: Optional[Tuple[str, ...]] = None) -> str:
    if key not in body:
        return ""
    value = string_field(body, key)
    if value is None or (allowed is not None and value not in allowed):
        raise ExportInvalid(f"The filter {key!r} is not one the export reads.")
    return value


def _strings(value: Any, key: str) -> Tuple[str, ...]:
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise ExportInvalid(f"The filter {key!r} is not one the export reads.")
    return tuple(value)


def read_filters(body: Any, questions: List[Dict[str, Any]]) -> Filters:
    """The filters a request names, each checked for its type. A key the export does not know is
    left alone, so a page may send what it holds."""
    if body is None:
        return Filters()
    if not isinstance(body, dict):
        raise ExportInvalid("The filters are not ones the export reads.")

    statuses = _strings(body.get("statuses", []), "statuses")
    if any(status not in _STATUS_LABELS for status in statuses):
        raise ExportInvalid("The filter 'statuses' is not one the export reads.")

    answers_asked = body.get("answers", {})
    if not isinstance(answers_asked, dict):
        raise ExportInvalid("The filter 'answers' is not one the export reads.")
    choice_keys = {question["key"] for question in questions}
    answers = {}
    for key, options in answers_asked.items():
        if key not in choice_keys:
            raise ExportInvalid("An answer filtered by is not a choice this market's form asks.")
        answers[key] = _strings(options, "answers")

    return Filters(
        statuses=statuses,
        placed=_text(body, "placed", PLACED),
        date=_text(body, "date"),
        section=_text(body, "section"),
        tier=_text(body, "tier"),
        size=_text(body, "size", SIZES),
        search=_text(body, "search"),
        answers=answers,
    )


def _seat_matches(seat: Any, filters: Filters) -> bool:
    return (
        (not filters.section or seat.section == filters.section)
        and (not filters.tier or seat.tier == filters.tier)
        and (not filters.size or filters.size in seat.table_choice.lower())
    )


def _placed_matches(vendor: Vendor, filters: Filters) -> bool:
    if filters.placed == "unplaced":
        return filters.date not in vendor.seats if filters.date else not vendor.seats
    if filters.placed == "placed":
        seats = (
            [vendor.seats[filters.date]] if filters.date in vendor.seats
            else [] if filters.date
            else list(vendor.seats.values())
        )
        return any(_seat_matches(seat, filters) for seat in seats)
    return True


def _search_matches(vendor: Vendor, needle: str) -> bool:
    """By name or address, as the Vendors page's search finds them: the name they chose."""
    if not needle:
        return True
    name = EssentialFields.display_name(vendor.answers).lower()
    return needle in vendor.email or needle in name


def vendor_shown(vendor: Vendor, filters: Filters) -> bool:
    """Whether the filters keep this vendor."""
    if filters.statuses and status_of(vendor.application) not in filters.statuses:
        return False
    if not _placed_matches(vendor, filters):
        return False
    for key, options in filters.answers.items():
        if options and not set(_answer_values(vendor.answers.get(key))) & set(options):
            return False
    return _search_matches(vendor, filters.search.strip().lower())


# ── the vendors and the file ─────────────────────────────────────────────────

def _vendors(market: Market) -> List[Vendor]:
    """Every application of the market, newest first as the Vendors page lists them, each with the
    seats the stored placements give them."""
    seats: Dict[str, Dict[str, Any]] = {}
    for row in MarketsApi.derive_market_table_rows(market):
        for email in set(row.assignment):
            seats.setdefault(email.strip().lower(), {})[row.date] = row

    vendors = []
    for doc in ApplicationsApi.list_applications_for_market(market.id):
        try:
            application = Application(**doc)
        except Exception:
            # Which one, never its answers.
            logger.warning("Export skipped an unreadable application %s", doc.get("id", "?"))
            continue
        vendor = Vendor(application)
        vendor.seats = seats.get(vendor.email, {})
        vendors.append(vendor)
    return vendors


@dataclass
class Export:
    market: Market
    header: List[str]
    rows: List[List[str]]


def _build(market_id: str, body: Any, requesting_user: str) -> Export:
    market = MarketsApi._load_market_for(market_id, requesting_user, Actions.EXPORT_CSV)
    if not isinstance(body, dict):
        raise ExportInvalid("The export's request is not one it reads.")
    filters = read_filters(body.get("filters"), offered_questions(market))
    columns = _chosen_columns(body.get("columns"), offered_columns(market))
    rows = [
        [as_text_cell(column.cell(vendor)) for column in columns]
        for vendor in _vendors(market)
        if vendor_shown(vendor, filters)
    ]
    return Export(market, [as_text_cell(column.label) for column in columns], rows)


def preview(market_id: str, body: Any, requesting_user: str) -> Tuple[Dict[str, Any], int]:
    """How many vendors the export holds, its header and its first rows, and every column and
    filter the market offers the dialog. Asks ``Actions.EXPORT_CSV``."""
    export = _build(market_id, body, requesting_user)
    setup = export.market.setup_object
    return {
        "count": len(export.rows),
        "header": export.header,
        "rows": export.rows[:PREVIEW_ROWS],
        "offered": {
            "columns": [
                {"id": column.id, "label": column.label}
                for column in offered_columns(export.market)
            ],
            "defaultColumns": DEFAULT_COLUMNS,
            "statuses": [{"id": status, "label": label} for status, label in STATUSES],
            "dates": [market_date.date for market_date in setup.market_dates] if setup else [],
            "sections": [section.name for section in setup.sections] if setup else [],
            "tiers": [tier.name for tier in setup.tiers] if setup else [],
            "questions": offered_questions(export.market),
        },
    }, 200


_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def export(market_id: str, body: Any, requesting_user: str) -> Tuple[str, str]:
    """The CSV and its filename: UTF-8 with a byte-order mark, named for the market and the day.

    The day is the organizer's, sent with the request, since their evening is the server's
    tomorrow; the server's own when none is sent. Asks ``Actions.EXPORT_CSV``.
    """
    built = _build(market_id, body, requesting_user)
    day = body.get("day")
    if not isinstance(day, str) or not _DAY.match(day):
        day = _today()

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(built.header)
    writer.writerows(built.rows)
    filename = MarketsApi._market_csv_filename(built.market.name, market_id, f"vendors_{day}")
    return BYTE_ORDER_MARK + buffer.getvalue(), filename
