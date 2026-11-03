"""A Google Form market's vendor page opens with its results (T202 ticket 05, ADR 0022).

A market that imports its vendors from the organizer's Google Form has a vendor page too, without
an application: from the moment its results are published, or from its market days for one that
went live before it could publish them. Before that, `/<slug>` and every vendor endpoint answer
for it exactly as for a slug that names nothing. Applying itself stays a form market's alone.
"""
from types import SimpleNamespace

import pytest

import api.applicant_auth as ApplicantAuthApi
import api.applicants as ApplicantsApi
import app as app_module
import db_config as test_db_config
from conftest import FakeSlugMarketsCollection, stored_market
from datatypes import MarketPhase, market_name_slug
from market_documents import applicant_intake_market_by_slug, vendor_page_market_by_slug

SLUG = market_name_slug("Test Market")
VENDOR = "vendor@example.com"
TOKEN = {"market_id": "market-123", "email": VENDOR}
RAN = ["draft", "applications", "assignment", "market_days", "archived"]
NEVER_RAN = ["draft", "applications", "assignment", "archived"]
SEAT = {
    "email": VENDOR, "date": "2099-08-01", "tableCode": "A1", "tableChoice": "Full Table",
    "section": "A", "tier": "Gold", "location": "Main Hall",
}


def _csv(phase=MarketPhase.ASSIGNMENT, reached=None, intake_mode="csv", **overrides):
    record = [
        {"phase": p, "enteredAt": "2026-05-01T00:00:00+00:00", "by": "o@x"}
        for p in reached or ["draft", "applications", phase.value]
    ]
    doc = stored_market(
        phase=phase,
        phaseHistory=record,
        setupObject={"marketDates": [{"date": "2099-08-01"}]},
        **overrides,
    )
    if intake_mode is not None:
        doc["intakeMode"] = intake_mode
    if phase is MarketPhase.DRAFT:
        doc["isDraft"] = True
    return doc


def _found(doc, **kwargs):
    return vendor_page_market_by_slug(FakeSlugMarketsCollection(doc), SLUG, **kwargs) is not None


class TestTheGate:
    @pytest.mark.parametrize("intake_mode", ["csv", None])
    @pytest.mark.parametrize("phase", [MarketPhase.APPLICATIONS, MarketPhase.ASSIGNMENT])
    def test_none_before_its_results(self, phase, intake_mode):
        assert not _found(_csv(phase, intake_mode=intake_mode))

    @pytest.mark.parametrize("intake_mode", ["csv", None])
    def test_one_once_its_results_are_published(self, intake_mode):
        assert _found(_csv(MarketPhase.ASSIGNMENT, intake_mode=intake_mode, resultsPublished=True))

    def test_one_in_its_market_days_without_published_results(self):
        """A Google Form market that went live before it could publish results stays open."""
        assert _found(_csv(MarketPhase.MARKET_DAYS))

    def test_one_archived_after_it_ran(self):
        assert _found(_csv(MarketPhase.ARCHIVED, reached=RAN))

    def test_one_archived_after_it_ran_with_a_record_that_began_late(self, market_records):
        """A partial record is proved by a check-in, as everywhere else that asks if it ran."""
        market_records.attendance.insert_one({"market_id": "market-123", "vendor_email": VENDOR})

        assert _found(_csv(MarketPhase.ARCHIVED, reached=["archived"]))

    def test_none_archived_without_running_or_publishing(self):
        assert not _found(_csv(MarketPhase.ARCHIVED, reached=NEVER_RAN))

    def test_one_archived_without_running_once_its_results_were_published(self):
        assert _found(_csv(MarketPhase.ARCHIVED, reached=NEVER_RAN, resultsPublished=True))

    def test_none_for_a_draft_whatever_it_holds(self):
        assert not _found(_csv(MarketPhase.DRAFT, reached=["draft"], resultsPublished=True))

    def test_the_caller_needs_not_name_what_the_gate_reads(self):
        """A projection naming only the caller's fields still answers the gate's own question."""
        collection = FakeSlugMarketsCollection(_csv(MarketPhase.ASSIGNMENT, resultsPublished=True))

        found = vendor_page_market_by_slug(collection, SLUG, fields=("id",))

        assert found is not None
        assert "setupObject" not in (collection.last_projection or {})
        assert "assignmentObject" not in (collection.last_projection or {})

    def test_the_caller_needs_not_name_the_record_either(self):
        collection = FakeSlugMarketsCollection(_csv(MarketPhase.ARCHIVED, reached=RAN))

        assert vendor_page_market_by_slug(collection, SLUG, fields=("id",)) is not None

    @pytest.mark.parametrize("phase", [MarketPhase.ASSIGNMENT, MarketPhase.MARKET_DAYS])
    def test_applying_stays_a_form_markets_alone(self, phase):
        collection = FakeSlugMarketsCollection(_csv(phase, resultsPublished=True))

        assert applicant_intake_market_by_slug(collection, SLUG) is None


@pytest.fixture
def markets(monkeypatch):
    """The markets collection every vendor endpoint reads, one document at a time."""
    holder = SimpleNamespace(collection=FakeSlugMarketsCollection([]))

    class _Db(dict):
        def __getitem__(self, name):
            return holder.collection if name == "markets" else FakeSlugMarketsCollection([])

    monkeypatch.setattr(test_db_config, "get_database", lambda *_a, **_kw: _Db())
    monkeypatch.setattr(ApplicantAuthApi, "db", _Db())

    def use(doc):
        holder.collection = FakeSlugMarketsCollection(doc)

    return use


@pytest.fixture
def client():
    return app_module.app.test_client()


