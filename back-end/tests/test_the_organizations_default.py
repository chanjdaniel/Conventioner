"""The organization's default table, copied into each new market (E39/F02/S01).

An organization keeps the rows it sets for the markets it will hold; its owner and its admins
change them, its members read them, and every change is recorded in its history (Daniel, Q22:
"org admins can", "every change is logged and recorded. who did what."). A market created in it
copies them, each marked as copied; a copy, not a link (Q22: "copy"), so a later change reaches only
markets created after it, or one whose owner copies the default again.
"""
import copy
from types import SimpleNamespace

import pytest

from conftest import mongo_matches, mongo_project, sessions_load_through_get_user
from test_the_history import FakeHistoryCollection
from test_the_market_keeps_its_own_rows import (
    ADMIN, EDITOR, ORG_ADMIN, ORG_ID, ORG_OWNER, OWNER, VIEWER, FakeMarkets, _set_path,
    _unset_path, market_doc, row,
)

import app as app_module
import api.market_actions as Actions
import api.markets as MarketsApi
import api.organizations as OrgsApi
import api.users as UsersApi
import history as History
from client_errors import BadRequestError, ForbiddenError, NotFoundError
from datatypes import MarketPhase

ORG_MEMBER = "org-member@example.com"
OUTSIDER = "outsider@example.com"
NOT_THEIRS = "Only the organization's owner or its admins may change its default permissions."


class FakeOrganizations:
    """The organizations collection, holding one document and applying ``$set``, ``$unset`` and
    ``$addToSet`` on dotted paths, so a read after a write sees what it stored."""

    def __init__(self, doc):
        self.doc = copy.deepcopy(doc)
        self.updates = []

    def find_one(self, query, projection=None):
        if self.doc is None or not mongo_matches(self.doc, query):
            return None
        return mongo_project(copy.deepcopy(self.doc), projection)

    def find(self, query):
        """The organizations list's ``$or`` of owner, admins and members, the one ``find`` sent."""
        user_id = query["$or"][0]["owner"]
        people = [self.doc["owner"], *self.doc["admins"], *self.doc["members"]]
        return [copy.deepcopy(self.doc)] if user_id in people else []

    def update_one(self, query, update):
        if not mongo_matches(self.doc, query):
            return SimpleNamespace(matched_count=0, modified_count=0)
        self.updates.append(update)
        for path, value in (update.get("$set") or {}).items():
            _set_path(self.doc, path, copy.deepcopy(value))
        for path in update.get("$unset") or {}:
            _unset_path(self.doc, path)
        for key, value in (update.get("$addToSet") or {}).items():
            if value not in self.doc.setdefault(key, []):
                self.doc[key].append(value)
        return SimpleNamespace(matched_count=1, modified_count=1)


class Markets(FakeMarkets):
    """``FakeMarkets``, which a new market is inserted into and read back from."""

    def insert_one(self, document):
        stored = {**copy.deepcopy(document), "_id": f"mongo-{document['id']}"}
        self.docs.append(stored)
        return SimpleNamespace(inserted_id=stored["_id"])


def organization(**overrides):
    return {
        "_id": "mongo-org", "id": ORG_ID, "name": "Ember Markets", "owner": ORG_OWNER,
        "admins": [ORG_ADMIN], "members": [ORG_MEMBER, OWNER], "markets": ["market-123"], "theme": None,
        **overrides,
    }


