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
from concurrent.futures import ThreadPoolExecutor, wait
from datetime import date, datetime
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple

import essential_fields as EssentialFields
import typesafe_client as TypeSafe
from csv_import import (
    GRID_HEADER, collapse_header, column_groups, normalized_submitted_at, parse_csv, resolve_value,
)
from datatypes import MarketPhase, phase_from_market_document
from market_documents import market_doc_field

SHARED_BY = 3
# How much of the file must answer a question for it to have been required. The export does not
# say which questions the form required, so this is read from how many answered.
REQUIRED_SHARE = 0.97

# Why a row of the proposal is worth a second look, shown beside it as "check this".
CHECK_SEVERAL_ANSWERS = "Could allow several answers"
CHECK_ORGANIZER = "Read as a column your team added"
CHECK_RARE_OPTIONS = "Has options few applicants chose"
CHECK_UPLOAD = "A file upload in your Google Form: applicants here paste a link instead"
CHECK_MAYBE_TEAM = "Could be a column your team added"
CHECK_CEILING_UNSURE = "A heading mentions a number of days: check whether it limits days per vendor"
CHECK_UNREACHABLE = "Couldn't reach TypeSafe"

# TypeSafe's answer is taken at this probability or above, and never below (ticket 04).
CONFIDENT = 0.8
# Values sent to TypeSafe for one column, at most (ticket 01).
SENT_VALUES = 10

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
NUMBER_WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7}
# The ceiling on days per vendor, as a form's instructions state it.
CEILING = re.compile(
    rf"\b(?:up to|a maximum of|at most|no more than)\s+(\d+|{'|'.join(NUMBER_WORDS)})"
    r"\s+(?:market\s+)?days?\b", re.IGNORECASE)