# Every vendor endpoint a stranger can reach without a token, as (method, path, body).
PUBLIC_VENDOR_ENDPOINTS = [
    ("get", "/public/markets/{slug}/vendor-page", None),
    ("get", "/public/markets/{slug}/application-form", None),
    ("post", "/public/markets/{slug}/applicant-login/request-code", {"email": VENDOR}),
    ("post", "/public/markets/{slug}/applicant-login/verify-code", {"email": VENDOR, "code": "123456"}),
    ("post", "/public/markets/{slug}/applicant-login/resume", None),
]


def _answer(client, method, path, body, slug):
    response = getattr(client, method)(path.format(slug=slug), json=body)
    return response.status_code, response.get_data()


class TestBeforeItsResultsItIsAbsent:
    @pytest.mark.parametrize("method,path,body", PUBLIC_VENDOR_ENDPOINTS)
    def test_every_public_vendor_endpoint_answers_as_an_unknown_slug(
        self, client, markets, monkeypatch, method, path, body,
    ):
        monkeypatch.setattr(ApplicantAuthApi, "_send_code_email", lambda *_a, **_k: True)
        markets(_csv(MarketPhase.ASSIGNMENT))
        gated = _answer(client, method, path, body, SLUG)
        unknown = _answer(client, method, path, body, "no-such-market")

        assert gated == unknown

    def test_requesting_a_code_stores_no_challenge(self, client, markets, monkeypatch):
        stored = []
        monkeypatch.setattr(ApplicantAuthApi, "_store_challenge", lambda *a, **_k: stored.append(a) or 1)
        monkeypatch.setattr(ApplicantAuthApi, "_send_code_email", lambda *_a, **_k: True)
        markets(_csv(MarketPhase.ASSIGNMENT))

        client.post(f"/public/markets/{SLUG}/applicant-login/request-code", json={"email": VENDOR})

        assert stored == []

    def test_the_vendors_own_read_answers_as_an_unknown_slug(self, markets):
        markets(_csv(MarketPhase.ASSIGNMENT))
        gated = ApplicantsApi.get_applicant_application(SLUG, TOKEN)
        unknown = ApplicantsApi.get_applicant_application("no-such-market", TOKEN)

        assert gated == unknown
        assert gated[1] == 404


class TestOnceItsResultsArePublished:
    def test_the_page_answers_without_taking_applications(self, client, markets):
        markets(_csv(MarketPhase.ASSIGNMENT, resultsPublished=True))

        body = client.get(f"/public/markets/{SLUG}/vendor-page").get_json()

        assert body["intakeMode"] == "csv"
        assert body["resultsPublished"] is True
        assert body["takesApplications"] is False

    def test_a_vendor_is_sent_a_code(self, client, markets, monkeypatch):
        stored = []
        monkeypatch.setattr(ApplicantAuthApi, "_store_challenge", lambda *a, **_k: stored.append(a) or 1)
        monkeypatch.setattr(ApplicantAuthApi, "_send_code_email", lambda *_a, **_k: True)
        markets(_csv(MarketPhase.ASSIGNMENT, resultsPublished=True))

        client.post(f"/public/markets/{SLUG}/applicant-login/request-code", json={"email": VENDOR})

        assert len(stored) == 1

    def test_there_is_still_no_form_to_fill_in(self, client, markets):
        markets(_csv(MarketPhase.ASSIGNMENT, resultsPublished=True))

        response = client.get(f"/public/markets/{SLUG}/application-form")

        assert response.status_code == 404

    def _import(self, applications):
        applications.insert_one({
            "id": "app-1", "market_id": "market-123", "applicant_email": VENDOR,
            "application_type": "main", "status": "reviewer_approved",
            "form_data": {"essential_full_name": "Riley Fixture", "essential_email": VENDOR},
            "submitted_at": "2099-06-01T00:00:00+00:00", "updated_at": "2099-06-01T00:00:00+00:00",
        })

    def test_an_imported_vendor_reads_their_table_and_no_answers(self, markets, applications):
        self._import(applications)
        markets(_csv(
            MarketPhase.ASSIGNMENT, resultsPublished=True,
            assignmentObject={"vendorAssignments": [SEAT]},
        ))

        body, status = ApplicantsApi.get_applicant_application(SLUG, TOKEN)

        assert status == 200
        application = body["application"]
        assert application["outcome"] == "has_a_table"
        assert [seat["tableCode"] for seat in application["seats"]] == ["A1"]
        assert application["vendorName"] == "Riley Fixture"
        assert "formData" not in application

    def test_an_imported_vendor_without_a_seat_reads_so(self, markets, applications):
        self._import(applications)
        markets(_csv(MarketPhase.ASSIGNMENT, resultsPublished=True))

        body, _ = ApplicantsApi.get_applicant_application(SLUG, TOKEN)

        assert body["application"]["outcome"] == "not_assigned"
        assert body["application"]["seats"] == []

    def test_a_proven_address_with_no_vendor_there_reads_none(self, markets, applications):
        markets(_csv(MarketPhase.ASSIGNMENT, resultsPublished=True))

        body, status = ApplicantsApi.get_applicant_application(SLUG, TOKEN)

        assert (body, status) == ({"application": None}, 200)

    def test_a_form_market_still_carries_its_answers(self, markets, applications):
        self._import(applications)
        doc = _csv(MarketPhase.ASSIGNMENT, resultsPublished=True)
        doc["intakeMode"] = "form"
        markets(doc)

        body, _ = ApplicantsApi.get_applicant_application(SLUG, TOKEN)

        assert body["application"]["formData"]["essential_full_name"] == "Riley Fixture"
