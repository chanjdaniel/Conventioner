"""The CSV a real Google Form produces, asserted against rather than one we imagined.

Every other CSV test in this suite writes its own headers, and every one of them uses a short
single-line stem like ``"Which days can you attend?"``. A real grid question carries its instructions
above the bracketed option, so the header spans several lines - and that one difference defeated grid
detection completely (E01/F04/S01). The import could not be completed at all on a real file, and
nothing in the suite noticed, because nothing in the suite had ever seen one.

So the fixture here is a real export with the people replaced:
``tests/test_data/google_forms_export.csv``, produced by ``tests/fixtures/anonymise_form_export.py``.
``tests/test_data/README.md`` lists the properties it exists to preserve; a test that needs one of
them belongs here rather than in a hand-written header somewhere else.
"""
import csv
import os

import pytest

from csv_import import column_groups

FIXTURE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "test_data",
                       "google_forms_export.csv")

# Which day each of the five grid columns asks about, as the form spells them.
MARKET_DAYS = [
    "Monday, November 17",
    "Tuesday, November 18",
    "Wednesday, November 19",
    "Thursday, November 20",
    "Friday, November 21",
]


@pytest.fixture(scope="module")
def rows():
    with open(FIXTURE, newline="", encoding="utf-8") as handle:
        return list(csv.reader(handle))


@pytest.fixture(scope="module")
def headers(rows):
    return rows[0]


class TestTheFixtureStillHasTheShapesItExistsFor:
    """If anonymising ever flattens one of these, the tests below stop testing anything."""

    def test_the_grid_headers_span_several_lines(self, headers):
        multiline = [h for h in headers if "\n" in h]
        assert len(multiline) >= 5, "the multi-line grid headers are the whole point of this fixture"

    def test_timestamps_are_unpadded_month_and_hour(self, rows):
        """`9/12/2025 18:22:56` - what `datetime.fromisoformat` cannot read and text cannot order."""
        stamps = [r[1] for r in rows[1:] if len(r) > 1 and r[1]]
        assert stamps
        assert any(s.split("/")[0].lstrip("0") == s.split("/")[0] and len(s.split("/")[0]) == 1
                   for s in stamps)
        assert any(len(s.split(" ")[1].split(":")[0]) == 1 for s in stamps)

    def test_a_grid_cell_holds_a_set_of_values_and_none_means_unavailable(self, rows):
        cells = {r[20] for r in rows[1:] if len(r) > 20}
        assert "None" in cells
        assert any("," in c for c in cells)

    def test_free_text_answers_do_not_match_the_contract_vocabulary(self, rows):
        choices = {r[26] for r in rows[1:] if len(r) > 26 and r[26]}
        assert choices == {"Full table", "Half table", "Either"}

    def test_it_carries_a_real_number_of_rows(self, rows):
        assert len(rows) - 1 == 232

    def test_it_names_nobody(self, rows):
        """Structure kept, people replaced. Every address is a reserved example domain."""
        emails = [r[2] for r in rows[1:] if len(r) > 2 and "@" in r[2]]
        assert emails
        assert all(e.endswith("@example.com") for e in emails)


class TestGridDetectionOnARealHeader:
    def test_the_five_day_columns_are_one_question(self, headers):
        """The blocker: five columns competing for one target, so the import never enabled."""
        groups = column_groups(headers)

        day_groups = [g for g in groups if len(g.columns) == 5]
        assert day_groups, (
            "the day grid was not detected as one question - a real grid header spans lines, and "
            "the pattern must match across them"
        )
        assert day_groups[0].columns == [20, 21, 22, 23, 24]

    def test_each_column_carries_the_day_it_asks_about(self, headers):
        group = next(g for g in column_groups(headers) if len(g.columns) == 5)

        assert group.options == MARKET_DAYS

    def test_the_stem_reads_as_one_line(self, headers):
        """It labels the group in the ledger, so it cannot arrive with newlines in it."""
        group = next(g for g in column_groups(headers) if len(g.columns) == 5)

        assert "\n" not in group.stem
        assert group.stem.startswith("For each day, choose all table tiers")
        assert "  " not in group.stem, "collapsed whitespace, not just stripped newlines"

    def test_no_other_columns_are_swept_into_a_group(self, headers):
        """Only the grid is a grid. A multi-line header is not by itself evidence of one."""
        grouped = {index for group in column_groups(headers) for index in group.columns}

        assert grouped == {20, 21, 22, 23, 24}


class TestALoneBracketedColumnIsStillNotAGroup:
    def test_even_when_its_question_spans_lines(self):
        headers = [
            "Email Address",
            "Which days can you attend?\n\nNOTE:\n- Pick one.\n [Monday, November 17]",
        ]

        assert column_groups(headers) == []
