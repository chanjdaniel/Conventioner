#!/usr/bin/env python3
"""Refuse a real person's contact details, or a listed real name, in what is about to leave this
machine.

    python scripts/real_data_check.py staged
    python scripts/real_data_check.py commits REV... [--not REV...]
    python scripts/real_data_check.py pre-push REMOTE [URL] < refs
    python scripts/real_data_check.py tree [REV]
    python scripts/real_data_check.py add-term < names

`staged` reads what `git commit` would record (the pre-commit hook); `commits` reads each commit a
rev-list range names, its message too (the gate and CI); `pre-push` reads the commits a push sends,
from the refs git gives the pre-push hook on its stdin; these judge only added lines. `tree` reads
every line of every file a revision's tree holds (HEAD by default), so a name listed since a file
was committed is found wherever it still stands (the gate and CI). Each refuses an email address
outside the fixture domains, a phone number shaped like a real one, a MongoDB Atlas host other than
a placeholder, and, where `.scratch/examples/` holds real exports, an exact email, phone or
applicant's name from them, and words copied from their questions: a run of eight of a header
cell's words in order, or a link or social handle a header holds. Conventioner is public, so a
pushed branch is public the moment it lands: this runs before anything leaves the PC.

A line or message may not name a real organization, market, place or group whose name is listed,
as a SHA-256 hash, in `scripts/real_data_terms.txt`, outside the files where the real market may be
named (the README, the changelog, `docs/records/` and the list), which may also quote the exports'
questions. `add-term` lists a name from standard input, one per line, and prints only how many the
list holds; it lists none, and exits 1, when a line is empty, listed already or longer than the six
words a name is matched by.

A spreadsheet is read for its text, whatever git makes of it: an Excel or OpenDocument workbook's
cells and shared strings, a CSV or TSV in UTF-8, UTF-16 or Windows-1252 with any common delimiter,
and each of these inside a `.zip` (Google Forms' download). A spreadsheet or archive this check
cannot read (`.xls`, `.xlsb`, `.numbers`, `.et`, `.sxc`, `.gz`, `.7z` and the like) is refused
outright outside the test fixtures. A finding names the file and line, or the sheet's cell, never
the value in full; the exports are read into memory only, and nothing derived from them is written
or printed, though a file there it read nothing from is counted, by kind, on stderr. Exits 1 on a
finding, 2 when git fails. Standard library only, Python 3.8+.
"""

import codecs
import csv
import hashlib
import io
import re
import subprocess
import sys
import unicodedata
import zipfile
import zlib
from pathlib import Path
from xml.etree import ElementTree

# ── What a fixture may use ───────────────────────────────────────────────────

# Reserved for documentation and tests (RFC 2606, RFC 6761), with their subdomains.
FIXTURE_PARENT_DOMAINS = ("example.com", "example.org", "example.net")
FIXTURE_TLDS = (".test", ".example", ".invalid", ".localhost")
# Services' own addresses, never a person's inbox: the project's sender, Resend's test sender, the
# placeholder MongoDB host, and commit trailers'. A fixture uses the reserved names above instead.
FIXTURE_DOMAINS = frozenset({
    "conventioner.io", "resend.dev", "cluster.mongodb.net",
    "anthropic.com", "github.com", "users.noreply.github.com",
})
# The fictional phone numbers: 555-0100 to 555-0199, reserved for fiction in every area code. The
# rest of the 555 exchange can be assigned, so it is judged like any other number.
FIXTURE_EXCHANGE, FIXTURE_LINE_PREFIX = "555", "01"

# Generated files that quote package authors' addresses and hashes, never anyone's details.
UNREAD_FILES = ("package-lock.json",)

# Spreadsheets, which is what an export is: read for their text, or refused when they cannot be.
TEXT_SHEETS = (".csv", ".tsv")
ZIPPED_SHEETS = (".xlsx", ".xlsm", ".ods")
OPAQUE_SHEETS = (".xls", ".xlsb", ".numbers", ".et", ".sxc")
# A zip is read for the spreadsheets inside it; the other archives cannot be, so are refused.
ARCHIVES = (".zip",)
OPAQUE_ARCHIVES = (".gz", ".tgz", ".bz2", ".xz", ".zst", ".7z", ".rar", ".tar")
SHEETS_AND_ARCHIVES = TEXT_SHEETS + ZIPPED_SHEETS + OPAQUE_SHEETS + ARCHIVES + OPAQUE_ARCHIVES
# A text sheet's first record is split on each; the one that gives the most columns is its own.
DELIMITERS = (",", ";", "\t", "|")
# Where a spreadsheet or archive this check cannot read may still be committed: the tests' inputs.
FIXTURE_FOLDERS = ("back-end/tests/test_data/", "back-end/tests/fixtures/")

