"""Every permission check on a market asks a named action (E39/F01/S01).

Each check used to name its own role threshold, about twenty of them across the routes, so what a
role may do was spread over every module that wrote a market. Each now asks one row of the table
in ``api/market_actions.py``: the row says the lowest role that may take the action, and a refusal
is the row's own sentence. The built-in defaults are the rules each check held before.
"""
import ast
from pathlib import Path
from types import SimpleNamespace

import pytest

from conftest import COMPLETE_PLAN, client_market, stored_market
import api.added_vendors as AddedVendorsApi
import api.discord_connection as DiscordConnectionApi
import api.door as DoorApi
import api.market_actions as Actions
import api.markets as MarketsApi
import api.permissions as PermissionsApi
import api.placements as PlacementsApi
import api.vendor_export as VendorExportApi
from client_errors import ForbiddenError
from datatypes import MarketPerson, MarketPhase, MarketRole

BACK_END = Path(__file__).resolve().parent.parent

#: The epic's table (E39), with E38/F04's stop row, E38/F06/S01's change row and E38/F07's
#: reviewers rows, and without the form amendment's, which E38/F04 removed (the amendment's walk is
#: gone): (id, group, label, default, fixed).
THE_TABLE = [
    ("read", "Reading", "Read the market: its applications, assignments, statistics, attendance "
     "and floorplan export", MarketRole.VIEWER, True),
    ("read-history", "Reading", "Read the market's history", MarketRole.VIEWER, False),
    ("export-csv", "Reading", "Export CSV", MarketRole.VIEWER, False),
    ("change-setup", "Market Setup",
     "Change Market Setup: the plan, its floorplans, the market's name", MarketRole.EDITOR, False),
    ("change-form", "Market Setup",
     "Change the form, the automatic rejections and the review highlights", MarketRole.EDITOR,
     False),
    ("import-applications", "Applications", "Import applications, and start a market from a CSV",
     MarketRole.ADMIN, False),
    ("give-verdicts", "Applications", "Give verdicts and follow-ups", MarketRole.EDITOR, False),
    ("change-verdicts", "Applications", "Change a verdict, or overturn an automatic rejection",
     MarketRole.ADMIN, False),
    ("choose-reviewers", "Applications", "Choose reviewers", MarketRole.ADMIN, False),
    ("review-when-chosen", "Applications",
     "Be chosen as a reviewer, and then give verdicts and follow-ups", MarketRole.VIEWER, False),
    ("move-phase", "Lifecycle", "Move the phase", MarketRole.ADMIN, False),
    ("stop-applications", "Lifecycle", "Stop taking applications, and take them again",
     MarketRole.ADMIN, False),
    ("publish-results", "Lifecycle", "Publish results", MarketRole.ADMIN, False),
    ("add-vendor", "Vendors", "Add a vendor who never applied", MarketRole.EDITOR, False),
    ("write-vendor-notes", "Vendors", "Write vendor notes", MarketRole.EDITOR, False),
    ("update-vendor-info", "Vendors", "Update a vendor's info", MarketRole.EDITOR, False),
    ("update-assignment-or-price-info", "Vendors", "Update info the assignment or price reads",
     MarketRole.ADMIN, False),
    ("assign", "Assignment",
     "Allocate tables, change the assignment rules, and assign, swap or free seats",
     MarketRole.EDITOR, False),
    ("check-in", "The door", "Check vendors in", MarketRole.EDITOR, False),
    ("connect-discord", "Discord", "Connect Discord and give roles", MarketRole.ADMIN, False),
    ("manage-editors-and-viewers", "People", "Give and take Editor and Viewer roles",
     MarketRole.ADMIN, False),
    ("manage-admins", "People", "Give and take Admin roles", MarketRole.OWNER, True),
    ("delete-market", "People", "Delete the market", MarketRole.OWNER, True),
    ("change-the-table", "People", "Change this table", MarketRole.OWNER, True),
]

#: Lowest first: the role a row's default is compared against, and the one just below it.
LADDER = [None, MarketRole.VIEWER, MarketRole.EDITOR, MarketRole.ADMIN, MarketRole.OWNER]


