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
from datetime import datetime

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

STAMP, EMAIL, NAME, DAYS_COLUMN, SIZE, PARTNER, LINK, COMMENT, REPEATED_EMAIL = range(1, 10)

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
        assert _column(out, SIZE)[:3] == ["Full table"] * 3

    def test_a_value_one_applicant_gave_three_times_is_replaced(self):
        # "Half table" is on three rows, all of them Juniper's.
        out = anonymiser.anonymise(_export())
        assert "Half table" not in _column(out, SIZE)

    def test_an_option_three_applicants_chose_is_kept_inside_a_rarer_answer(self):
        out = anonymiser.anonymise(_export())
        days = _column(out, DAYS_COLUMN)
        # Saturday, March 7 was chosen by Wren, Ilse, Tomasz and Juniper; Sunday by only two.
        assert days[1] == SATURDAY
        assert days[0].startswith(f"{SATURDAY}, ")
        assert "Sunday, March 8" not in days[0]

    def test_an_option_holding_a_comma_is_one_option(self):
        out = anonymiser.anonymise(_export())
        tomasz = _column(out, DAYS_COLUMN)[2]
        assert "crochet" not in tomasz
        assert tomasz.startswith(f"{SATURDAY}, ")

    def test_the_test_row_is_kept_as_it_is(self):
        source = _export()
        out = anonymiser.anonymise(source)
        # Every cell but its timestamp, which moves like every other.
        assert out[-1][:STAMP] + out[-1][STAMP + 1:] == source[-1][:STAMP] + source[-1][STAMP + 1:]


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
        for email in _column(out, EMAIL)[:-1]:
            assert re.fullmatch(r"[^@\s]+@[^@\s]+\.[a-z]+", email)

    def test_one_applicant_keeps_one_invented_email_everywhere(self):
        out = anonymiser.anonymise(_export())
        emails, repeated, partners = _column(out, EMAIL), _column(out, REPEATED_EMAIL), _column(out, PARTNER)
        assert emails == repeated
        assert partners[1] == emails[0]
        # Case differences in the source are the same person.
        assert emails[3] == emails[4] == emails[5]

    def test_different_applicants_get_different_emails(self):
        out = anonymiser.anonymise(_export())
        assert len(set(_column(out, EMAIL)[:-1])) == 4

    def test_a_name_becomes_a_name(self):
        out = anonymiser.anonymise(_export())
        for name in _column(out, NAME)[:-1]:
            assert re.fullmatch(r"[A-Z][a-z]+ [A-Z][a-z]+", name)

    def test_a_link_becomes_a_link(self):
        out = anonymiser.anonymise(_export())
        assert re.fullmatch(r"https://\S+", _column(out, LINK)[0])

    def test_prose_becomes_prose_of_the_same_length(self):
        source = _export()
        out = anonymiser.anonymise(source)
        before, after = _column(source, COMMENT)[0], _column(out, COMMENT)[0]
        assert after != before
        assert len(after) == len(before)
        assert after.count(" ") == before.count(" ")


def _parse(stamp):
    return datetime.strptime(stamp, "%m/%d/%Y %H:%M:%S")


class TestTimestamps:
    def test_every_timestamp_moves_by_one_offset(self):
        source = _export()
        out = anonymiser.anonymise(source)
        shifts = {_parse(a) - _parse(b) for a, b in zip(_column(out, STAMP), _column(source, STAMP))}
        assert len(shifts) == 1
        assert shifts.pop().total_seconds() != 0

    def test_timestamps_keep_their_unpadded_format(self):
        out = anonymiser.anonymise(_export())
        for stamp in _column(out, STAMP):
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


def _people(rows):
    """Give every data row its own applicant email, as the first column."""
    return [["Email"] + rows[0]] + [[f"p{i}@mail.test"] + row for i, row in enumerate(rows[1:])]


def _answers(rows):
    """An output with the email column blanked, so only the answers under test are searched."""
    return [["Email"] + rows[0]] + [[""] + row for row in rows[1:]]