# ── Shapes ───────────────────────────────────────────────────────────────────

EMAIL = re.compile(r"(?<![\w.%+'-])[A-Za-z0-9._%+'-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,24})(?![A-Za-z0-9-])")
# Asset and source names that read like an address: logo@2x.png. Every extension kept here is not
# a delegated TLD; check IANA's root-zone list before one is added.
NOT_A_DOMAIN = re.compile(
    r"(?i)\.(?:png|jpe?g|gif|svg|webp|ico|js|mjs|cjs|ts|vue|css|scss|json|html|lock|txt)$"
)
# North American, with separators: (604) 555-0123, 604-555-0123, +1 604 555 0123, 604.555.0123.
PHONE = re.compile(
    r"(?<![\w.#/+-])(?:\+?1[ .-]?)?(?:\(([2-9]\d\d)\)|([2-9]\d\d))[ .-]?([2-9]\d\d)[ .-](\d{4})(?![\w.])"
)
# An Atlas cluster's host, <cluster>.<id>.mongodb.net: its id names the production database. A
# placeholder's id is `example`, or it is the template's cluster.mongodb.net, a fixture domain.
ATLAS_HOST = re.compile(r"(?i)(?<![\w.-])(?:[a-z0-9-]+\.)*?([a-z0-9-]+)\.mongodb\.net(?![\w-])")
ATLAS_PLACEHOLDER_ID = "example"
# Any run that may spell a phone number, however it is punctuated: only compared with the exports.
DIGIT_RUN = re.compile(r"(?<![\w.])\+?\d[\d ().-]{8,}\d(?![\w.])")
WORD = re.compile(r"[^\W\d_]+(?:['’.-][^\W\d_]+)*")
# A word of a real name: a run of letters, so a name matches however it is cased, spaced or
# punctuated (a handle's dots, a slug's hyphens, a possessive), but never inside a longer word.
LETTERS = re.compile(r"[^\W\d_]+")

# ── The real exports ─────────────────────────────────────────────────────────

PERSON_NAME = re.compile(r"(?i)\bname\b")
NOT_A_PERSON = re.compile(
    r"(?i)\b(?:business|brand|shop|store|company|booth|studio|organi[sz]ation|user ?name|handle)\b"
)
FIRST_NAME = re.compile(r"(?i)\bfirst\b.*\bname\b")
LAST_NAME = re.compile(r"(?i)\b(?:last|sur|family)\b.*\bname\b|\bsurname\b")
# A name that this many applicants gave identifies none of them ("Not Applicable").
SHARED_BY = 3
# A run this long of a question's words is copied wording, not a phrase any form might use.
QUESTION_RUN = 8
# A link or a social handle in a question's text: the organizer's own pages and accounts.
LINK = re.compile(r"(?i)\b(?:https?://|www\.)[^\s<>\"'()\[\]{}]+")
HANDLE = re.compile(r"(?<![\w.@/])@[A-Za-z0-9_](?:[A-Za-z0-9_.]*[A-Za-z0-9_])?")


