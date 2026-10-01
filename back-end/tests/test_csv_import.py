"""Importing vendors from a Google Forms CSV export.

The organizer maps each column to the question it answers, and every row goes through the shared
application-write path - so an imported application is the same kind of document as one submitted
through the public form.

This first cut covers the one-to-one case: every target served by exactly one column, and cell
values already naming what the market offers.
"""
import pytest

from conftest import FakeMarketsCollection, stored_market

import csv_import as CsvImport
import essential_fields as EssentialFields
from datatypes import ApplicationStatus, MarketPhase


DATES = ["2026-08-01", "2026-08-08"]
SECTIONS = ["Main Hall", "Garden"]
TIERS = ["Gold", "Silver"]

SETUP_CAMEL = {
    "priority": [],
    "marketDates": [{"date": date} for date in DATES],
    "tiers": [{"id": index, "name": name} for index, name in enumerate(TIERS)],
    "locations": [],
    "sections": [{"name": name, "count": 4} for name in SECTIONS],
    "assignmentOptions": {}, "floorplans": [],
}

FORM_FIELDS = [
    {"key": "business_name", "label": "Business Name", "type": "text", "required": True,
     "options": [], "order": 0},
]

# Headers as a Google Form actually writes them: the organizer's own question text.
HEADERS = [
    "Timestamp",
    "Email Address",
    "Full Legal Name",
    "Business name",
    "Which days can you attend?",
    "How many days do you want?",
    "Which tiers will you accept?",
    "Full or half table?",
    "Partner's email if sharing",
    "Rank the sections",
]

MAPPING = {
    CsvImport.SUBMITTED_AT_TARGET: 0,
    CsvImport.APPLICANT_EMAIL_TARGET: 1,
    EssentialFields.FULL_NAME_KEY: 2,
    "business_name": 3,
    EssentialFields.AVAILABLE_DATES_KEY: 4,
    EssentialFields.MAX_DATES_KEY: 5,
    EssentialFields.TIER_PREFERENCE_KEY: 6,
    EssentialFields.TABLE_CHOICE_KEY: 7,
    EssentialFields.TABLE_SHARE_EMAIL_KEY: 8,
    EssentialFields.SECTION_RANKING_KEY: 9,
}


def _csv(*rows: str) -> str:
    return "\n".join([",".join(HEADERS), *rows])


GOOD_ROW = (
    '2026/05/02 9:14:03,nadia@ember.ca,Nadia Okonkwo,Ember Ceramics,'
    '"2026-08-01, 2026-08-08",2,Gold,half,buddy@ember.ca,"Garden, Main Hall"'
)


def _market_doc(setup=None, fields=None, **overrides):
    return stored_market(
        setupObject=setup or SETUP_CAMEL,
        applicationForm={
            "fields": FORM_FIELDS if fields is None else fields,
            "essentialOptions": None,
        },
        **overrides,
    )


@pytest.fixture
def markets():
    return FakeMarketsCollection(_market_doc())


class TestImportTargets:
    def test_identity_and_submission_time_are_targets_beside_the_questions(self, markets):
        keys = [t.key for t in CsvImport.import_targets(markets.doc)]

        assert CsvImport.APPLICANT_EMAIL_TARGET in keys
        assert CsvImport.SUBMITTED_AT_TARGET in keys
        assert "business_name" in keys

    def test_only_the_email_and_the_asked_questions_are_required(self, markets):
        targets = {t.key: t for t in CsvImport.import_targets(markets.doc)}

        assert targets[CsvImport.APPLICANT_EMAIL_TARGET].required
        assert not targets[CsvImport.SUBMITTED_AT_TARGET].required
        assert not targets[EssentialFields.TABLE_SHARE_EMAIL_KEY].required

    def test_a_question_that_is_not_asked_is_not_a_target(self, markets):
        """Table type is stubbed to one type, so mapping a column to it would be discarded."""
        keys = [t.key for t in CsvImport.import_targets(markets.doc)]

        assert EssentialFields.TABLE_TYPE_RANKING_KEY not in keys

    def test_a_market_with_one_section_does_not_offer_section_ranking(self):
        doc = _market_doc({**SETUP_CAMEL, "sections": [{"name": "Main Hall", "count": 4}]})

        keys = [t.key for t in CsvImport.import_targets(doc)]

        assert EssentialFields.SECTION_RANKING_KEY not in keys


class TestInspect:
    def test_it_returns_the_columns_with_sample_values(self, markets):
        body, status = CsvImport.inspect(markets.doc, _csv(GOOD_ROW))

        assert status == 200
        assert body["headers"] == HEADERS
        assert body["rowCount"] == 1
        assert body["sampleValues"][1] == ["nadia@ember.ca"]

    def test_the_google_forms_columns_are_offered_without_asking(self, markets):
        body, _ = CsvImport.inspect(markets.doc, _csv(GOOD_ROW))

        assert body["suggestedMapping"][CsvImport.SUBMITTED_AT_TARGET] == 0
        assert body["suggestedMapping"][CsvImport.APPLICANT_EMAIL_TARGET] == 1

    def test_nothing_else_is_guessed(self, markets):
        """Guessing beyond the two known headers makes the organizer audit our guesses."""
        body, _ = CsvImport.inspect(markets.doc, _csv(GOOD_ROW))

        assert set(body["suggestedMapping"]) == {
            CsvImport.SUBMITTED_AT_TARGET, CsvImport.APPLICANT_EMAIL_TARGET,
        }

    def test_an_empty_file_is_refused(self, markets):
        body, status = CsvImport.inspect(markets.doc, "")

        assert status == 400 and "empty" in body["error"]

    def test_a_quoted_comma_does_not_split_a_column(self, markets):
        """A Google Forms answer routinely contains a comma."""
        body, _ = CsvImport.inspect(markets.doc, _csv(GOOD_ROW))

        assert body["sampleValues"][4] == ["2026-08-01, 2026-08-08"]