@pytest.fixture
def holding(monkeypatch):
    """The asker holds this role on the market, resolved as every check resolves it."""
    def hold(role):
        monkeypatch.setattr(PermissionsApi, "get_user_market_role", lambda *_a, **_k: role)
    return hold


class TestTheTable:
    def test_every_row_of_the_epic_is_there_as_agreed(self):
        rows = [(a.id, a.group, a.label, a.default, a.fixed) for a in Actions.ACTIONS.values()]

        assert rows == THE_TABLE

    def test_an_action_is_found_by_its_id(self):
        assert Actions.ACTIONS["move-phase"] is Actions.MOVE_PHASE

    def test_two_rows_never_share_an_id(self):
        with pytest.raises(ValueError, match="move-phase"):
            Actions.action(
                "move-phase", "Lifecycle", "Move it again", MarketRole.ADMIN, "move it again")


@pytest.mark.parametrize("action", list(Actions.ACTIONS.values()), ids=lambda a: a.id)
class TestEachRow:
    def test_its_default_role_may(self, action, holding):
        holding(action.default)

        assert Actions.refusal(action, "u@x.test", client_market(), None) is None
        assert Actions.may(action, "u@x.test", client_market(), None)

    def test_every_role_above_its_default_may(self, action, holding):
        for role in LADDER[LADDER.index(action.default) + 1:]:
            holding(role)

            assert Actions.may(action, "u@x.test", client_market(), None), role

    def test_the_role_below_is_refused_with_the_rows_sentence(self, action, holding):
        holding(LADDER[LADDER.index(action.default) - 1])

        refused = Actions.refusal(action, "u@x.test", client_market(), None)

        assert refused == Actions.refusal_sentence(action)
        assert not Actions.may(action, "u@x.test", client_market(), None)

    def test_its_sentence_names_who_may(self, action):
        sentence = Actions.refusal_sentence(action)

        assert sentence.startswith("Only ") and sentence.endswith(".")
        assert {
            MarketRole.VIEWER: "someone who holds a role",
            MarketRole.EDITOR: "an Editor, an Admin or the owner",
            MarketRole.ADMIN: "an Admin or the owner",
            MarketRole.OWNER: "the market's owner",
        }[action.default] in sentence


class TestARefusalIsASentence:
    def test_a_load_refused_says_the_rows_sentence(self, holding, monkeypatch):
        holding(MarketRole.VIEWER)
        monkeypatch.setattr(
            MarketsApi, "markets_collection",
            SimpleNamespace(find_one=lambda *_a, **_k: {"id": "market-123"}))
        monkeypatch.setattr(MarketsApi, "market_from_document", lambda _doc: client_market())

        with pytest.raises(ForbiddenError) as refused:
            MarketsApi._load_market_for("market-123", "u@x.test", Actions.CHANGE_SETUP)

        assert str(refused.value) == (
            "Only an Editor, an Admin or the owner may change this market's setup."
        )