class RealValues:
    """The exact emails, phones and applicants' names of the exports, and the word runs, links and
    handles of their header rows, held in memory only."""

    def __init__(self):
        self.emails = set()
        self.phones = set()
        self.names = set()
        self.question_runs = set()
        self.links = set()
        self.handles = set()
        self.marks = None  # one pattern for every link and handle, once all are read

    def __bool__(self):
        return bool(self.emails or self.phones or self.names or self.question_runs or self.marks)

    @classmethod
    def read(cls, folders):
        values = cls()
        givers = {}
        unread = []
        for folder in folders:
            for path in sorted(folder.rglob("*")) if folder.is_dir() else ():
                if path.is_file() and not path.name.startswith(".") and not values._read(
                    path.name, path.read_bytes(), givers
                ):
                    unread.append(path.suffix.lower() or "no extension")
        values.names = {name for name, people in givers.items() if len(people) < SHARED_BY}
        values.marks = marks_pattern(values.links, values.handles)
        if unread:
            # By kind only: a file's name may be an applicant's.
            print(
                f"real-data-check: read nothing from {len(unread)} file{'s' if len(unread) > 1 else ''} "
                f"in .scratch/examples/ ({', '.join(sorted(set(unread)))}), so no value of theirs is "
                "checked: an export is read as .csv, .tsv, .xlsx, .xlsm or .ods, or a .zip of them",
                file=sys.stderr,
            )
        return values

    def _read(self, name, data, givers, depth=0):
        """Whether the file gave anything: rows of a sheet, or an opaque export's addresses."""
        lower = name.lower()
        if lower.endswith(ARCHIVES):
            members = zip_members(data) if depth < MAX_DEPTH else None
            return bool(members) and any(
                [self._read(member, content, givers, depth + 1) for member, content in members]
            )
        if lower.endswith(OPAQUE_SHEETS):
            return self._add_opaque(data)
        try:
            sheets, _ = tables(name, data)
        except Unreadable:
            return False
        read = False
        for _, rows in sheets:
            if rows:
                self._add_export(rows, givers)
                read = True
        return read

    def _add_opaque(self, data):
        """An export in a format with no reader here: its addresses and numbers, from its bytes."""
        found = False
        for text in (data.decode("latin-1"), data.decode("utf-16-le", "replace")):
            emails = {match.group(0).lower() for match in EMAIL.finditer(text)}
            phones = phone_numbers(text)
            self.emails |= emails
            self.phones |= phones
            found = found or bool(emails or phones)
        return found

    def _add_export(self, rows, givers):
        header = rows[0]
        for cell in header:
            self._add_question(cell)
        name_columns = [
            i for i, h in enumerate(header) if PERSON_NAME.search(h) and not NOT_A_PERSON.search(h)
        ]
        first = [i for i in name_columns if FIRST_NAME.search(header[i])]
        last = [i for i in name_columns if LAST_NAME.search(header[i])]
        for row in rows[1:]:
            emails = {match.group(0).lower() for cell in row for match in EMAIL.finditer(cell)}
            self.emails |= emails
            for cell in row:
                self.phones |= phone_numbers(cell)
            if not emails:
                continue  # a name counts only beside an email: an applicant's, not a TEST row's
            cells = [row[i] for i in name_columns if i < len(row)]
            if first and last and max(first + last) < len(row):
                cells.append(f"{row[first[0]]} {row[last[0]]}")
            for cell in cells:
                name = tuple(word.lower() for word in WORD.findall(cell))
                if 2 <= len(name) <= 5 and len(" ".join(name)) >= 5:
                    givers.setdefault(name, set()).add(min(emails))

    def _add_question(self, cell):
        """A header cell's links and handles, and every run of QUESTION_RUN words of the text
        between them: a link's words are no part of the question's."""
        self.links |= {body for body in map(link_body, LINK.findall(cell)) if body}
        self.handles |= {handle[1:].lower() for handle in HANDLE.findall(cell)}
        for text in re.split(f"{LINK.pattern}|{HANDLE.pattern}", cell):
            words = term_words(text)
            self.question_runs |= {
                tuple(words[start:start + QUESTION_RUN]) for start in range(len(words) - QUESTION_RUN + 1)
            }


def link_body(link):
    """A link without its scheme, `www.`, query, fragment, trailing slash or the punctuation of the
    sentence it ends, lower-cased: what any spelling of the same page holds."""
    body = re.sub(r"(?i)^(?:https?://)?(?:www\.)?", "", link.rstrip(".,;:!?"))
    return re.split(r"[?#]", body, maxsplit=1)[0].rstrip("/").lower()


def marks_pattern(links, handles):
    """One pattern for a line holding any of the links, at a link's bounds, or any of the handles,
    written with its @ or as a link's path; None when there are none."""
    parts = [rf"(?<![\w.-])(?:www\.)?{re.escape(body)}(?![\w-])" for body in sorted(links)]
    parts += [rf"(?:(?<![\w.@/])@|\.[a-z]{{2,}}/@?){re.escape(handle)}(?!\w|\.\w)" for handle in sorted(handles)]
    return re.compile("|".join(parts), re.IGNORECASE) if parts else None


def copies_a_question(line, real):
    """Whether a line holds a link or handle of a real export's header, or QUESTION_RUN words of its
    questions in their order, however the line cases or punctuates them."""
    if real.marks and real.marks.search(line):
        return True
    if not real.question_runs:
        return False
    words = term_words(line)
    return any(
        tuple(words[start:start + QUESTION_RUN]) in real.question_runs
        for start in range(len(words) - QUESTION_RUN + 1)
    )


