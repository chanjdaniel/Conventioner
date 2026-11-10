"""Every write to the markets collection goes through ``market_write.write_market``, or says why not.

A write judged on a market and made by id alone lands over whatever changed since the request
read it; ``write_market`` holds what the request read (ADR 0024). This walks every ``.py`` file
under ``back-end/`` but ``tests/`` by AST and finds each call of a write method whose receiver is
the markets collection: a name or attribute ending in ``markets_collection`` or ``markets``, or a
subscript of ``"markets"`` or ``MARKETS_COLLECTION``. Each must be in ``market_write.py`` or in
``EXCEPTIONS``, keyed by module and function, with its reason. A receiver the walk cannot name (a
call's result, a subscript of a variable) may be the markets collection too, so it must be listed
the same way, and fails naming its file and line until it is.

A site not yet moved onto the helper is listed as "moves in ticket NN"; each later ticket removes
its own, and ticket 14 removes the kind, leaving only the permanent exceptions.
"""
import ast
import re
from pathlib import Path
from typing import Dict, Iterator, List, NamedTuple, Optional, Tuple

import conftest

BACK_END_DIR = Path(conftest.BACK_END_DIR)

WRITE_METHODS = frozenset({
    "insert_one", "insert_many", "update_one", "update_many", "replace_one",
    "find_one_and_update", "find_one_and_replace", "delete_one", "delete_many", "bulk_write",
})

#: The one module whose writes to the markets collection need no reason.
HELPER = "market_write"

_PERMANENT = "permanent: "

#: Each write to the markets collection outside the helper, by (module, function), and why.
EXCEPTIONS: Dict[Tuple[str, str], str] = {
    ("api.markets", "create_market"): _PERMANENT + (
        "the market's creation, an insert: there is no market as read to hold, and the unique "
        "slug index settles two creations at one address"),
    ("market_deletion", "delete_market_and_records"): _PERMANENT + (
        "the market's deletion keeps no rule beyond the right to delete, and deletes the market "
        "and its records in its own order"),
    ("review_team", "_choose_holding"): _PERMANENT + (
        "the dealing lease (ADR 0020): a protocol of its own, each write held on the lease"),
    ("review_team", "_deal_arriving"): _PERMANENT + (
        "the dealing lease (ADR 0020): a protocol of its own, each write held on the lease"),
    ("review_team", "_hold"): _PERMANENT + (
        "the dealing lease (ADR 0020): a protocol of its own, each write held on the lease"),
    ("review_team", "_let_go"): _PERMANENT + (
        "the dealing lease (ADR 0020): a protocol of its own, each write held on the lease"),
    ("essential_fields", "freeze_essential_options"): _PERMANENT + (
        "the essential offering's freeze: the first writer wins, held by no snapshot stored yet"),
    ("market_documents", "apply_market_key_migration"): _PERMANENT + (
        "a migration, run by an operator before the app serves, rewriting every market whole"),
    ("migrations.migrate_publishing_to_market_days", "migrate"): _PERMANENT + "a migration",
    ("migrations.migrate_roles", "migrate_market_roles"): _PERMANENT + "a migration",
    ("migrations.migrate_to_one_stage", "migrate"): _PERMANENT + "a migration",
    ("migrations.migrate_to_uuid", "migrate_to_uuid"): _PERMANENT + "a migration",
    ("reset_database", "reset_database"): _PERMANENT + (
        "an operator script emptying every collection of a local database, which it names by a "
        "variable the walk cannot read"),
    ("discord_fake", "_give"): _PERMANENT + (
        "the fake Discord's own servers, not the markets collection; the walk cannot name a "
        "receiver made by a call"),
    # Not yet moved onto write_market.
    ("api.applicants", "set_applications_stopped"): "moves in ticket 08",
    ("api.applicants", "publish_results"): "moves in ticket 08",
    ("api.door", "make_door_code"): "moves in ticket 08",
    ("api.discord_connection", "_write_found"): "moves in ticket 08",
    ("api.discord_connection", "decline_match"): "moves in ticket 08",
    ("api.discord_connection", "_write"): "moves in ticket 08",
    ("csv_import", "save_mapping"): "moves in ticket 08",
    ("csv_start", "confirm"): "moves in ticket 08",
    ("api.markets", "set_permission"): "moves in ticket 08",
    ("api.markets", "reset_permission"): "moves in ticket 08",
    ("api.markets", "reset_permissions"): "moves in ticket 08",
    ("api.markets", "copy_organization_default"): "moves in ticket 08",
    ("api.markets", "add_market_role"): "moves in ticket 09",
    ("api.markets", "remove_market_role"): "moves in ticket 09",
    ("api.markets", "update_market_role"): "moves in ticket 09",
    ("api.placements", "_store_vendor_assignments"): "moves in ticket 10",
    ("api.markets", "apply_phase_transition"): "moves in ticket 10",
    ("api.markets", "write_application_form"): "moves in ticket 11",
    ("api.markets", "save_plan"): "moves in ticket 12",
    ("api.floorplans_save", "save_floorplan_to_market"): "moves in ticket 12",
}

