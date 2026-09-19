"""The shared application-write path.

``record_application_answers`` is the one sequence that turns an applicant's answers into a
stored application: validate, freeze the essential offering, persist, and status. The applicant
endpoint calls it, and the CSV importer will call the same function rather than reimplementing
it - which is what stops an imported application and a form-submitted one from drifting into two
different kinds of document.

These tests exercise it directly, with plain documents and no HTTP request or applicant session,
because that is the property the importer depends on.
"""
import pytest

from conftest import FakeMarketsCollection, stored_market

import essential_fields as EssentialFields
from application_write import record_application_answers, validate_application_answers
from datatypes import ApplicationStatus


DATES = ["2026-08-01", "2026-08-08"]
SECTIONS = ["Main Hall", "Garden"]
TIERS = ["Gold", "Silver"]

SETUP_CAMEL = {
    "priority": [],
    "marketDates": [{"date": date} for date in DATES],
    "tiers": [{"id": index, "name": name} for index, name in enumerate(TIERS)],
    "locations": [],
    "sections": [{"name": name, "count": 4} for name in SECTIONS],
    "assignmentOptions": {},
    "floorplans": [],
}

FORM_FIELDS = [
    {"key": "business_name", "label": "Business Name", "type": "text", "required": True,
     "options": [], "order": 0},
]

ANSWERS = {
    "business_name": "Vermilion Ceramics",
    "essential_full_name": "Ana Rivera",
    "essential_available_dates": ["2026-08-08", "2026-08-01"],
    "essential_max_dates": 2,
    # Per date (E01/F05): the same tiers on both dates this applicant can attend.
    "essential_tier_preference": {"2026-08-08": ["Gold"], "2026-08-01": ["Gold"]},
    "essential_table_choice": "half",
    "essential_table_share_email": "buddy@example.com",
    "essential_section_ranking": ["Garden", "Main Hall"],
}


def _market_doc():
    return stored_market(
        setupObject=SETUP_CAMEL,
        applicationForm={"fields": FORM_FIELDS, "essentialOptions": None},
    )


def _app_doc(**overrides):
    doc = {
        "id": "app-1",
        "market_id": "market-123",
        "applicant_email": "vendor@example.com",
        "form_data": {},
        "status": "",
        "application_type": "main",
    }
    doc.update(overrides)
    return doc


@pytest.fixture
def markets():
    return FakeMarketsCollection(_market_doc())


class TestRecordApplicationAnswers:
    def test_it_runs_without_a_request_or_a_session(self, markets, applications):
        """The property the CSV importer depends on: plain documents in, application out."""
        applications.insert_one(_app_doc())

        error, app = record_application_answers(
            markets, markets.doc, _app_doc(), ANSWERS,
        )

        assert error is None
        assert app is not None
        assert app.form_data["business_name"] == "Vermilion Ceramics"

    def test_answers_are_normalised_into_their_stored_shapes(self, markets, applications):
        """Not merely persisted: dates and accepted tiers come back in plan order."""
        applications.insert_one(_app_doc())

        _, app = record_application_answers(markets, markets.doc, _app_doc(), ANSWERS)

        assert app.form_data["essential_available_dates"] == DATES
        assert app.form_data["essential_tier_preference"] == {
            "2026-08-08": ["Gold"], "2026-08-01": ["Gold"],
        }
        assert app.form_data["essential_table_choice"] == "half"

    def test_an_application_with_no_status_becomes_open(self, markets, applications):
        """What puts an imported row in front of a reviewer."""
        applications.insert_one(_app_doc())

        record_application_answers(markets, markets.doc, _app_doc(), ANSWERS)

        assert applications.find_one({"id": "app-1"})["status"] == ApplicationStatus.OPEN.value

    def test_an_existing_status_is_left_alone(self, markets, applications):
        applications.insert_one(_app_doc(status=ApplicationStatus.REVIEWER_APPROVED.value))

        record_application_answers(
            markets, markets.doc,
            _app_doc(status=ApplicationStatus.REVIEWER_APPROVED.value), ANSWERS,
        )

        stored = applications.find_one({"id": "app-1"})
        assert stored["status"] == ApplicationStatus.REVIEWER_APPROVED.value

    def test_the_offering_is_frozen_before_the_answers_are_written(self, markets, applications):
        """The ordering that stops a later plan edit moving a question under a recorded answer."""
        applications.insert_one(_app_doc())

        record_application_answers(markets, markets.doc, _app_doc(), ANSWERS)

        frozen = markets.last_update["$set"]["applicationForm.essentialOptions"]
        assert frozen["dates"] == DATES
        assert frozen["tiers"] == TIERS

    def test_a_refused_answer_writes_nothing(self, markets, applications):
        applications.insert_one(_app_doc())
        bad = {**ANSWERS, "essential_tier_preference": {"2026-08-01": ["Platinum"]}}

        error, app = record_application_answers(markets, markets.doc, _app_doc(), bad)

        assert error is not None and "does not offer" in error
        assert app is None
        assert applications.find_one({"id": "app-1"})["form_data"] == {}

    def test_a_missing_required_custom_answer_is_refused(self, markets, applications):
        applications.insert_one(_app_doc())
        bad = {key: value for key, value in ANSWERS.items() if key != "business_name"}

        error, app = record_application_answers(markets, markets.doc, _app_doc(), bad)

        assert error is not None and "'Business Name' is required" in error
        assert app is None

    def test_a_frozen_offering_governs_over_the_live_plan(self, applications):
        """An answer is validated against what the form actually offered, not what it offers now."""
        applications.insert_one(_app_doc())
        doc = stored_market(
            setupObject=SETUP_CAMEL,
            applicationForm={
                "fields": FORM_FIELDS,
                "essentialOptions": {
                    "dates": ["2026-08-01"], "sections": SECTIONS,
                    "tableTypes": [EssentialFields.STUB_TABLE_TYPE], "tiers": TIERS,
                },
            },
        )
        markets = FakeMarketsCollection(doc)

        error, _ = record_application_answers(markets, doc, _app_doc(), ANSWERS)

        assert error is not None and "does not offer" in error