@pytest.fixture
def world(monkeypatch):
    """One organization, a market it already holds, and the history both record into.

    A person's id is their address, and roles resolve as they do in production, so the
    organization's admin holds Admin on its markets and is not their owner.
    """
    organizations = FakeOrganizations(organization())
    markets = Markets(market_doc("market-123"))
    history = FakeHistoryCollection()
    monkeypatch.setattr(OrgsApi, "organizations_collection", organizations)
    monkeypatch.setattr(OrgsApi, "users_collection", SimpleNamespace(
        update_one=lambda *_a, **_k: None, update_many=lambda *_a, **_k: None))
    monkeypatch.setattr(MarketsApi.PermissionsApi, "organizations_collection", organizations)
    monkeypatch.setattr(MarketsApi, "markets_collection", markets)
    monkeypatch.setattr(MarketsApi, "db", {"organizations": organizations})
    monkeypatch.setattr(History, "history_collection", history)
    monkeypatch.setattr(History, "legacy_placement_collection", FakeHistoryCollection())
    monkeypatch.setattr(UsersApi, "get_user", lambda email: SimpleNamespace(
        id=email, email=email, name=email, is_active=True, is_authenticated=True,
        is_anonymous=False, get_id=lambda e=email: e,
    ))
    monkeypatch.setattr(UsersApi, "get_user_by_id", lambda uid: SimpleNamespace(id=uid, email=uid))
    return SimpleNamespace(organizations=organizations, markets=markets, history=history)


def org_entries(world):
    return [doc for doc in world.history.docs if doc.get("organization_id") == ORG_ID]


def default_entries(world):
    return [doc for doc in org_entries(world) if doc["action"] == History.CHANGE_THE_DEFAULT]


def market_table(market_id, who=OWNER):
    return MarketsApi.get_market_for_user(who, market_id)["permissionTable"]


#: What a create body needs besides its name and organization.
NEW_MARKET = {
    "creation_date": "2026-11-01T00:00:00Z", "modification_list": [], "assignment_object": {},
}


def create_market(name="Spring Fair", organization_id=ORG_ID):
    return MarketsApi.create_owned_market(
        UsersApi.get_user(OWNER), {**NEW_MARKET, "name": name, "organization_id": organization_id})