_MOVES_IN = re.compile(r"moves in ticket (\d\d)")


class Site(NamedTuple):
    """One write call: where it is, and whether its receiver is the markets collection (None when
    the walk cannot tell)."""
    path: Path
    line: int
    module: str
    function: str
    method: str
    to_markets: Optional[bool]


def _named(node: ast.expr) -> Optional[str]:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return node.attr
    return None


def _to_markets(receiver: ast.expr) -> Optional[bool]:
    """Whether ``receiver`` is the markets collection, by its name; None when it has none."""
    name = _named(receiver)
    if name is not None:
        return name.endswith("markets_collection") or name.endswith("markets")
    if isinstance(receiver, ast.Subscript):
        key = receiver.slice
        if isinstance(key, ast.Constant) and isinstance(key.value, str):
            return key.value == "markets"
        key_name = _named(key)
        if key_name is not None and key_name.isupper():
            return key_name == "MARKETS_COLLECTION"
    return None


def _module(path: Path, root: Path) -> str:
    return ".".join(path.relative_to(root).with_suffix("").parts)


def _walked(relative: Tuple[str, ...]) -> bool:
    """A file of the back end's own: not a test's, and not under a hidden directory or in an
    installed package (a virtual environment kept under ``back-end/``)."""
    return (relative[0] != "tests" and "site-packages" not in relative
            and not any(part.startswith(".") or part == "__pycache__" for part in relative))


def write_sites(root: Path) -> Iterator[Site]:
    """Every call of a write method in the back end's own ``.py`` files under ``root``."""
    for path in sorted(root.rglob("*.py")):
        if not _walked(path.relative_to(root).parts):
            continue
        module = _module(path, root)
        yield from _Walk(path, module).sites(ast.parse(path.read_text(), str(path)))


class _Walk(ast.NodeVisitor):
    def __init__(self, path: Path, module: str):
        self.path, self.module = path, module
        self.scope: List[str] = []
        self.found: List[Site] = []

    def sites(self, tree: ast.AST) -> List[Site]:
        self.visit(tree)
        return self.found

    def _scoped(self, node):
        self.scope.append(node.name)
        self.generic_visit(node)
        self.scope.pop()

    visit_FunctionDef = visit_AsyncFunctionDef = visit_ClassDef = _scoped

    def visit_Call(self, node: ast.Call):
        func = node.func
        if isinstance(func, ast.Attribute) and func.attr in WRITE_METHODS:
            self.found.append(Site(self.path, node.lineno, self.module,
                                   ".".join(self.scope) or "<module>", func.attr,
                                   _to_markets(func.value)))
        self.generic_visit(node)


def unexcused(root: Path, exceptions: Dict[Tuple[str, str], str]) -> List[str]:
    """What fails the guard: each write to the markets collection, or to a receiver the walk cannot
    name, outside the helper and the exceptions, by file and line."""
    failures = []
    for site in write_sites(root):
        if site.to_markets is False or site.module == HELPER:
            continue
        if (site.module, site.function) in exceptions:
            continue
        where = f"{site.path.relative_to(root)}:{site.line}"
        if site.to_markets is None:
            failures.append(
                f"{where}: the walk cannot name the receiver of {site.method} in "
                f"{site.function}; name the collection, or list the site with its reason")
        else:
            failures.append(
                f"{where}: {site.method} on the markets collection in {site.function}, outside "
                "market_write.write_market; write through it, or list the site with its reason")
    return failures


def _excused_sites(root: Path) -> set:
    return {(site.module, site.function) for site in write_sites(root)
            if site.to_markets is not False and site.module != HELPER}


def test_every_write_to_the_markets_collection_holds_what_it_read_or_says_why_not():
    assert unexcused(BACK_END_DIR, EXCEPTIONS) == []


