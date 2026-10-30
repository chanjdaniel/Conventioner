"""A market keeps its own rows of the table; only its owner changes them (E39/F01/S03).

The table's rows were the built-in defaults on every market alike. A market now stores the rows it
differs on, every check reads them, and its owner sets or resets each, every change recorded in the
market's history with who and when (Daniel, Q22: "every change is logged and recorded. who did
what."). A market that stores none reads every row at its built-in default, so no market needs a
migration.
"""
import copy
from types import SimpleNamespace

import pytest

from conftest import (
    FakeMarketsCollection, client_market, mongo_matches, mongo_project,
    sessions_load_through_get_user, stored_market,
)
from test_the_history import FakeHistoryCollection

import app as app_module
import api.door as DoorApi
import api.market_actions as Actions
import api.markets as MarketsApi
import api.organizations as OrgsApi
import api.users as UsersApi
import history as History
from client_errors import BadRequestError, ForbiddenError
from datatypes import MarketPhase, MarketRole

ORG_ID = "org-1"
OWNER = "owner@example.com"
ADMIN = "admin@example.com"
EDITOR = "editor@example.com"
VIEWER = "viewer@example.com"
ORG_ADMIN = "org-admin@example.com"
ORG_OWNER = "org-owner@example.com"
ROLES = {OWNER: "owner", ADMIN: "admin", EDITOR: "editor", VIEWER: "viewer"}
ORGANIZATION = {
    "id": ORG_ID, "name": "Test Org", "owner": ORG_OWNER, "admins": [ORG_ADMIN], "members": [],
    "markets": ["market-123", "market-456"],
}


def _set_path(doc, path, value):
    *parents, leaf = path.split(".")
    for part in parents:
        doc = doc.setdefault(part, {})
    doc[leaf] = value


def _unset_path(doc, path):
    *parents, leaf = path.split(".")
    for part in parents:
        doc = doc.get(part) or {}
    doc.pop(leaf, None)


class FakeMarkets:
    """The markets collection, holding several documents and applying ``$set`` and ``$unset`` on
    dotted paths, so a read after a write sees what the write stored."""

    def __init__(self, *docs):
        self.docs = [copy.deepcopy(doc) for doc in docs]
        self.updates = []

    def find_one(self, query, projection=None):
        found = next((doc for doc in self.docs if mongo_matches(doc, query)), None)
        return None if found is None else mongo_project(copy.deepcopy(found), projection)

    def update_one(self, query, update):
        self.updates.append(update)
        for doc in self.docs:
            if mongo_matches(doc, query):
                for path, value in (update.get("$set") or {}).items():
                    _set_path(doc, path, copy.deepcopy(value))
                for path in update.get("$unset") or {}:
                    _unset_path(doc, path)
                return SimpleNamespace(matched_count=1, modified_count=1)
        return SimpleNamespace(matched_count=0, modified_count=0)

    def doc(self, market_id="market-123"):
        return next(doc for doc in self.docs if doc["id"] == market_id)


def market_doc(market_id="market-123", phase=MarketPhase.MARKET_DAYS, **overrides):
    return {
        **stored_market(phase, name=f"Market {market_id}", organizationId=ORG_ID, roles=ROLES),
        "id": market_id, "_id": f"mongo-{market_id}", **overrides,
    }


@pytest.fixture
def world(monkeypatch):
    """Two markets of one organization, the people on them, and the market's history.

    Roles resolve as they do in production (``get_user_market_role``), so an organization admin
    holds Admin and is not the owner.
    """
    markets = FakeMarkets(market_doc("market-123"), market_doc("market-456"))
    history = FakeHistoryCollection()
    monkeypatch.setattr(MarketsApi, "markets_collection", markets)
    monkeypatch.setattr(History, "history_collection", history)
    monkeypatch.setattr(History, "legacy_placement_collection", FakeHistoryCollection())
    monkeypatch.setattr(UsersApi, "get_user", lambda email: SimpleNamespace(
        id=email, email=email, name=email, is_active=True, is_authenticated=True,
        is_anonymous=False, get_id=lambda e=email: e,
    ))
    monkeypatch.setattr(UsersApi, "get_user_by_id", lambda _uid: None)
    monkeypatch.setattr(OrgsApi, "get_organization", lambda _oid: dict(ORGANIZATION))
    monkeypatch.setattr(
        MarketsApi.PermissionsApi, "organizations_collection",
        SimpleNamespace(find_one=lambda _query: dict(ORGANIZATION)))
    return SimpleNamespace(markets=markets, history=history)


