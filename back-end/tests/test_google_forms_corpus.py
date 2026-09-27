"""The five anonymised Google Form exports in ``tests/test_data/google_forms/``, asserted as shapes.

They are real application exports from five markets with the people replaced, made by
``tests/fixtures/anonymise_form_export.py``; ``tests/test_data/README.md`` says which market each
one is. The real files never reach CI, so this is what stands between a regenerated or hand-edited
copy and a fixture that silently stopped looking like the export it came from: the row count, the
header row exactly as the form wrote it, and how often the table-size answers occur, which the
anonymiser keeps verbatim because at least 3 applicants gave each one.
"""
import csv
import hashlib
import json
import os
from collections import Counter

import pytest

CORPUS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "test_data", "google_forms")

# name: (rows, columns, sha256 of the header row as JSON, table-size column, its answer counts)
# The header is pinned by hash because it is long and multi-line, and must survive byte for byte.
SHAPES = {
    "fall-2023": (294, 12, "ebe3e57a30707eb9", 6, {"Full table": 170, "Half table": 117}),
    "spring-2024": (361, 30, "076b61cb540acdc5", 22,
                    {"Full table only": 154, "Either": 106, "Half table only": 99}),
    "spring-2025": (237, 28, "793acf80aa31b295", 23,
                    {"Full table": 87, "Either": 66, "Half table": 65, "Full table, Either": 11,
                     "Half table, Either": 6, "Full table, Half table": 2}),
    "fall-2025": (237, 30, "eedca99cd03454bc", 25,
                  {"Full table": 89, "Either": 86, "Half table": 62}),
    "spring-2026": (250, 35, "79a0c0aa08260f25", 30,
                    {"Full table": 87, "Either": 85, "Half table": 75, "TEST": 1}),
}


def _read(name):
    with open(os.path.join(CORPUS, f"{name}.csv"), newline="", encoding="utf-8") as handle:
        return list(csv.reader(handle))


def test_the_corpus_is_exactly_these_five_files():
    assert sorted(os.listdir(CORPUS)) == sorted(f"{name}.csv" for name in SHAPES)


@pytest.mark.parametrize("name", SHAPES)
def test_each_copy_keeps_its_rows_and_header(name):
    rows, columns, header_hash, _, _ = SHAPES[name]
    export = _read(name)
    assert len(export) - 1 == rows
    assert len(export[0]) == columns
    assert hashlib.sha256(json.dumps(export[0]).encode()).hexdigest()[:16] == header_hash


@pytest.mark.parametrize("name", SHAPES)
def test_each_copy_keeps_how_often_its_table_sizes_were_chosen(name):
    _, _, _, column, counts = SHAPES[name]
    export = _read(name)
    assert "half table or full table" in export[0][column].lower()
    answers = Counter(row[column] for row in export[1:])
    assert {answer: answers[answer] for answer in counts} == counts
