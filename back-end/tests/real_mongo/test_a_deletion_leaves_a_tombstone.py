"""A deletion leaves a tombstone: cut at any step and retried, it leaves one trail entry and nothing
behind, and nothing writes to its target while it is being deleted.

Deleting a market is several writes, and an organization's more; each runs here on a real server.
A cut is the step raising once, as a process killed there would leave things; the retry is the
same request sent again. A racing write is ``interleave``: the deletion lands between the write's
read of the market and its write.
"""
import uuid

import pytest

import api.markets as MarketsApi
import api.organizations as OrgsApi
import history as History
from datatypes import MarketPhase
from market_documents import MARKETS_COLLECTION
from real_mongo import harness
from test_csv_import import FORM_FIELDS, GOOD_ROW, MAPPING, SETUP_CAMEL, _csv
from test_essential_fields import VALID_ANSWERS

OWNER = "fixture-deleting-owner@example.com"
APPLICANT = "fixture-applicant@example.com"
ORG = "org-being-deleted"
ENTERED = "2026-11-01T09:00:00+00:00"

#: Every collection a market keeps records in, by the ``market_records`` fixture's names.
RECORD_KINDS = ("attendance", "challenges", "remembered", "history", "notes", "payments",
                "amounts_owed")


class Cut(RuntimeError):
    """The process stopped here: the request answers 500, as any unexpected error does."""


class _Cutting:
    """A collection whose one method is cut, every other call passed through."""

    def __init__(self, collection, method, wrapper):
        self._collection, self._method, self._wrapper = collection, method, wrapper

    def __getattr__(self, name):
        return self._wrapper if name == self._method else getattr(self._collection, name)


def _cut(monkeypatch, target, on_call=1):
    """Make ``target``'s ``on_call``-th call raise ``Cut`` once, as a process stopped there would;
    every other call runs it as it is. A target ending in a collection's method cuts that method of
    the module's handle."""
    module, _, method = target.rpartition(".")
    if module.endswith("_collection"):
        owner, attribute = harness._resolve(module)
        collection = getattr(owner, attribute)
        original = getattr(collection, method)
    else:
        owner, attribute = harness._resolve(target)
        original = getattr(owner, attribute)
    calls = []

    def wrapper(*args, **kwargs):
        calls.append(True)
        if len(calls) == on_call:
            raise Cut(target)
        return original(*args, **kwargs)

    if module.endswith("_collection"):
        monkeypatch.setattr(owner, attribute, _Cutting(collection, method, wrapper))
    else:
        monkeypatch.setattr(owner, attribute, wrapper)
    return calls


def _history(*phases):
    return [{"phase": phase.value, "enteredAt": ENTERED, "by": OWNER} for phase in phases]


@pytest.fixture
def organization(real_db, signed_in, market_in, applications, market_records):
    """An organization its owner is deleting: a draft and an archived market, each with an
    application and a history entry. Answers the owner's client and the two markets."""
    client = signed_in(OWNER)
    real_db["organizations"].insert_one({
        "id": ORG, "name": "Fixture Deleted Markets", "people": {client.account_id: "owner"},
        "owner": client.account_id, "admins": [], "members": [], "markets": [], "theme": None})
    real_db["users"].update_one({"id": client.account_id}, {"$addToSet": {"organizations": ORG}})
    markets = [
        market_in(MarketPhase.DRAFT, organizationId=ORG, phaseHistory=_history(MarketPhase.DRAFT)),
        market_in(MarketPhase.ARCHIVED, organizationId=ORG,
                  phaseHistory=_history(MarketPhase.DRAFT, MarketPhase.ARCHIVED)),
    ]
    real_db["organizations"].update_one({"id": ORG}, {"$set": {"markets": [m["id"] for m in markets]}})
    for market in markets:
        _keep_records(market, applications, market_records)
    History.record_for_organization(ORG, OWNER, "rename-organization", detail={"name": "x"})
    return client, markets


