"""What the rules propose each column of a Google Form's responses becomes (E24/F02/S01).

The answer key below is the one written by hand for the form-started-from-a-CSV map, ticket 03,
before any rule existed, and it is what the rules were measured against: every column's kind, the
type, required flag and options of every question of the organizer's own. It is asserted here on
the five anonymised exports in ``tests/test_data/google_forms/``, so the rules are held to the
numbers they were chosen on. The anonymiser keeps every answer at least 3 applicants gave, which is
the same line the rules read the file through, so the fixtures carry what the rules need.

No row value appears here: columns are named by header prefix, options by the form's own wording.
"""
import csv
import os

import pytest

import csv_proposal as CsvProposal
import essential_fields as EssentialFields

CORPUS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "test_data", "google_forms")

ORG, EMPTY, TS, EMAIL, DUP = "organizer", "empty", "submitted_at", "applicant_email", "duplicate"
FULL, PREF = EssentialFields.FULL_NAME_KEY, EssentialFields.PREFERRED_NAME_KEY
DATES, TIERS = EssentialFields.AVAILABLE_DATES_KEY, EssentialFields.TIER_PREFERENCE_KEY
MAXD, CHOICE = EssentialFields.MAX_DATES_KEY, EssentialFields.TABLE_CHOICE_KEY
SHARE = EssentialFields.TABLE_SHARE_EMAIL_KEY


def c(type_, required, options=None):
    return {"type": type_, "required": required, "options": options, "upload": False}


def upload(required):
    """A Google Forms file upload. The answer key of ticket 03 said ``file``; the application form
    takes no files, so the question is proposed as text asking for a link, marked as an upload."""
    return {"type": "text", "required": required, "options": None, "upload": True}


UBC = ["Yes, I am a CURRENT UBC student", "Yes, I am an UBC alumni/staff"]
UBC_NO = ("No, I am not a UBC student/alumni/staff and I understand my application will not be "
          "considered.")
SELL = ["Stickers", "Prints", "Keychains", "Jewelry", "Apparel", "Ceramic"]
NONE_CLUB = "I am NOT a part of any of these clubs"
ART, ANI, PRINT = "AMS Artelier at UBC", "UBC Ani", "UBC PRINT Arts and Crafts"

