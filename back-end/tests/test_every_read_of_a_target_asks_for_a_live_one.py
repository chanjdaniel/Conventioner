"""Every read and write of a market or an organization asks for a live one, or says why not.

A market or an organization being deleted carries a tombstone (``tombstone``), and reads as absent
while it does: a request that found it would serve, or write to, something already half gone. So
each call with a filter on the markets or the organizations collection passes its filter through
``tombstone.live``: written as ``live(...)`` in the call, or as a name the same function assigned
from ``live(...)``. This walks every ``.py`` file under ``back-end/`` but ``tests/`` by AST, as the
market write's guard does (``test_every_market_write_holds_what_it_read``), and finds each such
call on a receiver it can name as either collection. Each must ask for a live target or be in
``EXCEPTIONS``, keyed by module and function, with its reason: the deletions themselves, which
read their target whatever its state, and the reads that must still see one being deleted.

A receiver the walk cannot name (``collection`` in ``market_by_slug``, a variable naming the
collection in an operator script) is not judged, since most such calls are on other collections;
``market_by_slug`` asks for a live market all the same.
"""
import ast
import re
from pathlib import Path
from typing import Dict, Iterator, List, NamedTuple, Optional, Set, Tuple

import conftest
from test_every_market_write_holds_what_it_read import _module, _named, _to_markets, _walked

BACK_END_DIR = Path(conftest.BACK_END_DIR)

#: Every collection method whose first argument is a filter.
FILTERED_METHODS = frozenset({
    "find", "find_one", "count_documents", "update_one", "update_many", "find_one_and_update",
    "find_one_and_replace", "replace_one", "delete_one", "delete_many",
})

_A_MIGRATION = "a one-time migration an operator runs outside any request, over every document"
_THE_DELETION = "the deletion reads and writes its target whatever its state, to resume from it"

#: Each call that need not ask for a live target, by (module, function), and why.
EXCEPTIONS: Dict[Tuple[str, str], str] = {
    ("market_deletion", "mark_deleting"): _THE_DELETION,
    ("market_deletion", "delete_market_and_records"): _THE_DELETION,
    ("market_deletion", "deletion_decided"): (
        "a write beside a market asks whether the market's deletion is decided, which only a read "
        "of its tombstone, and of its organization's, answers"),
    ("market_deletion", "_organization"): (
        "a write beside a market, or a market's own Delete, asks whether its organization's "
        "deletion is decided, which only a read of a tombstoned organization answers"),
    ("api.markets", "delete_market"): _THE_DELETION,
    ("api.markets", "_organization_is_deleting"): (
        "the market's own Delete asks whether its organization's deletion owns the market, which "
        "only a read of a tombstoned organization answers"),
    ("api.organizations", "delete_organization"): _THE_DELETION,
    ("api.organizations", "_mark_deleting"): _THE_DELETION,
    ("api.organizations", "_take_its_markets"): _THE_DELETION,
    ("api.organizations", "_taken"): _THE_DELETION,
    ("market_write", "write_market"): (
        "the refused write reads the market again whatever its state, to answer a market being "
        "deleted as absent and any other as changed"),
    ("api.markets", "create_market"): (
        "a creation that met its organization being deleted takes its own new market back by id"),
    ("api.markets", "public_address_refusal"): (
        "a market being deleted still holds its public address in the unique slug index until "
        "it is gone, so a new market may not take it yet"),
    ("api.organizations", "create_organization"): (
        "an organization being deleted still holds its name until it is gone"),
    ("market_documents", "apply_market_key_migration"): _A_MIGRATION,
    ("market_documents", "ensure_market_slug_index"): (
        "the boot builds the slug index over every market, whatever its state, before anything "
        "is served"),
    ("market_documents", "pending_market_key_rewrites"): (
        "the boot check reads every market, whatever its state, before anything is served"),
    ("review_team", "_let_go"): (
        "a deal lets go of its own lease whatever state the market is in, so none is left held"),
    ("api.users", "delete_user"): (
        "an account owning a market or an organization being deleted keeps it, so the owner the "
        "deletion's retry asks for still exists"),
    ("organization_people", "forget"): (
        "a deleted account leaves every organization, one being deleted too, so none names it"),
    ("seed_test_markets", "_test_organization"): (
        "the operator's seeder of a local database, run outside any request"),
    ("seed_test_markets", "_seeded_market"): (
        "the operator's seeder of a local database, run outside any request"),
    ("migrations.migrate_layouts", "migrate"): _A_MIGRATION,
    ("migrations.migrate_market_keys", "migrate"): _A_MIGRATION,
    ("migrations.migrate_organization_people", "_reconcile"): _A_MIGRATION,
    ("migrations.migrate_organization_people", "migrate"): _A_MIGRATION,
    ("migrations.migrate_publishing_to_market_days", "migrate"): _A_MIGRATION,
    ("migrations.migrate_roles", "migrate_market_roles"): _A_MIGRATION,
    ("migrations.migrate_roles", "migrate_organization_structure"): _A_MIGRATION,
    ("migrations.migrate_to_one_stage", "migrate"): _A_MIGRATION,
    ("migrations.migrate_to_uuid", "migrate_to_uuid"): _A_MIGRATION,
}

_A_TICKET = re.compile(r"\bticket\b", re.IGNORECASE)


class Site(NamedTuple):
    """One filtered call on the markets or organizations collection, and whether it asks for a
    live target."""
    path: Path
    line: int
    module: str
    function: str
    method: str
    collection: str
    asks_live: bool


def _to_organizations(receiver: ast.expr) -> bool:
    name = _named(receiver)
    if name is not None:
        return name.endswith("organizations_collection") or name.endswith("organizations")
    if isinstance(receiver, ast.Subscript):
        key = receiver.slice
        return isinstance(key, ast.Constant) and key.value == "organizations"
    return False


