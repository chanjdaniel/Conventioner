"""Deleting an organization is safe (E20/F04/S01).

Owner-only was the AUTHORITY rule and stays. This is the SAFETY rule it never had: deletion used
to set every one of the organization's markets to belong to nothing - a state `POST /markets`
refuses to produce, and one that made those markets invisible to everyone who reached them through
the organization.

The risk this carries is recorded rather than argued: an ARCHIVED market is still publicly served
and holds the placement record of a market that actually ran, and deleting one takes a live
check-in URL off the air with no undo. That was raised during charting and reaffirmed, which is
why the confirmation has to name what each deletion destroys and why the deletion leaves a trail.
"""
from types import SimpleNamespace

import pytest

import api.organizations as OrgsApi
import deletion_trail as DeletionTrail
from datatypes import MarketPhase

OWNER_ID = "user-1"
OWNER_EMAIL = "owner@example.com"
ORG_ID = "org-1"

MID_LIFECYCLE = [
    MarketPhase.APPLICATIONS_OPEN,
    MarketPhase.APPLICATIONS_CLOSED,
    MarketPhase.REVIEW,
    MarketPhase.ASSIGNMENT,
    MarketPhase.OFFERS,
    MarketPhase.MARKET_DAYS,
]


def _market(market_id, phase, name=None, placements=0):
    """A stored market document, camelCase as every write leaves one."""
    return {
        "id": market_id,
        "name": name or f"Market {market_id}",
        "slug": market_id,
        "organizationId": ORG_ID,
        "phase": phase.value,
        "isDraft": phase == MarketPhase.DRAFT,
        "assignmentObject": {
            "vendorAssignments": [{"vendorEmail": f"v{i}@example.com"} for i in range(placements)]
        },
    }


class Markets:
    def __init__(self, docs):
        self.docs = docs

    def find(self, query):
        return iter(
            [dict(doc) for doc in self.docs if all(doc.get(k) == v for k, v in query.items())]
        )

    def delete_one(self, query):
        for index, doc in enumerate(self.docs):
            if all(doc.get(k) == v for k, v in query.items()):
                self.docs.pop(index)
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)


@pytest.fixture
def org(monkeypatch):
    trail: list = []

    def install(*docs):
        markets = Markets(list(docs))
        monkeypatch.setattr(OrgsApi, "markets_collection", markets)
        monkeypatch.setattr(
            OrgsApi.organizations_collection,
            "find_one",
            lambda _q: {"id": ORG_ID, "name": "Ember Markets", "owner": OWNER_ID},
            raising=False,
        )
        monkeypatch.setattr(
            OrgsApi.organizations_collection,
            "delete_one",
            lambda _q: SimpleNamespace(deleted_count=1),
            raising=False,
        )
        monkeypatch.setattr(
            OrgsApi.users_collection, "update_many", lambda *_a, **_k: None, raising=False
        )
        monkeypatch.setattr(
            OrgsApi.UsersApi,
            "get_user",
            lambda _email: SimpleNamespace(id=OWNER_ID, email=OWNER_EMAIL),
        )
        monkeypatch.setattr(
            OrgsApi.DeletionTrail,
            "record_organization_deletion",
            lambda organization, doomed, actor: trail.append((organization, doomed, actor))
            or "trail-1",
        )
        return markets, trail

    return install


class TestItRefusesWhileAMarketIsUnderWay:
    @pytest.mark.parametrize("phase", MID_LIFECYCLE, ids=[p.value for p in MID_LIFECYCLE])
    def test_every_mid_lifecycle_phase_blocks_it(self, org, phase):
        markets, _ = org(_market("m-1", phase))

        with pytest.raises(OrgsApi.OrganizationHasLiveMarkets):
            OrgsApi.delete_organization(ORG_ID, OWNER_EMAIL)

        assert [doc["id"] for doc in markets.docs] == ["m-1"], "a refused deletion deleted something"

    def test_the_refusal_names_each_market_and_its_phase(self, org):
        """"You cannot delete this" without saying which market is a refusal only guessing answers."""
        org(
            _market("m-1", MarketPhase.REVIEW, name="Spring Market"),
            _market("m-2", MarketPhase.MARKET_DAYS, name="Summer Market"),
            _market("m-3", MarketPhase.DRAFT, name="A Draft"),
        )

        with pytest.raises(OrgsApi.OrganizationHasLiveMarkets) as refusal:
            OrgsApi.delete_organization(ORG_ID, OWNER_EMAIL)

        message = str(refusal.value)
        assert "Spring Market" in message and "Summer Market" in message
        assert "A Draft" not in message, "a deletable market is not a reason to refuse"
        assert [m["id"] for m in refusal.value.blocking] == ["m-1", "m-2"]

    def test_one_live_market_blocks_the_whole_deletion(self, org):
        markets, _ = org(
            _market("draft", MarketPhase.DRAFT),
            _market("live", MarketPhase.APPLICATIONS_OPEN),
        )

        with pytest.raises(OrgsApi.OrganizationHasLiveMarkets):
            OrgsApi.delete_organization(ORG_ID, OWNER_EMAIL)

        # Not a partial deletion: the draft survives too.
        assert sorted(doc["id"] for doc in markets.docs) == ["draft", "live"]