class TestImportApplications:
    def test_a_row_becomes_an_application_awaiting_review(self, markets, applications):
        body, status = CsvImport.import_applications(
            markets, markets.doc, _csv(GOOD_ROW), MAPPING,
        )

        assert status == 200, body
        assert body["created"] == 1 and body["skipped"] == 0
        stored = applications.find_one({"applicant_email": "nadia@ember.ca"})
        assert stored["status"] == ApplicationStatus.OPEN.value

    def test_an_imported_row_carries_its_real_submission_time(self, markets, applications):
        """The constraint a first-come-first-served priority rule rests on.

        If every imported row took the time of import they would all be identical, and the rule
        would silently do nothing for exactly the markets this MVP serves.
        """
        CsvImport.import_applications(markets, markets.doc, _csv(GOOD_ROW), MAPPING)

        stored = applications.find_one({"applicant_email": "nadia@ember.ca"})
        assert stored["submitted_at"], "the Timestamp column must reach submitted_at"
        assert stored["submitted_at"].startswith("2026"), (
            f"expected the row's own timestamp, got {stored['submitted_at']!r}"
        )

    def test_two_rows_keep_distinct_submission_times(self, markets, applications):
        later = GOOD_ROW.replace("2026/05/02 9:14:03", "2026/06/30 17:45:00").replace(
            "nadia@ember.ca", "second@ember.ca", 1
        )
        CsvImport.import_applications(
            markets, markets.doc, _csv(GOOD_ROW, later), MAPPING,
        )

        first = applications.find_one({"applicant_email": "nadia@ember.ca"})["submitted_at"]
        second = applications.find_one({"applicant_email": "second@ember.ca"})["submitted_at"]
        assert first != second, (
            "identical timestamps would make first-come-first-served decide nothing"
        )
        assert first < second

    def test_answers_land_in_their_stored_shapes(self, markets, applications):
        """Through the shared write path, so identical to a form submission."""
        CsvImport.import_applications(markets, markets.doc, _csv(GOOD_ROW), MAPPING)

        data = applications.find_one({"applicant_email": "nadia@ember.ca"})["form_data"]
        assert data["business_name"] == "Ember Ceramics"
        assert data["essential_available_dates"] == DATES
        assert data["essential_max_dates"] == 2
        # Per date (E01/F05). This row asked once, so "Gold" applies to every date it can attend.
        assert data["essential_tier_preference"] == {date: ["Gold"] for date in DATES}
        assert data["essential_table_choice"] == "half"
        assert data["essential_table_share_email"] == "buddy@ember.ca"
        assert data["essential_section_ranking"] == ["Garden", "Main Hall"]

    def test_submission_time_comes_from_the_file_not_the_import(self, markets, applications):
        """Otherwise every row shares one timestamp and first-come-first-served does nothing.

        Stored as ISO (E01/F04/S02): the file's own moment, in the one shape every reader compares.
        The row says ``2026/05/02 9:14:03``; what matters is that it is that moment and not today.
        """
        CsvImport.import_applications(markets, markets.doc, _csv(GOOD_ROW), MAPPING)

        stored = applications.find_one({"applicant_email": "nadia@ember.ca"})
        assert stored["submitted_at"] == "2026-05-02T09:14:03"

    def test_an_unmapped_required_target_imports_nothing(self, markets, applications):
        partial = {k: v for k, v in MAPPING.items() if k != EssentialFields.TIER_PREFERENCE_KEY}

        body, status = CsvImport.import_applications(
            markets, markets.doc, _csv(GOOD_ROW), partial,
        )

        assert status == 422
        assert "Tier preference" in body["error"]
        assert applications.documents == []

    def test_an_unmapped_optional_target_is_fine(self, markets, applications):
        partial = {k: v for k, v in MAPPING.items() if k != EssentialFields.TABLE_SHARE_EMAIL_KEY}

        body, status = CsvImport.import_applications(
            markets, markets.doc, _csv(GOOD_ROW), partial,
        )

        assert status == 200 and body["created"] == 1

    def test_a_column_outside_the_file_is_refused(self, markets, applications):
        body, status = CsvImport.import_applications(
            markets, markets.doc, _csv(GOOD_ROW), {**MAPPING, "business_name": 99},
        )

        assert status == 400 and "not in this file" in body["error"]
        assert applications.documents == []

    def test_a_row_with_no_email_is_skipped_and_named(self, markets, applications):
        blank = GOOD_ROW.replace("nadia@ember.ca,Nadia Okonkwo", ",Nadia Okonkwo")

        body, _ = CsvImport.import_applications(
            markets, markets.doc, _csv(blank, GOOD_ROW), MAPPING,
        )

        assert body["created"] == 1 and body["skipped"] == 1
        assert body["failures"][0]["row"] == 2
        assert "email" in body["failures"][0]["error"].lower()

    def test_one_bad_row_does_not_stop_the_others(self, markets, applications):
        """Refuse at the mapping level, tolerate at the row level.

        A row-level fault is one only that row has - here a max-dates answer that is not a number.
        A cell value that names nothing the market offers is NOT one of these: it is the same
        decision for every row carrying it, so it is settled before anything is written.
        """
        bad = GOOD_ROW.replace("nadia@ember.ca", "kai@ember.ca").replace(",2,Gold,", ",lots,Gold,")

        body, _ = CsvImport.import_applications(
            markets, markets.doc, _csv(GOOD_ROW, bad), MAPPING,
        )

        assert body["created"] == 1
        assert body["skipped"] == 1
        assert body["failures"][0]["email"] == "kai@ember.ca"
        assert "whole number" in body["failures"][0]["error"]

    def test_a_skipped_row_names_its_spreadsheet_line(self, markets, applications):
        """Row 1 is the header, so the organizer can find row 3 in their own file."""
        bad = GOOD_ROW.replace("nadia@ember.ca", "kai@ember.ca").replace(",2,Gold,", ",lots,Gold,")

        body, _ = CsvImport.import_applications(
            markets, markets.doc, _csv(GOOD_ROW, bad), MAPPING,
        )

        assert body["failures"][0]["row"] == 3

    def test_email_is_lowercased_so_one_applicant_is_one_applicant(self, markets, applications):
        shouty = GOOD_ROW.replace("nadia@ember.ca", "Nadia@Ember.CA")

        CsvImport.import_applications(markets, markets.doc, _csv(shouty), MAPPING)

        assert applications.find_one({"applicant_email": "nadia@ember.ca"}) is not None


# A Google Forms CHECKBOX GRID exports one column per option, the header carrying the question
# stem and the option in brackets. The same question asked once exports as a single
# comma-separated column. Both mean the same thing, and both must import identically.
GRID_HEADERS = [
    "Timestamp",
    "Email Address",
    "Full Legal Name",
    "Business name",
    "Which days can you attend? [2026-08-01]",
    "Which days can you attend? [2026-08-08]",
    "How many days do you want?",
    "Which tiers will you accept?",
    "Full or half table?",
    "Partner's email if sharing",
    "Rank the sections [Main Hall]",
    "Rank the sections [Garden]",
]

GRID_MAPPING = {
    CsvImport.SUBMITTED_AT_TARGET: 0,
    CsvImport.APPLICANT_EMAIL_TARGET: 1,
    EssentialFields.FULL_NAME_KEY: 2,
    "business_name": 3,
    EssentialFields.AVAILABLE_DATES_KEY: [4, 5],
    EssentialFields.MAX_DATES_KEY: 6,
    EssentialFields.TIER_PREFERENCE_KEY: 7,
    EssentialFields.TABLE_CHOICE_KEY: 8,
    EssentialFields.TABLE_SHARE_EMAIL_KEY: 9,
    EssentialFields.SECTION_RANKING_KEY: [10, 11],
}


def _grid_csv(*rows: str) -> str:
    return "\n".join([",".join(GRID_HEADERS), *rows])


# Ticked on both days; ranks Garden first by saying so in the grid's own cells.
GRID_ROW = (
    "2026/05/02 9:14:03,nadia@ember.ca,Nadia Okonkwo,Ember Ceramics,"
    "Yes,Yes,2,Gold,half,,2nd choice,1st choice"
)


class TestTheNameIsAnImportTarget:
    """The Fall 2025 export's "Full Legal Name" had nowhere to go, so the import dropped it."""

    def test_full_name_is_offered_as_a_target(self, markets):
        targets = {t.key: t for t in CsvImport.import_targets(markets.doc)}

        assert EssentialFields.FULL_NAME_KEY in targets
        assert targets[EssentialFields.FULL_NAME_KEY].label == "Full name"
        assert targets[EssentialFields.FULL_NAME_KEY].required is True

    def test_it_is_offered_even_by_a_market_whose_plan_offers_nothing(self):
        bare = _market_doc(setup={
            "priority": [], "marketDates": [], "tiers": [], "locations": [],
            "sections": [], "assignmentOptions": {}, "floorplans": [],
        })

        keys = [t.key for t in CsvImport.import_targets(bare)]

        assert EssentialFields.FULL_NAME_KEY in keys

    def test_a_name_column_lands_on_the_application(self, markets, applications):
        body, status = CsvImport.import_applications(
            markets, markets.doc, _csv(GOOD_ROW), MAPPING,
        )

        assert status == 200, body
        data = applications.find_one({"applicant_email": "nadia@ember.ca"})["form_data"]
        assert data[EssentialFields.FULL_NAME_KEY] == "Nadia Okonkwo"

    def test_a_whole_name_is_never_split(self, markets, applications):
        row = GOOD_ROW.replace("Nadia Okonkwo", "Jan van der Berg")

        CsvImport.import_applications(markets, markets.doc, _csv(row), MAPPING)

        data = applications.find_one({"applicant_email": "nadia@ember.ca"})["form_data"]
        assert data[EssentialFields.FULL_NAME_KEY] == "Jan van der Berg"

    def test_a_row_with_no_name_is_refused_with_its_line_number(self, markets, applications):
        nameless = GOOD_ROW.replace(",Nadia Okonkwo,", ",,")

        body, _ = CsvImport.import_applications(
            markets, markets.doc, _csv(nameless), MAPPING,
        )

        assert body["created"] == 0
        assert "Full name" in body["failures"][0]["error"]


