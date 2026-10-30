"""Each new application is dealt to the next reviewer as it arrives (E38/F07/S03, ADR 0020).

Choosing reviewers deals the applications already open; one that arrives after is dealt to the next
reviewer in turn, whatever each has left open: an applicant's submission, an import, and a write
whose automatic rejections return an application to open (saving the rules, updating a vendor's
info). Each records one ``dealt`` entry under its own action and actor. An application a rule
rejects on arrival is decided and is not dealt, until the rules return it to open. Two arriving at
once take different turns.
"""

import pytest

from conftest import sessions_load_through_get_user, stored_market
from test_choosing_reviewers_deals_the_open_applications import (
    ADMIN, ANA, BEN, CAT, EMAILS, MARKET, PEOPLE, ROLES, Markets, _account, _application, _choose,
    _client, _reviewers,
)
from test_csv_import import MAPPING, _csv
from test_csv_import import _market_doc as _import_market_doc
from test_essential_fields import VALID_ANSWERS, _applicant_market_doc

import app as app_module
import api.applicants as ApplicantsApi
import api.markets as MarketsApi
import api.users as UsersApi
import db_config
import history as History
import review_team as ReviewTeam
from datatypes import MarketPhase

STUDENT = {"key": "student", "label": "Are you a student?", "type": "select",
           "options": ["Yes", "No"], "required": False, "order": 1}
BUSINESS = {"key": "business_name", "label": "Business Name", "type": "text", "required": True,
            "options": [], "order": 0}
NO_STUDENTS = [{"key": "student", "answers": ["Yes"]}]
#: The open applications dealt before anyone arrives, 3, 2 and 2 among Ana, Ben and Cat.
DEALT = [f"v{n}" for n in range(1, 8)]


@pytest.fixture
def world(monkeypatch, applications, market_records):
    state = type("World", (), {})()

    def use(doc):
        markets = Markets({**doc, "id": MARKET, "_id": "mongo-1", "organizationId": None,
                           "roles": dict(ROLES)})
        for module in (MarketsApi, ReviewTeam):
            monkeypatch.setattr(module, "markets_collection", markets)
        monkeypatch.setattr(db_config, "get_database", lambda *_a, **_k: {"markets": markets})
        state.markets = markets
        return markets

    def applicant_market(**overrides):
        return use({**_applicant_market_doc(**overrides),
                    "applicationForm": {"fields": [BUSINESS, STUDENT]}})

    sessions_load_through_get_user(monkeypatch)
    monkeypatch.setattr(app_module.login_manager, "session_protection", None)
    monkeypatch.setattr(
        UsersApi, "get_user", lambda email: _account(email) if email in PEOPLE else None)
    monkeypatch.setattr(
        UsersApi, "get_user_by_id", lambda uid: _account(EMAILS[uid]) if uid in EMAILS else None)
    state.vendor = None
    monkeypatch.setattr(ApplicantsApi, "authenticate_request",
                        lambda _header: {"market_id": MARKET, "email": state.vendor})
    applications.documents = [_application(v, int(v[1:])) for v in DEALT]
    state.use, state.applicant_market = use, applicant_market
    state.applications, state.history = applications, market_records.history
    applicant_market()
    return state


def _submit(world, vendor, **answers):
    world.vendor = vendor
    response = app_module.app.test_client().put(
        "/public/markets/test-market/applicant/application",
        json={"formData": {**VALID_ANSWERS, "business_name": vendor, **answers}})
    assert response.status_code == 200, response.get_json()
    return response


def _id_of(world, vendor):
    return next(d["id"] for d in world.applications.documents if d["applicant_email"] == vendor)


def _arrivals(world):
    return [e for e in world.history.documents
            if e["kind"] == History.DEALT and e["detail"]["cause"] == ReviewTeam.ARRIVED]


class TestASubmission:
    def test_the_eighth_and_ninth_go_to_the_second_and_third_reviewers(self, world):
        _choose([ANA, BEN, CAT])

        _submit(world, "v8@vendor.test")
        _submit(world, "v9@vendor.test")

        dealt = _reviewers(world)
        assert [dealt[v] for v in DEALT] == [ANA, BEN, CAT, ANA, BEN, CAT, ANA]
        assert (dealt["v8"], dealt["v9"]) == (BEN, CAT)
        assert world.markets.doc["reviewTeam"]["turn"] == 9

    def test_it_is_recorded_as_the_applicants_own_arrival(self, world):
        _choose([ANA, BEN, CAT])

        _submit(world, "v8@vendor.test")

        [entry] = _arrivals(world)
        app_id = _id_of(world, "v8@vendor.test")
        assert (entry["actor"], entry["action"], entry["vendors"], entry["subject"]) == (
            "v8@vendor.test", History.APPLY, ["v8@vendor.test"], {"application_ids": [app_id]})
        assert entry["detail"] == {
            "cause": "arrived",
            "before": {app_id: {"reviewer": None}}, "after": {app_id: {"reviewer": BEN}},
        }

    def test_an_edit_deals_nothing_again(self, world):
        _choose([ANA, BEN, CAT])
        _submit(world, "v8@vendor.test")

        _submit(world, "v8@vendor.test", business_name="Ember Ceramics")

        assert len(_arrivals(world)) == 1
        assert _reviewers(world)["v8"] == BEN
        assert world.markets.doc["reviewTeam"]["turn"] == 8

    def test_with_no_reviewers_nothing_is_dealt_or_recorded(self, world):
        _submit(world, "v8@vendor.test")

        assert _reviewers(world)["v8"] is None
        assert _arrivals(world) == []
        assert "reviewTeam" not in world.markets.doc

    def test_one_a_rule_rejects_as_it_arrives_is_not_dealt(self, world):
        world.applicant_market(rejectionRules=NO_STUDENTS)
        _choose([ANA, BEN, CAT])

        _submit(world, "v8@vendor.test", student="Yes")

        assert _reviewers(world)["v8"] is None
        assert _arrivals(world) == []
        assert world.markets.doc["reviewTeam"]["turn"] == 7


