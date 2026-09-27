"""What a Google Form's responses CSV proposes a draft market becomes.

An organizer who already collects applications with their own Google Form uploads its responses,
and this module reads them into a **proposal**: for every column, in the file's order, whether it
says who applied, answers one of the essential questions, is a question of the organizer's own (and
then its type, whether it is required, its options, label, help text and key), or is left out, and
why. Nothing is written, and nothing is kept: the file is read and let go.

It sits beside ``csv_import``, which reads a later export of the same form into applications, and
shares its header collapsing and grid grouping rather than keeping copies, so the two never disagree
about which columns are one question.

The rules are the ones measured on five real exports (the form-started-from-a-CSV map, ticket 03).
They read values, never header words, except for the few words Google itself writes (``Timestamp``)
and the review columns organizers add beside a form ("Status", "Notes"): header wording is what
another organizer changes, and value rules survived that where keyword rules did not.

A column is read through the privacy view of ticket 01: only answers at least 3 distinct applicants
gave, counted by applicant email, with a multi-select answer counted per option, and otherwise a
shape computed from the whole column (how many answered, how many distinct, how many look like
emails or links). That view is what a model may be sent, and it also scored better than reading the
whole column: free-text answers that happen to hold commas stop looking like choices. What the view
cannot give - every option of a choice question, with how many chose it - comes from the whole
file, which never leaves the server.
"""
import re
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple

import essential_fields as EssentialFields
from csv_import import GRID_HEADER, collapse_header, column_groups, parse_csv
from datatypes import MarketPhase, phase_from_market_document
from market_documents import market_doc_field

SHARED_BY = 3
# How much of the file must answer a question for it to have been required. The export does not
# say which questions the form required, so this is read from how many answered.
REQUIRED_SHARE = 0.97

# The reasons a guess carries, shown beside it as "check this".
CHECK_SEVERAL_ANSWERS = "Could allow several answers"
CHECK_ORGANIZER = "Read as a column your team added"
CHECK_RARE_OPTIONS = "Has options fewer than 3 applicants chose"

FATE_SUBMITTED_AT = "submitted_at"
FATE_APPLICANT_EMAIL = "applicant_email"
FATE_ESSENTIAL = "essential"
FATE_CUSTOM = "custom"
FATE_LEFT_OUT = "left_out"

LEFT_OUT_ORGANIZER = "organizer"
LEFT_OUT_DUPLICATE = "duplicate"
LEFT_OUT_EMPTY = "empty"

EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
URL = re.compile(r"https?://|www\.|\.com\b|\.ca\b", re.IGNORECASE)
HANDLE = re.compile(r"(^|\s)@\w")
PHONE = re.compile(r"\+?\d[\d\s().-]{8,}\d")
NUMBER = re.compile(r"^\s*\$?\d+(\.\d+)?\s*$")
DRIVE_UPLOAD = re.compile(r"^https://drive\.google\.com/open\?id=")
DATE_LIKE = re.compile(r"^\d{1,4}[/-]\d{1,2}[/-]\d{1,4}$")

WEEKDAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
            "mon", "tue", "wed", "thu", "fri", "sat", "sun")
MONTHS = {month: number for number, month in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}
WEEKDAY_NUMBER = {day: number for number, day in enumerate(
    ["mon", "tue", "wed", "thu", "fri", "sat", "sun"])}
DATE_TEXT = re.compile(
    r"^(?:(?P<weekday>[a-z]+),?\s+)?(?P<month>[a-z]+)\.?\s+(?P<day>\d{1,2})(?:st|nd|rd|th)?$",
    re.IGNORECASE)
NONE_WORDS = {"none", "n/a", "na", "not available", "unavailable", "-"}

# Google writes this header itself; it is the one header word read as a fact.
TIMESTAMP_HEADER = "timestamp"
# The review columns organizers keep beside a form's answers.
ORGANIZER_HEADER = re.compile(
    r"^(status|notes?|screening notes|accepted\b.*|approved\b.*|decision|paid\b.*|column \d+)$",
    re.IGNORECASE)