class TestWhatASingleColumnCannotSay:
    """A checkbox question's export is ambiguous only when an option is made of other options.

    Google joins the selected labels with commas and throws the separator information away. An
    option with a comma of its own is read whole, because the import knows the options (bug 27);
    but offered "Prints, Cards" beside "Prints" and "Cards", the cell "Prints, Cards" is one answer
    or two and nothing can tell which. The product says so rather than guessing.
    """

    def test_a_market_whose_every_label_is_comma_free_names_nothing(self, markets):
        # Tiers are "Gold" and "Silver", sections "Main Hall" and "Garden", and a market date is
        # offered as the stored "2026-08-01" - splitting any of those columns on commas is exact.
        body, status = CsvImport.inspect(markets.doc, _csv(GOOD_ROW))

        assert status == 200
        assert body["commaBearingTargets"] == []

    def test_dates_are_not_named_because_the_offering_is_the_stored_day(self, markets):
        """A market date is offered as "2026-08-01", not as the sentence an applicant read.

        This is the one the finding named, and it is wrong about it: the long spelling with its
        two commas is how the *applicant form* renders a date, while what a column is matched
        against is the stored day. A heading the organizer wrote themselves still has to be
        resolved by hand, which is the reconciliation screen's job, not this warning's.
        """
        body, _ = CsvImport.inspect(markets.doc, _csv(GOOD_ROW))

        assert EssentialFields.AVAILABLE_DATES_KEY not in body["commaBearingTargets"]

    def test_a_single_value_target_is_never_named(self, markets):
        """Its answer is the whole cell, so a comma in a label costs nothing.

        Table choice earns this twice over: "A whole table to myself" holds no comma, but "Half a
        table, shared" does, and it still must not warn.
        """
        body, _ = CsvImport.inspect(markets.doc, _csv(GOOD_ROW))

        assert EssentialFields.TABLE_CHOICE_KEY not in body["commaBearingTargets"]
        assert CsvImport.APPLICANT_EMAIL_TARGET not in body["commaBearingTargets"]

    def test_a_section_named_with_a_comma_is_read_whole_and_not_named(self, markets):
        doc = _market_doc(setup={**SETUP_CAMEL, "sections": [
            {"name": "Hall A, west end", "count": 4},
            {"name": "Garden", "count": 4},
        ]})

        body, _ = CsvImport.inspect(doc, _csv(GOOD_ROW))

        assert EssentialFields.SECTION_RANKING_KEY not in body["commaBearingTargets"]

    def test_an_option_made_of_other_options_is_named(self):
        """The rule follows the market's own words, not a fixed list of targets."""
        doc = _market_doc(fields=[{
            "key": "craft", "label": "What do you make?", "type": "multi_select",
            "required": False, "order": 0,
            "options": ["Prints", "Cards", "Prints, Cards"],
        }])

        body, _ = CsvImport.inspect(doc, _csv(GOOD_ROW))

        assert "craft" in body["commaBearingTargets"]

    def test_an_option_with_a_comma_of_its_own_is_not_named(self):
        doc = _market_doc(fields=[{
            "key": "craft", "label": "What do you make?", "type": "multi_select",
            "required": False, "order": 0,
            "options": ["Ceramics", "Jewellery, fine", "Prints"],
        }])

        body, _ = CsvImport.inspect(doc, _csv(GOOD_ROW))

        assert "craft" not in body["commaBearingTargets"]

    def test_a_single_select_question_is_not_named_however_its_options_read(self):
        doc = _market_doc(fields=[{
            "key": "craft", "label": "What do you make?", "type": "select",
            "required": False, "order": 0,
            "options": ["Ceramics", "Jewellery, fine"],
        }])

        body, _ = CsvImport.inspect(doc, _csv(GOOD_ROW))

        assert "craft" not in body["commaBearingTargets"]


class TestSplittingAnAnswer:
    """Google joins a checkbox answer's options with ", ", and an option can hold ", " too.

    Splitting at every comma cost applicants their answers and made the organizer match halves of
    days (bug 27).
    """

    @pytest.mark.parametrize("cell, known, parts", [
        ("Woven (crochet, knitting, etc), Prints", (), ["Woven (crochet, knitting, etc)", "Prints"]),
        ("Monday, November 20th, Tuesday, November 21st", (),
         ["Monday, November 20th", "Tuesday, November 21st"]),
        ("Saturday, Sunday", (), ["Saturday", "Sunday"]),
        ("Prints, cards and zines, Stickers", ("Prints, cards and zines", "Stickers"),
         ["Prints, cards and zines", "Stickers"]),
        ("prints, CARDS and zines", ("Prints, cards and zines",), ["prints, CARDS and zines"]),
        ("Gold Plus, Gold", ("Gold", "Gold Plus"), ["Gold Plus", "Gold"]),
        ("Gold, Silver", ("Gold", "Silver"), ["Gold", "Silver"]),
    ])
    def test_an_option_with_a_comma_of_its_own_stays_whole(self, cell, known, parts):
        assert CsvImport.split_options(cell, known) == parts

    def test_an_option_the_organizer_already_matched_is_read_whole(self, markets, applications):
        """A value matched once names itself thereafter, so its commas are its own too."""
        resolutions = {EssentialFields.AVAILABLE_DATES_KEY: {
            "Sat Aug 1, morning": "2026-08-01", "Sat Aug 8, morning": "2026-08-08",
        }}
        row = GOOD_ROW.replace('"2026-08-01, 2026-08-08"', '"Sat Aug 1, morning, Sat Aug 8, morning"')

        body, _ = CsvImport.import_applications(
            markets, markets.doc, _csv(row), MAPPING, resolutions,
        )

        assert body["created"] == 1, body
        data = applications.find_one({"applicant_email": "nadia@ember.ca"})["form_data"]
        assert data["essential_available_dates"] == DATES

    def test_one_day_spelled_two_ways_is_one_day(self, markets, applications):
        """Matching two spellings to one date refused the row for repeating it."""
        resolutions = {EssentialFields.AVAILABLE_DATES_KEY: {"Saturday, August 1st": "2026-08-01"}}
        row = GOOD_ROW.replace('"2026-08-01, 2026-08-08"', '"2026-08-01, Saturday, August 1st"')

        body, _ = CsvImport.import_applications(
            markets, markets.doc, _csv(row), MAPPING, resolutions,
        )

        assert body["created"] == 1, body
        data = applications.find_one({"applicant_email": "nadia@ember.ca"})["form_data"]
        assert data["essential_available_dates"] == ["2026-08-01"]


class TestADayInWords:
    """A Google Form names a day as the organizer typed it, and only an ISO date used to match, so
    a tier grid's day headings could not be matched at all (bug 26)."""

    PLAN = ["2026-10-03", "2026-10-10"]

    @pytest.mark.parametrize("text, date", [
        ("Saturday, October 3", "2026-10-03"),
        ("Saturday, October 3, 2026", "2026-10-03"),
        ("Oct 10th", "2026-10-10"),
        ("Saturday, October 3, 2025", None),   # a year that disagrees
        ("Sunday, October 3", None),           # a weekday that disagrees
        ("October 17", None),                  # not a plan date
        ("Second Saturday", None),             # not a date at all
    ])
    def test_a_day_names_the_one_plan_date_it_means(self, text, date):
        assert CsvImport.plan_date_named(text, self.PLAN) == date

    def test_a_day_two_plan_dates_share_names_neither(self):
        assert CsvImport.plan_date_named("October 3", ["2025-10-03", "2026-10-03"]) is None

    HEADERS = [
        "Timestamp", "Email Address", "Full Legal Name", "Business name",
        '"Tiers? [Saturday, August 1]"', '"Tiers? [Second Saturday]"',
        "How many days do you want?", "Full or half table?", "Rank the sections",
    ]
    GRID_MAPPING = {
        CsvImport.SUBMITTED_AT_TARGET: 0,
        CsvImport.APPLICANT_EMAIL_TARGET: 1,
        EssentialFields.FULL_NAME_KEY: 2,
        "business_name": 3,
        EssentialFields.TIER_PREFERENCE_KEY: [4, 5],
        EssentialFields.MAX_DATES_KEY: 6,
        EssentialFields.TABLE_CHOICE_KEY: 7,
        EssentialFields.SECTION_RANKING_KEY: 8,
    }

    def _file(self, *cells):
        row = '2026/05/02 9:14:03,nadia@ember.ca,Nadia Okonkwo,Ember Ceramics,{},{},1,half,"Garden, Main Hall"'
        return "\n".join([",".join(self.HEADERS), row.format(*cells)])

    def test_a_heading_that_names_no_date_is_offered_the_plans_dates(self, markets):
        body, _ = CsvImport.preview_values(markets.doc, self._file("Gold", "Silver"), self.GRID_MAPPING)

        assert [(u["value"], u["offered"]) for u in body["unmatched"]] == [
            ("Second Saturday", DATES),
        ]

    @pytest.mark.parametrize("unavailable", ["None", "Not available", "N/A", "Unavailable"])
    def test_not_available_means_not_available(self, markets, applications, unavailable):
        resolutions = {EssentialFields.TIER_PREFERENCE_KEY: {"Second Saturday": "2026-08-08"}}

        body, _ = CsvImport.import_applications(
            markets, markets.doc, self._file("Gold", unavailable), self.GRID_MAPPING, resolutions,
        )

        assert body["created"] == 1, body
        data = applications.find_one({"applicant_email": "nadia@ember.ca"})["form_data"]
        assert data["essential_tier_preference"] == {"2026-08-01": ["Gold"]}
        assert data["essential_available_dates"] == ["2026-08-01"]


