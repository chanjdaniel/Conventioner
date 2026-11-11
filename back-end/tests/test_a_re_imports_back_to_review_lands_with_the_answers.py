"""A re-import's "back to review" lands with the answers (T270).

A re-import that changes an approved vendor's solver answers sends them back to review. It did so in
a second write after the answers, so a request the host ended between the two left the vendor
approved on answers nobody saw, and importing the file again found the answers already stored and
nothing to do. The answers and the status are now one update, held to the status and the verdict's
time the import read, so a verdict given between the read and the write is never written under.
"""
import pytest

import api.applications as ApplicationsApi
import csv_import as CsvImport
from datatypes import ApplicationStatus
from test_csv_import import GOOD_ROW, MAPPING, _csv, markets  # noqa: F401 (the fixture)

# Was available on both dates, two of them; now one date only, which the solver reads.
CHANGED_ROW = GOOD_ROW.replace('"2026-08-01, 2026-08-08",2', '2026-08-01,1')
ADDRESS = "nadia@ember.test"
APPROVER = {"kind": "person", "user_id": "u-reviewer", "email": "reviewer@example.com"}


class Stopped(Exception):
    """The host ending the request."""


def _approve(applications, verdict_at="2026-07-01T10:00:00+00:00"):
    applications.update_one({"applicant_email": ADDRESS}, {"$set": {
        "status": ApplicationStatus.REVIEWER_APPROVED.value,
        "verdict_by": APPROVER, "verdict_at": verdict_at,
    }})


def _imported_and_approved(markets, applications):  # noqa: F811 (the fixture)
    CsvImport.import_applications(markets, markets.doc, _csv(GOOD_ROW), MAPPING)
    _approve(applications)
    return applications.find_one({"applicant_email": ADDRESS})


def _before_each_answers_write(monkeypatch, applications, step):
    """Run ``step`` just before each write that stores an application's answers."""
    original = applications.update_one
    calls = []

    def update_one(query, update):
        if "form_data" in (update.get("$set") or {}):
            calls.append(query)
            step(len(calls))
        return original(query, update)

    monkeypatch.setattr(applications, "update_one", update_one)
    return calls


class TestARequestCutShortAfterTheAnswers:
    def test_the_vendor_is_back_in_review_and_the_next_import_has_nothing_to_repair(
        self, monkeypatch, markets, applications,  # noqa: F811 (the fixture)
    ):
        stored = _imported_and_approved(markets, applications)
        original = applications.update_one
        stops = []

        def update_one(query, update):
            result = original(query, update)
            if "form_data" in (update.get("$set") or {}) and not stops:
                stops.append(query)
                raise Stopped()  # the answers landed; nothing after them did
            return result

        monkeypatch.setattr(applications, "update_one", update_one)
        with pytest.raises(Stopped):
            CsvImport.import_applications(markets, markets.doc, _csv(CHANGED_ROW), MAPPING)

        again, _ = CsvImport.import_applications(markets, markets.doc, _csv(CHANGED_ROW), MAPPING)

        after = applications.find_one({"id": stored["id"]})
        assert after["form_data"]["essential_available_dates"] == ["2026-08-01"]
        assert after["status"] == ApplicationStatus.OPEN.value
        assert after.get("verdict_by") is None and after.get("verdict_at") is None
        assert again["unchanged"] == 1 and again["returnedToReview"] == 0


