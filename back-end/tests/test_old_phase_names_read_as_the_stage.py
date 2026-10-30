"""For one release this build reads the three old phase names as the stage (review of T94, Daniel's
choice), so the deploy comes before the migration: each reads as the migration would leave it, a form
market whose applications had closed reads as stopped, a Google Form market that imported nothing
reads as draft, nothing is written on read, and a write from such a market writes the new name."""
import pytest

import api.applicants as ApplicantsApi
import api.markets as MarketsApi
from conftest import FakeMarketsCollection, stored_market
from datatypes import (
    Application,
    ApplicationStatus,
    MarketPhase,
    applications_stopped_from_market_document,
    phase_from_market_document,
)
from market_documents import market_from_document


def _old(phase, intake_mode, **overrides):
    doc = stored_market(MarketPhase.APPLICATIONS, intakeMode=intake_mode, **overrides)
    doc["phase"] = phase
    doc["isDraft"] = False
    return doc


@pytest.fixture
def imported(applications):
    """The market has one application."""
    applications.insert_one(Application(
        market_id="market-123", applicant_email="vendor@example.com", form_data={},
        status=ApplicationStatus.OPEN,
    ).model_dump())


@pytest.mark.parametrize("phase", ["applications_open", "applications_closed", "review"])
def test_each_old_name_reads_as_the_stage_on_a_form_market(phase):
    assert phase_from_market_document(_old(phase, "form")) is MarketPhase.APPLICATIONS


@pytest.mark.parametrize("phase", ["applications_open", "applications_closed", "review"])
def test_each_old_name_reads_as_review_on_a_google_form_market_holding_responses(phase, imported):
    assert phase_from_market_document(_old(phase, "csv")) is MarketPhase.APPLICATIONS


def test_a_google_form_market_that_imported_nothing_reads_as_draft():
    assert phase_from_market_document(_old("applications_open", "csv")) is MarketPhase.DRAFT
    # An absent mode reads as CSV, as everywhere.
    assert phase_from_market_document(_old("applications_open", None)) is MarketPhase.DRAFT


@pytest.mark.parametrize("phase, stopped", [
    ("applications_open", False), ("applications_closed", True), ("review", True),
])
def test_a_form_market_whose_applications_had_closed_reads_as_stopped(phase, stopped):
    doc = _old(phase, "form")

    assert applications_stopped_from_market_document(doc) is stopped
    assert market_from_document(doc).applications_stopped is stopped
    assert ApplicantsApi.takes_applications(doc) is not stopped


def test_the_stored_fact_wins_once_written():
    """Take applications again, after the deploy and before the migration."""
    doc = _old("applications_closed", "form", applicationsStopped=False)

    assert applications_stopped_from_market_document(doc) is False
    assert ApplicantsApi.takes_applications(doc) is True


def test_a_google_form_market_is_never_read_as_stopped(imported):
    assert applications_stopped_from_market_document(_old("review", "csv")) is False


def test_reading_writes_nothing(monkeypatch):
    markets = FakeMarketsCollection(_old("review", "form"))
    monkeypatch.setattr(MarketsApi, "markets_collection", markets)

    MarketsApi.load_market_context("market-123")

    assert markets.last_update is None
    assert markets.doc["phase"] == "review"


def test_a_move_from_an_old_name_writes_the_new_one(monkeypatch):
    """Conditional on the name stored, so the write still lands on the document read."""
    markets = FakeMarketsCollection(_old("review", "form"))
    monkeypatch.setattr(MarketsApi, "markets_collection", markets)
    filters = []
    update_one = markets.update_one

    def recording(query, update):
        filters.append(query)
        return update_one(query, update)
    markets.update_one = recording

    MarketsApi.apply_phase_transition("market-123", markets.doc, "draft", by="owner@example.com")

    assert filters[-1]["phase"] == "review"
    assert markets.last_update["$set"]["phase"] == "draft"
    assert markets.last_update["$push"]["phaseHistory"]["$each"][0]["phase"] == "applications"


def test_a_stop_is_taken_on_a_market_still_stored_under_an_old_name(monkeypatch):
    from conftest import FakeSlugMarketsCollection
    import db_config

    markets = FakeSlugMarketsCollection(_old("applications_open", "form"))
    filters = []
    update_one = markets.update_one

    def recording(query, update):
        filters.append(query)
        return update_one(query, update)
    markets.update_one = recording

    class _Db(dict):
        def __getitem__(self, _name):
            return markets
    monkeypatch.setattr(db_config, "get_database", lambda *_a, **_kw: _Db())

    body, status = ApplicantsApi.set_applications_stopped("market-123", True, "owner@example.com")

    assert status == 200, body
    assert "applications_open" in filters[-1]["phase"]["$in"]


def test_a_history_naming_the_old_phases_reads_as_having_entered_the_stage():
    """An archived market's rail says how far it got from its record, before the migration too."""
    import phase_record as PhaseRecord

    doc = stored_market(MarketPhase.ARCHIVED, phaseHistory=[
        {"phase": "draft", "enteredAt": "2026-10-01T00:00:00+00:00", "by": "owner@example.com"},
        {"phase": "applications_open", "enteredAt": "2026-10-02T00:00:00+00:00", "by": None},
        {"phase": "review", "enteredAt": "2026-10-03T00:00:00+00:00", "by": None},
        {"phase": "archived", "enteredAt": "2026-10-04T00:00:00+00:00", "by": None},
    ])

    reached = PhaseRecord.phases_reached(doc, lambda _id: False)

    assert reached.complete
    assert reached.phases == {"draft", "applications", "archived"}