class TestTheOrganizationsDefault:
    def test_an_admin_sets_a_row_and_it_is_stored_served_and_recorded(self, world):
        table = OrgsApi.set_default_permission(ORG_ID, "check-in", "admin", ORG_ADMIN)

        assert (row(table, "check-in")["role"], row(table, "check-in")["source"]) == (
            "admin", "organization")
        assert world.organizations.doc["default_permissions"] == {"check-in": {"role": "admin"}}
        [entry] = default_entries(world)
        assert entry["actor"] == ORG_ADMIN
        assert entry["at"]
        assert entry["kind"] == History.PERMISSION_SET
        assert entry["subject"] == {"action": "check-in"}
        assert entry["detail"] == {
            "before": {"role": "editor", "source": "built-in"},
            "after": {"role": "admin", "source": "organization"},
        }

    def test_its_owner_sets_one_too(self, world):
        OrgsApi.set_default_permission(ORG_ID, "export-csv", "editor", ORG_OWNER)

        assert world.organizations.doc["default_permissions"] == {"export-csv": {"role": "editor"}}
        assert [e["actor"] for e in default_entries(world)] == [ORG_OWNER]

    def test_an_organization_that_sets_none_serves_every_built_in_default(self, world):
        table = Actions.default_table(world.organizations.doc.get("default_permissions"))

        assert [entry["id"] for entry in table] == list(Actions.ACTIONS)
        for entry in table:
            assert entry["role"] == Actions.ACTIONS[entry["id"]].default.value
            assert entry["source"] == "built-in"

    def test_the_organizations_list_carries_its_default_table(self, world):
        OrgsApi.set_default_permission(ORG_ID, "check-in", "admin", ORG_ADMIN)

        [listed] = OrgsApi.get_organizations_for_user(ORG_MEMBER)

        assert row(listed["defaultPermissionTable"], "check-in")["role"] == "admin"

    def test_setting_the_role_a_row_already_asks_stores_and_records_nothing(self, world):
        OrgsApi.set_default_permission(ORG_ID, "check-in", "editor", ORG_ADMIN)

        assert world.organizations.updates == []
        assert default_entries(world) == []

    def test_resetting_a_row_unsets_it_and_records_its_before_and_after(self, world):
        OrgsApi.set_default_permission(ORG_ID, "check-in", "admin", ORG_ADMIN)

        table = OrgsApi.reset_default_permission(ORG_ID, "check-in", ORG_OWNER)

        assert row(table, "check-in")["source"] == "built-in"
        assert world.organizations.doc["default_permissions"] == {}
        newest = OrgsApi.get_default_permission_history(ORG_ID, ORG_MEMBER)[0]
        assert (newest["actor"], newest["kind"], newest["detail"]) == (ORG_OWNER, "permission_reset", {
            "before": {"role": "admin", "source": "organization"},
            "after": {"role": "editor", "source": "built-in"},
        })

    def test_resetting_a_row_it_does_not_set_records_nothing(self, world):
        OrgsApi.reset_default_permission(ORG_ID, "check-in", ORG_ADMIN)

        assert world.organizations.updates == []
        assert default_entries(world) == []

    def test_resetting_every_row_is_one_write_and_one_entry(self, world):
        OrgsApi.set_default_permission(ORG_ID, "check-in", "admin", ORG_ADMIN)
        OrgsApi.set_default_permission(ORG_ID, "export-csv", "editor", ORG_ADMIN)
        writes = len(world.organizations.updates)

        table = OrgsApi.reset_default_permissions(ORG_ID, ORG_ADMIN)

        assert all(entry["source"] == "built-in" for entry in table)
        assert len(world.organizations.updates) == writes + 1
        assert world.organizations.doc["default_permissions"] == {}
        newest = default_entries(world)[-1]
        assert newest["kind"] == History.PERMISSION_TABLE_RESET
        assert newest["detail"] == {
            "before": {"export-csv": {"role": "editor", "source": "organization"},
                       "check-in": {"role": "admin", "source": "organization"}},
            "after": {"export-csv": {"role": "viewer", "source": "built-in"},
                      "check-in": {"role": "editor", "source": "built-in"}},
        }

    def test_resetting_every_row_leaves_one_this_build_cannot_read(self, world):
        world.organizations.doc["default_permissions"] = {
            "check-in": {"role": "admin"}, "a-later-row": {"role": "admin"}}

        OrgsApi.reset_default_permissions(ORG_ID, ORG_ADMIN)

        assert world.organizations.doc["default_permissions"] == {"a-later-row": {"role": "admin"}}
        assert list(default_entries(world)[-1]["detail"]["before"]) == ["check-in"]

    def test_resetting_every_row_when_none_is_set_records_nothing(self, world):
        OrgsApi.reset_default_permissions(ORG_ID, ORG_ADMIN)

        assert world.organizations.updates == []
        assert default_entries(world) == []

    def test_its_history_is_newest_first_and_holds_only_the_defaults_changes(self, world):
        OrgsApi.set_default_permission(ORG_ID, "check-in", "admin", ORG_ADMIN)
        OrgsApi.update_organization(ORG_ID, ORG_OWNER, "Ember Collective")
        OrgsApi.set_default_permission(ORG_ID, "export-csv", "editor", ORG_OWNER)

        entries = OrgsApi.get_default_permission_history(ORG_ID, ORG_MEMBER)

        assert [(e["actor"], e["subject"]["action"]) for e in entries] == [
            (ORG_OWNER, "export-csv"), (ORG_ADMIN, "check-in")]
        assert "organizationId" not in entries[0]

    def test_its_history_is_refused_to_someone_outside_it(self, world):
        with pytest.raises(ForbiddenError):
            OrgsApi.get_default_permission_history(ORG_ID, OUTSIDER)


