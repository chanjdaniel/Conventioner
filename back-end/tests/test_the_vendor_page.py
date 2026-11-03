"""One vendor page per market, at its own address (T202, ADR 0021).

`vendor_page_market_by_slug` decides whether a market has a vendor page, and every vendor read and
sign-in goes through it. The page's own public read, `GET /public/markets/<slug>/vendor-page`, says
what the page needs before anyone signs in, and answers a market the gate does not serve exactly as
it answers a slug that names nothing, so a stranger learns nothing of a draft or a gated market.
"""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from flask import Flask

import api.applicant_auth as ApplicantAuthApi
import api.applicants as ApplicantsApi
import app as app_module
import db_config as test_db_config
import remembered_sign_ins as RememberedSignIns
from conftest import FakeSlugMarketsCollection, stored_market
from datatypes import MarketPhase, market_name_slug
from market_documents import vendor_page_market_by_slug

SLUG = market_name_slug("Test Market")
VENDOR = "vendor@example.com"
TOKEN = {"market_id": "market-123", "email": VENDOR}
RAN = ["draft", "applications", "assignment", "market_days", "archived"]
NEVER_RAN = ["draft", "applications", "archived"]


def _market(intake_mode="form", phase=MarketPhase.APPLICATIONS, reached=None, **overrides):
    record = [
        {"phase": p, "enteredAt": "2026-05-01T00:00:00+00:00", "by": "o@x"} for p in reached or []
    ]
    doc = stored_market(
        phase=phase,
        phaseHistory=record,
        setupObject={"marketDates": [{"date": "2099-08-02"}, {"date": "2099-08-01"}]},
        **overrides,
    )
    if intake_mode is not None:
        doc["intakeMode"] = intake_mode
    return doc


def _draft(intake_mode="form"):
    draft = _market(intake_mode, phase=MarketPhase.DRAFT)
    draft["isDraft"] = True
    return draft


class TestTheGate:
    @pytest.mark.parametrize("phase", [p for p in MarketPhase if p is not MarketPhase.DRAFT])
    def test_a_form_market_has_a_page_in_every_phase_but_draft(self, phase):
        collection = FakeSlugMarketsCollection(_market("form", phase=phase))
        assert vendor_page_market_by_slug(collection, SLUG) is not None

    def test_a_draft_has_none(self):
        assert vendor_page_market_by_slug(FakeSlugMarketsCollection(_draft()), SLUG) is None

    @pytest.mark.parametrize("intake_mode", ["csv", None])
    def test_a_market_that_imports_its_vendors_has_none_yet(self, intake_mode):
        collection = FakeSlugMarketsCollection(_market(intake_mode, phase=MarketPhase.ASSIGNMENT))
        assert vendor_page_market_by_slug(collection, SLUG) is None

    def test_an_unknown_slug_has_none(self):
        collection = FakeSlugMarketsCollection(_market("form"))
        assert vendor_page_market_by_slug(collection, "no-such-market") is None

    def test_the_caller_gets_only_the_fields_it_named(self):
        collection = FakeSlugMarketsCollection(_market("form"))
        found = vendor_page_market_by_slug(collection, SLUG, fields=("id",))
        assert found is not None
        assert "setupObject" not in (collection.last_projection or {})


@pytest.fixture
def markets(monkeypatch):
    """The markets collection the applicant endpoints read, one document at a time."""
    holder = SimpleNamespace(collection=None)

    class _Db(dict):
        def __getitem__(self, name):
            assert name == "markets"
            return holder.collection

    monkeypatch.setattr(test_db_config, "get_database", lambda *_a, **_kw: _Db())

    def use(doc):
        holder.collection = FakeSlugMarketsCollection(doc)
        return holder.collection

    return use


@pytest.fixture
def client():
    return app_module.app.test_client()


def _page(client, slug=SLUG):
    response = client.get(f"/public/markets/{slug}/vendor-page")
    return response.status_code, response.get_data()


