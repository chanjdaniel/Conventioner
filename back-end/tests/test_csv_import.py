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
from datatypes import ApplicationStatus


DATES = ["2026-08-01", "2026-08-08"]
SECTIONS = ["Main Hall", "Garden"]
TIERS = ["Gold", "Silver"]

SETUP_CAMEL = {
    "colNames": [], "colValues": [], "colInclude": [], "enumPriorityOrder": [], "priority": [],
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
    "business_name": 2,
    EssentialFields.AVAILABLE_DATES_KEY: 3,
    EssentialFields.MAX_DATES_KEY: 4,
    EssentialFields.TIER_PREFERENCE_KEY: 5,
    EssentialFields.TABLE_CHOICE_KEY: 6,
    EssentialFields.TABLE_SHARE_EMAIL_KEY: 7,
    EssentialFields.SECTION_RANKING_KEY: 8,
}


def _csv(*rows: str) -> str:
    return "\n".join([",".join(HEADERS), *rows])


GOOD_ROW = (
    '2026/05/02 9:14:03,nadia@ember.ca,Ember Ceramics,'
    '"2026-08-01, 2026-08-08",2,Gold,half,buddy@ember.ca,"Garden, Main Hall"'
)


def _market_doc(setup=None, **overrides):
    return stored_market(
        setupObject=setup or SETUP_CAMEL,
        applicationForm={"fields": FORM_FIELDS, "essentialOptions": None},
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

        assert body["sampleValues"][3] == ["2026-08-01, 2026-08-08"]


class TestImportApplications:
    def test_a_row_becomes_an_application_awaiting_review(self, markets, applications):
        body, status = CsvImport.import_applications(
            markets, markets.doc, _csv(GOOD_ROW), MAPPING,
        )

        assert status == 200, body
        assert body["created"] == 1 and body["skipped"] == 0
        stored = applications.find_one({"applicant_email": "nadia@ember.ca"})
        assert stored["status"] == ApplicationStatus.OPEN.value

    def test_answers_land_in_their_stored_shapes(self, markets, applications):
        """Through the shared write path, so identical to a form submission."""
        CsvImport.import_applications(markets, markets.doc, _csv(GOOD_ROW), MAPPING)

        data = applications.find_one({"applicant_email": "nadia@ember.ca"})["form_data"]
        assert data["business_name"] == "Ember Ceramics"
        assert data["essential_available_dates"] == DATES
        assert data["essential_max_dates"] == 2
        assert data["essential_tier_preference"] == ["Gold"]
        assert data["essential_table_choice"] == "half"
        assert data["essential_table_share_email"] == "buddy@ember.ca"
        assert data["essential_section_ranking"] == ["Garden", "Main Hall"]

    def test_submission_time_comes_from_the_file_not_the_import(self, markets, applications):
        """Otherwise every row shares one timestamp and first-come-first-served does nothing."""
        CsvImport.import_applications(markets, markets.doc, _csv(GOOD_ROW), MAPPING)

        stored = applications.find_one({"applicant_email": "nadia@ember.ca"})
        assert stored["submitted_at"] == "2026/05/02 9:14:03"

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
        blank = GOOD_ROW.replace("nadia@ember.ca,Ember Ceramics", ",Ember Ceramics")

        body, _ = CsvImport.import_applications(
            markets, markets.doc, _csv(blank, GOOD_ROW), MAPPING,
        )

        assert body["created"] == 1 and body["skipped"] == 1
        assert body["failures"][0]["row"] == 2
        assert "email" in body["failures"][0]["error"].lower()

    def test_one_bad_row_does_not_stop_the_others(self, markets, applications):
        """Refuse at the mapping level, tolerate at the row level."""
        bad = GOOD_ROW.replace("nadia@ember.ca", "kai@ember.ca").replace(",Gold,", ",Platinum,")

        body, _ = CsvImport.import_applications(
            markets, markets.doc, _csv(GOOD_ROW, bad), MAPPING,
        )

        assert body["created"] == 1
        assert body["skipped"] == 1
        assert body["failures"][0]["email"] == "kai@ember.ca"
        assert "does not offer" in body["failures"][0]["error"]

    def test_a_skipped_row_names_its_spreadsheet_line(self, markets, applications):
        """Row 1 is the header, so the organizer can find row 3 in their own file."""
        bad = GOOD_ROW.replace("nadia@ember.ca", "kai@ember.ca").replace(",Gold,", ",Platinum,")

        body, _ = CsvImport.import_applications(
            markets, markets.doc, _csv(GOOD_ROW, bad), MAPPING,
        )

        assert body["failures"][0]["row"] == 3

    def test_email_is_lowercased_so_one_applicant_is_one_applicant(self, markets, applications):
        shouty = GOOD_ROW.replace("nadia@ember.ca", "Nadia@Ember.CA")

        CsvImport.import_applications(markets, markets.doc, _csv(shouty), MAPPING)

        assert applications.find_one({"applicant_email": "nadia@ember.ca"}) is not None