CHECKBOX_LEAD = re.compile(r"^(i certify|i understand|i agree|i confirm|i acknowledge)\b",
                           re.IGNORECASE)
DECISIONS = {"accepted", "rejected", "approved", "declined", "waitlist", "waitlisted", "pending",
             "true", "false", "y", "n", "accept", "reject"}
YES_NO = {"yes", "no", "available", "x"}

VIEW_VALUES = 10
VIEW_OPTIONS = 15
# An option of a multi-select must be at least this share of its answers to be proposed kept: a
# handful of applicants typing the same "Other" answer is not an option the form offered.
OPTION_SHARE = 0.04

# How many options a choice question lists before the rare ones are counted instead.
OPTIONS_LISTED = 20

LABEL_MAX = 120
KEY_MAX = 40

# In the order the form asks them, which is the order "not asked" lists them.
ESSENTIALS = (
    (EssentialFields.FULL_NAME_KEY, EssentialFields.FULL_NAME_LABEL),
    (EssentialFields.PREFERRED_NAME_KEY, EssentialFields.PREFERRED_NAME_LABEL),
    (EssentialFields.AVAILABLE_DATES_KEY, EssentialFields.AVAILABLE_DATES_LABEL),
    (EssentialFields.MAX_DATES_KEY, EssentialFields.MAX_DATES_LABEL),
    (EssentialFields.TABLE_CHOICE_KEY, EssentialFields.TABLE_CHOICE_LABEL),
    (EssentialFields.TABLE_SHARE_EMAIL_KEY, EssentialFields.TABLE_SHARE_EMAIL_LABEL),
    (EssentialFields.TIER_PREFERENCE_KEY, EssentialFields.TIER_PREFERENCE_LABEL),
    (EssentialFields.SECTION_RANKING_KEY, EssentialFields.SECTION_RANKING_LABEL),
    (EssentialFields.TABLE_TYPE_RANKING_KEY, EssentialFields.TABLE_TYPE_RANKING_LABEL),
)


# --- Reading answers ----------------------------------------------------------------------------


def split_options(value: str) -> List[str]:
    """A checkbox answer's options: Google joins them with ", ", and an option can itself hold
    ", " - inside parentheses ("Woven (crochet, knitting, etc)") or after a weekday ("Monday,
    November 20th")."""
    parts, depth, current = [], 0, []
    for piece in str(value).split(", "):
        current.append(piece)
        depth += piece.count("(") - piece.count(")")
        if depth > 0 or piece.strip().lower() in WEEKDAYS:
            continue
        parts.append(", ".join(current).strip())
        current = []
    if current:
        parts.append(", ".join(current).strip())
    return [part for part in parts if part]


def parse_date(text: str) -> Optional[Tuple[int, int, Optional[int]]]:
    """``(month, day, weekday)`` from "Monday, November 20th" or "Nov 20", or None."""
    match = DATE_TEXT.match(str(text).strip())
    if not match or match.group("month")[:3].lower() not in MONTHS:
        return None
    weekday = (match.group("weekday") or "")[:3].lower()
    return (MONTHS[match.group("month")[:3].lower()], int(match.group("day")),
            WEEKDAY_NUMBER.get(weekday))


def _identifying(value: str) -> bool:
    return bool(EMAIL.search(value) or URL.search(value) or HANDLE.search(value)
                or PHONE.search(value))


def _applicant_column(rows: List[List[str]], width: int) -> Optional[int]:
    """The column that tells applicants apart: the first whose answers are email addresses."""
    for column in range(width):
        values = [row[column].strip() for row in rows if row[column].strip()]
        if values and sum(1 for v in values if EMAIL.fullmatch(v)) / len(values) > 0.95:
            return column
    return None


