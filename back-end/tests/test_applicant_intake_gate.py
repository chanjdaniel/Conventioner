"""A CSV market's applicant surface answers exactly as a market that does not exist.

Intake mode (E03/F02/S01) says how vendors reach a market. This is the gate it feeds: the five
applicant-intake endpoints serve form-intake markets only, while the two check-in endpoints serve
every published market regardless, because how a vendor entered a market has no bearing on
whether they can scan in on the day.
"""
from types import SimpleNamespace

import pytest
from flask import Flask

import api.applicants as ApplicantsApi
import api.applicant_auth as ApplicantAuthApi
import api.attendance as AttendanceApi
import db_config as test_db_config
from conftest import FakeSlugMarketsCollection, stored_market
from datatypes import MarketPhase, market_name_slug
from market_documents import applicant_intake_market_by_slug, published_market_by_slug

SLUG = market_name_slug("Test Market")
TOKEN = {"application_id": "app-1", "market_id": "market-123", "email": "vendor@example.com"}


def _market(intake_mode="form", phase=MarketPhase.APPLICATIONS_OPEN, **overrides):
    """A market whose applicant surface is live.

    Since E03/F03 that is `applications_open`, not "any non-draft phase": each public surface names
    its own phases, and intake stops when applications close. Check-in serves `market_days`, so the
    two tests about it pass that explicitly.
    """
    doc = stored_market(phase=phase, **overrides)
    if intake_mode is not None:
        doc["intakeMode"] = intake_mode
    return doc


class TestTheLookupItself:
    def test_a_form_market_is_found(self):
        collection = FakeSlugMarketsCollection(_market("form"))
        assert applicant_intake_market_by_slug(collection, SLUG) is not None

    def test_a_csv_market_is_not(self):
        collection = FakeSlugMarketsCollection(_market("csv"))
        assert applicant_intake_market_by_slug(collection, SLUG) is None

    def test_a_market_naming_no_intake_mode_is_not(self):
        """Absence means csv, so the public applicant surface fails closed."""
        collection = FakeSlugMarketsCollection(_market(intake_mode=None))
        assert applicant_intake_market_by_slug(collection, SLUG) is None

    def test_an_unknown_slug_is_not(self):
        collection = FakeSlugMarketsCollection(_market("form"))
        assert applicant_intake_market_by_slug(collection, "no-such-market") is None

    def test_a_draft_form_market_is_not(self):
        """The phase gate is not weakened by the intake gate; both have to pass."""
        draft = _market("form")
        draft["phase"] = "draft"
        draft["isDraft"] = True
        collection = FakeSlugMarketsCollection(draft)
        assert applicant_intake_market_by_slug(collection, SLUG) is None

    def test_a_csv_market_is_indistinguishable_from_an_absent_one(self):
        csv_market = FakeSlugMarketsCollection(_market("csv"))
        empty = FakeSlugMarketsCollection([])
        assert applicant_intake_market_by_slug(csv_market, SLUG) == applicant_intake_market_by_slug(
            empty, SLUG
        )

    def test_the_caller_still_gets_only_the_fields_it_named(self):
        """The projection bounds the decoded document; this lookup must not unbound it."""
        collection = FakeSlugMarketsCollection(_market("form", resultsPublished=True))
        applicant_intake_market_by_slug(collection, SLUG, fields=("id", "resultsPublished"))
        assert "setupObject" not in (collection.last_projection or {})
        assert "assignmentObject" not in (collection.last_projection or {})

    def test_intake_mode_is_projected_even_when_the_caller_does_not_name_it(self):
        """A market with no intake mode in hand reads as csv, so every form market would be gated."""
        collection = FakeSlugMarketsCollection(_market("form"))
        found = applicant_intake_market_by_slug(collection, SLUG, fields=("id",))
        assert found is not None

    def test_published_market_by_slug_still_serves_a_csv_market(self):
        """Check-in has its own lookup, which is why the requirement could not live inside it."""
        collection = FakeSlugMarketsCollection(
            _market("csv", phase=MarketPhase.MARKET_DAYS),
        )
        assert published_market_by_slug(collection, SLUG) is not None


@pytest.fixture
def applicant_markets(monkeypatch):
    """The markets collection behind the three ``api.applicants`` endpoints."""
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