ANSWER_KEY = {
    "fall-2025": {
        0: ("ED", ORG), 1: ("Timestamp", TS), 2: ("Email Address", EMAIL),
        3: ("Full Legal Name", FULL), 4: ("Preferred Name", PREF), 5: ("Email Address", DUP),
        6: ("Are you a UBC student or alumni?", c("select", True, UBC)),
        7: ("Please provide your UBC/alumni/staff", c("email", False)),
        8: ("If you do not have an UBC email", upload(False)),
        9: ("Discord Username", c("text", True)), 10: ("Business Name", c("text", True)),
        11: ("URL to Business", c("text", False)),
        12: ("Do you have any tabling experience", c("text", False)),
        13: ("What will you be selling", c("multi_select", True,
                                           SELL + ["Woven (crochet, knitting, etc)"])),
        14: ("Please provide a link to your portfolio", c("text", True)),
        15: ("I certify that the work I will be selling is my own", c("checkbox", True)),
        16: ("I certify that the work I will be selling abides", c("checkbox", True)),
        17: ("Which clubs are you a member of?",
             c("select", True, [NONE_CLUB, ART, ANI, PRINT, "Visual Art Students’ Association"])),
        18: ("If applicable, please attach proof", upload(False)),
        **{k: ("For each day, choose all table tiers", TIERS) for k in range(19, 24)},
        24: ("Maximum number of days", MAXD), 25: ("Do you want to have a half table", CHOICE),
        26: ("If you chose half table", SHARE),
        27: ("I understand that no-shows", c("checkbox", True)),
        28: ("Additional comments", c("text", False)), 29: ("Column 1", ORG),
    },
    "spring-2024": {
        0: ("Fq", ORG), 1: ("Timestamp", TS), 2: ("Full Name", FULL), 3: ("Preferred Name", PREF),
        4: ("Email Address", EMAIL), 5: ("Discord Username", c("text", True)),
        6: ("Business Name", c("text", True)), 7: ("Business Instagram", c("text", False)),
        8: ("Business Twitter", c("text", False)), 9: ("Business Website", c("text", False)),
        10: ("Other Business Socials", c("text", False)),
        11: ("Do you have any tabling experience", c("text", False)),
        12: ("What will you be selling", c("multi_select", True,
                                           SELL + ["Woven (crochet, knitting etc)"])),
        13: ("Please provide a link to your portfolio", c("text", True)),
        14: ("I certify that the work", c("checkbox", True)),
        15: ("Are you a UBC student?", c("select", True, ["Yes", "No"])),
        16: ("Which clubs are you a member of?", c("multi_select", True, [NONE_CLUB, ART, PRINT])),
        17: ("If applicable, please attach proof", upload(False)),
        **{k: ("For each day, choose all table tiers", TIERS) for k in range(18, 22)},
        22: ("Do you want to have a half table", CHOICE), 23: ("If you chose half table", SHARE),
        24: ("I understand that there will be no table", c("checkbox", True)),
        25: ("I understand that no-shows", c("checkbox", True)),
        26: ("Additional comments", c("text", False)), 27: ("", EMPTY), 28: ("", EMPTY),
        29: ("", ORG),
    },
    "spring-2025": {
        0: ("Status", ORG), 1: ("Screening Notes", ORG), 2: ("Full Name", FULL),
        3: ("Preferred Name", PREF), 4: ("Email Address", EMAIL),
        5: ("Are you a UBC student or alumni?", c("select", True, UBC)),
        6: ("Please provide your UBC/alumni/staff", c("email", False)),
        7: ("If you do not have an UBC email", upload(False)),
        8: ("Discord Username", c("text", True)), 9: ("Business Name", c("text", True)),
        10: ("URL to Business", c("text", False)),
        11: ("Do you have any tabling experience", c("text", False)),
        12: ("What will you be selling", c("multi_select", True,
                                           SELL + ["Woven (crochet, knitting etc)"])),
        13: ("Please provide a link to your portfolio", c("text", True)),
        14: ("I certify that the work I will be selling is my own", c("checkbox", True)),
        15: ("I certify that the work I will be selling abides", c("checkbox", True)),
        16: ("Which clubs are you a member of?",
             c("multi_select", True, [NONE_CLUB, ART, ANI, PRINT])),
        17: ("If applicable, please attach proof", upload(False)),
        **{k: ("For each day, choose all table tiers", TIERS) for k in range(18, 23)},
        23: ("Do you want to have a half table", CHOICE), 24: ("If you chose half table", SHARE),
        25: ("I understand that there will be no table", c("checkbox", True)),
        26: ("I understand that no-shows", c("checkbox", True)),
        27: ("Additional comments", c("text", False)),
    },
    "fall-2023": {
        0: ("Timestamp", TS), 1: ("Accepted? (Y/N)", ORG), 2: ("Full Name", FULL),
        3: ("Email Address", EMAIL), 4: ("Are you a UBC Student?", c("select", True, ["Yes", "No"])),
        5: ("If applicable, which clubs",
            c("multi_select", False, [ART, "UBC Anime Club", PRINT, "VASA"])),
        6: ("Are you applying for a half table", CHOICE), 7: ("Which days would you prefer", DATES),
        8: ("Do you have any tabling experience", c("text", True)),
        9: ("What will you be selling",
            c("multi_select", True, ["Prints", "Stickers", "Keychains", "Jewelry", "Apparel",
                                     "Woven"])),
        10: ("Please provide a link to your portfolio", c("text", True)),
        11: ("Additional comments", c("text", False)),
    },
    "spring-2026": {
        0: ("STATUS", ORG), 1: ("Timestamp", TS), 2: ("Email Address", EMAIL),
        3: ("Full Legal Name", FULL), 4: ("Preferred Name", PREF), 5: ("Email Address", DUP),
        6: ("Are you a UBC student or alumni?", c("select", True, UBC + [UBC_NO])),
        7: ("Please provide your UBC/alumni/staff", c("email", False)),
        8: ("If you do not have an UBC email", upload(False)),
        9: ("Discord Username", c("text", True)), 10: ("Business Name", c("text", True)),
        11: ("URL to Business", c("text", False)),
        12: ("Do you have any tabling experience", c("text", False)),
        13: ("What will you be selling", c("multi_select", True,
                                           SELL + ["Woven (crochet, knitting, etc)"])),
        14: ("If you plan to sell press-on nails", c("text", False)),
        15: ("Please submit one video", upload(False)),
        16: ("Please submit any additional drafts", upload(False)),
        17: ("Please provide a link to your portfolio", c("text", True)),
        18: ("I certify that the work I will be selling is my own", c("checkbox", True)),
        19: ("UBC Makers Market's mission", c("checkbox", True)),
        20: ("I certify that this application", c("checkbox", True)),
        21: ("I certify that the work I will be selling abides", c("checkbox", True)),
        22: ("Which clubs are you a member of?",
             c("multi_select", True, [NONE_CLUB, ART, ANI, PRINT])),
        23: ("If applicable, please attach proof", upload(False)),
        **{k: ("For each day, choose all table tiers", TIERS) for k in range(24, 29)},
        29: ("Maximum number of days", MAXD), 30: ("Do you want to have a half table", CHOICE),
        31: ("If you chose half table", SHARE),
        32: ("I understand that no-shows", c("checkbox", True)),
        33: ("Additional comments", c("text", False)),
        # Filled by 228 of 248: added to the form after it opened, or optional. Not scored.
        34: ("Please provide a link to a video", c("text", None)),
    },
}