class TestAVerdictBetweenTheReadAndTheWrite:
    def test_an_approval_that_lands_first_is_sent_back_to_review(
        self, monkeypatch, markets, applications,  # noqa: F811 (the fixture)
    ):
        CsvImport.import_applications(markets, markets.doc, _csv(GOOD_ROW), MAPPING)
        stored = applications.find_one({"applicant_email": ADDRESS})
        assert stored["status"] == ApplicationStatus.OPEN.value

        def a_reviewer_approves(call):
            if call == 1:
                _approve(applications)

        _before_each_answers_write(monkeypatch, applications, a_reviewer_approves)
        body, _ = CsvImport.import_applications(markets, markets.doc, _csv(CHANGED_ROW), MAPPING)

        after = applications.find_one({"id": stored["id"]})
        assert after["form_data"]["essential_available_dates"] == ["2026-08-01"]
        assert after["status"] == ApplicationStatus.OPEN.value
        assert after.get("verdict_by") is None and after.get("verdict_at") is None
        assert body["updated"] == 1 and body["returnedToReview"] == 1
        assert body["failures"] == []

    def test_a_verdict_cleared_first_is_not_counted_as_returned(
        self, monkeypatch, markets, applications,  # noqa: F811 (the fixture)
    ):
        """Decided again on what is stored: an approval taken back before the write leaves nothing
        to send back, so the row is an update and no more."""
        stored = _imported_and_approved(markets, applications)

        def a_reviewer_reopens(call):
            if call == 1:
                ApplicationsApi.update_application_status(stored["id"], ApplicationStatus.OPEN)

        _before_each_answers_write(monkeypatch, applications, a_reviewer_reopens)
        body, _ = CsvImport.import_applications(markets, markets.doc, _csv(CHANGED_ROW), MAPPING)

        after = applications.find_one({"id": stored["id"]})
        assert after["form_data"]["essential_available_dates"] == ["2026-08-01"]
        assert after["status"] == ApplicationStatus.OPEN.value
        assert body["updated"] == 1 and body["returnedToReview"] == 0


class TestARowThatKeepsChanging:
    def test_it_is_left_out_after_three_tries_with_a_sentence(
        self, monkeypatch, markets, applications,  # noqa: F811 (the fixture)
    ):
        stored = _imported_and_approved(markets, applications)

        def a_reviewer_decides_again(call):
            _approve(applications, verdict_at=f"2026-07-0{call + 1}T10:00:00+00:00")

        writes = _before_each_answers_write(monkeypatch, applications, a_reviewer_decides_again)
        body, _ = CsvImport.import_applications(markets, markets.doc, _csv(CHANGED_ROW), MAPPING)

        assert len(writes) == 3
        assert body["failures"] == [{
            "row": 2, "email": ADDRESS,
            "error": "This application changed while the file was imported, so its row was left "
                     "out. Import the file again to bring it in.",
        }]
        assert body["skipped"] == 1 and body["updated"] == 0 and body["returnedToReview"] == 0
        after = applications.find_one({"id": stored["id"]})
        assert after["form_data"] == stored["form_data"]
        assert after["status"] == ApplicationStatus.REVIEWER_APPROVED.value


class TestTheRowsNothingRaces:
    def test_a_new_row_is_created_open_with_its_answers(
        self, markets, applications,  # noqa: F811 (the fixture)
    ):
        body, _ = CsvImport.import_applications(markets, markets.doc, _csv(GOOD_ROW), MAPPING)

        stored = applications.find_one({"applicant_email": ADDRESS})
        assert body["created"] == 1 and body["failures"] == []
        assert stored["status"] == ApplicationStatus.OPEN.value
        assert stored["form_data"]["business_name"] == "Ember Ceramics"

    def test_an_unchanged_row_writes_nothing(
        self, monkeypatch, markets, applications,  # noqa: F811 (the fixture)
    ):
        _imported_and_approved(markets, applications)
        writes = _before_each_answers_write(monkeypatch, applications, lambda _call: None)

        body, _ = CsvImport.import_applications(markets, markets.doc, _csv(GOOD_ROW), MAPPING)

        assert writes == []
        assert body["unchanged"] == 1
        assert applications.find_one({"applicant_email": ADDRESS})["status"] == (
            ApplicationStatus.REVIEWER_APPROVED.value
        )

    def test_a_changed_solver_answer_returns_the_approval_in_the_answers_write(
        self, monkeypatch, markets, applications,  # noqa: F811 (the fixture)
    ):
        stored = _imported_and_approved(markets, applications)
        statuses = []
        original = applications.update_one

        def update_one(query, update):
            statuses.append((update.get("$set") or {}).get("status"))
            return original(query, update)

        monkeypatch.setattr(applications, "update_one", update_one)
        body, _ = CsvImport.import_applications(markets, markets.doc, _csv(CHANGED_ROW), MAPPING)

        assert body["returnedToReview"] == 1
        # One write to the application, holding both.
        assert statuses == [ApplicationStatus.OPEN.value]
        assert applications.find_one({"id": stored["id"]})["status"] == (
            ApplicationStatus.OPEN.value
        )
