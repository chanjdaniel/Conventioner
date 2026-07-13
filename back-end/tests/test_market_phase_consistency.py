"""A market reports the same phase no matter which endpoint served it.

Pre-migration documents carry no ``phase`` field, so every read path has to derive it.
The list endpoint used to hand back raw documents while the detail endpoint derived the
phase, which let the two disagree about the very markets the migration had not reached yet.
"""
from types import SimpleNamespace

import pytest

import api.markets as MarketsApi
import api.organizations as OrgsApi
import api.permissions as PermissionsApi
import api.users as UsersApi
from datatypes import MarketPhase, MarketRole
from market_documents import market_from_document

USER_ID = "user-1"
USER_EMAIL = "owner@example.com"


def _pre_migration_market(market_id, is_draft):
    """A market stored before the phase field existed: isDraft only, no phase."""
    return {
        "_id": f"mongo-{market_id}",
        "id": market_id,
        "name": f"Market {market_id}",
        "creationDate": "2026-01-01T00:00:00Z",
        "roles": {USER_ID: MarketRole.OWNER.value},
        "modificationList": [],
        "assignmentObject": {"vendorAssignments": [], "assignmentStatistics": None},
        "isDraft": is_draft,
    }


class FakeMarketsCollection:
    def __init__(self, docs):
        self.docs = docs

    def find_one(self, query):
        for doc in self.docs:
            if doc["id"] == query.get("id"):
                return dict(doc)
        return None

    def aggregate(self, _pipeline):
        return iter([dict(doc) for doc in self.docs])

    def find(self, _query):
        return iter([])


@pytest.fixture
def collection(monkeypatch):
    docs = [
        _pre_migration_market("draft-market", is_draft=True),
        _pre_migration_market("published-market", is_draft=False),
    ]
    fake = FakeMarketsCollection(docs)
    monkeypatch.setattr(MarketsApi, "markets_collection", fake)
    monkeypatch.setattr(
        UsersApi, "get_user", lambda _email: SimpleNamespace(id=USER_ID, email=USER_EMAIL)
    )
    monkeypatch.setattr(
        UsersApi, "get_user_by_id", lambda _uid: SimpleNamespace(id=USER_ID, email=USER_EMAIL)
    )
    monkeypatch.setattr(OrgsApi, "get_organizations_for_user", lambda _email: [])
    monkeypatch.setattr(OrgsApi, "get_organization", lambda _oid: None)
    monkeypatch.setattr(
        PermissionsApi, "get_user_market_role", lambda *_args, **_kwargs: MarketRole.OWNER
    )
    return fake


@pytest.mark.parametrize(
    "market_id,expected_phase",
    [
        ("draft-market", MarketPhase.DRAFT),
        ("published-market", MarketPhase.ARCHIVED),
    ],
)
def test_list_and_detail_agree_on_derived_phase(collection, market_id, expected_phase):
    listed = {m["id"]: m for m in MarketsApi.get_markets_for_user(USER_EMAIL)}
    detail = MarketsApi.get_market_for_user(USER_EMAIL, market_id)

    assert listed[market_id]["phase"] == expected_phase.value
    assert detail["phase"] == expected_phase.value


def test_stored_phase_wins_over_is_draft(collection):
    collection.docs.append(
        {
            **_pre_migration_market("migrated-market", is_draft=True),
            "phase": MarketPhase.APPLICATIONS_OPEN.value,
        }
    )

    listed = {m["id"]: m for m in MarketsApi.get_markets_for_user(USER_EMAIL)}

    assert listed["migrated-market"]["phase"] == MarketPhase.APPLICATIONS_OPEN.value


def test_market_context_derives_phase_for_pre_migration_document(collection):
    context = MarketsApi.load_market_context("published-market")

    assert context.market.phase == MarketPhase.ARCHIVED


def test_unrecognized_stored_phase_degrades_instead_of_breaking_the_list(collection):
    """One market written by a newer build must not take the whole list down."""
    collection.docs.append(
        {
            **_pre_migration_market("future-market", is_draft=False),
            "phase": "phase_from_a_future_build",
        }
    )

    listed = {m["id"]: m for m in MarketsApi.get_markets_for_user(USER_EMAIL)}

    assert listed["future-market"]["phase"] == MarketPhase.ARCHIVED.value
    assert listed["draft-market"]["phase"] == MarketPhase.DRAFT.value


class TestSharedParser:
    """Every parse of a stored market goes through one function, so none of them can quietly
    disagree with the document about what phase the market is in.

    ``Market.phase`` defaults to ``draft``: a path that builds a Market straight from a
    pre-migration document reads that default as fact, and the first phase check added to that
    path silently sees a draft. The public check-in lookup and the floorplan save endpoint both
    parsed documents by hand until they were routed through here.
    """

    def test_phase_is_derived_not_left_at_the_model_default(self):
        market = market_from_document(_pre_migration_market("m-1", is_draft=False))

        assert market.phase == MarketPhase.ARCHIVED

    def test_a_callers_adjusted_snake_copy_still_gets_the_documents_phase(self):
        """The check-in lookup defaults fields a legacy document omits before parsing; the
        phase still has to come from the document, which is the only thing that knows it."""
        document = _pre_migration_market("m-2", is_draft=False)
        snake = {
            "id": "m-2",
            "name": "Market m-2",
            "creation_date": "2026-01-01T00:00:00Z",
            "roles": {USER_ID: MarketRole.OWNER.value},
            "modification_list": [],
            "assignment_object": {"vendor_assignments": [], "assignment_date": ""},
            "is_draft": False,
        }

        market = market_from_document(document, snake)

        assert market.phase == MarketPhase.ARCHIVED

    def test_a_stored_phase_is_taken_as_given(self):
        document = {
            **_pre_migration_market("m-3", is_draft=True),
            "phase": MarketPhase.APPLICATIONS_OPEN.value,
        }

        market = market_from_document(document)

        assert market.phase == MarketPhase.APPLICATIONS_OPEN


def test_corrupt_market_document_is_logged(collection, caplog):
    collection.docs.append({**_pre_migration_market("corrupt-market", is_draft=True), "name": None})

    with caplog.at_level("WARNING"):
        context = MarketsApi.load_market_context("corrupt-market")

    assert context.market is None
    assert "corrupt-market" in caplog.text
