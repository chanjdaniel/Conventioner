"""The anonymiser that turns a real Google Form export into a committable fixture.

The real exports never leave the maintainer's machine, so everything here runs on a synthetic one
built below. It has the messy parts the real files have: an organizer column left of the timestamp,
a collected email repeated in a second column, a column of other applicants' emails, a multi-select
whose options hold commas, a TEST row, and a trailing empty column.

What it keeps follows the privacy rule of the form-started-from-a-CSV map (ticket 01): a value, or
an option inside a multi-select answer, stays verbatim only when at least 3 distinct applicants
share it, counted by applicant email rather than by row.
"""
import csv
import importlib.util
import os
import re
import subprocess
import sys

import pytest

SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures",
                      "anonymise_form_export.py")
_spec = importlib.util.spec_from_file_location("anonymise_form_export", SCRIPT)
anonymiser = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(anonymiser)

HEADER = [
    "Accepted? (Y/N)",
    "Timestamp",
    "Email Address",
    "Full name",
    "Which days can you attend?\n(Select all that apply)",
    "Table size",
    "Anyone you would like to share a table with?",
    "Portfolio link",
    "Additional comments",
    "Email Address",
    "",
]

DAYS = "Saturday, March 7, Sunday, March 8"
SATURDAY = "Saturday, March 7"


def _row(accepted, stamp, email, name, days, size, partner, link, comment):
    return [accepted, stamp, email, name, days, size, partner, link, comment, email, ""]


def _export():
    return [
        HEADER,
        _row("Y", "9/27/2025 9:04:01", "wren.okafor@mail.test", "Wren Okafor", DAYS,
             "Full table", "", "https://drive.google.com/file/d/1AbCdEf", "Loves glazes"),
        _row("Y", "9/27/2025 23:49:25", "ilse.marchetti@mail.test", "Ilse Marchetti", SATURDAY,
             "Full table", "wren.okafor@mail.test", "", ""),
        _row("", "9/28/2025 10:00:00", "tomasz.bright@mail.test", "Tomasz Bright",
             f"{DAYS}, Woven (crochet, knitting, etc)", "Full table", "", "", ""),
        # The same applicant three times: "Half table" is on three rows but one person.
        _row("", "9/29/2025 8:15:30", "juniper.vale@mail.test", "Juniper Vale", SATURDAY,
             "Half table", "", "", "I sell marmalade, jams and pickles"),
        _row("", "9/29/2025 8:16:02", "juniper.vale@mail.test", "Juniper Vale", SATURDAY,
             "Half table", "", "", ""),
        _row("", "9/29/2025 8:17:45", "Juniper.Vale@mail.test", "Juniper Vale", SATURDAY,
             "Half table", "", "", ""),
        ["test", "10/1/2025 12:00:00", "test", "test", "test", "test", "test", "test", "test",
         "test", ""],
    ]


def _column(rows, index):
    return [row[index] for row in rows[1:]]


class TestWhatIsKept:
    def test_the_header_row_is_copied_verbatim(self):
        out = anonymiser.anonymise(_export())
        assert out[0] == HEADER

    def test_row_count_order_and_blanks_are_kept(self):
        source = _export()
        out = anonymiser.anonymise(source)
        assert len(out) == len(source)
        for before, after in zip(source[1:], out[1:]):
            assert len(after) == len(before)
            assert [not cell.strip() for cell in after] == [not cell.strip() for cell in before]

    def test_a_value_three_applicants_share_is_kept(self):
        out = anonymiser.anonymise(_export())
        assert _column(out, 5)[:3] == ["Full table"] * 3

    def test_a_value_one_applicant_gave_three_times_is_replaced(self):
        # "Half table" is on three rows, all of them Juniper's.
        out = anonymiser.anonymise(_export())
        assert "Half table" not in _column(out, 5)

    def test_an_option_three_applicants_chose_is_kept_inside_a_rarer_answer(self):
        out = anonymiser.anonymise(_export())
        days = _column(out, 4)
        # Saturday, March 7 was chosen by Wren, Ilse, Tomasz and Juniper; Sunday by only two.
        assert days[1] == SATURDAY
        assert days[0].startswith(f"{SATURDAY}, ")
        assert "Sunday, March 8" not in days[0]

    def test_an_option_holding_a_comma_is_one_option(self):
        out = anonymiser.anonymise(_export())
        tomasz = _column(out, 4)[2]
        assert "crochet" not in tomasz
        assert tomasz.startswith(f"{SATURDAY}, ")

    def test_the_test_row_is_kept_as_it_is(self):
        source = _export()
        out = anonymiser.anonymise(source)
        assert out[-1][:1] + out[-1][2:] == source[-1][:1] + source[-1][2:]