def phone_numbers(text):
    """Every ten-digit North American number the text spells, however punctuated."""
    numbers = set()
    for match in DIGIT_RUN.finditer(text):
        digits = re.sub(r"\D", "", match.group(0))
        if len(digits) == 11 and digits.startswith("1"):
            digits = digits[1:]
        if len(digits) == 10 and digits[0] in "23456789" and digits[3] in "23456789":
            numbers.add(digits)
    return numbers


# ── The real names ───────────────────────────────────────────────────────────

# The SHA-256 of each real name no test data may hold. Hashing keeps the list from reading as a
# directory of them; it hides nothing from anyone who guesses a short name.
TERMS = Path(__file__).with_name("real_data_terms.txt")
TERMS_PATH = "scripts/real_data_terms.txt"
# Where the real market may be named: the README's account of the market the product first
# serves, the changelog release-please writes, the records of real usage runs, and the list.
NAMES_ALLOWED_IN = ("README.md", "CHANGELOG.md", TERMS_PATH)
NAMES_ALLOWED_UNDER = ("docs/records/",)
MAX_TERM_WORDS = 6


def term_words(text):
    return LETTERS.findall(unicodedata.normalize("NFKC", text).lower())


def term_hash(words):
    return hashlib.sha256(" ".join(words).encode("utf-8")).hexdigest()


def read_terms(path=TERMS):
    """The listed hashes: every line but a blank or a `#` comment."""
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except FileNotFoundError:
        return frozenset()
    return frozenset(line.strip() for line in lines if line.strip() and not line.startswith("#"))


def names_a_term(line, terms):
    words = term_words(line)
    return any(
        term_hash(words[start:start + size]) in terms
        for size in range(1, MAX_TERM_WORDS + 1)
        for start in range(len(words) - size + 1)
    )


def may_name_the_market(path):
    """Whether a file may name the real market; a commit message (no path) never may."""
    return path is not None and (path in NAMES_ALLOWED_IN or path.startswith(NAMES_ALLOWED_UNDER))


def add_terms(text, path=TERMS):
    """List each line of `text` by its hash, or none of them, saying why by line number only."""
    listed = set(read_terms(path))
    lines = text.splitlines()
    if not lines:
        print("real-data-check: no name on standard input", file=sys.stderr)
        return 1
    new, refused = [], []
    for number, line in enumerate(lines, 1):
        words = term_words(line)
        digest = term_hash(words)
        if not words:
            refused.append(f"line {number} has no words")
        elif len(words) > MAX_TERM_WORDS:
            refused.append(f"line {number} has more than {MAX_TERM_WORDS} words, so it could never match")
        elif digest in listed:
            refused.append(f"line {number} is listed already")
        else:
            listed.add(digest)
            new.append(digest)
    if refused:
        print("\n".join(f"real-data-check: {why}; nothing was listed" for why in refused), file=sys.stderr)
        return 1
    with path.open("a", encoding="utf-8") as terms:
        terms.write("".join(f"{digest}\n" for digest in new))
    count = len(listed)
    print(f"real-data-check: the list holds {count} name{'' if count == 1 else 's'}")
    return 0


# ── Spreadsheets ─────────────────────────────────────────────────────────────

# Far beyond any export, and short of what a zip bomb unpacks to.
MAX_UNZIPPED = 256 * 1024 * 1024
MAX_COLUMNS = 16384
MAX_DEPTH = 3
OPENDOCUMENT_TABLE = "{urn:oasis:names:tc:opendocument:xmlns:table:1.0}"


class Unreadable(Exception):
    pass


def tables(name, data):
    """The sheets a spreadsheet holds, as (title, rows of cell text), and any text it holds outside
    them (a workbook's shared strings no cell refers to). Raises Unreadable."""
    lower = name.lower()
    if lower.endswith(TEXT_SHEETS):
        text = decoded(data)
        split = "\t" if lower.endswith(".tsv") else delimiter(text)
        rows = csv.reader(io.StringIO(text, newline=""), delimiter=split)
        return [("", list(rows))], []
    if not lower.endswith(ZIPPED_SHEETS):
        raise Unreadable(name)
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as book:
            if sum(entry.file_size for entry in book.infolist()) > MAX_UNZIPPED:
                raise Unreadable(name)
            return (opendocument_tables(book), []) if lower.endswith(".ods") else workbook_tables(book)
    except (
        zipfile.BadZipFile, ElementTree.ParseError, KeyError, ValueError, IndexError, EOFError,
        NotImplementedError, RuntimeError, zlib.error,
    ) as error:
        raise Unreadable(name) from error