def _responses(rows: List[List[str]]) -> int:
    """Rows someone submitted: a row an organizer typed a status into alone is not one."""
    return sum(1 for row in rows if sum(1 for cell in row if cell.strip()) >= 3)


class _Column:
    """One column read two ways: the privacy view the rules decide on, and the whole column the
    options are listed from."""

    def __init__(self, header: str, values: List[str], people: List[str], responses: int,
                 row_emails: List[Optional[str]], applicant_emails: Set[str]):
        self.header = header
        self.label = collapse_header(header)
        self.values = values
        filled = [value.strip() for value in values if value.strip()]
        self.filled = len(filled)
        self.responses = responses or 1

        whole: Dict[str, Set[str]] = {}
        options: Dict[str, Set[str]] = {}
        for value, person in zip(values, people):
            if value.strip():
                whole.setdefault(value.strip(), set()).add(person)
                for option in split_options(value):
                    options.setdefault(option, set()).add(person)
        self.answer_counts = {value: len(who) for value, who in whole.items()}
        self.option_counts = {option: len(who) for option, who in options.items()}
        self.shared = _most_common(
            (value, count) for value, count in self.answer_counts.items()
            if count >= SHARED_BY and not _identifying(value))[:VIEW_VALUES]
        self.shared_options = _most_common(
            (option, count) for option, count in self.option_counts.items()
            if count >= SHARED_BY and not _identifying(option))[:VIEW_OPTIONS]

        def share(test) -> float:
            return round(sum(1 for value in filled if test(value)) / self.filled, 2) if filled else 0

        self.distinct = len(set(filled))
        self.email = share(EMAIL.fullmatch)
        self.drive_upload = share(DRIVE_UPLOAD.search)
        self.numeric = share(NUMBER.match)
        self.date_like = share(DATE_LIKE.match)
        self.comma = share(lambda value: ", " in value)
        self.capitalised = share(lambda value: all(word[:1].isupper() for word in value.split()))
        self.words_median = sorted(len(value.split()) for value in filled)[len(filled) // 2] \
            if filled else 0
        pairs = [(value.strip().lower(), email) for value, email in zip(values, row_emails)
                 if value.strip()]
        self.same_row_email = round(
            sum(1 for value, email in pairs if email and value == email) / len(pairs), 2) \
            if pairs else 0
        self.other_row_email = round(
            sum(1 for value, email in pairs if value in applicant_emails and value != email)
            / len(pairs), 2) if pairs else 0

    @property
    def distinct_ratio(self) -> float:
        return self.distinct / self.filled if self.filled else 0

    @property
    def answered_share(self) -> float:
        return self.filled / self.responses

    def is_choice_like(self) -> bool:
        """Most answers are a handful of repeated values: a choice, not a name."""
        return bool(self.filled) and sum(n for _, n in self.shared) / self.filled >= 0.5

    def is_multi(self) -> bool:
        """Joined answers contain options that are also answered on their own."""
        standalone = {value for value, _ in self.shared}
        joined = sum(
            1 for value, _ in self.shared
            if len(split_options(value)) >= 2
            and any(part in standalone for part in split_options(value)))
        return joined >= 1 and self.comma >= 0.02

    def joins_its_options(self) -> bool:
        """Somewhere in the whole file, one answer names two of the view's answers: evidence a
        single choice may really allow several, which the view alone cannot show."""
        standalone = {value for value, _ in self.shared}
        return any(
            sum(1 for part in split_options(value) if part in standalone) >= 2
            for value in self.answer_counts)


def _most_common(pairs) -> List[Tuple[str, int]]:
    return sorted(pairs, key=lambda pair: (-pair[1], pair[0]))


# --- Label, help text and key -------------------------------------------------------------------


def label_and_help(header: str) -> Tuple[str, Optional[str]]:
    """The header's first line is the label and the rest, verbatim, its help text. A first line
    over LABEL_MAX characters keeps its first sentence as the label and gives the rest away."""
    text = str(header).replace("\r\n", "\n").replace("\r", "\n").strip()
    first, _, rest = text.partition("\n")
    first, rest = first.strip(), rest.strip()
    if len(first) > LABEL_MAX:
        sentence = re.match(r"^(.+?[?.])(\s|$)", first)
        if sentence:
            rest = (first[sentence.end():].strip() + ("\n" + rest if rest else "")).strip()
            first = sentence.group(1).strip()
    return first, rest or None


def key_for(label: str, taken: Set[str]) -> str:
    """The label's slug, capped at KEY_MAX characters on a word boundary, ``_2`` on for a repeat.

    Held to the form's key rule (``^[a-z0-9_]+$``, and never the reserved essential prefix).
    """
    slug = re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_") or "question"
    if len(slug) > KEY_MAX:
        cut = slug[:KEY_MAX + 1]
        slug = cut[:cut.rfind("_")] if "_" in cut else slug[:KEY_MAX]
    if slug.startswith(EssentialFields.ESSENTIAL_KEY_PREFIX):
        slug = "q_" + slug
    key, n = slug, 2
    while key in taken:
        key, n = f"{slug}_{n}", n + 1
    taken.add(key)
    return key


# --- Deciding what a column is ------------------------------------------------------------------


def _field(column: _Column, taken_keys: Set[str]) -> Dict[str, Any]:
    """What the column would be as a question of the organizer's own."""
    label, help_text = label_and_help(column.header)
    field: Dict[str, Any] = {
        "key": key_for(label, taken_keys), "label": label, "helpText": help_text,
        "required": column.answered_share >= REQUIRED_SHARE, "options": [], "unlistedOptions": 0,
    }
    if column.drive_upload >= 0.9:
        field["type"] = "file"
    elif column.email >= 0.9:
        field["type"] = "email"
    elif ((column.shared and column.shared[0][1] / column.filled >= REQUIRED_SHARE)
          or (CHECKBOX_LEAD.match(column.label) and column.distinct <= 2)):
        field["type"] = "checkbox"
    elif column.numeric >= 0.9:
        field["type"] = "number"
    elif column.date_like >= 0.9:
        field["type"] = "date"
    else:
        covered = sum(n for _, n in column.shared) / column.filled if column.filled else 0
        multi = column.is_multi()
        if covered >= 0.9 and column.distinct <= 12 and not multi:
            field["type"] = "select"
            field["options"] = _options(column.answer_counts, column.filled, share_floor=0)
            field["unlistedOptions"] = _unlisted(column.answer_counts, field["options"])
        elif multi and any(n / column.filled >= OPTION_SHARE for _, n in column.shared_options):
            field["type"] = "multi_select"
            field["options"] = _options(column.option_counts, column.filled,
                                        share_floor=OPTION_SHARE)
            field["unlistedOptions"] = _unlisted(column.option_counts, field["options"])
        else:
            field["type"] = "text"
    return field


def _options(counts: Dict[str, int], filled: int, share_floor: float) -> List[Dict[str, Any]]:
    """The options the whole file shows, most chosen first, with how many applicants chose each.

    One fewer than 3 chose is rare and off by default: the organizer decides whether to keep it.
    Rare ones are listed only while the list stays short, since a checkbox question's "Other"
    answers run to hundreds, each one person's; ``_unlisted`` counts the rest.
    """
    ordered = _most_common(counts.items())
    common = [(value, count) for value, count in ordered if count >= SHARED_BY]
    rare = [(value, count) for value, count in ordered if count < SHARED_BY]
    listed = common + rare[:max(OPTIONS_LISTED - len(common), 0)]
    return [
        {"value": value, "count": count, "rare": count < SHARED_BY,
         "keep": count >= SHARED_BY and count / filled >= share_floor}
        for value, count in listed
    ]


def _unlisted(counts: Dict[str, int], listed: List[Dict[str, Any]]) -> int:
    return len(counts) - len(listed)


def _classify(columns: List[_Column]) -> List[Dict[str, Any]]:
    """One decision per column, in order: fate, which essential, why."""
    lowered = [column.label.lower() for column in columns]
    timestamp = next((i for i, h in enumerate(lowered) if h == TIMESTAMP_HEADER), None)
    decided: List[Dict[str, Any]] = []
    have: Set[str] = set()
    email_found = False

    def left_out(reason: str, why: str) -> Dict[str, Any]:
        return {"fate": FATE_LEFT_OUT, "leftOut": reason, "why": why}

    def essential(key: str, why: str) -> Dict[str, Any]:
        have.add(key)
        return {"fate": FATE_ESSENTIAL, "essential": key, "why": why}

    for index, column in enumerate(columns):
        header = column.label
        grid = GRID_HEADER.match(header)
        options = [option for option, _ in column.shared_options]
        if not header:
            decided.append(left_out(LEFT_OUT_EMPTY, "Nobody answered it") if not column.filled
                           else left_out(LEFT_OUT_ORGANIZER, "It has no question above it"))
            continue
        if timestamp is not None and index < timestamp:
            decided.append(left_out(LEFT_OUT_ORGANIZER, "It sits before the form's first column"))
            continue
        if ORGANIZER_HEADER.match(header) or (len(header) <= 3 and not grid):
            decided.append(left_out(LEFT_OUT_ORGANIZER, "Its heading is one your team would add"))
            continue
        if lowered[index] == TIMESTAMP_HEADER:
            decided.append({"fate": FATE_SUBMITTED_AT, "why": "When each application arrived"})
            continue
        if column.same_row_email >= 0.5:
            decided.append(left_out(LEFT_OUT_DUPLICATE, "It repeats each row's email address"))
            continue
        if column.other_row_email >= 0.3:
            decided.append(essential(EssentialFields.TABLE_SHARE_EMAIL_KEY,
                                     "Its answers are other applicants' emails"))
            continue
        if (column.email >= 0.9 and not email_found and column.distinct_ratio >= 0.95
                and column.answered_share >= REQUIRED_SHARE):
            email_found = True
            decided.append({"fate": FATE_APPLICANT_EMAIL,
                            "why": "Everyone answered it with their own email"})
            continue
        name_like = (column.capitalised >= 0.85 and column.numeric == 0
                     and not (grid or column.is_choice_like()))
        if (name_like and column.words_median >= 2 and column.distinct_ratio >= 0.95
                and EssentialFields.FULL_NAME_KEY not in have):
            decided.append(essential(EssentialFields.FULL_NAME_KEY,
                                     "Its answers are capitalised names of two or more words"))
            continue
        if (name_like and column.words_median == 1 and column.distinct_ratio >= 0.8
                and EssentialFields.PREFERRED_NAME_KEY not in have):
            decided.append(essential(EssentialFields.PREFERRED_NAME_KEY,
                                     "Its answers are capitalised single names"))
            continue
        if (column.shared and {v.lower() for v, _ in column.shared} <= DECISIONS
                and column.answered_share >= 0.5):
            decided.append(left_out(LEFT_OUT_ORGANIZER, "Its answers are review decisions"))
            continue
        if grid and parse_date(grid.group("option")):
            real = [o for o in options if o.lower() not in NONE_WORDS]
            if {o.lower() for o in real} <= YES_NO:
                decided.append(essential(EssentialFields.AVAILABLE_DATES_KEY,
                                         "A grid of the market's days, answered yes or no"))
            else:
                decided.append(essential(EssentialFields.TIER_PREFERENCE_KEY,
                                         "A grid of the market's days, answered with tiers"))
            continue
        if options and sum(1 for o in options if parse_date(o)) / len(options) >= 0.8:
            decided.append(essential(EssentialFields.AVAILABLE_DATES_KEY,
                                     "Its answers are the market's days"))
            continue
        values = [value for value, _ in column.shared]
        day_counts = [value for value in values if re.fullmatch(r"\d+ days?", value.lower())]
        if values and len(day_counts) / len(values) >= 0.8:
            decided.append(essential(EssentialFields.MAX_DATES_KEY,
                                     "Its answers are a number of days"))
            continue
        joined = " ".join(options).lower()
        if "half" in joined and "full" in joined and len(options) <= 4:
            decided.append(essential(EssentialFields.TABLE_CHOICE_KEY,
                                     "Its answers choose a full or half table"))
            continue
        decided.append({"fate": FATE_CUSTOM, "why": "A question of your own"})
    return decided


# --- The whole file -----------------------------------------------------------------------------


def proposal(headers: Sequence[str], rows: Sequence[Sequence[str]]) -> Dict[str, Any]:
    """What every column of this file becomes, in the file's order. Reads; writes nothing."""
    width = len(headers)
    body = [(list(row) + [""] * width)[:width] for row in rows]
    applicant = _applicant_column(body, width)
    people = [
        row[applicant].strip().lower() if applicant is not None and row[applicant].strip()
        else f"row {index}" for index, row in enumerate(body)
    ]
    applicant_emails = {person for person in people if "@" in person}
    responses = _responses(body)

    columns = []
    for index, header in enumerate(headers):
        own = index == applicant
        columns.append(_Column(
            header, [row[index] for row in body], people, responses,
            row_emails=[None] * len(body) if own else [p if "@" in p else None for p in people],
            applicant_emails=set() if own else applicant_emails,
        ))

    groups = {index: group.stem for group in column_groups(list(headers))
              for index in group.columns}
    taken_keys: Set[str] = set()
    proposed = []
    for index, (column, decided) in enumerate(zip(columns, _classify(columns))):
        field = _field(column, taken_keys) if column.filled else None
        check = []
        if decided.get("leftOut") == LEFT_OUT_ORGANIZER:
            check.append(CHECK_ORGANIZER)
        if decided["fate"] == FATE_CUSTOM and field:
            if field["type"] == "select" and column.joins_its_options():
                check.append(CHECK_SEVERAL_ANSWERS)
            if any(option["rare"] for option in field["options"]):
                check.append(CHECK_RARE_OPTIONS)
        proposed.append({
            "index": index,
            "header": column.header,
            "group": groups.get(index),
            "answered": column.filled,
            "firstAnswers": [value for value in column.values if value.strip()][:3],
            "fate": decided["fate"],
            "essential": decided.get("essential"),
            "leftOut": decided.get("leftOut"),
            "why": decided["why"],
            "check": check,
            "field": field,
        })

    answered = {column["essential"] for column in proposed if column["essential"]}
    return {
        "rowCount": len(body),
        "responses": responses,
        "columns": proposed,
        "notAsked": [
            {"key": key, "label": label, "why": "No column in your file answers it"}
            for key, label in ESSENTIALS if key not in answered
        ],
    }


def refusal(market_doc: Dict[str, Any]) -> Optional[str]:
    """Why this market cannot be started from a CSV, or None.

    Only a draft: the plan and the form it writes are a draft's to change. Only a form with no
    questions of its own, so the proposal never has to merge with questions already written.
    """
    if phase_from_market_document(market_doc) != MarketPhase.DRAFT:
        return "Only a draft market can be started from a CSV."
    form = market_doc_field(market_doc, "application_form") or {}
    if form.get("fields"):
        return ("This market's form already has questions of its own, so it can't be started "
                "from a CSV.")
    return None


def propose(market_doc: Dict[str, Any], csv_content: str) -> Tuple[Dict[str, Any], int]:
    """The proposal for this market and this file, or the reason there is none."""
    reason = refusal(market_doc)
    if reason:
        return {"error": reason}, 409
    error, headers, rows = parse_csv(csv_content)
    if error:
        return {"error": error}, 400
    return proposal(headers, rows), 200