#: Each write and read that loads its market through the loaders, and the row it asks.
EACH_LOAD_ASKS = [
    (lambda: MarketsApi.rename_market("market-123", "Spring Market", "u@x.test"),
     Actions.CHANGE_SETUP),
    (lambda: MarketsApi.save_plan("market-123", {"setupObject": {}}, "u@x.test"),
     Actions.CHANGE_SETUP),
    (lambda: MarketsApi.save_application_form("market-123", {}, "u@x.test"), Actions.CHANGE_FORM),
    (lambda: MarketsApi.save_review_highlights("market-123", [], "u@x.test"), Actions.CHANGE_FORM),
    (lambda: MarketsApi.save_rejection_rules("market-123", [], "u@x.test"), Actions.CHANGE_FORM),
    (lambda: MarketsApi.get_application_form("market-123", "u@x.test"), Actions.READ),
    (lambda: MarketsApi.get_vendor_notes("market-123", "u@x.test"), Actions.READ),
    (lambda: MarketsApi.save_vendor_note("market-123", "v@x.test", "Chair given", "u@x.test"),
     Actions.WRITE_VENDOR_NOTES),
    (lambda: MarketsApi.mark_vendor_request_handled("market-123", "v@x.test", True, "u@x.test"),
     Actions.WRITE_VENDOR_NOTES),
    (lambda: PlacementsApi.run_assignment("market-123", "u@x.test"), Actions.ASSIGN),
    (lambda: PlacementsApi.write_placement("market-123", {}, "u@x.test"), Actions.ASSIGN),
    (lambda: PlacementsApi.remove_placement("market-123", "v@x.test", "2026-11-18", "u@x.test"),
     Actions.ASSIGN),
    (lambda: PlacementsApi.swap_placements(
        "market-123", "2026-11-18", "v@x.test", "w@x.test", "u@x.test"), Actions.ASSIGN),
    (lambda: DoorApi.check_in("market-123", "v@x.test", "2026-11-18", "u@x.test"),
     Actions.CHECK_IN),
    (lambda: DoorApi.undo_check_in("market-123", "v@x.test", "2026-11-18", "u@x.test"),
     Actions.CHECK_IN),
    (lambda: AddedVendorsApi.add_vendor(
        "market-123", {}, MarketPerson(user_id="u", email="u@x.test")), Actions.ADD_VENDOR),
    (lambda: VendorExportApi.preview("market-123", {}, "u@x.test"), Actions.EXPORT_CSV),
    (lambda: VendorExportApi.export("market-123", {}, "u@x.test"), Actions.EXPORT_CSV),
    (lambda: DiscordConnectionApi.start("market-123", "u@x.test"), Actions.CONNECT_DISCORD),
    (lambda: DiscordConnectionApi.connect("market-123", "c", "s", "u@x.test"),
     Actions.CONNECT_DISCORD),
    (lambda: DiscordConnectionApi.disconnect("market-123", "u@x.test"), Actions.CONNECT_DISCORD),
    (lambda: DiscordConnectionApi.save("market-123", {}, "u@x.test"), Actions.CONNECT_DISCORD),
    (lambda: DiscordConnectionApi.roles("market-123", "u@x.test"), Actions.CONNECT_DISCORD),
    (lambda: DiscordConnectionApi.check("market-123", "u@x.test"), Actions.CONNECT_DISCORD),
]


@pytest.mark.parametrize("call,row", EACH_LOAD_ASKS, ids=lambda x: getattr(x, "id", ""))
def test_each_load_asks_its_row_and_refuses_in_its_words(call, row, monkeypatch):
    asked = []

    def refuse(action, *_a):
        asked.append(action)
        return Actions.refusal_sentence(action)

    monkeypatch.setattr(Actions, "refusal", refuse)
    monkeypatch.setattr(
        MarketsApi, "markets_collection",
        SimpleNamespace(find_one=lambda *_a, **_k: stored_market(MarketPhase.APPLICATIONS)))
    monkeypatch.setattr(MarketsApi, "_load_organization", lambda _org_id: None)

    with pytest.raises(ForbiddenError) as refused:
        call()

    assert asked == [row]
    assert str(refused.value) == Actions.refusal_sentence(row)


def test_stopping_applications_asks_its_row(monkeypatch):
    """The route asks the table's Stop taking applications row, and refuses in its words."""
    import app as app_module
    import api.users as UsersApi
    from conftest import sessions_load_through_get_user

    asked = []
    monkeypatch.setattr(
        Actions, "refusal",
        lambda action, *_a: asked.append(action) or Actions.refusal_sentence(action))
    monkeypatch.setattr(MarketsApi, "load_market_context", lambda _id: SimpleNamespace(
        market=client_market(), document={}, organization=None, organization_dict=None))
    monkeypatch.setattr(app_module.login_manager, "session_protection", None)
    sessions_load_through_get_user(monkeypatch)
    monkeypatch.setattr(UsersApi, "get_user", lambda email: SimpleNamespace(
        id="u", email=email, is_active=True, is_authenticated=True, is_anonymous=False,
        get_id=lambda e=email: e))
    client = app_module.app.test_client()
    with client.session_transaction() as session:
        session["_user_id"] = "u@x.test"
        session["_fresh"] = True

    response = client.post("/markets/market-123/applications-stopped", json={"stopped": True})

    assert response.status_code == 403
    assert response.get_json() == {"error": Actions.refusal_sentence(Actions.STOP_APPLICATIONS)}
    assert asked == [Actions.STOP_APPLICATIONS]