def text_of(data):
    """Bytes as text: UTF-8, else Windows-1252, which legacy Excel saves a CSV in. Decoding that as
    UTF-8 would split an accented name in two at the letter it could not read."""
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return data.decode("cp1252", "replace")


def decoded(data):
    """A text file's text: UTF-8, Windows-1252, or, as Excel saves "Unicode text", UTF-16 with or
    without its BOM."""
    if data.startswith((codecs.BOM_UTF16_LE, codecs.BOM_UTF16_BE)):
        return data.decode("utf-16", "replace")
    if b"\0" in data[:4096]:
        little = data[1::2].count(0) > data[0::2].count(0)
        return data.decode("utf-16-le" if little else "utf-16-be", "replace")
    return text_of(data[len(codecs.BOM_UTF8):] if data.startswith(codecs.BOM_UTF8) else data)


def delimiter(text):
    """The delimiter that splits the first record into the most columns: a European-locale Excel
    saves a "CSV" with semicolons. A tie keeps the comma."""
    def width(candidate):
        try:
            return len(next(csv.reader(io.StringIO(text[:65536], newline=""), delimiter=candidate), []))
        except csv.Error:
            return 0

    return max(DELIMITERS, key=width)


def zip_members(data):
    """(name, bytes) of each file a zip holds, or None when it cannot be read."""
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            entries = [entry for entry in archive.infolist() if not entry.is_dir()]
            if sum(entry.file_size for entry in entries) > MAX_UNZIPPED:
                return None
            return [(entry.filename, archive.read(entry)) for entry in entries]
    except (zipfile.BadZipFile, ValueError, EOFError, NotImplementedError, RuntimeError, zlib.error):
        return None


def tag(element):
    return element.tag.rsplit("}", 1)[-1]


def shared_text(item):
    """An Excel string's text: its runs, without the phonetic guide some locales add."""
    parts = []
    for child in item:
        if tag(child) == "t":
            parts.append(child.text or "")
        elif tag(child) == "r":
            parts.extend(t.text or "" for t in child if tag(t) == "t")
    return "".join(parts)


def column_index(ref, default):
    letters = re.match(r"[A-Z]*", ref or "").group(0)
    if not letters:
        return default
    index = 0
    for letter in letters:
        index = index * 26 + ord(letter) - 64
    return index - 1


def workbook_tables(book):
    """An Excel workbook's sheets, and the shared strings no cell refers to (still text it holds)."""
    names = book.namelist()
    shared = []
    if "xl/sharedStrings.xml" in names:
        shared = [shared_text(item) for item in ElementTree.fromstring(book.read("xl/sharedStrings.xml"))
                  if tag(item) == "si"]
    used = set()
    sheets = sorted(
        (int(match.group(1)), name) for name in names
        for match in [re.fullmatch(r"xl/worksheets/sheet(\d+)\.xml", name)] if match
    )
    found = []
    for number, name in sheets:
        rows = []
        for row in ElementTree.fromstring(book.read(name)).iter():
            if tag(row) != "row":
                continue
            cells = []
            for cell in row:
                if tag(cell) != "c":
                    continue
                kind = cell.get("t")
                value = next((child.text or "" for child in cell if tag(child) == "v"), "")
                if kind == "s":
                    used.add(int(value))
                    text = shared[int(value)]
                elif kind == "inlineStr":
                    text = "".join(shared_text(child) for child in cell if tag(child) == "is")
                else:
                    text = value
                index = min(column_index(cell.get("r"), len(cells)), MAX_COLUMNS)
                cells.extend([""] * (index - len(cells)))
                cells[index:index + 1] = [text]
            rows.append(cells)
        found.append((f"sheet {number}", rows))
    loose = [(f"shared string {index + 1}", text) for index, text in enumerate(shared) if index not in used]
    return found, loose


def opendocument_tables(book):
    found = []
    for table in ElementTree.fromstring(book.read("content.xml")).iter():
        if tag(table) != "table":
            continue
        rows = []
        for row in table.iter():
            if tag(row) != "table-row":
                continue
            cells = []
            for cell in row:
                if tag(cell) not in ("table-cell", "covered-table-cell"):
                    continue
                text = "\n".join("".join(p.itertext()) for p in cell.iter() if tag(p) == "p")
                repeat = int(cell.get(OPENDOCUMENT_TABLE + "number-columns-repeated", "1"))
                cells.extend([text] * max(0, min(repeat, MAX_COLUMNS - len(cells))))
            while cells and not cells[-1]:
                cells.pop()
            rows.append(cells)
        found.append((table.get(OPENDOCUMENT_TABLE + "name") or f"table {len(found) + 1}", rows))
    return found