def row(table, action_id):
    return next(entry for entry in table if entry["id"] == action_id)


def read_table(who=OWNER, market_id="market-123"):
    return MarketsApi.get_market_for_user(who, market_id)["permissionTable"]


class TestAMarketWithoutRows:
    def test_every_row_reads_its_built_in_default(self, world):
        assert "permissions" not in world.markets.doc()

        table = read_table()

        assert [entry["id"] for entry in table] == list(Actions.ACTIONS)
        for entry in table:
            action = Actions.ACTIONS[entry["id"]]
            assert entry == {
                "id": action.id, "group": action.group, "label": action.label,
                "role": action.default.value, "default": action.default.value,
                "source": "built-in", "fixed": action.fixed, "mayWhat": action.may_what,
            }

    def test_its_checks_ask_the_built_in_defaults(self, world):
        market = MarketsApi.market_from_document(world.markets.doc())

        for action in Actions.ACTIONS.values():
            assert Actions.minimum_role(action, market) is action.default


class TestANewMarket:
    def test_starts_at_the_built_in_table_whatever_its_create_body_carried(self, monkeypatch):
        fake = FakeMarketsCollection(None)
        monkeypatch.setattr(MarketsApi, "markets_collection", fake)

        MarketsApi.create_market(client_market(permissions={
            "check-in": {"role": "viewer", "source": "organization"},
        }), "user-1")

        assert fake.inserted["permissions"] == {}


class TestTheOwnerSetsAndResetsARow:
    def test_the_read_shows_each_change_and_the_record_lists_both(self, world):
        MarketsApi.set_permission("market-123", "check-in", "admin", OWNER)

        changed = row(read_table(), "check-in")
        assert (changed["role"], changed["source"]) == ("admin", "market")
        assert world.markets.doc()["permissions"] == {
            "check-in": {"role": "admin", "source": "market"},
        }

        MarketsApi.reset_permission("market-123", "check-in", OWNER)

        reset = row(read_table(), "check-in")
        assert (reset["role"], reset["source"]) == ("editor", "built-in")
        assert world.markets.doc()["permissions"] == {}

        entries = MarketsApi.get_permission_history("market-123", VIEWER)
        assert [(e["actor"], e["kind"], e["subject"], e["detail"]) for e in entries] == [
            (OWNER, History.PERMISSION_RESET, {"action": "check-in"}, {
                "before": {"role": "admin", "source": "market"},
                "after": {"role": "editor", "source": "built-in"},
            }),
            (OWNER, History.PERMISSION_SET, {"action": "check-in"}, {
                "before": {"role": "editor", "source": "built-in"},
                "after": {"role": "admin", "source": "market"},
            }),
        ]
        assert all(e["action"] == Actions.CHANGE_THE_TABLE.id and e["at"] for e in entries)
        assert entries[0]["at"] >= entries[1]["at"]

    def test_a_row_copied_from_the_organization_reads_so_and_is_reset_to_the_built_in(
        self, world,
    ):
        world.markets.doc()["permissions"] = {"move-phase": {"role": "owner", "source": "organization"}}

        copied = row(read_table(), "move-phase")
        assert (copied["role"], copied["source"]) == ("owner", "organization")

        MarketsApi.reset_permission("market-123", "move-phase", OWNER)

        assert row(read_table(), "move-phase")["source"] == "built-in"

    def test_setting_the_role_a_row_already_asks_changes_and_records_nothing(self, world):
        MarketsApi.set_permission("market-123", "check-in", "editor", OWNER)
        MarketsApi.reset_permission("market-123", "check-in", OWNER)

        assert world.markets.updates == []
        assert world.history.docs == []

    def test_the_history_is_read_newest_first_and_holds_only_the_tables_changes(self, world):
        History.record("market-123", OWNER, Actions.ASSIGN, kind=History.FREED,
                       detail={"date": "2026-11-18", "table_code": "A 1"})
        MarketsApi.set_permission("market-123", "check-in", "admin", OWNER)
        MarketsApi.set_permission("market-123", "add-vendor", "owner", OWNER)

        entries = MarketsApi.get_permission_history("market-123", VIEWER)

        assert [e["subject"]["action"] for e in entries] == ["add-vendor", "check-in"]

    def test_the_history_is_refused_to_someone_who_cannot_see_the_market(self, world):
        with pytest.raises(ForbiddenError):
            MarketsApi.get_permission_history("market-123", "stranger@example.com")