class TestAFormThatNeverAskedHowManyDays:
    """Most real forms never asked how many dates an applicant wants, and demanding the column
    blocked three of five real exports with no way through (bug 24). A row without it has no
    personal limit; the solver bounds it by availability and the market's ceiling."""

    NO_DAYS = {k: v for k, v in MAPPING.items() if k != EssentialFields.MAX_DATES_KEY}

    def test_it_is_not_a_required_target(self, markets):
        targets = {t.key: t for t in CsvImport.import_targets(markets.doc)}

        assert not targets[EssentialFields.MAX_DATES_KEY].required
        resolved = {key: [index] for key, index in self.NO_DAYS.items()}
        assert CsvImport.unserved_required(list(targets.values()), resolved) == []

    def test_a_file_without_the_column_imports_with_no_personal_limit(self, markets, applications):
        preview, _ = CsvImport.preview_values(markets.doc, _csv(GOOD_ROW), self.NO_DAYS)
        body, status = CsvImport.import_applications(
            markets, markets.doc, _csv(GOOD_ROW), self.NO_DAYS,
        )

        assert preview["validRows"] == 1
        assert status == 200 and body["created"] == 1, body
        data = applications.find_one({"applicant_email": "nadia@ember.ca"})["form_data"]
        assert data["essential_max_dates"] is None

    def test_a_blank_answer_in_a_mapped_column_is_no_personal_limit_too(self, markets, applications):
        row = GOOD_ROW.replace(",2,Gold,", ",,Gold,")

        body, _ = CsvImport.import_applications(markets, markets.doc, _csv(row), MAPPING)

        assert body["created"] == 1, body
        data = applications.find_one({"applicant_email": "nadia@ember.ca"})["form_data"]
        assert data["essential_max_dates"] is None

    def test_an_answer_that_is_not_a_number_is_still_refused(self, markets):
        row = GOOD_ROW.replace(",2,Gold,", ",lots,Gold,")

        body, _ = CsvImport.preview_values(markets.doc, _csv(row), MAPPING)

        assert "whole number" in body["failures"][0]["error"]


class TestACheckboxQuestion:
    """A Google Form exports a ticked box as the box's own text, and an unticked one as nothing.

    Reading only "true"/"yes" as ticked turned every ticked certification into an unticked one, so
    a market started from its Google Form refused every applicant on a required box (bug 2).
    """

    CERTIFY = "I certify that the work is my own"
    FIELDS = FORM_FIELDS + [{
        "key": "certify", "label": CERTIFY, "type": "checkbox", "required": True,
        "options": [], "order": 1,
    }]

    def _import(self, cell):
        markets = FakeMarketsCollection(_market_doc(fields=self.FIELDS))
        csv_text = "\n".join([",".join([*HEADERS, self.CERTIFY]), f"{GOOD_ROW},{cell}"])
        return CsvImport.import_applications(
            markets, markets.doc, csv_text, {**MAPPING, "certify": len(HEADERS)},
        )

    @pytest.mark.parametrize("cell", [f'"{CERTIFY}"', "Yes", "TRUE", "checked"])
    def test_a_ticked_box_reads_as_ticked(self, applications, cell):
        body, _ = self._import(cell)

        assert body["created"] == 1, body
        stored = applications.find_one({"applicant_email": "nadia@ember.ca"})
        assert stored["form_data"]["certify"] is True

    @pytest.mark.parametrize("cell", ["", "No", "FALSE", "0"])
    def test_an_unticked_box_still_fails_a_required_certification(self, applications, cell):
        body, _ = self._import(cell)

        assert body["created"] == 0
        assert body["failures"][0]["error"] == f"'{self.CERTIFY}' is required."


class TestColumnGroups:
    def test_a_grid_is_detected_as_one_question(self, markets):
        body, _ = CsvImport.inspect(markets.doc, _grid_csv(GRID_ROW))

        stems = {group["stem"]: group for group in body["groups"]}
        assert "Which days can you attend?" in stems
        assert stems["Which days can you attend?"]["columns"] == [4, 5]
        assert stems["Which days can you attend?"]["options"] == ["2026-08-01", "2026-08-08"]

    def test_a_lone_bracketed_column_is_not_a_group(self, markets):
        """One column is not a grid; grouping it would invent structure that is not there."""
        headers = ["Email Address", "Which days can you attend? [2026-08-01]"]
        body, _ = CsvImport.inspect(markets.doc, ",".join(headers) + "\nx@y.z,Yes")

        assert body["groups"] == []

    def test_plain_headers_produce_no_groups(self, markets):
        body, _ = CsvImport.inspect(markets.doc, _csv(GOOD_ROW))

        assert body["groups"] == []


class TestImportingAGrid:
    def test_both_export_shapes_produce_the_same_answers(self, markets, applications):
        """The point of the story: one question, two spellings, one stored document."""
        CsvImport.import_applications(markets, markets.doc, _grid_csv(GRID_ROW), GRID_MAPPING)
        from_grid = applications.find_one({"applicant_email": "nadia@ember.ca"})["form_data"]

        applications.documents.clear()
        CsvImport.import_applications(markets, markets.doc, _csv(GOOD_ROW), MAPPING)
        from_single = applications.find_one({"applicant_email": "nadia@ember.ca"})["form_data"]

        assert from_grid["essential_available_dates"] == from_single["essential_available_dates"]
        assert from_grid["essential_section_ranking"] == from_single["essential_section_ranking"]

    def test_an_unticked_option_is_not_selected(self, markets, applications):
        one_day = GRID_ROW.replace("Ember Ceramics,Yes,Yes,2", "Ember Ceramics,Yes,,1")

        CsvImport.import_applications(markets, markets.doc, _grid_csv(one_day), GRID_MAPPING)

        data = applications.find_one({"applicant_email": "nadia@ember.ca"})["form_data"]
        assert data["essential_available_dates"] == ["2026-08-01"]

    def test_a_ranking_grid_is_ordered_by_what_the_cells_say(self, markets, applications):
        """A multiple-choice grid records the rank in the cell; column order is only the tiebreak."""
        CsvImport.import_applications(markets, markets.doc, _grid_csv(GRID_ROW), GRID_MAPPING)

        data = applications.find_one({"applicant_email": "nadia@ember.ca"})["form_data"]
        assert data["essential_section_ranking"] == ["Garden", "Main Hall"]

    def test_a_ranking_grid_with_no_ranks_falls_back_to_column_order(self, markets, applications):
        """The only ordering information left is the order the organizer wrote the options in."""
        ticked = GRID_ROW.replace(",2nd choice,1st choice", ",Yes,Yes")

        CsvImport.import_applications(markets, markets.doc, _grid_csv(ticked), GRID_MAPPING)

        data = applications.find_one({"applicant_email": "nadia@ember.ca"})["form_data"]
        assert data["essential_section_ranking"] == ["Main Hall", "Garden"]

    def test_a_grid_column_outside_the_file_is_refused(self, markets, applications):
        broken = {**GRID_MAPPING, EssentialFields.AVAILABLE_DATES_KEY: [3, 99]}

        body, status = CsvImport.import_applications(
            markets, markets.doc, _grid_csv(GRID_ROW), broken,
        )

        assert status == 400 and "not in this file" in body["error"]
        assert applications.documents == []


