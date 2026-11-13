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
from client_errors import ForbiddenError, NotFoundError
from conftest import (
    FakeOrganizations, _update_first, mongo_matches, mongo_project, mongo_update,
)
from datatypes import MarketPhase

OWNER_ID = "user-1"
OWNER_EMAIL = "owner@example.com"
ORG_ID = "org-1"

MID_LIFECYCLE = [
    MarketPhase.APPLICATIONS,
    MarketPhase.ASSIGNMENT,
    MarketPhase.OFFERS,
    MarketPhase.MARKET_DAYS,
]


def _market(market_id, phase, name=None, placements=0, reached=None, intake_mode=None):
    """A stored market document, camelCase as every write leaves one.

    ``reached`` is its phase history, the record of where it has been (E26/F06/S03).
    ``intake_mode`` is stored as ``intakeMode``; absence means CSV, the write path's own default.
    """
    document = {
        "id": market_id,
        "name": name or f"Market {market_id}",
        "slug": market_id,
        "organizationId": ORG_ID,
        "phase": phase.value,
        "isDraft": phase == MarketPhase.DRAFT,
        "assignmentObject": {
            "vendorAssignments": [{"vendorEmail": f"v{i}@example.com"} for i in range(placements)]
        },
        "phaseHistory": [
            {"phase": entered, "enteredAt": "2026-01-01T00:00:00+00:00", "by": OWNER_EMAIL}
            for entered in (reached or ["draft", phase.value])
        ],
    }
    if intake_mode is not None:
        document["intakeMode"] = intake_mode
    return document


class Markets:
    """The organization's markets, filtered and written as MongoDB does; ``writes`` keeps every
    update it was sent."""

    def __init__(self, docs):
        self.docs = docs
        self.writes = []

    def find(self, query, projection=None):
        return iter([mongo_project(dict(doc), projection)
                     for doc in self.docs if mongo_matches(doc, query)])

    def find_one(self, query, projection=None):
        return next(self.find(query, projection), None)

    def update_one(self, query, update):
        self.writes.append(update)
        return _update_first(self.docs, query, update)

    def update_many(self, query, update):
        self.writes.append(update)
        matched = 0
        for index, doc in enumerate(self.docs):
            if mongo_matches(doc, query):
                self.docs[index] = mongo_update(doc, update)
                matched += 1
        return SimpleNamespace(matched_count=matched)

    def delete_one(self, query):
        for index, doc in enumerate(self.docs):
            if mongo_matches(doc, query):
                self.docs.pop(index)
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)


@pytest.fixture
def org(monkeypatch):
    trail: list = []

    def install(*docs):
        markets = Markets(list(docs))
        monkeypatch.setattr(OrgsApi, "markets_collection", markets)
        monkeypatch.setattr(OrgsApi, "organizations_collection", FakeOrganizations(
            {"id": ORG_ID, "name": "Ember Markets", "owner": OWNER_ID}))
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
            lambda organization, doomed, actor, trail_id: trail.append(
                (organization, doomed, actor, trail_id)) or trail_id,
        )
        monkeypatch.setattr(
            OrgsApi.DeletionTrail, "is_recorded",
            lambda trail_id: any(entry[3] == trail_id for entry in trail))
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
            _market("m-1", MarketPhase.APPLICATIONS, name="Spring Market"),
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
            _market("live", MarketPhase.APPLICATIONS),
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

        OrgsApi.delete_organization(ORG_ID, OWNER_EMAIL)

        assert markets.docs == []
        assert [write for write in markets.writes if "organizationId" in str(write)] == []

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
            _market(
                "m-1", MarketPhase.ARCHIVED, name="Winter Market 2025", placements=34,
                reached=["draft", "assignment", "market_days", "archived"],
            ),
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

    def test_a_market_assigned_but_never_published_did_not_run(self, org):
        """Placements are not proof it ran (bug 9): it was never on the air, so no URL is lost."""
        org(_market(
            "m-1", MarketPhase.ARCHIVED, placements=12,
            reached=["draft", "assignment", "archived"],
        ))

        preview = OrgsApi.organization_deletion_preview(ORG_ID, OWNER_EMAIL)

        archived = preview["markets_to_delete"][0]
        assert archived["ran"] is False
        assert archived["public_slug"] is None

    def test_a_draft_has_no_public_url_to_lose(self, org):
        org(_market("m-1", MarketPhase.DRAFT))

        preview = OrgsApi.organization_deletion_preview(ORG_ID, OWNER_EMAIL)

        draft = preview["markets_to_delete"][0]
        assert draft["public_slug"] is None
        assert draft["ran"] is False

    def test_it_lists_what_would_refuse_the_deletion(self, org):
        org(_market("m-1", MarketPhase.APPLICATIONS), _market("m-2", MarketPhase.DRAFT))

        preview = OrgsApi.organization_deletion_preview(ORG_ID, OWNER_EMAIL)

        assert preview["can_delete"] is False
        assert [m["id"] for m in preview["blocking_markets"]] == ["m-1"]
        assert [m["id"] for m in preview["markets_to_delete"]] == ["m-2"]

    def test_the_stage_reads_review_on_a_google_form_market(self, org):
        """The one stage is named by intake (E38/F04/S01): Review on a Google Form market."""
        org(
            _market("m-1", MarketPhase.APPLICATIONS, intake_mode="csv"),
            _market("m-2", MarketPhase.APPLICATIONS, intake_mode="form"),
        )

        preview = OrgsApi.organization_deletion_preview(ORG_ID, OWNER_EMAIL)

        by_id = {m["id"]: m for m in preview["blocking_markets"]}
        assert by_id["m-1"]["phase_label"] == "Review"
        assert by_id["m-2"]["phase_label"] == "Applications"

    def test_only_the_owner_may_see_it(self, org, monkeypatch):
        org(_market("m-1", MarketPhase.DRAFT))
        monkeypatch.setattr(
            OrgsApi.UsersApi,
            "get_user",
            lambda _email: SimpleNamespace(id="somebody-else", email="other@example.com"),
        )

        with pytest.raises(ForbiddenError):
            OrgsApi.organization_deletion_preview(ORG_ID, "other@example.com")