class Refusal(str):
    """A finding about a whole file, in place of a line's text."""


def refusal(path, what):
    """A Refusal of a file this check cannot read, or nothing for one under the test fixtures."""
    if not path.lower().startswith(FIXTURE_FOLDERS):
        kind = path[path.rfind("."):]
        yield path, Refusal(
            f"{what} this check cannot read ({kind}): save it as .xlsx, .ods or .csv, or a .zip of "
            "them, for the check to read, or keep it out of git"
        )


def spreadsheet_lines(path, data, depth=0):
    """(where, text) of the text a spreadsheet or zip git reads as binary holds, or a Refusal."""
    lower = path.lower()
    if lower.endswith(ARCHIVES):
        members = zip_members(data) if depth < MAX_DEPTH else None
        if members is None:
            yield from refusal(path, "an archive")
        for member, content in members or ():
            yield from spreadsheet_lines(f"{path} > {member}", content, depth + 1)
        return
    if lower.endswith(OPAQUE_ARCHIVES):
        yield from refusal(path, "an archive")
        return
    if lower.endswith(TEXT_SHEETS):
        for number, text in enumerate(decoded(data).splitlines(), 1):
            yield f"{path}:{number}", text
        return
    if not lower.endswith(ZIPPED_SHEETS + OPAQUE_SHEETS):
        return  # an image, a font: no export
    try:
        sheets, loose = tables(path, data)
    except Unreadable:
        yield from refusal(path, "a spreadsheet")
        return
    for title, rows in sheets:
        for r, row in enumerate(rows, 1):
            for c, text in enumerate(row, 1):
                for number, line in enumerate(text.split("\n")):
                    where = f"{title}, row {r}, column {c}" + (f", line {number + 1}" if number else "")
                    yield f"{path} [{where}]", line
    for where, text in loose:
        yield f"{path} [{where}]", text


# ── Judging one line ─────────────────────────────────────────────────────────


def is_fixture_domain(domain):
    domain = domain.lower()
    return (
        domain in FIXTURE_DOMAINS
        or domain in FIXTURE_PARENT_DOMAINS
        or domain.endswith(FIXTURE_TLDS)
        or domain.endswith(tuple("." + parent for parent in FIXTURE_PARENT_DOMAINS))
    )


def masked_email(address):
    local, _, domain = address.partition("@")
    return f"{local[0]}***@{domain[0]}***{domain[domain.rfind('.'):]}"


def findings(line, real, terms=frozenset(), names_the_market=False):
    """What is wrong with one added line, each said without its value. A line of a file where the
    real market may be named may name it, and quote the real exports' questions."""
    found = []
    if not names_the_market and terms and names_a_term(line, terms):
        found.append(f"a real organization's, market's, place's or group's name (listed in {TERMS_PATH})")
    if not names_the_market and copies_a_question(line, real):
        found.append("words copied from a real export's questions in .scratch/examples/")
    for match in EMAIL.finditer(line):
        address, domain = match.group(0), match.group(1)
        if NOT_A_DOMAIN.search(domain):
            continue
        if address.lower() in real.emails:
            found.append("an exact email from a real export in .scratch/examples/")
        elif not is_fixture_domain(domain):
            found.append(f"an email address outside the fixture domains ({masked_email(address)})")
    real_phones = phone_numbers(line) & real.phones
    if real_phones:
        found.append("an exact phone number from a real export in .scratch/examples/")
    for match in PHONE.finditer(line):
        fictional = match.group(3) == FIXTURE_EXCHANGE and match.group(4).startswith(FIXTURE_LINE_PREFIX)
        exact = bool(phone_numbers(match.group(0)) & real.phones)
        if not fictional and not exact:
            found.append(f"a phone number shaped like a real one (***-***-**{match.group(4)[2:]})")
    for match in ATLAS_HOST.finditer(line):
        if match.group(1).lower() != ATLAS_PLACEHOLDER_ID and not is_fixture_domain(match.group(0)):
            found.append("a MongoDB Atlas host (***.mongodb.net): write it as <cluster>.<id>.mongodb.net")
    if real.names:
        words = [word.lower() for word in WORD.findall(line)]
        if any(
            tuple(words[start:start + size]) in real.names
            for size in range(2, 6)
            for start in range(len(words) - size + 1)
        ):
            found.append("an applicant's name from a real export in .scratch/examples/")
    return found