class TestAStoredDefaultThatIsNotAMap:
    @pytest.mark.parametrize("stored", [None, "check-in", ["check-in"]],
                             ids=["null", "string", "list"])
    def test_setting_a_row_writes_the_whole_map(self, world, stored):
        world.organizations.doc["default_permissions"] = stored

        table = OrgsApi.set_default_permission(ORG_ID, "check-in", "admin", ORG_ADMIN)

        assert world.organizations.updates == [
            {"$set": {"default_permissions": {"check-in": {"role": "admin"}}}}]
        assert row(table, "check-in")["role"] == "admin"

    def test_a_map_keeps_its_other_rows(self, world):
        world.organizations.doc["default_permissions"] = {"export-csv": {"role": "editor"}}

        OrgsApi.set_default_permission(ORG_ID, "check-in", "admin", ORG_ADMIN)

        assert world.organizations.doc["default_permissions"] == {
            "export-csv": {"role": "editor"}, "check-in": {"role": "admin"}}


class TestTheWriteRefuses:
    @pytest.mark.parametrize("who", [ORG_MEMBER, OUTSIDER, OWNER])
    def test_anyone_but_its_owner_and_admins(self, world, who):
        for write in (
            lambda: OrgsApi.set_default_permission(ORG_ID, "check-in", "admin", who),
            lambda: OrgsApi.reset_default_permission(ORG_ID, "check-in", who),
            lambda: OrgsApi.reset_default_permissions(ORG_ID, who),
        ):
            with pytest.raises(ForbiddenError) as refused:
                write()
            assert refused.value.message == NOT_THEIRS

        assert world.organizations.updates == []
        assert world.history.docs == []

    @pytest.mark.parametrize("action_id", ["delete-market", "read", "change-the-table"])
    def test_a_fixed_row(self, world, action_id):
        with pytest.raises(BadRequestError) as refused:
            OrgsApi.set_default_permission(ORG_ID, action_id, "admin", ORG_ADMIN)

        assert "is fixed, so it cannot be changed" in refused.value.message
        assert world.organizations.updates == []

    @pytest.mark.parametrize("action_id", ["no-such-row", None, 3])
    def test_an_unknown_row(self, world, action_id):
        with pytest.raises(BadRequestError) as refused:
            OrgsApi.set_default_permission(ORG_ID, action_id, "admin", ORG_ADMIN)

        assert refused.value.message == "The default table has no such row."

    @pytest.mark.parametrize("role", ["root", None, 1, ["admin"]])
    def test_a_role_that_is_not_one_of_the_four(self, world, role):
        with pytest.raises(BadRequestError):
            OrgsApi.set_default_permission(ORG_ID, "check-in", role, ORG_ADMIN)

        assert world.organizations.updates == []
        assert world.history.docs == []

    def test_an_organization_nobody_has(self, world):
        with pytest.raises(NotFoundError):
            OrgsApi.set_default_permission("org-gone", "check-in", "admin", ORG_ADMIN)


class TestANewMarketCopiesTheDefault:
    def test_a_market_created_after_a_change_starts_with_it_and_one_created_before_keeps_its_own(
        self, world,
    ):
        OrgsApi.set_default_permission(ORG_ID, "check-in", "admin", ORG_ADMIN)

        new_id = create_market()

        copied = row(market_table(new_id), "check-in")
        assert (copied["role"], copied["source"]) == ("admin", "organization")
        assert world.markets.doc(new_id)["permissions"] == {
            "check-in": {"role": "admin", "source": "organization"}}
        older = row(market_table("market-123"), "check-in")
        assert (older["role"], older["source"]) == ("editor", "built-in")

    def test_the_copy_is_not_a_link(self, world):
        OrgsApi.set_default_permission(ORG_ID, "check-in", "admin", ORG_ADMIN)
        new_id = create_market()

        OrgsApi.set_default_permission(ORG_ID, "check-in", "viewer", ORG_ADMIN)

        assert row(market_table(new_id), "check-in")["role"] == "admin"

    def test_only_rows_it_can_read_are_copied(self, world):
        world.organizations.doc["default_permissions"] = {
            "check-in": {"role": "admin"}, "delete-market": {"role": "viewer"},
            "a-later-row": {"role": "admin"}, "export-csv": {"role": "root"}, "assign": "admin",
        }

        new_id = create_market()

        assert world.markets.doc(new_id)["permissions"] == {
            "check-in": {"role": "admin", "source": "organization"}}

    def test_an_organization_that_sets_none_gives_the_built_in_table(self, world):
        new_id = create_market()

        assert world.markets.doc(new_id)["permissions"] == {}

    def test_a_market_of_no_organization_starts_on_the_built_in_defaults(self, world):
        OrgsApi.set_default_permission(ORG_ID, "check-in", "admin", ORG_ADMIN)

        MarketsApi.create_market(MarketsApi.Market.model_validate({
            **NEW_MARKET, "name": "Loose Fair", "roles": {OWNER: "owner"}}), OWNER)

        [loose] = [doc for doc in world.markets.docs if doc["name"] == "Loose Fair"]
        assert loose["permissions"] == {}