class TestThePagesPublicRead:
    def test_it_says_what_the_page_needs_before_sign_in(self, client, markets):
        markets(_market("form", phase=MarketPhase.APPLICATIONS, resultsPublished=False))

        response = client.get(f"/public/markets/{SLUG}/vendor-page")
        body = response.get_json()

        assert response.status_code == 200
        assert body == {
            "marketName": "Test Market",
            "intakeMode": "form",
            "phase": "applications",
            "takesApplications": True,
            "resultsPublished": False,
            "marketDates": ["2099-08-01", "2099-08-02"],
            "ended": False,
            "rememberUntil": body["rememberUntil"],
        }

    def test_a_stopped_form_takes_no_applications(self, client, markets):
        markets(_market("form", applicationsStopped=True))

        body = client.get(f"/public/markets/{SLUG}/vendor-page").get_json()

        assert body["takesApplications"] is False

    def test_published_results_say_so(self, client, markets):
        markets(_market("form", phase=MarketPhase.ASSIGNMENT, resultsPublished=True))

        body = client.get(f"/public/markets/{SLUG}/vendor-page").get_json()

        assert body["resultsPublished"] is True
        assert body["takesApplications"] is False

    def test_an_archived_market_that_ran_has_ended(self, client, markets):
        markets(_market("form", phase=MarketPhase.ARCHIVED, reached=RAN))

        body = client.get(f"/public/markets/{SLUG}/vendor-page").get_json()

        assert body["ended"] is True

    def test_one_archived_without_running_has_not(self, client, markets):
        markets(_market("form", phase=MarketPhase.ARCHIVED, reached=NEVER_RAN))

        body = client.get(f"/public/markets/{SLUG}/vendor-page").get_json()

        assert body["phase"] == "archived"
        assert body["ended"] is False

    @pytest.mark.parametrize(
        "gated",
        [_draft("form"), _market("csv"), _market(None), _market("csv", MarketPhase.MARKET_DAYS)],
        ids=["draft", "csv", "no-intake-mode", "csv-market-days"],
    )
    def test_a_market_without_a_page_answers_byte_for_byte_as_an_unknown_slug(
        self, client, markets, gated,
    ):
        markets(gated)
        refused = _page(client)
        markets(_market("form"))
        unknown = _page(client, "no-such-market")

        assert refused == unknown
        assert refused[0] == 404


class TestRememberUntil:
    """The date Remember me would end: the market's last date, or 120 days on, whichever is first."""

    NOW = datetime(2099, 7, 1, 15, 0, tzinfo=timezone.utc)

    def test_it_is_the_last_date_when_that_comes_first(self):
        expires = RememberedSignIns.remembered_until(["2099-08-01", "2099-08-02"], self.NOW)
        # The day after the last date at noon UTC, so the last date has ended everywhere.
        assert expires == datetime(2099, 8, 3, 12, 0, tzinfo=timezone.utc)

    def test_it_is_never_more_than_120_days_away(self):
        expires = RememberedSignIns.remembered_until(["2100-08-01"], self.NOW)
        assert expires == self.NOW + timedelta(days=120)

    def test_none_once_the_last_date_has_passed(self):
        assert RememberedSignIns.remembered_until(["2099-06-29"], self.NOW) is None

    def test_none_for_a_market_with_no_dates(self):
        assert RememberedSignIns.remembered_until([], self.NOW) is None

    def test_the_page_reads_the_last_date_when_that_comes_first(self, client, markets, monkeypatch):
        """The vendor reads the market's last date, not the noon after it that ends it."""
        monkeypatch.setattr(RememberedSignIns, "now", lambda: self.NOW)
        markets(_market("form"))

        body = client.get(f"/public/markets/{SLUG}/vendor-page").get_json()

        assert body["rememberUntil"] == "2099-08-02"

    def test_the_page_reads_the_date_120_days_on_when_that_comes_first(
        self, client, markets, monkeypatch,
    ):
        monkeypatch.setattr(RememberedSignIns, "now", lambda: datetime(2099, 1, 1, tzinfo=timezone.utc))
        markets(_market("form"))

        body = client.get(f"/public/markets/{SLUG}/vendor-page").get_json()

        assert body["rememberUntil"] == "2099-05-01"

    def test_the_page_reads_null_after_the_market(self, client, markets, monkeypatch):
        monkeypatch.setattr(RememberedSignIns, "now", lambda: datetime(2100, 1, 1, tzinfo=timezone.utc))
        markets(_market("form"))

        body = client.get(f"/public/markets/{SLUG}/vendor-page").get_json()

        assert body["rememberUntil"] is None