# ── Reading git ──────────────────────────────────────────────────────────────


class GitFailed(Exception):
    pass


def git(*args):
    result = subprocess.run(["git", "-c", "core.quotePath=false", *args], capture_output=True)
    if result.returncode != 0:
        raise GitFailed(f"git {' '.join(args)}: {result.stderr.decode('utf-8', 'replace').strip()}")
    # Line by line, so a file saved in Windows-1252 reads whole beside the UTF-8 ones.
    return "\n".join(text_of(line) for line in result.stdout.split(b"\n"))


DIFF_OPTIONS = ("-U0", "--no-color", "--no-ext-diff", "--no-textconv", "--no-renames", "--ignore-submodules")


def export_folders():
    """`.scratch/examples/` of this checkout and, from a linked worktree, of the primary checkout."""
    folders = [Path(git("rev-parse", "--show-toplevel").strip()) / ".scratch" / "examples"]
    common = Path(git("rev-parse", "--path-format=absolute", "--git-common-dir").strip())
    if common.name == ".git":
        folders.append(common.parent / ".scratch" / "examples")
    return list(dict.fromkeys(folders))


def unquote_path(path):
    if path.startswith('"') and path.endswith('"'):
        escaped = path[1:-1].encode("latin-1", "backslashreplace").decode("unicode_escape")
        return escaped.encode("latin-1").decode("utf-8", "replace")
    return path


