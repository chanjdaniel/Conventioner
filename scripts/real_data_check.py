#!/usr/bin/env python3
"""Refuse a real person's contact details in what is about to leave this machine.

    python scripts/real_data_check.py staged
    python scripts/real_data_check.py commits REV... [--not REV...]
    python scripts/real_data_check.py pre-push REMOTE [URL] < refs

`staged` reads what `git commit` would record (the pre-commit hook); `commits` reads each commit a
rev-list range names, its message too (the gate and CI); `pre-push` reads the commits a push sends,
from the refs git gives the pre-push hook on its stdin. Only added lines count: an email address
outside the fixture domains, a phone number shaped like a real one, and, where `.scratch/examples/`
holds real exports, an exact email, phone or applicant's name from them. Conventioner is public, so
a pushed branch is public the moment it lands: this runs before anything leaves the PC.

A finding names the file and line, never the value in full; the exports are read into memory only,
and nothing derived from them is written or printed. Exits 1 on a finding, 2 when git fails.
Standard library only, Python 3.8+.
"""

import csv
import re
import subprocess
import sys
from pathlib import Path

# ── What a fixture may use ───────────────────────────────────────────────────

# Reserved for documentation and tests (RFC 2606, RFC 6761), with their subdomains.
FIXTURE_PARENT_DOMAINS = ("example.com", "example.org", "example.net")
FIXTURE_TLDS = (".test", ".example", ".invalid", ".localhost")
# The few other domains the tests and docs already use, and the project's and services' own.
FIXTURE_DOMAINS = frozenset({
    "b.ca", "domain.com", "else.com", "email.com", "ember.ca", "t.com", "test.com", "x.com",
    "conventioner.io", "resend.dev", "cluster.mongodb.net",
    "anthropic.com", "github.com", "users.noreply.github.com",
})
# A phone number in the 555 exchange is the fictional one (555-0100 to 555-0199 are reserved).
FIXTURE_EXCHANGE = "555"

# Generated files that quote package authors' addresses and hashes, never anyone's details.
UNREAD_FILES = ("package-lock.json",)

# ── Shapes ───────────────────────────────────────────────────────────────────

EMAIL = re.compile(r"(?<![\w.%+'-])[A-Za-z0-9._%+'-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,24})(?![A-Za-z0-9-])")
# Asset and source names that read like an address: logo@2x.png.
NOT_A_DOMAIN = re.compile(
    r"(?i)(?:^\d|\.(?:png|jpe?g|gif|svg|webp|ico|js|mjs|cjs|ts|vue|css|scss|py|json|md|html|map|lock|txt)$)"
)
# North American, with separators: (604) 555-0123, 604-555-0123, +1 604 555 0123, 604.555.0123.
PHONE = re.compile(
    r"(?<![\w.#/+-])(?:\+?1[ .-]?)?(?:\(([2-9]\d\d)\)|([2-9]\d\d))[ .-]?([2-9]\d\d)[ .-](\d{4})(?![\w.])"
)
# Any run that may spell a phone number, however it is punctuated: only compared with the exports.
DIGIT_RUN = re.compile(r"(?<![\w.])\+?\d[\d ().-]{8,}\d(?![\w.])")
WORD = re.compile(r"[^\W\d_]+(?:['’.-][^\W\d_]+)*")

# ── The real exports ─────────────────────────────────────────────────────────

PERSON_NAME = re.compile(r"(?i)\bname\b")
NOT_A_PERSON = re.compile(r"(?i)\b(?:business|brand|shop|store|company|booth|studio|organi[sz]ation|user ?name|handle)\b")
FIRST_NAME = re.compile(r"(?i)\bfirst\b.*\bname\b")
LAST_NAME = re.compile(r"(?i)\b(?:last|sur|family)\b.*\bname\b|\bsurname\b")
# A name that this many applicants gave identifies none of them ("Not Applicable").
SHARED_BY = 3


class RealValues:
    """The exact emails, phones and applicants' names of the exports, held in memory only."""

    def __init__(self):
        self.emails = set()
        self.phones = set()
        self.names = set()

    def __bool__(self):
        return bool(self.emails or self.phones or self.names)

    @classmethod
    def read(cls, folders):
        values = cls()
        givers = {}
        for folder in folders:
            for path in sorted(folder.rglob("*.csv")) if folder.is_dir() else ():
                with open(path, newline="", encoding="utf-8-sig", errors="replace") as handle:
                    rows = list(csv.reader(handle))
                if rows:
                    values._add_export(rows, givers)
        values.names = {name for name, people in givers.items() if len(people) < SHARED_BY}
        return values

    def _add_export(self, rows, givers):
        header = rows[0]
        name_columns = [i for i, h in enumerate(header) if PERSON_NAME.search(h) and not NOT_A_PERSON.search(h)]
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


def findings(line, real):
    """What is wrong with one added line, each said without its value."""
    found = []
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
        if match.group(3) != FIXTURE_EXCHANGE and not real_phones:
            found.append(f"a phone number shaped like a real one (***-***-**{match.group(4)[2:]})")
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
    return result.stdout.decode("utf-8", "replace")


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
        return path[1:-1].encode("latin-1", "backslashreplace").decode("unicode_escape").encode("latin-1").decode("utf-8", "replace")
    return path


def added_lines(diff):
    """(path, line number, text) of each line the diff adds. A combined diff (a merge's) adds a line
    only when it is new to every parent, so a merge answers for what it resolved, nothing more."""
    path, parents, number, in_hunk = None, 1, 0, False
    for line in diff.split("\n"):
        if line.startswith("diff "):
            path, in_hunk = None, False
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


def staged_lines():
    for path, number, text in added_lines(git("diff", "--cached", *DIFF_OPTIONS)):
        yield f"{path}:{number}", text


def commit_lines(revisions):
    """Each commit's message and added lines, the commit a value came in by named with it."""
    # NUL separates the fields: git treats a file holding one as binary, and a message cannot.
    log = git("log", "--cc", *DIFF_OPTIONS, "--format=%x00%H%x00%B%x00", *revisions, "--").split("\0")
    for sha, message, diff in zip(log[1::3], log[2::3], log[3::3]):
        for number, text in enumerate(message.split("\n"), 1):
            yield f"{sha[:12]} message:{number}", text
        for path, number, text in added_lines(diff):
            yield f"{sha[:12]} {path}:{number}", text


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
  Use an address at example.com or a .test domain, and a 555-01xx phone number.
  A real export is never committed, anonymised or not, except through
  back-end/tests/fixtures/anonymise_form_export.py.
  The fixture domains are listed in scripts/real_data_check.py; never skip the hooks to get past this."""


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    mode, args = (argv[0], argv[1:]) if argv else (None, [])
    try:
        if mode == "staged" and not args:
            lines = staged_lines()
        elif mode == "commits" and args:
            lines = commit_lines(args)
        elif mode == "pre-push" and 1 <= len(args) <= 2:
            revisions = pushed_revisions(sys.stdin.read())
            lines = commit_lines(revisions) if revisions else iter(())
        else:
            print(__doc__.split("\n\n")[1], file=sys.stderr)
            return 2
        real = RealValues.read(export_folders())
        found = [f"real-data-check: {where}: {what}" for where, text in lines for what in findings(text, real)]
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