def _is_live_call(node: Optional[ast.expr]) -> bool:
    return (isinstance(node, ast.Call) and _named(node.func) == "live")


def sites(root: Path) -> Iterator[Site]:
    """Every filtered call on either collection in the back end's own ``.py`` files."""
    for path in sorted(root.rglob("*.py")):
        if not _walked(path.relative_to(root).parts):
            continue
        yield from _Walk(path, _module(path, root)).sites(ast.parse(path.read_text(), str(path)))


class _Walk(ast.NodeVisitor):
    def __init__(self, path: Path, module: str):
        self.path, self.module = path, module
        self.scope: List[str] = []
        self.live_names: List[Set[str]] = [set()]
        self.found: List[Site] = []

    def sites(self, tree: ast.AST) -> List[Site]:
        self.visit(tree)
        return self.found

    def _scoped(self, node):
        self.scope.append(node.name)
        self.live_names.append({
            target.id
            for child in ast.walk(node)
            if isinstance(child, (ast.Assign, ast.AnnAssign)) and _is_live_call(child.value)
            for target in (child.targets if isinstance(child, ast.Assign) else [child.target])
            if isinstance(target, ast.Name)
        })
        self.generic_visit(node)
        self.live_names.pop()
        self.scope.pop()

    visit_FunctionDef = visit_AsyncFunctionDef = visit_ClassDef = _scoped

    def visit_Call(self, node: ast.Call):
        func = node.func
        if isinstance(func, ast.Attribute) and func.attr in FILTERED_METHODS:
            collection = ("markets" if _to_markets(func.value)
                          else "organizations" if _to_organizations(func.value) else None)
            if collection is not None:
                query = node.args[0] if node.args else next(
                    (k.value for k in node.keywords if k.arg == "filter"), None)
                asks_live = _is_live_call(query) or (
                    isinstance(query, ast.Name) and query.id in self.live_names[-1])
                self.found.append(Site(self.path, node.lineno, self.module,
                                       ".".join(self.scope) or "<module>", func.attr,
                                       collection, asks_live))
        self.generic_visit(node)


def unexcused(root: Path, exceptions: Dict[Tuple[str, str], str]) -> List[str]:
    """Each call that asks for any target, live or not, outside the exceptions, by file and line."""
    return [
        f"{site.path.relative_to(root)}:{site.line}: {site.method} on the {site.collection} "
        f"collection in {site.function} does not ask for a live one; pass its filter through "
        "tombstone.live, or list the site with its reason"
        for site in sites(root)
        if not site.asks_live and (site.module, site.function) not in exceptions
    ]


def test_every_read_and_write_of_a_market_or_an_organization_asks_for_a_live_one():
    assert unexcused(BACK_END_DIR, EXCEPTIONS) == []


def test_every_exception_names_a_site_that_still_asks_for_any():
    """An exception whose call now asks for a live target, or went, leaves the list with it."""
    standing = {(site.module, site.function) for site in sites(BACK_END_DIR) if not site.asks_live}
    assert set(EXCEPTIONS) - standing == set()


def test_every_exception_is_permanent_and_says_why():
    assert [site for site, reason in EXCEPTIONS.items()
            if len(reason.split()) < 4 or _A_TICKET.search(reason)] == []


def test_the_walk_sees_the_live_reads():
    """It finds the loaders' own reads, so it would find one that forgot."""
    found = {(site.module, site.function) for site in sites(BACK_END_DIR) if site.asks_live}
    assert ("api.markets", "load_market_context") in found
    assert ("api.organizations", "get_organization") in found


class TestThePlantedRead:
    @staticmethod
    def _tree(tmp_path, source: str) -> Path:
        (tmp_path / "api").mkdir(exist_ok=True)
        (tmp_path / "api" / "planted.py").write_text(source)
        return tmp_path

    def test_a_read_that_forgot_fails_it_by_file_and_line(self, tmp_path):
        root = self._tree(tmp_path, (
            "def read(market_id):\n"
            "    return markets_collection.find_one({'id': market_id})\n"
            "def org(org_id):\n"
            "    return db['organizations'].update_one({'id': org_id}, {})\n"))

        assert unexcused(root, {}) == [
            "api/planted.py:2: find_one on the markets collection in read does not ask for a "
            "live one; pass its filter through tombstone.live, or list the site with its reason",
            "api/planted.py:4: update_one on the organizations collection in org does not ask "
            "for a live one; pass its filter through tombstone.live, or list the site with its "
            "reason"]

    def test_a_live_filter_in_the_call_or_by_a_name_passes(self, tmp_path):
        root = self._tree(tmp_path, (
            "def read(market_id):\n"
            "    markets_collection.find_one(live({'id': market_id}))\n"
            "    query = live({'id': market_id})\n"
            "    query['phase'] = 'draft'\n"
            "    return MarketsApi.markets_collection.find(query, {'id': 1})\n"))

        assert unexcused(root, {}) == []

    def test_a_name_assigned_in_another_function_does_not_pass(self, tmp_path):
        root = self._tree(tmp_path, (
            "def one(market_id):\n"
            "    query = live({'id': market_id})\n"
            "def two(query):\n"
            "    return markets_collection.find_one(query)\n"))

        assert len(unexcused(root, {})) == 1

    def test_another_collection_is_not_judged(self, tmp_path):
        root = self._tree(tmp_path, (
            "def read(market_id):\n"
            "    applications_collection.find({'market_id': market_id})\n"
            "    collection.find_one({'id': market_id})\n"))

        assert unexcused(root, {}) == []