def header_path(line):
    """The path a `diff --git a/X b/X` or `diff --cc X` header names (no renames are asked for)."""
    if line.startswith(("diff --cc ", "diff --combined ")):
        return unquote_path(line.split(" ", 2)[2])
    rest = line[len("diff --git "):]
    if rest.endswith('"'):
        return unquote_path(rest[rest.rfind(' "b/') + 1:])[2:]
    return rest[(len(rest) + 1) // 2 + 2:]


def added_lines(diff):
    """(path, line number, text) of each line the diff adds, and (path, None, None) for each binary
    file it adds or changes. A combined diff (a merge's) adds a line only when it is new to every
    parent, so a merge answers for what it resolved, nothing more."""
    path, parents, number, in_hunk, header = None, 1, 0, False, None
    for line in diff.split("\n"):
        if line.startswith("diff "):
            path, in_hunk, header = None, False, header_path(line)
        elif not in_hunk and line.startswith("Binary files ") and not line.endswith(" and /dev/null differ"):
            if header and not header.endswith(UNREAD_FILES):
                yield header, None, None
        elif not in_hunk and line.startswith("+++ "):
            target = unquote_path(line[4:])
            path = None if target == "/dev/null" else target.split("/", 1)[1]
        elif line.startswith("@@"):
            at = len(line) - len(line.lstrip("@"))
            parents = at - 1
            number = int(re.search(r" \+(\d+)", line).group(1))
            in_hunk = True
        elif in_hunk and path and len(line) >= parents:
            prefix, text = line[:parents], line[parents:]
            if prefix.startswith("\\") or "-" in prefix:
                continue
            if prefix == "+" * parents and not path.endswith(UNREAD_FILES):
                yield path, number, text
            number += 1


def blob(spec):
    result = subprocess.run(["git", "cat-file", "blob", spec], capture_output=True)
    if result.returncode != 0:
        raise GitFailed(f"git cat-file blob {spec}: {result.stderr.decode('utf-8', 'replace').strip()}")
    return result.stdout


def staged_lines():
    """(path, where, text) of each added line, a spreadsheet's cells as lines."""
    for path, number, text in added_lines(git("diff", "--cached", *DIFF_OPTIONS)):
        if number is None:
            for where, found in spreadsheet_lines(path, blob(f":{path}")):
                yield path, where, found
        else:
            yield path, f"{path}:{number}", text


def commit_lines(revisions):
    """Each commit's message and added lines, the commit a value came in by named with it, as
    (path, where, text); a message's path is None."""
    # NUL separates the fields: git treats a file holding one as binary, and a message cannot.
    log = git("log", "--cc", *DIFF_OPTIONS, "--format=%x00%H%x00%B%x00", *revisions, "--").split("\0")
    for sha, message, diff in zip(log[1::3], log[2::3], log[3::3]):
        for number, text in enumerate(message.split("\n"), 1):
            yield None, f"{sha[:12]} message:{number}", text
        for path, number, text in added_lines(diff):
            if number is None:
                for where, found in spreadsheet_lines(path, blob(f"{sha}:{path}")):
                    yield path, f"{sha[:12]} {where}", found
            else:
                yield path, f"{sha[:12]} {path}:{number}", text


def blobs(names):
    """The bytes of each blob named, read through one `git cat-file --batch`."""
    result = subprocess.run(["git", "cat-file", "--batch"], input="".join(f"{name}\n" for name in names).encode(),
                            capture_output=True)
    if result.returncode != 0:
        raise GitFailed(f"git cat-file --batch: {result.stderr.decode('utf-8', 'replace').strip()}")
    out, at = result.stdout, 0
    for _ in names:
        end = out.index(b"\n", at)
        size = int(out[at:end].split()[2])
        yield out[end + 1:end + 1 + size]
        at = end + 1 + size + 1


# What git reads as binary: a NUL in a file's first 8000 bytes.
BINARY_SNIFF = 8000


def tree_lines(revision):
    """(path, where, text) of every line of every file a revision's tree holds, a spreadsheet's or
    zip's text as lines; other binaries, the generated lockfiles and submodules are not read."""
    tree = git("rev-parse", "--verify", "--end-of-options", f"{revision}^{{tree}}").strip()
    files = []
    for entry in git("ls-tree", "-r", "-z", "--full-tree", tree).split("\0"):
        info, _, path = entry.partition("\t")
        if path and info.split()[1] == "blob" and not path.endswith(UNREAD_FILES):
            files.append((path, info.split()[2]))
    for (path, _), data in zip(files, blobs([name for _, name in files])):
        if path.lower().endswith(SHEETS_AND_ARCHIVES) or b"\0" in data[:BINARY_SNIFF]:
            for where, text in spreadsheet_lines(path, data):
                yield path, where, text
            continue
        lines = data.split(b"\n")
        if lines[-1] == b"":
            lines.pop()
        for number, line in enumerate(lines, 1):
            yield path, f"{path}:{number}", text_of(line)


def pushed_revisions(refs):
    """The rev-list arguments for what a push sends: its new tips, less what any remote has."""
    tips, sent = [], []
    for line in refs.splitlines():
        parts = line.split()
        if len(parts) != 4 or set(parts[1]) == {"0"}:
            continue  # a deletion sends nothing
        tips.append(parts[1])
        if set(parts[3]) != {"0"} and subprocess.run(
            ["git", "cat-file", "-e", f"{parts[3]}^{{commit}}"], capture_output=True
        ).returncode == 0:
            sent.append(parts[3])
    return tips + ["--not", "--remotes", *sent] if tips else []


# ── The command ──────────────────────────────────────────────────────────────

ADVICE = """\
real-data-check: refused. Conventioner is public: anything pushed is published the moment it lands.
  Use an address at example.com or a .test domain, and a phone number from 555-0100 to 555-0199.
  A database host is written <cluster>.<id>.mongodb.net: the real one stays in the deployment's
  environment.
  A real export never becomes test data in any form: the Google Form corpus changes only through
  back-end/tests/fixtures/synthetic_form_exports.py, never by editing a committed file.
  The fixture domains are listed in scripts/real_data_check.py; never skip the hooks to get past this."""


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    mode, args = (argv[0], argv[1:]) if argv else (None, [])
    try:
        if mode == "staged" and not args:
            lines = staged_lines()
        elif mode == "commits" and args:
            lines = commit_lines(args)
        elif mode == "tree" and len(args) <= 1:
            lines = tree_lines(args[0] if args else "HEAD")
        elif mode == "add-term" and not args:
            return add_terms(sys.stdin.read())
        elif mode == "pre-push" and 1 <= len(args) <= 2:
            revisions = pushed_revisions(sys.stdin.read())
            lines = commit_lines(revisions) if revisions else iter(())
        else:
            print(__doc__.split("\n\n")[1], file=sys.stderr)
            return 2
        real = RealValues.read(export_folders())
        terms = read_terms()
        found = [
            f"real-data-check: {where}: {what}"
            for path, where, text in lines
            for what in (
                [text] if isinstance(text, Refusal)
                else findings(text, real, terms, may_name_the_market(path))
            )
        ]
    except GitFailed as error:
        print(f"real-data-check: {error}", file=sys.stderr)
        return 2
    if not found:
        return 0
    print("\n".join(dict.fromkeys(found)))
    print(ADVICE)
    return 1


if __name__ == "__main__":
    sys.exit(main())