class TestTheTrail:
    def test_it_records_what_was_deleted_and_by_whom(self, org):
        _, trail = org(_market("m-1", MarketPhase.ARCHIVED, name="Winter Market", placements=9))

        OrgsApi.delete_organization(ORG_ID, OWNER_EMAIL)

        organization, doomed, actor, _trail_id = trail[0]
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
                OWNER_EMAIL, "trail-1",
            )
        finally:
            DeletionTrail.deletion_trail_collection = original

        assert written[0]["organization_name"] == "Ember Markets"
        assert written[0]["markets"][0]["name"] == "Winter Market"
        assert written[0]["actor_email"] == OWNER_EMAIL


class TestAMarketsRecordsGoWithIt:
    """A market's applications, check-ins, sign-in codes and placement trail are kept beside it
    and deleted with it, by either door (bug 47). Deleting the document alone left every vendor's
    name, email and answers behind for ever, describing a market nobody could reach."""

    @staticmethod
    def _plant(applications, market_records, market_id):
        applications.documents.append({"id": f"app-{market_id}", "market_id": market_id})
        market_records.attendance.documents.append({"market_id": market_id, "email": "v@x.test"})
        market_records.challenges.documents.append({"market_id": market_id, "email": "v@x.test"})
        market_records.history.documents.append({"market_id": market_id})

    @staticmethod
    def _left(applications, market_records):
        return sorted({
            doc["market_id"]
            for collection in (applications, market_records.attendance,
                               market_records.challenges, market_records.history)
            for doc in collection.documents
        })

    def test_deleting_the_organization_deletes_its_markets_records(
        self, org, applications, market_records,
    ):
        org(_market("m-1", MarketPhase.DRAFT), _market("m-2", MarketPhase.ARCHIVED))
        for market_id in ("m-1", "m-2", "elsewhere"):
            self._plant(applications, market_records, market_id)

        OrgsApi.delete_organization(ORG_ID, OWNER_EMAIL)

        assert self._left(applications, market_records) == ["elsewhere"]

    def test_deleting_the_market_deletes_its_records(
        self, monkeypatch, applications, market_records,
    ):
        import api.markets as MarketsApi
        from conftest import FakeMarketsCollection, stored_market
        from datatypes import MarketRole

        markets = FakeMarketsCollection(stored_market(id="m-1"))
        monkeypatch.setattr(MarketsApi, "markets_collection", markets)
        monkeypatch.setattr(
            MarketsApi.PermissionsApi, "get_user_market_role", lambda *_a, **_k: MarketRole.OWNER,
        )
        for market_id in ("m-1", "elsewhere"):
            self._plant(applications, market_records, market_id)

        MarketsApi.delete_market("m-1", OWNER_EMAIL)

        assert self._left(applications, market_records) == ["elsewhere"]


