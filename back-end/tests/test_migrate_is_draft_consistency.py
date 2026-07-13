"""The isDraft/phase consistency migration may only touch markets that store a phase."""
import copy
from types import SimpleNamespace

from datatypes import MarketPhase, phase_from_market_document
from market_documents import non_draft_market_prefilter
from migrate_is_draft_consistency import migrate


def _matches(doc, query):
    """Evaluate a Mongo filter the way the server does.

    `$ne` and `$exists` are modelled exactly. Mongo matches `{"$ne": "draft"}` against a
    document with no such field at all, which is what made the unscoped query dangerous: a
    market written before `phase` existed looked like a market whose phase was not draft.
    """
    for key, condition in (query or {}).items():
        if key == "$nor":
            if any(_matches(doc, clause) for clause in condition):
                return False
            continue
        present = key in doc
        if isinstance(condition, dict):
            if "$exists" in condition and present != condition["$exists"]:
                return False
            if "$ne" in condition and doc.get(key) == condition["$ne"]:
                return False
            if "$in" in condition and doc.get(key) not in condition["$in"]:
                return False
        elif not present or doc[key] != condition:
            return False
    return True


class FakeCollection:
    def __init__(self, docs):
        self.docs = docs

    def find(self, query):
        return [copy.deepcopy(doc) for doc in self.docs if _matches(doc, query)]

    def update_many(self, query, update):
        modified = 0
        for doc in self.docs:
            if not _matches(doc, query):
                continue
            for key, value in update["$set"].items():
                if doc.get(key) != value or key not in doc:
                    doc[key] = value
                    modified += 1
        return SimpleNamespace(modified_count=modified)


class FakeDatabase:
    def __init__(self, docs):
        self.markets = FakeCollection(docs)


def only(db):
    return db.markets.docs[0]


def is_served_publicly(doc):
    """The exact rule ``api/attendance.get_published_market_by_slug`` applies to a stored doc.

    The prefilter prunes in Mongo, ``phase_from_market_document`` decides in Python. Asserting
    against the real pair is what makes the migration's result mean "the public check-in URL
    resolves" rather than "a field has the value we expected".
    """
    return (
        _matches(doc, non_draft_market_prefilter())
        and phase_from_market_document(doc) != MarketPhase.DRAFT
    )


def test_legacy_draft_without_phase_is_left_alone():
    """Regression: `{"phase": {"$ne": "draft"}}` also matches a document with no phase.

    A market written before the phase field existed carries only `isDraft: true`. Flipping it
    to false rewrites the only lifecycle state the document has -- `phase_from_market_document`
    would then read the market as `archived`, which has no transition out of it, so every legacy
    draft would be published and unrecoverable.
    """
    db = FakeDatabase([{"_id": 1, "id": "m1", "isDraft": True}])
    migrate(db)
    assert only(db) == {"_id": 1, "id": "m1", "isDraft": True}


def test_legacy_published_without_phase_is_left_alone():
    db = FakeDatabase([{"_id": 1, "id": "m1", "isDraft": False}])
    migrate(db)
    assert only(db) == {"_id": 1, "id": "m1", "isDraft": False}


def test_non_draft_phase_with_stale_is_draft_true_is_corrected():
    db = FakeDatabase([{"_id": 1, "id": "m1", "phase": "archived", "isDraft": True}])
    migrate(db)
    assert only(db)["isDraft"] is False


def test_market_published_by_the_old_build_stays_published():
    """`phase: draft` + `isDraft: false` is a PUBLISHED market, and must come out published.

    The old build published with `PUT isDraft: false`; `create_market` had already stamped
    `phase: draft` and `update_market` re-applied it, so the phase never moved and `isDraft` was
    the only publish signal the document had. Resolving the disagreement the other way -- setting
    `isDraft: true` and confirming these as drafts -- would take a live market's public check-in
    URL off the air, because the slug lookup now decides on phase.
    """
    doc = {"_id": 1, "id": "m1", "name": "Old Market", "phase": "draft", "isDraft": False}
    db = FakeDatabase([doc])

    # Under the new lookup rule this market is invisible on its public URL: that is the break.
    assert is_served_publicly(only(db)) is False

    migrate(db)

    assert only(db)["phase"] == "archived"
    assert only(db)["isDraft"] is False
    assert is_served_publicly(only(db)) is True


def test_publishing_an_old_build_market_is_idempotent():
    db = FakeDatabase([{"_id": 1, "id": "m1", "phase": "draft", "isDraft": False}])
    migrate(db)
    migrate(db)
    assert only(db) == {"_id": 1, "id": "m1", "phase": "archived", "isDraft": False}


def test_missing_is_draft_is_backfilled_from_phase():
    db = FakeDatabase([
        {"_id": 1, "id": "m1", "phase": "draft"},
        {"_id": 2, "id": "m2", "phase": "archived"},
    ])
    migrate(db)
    assert db.markets.docs[0]["isDraft"] is True
    assert db.markets.docs[1]["isDraft"] is False


def test_consistent_markets_are_untouched_and_migration_is_idempotent():
    docs = [
        {"_id": 1, "id": "m1", "phase": "draft", "isDraft": True},
        {"_id": 2, "id": "m2", "phase": "archived", "isDraft": False},
        {"_id": 3, "id": "m3", "phase": "applications_open", "isDraft": True},
    ]
    db = FakeDatabase(docs)
    migrate(db)
    migrate(db)
    assert db.markets.docs[0]["isDraft"] is True
    assert db.markets.docs[1]["isDraft"] is False
    assert db.markets.docs[2]["isDraft"] is False


class RacingCollection(FakeCollection):
    """A collection whose documents are transitioned by the live app mid-migration."""

    def __init__(self, docs, concurrent_write):
        super().__init__(docs)
        self.concurrent_write = concurrent_write

    def update_many(self, query, update):
        if self.concurrent_write is not None:
            self.concurrent_write(self.docs)
            self.concurrent_write = None
        return super().update_many(query, update)


def test_concurrent_unpublish_is_not_overwritten():
    """Every repair filter must still name the disagreement it repairs, not just an _id.

    The old app keeps serving writes while this runs, and unpublishing there is `PUT isDraft:
    true`. A market the owner unpublishes between the survey read and the write is a real draft
    by the time the write lands; a repair keyed on `_id` would publish it anyway, from a value
    computed for the shape the document no longer has.
    """
    db = FakeDatabase([{"_id": 1, "id": "m1", "phase": "draft", "isDraft": False}])

    def unpublish(docs):
        docs[0].update({"isDraft": True})

    db.markets = RacingCollection(db.markets.docs, unpublish)
    migrate(db)

    assert only(db) == {"_id": 1, "id": "m1", "phase": "draft", "isDraft": True}
    assert is_served_publicly(only(db)) is False


def test_concurrent_phase_change_is_not_overwritten():
    """The same guarantee on the isDraft repair: a phase the app moves mid-run wins."""
    db = FakeDatabase([{"_id": 1, "id": "m1", "phase": "applications_open", "isDraft": True}])

    def back_to_draft(docs):
        docs[0].update({"phase": "draft", "isDraft": True})

    db.markets = RacingCollection(db.markets.docs, back_to_draft)
    migrate(db)

    assert only(db) == {"_id": 1, "id": "m1", "phase": "draft", "isDraft": True}


def test_dry_run_changes_nothing():
    db = FakeDatabase([{"_id": 1, "id": "m1", "phase": "archived", "isDraft": True}])
    migrate(db, dry_run=True)
    assert only(db)["isDraft"] is True