SEAT = {
    "email": VENDOR, "date": "2099-08-01", "tableCode": "A1", "tableChoice": "Full Table",
    "section": "A", "tier": "Gold", "location": "Main Hall",
}


class TestTheVendorsOwnRead:
    def _apply(self, applications, **form_data):
        applications.insert_one({
            "id": "app-1", "market_id": "market-123", "applicant_email": VENDOR,
            "application_type": "main", "status": "reviewer_approved",
            "form_data": {"essential_full_name": "Riley Fixture", **form_data},
            "submitted_at": "2099-06-01T00:00:00+00:00", "updated_at": "2099-06-01T00:00:00+00:00",
        })

    def test_it_carries_the_vendors_name(self, markets, applications):
        self._apply(applications, essential_preferred_name="Riley's Prints")
        markets(_market("form"))

        body, status = ApplicantsApi.get_applicant_application(SLUG, TOKEN)

        assert status == 200
        assert body["application"]["vendorName"] == "Riley's Prints"

    def test_each_seat_carries_when_they_checked_in(self, markets, applications, market_records):
        self._apply(applications)
        second = {**SEAT, "date": "2099-08-02", "tableCode": "B2"}
        markets(_market(
            "form", phase=MarketPhase.MARKET_DAYS, resultsPublished=True,
            assignmentObject={"vendorAssignments": [SEAT, second]},
        ))
        market_records.attendance.insert_one({
            "market_id": "market-123", "vendor_email": VENDOR, "date": "2099-08-01",
            "checked_in_at": "2099-08-01T09:00:00+00:00",
        })

        body, _ = ApplicantsApi.get_applicant_application(SLUG, TOKEN)

        seats = body["application"]["seats"]
        assert [(s["date"], s["checkedInAt"]) for s in seats] == [
            ("2099-08-01", "2099-08-01T09:00:00+00:00"),
            ("2099-08-02", None),
        ]

    def test_another_vendors_check_in_is_not_theirs(self, markets, applications, market_records):
        self._apply(applications)
        markets(_market(
            "form", phase=MarketPhase.MARKET_DAYS, resultsPublished=True,
            assignmentObject={"vendorAssignments": [SEAT]},
        ))
        market_records.attendance.insert_one({
            "market_id": "market-123", "vendor_email": "someone-else@example.com",
            "date": "2099-08-01", "checked_in_at": "2099-08-01T09:00:00+00:00",
        })

        body, _ = ApplicantsApi.get_applicant_application(SLUG, TOKEN)

        assert body["application"]["seats"][0]["checkedInAt"] is None

    def test_a_draft_answers_as_an_unknown_slug(self, markets):
        markets(_draft())
        refused = ApplicantsApi.get_applicant_application(SLUG, TOKEN)
        markets(_market("form"))
        unknown = ApplicantsApi.get_applicant_application("no-such-market", TOKEN)

        assert refused == unknown


@pytest.fixture
def auth_markets(monkeypatch):
    holder = SimpleNamespace(collection=None)

    class _Db(dict):
        def __getitem__(self, name):
            if name == "markets":
                return holder.collection
            return FakeSlugMarketsCollection([])

    monkeypatch.setattr(ApplicantAuthApi, "db", _Db())

    def use(doc):
        holder.collection = FakeSlugMarketsCollection(doc)

    return use


class TestTheSignInUsesTheGate:
    def _request_code(self, slug):
        with Flask(__name__).test_request_context(
            "/", method="POST", json={"email": VENDOR},
        ):
            body, status = ApplicantAuthApi.request_login_code(slug)
        return body.get_json(), status

    def test_an_archived_form_market_still_sends_its_vendors_a_code(self, auth_markets, monkeypatch):
        stored = []
        monkeypatch.setattr(ApplicantAuthApi, "_store_challenge", lambda *a, **_k: stored.append(a))
        monkeypatch.setattr(ApplicantAuthApi, "_send_code_email", lambda *_a, **_k: True)
        auth_markets(_market("form", phase=MarketPhase.ARCHIVED, reached=RAN))

        self._request_code(SLUG)

        assert len(stored) == 1

    def test_a_draft_stores_no_challenge(self, auth_markets, monkeypatch):
        stored = []
        monkeypatch.setattr(ApplicantAuthApi, "_store_challenge", lambda *a, **_k: stored.append(a))
        auth_markets(_draft())

        self._request_code(SLUG)

        assert stored == []
