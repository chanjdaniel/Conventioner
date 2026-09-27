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
the privacy rule of the form-started-from-a-CSV map, ticket 01:
``.scratch/wayfinding/the-form-started-from-a-csv/issues/01-what-hosted-jev-may-be-sent.md``.
The header row stays verbatim, and any value - or option inside a multi-select answer -
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
import csv
import hashlib
import json
import re
import sys
from datetime import datetime, timedelta
from typing import Callable, Dict, Iterator, List, NamedTuple, Optional, Set, Tuple

SHARED_BY = 3
LEAK_MIN_LENGTH = 4
GIVE_UP_AFTER = 200

# What a tester types into every box. It identifies nobody, and the import has to see such a row.
PLACEHOLDERS = frozenset({"test"})

EMAIL = re.compile(r"[^\s@,;<>()]+@[^\s@,;<>()]+\.[A-Za-z]{2,}")
URL = re.compile(r"(?:https?://|www\.)[^\s,;<>()]+", re.IGNORECASE)
URL_DELIMITERS_PATTERN = r"[/?=&#.:]+"
HANDLE = re.compile(r"(?<![\w@])@[A-Za-z0-9_.]{2,}")
PHONE = re.compile(r"\+?\d[\d\s().-]{7,}\d")
TOKEN = re.compile(rf"(?P<email>{EMAIL.pattern})|(?P<url>{URL.pattern})|(?P<handle>{HANDLE.pattern})"
                   r"|(?P<digits>\d+)|(?P<word>[^\W\d_]+)", re.IGNORECASE)



class _TimestampFormat(NamedTuple):
    shape: "re.Pattern[str]"
    read: str
    write: Callable[[datetime], str]