class TestTheOwnerCopiesTheDefaultAgain:
    def test_the_older_market_takes_the_default_in_one_recorded_change(self, world):
        OrgsApi.set_default_permission(ORG_ID, "check-in", "admin", ORG_ADMIN)

        table = MarketsApi.copy_organization_default("market-123", OWNER)

        assert (row(table, "check-in")["role"], row(table, "check-in")["source"]) == (
            "admin", "organization")
        assert row(market_table("market-123"), "check-in")["role"] == "admin"
        [entry] = MarketsApi.get_permission_history("market-123", VIEWER)
        assert entry["actor"] == OWNER
        assert entry["kind"] == History.PERMISSION_TABLE_COPIED
        assert entry["action"] == Actions.CHANGE_THE_TABLE.id
        assert entry["detail"] == {
            "before": {"check-in": {"role": "editor", "source": "built-in"}},
            "after": {"check-in": {"role": "admin", "source": "organization"}},
        }

    def test_a_row_changed_here_is_replaced_and_a_row_it_does_not_set_returns_to_built_in(
        self, world,
    ):
        world.markets.doc()["permissions"] = {
            "check-in": {"role": "viewer", "source": "market"},
            "export-csv": {"role": "owner", "source": "market"},
        }
        world.organizations.doc["default_permissions"] = {"check-in": {"role": "admin"}}

        MarketsApi.copy_organization_default("market-123", OWNER)

        assert world.markets.doc()["permissions"] == {
            "check-in": {"role": "admin", "source": "organization"}}
        [entry] = MarketsApi.get_permission_history("market-123", OWNER)
        assert entry["detail"]["after"] == {
            "check-in": {"role": "admin", "source": "organization"},
            "export-csv": {"role": "viewer", "source": "built-in"},
        }

    def test_a_row_this_build_cannot_read_is_left_in_place(self, world):
        world.markets.doc()["permissions"] = {
            "a-later-row": {"role": "admin", "source": "market"}}
        world.organizations.doc["default_permissions"] = {"check-in": {"role": "admin"}}

        MarketsApi.copy_organization_default("market-123", OWNER)

        assert world.markets.doc()["permissions"] == {
            "a-later-row": {"role": "admin", "source": "market"},
            "check-in": {"role": "admin", "source": "organization"},
        }

    @pytest.mark.parametrize("stored", [None, "check-in"], ids=["null", "string"])
    def test_a_stored_table_that_is_not_a_map_is_replaced_whole(self, world, stored):
        world.markets.doc()["permissions"] = stored
        world.organizations.doc["default_permissions"] = {"check-in": {"role": "admin"}}

        MarketsApi.copy_organization_default("market-123", OWNER)

        assert world.markets.doc()["permissions"] == {
            "check-in": {"role": "admin", "source": "organization"}}

    def test_a_market_already_on_the_default_writes_and_records_nothing(self, world):
        world.markets.doc()["permissions"] = {
            "check-in": {"role": "admin", "source": "organization"}}
        world.organizations.doc["default_permissions"] = {"check-in": {"role": "admin"}}

        MarketsApi.copy_organization_default("market-123", OWNER)

        assert world.markets.updates == []
        assert world.history.docs == []

    @pytest.mark.parametrize("who", [ADMIN, EDITOR, VIEWER, ORG_ADMIN, ORG_OWNER])
    def test_anyone_but_the_markets_owner_is_refused(self, world, who):
        world.organizations.doc["default_permissions"] = {"check-in": {"role": "admin"}}

        with pytest.raises(ForbiddenError) as refused:
            MarketsApi.copy_organization_default("market-123", who)

        assert refused.value.message == (
            "Only the market's owner may change who may do what on this market.")
        assert world.markets.updates == []
        assert world.history.docs == []

    def test_an_archived_market_is_refused(self, world):
        world.markets.docs = [market_doc("market-123", phase=MarketPhase.ARCHIVED)]
        world.organizations.doc["default_permissions"] = {"check-in": {"role": "admin"}}

        with pytest.raises(ForbiddenError):
            MarketsApi.copy_organization_default("market-123", OWNER)

        assert world.markets.updates == []

    def test_a_market_of_no_organization_has_none_to_copy(self, world):
        world.markets.docs = [market_doc("market-123", organizationId=None)]

        with pytest.raises(BadRequestError) as refused:
            MarketsApi.copy_organization_default("market-123", OWNER)

        assert refused.value.message == MarketsApi.NO_ORGANIZATION_TO_COPY