class TestTheOwnerResetsTheWholeTable:
    """"Reset to built-in defaults" is one write and one entry, so the record shows one act
    (E39/F01/S04)."""

    def test_every_held_row_returns_to_its_default_in_one_entry(self, world):
        world.markets.doc()["permissions"] = {
            "move-phase": {"role": "owner", "source": "organization"},
        }
        MarketsApi.set_permission("market-123", "check-in", "admin", OWNER)
        world.history.docs.clear()

        table = MarketsApi.reset_permissions("market-123", OWNER)

        assert all(entry["source"] == "built-in" for entry in table)
        assert table == read_table()
        assert world.markets.doc()["permissions"] == {}
        entries = MarketsApi.get_permission_history("market-123", VIEWER)
        assert [(e["actor"], e["kind"], e["subject"], e["detail"]) for e in entries] == [
            (OWNER, History.PERMISSION_TABLE_RESET, {}, {
                "before": {
                    "move-phase": {"role": "owner", "source": "organization"},
                    "check-in": {"role": "admin", "source": "market"},
                },
                "after": {
                    "move-phase": {"role": "admin", "source": "built-in"},
                    "check-in": {"role": "editor", "source": "built-in"},
                },
            }),
        ]
        assert entries[0]["action"] == Actions.CHANGE_THE_TABLE.id

    def test_a_row_this_build_cannot_read_is_left_in_place_and_out_of_the_entry(self, world):
        world.markets.doc()["permissions"] = {
            "check-in": {"role": "admin", "source": "market"},
            "add-vendor": "owner",
            "a-later-row": {"role": "viewer", "source": "market"},
        }

        MarketsApi.reset_permissions("market-123", OWNER)

        assert world.markets.doc()["permissions"] == {
            "add-vendor": "owner", "a-later-row": {"role": "viewer", "source": "market"},
        }
        assert len(world.markets.updates) == 1
        [entry] = MarketsApi.get_permission_history("market-123", OWNER)
        assert list(entry["detail"]["before"]) == ["check-in"]

    @pytest.mark.parametrize("stored", [None, {}, "admin", {"check-in": "admin"}],
                             ids=["no rows", "an empty map", "rows that are not a map",
                                  "only a row this build cannot read"])
    def test_a_market_holding_no_row_it_reads_writes_and_records_nothing(self, world, stored):
        world.markets.doc()["permissions"] = stored

        table = MarketsApi.reset_permissions("market-123", OWNER)

        assert all(entry["source"] == "built-in" for entry in table)
        assert world.markets.updates == []
        assert world.history.docs == []

    @pytest.mark.parametrize("who", [ORG_ADMIN, ORG_OWNER, ADMIN, EDITOR, VIEWER])
    def test_anyone_but_the_markets_owner_is_refused(self, world, who):
        world.markets.doc()["permissions"] = {"check-in": {"role": "admin", "source": "market"}}

        with pytest.raises(ForbiddenError) as refused:
            MarketsApi.reset_permissions("market-123", who)

        assert str(refused.value) == "Only the market's owner may change who may do what on this market."
        assert world.markets.updates == []
        assert world.history.docs == []

    def test_an_archived_market_is_refused(self, world):
        world.markets.doc()["phase"] = MarketPhase.ARCHIVED.value
        world.markets.doc()["permissions"] = {"check-in": {"role": "admin", "source": "market"}}

        with pytest.raises(MarketsApi.MarketArchivedError, match="archived"):
            MarketsApi.reset_permissions("market-123", OWNER)
        assert world.markets.updates == []
        assert world.history.docs == []