# How far either side of the year the file was filled in a fitting year is looked for. Two
# found exactly one in every corpus file; five found two in some.
YEAR_SPREAD = 2

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
        self.link = share(URL.search)
        self.length_median = sorted(len(value) for value in filled)[len(filled) // 2] \
            if filled else 0
        numbers = [float(value.strip().lstrip("$")) for value in filled if NUMBER.match(value)]
        self.number_range = (min(numbers), max(numbers)) if numbers else None
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
        cut = _first_sentence_end(first)
        if cut is None:
            # No sentence ends before the line does: the last whole word that fits.
            cut = first.rfind(" ", 0, LABEL_MAX + 1)
            cut = cut if cut > 0 else LABEL_MAX
        head, tail = first[:cut].strip(), first[cut:].strip()
        rest = (tail + ("\n" + rest if rest else "")).strip()
        first = head
    return first, rest or None


def _first_sentence_end(text: str) -> Optional[int]:
    """Just past the first "?" or "." that ends a sentence: followed by a space or the end, and
    outside parentheses, so "(e.g. your timetable)" does not end one."""
    depth = 0
    for position, char in enumerate(text):
        if char == "(":
            depth += 1
        elif char == ")":
            depth = max(depth - 1, 0)
        elif char in "?." and depth == 0 and (position + 1 == len(text) or text[position + 1] == " "):
            return position + 1
    return None


def key_for(label: str, taken: Set[str]) -> str:
    """The label's slug, capped at KEY_MAX characters on a word boundary, ``_2`` on for a repeat.

    A slug is made of the form's key characters by construction; the reserved essential prefix is
    the one thing it could still collide with. The form's validator judges it again on confirm.
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
        "upload": False,
    }
    if column.drive_upload >= 0.9:
        # A Google Forms upload. The application form takes no files, so the question asks for a
        # link, which is also what the export holds.
        field["type"] = "text"
        field["upload"] = True
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

    One few applicants chose - fewer than 3, or for a checkbox question under OPTION_SHARE of its
    answers - is rare and off by default, with its count: the organizer decides whether to keep it.
    The list stops at OPTIONS_LISTED, since a checkbox question's "Other" answers run to hundreds,
    each one person's; ``_unlisted`` counts the rest, and the form builder can add any of them.
    """
    def rare(count: int) -> bool:
        return count < SHARED_BY or count / filled < share_floor

    ordered = _most_common(counts.items())
    kept = [(value, count) for value, count in ordered if not rare(count)]
    others = [(value, count) for value, count in ordered if rare(count)]
    listed = kept + others[:max(OPTIONS_LISTED - len(kept), 0)]
    return [
        {"value": value, "count": count, "rare": rare(count), "keep": not rare(count)}
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
        if ORGANIZER_HEADER.match(header):
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


# --- What the file says about the plan ----------------------------------------------------------


def _plan(columns: List[_Column], decisions: List[Dict[str, Any]],
          market_doc: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """The dates, the tiers best first and the ceiling the file states, matched against the plan.

    The organizer's plan wins: where it already has dates or tiers, the file's are matched as the
    import matches values, and a difference comes back to settle, never to be added.
    """
    offering = EssentialFields.effective_essential_options(market_doc) if market_doc else None
    plan_dates = list(offering.dates) if offering else []
    plan_tiers = list(offering.tiers) if offering else []

    found = _dates(columns, decisions)
    for found_date in found:
        found_date["matches"] = next((d for d in plan_dates if _same_day(found_date, d)), None)
    tiers = [{"name": name, "matches": resolve_value(name, plan_tiers, {})[0]}
             for name in _tiers(columns, decisions)]

    disagreements = []
    if plan_dates:
        disagreements += [{"kind": "date", "value": d["text"]} for d in found if not d["matches"]]
    if plan_tiers:
        disagreements += [{"kind": "tier", "value": t["name"]} for t in tiers if not t["matches"]]
    return {
        "dates": found,
        "year": _fitting_year(found, columns, decisions),
        "tiers": tiers,
        "ceiling": _ceiling(columns),
        "disagreements": disagreements,
        "check": [],
    }


def _same_day(found: Dict[str, Any], plan_date: str) -> bool:
    """A plan date is the file's day when month and day agree, and the weekday too if the file
    states one: "Sunday, March 8" is not a plan's Saturday 8 March of another year."""
    try:
        day = date.fromisoformat(plan_date)
    except ValueError:
        return False
    return (day.month, day.day) == (found["month"], found["day"]) and (
        found["weekday"] is None or day.weekday() == found["weekday"])


def _dates(columns: List[_Column], decisions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """The market's days: a date grid's bracketed headers, or answers that are dates."""
    found: Dict[Tuple[int, int], Dict[str, Any]] = {}

    def add(text: str, source: str) -> None:
        parsed = parse_date(text)
        if parsed and parsed[:2] not in found:
            month, day, weekday = parsed
            found[(month, day)] = {"text": text, "month": month, "day": day,
                                   "weekday": weekday, "from": source}

    for column, decided in zip(columns, decisions):
        if decided.get("essential") not in (EssentialFields.TIER_PREFERENCE_KEY,
                                            EssentialFields.AVAILABLE_DATES_KEY):
            continue
        grid = GRID_HEADER.match(column.label)
        if grid and parse_date(grid.group("option")):
            add(collapse_header(grid.group("option")), "header")
        elif decided["essential"] == EssentialFields.AVAILABLE_DATES_KEY:
            for option, _ in column.shared_options:
                add(option, "answers")
    return [found[key] for key in sorted(found)]


def _tiers(columns: List[_Column], decisions: List[Dict[str, Any]]) -> List[str]:
    """The tier grid's options other than "none", best first.

    Google writes a checkbox answer's options in the form's order, and a form lists tiers best
    first, so a tier's usual place in the joined answers is its rank.
    """
    places: Dict[str, List[float]] = {}
    for column, decided in zip(columns, decisions):
        if decided.get("essential") != EssentialFields.TIER_PREFERENCE_KEY:
            continue
        for value, count in column.shared:
            parts = [p for p in split_options(value) if p.lower() not in NONE_WORDS]
            for position, part in enumerate(parts):
                places.setdefault(part, []).extend([position / max(len(parts) - 1, 1)] * count)
        # A tier only ever chosen alongside others, never enough times alone to be in the view.
        for option, count in column.shared_options:
            if option.lower() not in NONE_WORDS and option not in places:
                places[option] = [1.0] * count
    return sorted(places, key=lambda t: (sum(places[t]) / len(places[t]), -len(places[t])))


def _fitting_year(found: List[Dict[str, Any]], columns: List[_Column],
                  decisions: List[Dict[str, Any]]) -> Optional[int]:
    """The one year near when the file was filled in whose calendar every stated weekday fits.

    Near the submissions' year, or this year for an export without timestamps. None when no year
    fits, or when more than one does (dates without weekdays fit every year).
    """
    if not found:
        return None
    around = _submitted_year(columns, decisions) or date.today().year
    fitting = [
        year for year in range(around - YEAR_SPREAD, around + YEAR_SPREAD + 1)
        if all(_weekday_fits(year, d) for d in found)
    ]
    return fitting[0] if len(fitting) == 1 else None


def _weekday_fits(year: int, found: Dict[str, Any]) -> bool:
    try:
        return found["weekday"] is None or \
            date(year, found["month"], found["day"]).weekday() == found["weekday"]
    except ValueError:
        return False  # 29 February in a year without one


def _submitted_year(columns: List[_Column], decisions: List[Dict[str, Any]]) -> Optional[int]:
    column = next((c for c, d in zip(columns, decisions) if d["fate"] == FATE_SUBMITTED_AT), None)
    if column is None:
        return None
    years = []
    for value in column.values:
        try:
            stamp = normalized_submitted_at(value)
        except ValueError:
            continue
        if stamp:
            years.append(datetime.fromisoformat(stamp).year)
    return sorted(years)[len(years) // 2] if years else None


def _ceiling(columns: List[_Column]) -> Optional[Dict[str, Any]]:
    """The most days one vendor may get, from the first header whose prose states it, with the
    sentence it came from. An assignment rule, not a plan card."""
    for index, column in enumerate(columns):
        for sentence in _sentences(column.header):
            match = CEILING.search(sentence)
            if match:
                amount = match.group(1).lower()
                return {"days": int(amount) if amount.isdigit() else NUMBER_WORDS[amount],
                        "sentence": sentence, "column": index, "from": "rules"}
    return None


def _sentences(header: str) -> List[str]:
    """A header's sentences, never running across a line break."""
    return [sentence.strip() for line in str(header).splitlines()
            for sentence in re.split(r"(?<=[.?!])\s+", line.strip()) if sentence.strip()]


# --- What TypeSafe is asked ---------------------------------------------------------------------

# A number of days, however a header puts it: the prose the ceiling rule could not read.
DAYS_MENTIONED = re.compile(
    rf"\b(\d+|{'|'.join(NUMBER_WORDS)})\s+(?:market\s+)?days?\b", re.IGNORECASE)


def _shape(column: _Column) -> str:
    """What a column's answers look like, computed here and holding none of them (ticket 01)."""
    if column.email >= 0.9:
        kind = "email addresses"
    elif column.link >= 0.9:
        kind = "links"
    elif column.number_range:
        low, high = column.number_range
        kind = f"numbers from {low:g} to {high:g}"
    else:
        kind = f"prose, around {column.length_median} characters"
    return kind


def _team_column_state(column: _Column) -> str:
    """One column, never a row: its header, how it was answered, and either the answers at least
    3 applicants gave (most common first, none holding an email, link, handle or phone number) or
    a shape computed here."""
    lines = [f'Column header: "{column.label}"',
             f"Answered in {column.filled / column.responses:.0%} of applications; "
             f"{column.distinct_ratio:.0%} of answers are distinct."]
    if column.shared_options:
        shown = ", ".join(f'"{value}" ({count})' for value, count in
                          column.shared_options[:SENT_VALUES])
        lines.append(f"Answers at least 3 applicants gave, with how many: {shown}.")
    else:
        lines.append(f"Typical answer: {_shape(column)}.")
    return "\n".join(lines)


def _ceiling_state(sentence: str) -> str:
    return f'Question text: "{sentence}"'


def _team_candidates(columns: List[_Column], proposed: List[Dict[str, Any]]) -> List[int]:
    """The optional free-text questions after the form's last certain one: where a team's notes
    headed like a question ("Comments (internal)") would sit, and the rules cannot tell."""
    certain = [c["index"] for c in proposed
               if c["fate"] in (FATE_SUBMITTED_AT, FATE_APPLICANT_EMAIL, FATE_ESSENTIAL)
               or (c["fate"] == FATE_CUSTOM and c["field"] and c["field"]["required"])]
    after = max(certain, default=-1)
    return [c["index"] for c in proposed
            if c["index"] > after and c["fate"] == FATE_CUSTOM and c["field"]
            and c["field"]["type"] == "text" and not c["field"]["required"]]


def _ceiling_candidate(columns: List[_Column]) -> Optional[Tuple[int, str]]:
    """The first header sentence that names a number of days the ceiling rule did not read."""
    for index, column in enumerate(columns):
        for sentence in _sentences(column.header):
            if DAYS_MENTIONED.search(sentence):
                return index, sentence
    return None


def _ask_typesafe(asker: TypeSafe.Asker, columns: List[_Column], proposed: List[Dict[str, Any]],
                  plan: Dict[str, Any]) -> bool:
    """Ask what the rules left, all at once, and wait at most the deadline for the answers.

    An answer is taken at CONFIDENT or above; below it, or on any failure, the rules' answer stands
    and the row says why it is worth a look. Returns whether anything was asked.
    """
    questions = {("team", index): (_team_column_state(columns[index]),
                                   TypeSafe.TEAM_COLUMN_INSTRUCTIONS,
                                   TypeSafe.TEAM_COLUMN_CRITERIA)
                 for index in _team_candidates(columns, proposed)}
    ceiling = None if plan["ceiling"] else _ceiling_candidate(columns)
    if ceiling:
        questions[("ceiling", ceiling[0])] = (_ceiling_state(ceiling[1]),
                                              TypeSafe.CEILING_INSTRUCTIONS,
                                              TypeSafe.CEILING_CRITERIA)
    if not questions:
        return False

    pool = ThreadPoolExecutor(max_workers=len(questions))
    futures = {key: pool.submit(asker, *asked) for key, asked in questions.items()}
    wait(futures.values(), timeout=TypeSafe.DEADLINE_SECONDS)
    pool.shutdown(wait=False, cancel_futures=True)

    for (question, index), future in futures.items():
        answer = None
        if future.done() and not future.cancelled() and future.exception() is None:
            answer = future.result()
        choice = max(answer, key=answer.get) if answer else None
        sure = choice is not None and answer[choice] >= CONFIDENT
        if question == "team":
            row = proposed[index]
            if not answer:
                row["check"].append(CHECK_UNREACHABLE)
            elif not sure:
                row["check"].append(CHECK_MAYBE_TEAM)
            elif choice == TypeSafe.TEAM_COLUMN:
                row.update(fate=FATE_LEFT_OUT, leftOut=LEFT_OUT_ORGANIZER,
                           why="TypeSafe read it as a column your team added")
                row["check"] = [CHECK_ORGANIZER]
        else:
            if not answer:
                plan["check"].append(CHECK_UNREACHABLE)
            elif not sure:
                plan["check"].append(CHECK_CEILING_UNSURE)
            elif choice != TypeSafe.NO_CEILING:
                plan["ceiling"] = {"days": int(choice), "sentence": ceiling[1], "column": index,
                                   "from": "typesafe"}
    return True


# --- The whole file -----------------------------------------------------------------------------


def proposal(headers: Sequence[str], rows: Sequence[Sequence[str]],
             market_doc: Optional[Dict[str, Any]] = None,
             asker: Optional[TypeSafe.Asker] = None) -> Dict[str, Any]:
    """What every column of this file becomes, in the file's order, and what it says about the
    plan, matched against ``market_doc``'s when one is given. Reads; writes nothing.

    With an ``asker``, hosted TypeSafe settles the two questions the rules leave, sent only what
    ticket 01 allows; without one, this is the rules alone.
    """
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
    decisions = _classify(columns)
    # The organizer's own questions take their keys first: only theirs are ever stored, so a
    # "Notes" column left out must not push a question called "Notes" to ``notes_2``.
    taken_keys: Set[str] = set()
    order = sorted(range(len(columns)), key=lambda i: decisions[i]["fate"] != FATE_CUSTOM)
    fields = {i: _field(columns[i], taken_keys) if columns[i].filled else None for i in order}
    proposed = []
    for index, (column, decided) in enumerate(zip(columns, decisions)):
        field = fields[index]
        check = []
        if decided.get("leftOut") == LEFT_OUT_ORGANIZER:
            check.append(CHECK_ORGANIZER)
        if decided["fate"] == FATE_CUSTOM and field:
            if field["upload"]:
                check.append(CHECK_UPLOAD)
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

    plan = _plan(columns, decisions, market_doc)
    asked = _ask_typesafe(asker, columns, proposed, plan) if asker else False

    answered = {column["essential"] for column in proposed if column["essential"]}
    return {
        "rowCount": len(body),
        "responses": responses,
        "columns": proposed,
        "plan": plan,
        "typesafe": {"asked": asked},
        "notAsked": [
            {"key": key, "label": label, "why": "No column in your file answers it"}
            for key, label in EssentialFields.ESSENTIAL_QUESTIONS if key not in answered
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
    return proposal(headers, rows, market_doc, asker=TypeSafe.asker()), 200