def _keep_records(market, applications, market_records):
    applications.insert_one({"id": str(uuid.uuid4()), "market_id": market["id"],
                             "applicant_email": APPLICANT, "application_type": "main",
                             "status": "open", "form_data": {}})
    market_records.history.insert_one({"id": str(uuid.uuid4()), "market_id": market["id"],
                                       "at": ENTERED, "action": "rename", "detail": {}})


def _nothing_left_of(markets, real_db, applications, market_records):
    ids = [market["id"] for market in markets]
    assert list(real_db[MARKETS_COLLECTION].find({"id": {"$in": ids}})) == []
    assert list(applications.find({"market_id": {"$in": ids}})) == []
    for kind in RECORD_KINDS:
        assert list(getattr(market_records, kind).find({"market_id": {"$in": ids}})) == [], kind


def _trail(real_db):
    return list(real_db["deletion_trail"].find({"organization_id": ORG}))


class TestAnOrganizationsDeletionCutAndRetried:
    @pytest.mark.parametrize("target, on_call", [
        ("deletion_trail.record_organization_deletion", 1),
        ("api.applications.delete_applications_for_market", 1),
        ("market_deletion.delete_market_and_records", 2),
        ("history.delete_for_organization", 1),
        ("api.organizations.users_collection.update_many", 1),
    ], ids=["writing the trail", "sweeping the first market", "deleting the second market",
            "deleting its history", "taking it from its people"])
    def test_leaves_one_trail_entry_naming_both_markets_and_nothing_behind(
            self, organization, monkeypatch, real_db, applications, market_records, target,
            on_call):
        client, markets = organization
        _cut(monkeypatch, target, on_call)

        assert client.delete(f"/organizations/{ORG}").status_code == 500
        retried = client.delete(f"/organizations/{ORG}")

        assert retried.status_code == 200, retried.get_json()
        [entry] = _trail(real_db)
        assert sorted(m["id"] for m in entry["markets"]) == sorted(m["id"] for m in markets)
        assert entry["actor_email"] == OWNER
        _nothing_left_of(markets, real_db, applications, market_records)
        assert real_db["organizations"].find_one({"id": ORG}) is None
        assert list(market_records.history.find({"organization_id": ORG})) == []
        assert ORG not in real_db["users"].find_one({"id": client.account_id})["organizations"]


class TestADraftEnteringReviewAfterThePreview:
    def test_is_not_deleted_and_the_deletion_is_refused_naming_it(
            self, organization, interleave, real_db):
        client, (draft, archived) = organization

        def enters_review():
            as_read = real_db[MARKETS_COLLECTION].find_one({"id": draft["id"]})
            MarketsApi.apply_phase_transition(as_read, MarketPhase.APPLICATIONS.value, by=OWNER)

        real_db[MARKETS_COLLECTION].update_one(
            {"id": draft["id"]}, {"$set": {"intakeMode": "form"}})
        interleave("api.organizations.organization_deletion_preview", enters_review)

        response = client.delete(f"/organizations/{ORG}")

        assert response.status_code == 409, response.get_json()
        assert [m["id"] for m in response.get_json()["blockingMarkets"]] == [draft["id"]]
        stored = real_db[MARKETS_COLLECTION].find_one({"id": draft["id"]})
        assert stored["phase"] == MarketPhase.APPLICATIONS.value
        assert "deleting" not in stored
        assert "deleting" not in real_db[MARKETS_COLLECTION].find_one({"id": archived["id"]})
        assert "deleting" not in real_db["organizations"].find_one({"id": ORG})
        assert _trail(real_db) == []


