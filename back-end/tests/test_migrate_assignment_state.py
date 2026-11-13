"""Every stored market is given its assignment state, so it reads as it did before T316.

T316 stores the assignment's state (``none``, ``pinned`` or ``run``) and requires a run to record
what it was made from. A market stored before that has neither: the migration gives it the state
the lifecycle's derivation rule reads off its rows, the legacy marker as ``madeFrom`` on an
allocation stored before runs recorded one, and ``publishedRevision`` on a published market, so
an old allocation reads as current and old published results as published, as they read now.
"""
import copy

import pytest

import assignment.lifecycle as Lifecycle
import guards
import market_write as MarketWrite
from assignment.lifecycle import LEGACY_MADE_FROM, Allocation
from conftest import FakeSlugMarketsCollection, stored_assignment, stored_market
from datatypes import MarketPhase
from market_documents import market_from_document
from migrate_assignment_state import migrate

MADE_FROM = {"rules": "r1", "plan": "p1", "applications": "a1", "review": "v1"}


def row(email="vendor@example.com", table="A1", hand_placed=False):
    return {
        "email": email, "date": "2026-11-18", "tableCode": table,
        "tableChoice": "Full Table", "section": "Gold", "tier": "Gold", "location": "Hall",
        "handPlaced": hand_placed,
    }


def assignment(state=None, rows=(), made_from=None, revision=None, published_revision=None):
    """An assignment object as an older release, or a rolled-back one, may have stored it: any
    combination, built by hand, since ``stored_assignment`` refuses a contradiction."""
    stored = {"vendorAssignments": list(rows), "assignmentDate": "", "assignmentStatistics": None}
    for key, value in (("state", state), ("madeFrom", made_from), ("revision", revision),
                       ("publishedRevision", published_revision)):
        if value is not None:
            stored[key] = value
    return stored


def market(market_id, assignment_object, phase=MarketPhase.ASSIGNMENT, **overrides):
    overrides.setdefault("name", f"Market {market_id}")
    return stored_market(phase, id=market_id, assignmentObject=assignment_object, **overrides)


class Database:
    """The markets the migration reads, in the one collection ``write_market`` writes."""

    def __init__(self, markets_collection):
        self.markets = markets_collection

    def __getitem__(self, name):
        assert name == "markets", name
        return self.markets


@pytest.fixture
def database(monkeypatch):
    def make(*docs, collection=FakeSlugMarketsCollection):
        markets = collection(list(docs))
        monkeypatch.setattr(MarketWrite, "markets_collection", markets)
        return Database(markets)
    return make


def stored(db, market_id):
    return next(doc for doc in db.markets.docs if doc["id"] == market_id)


def stored_object(db, market_id):
    return stored(db, market_id)["assignmentObject"]


# --- each derivation case ---------------------------------------------------------------------

def test_no_row_is_none(database):
    db = database(market("m1", assignment()))

    assert migrate(db) == 1

    assert stored_object(db, "m1")["state"] == "none"
    assert "madeFrom" not in stored_object(db, "m1")


def test_rows_all_assigned_by_hand_are_pins_only(database):
    db = database(market("m1", assignment(rows=[row(hand_placed=True)])))

    migrate(db)

    assert stored_object(db, "m1")["state"] == "pinned"
    assert "madeFrom" not in stored_object(db, "m1")


def test_an_allocation_stored_before_fingerprints_is_a_run_made_from_the_legacy_marker(database):
    db = database(market("m1", assignment(
        rows=[row(hand_placed=True), row("other@example.com", "A2")], revision=4)))

    migrate(db)

    assert stored_object(db, "m1")["state"] == "run"
    assert stored_object(db, "m1")["madeFrom"] == LEGACY_MADE_FROM


def test_a_run_that_recorded_what_it_was_made_from_keeps_it_as_stored(database):
    """Its groups are stored as the run spelled them, and the migration never rewrites them."""
    db = database(market("m1", assignment(rows=[row()], made_from=MADE_FROM, revision=2)))

    migrate(db)

    assert stored_object(db, "m1")["state"] == "run"
    assert stored_object(db, "m1")["madeFrom"] == MADE_FROM


def test_a_run_freed_down_to_no_row_is_still_a_run(database):
    db = database(market("m1", assignment(made_from=MADE_FROM, revision=3)))

    migrate(db)

    assert stored_object(db, "m1")["state"] == "run"