class TestAStoredTableThatIsNotAMap:
    """A market whose stored ``permissions`` is not a map reads the built-in table, and its owner's
    write replaces the field rather than failing inside it (T108's re-review)."""

    @pytest.mark.parametrize("stored", [None, "admin", ["check-in"]],
                             ids=["null", "a string", "a list"])
    def test_setting_a_row_writes_the_whole_map(self, world, stored):
        world.markets.doc()["permissions"] = stored

        MarketsApi.set_permission("market-123", "check-in", "admin", OWNER)

        assert world.markets.doc()["permissions"] == {
            "check-in": {"role": "admin", "source": "market"},
        }
        assert row(read_table(), "check-in")["role"] == "admin"
        assert [e["kind"] for e in MarketsApi.get_permission_history("market-123", OWNER)] == [
            History.PERMISSION_SET]

    def test_a_map_keeps_its_other_rows(self, world):
        world.markets.doc()["permissions"] = {"move-phase": {"role": "owner", "source": "market"}}

        MarketsApi.set_permission("market-123", "check-in", "admin", OWNER)

        assert world.markets.doc()["permissions"] == {
            "move-phase": {"role": "owner", "source": "market"},
            "check-in": {"role": "admin", "source": "market"},
        }


class TestEveryCheckReadsTheMarketsRows:
    def test_an_editors_check_in_is_refused_where_the_row_asks_for_an_admin(self, world):
        MarketsApi.set_permission("market-123", "check-in", "admin", OWNER)

        with pytest.raises(ForbiddenError) as refused:
            DoorApi.check_in("market-123", "ana@example.com", "2026-11-18", EDITOR)
        assert str(refused.value) == "Only an Admin or the owner may check vendors in at this market."

    def test_and_allowed_on_another_market_of_the_same_organization(self, world, monkeypatch):
        MarketsApi.set_permission("market-123", "check-in", "admin", OWNER)
        recorded = []
        monkeypatch.setattr(
            DoorApi.AttendanceApi, "record_attendance",
            lambda *args, **kwargs: recorded.append(args) or ({"ok": True}, 200))

        assert DoorApi.check_in("market-456", "ana@example.com", "2026-11-18", EDITOR) == (
            {"ok": True}, 200)
        assert recorded == [("market-456", "ana@example.com", "2026-11-18")]

    def test_a_row_lowered_lets_a_lower_role_take_it(self, world):
        MarketsApi.set_permission("market-123", "move-phase", "editor", OWNER)
        market = MarketsApi.market_from_document(world.markets.doc())

        assert Actions.refusal(Actions.MOVE_PHASE, EDITOR, market, None) is None
        assert Actions.refusal(Actions.MOVE_PHASE, VIEWER, market, None) == (
            "Only an Editor, an Admin or the owner may move this market's phase.")

    def test_the_read_answers_every_row_from_the_markets_rows(self, world):
        MarketsApi.set_permission("market-123", "check-in", "admin", OWNER)

        assert MarketsApi.get_market_for_user(EDITOR, "market-123")["actionRefusals"][
            "check-in"] == "Only an Admin or the owner may check vendors in at this market."
        assert MarketsApi.get_market_for_user(EDITOR, "market-456")["actionRefusals"][
            "check-in"] is None

    def test_the_markets_list_answers_from_the_markets_rows_too(self, world):
        MarketsApi.set_permission("market-123", "check-in", "admin", OWNER)
        lookups = MarketsApi._SummaryLookups()

        changed = MarketsApi._decorate_market_summary(
            copy.deepcopy(world.markets.doc("market-123")), "editor", lookups)
        other = MarketsApi._decorate_market_summary(
            copy.deepcopy(world.markets.doc("market-456")), "editor", lookups)

        assert changed["actionRefusals"]["check-in"] == (
            "Only an Admin or the owner may check vendors in at this market.")
        assert other["actionRefusals"]["check-in"] is None

    def test_a_stored_row_for_a_fixed_action_is_never_read(self, world):
        world.markets.doc()["permissions"] = {"delete-market": {"role": "viewer", "source": "market"}}
        market = MarketsApi.market_from_document(world.markets.doc())

        assert Actions.minimum_role(Actions.DELETE_MARKET, market) is MarketRole.OWNER
        assert row(read_table(), "delete-market")["source"] == "built-in"

    @pytest.mark.parametrize("stored", [
        {"role": "superuser", "source": "market"},
        {"role": "admin", "source": "somewhere"},
        {"role": 3, "source": "market"},
    ], ids=["an unknown role", "an unknown source", "a role that is not a string"])
    def test_a_stored_row_this_build_cannot_read_is_its_default(self, world, stored):
        world.markets.doc()["permissions"] = {"check-in": stored}
        market = MarketsApi.market_from_document(world.markets.doc())

        assert Actions.minimum_role(Actions.CHECK_IN, market) is MarketRole.EDITOR
        # The markets list asks the raw document's rows.
        assert Actions.role_refusal(
            Actions.CHECK_IN, MarketRole.EDITOR, world.markets.doc()["permissions"]) is None
        assert row(read_table(), "check-in")["source"] == "built-in"

    @pytest.mark.parametrize("stored", [
        {"check-in": "admin"},
        {"check-in": {"role": "admin"}},
        {"check-in": None},
        None,
        "admin",
    ], ids=["a row that is not a map", "a row without a source", "a null row", "null rows",
            "rows that are not a map"])
    def test_a_stored_row_of_the_wrong_shape_is_dropped_and_the_market_still_reads(
        self, world, stored,
    ):
        world.markets.doc()["permissions"] = stored

        market = MarketsApi.market_from_document(world.markets.doc())

        assert market.permissions == {}
        assert Actions.minimum_role(Actions.CHECK_IN, market) is MarketRole.EDITOR
        assert Actions.role_refusal(
            Actions.CHECK_IN, MarketRole.EDITOR, world.markets.doc()["permissions"]) is None
        assert row(read_table(), "check-in")["source"] == "built-in"

    def test_a_good_row_beside_a_broken_one_is_still_read(self, world):
        world.markets.doc()["permissions"] = {
            "check-in": {"role": "admin", "source": "market"}, "add-vendor": "owner",
        }

        market = MarketsApi.market_from_document(world.markets.doc())

        assert list(market.permissions) == ["check-in"]
        assert Actions.minimum_role(Actions.CHECK_IN, market) is MarketRole.ADMIN

    def test_a_stored_row_the_table_no_longer_has_is_ignored(self, world):
        world.markets.doc()["permissions"] = {"gone-row": {"role": "viewer", "source": "market"}}

        assert [entry["id"] for entry in read_table()] == list(Actions.ACTIONS)