class TestAMarketsOwnDeleteCutAndRetried:
    @pytest.mark.parametrize("target", [
        "api.applications.delete_applications_for_market",
        "history.delete_for_market",
        "history.record_for_organization",
    ], ids=["sweeping its applications", "sweeping its history", "recording that it went"])
    def test_records_that_it_went_once_and_leaves_nothing_behind(
            self, organization, monkeypatch, real_db, applications, market_records, target):
        client, (draft, _archived) = organization
        _cut(monkeypatch, target)

        assert client.delete(f"/markets/{draft['id']}").status_code == 500
        retried = client.delete(f"/markets/{draft['id']}")

        assert retried.status_code == 200, retried.get_json()
        _nothing_left_of([draft], real_db, applications, market_records)
        went = list(market_records.history.find(
            {"organization_id": ORG, "action": History.DELETE_MARKET}))
        assert [entry["subject"] for entry in went] == [{"market_id": draft["id"]}]
        assert draft["id"] not in real_db["organizations"].find_one({"id": ORG})["markets"]


def _applicant_market(market_in):
    return market_in(MarketPhase.APPLICATIONS, intakeMode="form", setupObject=SETUP_CAMEL,
                     applicationForm={"fields": [
                         {"key": "business_name", "label": "Business Name", "type": "text",
                          "required": True, "options": [], "order": 0}]},
                     phaseHistory=_history(MarketPhase.DRAFT, MarketPhase.APPLICATIONS))


class TestAWriteRacingTheDeletion:
    def test_an_applicants_save_is_refused_and_leaves_no_application(
            self, signed_in, market_in, interleave, real_db, applications, market_records):
        import api.applicants as ApplicantsApi

        signed_in(OWNER)
        market = _applicant_market(market_in)
        interleave("api.applicants.applicant_intake_market_by_slug",
                   lambda: MarketsApi.delete_market(market["id"], OWNER))

        body, status = ApplicantsApi.save_applicant_application(
            market["slug"], {"market_id": market["id"], "email": APPLICANT},
            {**VALID_ANSWERS, "business_name": "Fixture Stall"})

        assert status == 404, body
        _nothing_left_of([market], real_db, applications, market_records)

    def test_an_import_is_refused_and_leaves_no_application(
            self, signed_in, market_in, interleave, real_db, applications, market_records):
        client = signed_in(OWNER)
        market = market_in(MarketPhase.APPLICATIONS, setupObject=SETUP_CAMEL,
                           applicationForm={"fields": FORM_FIELDS, "essentialOptions": None},
                           phaseHistory=_history(MarketPhase.DRAFT, MarketPhase.APPLICATIONS))
        interleave("csv_import.save_mapping",
                   lambda: MarketsApi.delete_market(market["id"], OWNER))

        response = client.post(f"/markets/{market['id']}/applications/import",
                               json={"csvContent": _csv(GOOD_ROW), "mapping": MAPPING})

        assert response.status_code == 404, response.get_json()
        _nothing_left_of([market], real_db, applications, market_records)


class TestACutAtTheBranchsOwnSteps:
    """The steps a tombstone adds, and the last write of each deletion."""

    @pytest.mark.parametrize("target, on_call", [
        ("market_deletion.mark_deleting", 2),
        ("api.organizations.organizations_collection.delete_one", 1),
    ], ids=["giving the second market its tombstone", "deleting the organization"])
    def test_an_organizations_deletion_leaves_one_entry_and_nothing_behind(
            self, organization, monkeypatch, real_db, applications, market_records, target,
            on_call):
        client, markets = organization
        _cut(monkeypatch, target, on_call)

        assert client.delete(f"/organizations/{ORG}").status_code == 500
        retried = client.delete(f"/organizations/{ORG}")

        assert retried.status_code == 200, retried.get_json()
        [entry] = _trail(real_db)
        assert sorted(m["id"] for m in entry["markets"]) == sorted(m["id"] for m in markets)
        _nothing_left_of(markets, real_db, applications, market_records)
        assert real_db["organizations"].find_one({"id": ORG}) is None

    def test_a_markets_own_delete_cut_before_the_market_goes_records_it_once(
            self, organization, monkeypatch, real_db, applications, market_records):
        client, (draft, _archived) = organization
        _cut(monkeypatch, "api.markets.markets_collection.delete_one")

        assert client.delete(f"/markets/{draft['id']}").status_code == 500
        assert client.get(f"/markets/{draft['id']}").status_code == 404
        retried = client.delete(f"/markets/{draft['id']}")

        assert retried.status_code == 200, retried.get_json()
        _nothing_left_of([draft], real_db, applications, market_records)
        assert len(list(market_records.history.find(
            {"organization_id": ORG, "action": History.DELETE_MARKET}))) == 1

    def test_only_its_owner_may_resume_an_organizations_deletion(
            self, organization, monkeypatch, signed_in, real_db):
        client, _markets = organization
        _cut(monkeypatch, "deletion_trail.record_organization_deletion")
        assert client.delete(f"/organizations/{ORG}").status_code == 500
        stranger = signed_in("fixture-stranger@example.com")

        assert stranger.delete(f"/organizations/{ORG}").status_code == 403
        assert "deleting" in real_db["organizations"].find_one({"id": ORG})