@pytest.mark.parametrize("rows, made_from, state", [
    ([], None, "none"),
    ([row(hand_placed=True)], None, "pinned"),
    ([row()], None, "run"),
    ([row()], MADE_FROM, "run"),
], ids=["none", "pinned", "legacy run", "run"])
def test_the_state_set_is_the_one_the_lifecycle_reads(database, rows, made_from, state):
    db = database(market("m1", assignment(rows=rows, made_from=made_from)))

    migrate(db)

    model = market_from_document(copy.deepcopy(stored(db, "m1"))).assignment_object
    assert Lifecycle.stored_state_agrees(model)
    assert Lifecycle.derived_state(model).state.value == state == stored_object(db, "m1")["state"]


def test_a_migrated_legacy_allocation_reads_as_current(database, monkeypatch):
    """As it reads now: the legacy marker holds no group, so nothing reads as changed since it."""
    db = database(market("m1", assignment(rows=[row()])))
    migrate(db)

    import assignment.made_from as MadeFrom
    monkeypatch.setattr(MadeFrom, "approved_solver_vendors", lambda *_args: ([], []))
    migrated = market_from_document(copy.deepcopy(stored(db, "m1")))

    assert Lifecycle.allocation(migrated) is Allocation.CURRENT


# --- the published revision -------------------------------------------------------------------

def test_published_results_record_the_revision_they_stand_on(database):
    db = database(market("m1", assignment(rows=[row()], revision=5), resultsPublished=True))

    migrate(db)

    assert stored_object(db, "m1")["publishedRevision"] == 5
    assert stored_object(db, "m1")["revision"] == 5
    assert Lifecycle.allocation(market_from_document(copy.deepcopy(stored(db, "m1")))) is (
        Allocation.PUBLISHED)


def test_published_results_on_an_assignment_with_no_revision_stand_on_0(database):
    db = database(market("m1", assignment(rows=[row()]), resultsPublished=True))

    migrate(db)

    assert stored_object(db, "m1")["publishedRevision"] == 0
    assert Lifecycle.allocation(market_from_document(copy.deepcopy(stored(db, "m1")))) is (
        Allocation.PUBLISHED)


def test_a_recorded_published_revision_is_left(database):
    """A market published by this release and changed by hand since stays changed."""
    db = database(market("m1", stored_assignment(
        "run", rows=[row()], made_from=MADE_FROM, revision=7, published_revision=6),
        resultsPublished=True))
    before = copy.deepcopy(db.markets.docs)

    assert migrate(db) == 0

    assert db.markets.docs == before


#: The ``market_days`` entry invariants about the allocation; ``no_orphaned_pin`` is the plan's.
ASSIGNMENT_INVARIANTS = {"assignment_computed", "assignment_after_review", "results_published"}


def invariants(document):
    """Each ``market_days`` assignment invariant's verdict on the market as stored."""
    model = market_from_document(copy.deepcopy(document))
    return {guard.id: guard.evaluate(model, None).passed
            for guard in guards.PHASE_ENTRY_INVARIANTS["market_days"]
            if guard.id in ASSIGNMENT_INVARIANTS}


def test_a_running_market_published_on_hand_assignments_alone_reads_as_it_did(database):
    """A market that went live on tables assigned by hand alone before T316, the state T277
    reproduced: it stores pins only and the revision its results stood on, reads as published,
    its rows untouched, and every assignment invariant of its market days still passes."""
    rows = [row(hand_placed=True), row("other@example.com", "A2", hand_placed=True)]
    db = database(market("m1", assignment(rows=rows, revision=3), phase=MarketPhase.MARKET_DAYS,
                         resultsPublished=True))
    before = invariants(stored(db, "m1"))

    assert migrate(db) == 1

    assert stored_object(db, "m1")["state"] == "pinned"
    assert "madeFrom" not in stored_object(db, "m1")
    assert stored_object(db, "m1")["publishedRevision"] == 3
    assert stored_object(db, "m1")["vendorAssignments"] == rows
    assert stored(db, "m1")["phase"] == "market_days"
    assert Lifecycle.allocation(market_from_document(copy.deepcopy(stored(db, "m1")))) is (
        Allocation.PUBLISHED)
    assert set(before) == ASSIGNMENT_INVARIANTS
    assert invariants(stored(db, "m1")) == before == dict.fromkeys(ASSIGNMENT_INVARIANTS, True)


