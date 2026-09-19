#!/usr/bin/env python3
"""Turn a real Google Forms response export into a committable fixture.

Why this exists: three MVP blockers found on 2026-09-14 came from the *shape* of a real export, not
from logic, and every CSV test in this suite used short single-line stems like
``"Which days can you attend?"``. That is why grid detection failing on a multi-line header survived
to production. A fixture invented by the same people who wrote the parser only tests what they
already thought of.

Why it is not the real file: the source is 232 real applicants' names and email addresses.

So: keep the structure exactly, replace the people. Every property listed in
``tests/test_data/README.md`` is preserved byte-for-byte from the source - the header row is copied
verbatim, including its newlines - and only the identifying cells are rewritten.

Usage:
    python tests/fixtures/anonymise_form_export.py <real-export.csv> <output.csv>
"""
import csv
import hashlib
import re
import sys
from typing import List

# Columns whose cells identify a person. Matched against the header text, case-insensitively, so the
# script does not depend on column order - which differs between forms.
IDENTIFYING_HEADERS = (
    "email",
    "name",
    "discord",
    "url",
    "link",
    "portfolio",
    "proof",
    "attach",
    "comment",
    "clubs",
    "selling",
    "experience",
)

FIRST_NAMES = [
    "Avery", "Bao", "Cass", "Devi", "Emre", "Fen", "Gita", "Hal", "Iris", "Jonas",
    "Kira", "Lev", "Mina", "Nils", "Oona", "Pilar", "Quinn", "Rasha", "Soren", "Tova",
]
LAST_NAMES = [
    "Adeyemi", "Baptiste", "Cardoso", "Duval", "Eriksen", "Farouk", "Grunwald", "Haugen",
    "Imamura", "Jovanovic", "Kowalski", "Lindqvist", "Moreau", "Nakagawa", "Oyelaran",
    "Petrova", "Quintero", "Rasmussen", "Silva", "Tanaka",
]
CRAFTS = [
    "Ceramics", "Prints", "Textiles", "Jewellery", "Candles", "Zines", "Woodwork",
    "Stickers", "Knitwear", "Leather", "Glass", "Paper", "Enamel", "Resin",
]


def _stable_index(value: str, salt: str, size: int) -> int:
    """A deterministic pick, so re-running the script produces an identical fixture."""
    digest = hashlib.sha256(f"{salt}:{value}".encode("utf-8")).hexdigest()
    return int(digest[:8], 16) % size


def _person(value: str) -> str:
    first = FIRST_NAMES[_stable_index(value, "first", len(FIRST_NAMES))]
    last = LAST_NAMES[_stable_index(value, "last", len(LAST_NAMES))]
    return f"{first} {last}"


def _email(value: str) -> str:
    first = FIRST_NAMES[_stable_index(value, "first", len(FIRST_NAMES))].lower()
    last = LAST_NAMES[_stable_index(value, "last", len(LAST_NAMES))].lower()
    n = _stable_index(value, "num", 90) + 10
    return f"{first}.{last}{n}@example.com"


def _business(value: str) -> str:
    craft = CRAFTS[_stable_index(value, "craft", len(CRAFTS))]
    first = FIRST_NAMES[_stable_index(value, "first", len(FIRST_NAMES))]
    return f"{first} {craft}"


def _is_identifying(header: str) -> bool:
    lowered = " ".join(str(header).split()).lower()
    return any(token in lowered for token in IDENTIFYING_HEADERS)


def _replacement(header: str, cell: str) -> str:
    """A structurally equivalent stand-in: same emptiness, same shape, different person."""
    if not cell.strip():
        return cell
    lowered = " ".join(str(header).split()).lower()
    if "email" in lowered:
        # Preserve the multi-address case, which the table-share column carries.
        if "," in cell:
            return ", ".join(_email(part.strip()) for part in cell.split(",") if part.strip())
        return _email(cell)
    if "business" in lowered:
        return _business(cell)
    # Before the generic "name" branch: this form's column is headed "Discord Username", which
    # contains "name" and would otherwise be given a person's name rather than a handle.
    if "discord" in lowered:
        return _person(cell).lower().replace(" ", "_")
    if "name" in lowered:
        return _person(cell)
    if re.search(r"url|link|portfolio|proof|attach", lowered):
        return f"https://example.com/{_stable_index(cell, 'url', 10**6):06d}"
    # Free text: keep whether something was written, drop what it said.
    return "Sample response."


def anonymise(rows: List[List[str]]) -> List[List[str]]:
    header = rows[0]
    identifying = [_is_identifying(h) for h in header]
    out = [list(header)]  # verbatim, newlines and duplicate headers included
    for row in rows[1:]:
        out.append([
            _replacement(header[i], cell) if i < len(identifying) and identifying[i] else cell
            for i, cell in enumerate(row)
        ])
    return out


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    source, destination = sys.argv[1], sys.argv[2]
    with open(source, newline="", encoding="utf-8") as handle:
        rows = list(csv.reader(handle))
    with open(destination, "w", newline="", encoding="utf-8") as handle:
        csv.writer(handle).writerows(anonymise(rows))
    print(f"{len(rows) - 1} rows anonymised -> {destination}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