def _tombstoned(real_db, collection, target_id):
    real_db[collection].update_one({"id": target_id}, {"$set": {"deleting": {
        "at": ENTERED, "by": OWNER, "trail_id": "trail-in-flight"}}})


class TestATargetBeingDeletedReadsAsAbsent:
    def test_a_market_is_not_served_listed_renamed_or_shown_on_its_vendor_page(
            self, signed_in, market_in, real_db):
        client = signed_in(OWNER)
        market = _applicant_market(market_in)
        assert client.get(f"/markets/{market['id']}").status_code == 200
        assert client.get(f"/public/markets/{market['slug']}/vendor-page").status_code == 200
        _tombstoned(real_db, MARKETS_COLLECTION, market["id"])

        assert client.get(f"/markets/{market['id']}").status_code == 404
        assert client.get("/markets").get_json()["markets"] == []
        assert client.put(f"/markets/{market['id']}/name",
                          json={"name": "Fixture Renamed"}).status_code == 404
        assert client.get(f"/public/markets/{market['slug']}/vendor-page").status_code == 404
        assert real_db[MARKETS_COLLECTION].find_one({"id": market["id"]})["name"] == market["name"]

    def test_a_judged_write_that_read_it_live_is_refused_as_absent(
            self, signed_in, market_in, real_db):
        from market_write import MarketNotFoundError, write_market

        signed_in(OWNER)
        market = market_in(MarketPhase.DRAFT)
        as_read = real_db[MARKETS_COLLECTION].find_one({"id": market["id"]})
        _tombstoned(real_db, MARKETS_COLLECTION, market["id"])

        with pytest.raises(MarketNotFoundError):
            write_market(as_read, {"$set": {"name": "Fixture Renamed"}})
        assert real_db[MARKETS_COLLECTION].find_one({"id": market["id"]})["name"] == market["name"]

    def test_an_organization_is_not_listed_renamed_or_given_a_market(
            self, organization, real_db):
        client, _markets = organization
        assert [o["id"] for o in client.get("/organizations").get_json()["organizations"]] == [ORG]
        _tombstoned(real_db, "organizations", ORG)

        assert client.get("/organizations").get_json() == {"organizations": []}
        assert client.put(f"/organizations/{ORG}", json={"name": "Fixture Renamed"}).status_code \
            == 404
        assert client.post("/markets", json={
            "name": "Fixture New Market", "creationDate": "2026-01-01T00:00:00Z",
            "organizationId": ORG}).status_code == 400
        assert real_db["organizations"].find_one({"id": ORG})["name"] == "Fixture Deleted Markets"

    def test_a_market_created_as_its_organization_begins_deleting_is_taken_back(
            self, organization, interleave, real_db):
        client, markets = organization
        interleave("api.markets.organization_refusal",
                   lambda: _tombstoned(real_db, "organizations", ORG))

        response = client.post("/markets", json={
            "name": "Fixture New Market", "creationDate": "2026-01-01T00:00:00Z",
            "organizationId": ORG})

        assert response.status_code == 404, response.get_json()
        assert real_db[MARKETS_COLLECTION].count_documents({"organizationId": ORG}) == len(markets)