# Google's collected address and the asked one: either may be the applicant's email, as long as
# the other is the duplicate.
EITHER_EMAIL = {"fall-2025": (2, 5), "spring-2026": (2, 5)}

# The two misses the rules were measured with: a clubs question almost nobody answered with two
# clubs, read as one choice. They must come back marked, not silently wrong.
KNOWN_TYPE_MISSES = {("spring-2024", 16), ("spring-2026", 22)}


def _read(name):
    with open(os.path.join(CORPUS, f"{name}.csv"), newline="", encoding="utf-8") as handle:
        rows = list(csv.reader(handle))
    return [header.strip() for header in rows[0]], rows[1:]


def _kind(column):
    """The answer key's word for what a proposed column became."""
    if column["fate"] == "essential":
        return column["essential"]
    if column["fate"] == "left_out":
        return {"organizer": ORG, "duplicate": DUP, "empty": EMPTY}[column["leftOut"]]
    return column["fate"]


def _proposals():
    for name, key in ANSWER_KEY.items():
        headers, rows = _read(name)
        yield name, key, headers, CsvProposal.proposal(headers, rows)


class TestTheAnswerKey:
    def test_every_column_is_where_the_answer_key_expects(self):
        for name, key, headers, proposal in _proposals():
            assert len(proposal["columns"]) == len(key) == len(headers), name
            for index, (prefix, _) in key.items():
                assert " ".join(headers[index].split()).startswith(prefix), (name, index)

    def test_every_columns_kind_is_right(self):
        wrong = []
        for name, key, _, proposal in _proposals():
            columns = proposal["columns"]
            for index, (_, want) in key.items():
                want_kind = "custom" if isinstance(want, dict) else want
                got = _kind(columns[index])
                if name in EITHER_EMAIL and index in EITHER_EMAIL[name]:
                    other = [i for i in EITHER_EMAIL[name] if i != index][0]
                    if {got, _kind(columns[other])} == {EMAIL, DUP}:
                        continue
                if got != want_kind:
                    wrong.append((name, index, want_kind, got))
        assert wrong == []

    def test_types_are_right_but_for_the_two_known_misses(self):
        misses = set()
        for name, key, _, proposal in _proposals():
            for index, (_, want) in key.items():
                if isinstance(want, dict) and proposal["columns"][index]["field"]["type"] != want["type"]:
                    misses.add((name, index))
        assert misses == KNOWN_TYPE_MISSES

    def test_every_upload_is_found_and_marked_to_check(self):
        wrong = []
        for name, key, _, proposal in _proposals():
            for index, (_, want) in key.items():
                if not isinstance(want, dict):
                    continue
                column = proposal["columns"][index]
                marked = CsvProposal.CHECK_UPLOAD in column["check"]
                if column["field"]["upload"] != want["upload"] or marked != want["upload"]:
                    wrong.append((name, index))
        assert wrong == []

    def test_the_known_misses_are_marked_to_check(self):
        for name, key, _, proposal in _proposals():
            for index in (i for n, i in KNOWN_TYPE_MISSES if n == name):
                assert CsvProposal.CHECK_SEVERAL_ANSWERS in proposal["columns"][index]["check"]

    def test_every_required_flag_is_right(self):
        wrong = []
        for name, key, _, proposal in _proposals():
            for index, (_, want) in key.items():
                if isinstance(want, dict) and want["required"] is not None:
                    got = proposal["columns"][index]["field"]["required"]
                    if got != want["required"]:
                        wrong.append((name, index))
        assert wrong == []

    def test_options_are_found_and_none_is_invented(self):
        found = missing = invented = 0
        for name, key, _, proposal in _proposals():
            for index, (_, want) in key.items():
                if not isinstance(want, dict) or not want["options"]:
                    continue
                field = proposal["columns"][index]["field"]
                if field["type"] != want["type"]:
                    continue
                expected = {option.lower() for option in want["options"]}
                kept = {o["value"].lower() for o in field["options"] if o["keep"]}
                found += len(expected & kept)
                missing += len(expected - kept)
                invented += len(kept - expected)
        assert invented == 0
        assert found / (found + missing) >= 0.98