class TestOneWhoCanNoLongerReview:
    def test_the_next_arrival_skips_a_reviewer_whose_role_was_taken(self, world):
        _choose([ANA, BEN, CAT])
        world.markets.doc["roles"].pop("user-ben")

        _submit(world, "v8@vendor.test")

        # Ben's turn, the eighth, goes to the able two in turn.
        assert _reviewers(world)["v8"] == CAT

    def test_with_no_reviewer_able_an_arrival_is_not_dealt(self, world):
        _choose([BEN])
        world.markets.doc["roles"].pop("user-ben")

        _submit(world, "v8@vendor.test")

        assert _reviewers(world)["v8"] is None
        assert _arrivals(world) == []
        assert world.markets.doc["reviewTeam"]["turn"] == 7


class TestWhatTheRulesReturnToOpen:
    @pytest.fixture
    def rejected(self, world):
        world.applicant_market(rejectionRules=NO_STUDENTS)
        _choose([ANA, BEN, CAT])
        _submit(world, "v8@vendor.test", student="Yes")
        return _id_of(world, "v8@vendor.test")

    def test_saving_the_rules_deals_it_then(self, world, rejected):
        response = _client().put(f"/markets/{MARKET}/rejection-rules", json={"rules": []})

        assert response.status_code == 200, response.get_json()
        assert _reviewers(world)["v8"] == BEN
        [entry] = _arrivals(world)
        assert (entry["actor"], entry["action"], entry["subject"]) == (
            ADMIN, "change-form", {"application_ids": [rejected]})

    def test_updating_the_vendors_info_deals_it_then(self, world, rejected):
        response = _client().put(f"/markets/{MARKET}/applications/{rejected}/answers",
                                 json={"answers": {"student": "No"}})

        assert response.status_code == 200, response.get_json()
        assert response.get_json()["application"]["reviewer"]["email"] == BEN
        [entry] = _arrivals(world)
        assert (entry["actor"], entry["action"]) == (ADMIN, "update-vendor-info")


class TestAnImport:
    def test_new_rows_are_dealt_in_arrival_order_from_the_turn(self, world):
        world.use(_import_market_doc(phase=MarketPhase.APPLICATIONS))
        _choose([ANA, BEN, CAT])
        rows = [
            f'2026/10/2{n} 9:14:03,new{n}@ember.test,Nadia Okonkwo,Ember Ceramics {n},'
            f'"2026-08-01, 2026-08-08",2,Gold,half,,"Garden, Main Hall"'
            # Out of arrival order in the file, so the deal is seen to follow arrival.
            for n in (3, 1, 4, 2)
        ]

        response = _client().post(f"/markets/{MARKET}/applications/import",
                                  json={"csvContent": _csv(*rows), "mapping": MAPPING})

        assert response.status_code == 200, response.get_json()
        dealt = _reviewers(world)
        assert [dealt[f"new{n}"] for n in (1, 2, 3, 4)] == [BEN, CAT, ANA, BEN]
        [entry] = _arrivals(world)
        assert (entry["actor"], entry["action"]) == (ADMIN, "import-applications")
        assert entry["vendors"] == [f"new{n}@ember.test" for n in (1, 2, 3, 4)]
        # After the import's own entry, so the history reads the import first.
        kinds = [e["kind"] for e in world.history.documents]
        assert kinds.index(History.IMPORTED) < kinds.index(History.DEALT, kinds.index(
            History.IMPORTED))


class TestAnApplicantsSave:
    def test_deals_their_own_application_and_no_one_elses(self, world):
        _choose([ANA, BEN, CAT])
        # Open and undealt from a time when nobody chosen could review here.
        world.applications.documents.append(_application("left-over", 21))

        _submit(world, "v8@vendor.test")

        dealt = _reviewers(world)
        assert (dealt["v8"], dealt["left-over"]) == (BEN, None)
        [entry] = _arrivals(world)
        assert entry["vendors"] == ["v8@vendor.test"]

    def test_does_not_read_the_markets_other_applications(self, world, monkeypatch):
        _choose([ANA, BEN, CAT])

        import api.applications as ApplicationsApi

        def untouched(*_a, **_k):
            raise AssertionError("an applicant's save read the market's other applications")

        monkeypatch.setattr(ApplicationsApi, "undecided_in_arrival_order", untouched)

        _submit(world, "v8@vendor.test")

        assert _reviewers(world)["v8"] == BEN


def test_a_market_with_no_team_is_not_read_for_a_deal(world, monkeypatch):
    """No reviewers chosen is the state before this feature, and costs it nothing."""
    def untouched(*_a, **_k):
        raise AssertionError("dealt with no reviewers")

    import api.applications as ApplicationsApi
    monkeypatch.setattr(ApplicationsApi, "undecided_in_arrival_order", untouched)
    monkeypatch.setattr(world.markets, "find_one_and_update", untouched)

    assert ReviewTeam.deal_arrivals(
        MarketsApi.market_from_document(stored_market(MarketPhase.APPLICATIONS)), ADMIN,
        History.APPLY) == 0