class TestTheThreeApplicationEndpoints:
    """The public form, and the applicant's own application read and save."""

    @pytest.mark.parametrize("intake_mode", ["csv", None])
    def test_the_public_form_is_not_served_for_a_csv_market(self, applicant_markets, intake_mode):
        applicant_markets(_market(intake_mode=intake_mode))
        body, status = ApplicantsApi.get_public_application_form(SLUG)
        assert status == 404

    def test_the_public_form_is_served_for_a_form_market(self, applicant_markets):
        applicant_markets(_market("form"))
        _, status = ApplicantsApi.get_public_application_form(SLUG)
        assert status == 200

    def test_a_csv_market_answers_the_public_form_as_an_unknown_slug_does(
        self, applicant_markets
    ):
        applicant_markets(_market("csv"))
        gated = ApplicantsApi.get_public_application_form(SLUG)
        applicant_markets(_market("form"))
        absent = ApplicantsApi.get_public_application_form("no-such-market")
        assert gated == absent

    def test_reading_an_application_is_refused_for_a_csv_market(self, applicant_markets):
        applicant_markets(_market("csv"))
        _, status = ApplicantsApi.get_applicant_application(SLUG, TOKEN)
        assert status == 404

    def test_a_csv_market_answers_an_application_read_as_an_unknown_slug_does(
        self, applicant_markets
    ):
        applicant_markets(_market("csv"))
        gated = ApplicantsApi.get_applicant_application(SLUG, TOKEN)
        applicant_markets(_market("form"))
        absent = ApplicantsApi.get_applicant_application("no-such-market", TOKEN)
        assert gated == absent

    def test_saving_an_application_is_refused_for_a_csv_market(self, applicant_markets):
        applicant_markets(_market("csv"))
        _, status = ApplicantsApi.save_applicant_application(SLUG, TOKEN, {"a": "b"})
        assert status == 404

    def test_a_csv_market_answers_an_application_save_as_an_unknown_slug_does(
        self, applicant_markets
    ):
        applicant_markets(_market("csv"))
        gated = ApplicantsApi.save_applicant_application(SLUG, TOKEN, {"a": "b"})
        applicant_markets(_market("form"))
        absent = ApplicantsApi.save_applicant_application("no-such-market", TOKEN, {"a": "b"})
        assert gated == absent


@pytest.fixture
def auth_markets(monkeypatch):
    """The markets collection behind the two applicant-login endpoints."""
    holder = SimpleNamespace(collection=None)

    class _Db(dict):
        def __getitem__(self, name):
            if name == "markets":
                return holder.collection
            return FakeSlugMarketsCollection([])

    monkeypatch.setattr(ApplicantAuthApi, "db", _Db())

    def use(doc):
        holder.collection = FakeSlugMarketsCollection(doc)
        return holder.collection

    return use


class TestTheTwoLoginEndpoints:
    """Login already answers uniformly, so gating here means taking the unknown-market branch.

    These two endpoints never answered 404: they return one response whether the market, the
    applicant, or the code is unknown, so nothing about who has applied can be read off them. A
    CSV market joins that set rather than getting a distinguishable answer of its own.
    """

    def _request_code(self, slug):
        app = Flask(__name__)
        with app.test_request_context(
            f"/public/markets/{slug}/request-code",
            method="POST",
            json={"email": "someone@example.com"},
        ):
            body, status = ApplicantAuthApi.request_login_code(slug)
        return body.get_json(), status

    def _verify_code(self, slug):
        app = Flask(__name__)
        with app.test_request_context(
            f"/public/markets/{slug}/verify-code",
            method="POST",
            json={"email": "someone@example.com", "code": "123456"},
        ):
            body, status = ApplicantAuthApi.verify_login_code(slug)
        return body.get_json(), status

    def test_requesting_a_code_for_a_csv_market_answers_as_an_unknown_slug_does(
        self, auth_markets
    ):
        auth_markets(_market("csv"))
        gated = self._request_code(SLUG)
        auth_markets(_market("form"))
        absent = self._request_code("no-such-market")
        assert gated == absent

    def test_requesting_a_code_for_a_csv_market_stores_no_challenge(self, auth_markets, monkeypatch):
        """The market is never resolved, so nothing downstream of the lookup runs."""
        stored = []
        monkeypatch.setattr(ApplicantAuthApi, "_store_challenge",
                            lambda *args, **kwargs: stored.append(args))
        auth_markets(_market("csv"))
        self._request_code(SLUG)
        assert stored == []

    def test_verifying_a_code_for_a_csv_market_answers_as_an_unknown_slug_does(self, auth_markets):
        auth_markets(_market("csv"))
        gated = self._verify_code(SLUG)
        auth_markets(_market("form"))
        absent = self._verify_code("no-such-market")
        assert gated == absent


class TestCheckInIsNotGated:
    """A CSV market's vendors still scan in on the day. Gating this would break them for nothing."""

    @pytest.mark.parametrize("intake_mode", ["csv", "form", None])
    def test_the_check_in_lookup_serves_a_market_in_any_intake_mode(self, monkeypatch, intake_mode):
        collection = FakeSlugMarketsCollection(
            _market(intake_mode=intake_mode, phase=MarketPhase.MARKET_DAYS),
        )
        monkeypatch.setattr(AttendanceApi, "markets_collection", collection)
        assert AttendanceApi.get_published_market_by_slug(SLUG) is not None

    def test_check_in_still_refuses_a_draft_market(self, monkeypatch):
        draft = _market("csv")
        draft["phase"] = "draft"
        draft["isDraft"] = True
        monkeypatch.setattr(AttendanceApi, "markets_collection", FakeSlugMarketsCollection(draft))
        assert AttendanceApi.get_published_market_by_slug(SLUG) is None