class TestMatchingCellValues:
    """The organizer's own words against the market's configuration.

    A form that said "Gold Tier" has to reach a tier called "Gold". Trivial differences are matched
    silently; everything left over is one decision per distinct value, not one per row.
    """

    def test_trivial_differences_are_matched_without_asking(self, markets, applications):
        for spelling in ("  Gold  ", "gold", "GOLD"):
            applications.documents.clear()
            row = GOOD_ROW.replace(",Gold,", f",{spelling},")

            body, status = CsvImport.import_applications(
                markets, markets.doc, _csv(row), MAPPING,
            )

            assert status == 200, f"{spelling!r} should have matched: {body}"
            data = applications.find_one({"applicant_email": "nadia@ember.ca"})["form_data"]
            # Per date (E01/F05). This row asked once, so "Gold" applies to every date it can attend.
        assert data["essential_tier_preference"] == {date: ["Gold"] for date in DATES}

    def test_an_unmatched_value_is_reported_once_with_its_row_count(self, markets):
        rows = [GOOD_ROW.replace(",Gold,", ",Gold Tier,")] * 3

        body, status = CsvImport.preview_values(markets.doc, _csv(*rows), MAPPING)

        assert status == 200
        assert len(body["unmatched"]) == 1
        entry = body["unmatched"][0]
        assert entry["value"] == "Gold Tier"
        assert entry["rows"] == 3
        assert entry["targetLabel"] == EssentialFields.TIER_PREFERENCE_LABEL
        assert entry["offered"] == TIERS

    def test_a_matching_file_has_nothing_to_resolve(self, markets):
        body, _ = CsvImport.preview_values(markets.doc, _csv(GOOD_ROW), MAPPING)

        assert body["unmatched"] == []

    def test_an_unresolved_value_imports_nothing(self, markets, applications):
        row = GOOD_ROW.replace(",Gold,", ",Gold Tier,")

        body, status = CsvImport.import_applications(markets, markets.doc, _csv(row), MAPPING)

        assert status == 422
        assert "Gold Tier" in body["error"]
        assert applications.documents == []

    def test_a_resolution_is_applied_to_every_row_carrying_the_value(self, markets, applications):
        rows = [
            GOOD_ROW.replace(",Gold,", ",Gold Tier,"),
            GOOD_ROW.replace("nadia@ember.ca", "kai@ember.ca").replace(",Gold,", ",Gold Tier,"),
        ]
        resolutions = {EssentialFields.TIER_PREFERENCE_KEY: {"Gold Tier": "Gold"}}

        body, status = CsvImport.import_applications(
            markets, markets.doc, _csv(*rows), MAPPING, resolutions,
        )

        assert status == 200, body
        assert body["created"] == 2
        for email in ("nadia@ember.ca", "kai@ember.ca"):
            data = applications.find_one({"applicant_email": email})["form_data"]
            # Per date (E01/F05). This row asked once, so "Gold" applies to every date it can attend.
        assert data["essential_tier_preference"] == {date: ["Gold"] for date in DATES}

    def test_a_value_can_be_explicitly_ignored(self, markets, applications):
        """Not every stray answer means something; dropping one is a decision the organizer makes."""
        row = GOOD_ROW.replace('"2026-08-01, 2026-08-08"', '"2026-08-01, Maybe Sunday"')
        resolutions = {EssentialFields.AVAILABLE_DATES_KEY: {"Maybe Sunday": None}}

        body, status = CsvImport.import_applications(
            markets, markets.doc, _csv(row), MAPPING, resolutions,
        )

        assert status == 200, body
        data = applications.find_one({"applicant_email": "nadia@ember.ca"})["form_data"]
        assert data["essential_available_dates"] == ["2026-08-01"]

    def test_free_text_answers_are_never_matched(self, markets):
        """A business name is the applicant's own words and has nothing to match against."""
        row = GOOD_ROW.replace("Ember Ceramics", "Somewhere Entirely New")

        body, _ = CsvImport.preview_values(markets.doc, _csv(row), MAPPING)

        assert body["unmatched"] == []

    def test_table_choice_is_matched_against_its_fixed_options(self, markets, applications):
        resolutions = {EssentialFields.TABLE_CHOICE_KEY: {"Half table please": "half"}}
        row = GOOD_ROW.replace(",half,", ",Half table please,")

        body, status = CsvImport.import_applications(
            markets, markets.doc, _csv(row), MAPPING, resolutions,
        )

        assert status == 200, body
        data = applications.find_one({"applicant_email": "nadia@ember.ca"})["form_data"]
        assert data["essential_table_choice"] == "half"

    def test_table_choice_matches_the_sentence_the_applicant_read(self, markets, applications):
        """A column exported from this product's own form matched nothing at all.

        Table choice was matched against the code it is stored as, so every cell of "A whole
        table to myself" was reported as not matching the market - and the correction offered was
        ``full``, a word no applicant ever saw.
        """
        row = GOOD_ROW.replace(",half,", ",A whole table to myself,")

        body, status = CsvImport.import_applications(markets, markets.doc, _csv(row), MAPPING)

        assert status == 200, body
        data = applications.find_one({"applicant_email": "nadia@ember.ca"})["form_data"]
        assert data["essential_table_choice"] == "full"

    def test_a_table_choice_still_resolves_by_the_sentence(self, markets, applications):
        """The reconciliation screen offers the sentences, so a resolution names one."""
        resolutions = {
            EssentialFields.TABLE_CHOICE_KEY: {"Sharing is fine": "Half a table, shared"},
        }
        row = GOOD_ROW.replace(",half,", ",Sharing is fine,")

        body, status = CsvImport.import_applications(
            markets, markets.doc, _csv(row), MAPPING, resolutions,
        )

        assert status == 200, body
        data = applications.find_one({"applicant_email": "nadia@ember.ca"})["form_data"]
        assert data["essential_table_choice"] == "half"

    @pytest.mark.parametrize("answer, code", [
        ("Full table", "full"),
        ("Half table", "half"),
        ("Either", "either"),
        ("Half table (I have a partner)", "half"),
        ("Whole table please", "full"),
        ("Full or half, I don’t mind", "either"),
        ("No preference", "either"),
    ])
    def test_another_forms_wording_names_the_table_choice(
        self, markets, applications, answer, code,
    ):
        """How a Google Form words the choices is not a trivial variant of this product's own
        sentences, and matching only those saved "Full table" and "Half table" as ignored on every
        market started from its form, refusing each of those applicants (bug 3)."""
        row = GOOD_ROW.replace(",half,", f',"{answer}",')

        preview, _ = CsvImport.preview_values(markets.doc, _csv(row), MAPPING)
        body, status = CsvImport.import_applications(markets, markets.doc, _csv(row), MAPPING)

        assert preview["unmatched"] == []
        assert status == 200 and body["created"] == 1, body
        data = applications.find_one({"applicant_email": "nadia@ember.ca"})["form_data"]
        assert data["essential_table_choice"] == code

    def test_a_stored_ignore_does_not_outrank_a_recognised_choice(self, markets, applications):
        """Markets started before the fix saved {"Full table": null}; a recognised value matches
        before a saved decision is consulted, so those markets import without a migration."""
        resolutions = {EssentialFields.TABLE_CHOICE_KEY: {"Full table": None}}
        row = GOOD_ROW.replace(",half,", ",Full table,")

        body, _ = CsvImport.import_applications(
            markets, markets.doc, _csv(row), MAPPING, resolutions,
        )

        assert body["created"] == 1, body
        data = applications.find_one({"applicant_email": "nadia@ember.ca"})["form_data"]
        assert data["essential_table_choice"] == "full"

    def test_an_unmatched_table_choice_is_offered_the_sentences_to_pick_from(self, markets):
        row = GOOD_ROW.replace(",half,", ",Depends on the price,")

        body, _ = CsvImport.preview_values(markets.doc, _csv(row), MAPPING)

        [entry] = [u for u in body["unmatched"] if u["target"] == EssentialFields.TABLE_CHOICE_KEY]
        assert entry["offered"] == [
            "A whole table to myself",
            "Half a table, shared",
            "Either is fine",
        ]

    def test_a_file_already_holding_the_stored_code_still_matches(self, markets, applications):
        """The old spelling is not sent round reconciliation to be told that ``full`` is ``full``."""
        row = GOOD_ROW.replace(",half,", ",full,")

        body, status = CsvImport.import_applications(markets, markets.doc, _csv(row), MAPPING)

        assert status == 200, body
        data = applications.find_one({"applicant_email": "nadia@ember.ca"})["form_data"]
        assert data["essential_table_choice"] == "full"


