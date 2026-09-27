#!/usr/bin/env python3
"""Turn a real Google Forms response export into a committable fixture.

Why this exists: three MVP blockers found on 2026-09-14 came from the *shape* of a real export, not
from logic, and every CSV test in this suite used short single-line stems like
``"Which days can you attend?"``. That is why grid detection failing on a multi-line header survived
to production. A fixture invented by the same people who wrote the parser only tests what they
already thought of.

Why it is not the real file: the sources are hundreds of real applicants' names, emails, handles,
links to their documents, and what they wrote about themselves.

What is kept is decided by how many people share a value, never by what a column is called. That is
the privacy rule of the form-started-from-a-CSV map (``.scratch/wayfinding/the-form-started-from-a-
csv/issues/01``): the header row verbatim, and any value - or option inside a multi-select answer -
that at least 3 distinct applicants gave, counted by applicant email rather than by row, so one
applicant who submitted three times shares nothing. Everything else is invented in the same shape:
the same length, letter case, punctuation and digit count, an address for an email, a link for a
link. A list of header words is what let a column be missed before.

Blanks, row count and order, ``TEST`` rows, duplicate columns and trailing empty columns are kept as
they are. Every timestamp moves by one offset, derived from the source so it is not in this file.

Before writing anything it runs ``find_leaks``, which judges the output on its own terms: a source
value of 4 or more characters that fewer than 3 applicants wrote must not appear anywhere in it.
If one does, nothing is written and the column is named - the value never is.

Usage:
    python tests/fixtures/anonymise_form_export.py <real-export.csv> <output.csv>
"""
import bisect
import csv
import hashlib
import json
import re
import sys
from datetime import datetime, timedelta
from typing import Dict, Iterator, List, Optional, Set, Tuple

SHARED_BY = 3
LEAK_MIN_LENGTH = 4
GIVE_UP_AFTER = 200

# What a tester types into every box. It identifies nobody, and the import has to see such a row.
PLACEHOLDERS = frozenset({"test"})

EMAIL = re.compile(r"[^\s@,;<>()]+@[^\s@,;<>()]+\.[A-Za-z]{2,}")
URL = re.compile(r"(?:https?://|www\.)[^\s,;<>()]+", re.IGNORECASE)
HANDLE = re.compile(r"(?<![\w@])@[A-Za-z0-9_.]{2,}")
PHONE = re.compile(r"\+?\d[\d\s().-]{7,}\d")
TOKEN = re.compile(rf"(?P<email>{EMAIL.pattern})|(?P<url>{URL.pattern})|(?P<handle>{HANDLE.pattern})"
                   r"|(?P<digits>\d+)|(?P<word>[^\W\d_]+)", re.IGNORECASE)

TIMESTAMP_FORMATS = (
    # Google Sheets: unpadded month, day and hour - "9/27/2025 9:04:01".
    (re.compile(r"\d{1,2}/\d{1,2}/\d{4} \d{1,2}:\d{2}:\d{2}"), "%m/%d/%Y %H:%M:%S", False),
    (re.compile(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}"), "%Y-%m-%d %H:%M:%S", True),
)

WEEKDAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
            "mon", "tue", "wed", "thu", "fri", "sat", "sun")

CONSONANTS = "bdfgklmnprstvz"
VOWELS = "aeiou"


def split_options(value: str) -> List[str]:
    """Google Forms joins checkbox answers with ", ". An option can itself hold ", " - inside
    parentheses ("Woven (crochet, knitting, etc)") or after a weekday ("Monday, November 20")."""
    parts, depth, current = [], 0, []
    for piece in value.split(", "):
        current.append(piece)
        depth += piece.count("(") - piece.count(")")
        if depth > 0 or piece.strip().lower() in WEEKDAYS:
            continue
        parts.append(", ".join(current).strip())
        current = []
    if current:
        parts.append(", ".join(current).strip())
    return [part for part in parts if part]