def test_an_archived_market_is_migrated_like_any_other(database):
    """An archived market is live (not being deleted), so it is migrated: the write holds only
    what the judgment read, so the archived phase refuses nothing, and it reads as published."""
    rows = [row(), row("other@example.com", "A2", hand_placed=True)]
    db = database(market("m1", assignment(rows=rows, revision=2), phase=MarketPhase.ARCHIVED,
                         resultsPublished=True))

    assert migrate(db) == 1

    assert stored_object(db, "m1")["state"] == "run"
    assert stored_object(db, "m1")["madeFrom"] == LEGACY_MADE_FROM
    assert stored_object(db, "m1")["publishedRevision"] == 2
    assert stored_object(db, "m1")["vendorAssignments"] == rows
    assert stored(db, "m1")["phase"] == "archived"
    assert Lifecycle.allocation(market_from_document(copy.deepcopy(stored(db, "m1")))) is (
        Allocation.PUBLISHED)
    assert migrate(db) == 0


def test_an_unpublished_market_gains_no_published_revision(database):
    db = database(market("m1", assignment(rows=[row()], revision=5), resultsPublished=False))

    migrate(db)

    assert "publishedRevision" not in stored_object(db, "m1")


# --- a stored state that disagrees ------------------------------------------------------------

@pytest.mark.parametrize("stored_state, rows, made_from, state, legacy", [
    ("none", [row(hand_placed=True)], None, "pinned", False),
    ("none", [row()], None, "run", True),
    ("none", [], MADE_FROM, "run", False),
    ("pinned", [], None, "none", False),
    ("pinned", [row(hand_placed=True)], MADE_FROM, "run", False),
    ("run", [], None, "none", False),
    ("run", [row(hand_placed=True)], None, "pinned", False),
    ("run", [row()], None, "run", True),
    ("a-later-state", [row(hand_placed=True)], None, "pinned", False),
], ids=["none-pins", "none-legacy-run", "none-run", "pinned-empty", "pinned-run",
        "run-empty", "run-pins", "run-no-made-from", "unknown"])
def test_a_disagreeing_state_is_repaired(database, stored_state, rows, made_from, state, legacy):
    """What a rolled-back release's write leaves, which the read already reads by the rows."""
    db = database(market("m1", assignment(stored_state, rows, made_from, revision=2)))

    assert migrate(db) == 1

    assert stored_object(db, "m1")["state"] == state
    assert stored_object(db, "m1").get("madeFrom") == (
        LEGACY_MADE_FROM if legacy else made_from)


@pytest.mark.parametrize("assignment_object", [
    stored_assignment("none"),
    stored_assignment("pinned", rows=[row(hand_placed=True)]),
    stored_assignment("run", rows=[row()], made_from=MADE_FROM),
    stored_assignment("run", made_from=MADE_FROM),
    # Agrees as the read judges it, so the read trusts it and the migration leaves it.
    assignment("pinned", rows=[row(hand_placed=True), row("other@example.com", "A2")]),
], ids=["none", "pinned", "run", "run-freed", "pinned-with-an-unflagged-row"])
def test_an_agreeing_state_is_left(database, assignment_object):
    db = database(market("m1", assignment_object))
    before = copy.deepcopy(db.markets.docs)

    assert migrate(db) == 0

    assert db.markets.docs == before


# --- what it leaves, and how it writes --------------------------------------------------------

def test_a_market_being_deleted_is_left(database):
    deleting = {"at": "2026-11-13T00:00:00+00:00", "by": "user-1", "trail_id": "trail-1"}
    db = database(market("m1", assignment(rows=[row()]), resultsPublished=True,
                         deleting=deleting))
    before = copy.deepcopy(db.markets.docs)

    assert migrate(db) == 0

    assert db.markets.docs == before


def test_only_the_assignment_state_and_its_markers_are_written(database):
    """The revision is held, not counted: the rows are what they were, and a published market's
    revision stays the one its results stood on."""
    db = database(market("m1", assignment(rows=[row()], revision=5), resultsPublished=True))
    before = copy.deepcopy(stored(db, "m1"))

    migrate(db)

    after = copy.deepcopy(stored(db, "m1"))
    for key in ("state", "madeFrom", "publishedRevision"):
        after["assignmentObject"].pop(key)
    assert after == before


def test_a_dry_run_writes_nothing_and_counts_what_it_would_set(database, capsys):
    db = database(market("m1", assignment(rows=[row()])),
                  market("m2", assignment(rows=[row(hand_placed=True)]), resultsPublished=True),
                  market("m3", stored_assignment("none")))
    before = copy.deepcopy(db.markets.docs)

    assert migrate(db, dry_run=True) == 2

    assert db.markets.docs == before
    assert "would set 2 market(s)" in capsys.readouterr().out