class TestPreviewingRowValidity:
    """What will and will not import, said before anything is written.

    Silently skipping a row is the worst outcome available: the import looks complete and a vendor
    is simply missing. So everything that would be skipped is shown first, with the line the
    organizer can find it on.
    """

    def test_a_clean_file_previews_every_row_as_valid(self, markets):
        other = GOOD_ROW.replace("nadia@ember.ca", "kai@ember.ca", 1)

        body, status = CsvImport.preview_values(markets.doc, _csv(GOOD_ROW, other), MAPPING)

        assert status == 200
        assert body["validRows"] == 2
        assert body["failures"] == []

    def test_a_mixed_file_counts_both_and_names_the_bad_lines(self, markets):
        bad = GOOD_ROW.replace("nadia@ember.ca", "kai@ember.ca").replace(",2,Gold,", ",lots,Gold,")

        body, _ = CsvImport.preview_values(markets.doc, _csv(GOOD_ROW, bad), MAPPING)

        assert body["rowCount"] == 2
        assert body["validRows"] == 1
        assert len(body["failures"]) == 1
        assert body["failures"][0]["row"] == 3
        assert body["failures"][0]["email"] == "kai@ember.ca"
        assert "whole number" in body["failures"][0]["error"]

    def test_an_all_invalid_file_previews_nothing_as_valid(self, markets):
        bad = GOOD_ROW.replace(",2,Gold,", ",lots,Gold,")
        other = bad.replace("nadia@ember.ca", "kai@ember.ca", 1)

        body, _ = CsvImport.preview_values(markets.doc, _csv(bad, other), MAPPING)

        assert body["validRows"] == 0
        assert len(body["failures"]) == 2

    def test_previewing_writes_nothing(self, markets, applications):
        CsvImport.preview_values(markets.doc, _csv(GOOD_ROW), MAPPING)

        assert applications.documents == []

    def test_previewing_does_not_freeze_the_offering(self, markets, applications):
        """A dry run that froze would let merely LOOKING at an import decide the form for ever."""
        CsvImport.preview_values(markets.doc, _csv(GOOD_ROW), MAPPING)

        assert markets.last_update is None

    def test_row_validity_waits_until_the_mapping_is_complete(self, markets):
        """Before that every row fails for the same reason, which the rail already says."""
        partial = {k: v for k, v in MAPPING.items() if k != EssentialFields.TIER_PREFERENCE_KEY}

        body, _ = CsvImport.preview_values(markets.doc, _csv(GOOD_ROW), partial)

        assert body["failures"] == []
        assert body["validRows"] == 0

    def test_row_validity_waits_until_values_are_resolved(self, markets):
        row = GOOD_ROW.replace(",Gold,", ",Gold Tier,")

        body, _ = CsvImport.preview_values(markets.doc, _csv(row), MAPPING)

        assert body["unmatched"] != []
        assert body["failures"] == []

    def test_the_preview_agrees_with_what_the_import_then_does(self, markets, applications):
        """Both run the same assembly, so a row cannot pass the preview and fail the import."""
        bad = GOOD_ROW.replace("nadia@ember.ca", "kai@ember.ca").replace(",2,Gold,", ",lots,Gold,")

        preview, _ = CsvImport.preview_values(markets.doc, _csv(GOOD_ROW, bad), MAPPING)
        imported, _ = CsvImport.import_applications(
            markets, markets.doc, _csv(GOOD_ROW, bad), MAPPING,
        )

        assert imported["created"] == preview["validRows"]
        assert [f["row"] for f in imported["failures"]] == [f["row"] for f in preview["failures"]]


class TestRememberingTheMapping:
    """Re-import is the expected case, not the exception - a form keeps collecting after the
    first import. Re-specifying a dozen decisions every time is what makes an organizer keep a
    spreadsheet instead."""

    def test_a_successful_import_saves_how_the_file_was_read(self, markets, applications):
        CsvImport.import_applications(markets, markets.doc, _csv(GOOD_ROW), MAPPING)

        saved = markets.last_update["$set"]["importMapping"]
        assert saved["targets"]["essential_tier_preference"] == ["Which tiers will you accept?"]
        assert saved["headers"] == HEADERS
        assert saved["savedAt"]

    def test_columns_are_remembered_by_header_text_not_position(self, markets, applications):
        """A reordered form exports the same headers in a different order; a mapping keyed on
        position would then map every answer to the wrong question without a word."""
        CsvImport.import_applications(markets, markets.doc, _csv(GOOD_ROW), MAPPING)
        saved = CsvImport.stored_mapping({"importMapping": markets.last_update["$set"]["importMapping"]})

        # The same questions, business name moved to the end.
        moved = [h for h in HEADERS if h != "Business name"] + ["Business name"]
        targets = CsvImport.import_targets(markets.doc)
        restored, unresolved, _new = CsvImport.restore_mapping(moved, saved, targets)

        assert unresolved == []
        assert restored["business_name"] == [len(moved) - 1]
        assert restored[EssentialFields.TIER_PREFERENCE_KEY] == [moved.index("Which tiers will you accept?")]

    def test_a_vanished_header_is_reported_not_guessed_at(self, markets, applications):
        CsvImport.import_applications(markets, markets.doc, _csv(GOOD_ROW), MAPPING)
        saved = CsvImport.stored_mapping({"importMapping": markets.last_update["$set"]["importMapping"]})

        without = [h for h in HEADERS if h != "Which tiers will you accept?"]
        targets = CsvImport.import_targets(markets.doc)
        restored, unresolved, _new = CsvImport.restore_mapping(without, saved, targets)

        assert EssentialFields.TIER_PREFERENCE_KEY not in restored
        assert unresolved == [{
            "target": EssentialFields.TIER_PREFERENCE_KEY,
            "missingHeaders": ["Which tiers will you accept?"],
        }]

    def test_a_grid_is_never_half_restored(self, markets, applications):
        """A partly-mapped grid is worse than an unmapped one: it looks answered."""
        CsvImport.import_applications(markets, markets.doc, _grid_csv(GRID_ROW), GRID_MAPPING)
        saved = CsvImport.stored_mapping({"importMapping": markets.last_update["$set"]["importMapping"]})

        without = [h for h in GRID_HEADERS if h != "Which days can you attend? [2026-08-08]"]
        targets = CsvImport.import_targets(markets.doc)
        restored, unresolved, _new = CsvImport.restore_mapping(without, saved, targets)

        assert EssentialFields.AVAILABLE_DATES_KEY not in restored
        assert unresolved[0]["target"] == EssentialFields.AVAILABLE_DATES_KEY

    def test_a_header_that_has_appeared_since_is_called_new(self, markets, applications):
        CsvImport.import_applications(markets, markets.doc, _csv(GOOD_ROW), MAPPING)
        saved = CsvImport.stored_mapping({"importMapping": markets.last_update["$set"]["importMapping"]})

        targets = CsvImport.import_targets(markets.doc)
        _restored, _unresolved, new = CsvImport.restore_mapping(
            HEADERS + ["Anything else?"], saved, targets,
        )

        assert new == ["Anything else?"]

    def test_value_resolutions_are_remembered_too(self, markets, applications):
        row = GOOD_ROW.replace(",Gold,", ",Gold Tier,")
        resolutions = {EssentialFields.TIER_PREFERENCE_KEY: {"Gold Tier": "Gold"}}

        CsvImport.import_applications(markets, markets.doc, _csv(row), MAPPING, resolutions)

        saved = markets.last_update["$set"]["importMapping"]
        assert saved["resolutions"]["essential_tier_preference"]["Gold Tier"] == "Gold"

    def test_data_keys_survive_the_round_trip_unmangled(self, markets, applications):
        """The mapping's own field names are camelCase like the rest of the market document, but
        its CONTENTS are data: target keys, and raw cell values the organizer's form produced. A
        blanket key conversion would rewrite "Gold Tier" and silently lose what it stood for."""
        row = GOOD_ROW.replace(",Gold,", ",Gold Tier,")
        resolutions = {EssentialFields.TIER_PREFERENCE_KEY: {"Gold Tier": "Gold"}}
        CsvImport.import_applications(markets, markets.doc, _csv(row), MAPPING, resolutions)

        stored = markets.last_update["$set"]["importMapping"]
        read_back = CsvImport.stored_mapping({"importMapping": stored})

        assert EssentialFields.TIER_PREFERENCE_KEY in read_back["targets"]
        assert read_back["resolutions"][EssentialFields.TIER_PREFERENCE_KEY]["Gold Tier"] == "Gold"

    def test_a_first_import_has_nothing_to_restore(self, markets):
        body, _ = CsvImport.inspect(markets.doc, _csv(GOOD_ROW))

        assert body["hasSavedMapping"] is False
        assert body["restoredMapping"] == {}