class TestARecordWrittenAsItsMarketIsDeleted:
    """A request that read its market live and wrote after the deletion swept: what it wrote is
    taken back once its last write is in (``market_deletion.kept_only_while_live``)."""

    def test_is_taken_back_when_the_market_is_being_deleted(self, applications, market_records):
        from conftest import FakeMarketsCollection, stored_market

        markets = FakeMarketsCollection(stored_market(id="m-1", deleting={
            "at": "2026-11-13T00:00:00+00:00", "by": OWNER_EMAIL, "trail_id": "trail-1"}))
        TestAMarketsRecordsGoWithIt._plant(applications, market_records, "m-1")
        TestAMarketsRecordsGoWithIt._plant(applications, market_records, "elsewhere")

        with pytest.raises(OrgsApi.MarketDeletion.MarketGoneUnderWrite):
            OrgsApi.MarketDeletion.kept_only_while_live(markets, "m-1")

        assert TestAMarketsRecordsGoWithIt._left(applications, market_records) == ["elsewhere"]

    def test_is_kept_while_the_market_is_live(self, applications, market_records):
        from conftest import FakeMarketsCollection, stored_market

        markets = FakeMarketsCollection(stored_market(id="m-1"))
        TestAMarketsRecordsGoWithIt._plant(applications, market_records, "m-1")

        OrgsApi.MarketDeletion.kept_only_while_live(markets, "m-1")

        assert TestAMarketsRecordsGoWithIt._left(applications, market_records) == ["m-1"]


class TestACutDeletionResumesFromItsTombstone:
    """The real-MongoDB suite cuts every step (``real_mongo/test_a_deletion_leaves_a_tombstone``);
    these run the same rules over the fakes, so the gate's hermetic run holds them too."""

    def test_a_retry_after_a_cut_writes_one_trail_entry_naming_every_market(
            self, org, monkeypatch):
        markets, trail = org(_market("m-1", MarketPhase.DRAFT), _market("m-2", MarketPhase.ARCHIVED))
        real = OrgsApi.MarketDeletion.delete_market_and_records
        calls = []

        def cut_at_the_second(collection, market_id):
            calls.append(market_id)
            if len(calls) == 2:
                raise RuntimeError("the process stopped here")
            return real(collection, market_id)

        monkeypatch.setattr(OrgsApi.MarketDeletion, "delete_market_and_records", cut_at_the_second)
        with pytest.raises(RuntimeError):
            OrgsApi.delete_organization(ORG_ID, OWNER_EMAIL)
        assert [doc["id"] for doc in markets.docs] == ["m-2"]
        assert markets.docs[0]["deleting"]["trail_id"] == trail[0][3]

        OrgsApi.delete_organization(ORG_ID, OWNER_EMAIL)

        [(_organization, doomed, _actor, _trail_id)] = trail
        assert sorted(m["id"] for m in doomed) == ["m-1", "m-2"]
        assert markets.docs == []
        assert OrgsApi.organizations_collection.docs == []

    def test_a_market_entering_review_after_the_preview_takes_every_tombstone_back(
            self, org, monkeypatch):
        markets, trail = org(_market("m-1", MarketPhase.DRAFT), _market("m-2", MarketPhase.ARCHIVED))
        preview = OrgsApi.organization_deletion_preview

        def then_it_enters_review(*args):
            judged = preview(*args)
            markets.docs[0]["phase"] = MarketPhase.APPLICATIONS.value
            return judged

        monkeypatch.setattr(OrgsApi, "organization_deletion_preview", then_it_enters_review)

        with pytest.raises(OrgsApi.OrganizationHasLiveMarkets) as refusal:
            OrgsApi.delete_organization(ORG_ID, OWNER_EMAIL)

        assert [m["id"] for m in refusal.value.blocking] == ["m-1"]
        assert sorted(doc["id"] for doc in markets.docs) == ["m-1", "m-2"]
        assert [doc for doc in markets.docs if "deleting" in doc] == []
        assert "deleting" not in OrgsApi.organizations_collection.doc
        assert trail == []

    def test_an_organization_being_deleted_reads_as_absent_to_its_preview(self, org):
        org(_market("m-1", MarketPhase.DRAFT))
        OrgsApi.organizations_collection.doc["deleting"] = {
            "at": "2026-11-13T00:00:00+00:00", "by": OWNER_EMAIL, "trail_id": "trail-1"}

        with pytest.raises(NotFoundError):
            OrgsApi.organization_deletion_preview(ORG_ID, OWNER_EMAIL)
        assert OrgsApi.get_organization(ORG_ID) is None