def test_the_market_read_asks_the_read_row(monkeypatch):
    """A person the Read row refuses is served no market at all, as if it were not there."""
    asked = []
    monkeypatch.setattr(MarketsApi.PermissionsApi, "get_user_market_role", lambda *_a, **_k: None)
    monkeypatch.setattr(
        Actions, "role_refusal", lambda action, *_asked: asked.append(action) or "No.")
    monkeypatch.setattr(MarketsApi, "load_market_context", lambda _id: SimpleNamespace(
        market=client_market(), document={}, organization=None, organization_dict=None))

    assert MarketsApi.get_market_for_user("u@x.test", "market-123") is None
    assert asked == [Actions.READ]


class TestThePlanWrite:
    """The assignment rules ride in the plan, and are the Assignment row's: a plan write asks
    Market Setup, and Assignment too when it changes them."""

    @pytest.fixture
    def asked(self, monkeypatch):
        rows = []
        stored = stored_market(MarketPhase.DRAFT, setupObject=COMPLETE_PLAN)
        monkeypatch.setattr(MarketsApi, "_load_market_to_change", lambda *_a: (
            MarketsApi.market_from_document(stored)))
        monkeypatch.setattr(MarketsApi, "_load_organization", lambda _org_id: None)
        monkeypatch.setattr(
            MarketsApi, "markets_collection", SimpleNamespace(update_one=lambda *_a, **_k: None))
        monkeypatch.setattr(Actions, "refusal", lambda action, *_a: rows.append(action))
        return stored, rows

    def test_restating_the_rules_does_not_ask_the_assignment_row(self, asked):
        stored, rows = asked

        MarketsApi.save_plan("market-123", {"setupObject": stored["setupObject"]}, "u@x.test")

        assert rows == []

    def test_changing_the_rules_asks_the_assignment_row(self, asked):
        stored, rows = asked
        plan = {**stored["setupObject"], "assignmentOptions": {
            "maxAssignmentsPerVendor": 1, "maxHalfTableProportionPerSection": None}}

        MarketsApi.save_plan("market-123", {"setupObject": plan}, "u@x.test")

        assert rows == [Actions.ASSIGN]


#: Dev's rule for giving and taking roles, before the table (``can_manage_roles``): the owner gives
#: and takes every role, an Admin only Editor and Viewer ones, and nobody else any.
def _managed_before_the_table(requester, *roles):
    if requester is MarketRole.OWNER:
        return True
    return requester is MarketRole.ADMIN and all(
        role in (MarketRole.EDITOR, MarketRole.VIEWER) for role in roles)


#: The roles Manage market gives, takes and changes; the one Owner is never one of them.
_GIVEN = [MarketRole.ADMIN, MarketRole.EDITOR, MarketRole.VIEWER]


