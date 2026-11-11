"""Every write to the markets collection goes through ``market_write.write_market``, or says why not.

A write judged on a market and made by id alone lands over whatever changed since the request
read it; ``write_market`` holds what the request read (ADR 0024). This walks every ``.py`` file
under ``back-end/`` but ``tests/`` by AST and finds each call of a write method whose receiver is
the markets collection: a name or attribute ending in ``markets_collection`` or ``markets``, or a
subscript of ``"markets"`` or ``MARKETS_COLLECTION``. Each must be in ``market_write.py`` or in
``EXCEPTIONS``, keyed by module and function, with its reason. A receiver the walk cannot name (a
call's result, a subscript of a variable) may be the markets collection too, so it must be listed
the same way, and fails naming its file and line until it is.

Every exception is permanent: a write that keeps no rule of the market as read, or a lease or
script of its own. A write waiting to move onto the helper is no reason to stay outside it, so a
reason naming a ticket fails the list.
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

_A_MIGRATION = "a one-time migration an operator runs outside any request, so nothing was read to hold"

#: Each write to the markets collection outside the helper, by (module, function), and why.
EXCEPTIONS: Dict[Tuple[str, str], str] = {
    ("api.markets", "create_market"): (
        "the market's creation, an insert: there is no market as read to hold, and the unique "
        "slug index settles two creations at one address"),
    ("market_deletion", "delete_market_and_records"): (
        "the market's deletion keeps no rule beyond the right to delete, and deletes the market "
        "and its records in its own order"),
    ("review_team", "_write_holding"): (
        "the dealing lease (ADR 0020): a protocol of its own, each write held on the lease"),
    ("review_team", "_deal_arriving"): (
        "the dealing lease (ADR 0020): a protocol of its own, each write held on the lease"),
    ("review_team", "_hold"): (
        "the dealing lease (ADR 0020): a protocol of its own, each write held on the lease"),
    ("review_team", "_let_go"): (
        "the dealing lease (ADR 0020): a protocol of its own, each write held on the lease"),
    ("essential_fields", "freeze_essential_options"): (
        "the essential offering's freeze: the first writer wins, held by no snapshot stored yet"),
    ("market_documents", "apply_market_key_migration"): (
        "a one-time migration an operator runs outside any request, rewriting every market whole"),
    ("migrations.migrate_publishing_to_market_days", "migrate"): _A_MIGRATION,
    ("migrations.migrate_roles", "migrate_market_roles"): _A_MIGRATION,
    ("migrations.migrate_to_one_stage", "migrate"): _A_MIGRATION,
    ("migrations.migrate_to_uuid", "migrate_to_uuid"): _A_MIGRATION,
    ("reset_database", "reset_database"): (
        "an operator script emptying every collection of a local database, which it names by a "
        "variable the walk cannot read"),
}

#: A reason that names a ticket is a write waiting to move onto the helper, not a reason.
_A_TICKET = re.compile(r"\bticket\b", re.IGNORECASE)


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


def unexplained(exceptions: Dict[Tuple[str, str], str]) -> List[Tuple[str, str]]:
    """Each exception with no reason of its own: none, a word or two, or one naming a ticket."""
    return [site for site, reason in exceptions.items()
            if len(reason.split()) < 4 or _A_TICKET.search(reason)]


def test_every_exception_is_permanent_and_says_why():
    assert unexplained(EXCEPTIONS) == []


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

        assert unexcused(root, {("api.planted", "rename"): "a reason"}) == []

    def test_a_write_waiting_to_move_is_no_reason(self):
        assert unexplained({
            ("api.planted", "rename"): "moves in ticket 12",
            ("api.planted", "retitle"): "waits for TICKET 15 to move it onto the helper",
            ("api.planted", "reorder"): "",
            ("api.planted", "rewrite"): "a migration",
            ("api.planted", "restore"): "an operator script outside any request",
        }) == [("api.planted", "rename"), ("api.planted", "retitle"), ("api.planted", "reorder"),
               ("api.planted", "rewrite")]

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