def applicant_keys(rows: List[List[str]]) -> List[str]:
    """Who wrote each data row: its applicant's email when the export collects one, so that
    "shared by 3" counts people rather than submissions. Otherwise every row is its own person."""
    body = rows[1:]
    width = max((len(row) for row in rows), default=0)
    for column in range(width):
        cells = [row[column].strip() for row in body if column < len(row) and row[column].strip()]
        if cells and sum(1 for cell in cells if EMAIL.fullmatch(cell)) * 2 > len(cells):
            return [
                row[column].strip().lower()
                if column < len(row) and EMAIL.fullmatch(row[column].strip()) else f"row {index}"
                for index, row in enumerate(body)
            ]
    return [f"row {index}" for index in range(len(body))]


def _identifies_on_sight(value: str) -> bool:
    """A value holding contact details is never kept, however many people share it."""
    return bool(EMAIL.search(value) or URL.search(value) or HANDLE.search(value)
                or PHONE.search(value))


def _is_placeholder(value: str) -> bool:
    return value.strip().lower() in PLACEHOLDERS


def _cells(rows: List[List[str]]) -> Iterator[Tuple[int, int, str]]:
    for index, row in enumerate(rows[1:]):
        for column, cell in enumerate(row):
            if cell.strip():
                yield index, column, cell


# --- Deciding what is shared ---------------------------------------------------------------------


def _shared_values(rows: List[List[str]], keys: List[str]) -> Dict[int, Set[str]]:
    """Per column, the whole answers and the options that at least SHARED_BY applicants gave."""
    whole: Dict[Tuple[int, str], Set[str]] = {}
    options: Dict[Tuple[int, str], Set[str]] = {}
    for index, column, cell in _cells(rows):
        whole.setdefault((column, cell.strip()), set()).add(keys[index])
        for option in split_options(cell):
            options.setdefault((column, option), set()).add(keys[index])
    shared: Dict[int, Set[str]] = {}
    for counts in (whole, options):
        for (column, value), people in counts.items():
            if len(people) >= SHARED_BY and not _identifies_on_sight(value):
                shared.setdefault(column, set()).add(value)
    return shared


# --- Inventing a stand-in ------------------------------------------------------------------------


def _digest(*parts: object) -> int:
    return int(hashlib.sha256("\x1f".join(map(str, parts)).encode("utf-8")).hexdigest()[:16], 16)