class TestWhatIsInvented:
    def test_nothing_fewer_than_three_applicants_gave_survives(self):
        source = _export()
        out = anonymiser.anonymise(source)
        text = "\n".join(",".join(row) for row in out[1:])
        for rare in ("wren.okafor", "Okafor", "Marchetti", "Juniper", "1AbCdEf", "glazes",
                     "marmalade", "crochet", "9/27/2025 9:04:01"):
            assert rare not in text

    def test_an_email_becomes_an_email(self):
        out = anonymiser.anonymise(_export())
        for email in _column(out, 2)[:-1]:
            assert re.fullmatch(r"[^@\s]+@[^@\s]+\.[a-z]+", email)

    def test_one_applicant_keeps_one_invented_email_everywhere(self):
        out = anonymiser.anonymise(_export())
        emails, repeated, partners = _column(out, 2), _column(out, 9), _column(out, 6)
        assert emails == repeated
        assert partners[1] == emails[0]
        # Case differences in the source are the same person.
        assert emails[3] == emails[4] == emails[5]

    def test_different_applicants_get_different_emails(self):
        out = anonymiser.anonymise(_export())
        assert len(set(_column(out, 2)[:-1])) == 4

    def test_a_name_becomes_a_name(self):
        out = anonymiser.anonymise(_export())
        for name in _column(out, 3)[:-1]:
            assert re.fullmatch(r"[A-Z][a-z]+ [A-Z][a-z]+", name)

    def test_a_link_becomes_a_link(self):
        out = anonymiser.anonymise(_export())
        assert re.fullmatch(r"https://\S+", _column(out, 7)[0])

    def test_prose_becomes_prose_of_the_same_length(self):
        source = _export()
        out = anonymiser.anonymise(source)
        before, after = _column(source, 8)[0], _column(out, 8)[0]
        assert after != before
        assert len(after) == len(before)
        assert after.count(" ") == before.count(" ")


class TestTimestamps:
    def test_every_timestamp_moves_by_one_offset(self):
        from datetime import datetime

        source = _export()
        out = anonymiser.anonymise(source)
        parse = lambda s: datetime.strptime(s, "%m/%d/%Y %H:%M:%S")
        shifts = {parse(a) - parse(b) for a, b in zip(_column(out, 1), _column(source, 1))}
        assert len(shifts) == 1
        assert shifts.pop().total_seconds() != 0

    def test_timestamps_keep_their_unpadded_format(self):
        out = anonymiser.anonymise(_export())
        for stamp in _column(out, 1):
            assert re.fullmatch(r"[1-9]\d?/[1-9]\d?/\d{4} [1-9]?\d:\d\d:\d\d", stamp)

    def test_an_iso_timestamp_stays_iso(self):
        source = [["Timestamp", "Email"],
                  ["2025-03-01 09:04:01", "a@mail.test"],
                  ["2025-03-01 10:00:00", "b@mail.test"]]
        out = anonymiser.anonymise(source)
        for stamp in _column(out, 0):
            assert re.fullmatch(r"\d{4}-\d\d-\d\d \d\d:\d\d:\d\d", stamp)


class TestDeterminism:
    def test_running_twice_gives_the_same_rows(self):
        assert anonymiser.anonymise(_export()) == anonymiser.anonymise(_export())

    def test_the_command_writes_byte_identical_files(self, tmp_path):
        source = tmp_path / "export.csv"
        with open(source, "w", newline="", encoding="utf-8") as handle:
            csv.writer(handle).writerows(_export())
        outputs = []
        for name in ("one.csv", "two.csv"):
            subprocess.run([sys.executable, SCRIPT, str(source), str(tmp_path / name)],
                           check=True, capture_output=True)
            outputs.append((tmp_path / name).read_bytes())
        assert outputs[0] == outputs[1]


class TestTheLeakCheck:
    """``find_leaks`` is the refusal's own judgement, independent of how values were invented."""

    SOURCE = [
        ["Name", "Table size", "Notes"],
        ["Wren Okafor", "Full table", ""],
        ["Ilse Marchetti", "Full table", ""],
        ["Tomasz Bright", "Full table", ""],
        ["Juniper Vale", "Full", "Okafor sent me"],
    ]

    def test_a_rare_value_in_the_output_names_its_column(self):
        output = [["Name", "Table size", "Notes"],
                  ["A B", "Full table", ""],
                  ["C D", "Full table", "met Ilse Marchetti there"]]
        assert anonymiser.find_leaks(self.SOURCE, output) == ["Notes"]

    def test_a_rare_value_inside_a_shared_one_is_no_leak(self):
        # "Full" alone is one applicant's answer, but three applicants wrote it inside "Full table".
        output = [["Name", "Table size", "Notes"], ["A B", "Full table", ""]]
        assert anonymiser.find_leaks(self.SOURCE, output) == []

    def test_a_value_shorter_than_four_characters_is_no_leak(self):
        source = [["Days"], ["Sat"], ["Sun"]]
        assert anonymiser.find_leaks(source, source) == []

    def test_the_header_row_is_not_searched(self):
        source = [["Wren Okafor?"], ["Wren Okafor"]]
        output = [["Wren Okafor?"], ["Avery Silva"]]
        assert anonymiser.find_leaks(source, output) == []

    def test_a_word_inside_a_longer_word_is_no_leak(self):
        source = [["Craft"], ["Wood"]]
        output = [["Craft"], ["Woodwork"]]
        assert anonymiser.find_leaks(source, output) == []

    def test_a_rare_combination_of_shared_options_is_no_leak(self):
        # Ticket 01, amended by 03: the options are what is counted, not the answer that joins them.
        source = [["Clubs"], ["Pottery"], ["Pottery"], ["Pottery"], ["Zines"], ["Zines"],
                  ["Zines"], ["Pottery, Zines"]]
        assert anonymiser.find_leaks(source, source) == []

    def test_the_anonymised_export_has_no_leaks(self):
        source = _export()
        assert anonymiser.find_leaks(source, anonymiser.anonymise(source)) == []