class TestRolesAskTheirRows:
    """Giving, taking and changing a role asks ``roles_row`` of each role involved, and answers
    every requester as ``can_manage_roles`` did before the table, the yes cases as the no."""

    @pytest.fixture
    def market_holding(self, monkeypatch, holding):
        """A market whose person ``target`` holds ``target_role``, asked by one holding ``asker``.
        Returns the roles as the last write left them, and the rows asked."""
        def make(asker, target_role=None):
            holding(asker)
            roles = {"user-1": "owner"}
            if target_role is not None:
                roles["target"] = target_role.value
            doc = stored_market(MarketPhase.APPLICATIONS, roles=roles)
            monkeypatch.setattr(MarketsApi, "load_market_context", lambda _id: (
                MarketsApi.MarketContext(doc, MarketsApi.market_from_document(doc), None, None)))
            monkeypatch.setattr(MarketsApi, "markets_collection", SimpleNamespace(
                update_one=lambda _q, update: doc.update(roles=update["$set"]["roles"])
                or SimpleNamespace(modified_count=1)))
            monkeypatch.setattr(MarketsApi.UsersApi, "get_user", lambda email: SimpleNamespace(
                id=email, email=email))
            asked = []
            refusal = Actions.refusal
            monkeypatch.setattr(Actions, "refusal", lambda row, *a: asked.append(row) or refusal(
                row, *a))
            return (lambda: dict(doc["roles"])), asked
        return make

    @pytest.mark.parametrize("asker", LADDER, ids=str)
    @pytest.mark.parametrize("role", _GIVEN, ids=str)
    def test_adding(self, market_holding, asker, role):
        roles, asked = market_holding(asker)

        if _managed_before_the_table(asker, role):
            MarketsApi.add_market_role("market-123", "target", role, "u@x.test")
            assert roles()["target"] == role.value
        else:
            with pytest.raises(ForbiddenError):
                MarketsApi.add_market_role("market-123", "target", role, "u@x.test")
            assert "target" not in roles()
        assert asked == [Actions.roles_row(role)]

    @pytest.mark.parametrize("asker", LADDER, ids=str)
    @pytest.mark.parametrize("role", _GIVEN, ids=str)
    def test_removing(self, market_holding, asker, role):
        roles, asked = market_holding(asker, role)

        if _managed_before_the_table(asker, role):
            MarketsApi.remove_market_role("market-123", "target", "u@x.test")
            assert "target" not in roles()
        else:
            with pytest.raises(ForbiddenError):
                MarketsApi.remove_market_role("market-123", "target", "u@x.test")
            assert roles()["target"] == role.value
        assert asked == [Actions.roles_row(role)]

    @pytest.mark.parametrize("asker", LADDER, ids=str)
    @pytest.mark.parametrize("taken,given", [
        (taken, given) for taken in _GIVEN for given in _GIVEN if taken is not given
    ], ids=str)
    def test_changing(self, market_holding, asker, taken, given):
        roles, asked = market_holding(asker, taken)

        if _managed_before_the_table(asker, taken, given):
            MarketsApi.update_market_role("market-123", "target", given, "u@x.test")
            assert roles()["target"] == given.value
            assert asked == [Actions.roles_row(taken), Actions.roles_row(given)]
        else:
            with pytest.raises(ForbiddenError):
                MarketsApi.update_market_role("market-123", "target", given, "u@x.test")
            assert roles()["target"] == taken.value

    def test_the_rows_are_the_editors_and_viewers_and_the_admins(self):
        assert Actions.roles_row(MarketRole.EDITOR) is Actions.MANAGE_EDITORS_AND_VIEWERS
        assert Actions.roles_row(MarketRole.VIEWER) is Actions.MANAGE_EDITORS_AND_VIEWERS
        assert Actions.roles_row(MarketRole.ADMIN) is Actions.MANAGE_ADMINS
        assert Actions.roles_row(MarketRole.OWNER) is Actions.MANAGE_ADMINS


def _sources():
    """Every server source but the tests and the two modules that own roles."""
    owners = {BACK_END / "api" / "market_actions.py", BACK_END / "api" / "permissions.py"}
    for path in sorted(BACK_END.rglob("*.py")):
        relative = path.relative_to(BACK_END).parts
        if relative[0] in ("tests", "migrations") or path in owners or "__pycache__" in relative:
            continue
        yield path.relative_to(BACK_END).as_posix(), ast.parse(path.read_text(), filename=str(path))


#: What only the two role modules use: the old permission calls and the rank table.
_RANKING = ("user_has_permission", "can_manage_roles", "ROLE_RANK")

#: The resolvers of a person's role. Holding a role is how a check would compare one, so only the
#: role modules call them, and the functions below, which serve the role itself to the client:
#: each by its module and its name, so a function of the same name elsewhere is searched.
_RESOLVERS = ("get_user_market_role", "organization_market_role", "higher_role")
_SERVE_THE_ROLE = {("api/markets.py", "get_market_for_user"), ("api/markets.py", "_summary_role")}