class TestTheLeakCheck:
    """``find_leaks`` is the refusal's own judgement, independent of how values were invented."""

    SOURCE = _people([
        ["Name", "Table size", "Notes"],
        ["Wren Okafor", "Full table", ""],
        ["Ilse Marchetti", "Full table", ""],
        ["Tomasz Bright", "Full table", ""],
        ["Juniper Vale", "Full", "Okafor sent me"],
    ])

    def test_a_rare_value_in_the_output_names_its_column_by_number_and_header(self):
        output = _answers([["Name", "Table size", "Notes"],
                           ["A B", "Full table", ""],
                           ["C D", "Full table", "met Ilse Marchetti there"]])
        assert anonymiser.find_leaks(self.SOURCE, output) == ['column 4 "Notes"']

    def test_a_rare_word_inside_free_text_is_a_leak(self):
        # "Okafor" is one of Wren's names and a word in Juniper's note: two applicants.
        output = _answers([["Name", "Table size", "Notes"], ["A B", "Full table", "ask okafor"]])
        assert anonymiser.find_leaks(self.SOURCE, output) == ['column 4 "Notes"']

    def test_a_rare_name_others_mention_is_still_a_leak(self):
        # Three applicants wrote "Wren Okafor", but only Wren gave it as her own answer: kept
        # anywhere but inside an answer three applicants gave, it points at her.
        source = _people([["Name", "Partner"], ["Wren Okafor", ""], ["Ilse Marchetti",
                          "Wren Okafor"], ["Tomasz Bright", "Wren Okafor"]])
        output = _answers([["Name", "Partner"], ["Wren Okafor", ""]])
        assert anonymiser.find_leaks(source, output) == ['column 2 "Name"']

    def test_a_rare_value_inside_a_shared_answer_is_no_leak(self):
        # "Full" alone is one applicant's answer, but "Full table" is three applicants' answer.
        output = _answers([["Name", "Table size", "Notes"], ["A B", "Full table", ""]])
        assert anonymiser.find_leaks(self.SOURCE, output) == []

    def test_a_value_shorter_than_four_characters_is_no_leak(self):
        source = _people([["Days"], ["Sat"], ["Sun"]])
        assert anonymiser.find_leaks(source, _answers([["Days"], ["Sat"], ["Sun"]])) == []

    def test_the_header_row_is_not_searched(self):
        source = _people([["Wren Okafor?"], ["Wren Okafor"]])
        output = _answers([["Wren Okafor?"], ["Avery Silva"]])
        assert anonymiser.find_leaks(source, output) == []

    def test_a_word_inside_a_longer_word_is_no_leak(self):
        source = _people([["Craft"], ["Wood"]])
        output = _answers([["Craft"], ["Woodwork"]])
        assert anonymiser.find_leaks(source, output) == []

    def test_a_rare_answer_that_is_a_shared_word_is_no_leak(self):
        source = _people([["Shop"], ["Etsy"], ["my etsy shop"], ["etsy and markets"],
                          ["etsy mostly"]])
        output = _answers([["Shop"], ["Etsy"]])
        assert anonymiser.find_leaks(source, output) == []

    def test_a_rare_combination_of_shared_options_is_no_leak(self):
        # Ticket 01, amended by 03: the options are what is counted, not the answer that joins them.
        answers = [["Clubs"], ["Pottery"], ["Pottery"], ["Pottery"], ["Zines"], ["Zines"],
                   ["Zines"], ["Pottery, Zines"]]
        assert anonymiser.find_leaks(_people(answers), _answers(answers)) == []

    def test_the_anonymised_export_has_no_leaks(self):
        source = _export()
        assert anonymiser.find_leaks(source, anonymiser.anonymise(source)) == []


class TestRefusals:
    def test_an_export_without_applicant_emails_is_refused(self):
        # Without an email there is no telling one applicant's three submissions from three
        # applicants, and "shared by 3" would count rows.
        with pytest.raises(anonymiser.NoApplicantEmails):
            anonymiser.anonymise([["Name"], ["Wren Okafor"], ["Wren Okafor"], ["Wren Okafor"]])

    def test_a_leak_writes_nothing_and_names_the_column(self, tmp_path, monkeypatch, capsys):
        source = tmp_path / "export.csv"
        with open(source, "w", newline="", encoding="utf-8") as handle:
            csv.writer(handle).writerows(_export())
        destination = tmp_path / "out.csv"
        monkeypatch.setattr(anonymiser, "find_leaks", lambda *_: ['column 9 "Additional comments"'])
        monkeypatch.setattr(sys, "argv", ["anonymise", str(source), str(destination)])
        assert anonymiser.main() == 1
        assert not destination.exists()
        assert 'column 9 "Additional comments"' in capsys.readouterr().err


class TestTheStandIns:
    def test_a_link_keeps_the_parts_three_applicants_links_share(self):
        # A Google Forms upload is a Drive link: the host and path are every uploader's, the id
        # is one person's file.
        source = [["Email", "Proof", "Website"]] + [
            [f"p{i}@mail.test", f"https://drive.google.com/open?id=1Ab{i}CdEfGh", website]
            for i, website in enumerate(["https://wrenokafor.com/shop", "", ""])
        ]
        out = anonymiser.anonymise(source)
        for before, after in zip(source[1:], out[1:]):
            assert after[1].startswith("https://drive.google.com/open?id=")
            assert after[1] != before[1]
            assert len(after[1]) == len(before[1])
        assert "wrenokafor" not in out[1][2]
        assert out[1][2].startswith("https://")


    def test_a_stand_in_cannot_be_recomputed_without_the_whole_source(self):
        # Keyed on the file, so hashing a guessed name or email reproduces nothing.
        source = _export()
        other = _export()
        other[1][COMMENT] = "Loves glaze"
        assert (_column(anonymiser.anonymise(source), NAME)[0]
                != _column(anonymiser.anonymise(other), NAME)[0])