class TestTheRoutes:
    @pytest.fixture
    def client(self, monkeypatch, world):
        monkeypatch.setattr(app_module.login_manager, "session_protection", None)
        sessions_load_through_get_user(monkeypatch)

        def signed_in(who):
            client = app_module.app.test_client()
            with client.session_transaction() as session:
                session["_user_id"] = who
                session["_fresh"] = True
            return client

        return signed_in

    def test_an_admin_sets_and_resets_a_row_and_a_member_reads_the_changes(self, client, world):
        admin = client(ORG_ADMIN)
        base = f"/organizations/{ORG_ID}/default-permissions"

        set_response = admin.put(f"{base}/check-in", json={"role": "admin"})
        assert set_response.status_code == 200
        assert row(set_response.get_json()["permissionTable"], "check-in")["role"] == "admin"

        reset_response = admin.delete(f"{base}/check-in")
        assert reset_response.status_code == 200
        assert row(reset_response.get_json()["permissionTable"], "check-in")["source"] == "built-in"

        admin.put(f"{base}/check-in", json={"role": "admin"})
        assert admin.delete(base).status_code == 200

        history = client(ORG_MEMBER).get(f"/organizations/{ORG_ID}/default-permission-history")
        assert history.status_code == 200
        assert [e["kind"] for e in history.get_json()["entries"]] == [
            History.PERMISSION_TABLE_RESET, History.PERMISSION_SET, History.PERMISSION_RESET,
            History.PERMISSION_SET]

    def test_a_member_is_refused_in_words(self, client, world):
        response = client(ORG_MEMBER).put(
            f"/organizations/{ORG_ID}/default-permissions/check-in", json={"role": "admin"})

        assert response.status_code == 403
        assert response.get_json() == {"error": NOT_THEIRS}
        assert world.organizations.updates == []

    def test_an_outsider_cannot_read_the_changes(self, client, world):
        response = client(OUTSIDER).get(f"/organizations/{ORG_ID}/default-permission-history")

        assert response.status_code == 403
        assert "entries" not in response.get_json()

    def test_the_markets_owner_copies_the_default_again(self, client, world):
        world.organizations.doc["default_permissions"] = {"check-in": {"role": "admin"}}

        response = client(OWNER).post("/markets/market-123/permissions/organization-default")

        assert response.status_code == 200
        assert row(response.get_json()["permissionTable"], "check-in")["source"] == "organization"

    def test_copying_it_again_is_refused_to_anyone_but_the_owner(self, client, world):
        response = client(ADMIN).post("/markets/market-123/permissions/organization-default")

        assert response.status_code == 403
        assert response.get_json() == {
            "error": "Only the market's owner may change who may do what on this market."}