class TestTheWriteRefuses:
    """Each refusal is a client-safe sentence, and nothing is stored or recorded."""

    @pytest.mark.parametrize("who", [ORG_ADMIN, ORG_OWNER, ADMIN, EDITOR, VIEWER])
    def test_anyone_but_the_markets_owner(self, world, who):
        with pytest.raises(ForbiddenError) as refused:
            MarketsApi.set_permission("market-123", "check-in", "admin", who)
        assert str(refused.value) == "Only the market's owner may change who may do what on this market."

        with pytest.raises(ForbiddenError):
            MarketsApi.reset_permission("market-123", "check-in", who)

    @pytest.mark.parametrize("action_id", [a.id for a in Actions.ACTIONS.values() if a.fixed])
    def test_a_fixed_row(self, world, action_id):
        label = Actions.ACTIONS[action_id].label
        with pytest.raises(BadRequestError) as refused:
            MarketsApi.set_permission("market-123", action_id, "admin", OWNER)
        assert str(refused.value) == f"Who may take the row \"{label}\" is fixed, so it cannot be changed."

        with pytest.raises(BadRequestError):
            MarketsApi.reset_permission("market-123", action_id, OWNER)

    @pytest.mark.parametrize("action_id", ["no-such-row", "", "$where", "permissions.check-in"])
    def test_an_unknown_action(self, world, action_id):
        with pytest.raises(BadRequestError) as refused:
            MarketsApi.set_permission("market-123", action_id, "admin", OWNER)
        assert str(refused.value) == "This market's table has no such row."

        with pytest.raises(BadRequestError):
            MarketsApi.reset_permission("market-123", action_id, OWNER)

    @pytest.mark.parametrize("role", ["superuser", "Admin", "", None, 3, ["admin"], {"role": "admin"}])
    def test_a_role_that_is_not_one_of_the_four(self, world, role):
        with pytest.raises(BadRequestError) as refused:
            MarketsApi.set_permission("market-123", "check-in", role, OWNER)
        assert str(refused.value) == "A row's role is one of viewer, editor, admin or owner."

    def test_an_archived_market(self, world):
        world.markets.doc()["phase"] = MarketPhase.ARCHIVED.value
        world.markets.doc()["permissions"] = {"check-in": {"role": "admin", "source": "market"}}

        with pytest.raises(MarketsApi.MarketArchivedError, match="archived"):
            MarketsApi.set_permission("market-123", "check-in", "owner", OWNER)
        with pytest.raises(MarketsApi.MarketArchivedError, match="archived"):
            MarketsApi.reset_permission("market-123", "check-in", OWNER)

    def test_an_unknown_market(self, world):
        with pytest.raises(MarketsApi.MarketNotFoundError):
            MarketsApi.set_permission("no-market", "check-in", "admin", OWNER)

    @pytest.fixture(autouse=True)
    def nothing_is_stored_or_recorded(self, world):
        yield
        assert world.markets.updates == []
        assert world.history.docs == []


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

    def test_the_owner_sets_a_row_and_resets_it(self, client, world):
        owner = client(OWNER)

        set_response = owner.put("/markets/market-123/permissions/check-in", json={"role": "admin"})
        assert set_response.status_code == 200
        assert row(set_response.get_json()["permissionTable"], "check-in")["role"] == "admin"

        reset_response = owner.delete("/markets/market-123/permissions/check-in")
        assert reset_response.status_code == 200
        assert row(reset_response.get_json()["permissionTable"], "check-in")["source"] == "built-in"

        history = client(VIEWER).get("/markets/market-123/permission-history")
        assert history.status_code == 200
        assert [e["kind"] for e in history.get_json()["entries"]] == [
            History.PERMISSION_RESET, History.PERMISSION_SET]

    def test_the_owner_resets_the_whole_table(self, client, world):
        owner = client(OWNER)
        owner.put("/markets/market-123/permissions/check-in", json={"role": "admin"})

        response = owner.delete("/markets/market-123/permissions")

        assert response.status_code == 200
        assert row(response.get_json()["permissionTable"], "check-in")["source"] == "built-in"
        history = client(VIEWER).get("/markets/market-123/permission-history")
        assert history.get_json()["entries"][0]["kind"] == History.PERMISSION_TABLE_RESET

    def test_resetting_the_whole_table_is_refused_to_anyone_but_the_owner(self, client, world):
        response = client(ADMIN).delete("/markets/market-123/permissions")

        assert response.status_code == 403
        assert response.get_json() == {
            "error": "Only the market's owner may change who may do what on this market."}
        assert world.markets.updates == []

    def test_the_permission_history_asks_the_historys_row(self, client, world):
        raised = client(OWNER).put(
            "/markets/market-123/permissions/read-history", json={"role": "editor"})
        assert raised.status_code == 200

        refused = client(VIEWER).get("/markets/market-123/permission-history")
        assert refused.status_code == 403
        assert "entries" not in refused.get_json()
        assert client(VIEWER).get("/markets/market-123/history").status_code == 403

        history = client(EDITOR).get("/markets/market-123/permission-history")
        assert history.status_code == 200
        assert [e["subject"]["action"] for e in history.get_json()["entries"]] == ["read-history"]

    @pytest.mark.parametrize("who,path,body,status,error", [
        (ORG_ADMIN, "check-in", {"role": "admin"}, 403,
         "Only the market's owner may change who may do what on this market."),
        (OWNER, "delete-market", {"role": "admin"}, 400,
         'Who may take the row "Delete the market" is fixed, so it cannot be changed.'),
        (OWNER, "no-such-row", {"role": "admin"}, 400, "This market's table has no such row."),
        (OWNER, "check-in", {"role": "root"}, 400,
         "A row's role is one of viewer, editor, admin or owner."),
        (OWNER, "check-in", {}, 400, "A row's role is one of viewer, editor, admin or owner."),
    ])
    def test_a_refusal_answers_its_sentence(self, client, world, who, path, body, status, error):
        response = client(who).put(f"/markets/market-123/permissions/{path}", json=body)

        assert response.status_code == status
        assert response.get_json() == {"error": error}
        assert world.markets.updates == []
        assert world.history.docs == []