def _named(node: ast.AST) -> str:
    """The name a reference uses, ``PermissionsApi.higher_role`` and ``higher_role`` alike."""
    if isinstance(node, ast.Attribute):
        return node.attr
    return getattr(node, "id", "")


def _role_thresholds(tree: ast.AST, module: str, function: str = ""):
    """Where a source could ask a role threshold itself: any use of the ranking, any use of a
    role resolver outside the functions that serve the role to the client, and any import of one
    by name, which an alias would hide from the rest (``import ROLE_RANK as R``).

    Searching for the resolvers rather than for comparisons catches every way of comparing what
    they return - inline, against a tuple, through an annotated name or an attribute."""
    for node in ast.iter_child_nodes(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            yield from _role_thresholds(node, module, node.name)
            continue
        if isinstance(node, ast.ImportFrom):
            for alias in node.names:
                if alias.name in _RANKING + _RESOLVERS:
                    yield node.lineno, f"imports {alias.name}"
            continue
        name = _named(node) if isinstance(node, (ast.Name, ast.Attribute)) else ""
        if name in _RANKING:
            yield node.lineno, name
        elif name in _RESOLVERS and (module, function) not in _SERVE_THE_ROLE:
            yield node.lineno, f"{name} in {function or 'the module'}"
        yield from _role_thresholds(node, module, function)


def test_no_check_outside_the_actions_module_names_a_role():
    """A check that names a role of its own is a rule the table cannot change."""
    found = [
        f"{module}:{line} {what}"
        for module, tree in _sources() for line, what in _role_thresholds(tree, module)
    ]

    assert found == []


def test_the_search_finds_a_check_that_names_a_role():
    """The search above is only as good as what it catches: each way a check could compare a role."""
    tree = ast.parse(
        "def inline(user, market):\n"
        "    return PermissionsApi.get_user_market_role(user, market) != MarketRole.OWNER\n"
        "def in_a_tuple(user, market):\n"
        "    role = get_user_market_role(user, market)\n"
        "    return role in (MarketRole.ADMIN, MarketRole.OWNER)\n"
        "def annotated(user, market):\n"
        "    role: MarketRole = PermissionsApi.get_user_market_role(user, market)\n"
        "    return role == MarketRole.OWNER\n"
        "def through_the_organization(user, org):\n"
        "    return PermissionsApi.higher_role(None, PermissionsApi.organization_market_role(\n"
        "        user, org.owner, org.admins, org.members)) == MarketRole.ADMIN\n"
        "class Asker:\n"
        "    def ask(self, user, market):\n"
        "        self.role = PermissionsApi.get_user_market_role(user, market)\n"
        "        return self.role is MarketRole.OWNER\n"
        "def write(user, market):\n"
        "    return PermissionsApi.user_has_permission(user, market, MarketRole.EDITOR)\n"
        "RANKS = ROLE_RANK\n"
        "def get_market_for_user(user, market):\n"
        "    return PermissionsApi.get_user_market_role(user, market).value\n"
        "from api.permissions import get_user_market_role as role_of, ROLE_RANK as R\n"
        "def aliased(user, market):\n"
        "    return R[role_of(user, market)] >= 2\n"
    )

    assert [what for _line, what in _role_thresholds(tree, "api/markets.py")] == [
        "get_user_market_role in inline",
        "get_user_market_role in in_a_tuple",
        "get_user_market_role in annotated",
        "higher_role in through_the_organization",
        "organization_market_role in through_the_organization",
        "get_user_market_role in ask",
        "user_has_permission",
        "ROLE_RANK",
        "imports get_user_market_role",
        "imports ROLE_RANK",
    ]


def test_a_function_named_as_one_that_serves_the_role_is_searched_in_another_module():
    tree = ast.parse(
        "def get_market_for_user(user, market):\n"
        "    return PermissionsApi.get_user_market_role(user, market) == MarketRole.OWNER\n"
    )

    assert [what for _line, what in _role_thresholds(tree, "api/door.py")] == [
        "get_user_market_role in get_market_for_user",
    ]