def test_running_it_again_changes_nothing(database):
    db = database(market("m1", assignment(rows=[row()])),
                  market("m2", assignment(rows=[row(hand_placed=True)], revision=1),
                         resultsPublished=True),
                  market("m3", assignment("run", rows=[row(hand_placed=True)])),
                  market("m4", assignment()))

    assert migrate(db) == 4
    after_first = copy.deepcopy(db.markets.docs)

    assert migrate(db) == 0
    assert db.markets.docs == after_first


def test_it_prints_each_market_by_id_and_what_it_sets_never_a_name_or_an_address(
        database, capsys):
    db = database(market("m1", assignment(rows=[row("ana@example.com")]), resultsPublished=True,
                         name="Ana's Night Market"),
                  market("m2", assignment(rows=[row("bo@example.com", hand_placed=True)])))

    migrate(db)

    out = capsys.readouterr().out
    assert "market m1: state run, madeFrom legacy, publishedRevision 0" in out
    assert "market m2: state pinned" in out
    assert "set 2 market(s)" in out
    for private in ("Ana", "Night", "Market m", "@example.com"):
        assert private not in out


# --- a market changed while the migration judged it -------------------------------------------

class ChangedUnderTheMigration(FakeSlugMarketsCollection):
    """Markets where, ``changes`` times, a hand placement lands between the migration's read and
    its write: the rows are written and the revision counted, as the lifecycle's ``store`` does."""

    def __init__(self, docs, changes):
        super().__init__(docs)
        self.changes = changes

    def find_one_and_update(self, query, update, projection=None, return_document=False):
        if self.changes:
            self.changes -= 1
            doc = self.docs[0]
            doc["assignmentObject"]["vendorAssignments"].append(
                row(f"walk-in-{self.changes}@example.com", f"B{self.changes}", hand_placed=True))
            doc["assignmentObject"]["state"] = "pinned"
            doc["assignmentObject"]["revision"] = doc["assignmentObject"].get("revision", 0) + 1
        return super().find_one_and_update(query, update, projection, return_document)


def test_a_market_changed_meanwhile_is_judged_again(database):
    """Judged on a market with no row, then a pin lands: it is read again, and found pinned, as the
    pin's own write stored it, so nothing is written over it."""
    db = database(market("m1", assignment(revision=1)),
                  collection=lambda docs: ChangedUnderTheMigration(docs, changes=1))

    assert migrate(db) == 0

    assert stored_object(db, "m1")["state"] == "pinned"
    assert stored_object(db, "m1")["revision"] == 2
    assert len(stored_object(db, "m1")["vendorAssignments"]) == 1


def test_a_market_changed_meanwhile_is_judged_again_and_set(database):
    """Judged needing a published revision, then a pin lands: read again, it still needs one, and
    it is set to the revision the pin left."""
    db = database(market("m1", assignment(revision=1), resultsPublished=True),
                  collection=lambda docs: ChangedUnderTheMigration(docs, changes=1))

    assert migrate(db) == 1

    assert stored_object(db, "m1")["publishedRevision"] == 2


def test_a_market_changed_on_every_try_is_skipped_and_listed(database, capsys):
    db = database(market("m1", assignment(revision=1), resultsPublished=True),
                  market("m2", assignment(rows=[row()])),
                  collection=lambda docs: ChangedUnderTheMigration(docs, changes=3))

    assert migrate(db) == 1

    assert "publishedRevision" not in stored_object(db, "m1")
    assert stored_object(db, "m2")["state"] == "run"
    out = capsys.readouterr().out
    assert "skipped 1 market(s) that changed on every try: m1" in out


def test_it_refuses_a_database_its_writes_would_not_reach(database):
    """``write_market`` writes the configured database's markets: reading another's would judge
    one set of markets and write another."""
    database(market("m1", assignment()))

    with pytest.raises(RuntimeError, match="write_market"):
        migrate(Database(FakeSlugMarketsCollection([market("m1", assignment())])))


def test_a_market_whose_assignment_does_not_parse_is_left_and_listed(database, capsys):
    """The app cannot read it either; the rest are still set."""
    broken = row()
    del broken["email"]
    db = database(market("m1", assignment(rows=[broken])), market("m2", assignment()))
    before = copy.deepcopy(stored(db, "m1"))

    assert migrate(db) == 1

    assert stored(db, "m1") == before
    assert stored_object(db, "m2")["state"] == "none"
    assert "left 1 market(s) whose assignment is unreadable: m1." in capsys.readouterr().out