class TestMergingAgainstWhatIsAlreadyHere:
    """A second import of the same form must merge, not collide.

    Identity is a unique index on (market, email, type), so an append would simply throw; and a
    wholesale replace would destroy review state and rotate ids the review view depends on.
    """

    SECOND = GOOD_ROW.replace("nadia@ember.ca", "kai@ember.ca")

    def test_a_re_import_updates_rather_than_colliding(self, markets, applications):
        CsvImport.import_applications(markets, markets.doc, _csv(GOOD_ROW), MAPPING)
        changed = GOOD_ROW.replace("Ember Ceramics", "Ember Ceramics Studio")

        body, status = CsvImport.import_applications(
            markets, markets.doc, _csv(changed), MAPPING,
        )

        assert status == 200, body
        assert body["created"] == 0 and body["updated"] == 1
        data = applications.find_one({"applicant_email": "nadia@ember.ca"})["form_data"]
        assert data["business_name"] == "Ember Ceramics Studio"

    def test_application_ids_are_stable_across_a_re_import(self, markets, applications):
        """The review view and any future offer reference them."""
        CsvImport.import_applications(markets, markets.doc, _csv(GOOD_ROW), MAPPING)
        first_id = applications.find_one({"applicant_email": "nadia@ember.ca"})["id"]

        CsvImport.import_applications(markets, markets.doc, _csv(GOOD_ROW), MAPPING)

        assert applications.find_one({"applicant_email": "nadia@ember.ca"})["id"] == first_id

    def test_a_mixed_file_is_counted_as_new_and_updated(self, markets, applications):
        CsvImport.import_applications(markets, markets.doc, _csv(GOOD_ROW), MAPPING)

        body, _ = CsvImport.import_applications(
            markets, markets.doc, _csv(GOOD_ROW, self.SECOND), MAPPING,
        )

        assert body["created"] == 1
        assert body["updated"] == 1

    def test_the_preview_says_which_rows_are_new_and_which_update(self, markets, applications):
        CsvImport.import_applications(markets, markets.doc, _csv(GOOD_ROW), MAPPING)

        body, _ = CsvImport.preview_values(markets.doc, _csv(GOOD_ROW, self.SECOND), MAPPING)

        assert body["newRows"] == 1
        assert body["updatedRows"] == 1
        assert body["absentApplications"] == 0

    def test_an_application_absent_from_the_file_is_left_alone_and_counted(
        self, markets, applications,
    ):
        """Absence almost always means a filtered export, not a withdrawal."""
        CsvImport.import_applications(markets, markets.doc, _csv(GOOD_ROW, self.SECOND), MAPPING)

        body, _ = CsvImport.preview_values(markets.doc, _csv(GOOD_ROW), MAPPING)

        assert body["absentApplications"] == 1
        assert body["absentEmails"] == ["kai@ember.ca"]

        # And the import itself leaves them exactly as they were.
        before = applications.find_one({"applicant_email": "kai@ember.ca"})
        CsvImport.import_applications(markets, markets.doc, _csv(GOOD_ROW), MAPPING)
        after = applications.find_one({"applicant_email": "kai@ember.ca"})
        assert after == before

    def test_a_file_whose_applicants_are_all_absent_still_imports_nothing_destructive(
        self, markets, applications,
    ):
        CsvImport.import_applications(markets, markets.doc, _csv(GOOD_ROW, self.SECOND), MAPPING)
        third = GOOD_ROW.replace("nadia@ember.ca", "wren@ember.ca")

        body, _ = CsvImport.import_applications(markets, markets.doc, _csv(third), MAPPING)

        assert body["created"] == 1
        assert body["absentApplications"] == 2
        assert applications.find_one({"applicant_email": "nadia@ember.ca"}) is not None
        assert applications.find_one({"applicant_email": "kai@ember.ca"}) is not None

    def test_a_skipped_row_does_not_count_as_present(self, markets, applications):
        """A row that will not import cannot be evidence that its applicant is still in the file."""
        CsvImport.import_applications(markets, markets.doc, _csv(GOOD_ROW), MAPPING)
        broken = GOOD_ROW.replace(",2,Gold,", ",lots,Gold,")

        body, _ = CsvImport.preview_values(markets.doc, _csv(broken), MAPPING)

        assert body["absentApplications"] == 1


class TestReviewsInvalidatedByAReImport:
    """An organizer approved a vendor on the strength of what they saw.

    If an answer the solver reads moves afterwards, that approval is stale: the solver would place
    someone against constraints nobody accepted. If anything else moves, the approval stands - a
    corrected business name must not undo a review.
    """

    def _approved(self, markets, applications, row=GOOD_ROW):
        CsvImport.import_applications(markets, markets.doc, _csv(row), MAPPING)
        stored = applications.find_one({"applicant_email": "nadia@ember.ca"})
        applications.update_one(
            {"id": stored["id"]},
            {"$set": {"status": ApplicationStatus.REVIEWER_APPROVED.value}},
        )
        return stored["id"]

    def test_a_changed_solver_answer_returns_an_approval_to_review(self, markets, applications):
        app_id = self._approved(markets, applications)
        # Was available on both dates; now only one.
        changed = GOOD_ROW.replace('"2026-08-01, 2026-08-08",2', '2026-08-01,1')

        body, _ = CsvImport.import_applications(markets, markets.doc, _csv(changed), MAPPING)

        assert body["returnedToReview"] == 1
        assert applications.find_one({"id": app_id})["status"] == ApplicationStatus.OPEN.value

    def test_a_changed_custom_answer_leaves_the_approval_alone(self, markets, applications):
        app_id = self._approved(markets, applications)
        changed = GOOD_ROW.replace("Ember Ceramics", "Ember Ceramics Studio")

        body, _ = CsvImport.import_applications(markets, markets.doc, _csv(changed), MAPPING)

        assert body["returnedToReview"] == 0
        stored = applications.find_one({"id": app_id})
        assert stored["status"] == ApplicationStatus.REVIEWER_APPROVED.value
        # ...and the answer is still updated.
        assert stored["form_data"]["business_name"] == "Ember Ceramics Studio"

    def test_an_unchanged_re_import_changes_nothing(self, markets, applications):
        app_id = self._approved(markets, applications)

        body, _ = CsvImport.import_applications(markets, markets.doc, _csv(GOOD_ROW), MAPPING)

        assert body["returnedToReview"] == 0
        assert applications.find_one({"id": app_id})["status"] == (
            ApplicationStatus.REVIEWER_APPROVED.value
        )

    def test_a_merely_reordered_answer_is_not_a_change(self, markets, applications):
        """Both sides are compared after normalisation, so a re-export that reorders a
        multi-select does not un-approve anybody."""
        app_id = self._approved(markets, applications)
        reordered = GOOD_ROW.replace(
            '"2026-08-01, 2026-08-08"', '"2026-08-08, 2026-08-01"',
        ).replace('"Garden, Main Hall"', '"Garden, Main Hall"')

        body, _ = CsvImport.import_applications(markets, markets.doc, _csv(reordered), MAPPING)

        assert body["returnedToReview"] == 0
        assert applications.find_one({"id": app_id})["status"] == (
            ApplicationStatus.REVIEWER_APPROVED.value
        )

    def test_an_unapproved_application_is_unaffected(self, markets, applications):
        CsvImport.import_applications(markets, markets.doc, _csv(GOOD_ROW), MAPPING)
        changed = GOOD_ROW.replace('"2026-08-01, 2026-08-08",2', '2026-08-01,1')

        body, _ = CsvImport.import_applications(markets, markets.doc, _csv(changed), MAPPING)

        assert body["returnedToReview"] == 0
        assert applications.find_one({"applicant_email": "nadia@ember.ca"})["status"] == (
            ApplicationStatus.OPEN.value
        )

    def test_the_preview_says_how_many_will_return_before_anything_is_written(
        self, markets, applications,
    ):
        app_id = self._approved(markets, applications)
        changed = GOOD_ROW.replace('"2026-08-01, 2026-08-08",2', '2026-08-01,1')

        body, _ = CsvImport.preview_values(markets.doc, _csv(changed), MAPPING)

        assert body["returningToReview"] == 1
        assert body["returningEmails"] == ["nadia@ember.ca"]
        # Still approved: the preview wrote nothing.
        assert applications.find_one({"id": app_id})["status"] == (
            ApplicationStatus.REVIEWER_APPROVED.value
        )