TIMESTAMP_FORMATS = (
    # Google Sheets: unpadded month, day and hour - "9/27/2025 9:04:01".
    _TimestampFormat(
        re.compile(r"\d{1,2}/\d{1,2}/\d{4} \d{1,2}:\d{2}:\d{2}"), "%m/%d/%Y %H:%M:%S",
        lambda m: f"{m.month}/{m.day}/{m.year} {m.hour}:{m.minute:02d}:{m.second:02d}"),
    _TimestampFormat(
        re.compile(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}"), "%Y-%m-%d %H:%M:%S",
        lambda m: m.strftime("%Y-%m-%d %H:%M:%S")),
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


class NoApplicantEmails(Exception):
    def __init__(self):
        super().__init__("refusing to write: no column holds the applicants' emails, so there is no "
                         "telling one applicant's submissions from several applicants")


def applicant_keys(rows: List[List[str]]) -> List[str]:
    """Who wrote each data row: its applicant's email, so that "shared by 3" counts people rather
    than submissions. A row with no email there (a TEST row) is its own person. An export that
    collects no email is refused, since counting rows would let one person's answer through."""
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
    raise NoApplicantEmails()


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

    def __init__(self, rows: List[List[str]], key: int, keys: List[str]):
        # Every stand-in is keyed on the whole source, so hashing a guessed name or email
        # reproduces nothing without the file it came from.
        self._key = key
        self._source_values = {cell.strip().lower() for _, _, cell in _cells(rows)}
        self._source_words = {
            match.group(0).lower()
            for _, _, cell in _cells(rows) for match in TOKEN.finditer(cell)
        }
        self._shared_link_parts = _shared_link_parts(rows, keys)
        self._memo: Dict[Tuple[str, str], str] = {}
        self._owner: Dict[str, str] = {}

    def value(self, source: str) -> str:
        return self._unique("value", source, lambda attempt: TOKEN.sub(
            lambda match: self._token(match, source, attempt), source))

    def _unique(self, kind: str, source: str, make: Callable[[int], str]) -> str:
        key = (kind, source.lower())
        if key in self._memo:
            # Same letters in the source's own case, so "WREN OKAFOR" reads as "Wren Okafor" did.
            return _recase(self._memo[key], source)
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
            return self._unique("url", text, lambda n: self._link(text, n))
        if match.group("handle"):
            return "@" + self._word(text[1:].lower(), f"handle:{text.lower()}", attempt)
        if match.group("digits"):
            return self._digits(text, source, match.start(), attempt)
        return _recase(self._word(text.lower(), f"{source.lower()}:{match.start()}", attempt), text)

    def _link(self, text: str, attempt: int) -> str:
        """A link keeps its scheme and each part three applicants' links share - a Drive upload's
        host and path, a platform's domain - and invents the rest: the file id, someone's own site,
        their handle.
        """
        return "".join(
            part if not part or re.fullmatch(URL_DELIMITERS_PATTERN, part)
            or part.lower() in self._shared_link_parts or part.lower() in STAND_IN_WORDS
            else TOKEN.sub(lambda match: self._token(match, f"{text}#{index}", attempt), part)
            for index, part in enumerate(_link_parts(text))
        )

    def _email(self, text: str) -> str:
        local = text.split("@", 1)[0].lower()

        def make(attempt: int) -> str:
            invented = re.sub(r"[^\W\d_]+", lambda m: self._word(
                m.group(0), f"email:{text.lower()}:{m.start()}", attempt), local)
            invented = re.sub(r"\d", lambda m: str(self._hash(text.lower(), m.start(), attempt) % 10),
                              invented)
            return f"{invented}@example.com"

        return self._unique("email", text, make)

    def _word(self, word: str, salt: str, attempt: int) -> str:
        """Pronounceable letters of the same length, never a word the source contains."""
        while True:
            seed = self._hash(salt, attempt)
            start = seed % 2
            letters = []
            for position in range(len(word)):
                pool = VOWELS if (position + start) % 2 else CONSONANTS
                seed = self._hash(seed, position)
                letters.append(pool[seed % len(pool)])
            invented = "".join(letters)
            if self._unheard_of(invented):
                return invented
            attempt += 1_000

    def _digits(self, text: str, source: str, offset: int, attempt: int) -> str:
        while True:
            invented = "".join(str(self._hash(source.lower(), offset, attempt, i) % 10)
                               for i in range(len(text)))
            if self._unheard_of(invented):
                return invented
            attempt += 1_000

    def _hash(self, *parts: object) -> int:
        return _digest(self._key, *parts)

    def _unheard_of(self, invented: str) -> bool:
        """Not a word the source holds - or too short to leak, where there may be none left."""
        return len(invented) < LEAK_MIN_LENGTH or invented not in self._source_words


def _link_parts(url: str) -> List[str]:
    """A link split at its delimiters, the delimiters kept, so the parts join back into it."""
    return re.split(f"({URL_DELIMITERS_PATTERN})", url)


def _shared_link_parts(rows: List[List[str]], keys: List[str]) -> Set[str]:
    people: Dict[str, Set[str]] = {}
    for index, _, cell in _cells(rows):
        for match in URL.finditer(cell):
            for part in _link_parts(match.group(0)):
                if part and not re.fullmatch(URL_DELIMITERS_PATTERN, part):
                    people.setdefault(part.lower(), set()).add(keys[index])
    return {part for part, who in people.items() if len(who) >= SHARED_BY}


def _recase(invented: str, like: str) -> str:
    """Give ``invented`` the letter case of ``like``, character by character where they line up."""
    if len(invented) != len(like):
        return invented
    return "".join(c.upper() if o.isupper() else c for c, o in zip(invented, like))


# --- Timestamps ----------------------------------------------------------------------------------


def _timestamp_format(value: str) -> Optional[_TimestampFormat]:
    for candidate in TIMESTAMP_FORMATS:
        if candidate.shape.fullmatch(value.strip()):
            return candidate
    return None


def _shift(value: str, offset: timedelta) -> str:
    form = _timestamp_format(value)
    return form.write(datetime.strptime(value.strip(), form.read) + offset)


def _file_key(rows: List[List[str]]) -> int:
    return _digest(json.dumps(rows))


def _timestamp_offset(rows: List[List[str]]) -> timedelta:
    """One offset for the whole file, between one and six hours, derived from the source so it is
    not published here, and moved on until no shifted timestamp lands on a real one."""
    stamps = {cell.strip() for _, _, cell in _cells(rows) if _timestamp_format(cell)}
    seconds = 3600 + _digest("offset", _file_key(rows)) % (5 * 3600)
    while True:
        offset = timedelta(seconds=seconds)
        if not any(_shift(stamp, offset) in stamps for stamp in stamps):
            return offset
        seconds += 1


# --- The whole file ------------------------------------------------------------------------------


class LeakRefused(Exception):
    def __init__(self, columns: List[str]):
        super().__init__(f"refusing to write: a value fewer than {SHARED_BY} applicants gave "
                         "appears in " + ", ".join(columns))
        self.columns = columns


def anonymise(rows: List[List[str]]) -> List[List[str]]:
    keys = applicant_keys(rows)
    shared = _shared_values(rows, keys)
    inventor = _Inventor(rows, _file_key(rows), keys)
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


# The fixed parts of a stand-in link or address, which no applicant wrote.
STAND_IN_WORDS = frozenset({"example", "http", "https", "www"})


def _column_label(header: List[str], column: int) -> str:
    """By number and header, since a form export repeats headers ("Email Address" twice)."""
    text = " ".join(header[column].split()) if column < len(header) else ""
    return f'column {column + 1} "{text[:60]}"' if text else f"column {column + 1}"


def find_leaks(source: List[List[str]], output: List[List[str]]) -> List[str]:
    """The output columns holding something fewer than SHARED_BY applicants wrote and at least
    LEAK_MIN_LENGTH characters long: an answer or option, or a single word or number inside one,
    so a surname in a comment counts. Judged on its own terms, not on how stand-ins were made.

    Only answers are searched: the header row is the organizer's and is copied on purpose. An
    output option that is, in its own column, an answer SHARED_BY applicants gave is passed over
    whole - "Full table" may hold one applicant's "Full" and says nothing about them.
    """
    keys = applicant_keys(source)
    options: Dict[Tuple[int, str], Set[str]] = {}
    tokens: Dict[str, Set[str]] = {}
    for index, column, cell in _cells(source):
        for option in split_options(cell):
            options.setdefault((column, option.lower()), set()).add(keys[index])
        for match in TOKEN.finditer(cell):
            tokens.setdefault(match.group(0).lower(), set()).add(keys[index])
        # A link's parts are counted too, as the anonymiser keeps them: "drive" is one applicant's
        # word in a comment and everyone's inside an upload link.
        for match in URL.finditer(cell):
            for part in _link_parts(match.group(0)):
                tokens.setdefault(part.lower(), set()).add(keys[index])

    shared = {found for found, people in options.items() if len(people) >= SHARED_BY}
    # A whole answer one applicant gave is still no secret when it is a word three applicants
    # wrote: "Etsy" alone as an answer, and inside every Etsy shop link.
    rare = {value for (_, value), people in options.items()
            if len(people) < SHARED_BY and len(tokens.get(value, ())) < SHARED_BY}
    rare |= {token for token, people in tokens.items()
             if len(people) < SHARED_BY and token not in STAND_IN_WORDS}
    rare = {value for value in rare
            if len(value) >= LEAK_MIN_LENGTH and not _is_placeholder(value)}

    searched: Dict[int, List[str]] = {}
    leaking: Set[int] = set()
    for _, column, cell in _cells(output):
        for option in split_options(cell):
            if (column, option.lower()) in shared or _is_placeholder(option):
                continue
            if _timestamp_format(option):
                # Judged whole: its year is every applicant's, and only the whole moment is theirs.
                if option.lower() in rare:
                    leaking.add(column)
                continue
            searched.setdefault(column, []).append(option.lower())

    for column, answers in searched.items():
        text = "\n".join(answers)
        if any(next(_occurrences(text, value), None) is not None for value in rare):
            leaking.add(column)
    header = output[0] if output else []
    return [_column_label(header, column) for column in sorted(leaking)]


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    source, destination = sys.argv[1], sys.argv[2]
    with open(source, newline="", encoding="utf-8") as handle:
        rows = list(csv.reader(handle))
    try:
        anonymised = anonymise(rows)
    except (LeakRefused, NoApplicantEmails) as refusal:
        print(refusal, file=sys.stderr)
        return 1
    with open(destination, "w", newline="", encoding="utf-8") as handle:
        csv.writer(handle).writerows(anonymised)
    print(f"{len(rows) - 1} rows anonymised -> {destination}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