class TestWhatAColumnCarries:
    def _column(self, name, index):
        headers, rows = _read(name)
        return CsvProposal.proposal(headers, rows)["columns"][index]

    def test_a_rare_option_is_listed_with_its_count_and_off(self):
        # "No, I am not a UBC student ..." was chosen by fewer than 3.
        field = self._column("spring-2026", 6)["field"]
        rare = [o for o in field["options"] if o["rare"]]
        assert rare and all(not o["keep"] and o["count"] < 3 for o in rare)
        assert CsvProposal.CHECK_RARE_OPTIONS in self._column("spring-2026", 6)["check"]

    def test_a_checkbox_questions_one_off_answers_are_counted_not_listed(self):
        field = self._column("spring-2024", 12)["field"]
        assert len(field["options"]) <= CsvProposal.OPTIONS_LISTED
        assert field["unlistedOptions"] > 100
        assert all(o["count"] >= 3 for o in field["options"] if o["keep"])

    def test_an_organizers_column_is_left_out_and_marked(self):
        column = self._column("fall-2025", 29)
        assert column["fate"] == "left_out"
        assert CsvProposal.CHECK_ORGANIZER in column["check"]

    def test_a_grids_columns_name_their_stem(self):
        column = self._column("fall-2025", 19)
        assert column["group"].startswith("For each day, choose all table tiers")

    def test_a_headers_first_line_is_the_label_and_the_rest_help_text(self):
        field = self._column("fall-2025", 6)["field"]
        assert field["label"] == "Are you a UBC student or alumni?"
        assert field["helpText"].startswith("NOTE:")
        assert field["key"] == "are_you_a_ubc_student_or_alumni"

    def test_a_first_line_past_120_characters_keeps_its_first_sentence(self):
        long = ("Please provide a link to your portfolio. " + "Instagram, a website or a drive "
                "folder all work, as long as we can see recent pieces of your own work here.")
        label, help_text = CsvProposal.label_and_help(long)
        assert label == "Please provide a link to your portfolio."
        assert help_text.startswith("Instagram, a website")

    def test_a_sentence_does_not_end_inside_parentheses(self):
        long = ("If you do not have an UBC email, please attach proof of affiliation (e.g. a "
                "Workday timetable or a staff card photo). We only use it to check eligibility.")
        label, help_text = CsvProposal.label_and_help(long)
        assert label.endswith("staff card photo).")
        assert help_text == "We only use it to check eligibility."

    def test_a_long_first_line_with_no_sentence_end_breaks_on_a_word(self):
        long = "word " * 40
        label, help_text = CsvProposal.label_and_help(long)
        assert len(label) <= CsvProposal.LABEL_MAX and not label.endswith(" ")
        assert help_text

    def test_a_short_header_is_a_question_not_a_teams_column(self):
        headers = ["Timestamp", "Email Address", "Age"]
        rows = [[f"1/{i + 1}/2026 9:00:00", f"p{i}@mail.test", str(20 + i)] for i in range(5)]
        assert CsvProposal.proposal(headers, rows)["columns"][2]["fate"] == "custom"

    def test_the_organizers_questions_take_their_keys_first(self):
        # A column the team keeps before the form's first one, headed like a question.
        headers = ["Business name", "Timestamp", "Email Address", "Business name"]
        rows = [[f"x{i}", f"1/{i + 1}/2026 9:00:00", f"p{i}@mail.test", f"shop {i}"]
                for i in range(5)]
        columns = CsvProposal.proposal(headers, rows)["columns"]
        assert columns[0]["fate"] == "left_out"
        assert columns[3]["fate"] == "custom" and columns[3]["field"]["key"] == "business_name"

    def test_a_header_with_a_line_break_splits_into_label_and_help_text(self):
        headers = ["Timestamp", "Email Address", "Business name\nAs it should appear on your sign"]
        rows = [["1/1/2026 9:00:00", f"p{i}@mail.test", f"Shop {i}"] for i in range(5)]
        field = CsvProposal.proposal(headers, rows)["columns"][2]["field"]
        assert (field["label"], field["helpText"]) == (
            "Business name", "As it should appear on your sign")
        assert field["key"] == "business_name"

    def test_keys_are_unique_and_capped_at_forty_characters(self):
        headers = ["Email Address", "Tell us about your practice and your materials in detail",
                   "Tell us about your practice and your materials in detail"]
        rows = [[f"p{i}@mail.test", f"a {i}", f"b {i}"] for i in range(5)]
        columns = CsvProposal.proposal(headers, rows)["columns"]
        first, second = columns[1]["field"]["key"], columns[2]["field"]["key"]
        assert len(first) <= 40 and not first.endswith("_")
        assert second == f"{first}_2"

    def test_an_essential_no_column_answers_is_not_asked(self):
        headers, rows = _read("fall-2023")
        not_asked = {e["key"] for e in CsvProposal.proposal(headers, rows)["notAsked"]}
        assert PREF in not_asked and TIERS in not_asked
        assert FULL not in not_asked

    def test_no_days_column_is_said_to_mean_no_personal_limit(self):
        """Said where the organizer decides, not discovered at the import (bug 24)."""
        headers, rows = _read("fall-2023")
        why = {e["key"]: e["why"] for e in CsvProposal.proposal(headers, rows)["notAsked"]}
        assert "up to your ceiling" in why["essential_max_dates"]
        assert "Online applicants are still asked" in why["essential_max_dates"]

    def test_a_how_many_days_question_answered_with_numbers_is_the_limit(self):
        headers = ["Email Address", "How many days would you like to table?"]
        rows = [[f"p{i}@mail.test", str(1 + i % 3)] for i in range(9)]
        column = CsvProposal.proposal(headers, rows)["columns"][1]
        assert column["essential"] == "essential_max_dates"

    def test_a_number_question_about_anything_else_stays_the_organizers(self):
        headers = ["Email Address", "How many years have you been making?"]
        rows = [[f"p{i}@mail.test", str(1 + i % 3)] for i in range(9)]
        column = CsvProposal.proposal(headers, rows)["columns"][1]
        assert column["essential"] is None


def _market(phase="draft", fields=None):
    return {"id": "market-1", "phase": phase, "applicationForm": {"fields": fields or []}}


class TestWhoMayAsk:
    CSV = "Timestamp,Email Address\n1/1/2026 9:00:00,a@mail.test\n"

    def test_a_draft_with_no_questions_of_its_own_gets_a_proposal(self):
        result, status = CsvProposal.propose(_market(), self.CSV)
        assert status == 200
        assert [c["fate"] for c in result["columns"]] == ["submitted_at", "applicant_email"]

    def test_a_market_past_draft_is_refused_with_the_reason(self):
        result, status = CsvProposal.propose(_market(phase="applications_open"), self.CSV)
        assert status == 409
        assert "draft" in result["error"]

    def test_a_form_with_questions_of_its_own_is_refused_with_the_reason(self):
        fields = [{"key": "shop", "label": "Shop", "type": "text"}]
        result, status = CsvProposal.propose(_market(fields=fields), self.CSV)
        assert status == 409
        assert "questions of its own" in result["error"]

    def test_an_unreadable_file_is_a_bad_request(self):
        result, status = CsvProposal.propose(_market(), "")
        assert status == 400