class TestAMarketThatAsksOnlyTheEssentialQuestions:
    """A form made entirely of the essential questions is a form.

    ``FormHasFieldsGuard`` says so: a market whose plan has dates, tiers or two sections may leave
    ``draft`` and open applications with no custom field at all (E03/F01/S01). The write path used
    to disagree, refusing every such application with "does not have an application form
    configured" - so that market could open applications and then never receive one, by import or
    by an applicant. The refusal keyed on the custom fields alone, which is the one half of the
    form that E01 stopped being the whole of it.
    """

    def _essential_only_market(self):
        return stored_market(
            setupObject=SETUP_CAMEL,
            applicationForm={"fields": [], "essentialOptions": None},
        )

    def test_answers_are_accepted_when_the_form_has_no_custom_field(self, applications):
        applications.insert_one(_app_doc())
        doc = self._essential_only_market()
        markets = FakeMarketsCollection(doc)

        error, app = record_application_answers(markets, doc, _app_doc(), ANSWERS)

        assert error is None
        assert app is not None
        assert app.form_data["essential_available_dates"] == DATES
        assert app.status == ApplicationStatus.OPEN

    def test_the_dry_run_agrees_with_the_save(self, applications):
        """The importer previews with this; a preview that refused what the save accepts is worse
        than either being wrong on its own."""
        doc = self._essential_only_market()

        assert validate_application_answers(doc, ANSWERS) is None

    def test_a_market_with_no_form_object_at_all_is_the_same_case(self, applications):
        applications.insert_one(_app_doc())
        doc = stored_market(setupObject=SETUP_CAMEL)
        markets = FakeMarketsCollection(doc)

        error, app = record_application_answers(markets, doc, _app_doc(), ANSWERS)

        assert error is None
        assert app is not None

    def test_a_market_that_asks_nothing_at_all_is_still_refused(self, applications):
        """The refusal has a job: a plan with no dates, no tiers and fewer than two sections asks
        no essential question either, so there is genuinely no form to answer."""
        applications.insert_one(_app_doc())
        doc = stored_market(
            setupObject={
                "priority": [], "marketDates": [], "tiers": [], "locations": [],
                "sections": [], "assignmentOptions": {}, "floorplans": [],
            },
            applicationForm={"fields": [], "essentialOptions": None},
        )
        markets = FakeMarketsCollection(doc)

        error, app = record_application_answers(markets, doc, _app_doc(), {})

        assert error is not None
        assert "does not have an application form configured" in error
        assert app is None

    def test_a_custom_field_is_still_validated_when_there_is_one(self, markets, applications):
        """The relaxation is about an EMPTY field list, not about skipping validation."""
        applications.insert_one(_app_doc())
        missing = {key: value for key, value in ANSWERS.items() if key != "business_name"}

        error, app = record_application_answers(markets, markets.doc, _app_doc(), missing)

        assert error is not None and "required" in error
        assert app is None