class TestImportingOnlyWhatItImports:
    """A row the preview says it will skip is not written at all (E26/F02/S02).

    The import used to create each row's application before validating its answers, so every
    skipped row stayed behind as an empty application - counted by the form lock, blocking the
    all-reviewed guard, and one of them keyed by a timestamp (bugs 5 and 35).
    """

    def test_a_skipped_row_leaves_no_application_behind(self, markets, applications):
        bad = GOOD_ROW.replace("nadia@ember.ca", "kai@ember.ca").replace(",2,Gold,", ",lots,Gold,")

        body, _ = CsvImport.import_applications(markets, markets.doc, _csv(GOOD_ROW, bad), MAPPING)

        assert body["created"] == 1 and body["skipped"] == 1
        assert [doc["applicant_email"] for doc in applications.documents] == ["nadia@ember.ca"]

    @pytest.mark.parametrize("address", ["not-an-email", "9/12/2025 18:22:56", "nadia@ember"])
    def test_an_address_that_is_not_one_is_refused_by_name(self, markets, applications, address):
        row = GOOD_ROW.replace("nadia@ember.ca", address, 1)

        preview, _ = CsvImport.preview_values(markets.doc, _csv(row), MAPPING)
        body, _ = CsvImport.import_applications(markets, markets.doc, _csv(row), MAPPING)

        assert preview["validRows"] == 0
        assert preview["failures"] == [
            {"row": 2, "email": "", "error": f"{address!r} is not an email address."},
        ]
        assert body["failures"] == preview["failures"]
        assert applications.documents == []

    def test_a_create_whose_answers_are_then_refused_is_undone(
        self, markets, applications, monkeypatch,
    ):
        """The check and the write judge alike unless the offering froze in between; if it did,
        the application just created must not outlive the answers it was created for."""
        monkeypatch.setattr(
            CsvImport, "record_application_answers", lambda *_args, **_kwargs: ("Refused.", None),
        )

        body, _ = CsvImport.import_applications(markets, markets.doc, _csv(GOOD_ROW), MAPPING)

        assert body["created"] == 0
        assert body["failures"] == [{"row": 2, "email": "nadia@ember.ca", "error": "Refused."}]
        assert applications.documents == []


class TestAnApplicantListedMoreThanOnce:
    """A Google Form keeps every submission, so a vendor who applied twice is two rows.

    They are one application: the latest row's answers, dated by the first submission. Taking the
    rows in turn compared an earlier row against the stored application, which held the later
    row's answers, so an unchanged applicant lost their approval on every re-import (bug 34).
    """

    FIRST = (
        GOOD_ROW.replace("2026/05/02 9:14:03", "2026/05/01 16:20:00")
        .replace("Ember Ceramics", "Ember")
        .replace('"2026-08-01, 2026-08-08",2', "2026-08-01,1")
    )
    OTHER = GOOD_ROW.replace("nadia@ember.ca", "kai@ember.ca", 1)

    def _one(self, applications):
        matching = [d for d in applications.documents if d["applicant_email"] == "nadia@ember.ca"]
        assert len(matching) == 1
        return matching[0]

    def test_is_one_application_with_their_latest_answers(self, markets, applications):
        body, _ = CsvImport.import_applications(
            markets, markets.doc, _csv(self.FIRST, GOOD_ROW), MAPPING,
        )

        assert body["created"] == 1 and body["updated"] == 0
        stored = self._one(applications)
        assert stored["form_data"]["business_name"] == "Ember Ceramics"
        assert stored["form_data"]["essential_available_dates"] == DATES

    def test_is_dated_by_their_first_submission(self, markets, applications):
        """When they joined a first-come-first-served queue, not when they last edited."""
        CsvImport.import_applications(markets, markets.doc, _csv(self.FIRST, GOOD_ROW), MAPPING)

        assert self._one(applications)["submitted_at"] == "2026-05-01T16:20:00"

    def test_latest_means_latest_submitted_not_lowest_in_the_file(self, markets, applications):
        """A sheet sorted by name or newest-first must not import someone's older answers."""
        CsvImport.import_applications(markets, markets.doc, _csv(GOOD_ROW, self.FIRST), MAPPING)

        stored = self._one(applications)
        assert stored["form_data"]["business_name"] == "Ember Ceramics"
        assert stored["submitted_at"] == "2026-05-01T16:20:00"

    def test_the_preview_names_each_replaced_row_and_counts_applicants(self, markets):
        body, _ = CsvImport.preview_values(
            markets.doc, _csv(self.FIRST, GOOD_ROW, self.OTHER), MAPPING,
        )

        assert body["rowCount"] == 3
        assert body["validRows"] == 2
        assert body["repeats"] == [{"row": 2, "email": "nadia@ember.ca", "latestRow": 3}]
        assert body["newRows"] == 2

    def test_an_unchanged_repeat_keeps_its_approval_on_re_import(self, markets, applications):
        file = _csv(self.FIRST, GOOD_ROW, self.OTHER)
        CsvImport.import_applications(markets, markets.doc, file, MAPPING)
        for doc in applications.documents:
            doc["status"] = ApplicationStatus.REVIEWER_APPROVED.value

        preview, _ = CsvImport.preview_values(markets.doc, file, MAPPING)
        body, _ = CsvImport.import_applications(markets, markets.doc, file, MAPPING)

        assert preview["returningToReview"] == 0
        assert body["returnedToReview"] == 0
        assert {doc["status"] for doc in applications.documents} == {
            ApplicationStatus.REVIEWER_APPROVED.value,
        }
        # And the two screens count the same thing: applicants, not rows.
        assert (preview["newRows"], preview["updatedRows"]) == (body["created"], body["updated"])

    def test_a_refused_latest_row_is_not_replaced_by_an_earlier_one(self, markets, applications):
        """The latest row is what the vendor last said; importing their older answers instead
        would be a guess. It is skipped and named, so the organizer can fix it."""
        broken = GOOD_ROW.replace(",2,Gold,", ",lots,Gold,")

        body, _ = CsvImport.import_applications(
            markets, markets.doc, _csv(self.FIRST, broken), MAPPING,
        )

        assert body["created"] == 0
        assert [failure["row"] for failure in body["failures"]] == [3]
        assert body["repeats"] == [{"row": 2, "email": "nadia@ember.ca", "latestRow": 3}]
        assert applications.documents == []

    def test_an_unreadable_time_on_the_latest_row_is_still_refused(self, markets, applications):
        unreadable = GOOD_ROW.replace("2026/05/02 9:14:03", "yesterday")

        body, _ = CsvImport.import_applications(
            markets, markets.doc, _csv(self.FIRST, unreadable), MAPPING,
        )

        assert [failure["row"] for failure in body["failures"]] == [3]
        assert "'yesterday' is not a date and time" in body["failures"][0]["error"]


class TestWhenImportingIsAllowed:
    """Importing is an intake operation, so it belongs to the phases that take applications.

    Once review has begun the applicant set must stop moving under the reviewer. The organizer is
    not stuck: `review -> applications_closed` is an existing edge, so the way through is to
    reopen, import, and move forward again - deliberate and visible, and needing no new edges.
    """

    def test_the_intake_phases_are_allowed(self):
        for phase in (MarketPhase.APPLICATIONS_OPEN, MarketPhase.APPLICATIONS_CLOSED):
            doc = _market_doc()
            doc["phase"] = phase.value

            assert CsvImport.import_phase_refusal(doc) is None, phase

    def test_review_onward_is_refused(self):
        for phase in (
            MarketPhase.REVIEW, MarketPhase.ASSIGNMENT, MarketPhase.OFFERS,
            MarketPhase.MARKET_DAYS, MarketPhase.ARCHIVED,
        ):
            doc = _market_doc()
            doc["phase"] = phase.value

            refusal = CsvImport.import_phase_refusal(doc)

            assert refusal is not None, phase
            assert phase.value.replace("_", " ") in refusal

    def test_the_refusal_points_at_the_way_through(self):
        doc = _market_doc()
        doc["phase"] = MarketPhase.REVIEW.value

        refusal = CsvImport.import_phase_refusal(doc)

        assert "Reopen applications" in refusal

    def test_a_draft_is_refused_for_its_own_reason(self):
        """Not "reopen applications" - a draft has never opened them."""
        doc = _market_doc()
        doc["phase"] = MarketPhase.DRAFT.value

        refusal = CsvImport.import_phase_refusal(doc)

        assert refusal is not None and "still a draft" in refusal

    def test_reopening_makes_importing_possible_again(self):
        doc = _market_doc()
        doc["phase"] = MarketPhase.REVIEW.value
        assert CsvImport.import_phase_refusal(doc) is not None

        doc["phase"] = MarketPhase.APPLICATIONS_CLOSED.value

        assert CsvImport.import_phase_refusal(doc) is None