def test_every_exception_names_a_site_that_still_writes():
    """An exception whose write moved onto the helper, or went, leaves the list with it."""
    assert set(EXCEPTIONS) - _excused_sites(BACK_END_DIR) == set()


def test_every_exception_says_why_or_which_ticket_moves_it():
    for site, reason in EXCEPTIONS.items():
        if reason.startswith(_PERMANENT):
            assert len(reason) > len(_PERMANENT) + 10, site
            continue
        moves = _MOVES_IN.fullmatch(reason)
        assert moves and "08" <= moves.group(1) <= "12", (site, reason)


def test_the_helper_writes_the_markets_collection():
    """The walk sees the helper's own write, so it would see one written anywhere else."""
    assert any(site.module == HELPER and site.to_markets
               for site in write_sites(BACK_END_DIR))


class TestThePlantedWrite:
    @staticmethod
    def _tree(tmp_path, source: str, name: str = "planted.py") -> Path:
        (tmp_path / "api").mkdir(exist_ok=True)
        (tmp_path / "api" / name).write_text(source)
        (tmp_path / "tests").mkdir(exist_ok=True)
        (tmp_path / "tests" / "test_x.py").write_text(
            "def f():\n    markets_collection.update_one({}, {})\n")
        return tmp_path

    def test_a_write_outside_the_list_fails_it_by_file_and_line(self, tmp_path):
        root = self._tree(tmp_path, (
            "def rename(market_id, name):\n"
            "    markets_collection.update_one({'id': market_id}, {'$set': {'name': name}})\n"))

        assert unexcused(root, EXCEPTIONS) == [
            "api/planted.py:2: update_one on the markets collection in rename, outside "
            "market_write.write_market; write through it, or list the site with its reason"]

    def test_listing_it_lets_it_pass(self, tmp_path):
        root = self._tree(tmp_path, (
            "def rename(market_id, name):\n"
            "    markets_collection.update_one({'id': market_id}, {'$set': {'name': name}})\n"))

        assert unexcused(root, {("api.planted", "rename"): _PERMANENT + "a reason"}) == []

    def test_every_way_of_naming_the_markets_collection_is_found(self, tmp_path):
        root = self._tree(tmp_path, (
            "class Store:\n"
            "    def write(self):\n"
            "        MarketsApi.markets_collection.find_one_and_update({}, {})\n"
            "        markets.delete_many({})\n"
            "        db['markets'].insert_one({})\n"
            "        get_database()[MARKETS_COLLECTION].replace_one({}, {})\n"
            "        self.markets.bulk_write([])\n"))

        assert [failure.split(":")[1] for failure in unexcused(root, {})] == [
            "3", "4", "5", "6", "7"]
        assert all("in Store.write," in failure for failure in unexcused(root, {}))

    def test_a_write_to_another_collection_passes(self, tmp_path):
        root = self._tree(tmp_path, (
            "def apply():\n"
            "    applications_collection.update_one({}, {})\n"
            "    db['users'].insert_one({})\n"
            "    db[SCHEMA_COLLECTION].update_one({}, {})\n"))

        assert unexcused(root, {}) == []

    def test_a_receiver_it_cannot_name_fails_it_by_file_and_line(self, tmp_path):
        root = self._tree(tmp_path, (
            "def write(name):\n"
            "    _collection().update_one({}, {})\n"
            "    db[name].delete_many({})\n"))

        assert unexcused(root, {}) == [
            "api/planted.py:2: the walk cannot name the receiver of update_one in write; name "
            "the collection, or list the site with its reason",
            "api/planted.py:3: the walk cannot name the receiver of delete_many in write; name "
            "the collection, or list the site with its reason"]

    def test_a_virtual_environment_under_the_back_end_is_not_walked(self, tmp_path):
        root = self._tree(tmp_path, "")
        for package in (".venv/lib/python3.12/site-packages/pymongo", "venv/lib/site-packages/x"):
            (tmp_path / package).mkdir(parents=True)
            (tmp_path / package / "collection.py").write_text(
                "def update_one(self):\n    self.markets.update_one({}, {})\n")

        assert unexcused(root, {}) == []

    def test_the_tests_are_not_walked_and_the_helper_needs_no_reason(self, tmp_path):
        root = self._tree(tmp_path, "")
        (tmp_path / "market_write.py").write_text(
            "def write_market():\n    markets_collection.find_one_and_update({}, {})\n")

        assert unexcused(root, {}) == []