class _Inventor:
    """Deterministic stand-ins that never equal anything the source holds.

    The same source value always becomes the same stand-in, ignoring case, so an applicant's email
    reads the same in the collected column, its duplicate and a partner's table-share answer.
    No two source values share a stand-in, so the count of distinct applicants survives.
    """

    def __init__(self, rows: List[List[str]]):
        self._source_values = {cell.strip().lower() for _, _, cell in _cells(rows)}
        self._source_words = {
            match.group(0).lower()
            for _, _, cell in _cells(rows) for match in TOKEN.finditer(cell)
        }
        self._memo: Dict[Tuple[str, str], str] = {}
        self._owner: Dict[str, str] = {}

    def value(self, source: str) -> str:
        return self._unique("value", source, lambda attempt: TOKEN.sub(
            lambda match: self._token(match, source, attempt), source))

    def _unique(self, kind: str, source: str, make) -> str:
        key = (kind, source.lower())
        if key in self._memo:
            # Same letters, the source's own case: "Juniper.Vale@..." is "juniper.vale@...".
            return _recase(self._memo[key], source) if kind == "value" else self._memo[key]
        attempt = 0
        while True:
            invented = make(attempt)
            lowered = invented.lower()
            owner = source.lower()
            if self._owner.get(lowered, owner) == owner and lowered not in self._source_values:
                break
            if attempt >= GIVE_UP_AFTER:
                # Only a very short value runs out: a lone "9" when every digit is an answer.
                break
            attempt += 1
        self._memo[key] = invented
        self._owner[lowered] = owner
        return invented

    def _token(self, match: re.Match, source: str, attempt: int) -> str:
        text = match.group(0)
        if match.group("email"):
            return self._email(text)
        if match.group("url"):
            return self._unique("url", text, lambda n: ("https://example.com/" if text.lower()
                                .startswith("http") else "www.example.com/")
                                + f"{_digest('url', text.lower(), n) % 10**6:06d}")
        if match.group("handle"):
            return "@" + self._word(text[1:].lower(), f"handle:{text.lower()}", attempt)
        if match.group("digits"):
            return self._digits(text, source, match.start(), attempt)
        return _recase(self._word(text.lower(), f"{source.lower()}:{match.start()}", attempt), text)

    def _email(self, text: str) -> str:
        local = text.split("@", 1)[0].lower()

        def make(attempt: int) -> str:
            invented = re.sub(r"[^\W\d_]+", lambda m: self._word(
                m.group(0), f"email:{text.lower()}:{m.start()}", attempt), local)
            invented = re.sub(r"\d", lambda m: str(_digest(text.lower(), m.start(), attempt) % 10),
                              invented)
            return f"{invented}@example.com"

        return self._unique("email", text, make)

    def _word(self, word: str, salt: str, attempt: int) -> str:
        """Pronounceable letters of the same length, never a word the source contains - short of
        LEAK_MIN_LENGTH, where there may be no such word left and none could leak."""
        while True:
            seed = _digest(salt, attempt)
            start = seed % 2
            letters = []
            for position in range(len(word)):
                pool = VOWELS if (position + start) % 2 else CONSONANTS
                seed = _digest(seed, position)
                letters.append(pool[seed % len(pool)])
            invented = "".join(letters)
            if len(invented) < LEAK_MIN_LENGTH or invented not in self._source_words:
                return invented
            attempt += 1_000

    def _digits(self, text: str, source: str, offset: int, attempt: int) -> str:
        while True:
            invented = "".join(str(_digest(source.lower(), offset, attempt, i) % 10)
                               for i in range(len(text)))
            if len(invented) < LEAK_MIN_LENGTH or invented not in self._source_words:
                return invented
            attempt += 1_000


def _recase(invented: str, like: str) -> str:
    """Give ``invented`` the letter case of ``like``, character by character where they line up."""
    if len(invented) != len(like):
        return invented
    return "".join(c.upper() if o.isupper() else c for c, o in zip(invented, like))


# --- Timestamps ----------------------------------------------------------------------------------


def _timestamp_format(value: str) -> Optional[Tuple[str, bool]]:
    for pattern, fmt, padded in TIMESTAMP_FORMATS:
        if pattern.fullmatch(value.strip()):
            return fmt, padded
    return None


def _format_timestamp(moment: datetime, fmt: str, padded: bool) -> str:
    if padded:
        return moment.strftime(fmt)
    return (f"{moment.month}/{moment.day}/{moment.year} "
            f"{moment.hour}:{moment.minute:02d}:{moment.second:02d}")


def _shift(value: str, offset: timedelta) -> str:
    fmt, padded = _timestamp_format(value)
    return _format_timestamp(datetime.strptime(value.strip(), fmt) + offset, fmt, padded)


def _timestamp_offset(rows: List[List[str]]) -> timedelta:
    """One offset for the whole file, between one and six hours, derived from the source so it is
    not published here, and moved on until no shifted timestamp lands on a real one."""
    stamps = {cell.strip() for _, _, cell in _cells(rows) if _timestamp_format(cell)}
    seconds = 3600 + _digest(json.dumps(rows)) % (5 * 3600)
    while True:
        offset = timedelta(seconds=seconds)
        if not any(_shift(stamp, offset) in stamps for stamp in stamps):
            return offset
        seconds += 1


# --- The whole file ------------------------------------------------------------------------------


class LeakRefused(Exception):
    def __init__(self, columns: List[str]):
        super().__init__("refusing to write: a value fewer than 3 applicants gave appears in "
                         + ", ".join(repr(column) for column in columns))
        self.columns = columns