class TestWhatGoesWithIt:
    def test_a_draft_is_deleted(self, org):
        markets, _ = org(_market("m-1", MarketPhase.DRAFT))

        OrgsApi.delete_organization(ORG_ID, OWNER_EMAIL)

        assert markets.docs == []

    def test_an_archived_market_is_deleted(self, org):
        """Reaffirmed on 2026-09-22, and recorded as a choice rather than an oversight.

        An archived market is still publicly served and holds the record of a market that ran.
        """
        markets, _ = org(_market("m-1", MarketPhase.ARCHIVED, placements=12))

        OrgsApi.delete_organization(ORG_ID, OWNER_EMAIL)

        assert markets.docs == []

    def test_no_market_is_ever_written_with_no_organization(self, org):
        """The update that orphaned them is gone outright, not kept as a fallback.

        A fallback would preserve the exact state this exists to prevent, so the absence is what
        is asserted: a deletable market leaves the collection, and nothing is written at all.
        """
        markets, _ = org(_market("m-1", MarketPhase.DRAFT))
        assert not hasattr(markets, "update_many"), "the fake offers no way to orphan a market"

        OrgsApi.delete_organization(ORG_ID, OWNER_EMAIL)

        assert markets.docs == []

    def test_removing_the_organization_from_each_member_is_unchanged(self, org, monkeypatch):
        org(_market("m-1", MarketPhase.DRAFT))
        pulls: list = []
        monkeypatch.setattr(
            OrgsApi.users_collection,
            "update_many",
            lambda query, update: pulls.append(update),
            raising=False,
        )

        OrgsApi.delete_organization(ORG_ID, OWNER_EMAIL)

        assert pulls == [{"$pull": {"organizations": ORG_ID}}]


class TestTheConfirmationCanSayWhatItDestroys:
    def test_it_describes_each_market_rather_than_counting_them(self, org):
        org(
            _market("m-1", MarketPhase.ARCHIVED, name="Winter Market 2025", placements=34),
            _market("m-2", MarketPhase.DRAFT, name="Untitled"),
        )

        preview = OrgsApi.organization_deletion_preview(ORG_ID, OWNER_EMAIL)

        assert preview["can_delete"] is True
        archived = next(m for m in preview["markets_to_delete"] if m["id"] == "m-1")
        assert archived["name"] == "Winter Market 2025"
        assert archived["phase_label"]
        assert archived["ran"] is True
        assert archived["placements"] == 34
        assert archived["public_slug"] == "m-1", "the URL that stops resolving is named"

    def test_a_draft_has_no_public_url_to_lose(self, org):
        org(_market("m-1", MarketPhase.DRAFT))

        preview = OrgsApi.organization_deletion_preview(ORG_ID, OWNER_EMAIL)

        draft = preview["markets_to_delete"][0]
        assert draft["public_slug"] is None
        assert draft["ran"] is False

    def test_it_lists_what_would_refuse_the_deletion(self, org):
        org(_market("m-1", MarketPhase.REVIEW), _market("m-2", MarketPhase.DRAFT))

        preview = OrgsApi.organization_deletion_preview(ORG_ID, OWNER_EMAIL)

        assert preview["can_delete"] is False
        assert [m["id"] for m in preview["blocking_markets"]] == ["m-1"]
        assert [m["id"] for m in preview["markets_to_delete"]] == ["m-2"]

    def test_only_the_owner_may_see_it(self, org, monkeypatch):
        org(_market("m-1", MarketPhase.DRAFT))
        monkeypatch.setattr(
            OrgsApi.UsersApi,
            "get_user",
            lambda _email: SimpleNamespace(id="somebody-else", email="other@example.com"),
        )

        with pytest.raises(PermissionError):
            OrgsApi.organization_deletion_preview(ORG_ID, "other@example.com")


class TestTheTrail:
    def test_it_records_what_was_deleted_and_by_whom(self, org):
        _, trail = org(_market("m-1", MarketPhase.ARCHIVED, name="Winter Market", placements=9))

        OrgsApi.delete_organization(ORG_ID, OWNER_EMAIL)

        organization, doomed, actor = trail[0]
        assert organization["name"] == "Ember Markets"
        assert actor == OWNER_EMAIL
        assert [m["name"] for m in doomed] == ["Winter Market"]
        assert doomed[0]["placements"] == 9

    def test_it_is_written_before_anything_is_destroyed(self, org, monkeypatch):
        """A failure here fails the whole operation.

        An organization deleted with no record of what went with it is the thing this exists for,
        so the trail is not allowed to be best-effort.
        """
        markets, _ = org(_market("m-1", MarketPhase.DRAFT))
        monkeypatch.setattr(
            OrgsApi.DeletionTrail,
            "record_organization_deletion",
            lambda *_a, **_k: (_ for _ in ()).throw(RuntimeError("no trail")),
        )

        with pytest.raises(RuntimeError):
            OrgsApi.delete_organization(ORG_ID, OWNER_EMAIL)

        assert [doc["id"] for doc in markets.docs] == ["m-1"]

    def test_the_entry_names_the_markets_rather_than_pointing_at_them(self):
        """An id that points at nothing is not a record of what was destroyed."""
        written: list = []

        class Collection:
            def insert_one(self, doc):
                written.append(doc)
                return SimpleNamespace(inserted_id="1")

        original = DeletionTrail.deletion_trail_collection
        DeletionTrail.deletion_trail_collection = Collection()
        try:
            DeletionTrail.record_organization_deletion(
                {"id": ORG_ID, "name": "Ember Markets"},
                [{"id": "m-1", "name": "Winter Market", "placements": 9}],
                OWNER_EMAIL,
            )
        finally:
            DeletionTrail.deletion_trail_collection = original

        assert written[0]["organization_name"] == "Ember Markets"
        assert written[0]["markets"][0]["name"] == "Winter Market"
        assert written[0]["actor_email"] == OWNER_EMAIL