def anonymise(rows: List[List[str]]) -> List[List[str]]:
    keys = applicant_keys(rows)
    shared = _shared_values(rows, keys)
    inventor = _Inventor(rows)
    offset = _timestamp_offset(rows)

    def stand_in(column: int, cell: str) -> str:
        if not cell.strip() or _is_placeholder(cell):
            return cell
        if _timestamp_format(cell):
            return _shift(cell, offset)
        kept = shared.get(column, set())
        if cell.strip() in kept:
            return cell
        return ", ".join(option if option in kept else inventor.value(option)
                         for option in split_options(cell))

    out = [list(rows[0])]  # verbatim, newlines and duplicate headers included
    for row in rows[1:]:
        out.append([stand_in(column, cell) for column, cell in enumerate(row)])
    leaks = find_leaks(rows, out)
    if leaks:
        raise LeakRefused(leaks)
    return out


# --- The check -----------------------------------------------------------------------------------


def _occurrences(text: str, needle: str) -> Iterator[int]:
    """Where ``needle`` appears in ``text`` as a whole run: not inside a longer word or number."""
    start = text.find(needle)
    while start != -1:
        end = start + len(needle)
        before = text[start - 1] if start else " "
        after = text[end] if end < len(text) else " "
        if not (before.isalnum() or before == "_") or not needle[0].isalnum():
            if not (after.isalnum() or after == "_") or not needle[-1].isalnum():
                yield start
        start = text.find(needle, start + 1)


class _Haystack:
    """Data cells joined into one lower-cased text, remembering where each cell starts."""

    def __init__(self, rows: List[List[str]]):
        self.starts: List[int] = []
        self.cells: List[Tuple[int, int]] = []
        pieces, position = [], 0
        for index, column, cell in _cells(rows):
            self.starts.append(position)
            self.cells.append((index, column))
            pieces.append(cell.lower())
            position += len(cell) + 1
        self.text = "\n".join(pieces)

    def cells_holding(self, needle: str) -> Iterator[Tuple[int, int]]:
        for position in _occurrences(self.text, needle):
            yield self.cells[bisect.bisect_right(self.starts, position) - 1]


def find_leaks(source: List[List[str]], output: List[List[str]]) -> List[str]:
    """The headers of the output columns holding a source value of LEAK_MIN_LENGTH or more
    characters that fewer than SHARED_BY applicants wrote. The header row is the organizer's and is
    copied on purpose, so only answers are searched. A rare value found inside answers enough
    people gave ("Full" inside "Full table") says nothing about anyone, so it is not rare."""
    keys = applicant_keys(source)
    candidates: Dict[str, Set[str]] = {}
    for index, _, cell in _cells(source):
        for value in split_options(cell):
            if len(value) >= LEAK_MIN_LENGTH and not _is_placeholder(value):
                candidates.setdefault(value.lower(), set()).add(keys[index])

    haystack = _Haystack(source)
    rare = [
        value for value, people in candidates.items()
        if len(people) < SHARED_BY
        and len({keys[index] for index, _ in haystack.cells_holding(value)}) < SHARED_BY
    ]

    produced = _Haystack(output)
    header = output[0] if output else []
    columns = sorted({column for value in rare for _, column in produced.cells_holding(value)})
    return [header[column] if column < len(header) and header[column].strip()
            else f"column {column + 1}" for column in columns]


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    source, destination = sys.argv[1], sys.argv[2]
    with open(source, newline="", encoding="utf-8") as handle:
        rows = list(csv.reader(handle))
    try:
        anonymised = anonymise(rows)
    except LeakRefused as refusal:
        print(refusal, file=sys.stderr)
        return 1
    with open(destination, "w", newline="", encoding="utf-8") as handle:
        csv.writer(handle).writerows(anonymised)
    print(f"{len(rows) - 1} rows anonymised -> {destination}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
