"""The migration into the one stage (E38/F04/S01) moves fixture markets from each old phase, keeps a
closed form market not taking applications, renames the phase history, and changes nothing twice."""
import copy
from types import SimpleNamespace

from migrate_to_one_stage import OLD_PHASES, migrate


def _matches(doc, query):
    for key, condition in query.items():
        if key == "$or":
            if not any(_matches(doc, clause) for clause in condition):
                return False
        elif key == "phaseHistory.phase":
            named = {entry.get("phase") for entry in doc.get("phaseHistory") or []}
            if not named & set(condition["$in"]):
                return False
        elif isinstance(condition, dict):
            if doc.get(key) not in condition["$in"]:
                return False
        elif doc.get(key) != condition:
            return False
    return True


class FakeMarkets:
    def __init__(self, docs):
        self.docs = docs
        self.writes = 0

    def find(self, query):
        return [copy.deepcopy(doc) for doc in self.docs if _matches(doc, query)]

    def update_one(self, query, update):
        for doc in self.docs:
            if _matches(doc, query):
                doc.update(copy.deepcopy(update["$set"]))
                self.writes += 1
                return SimpleNamespace(matched_count=1)
        return SimpleNamespace(matched_count=0)


def _entry(phase):
    return {"phase": phase, "enteredAt": "2026-10-01T00:00:00+00:00", "by": "owner@example.com"}


def _fixtures():
    return [
        {"_id": 1, "id": "m1", "name": "Fixture Open Form", "intakeMode": "form",
         "phase": "applications_open", "phaseHistory": [_entry("draft"), _entry("applications_open")]},
        {"_id": 2, "id": "m2", "name": "Fixture Closed Form", "intakeMode": "form",
         "phase": "applications_closed",
         "phaseHistory": [_entry("draft"), _entry("applications_open"), _entry("applications_closed")]},
        {"_id": 3, "id": "m3", "name": "Fixture Closed Google Form", "intakeMode": "csv",
         "phase": "applications_closed"},
        {"_id": 4, "id": "m4", "name": "Fixture Review", "intakeMode": "csv", "phase": "review",
         "phaseHistory": [_entry("draft"), _entry("applications_open"), _entry("review")]},
        {"_id": 7, "id": "m7", "name": "Fixture Form Review", "intakeMode": "form",
         "phase": "review", "phaseHistory": [_entry("draft"), _entry("applications_open"),
                                             _entry("applications_closed"), _entry("review")]},
        {"_id": 5, "id": "m5", "name": "Fixture Archived", "intakeMode": "form", "phase": "archived",
         "phaseHistory": [_entry("draft"), _entry("review"), _entry("assignment"), _entry("archived")]},
        {"_id": 6, "id": "m6", "name": "Fixture Draft", "intakeMode": "form", "phase": "draft",
         "phaseHistory": [_entry("draft")]},
    ]


def _by_id(markets):
    return {doc["id"]: doc for doc in markets.docs}


class FakeDb:
    def __init__(self, docs):
        self.markets = FakeMarkets(docs)


def test_every_market_in_an_old_phase_enters_the_stage():
    db = FakeDb(_fixtures())

    migrate(db)

    markets = _by_id(db.markets)
    assert [markets[m]["phase"] for m in ("m1", "m2", "m3", "m4", "m7")] == ["applications"] * 5
    assert markets["m5"]["phase"] == "archived"
    assert markets["m6"]["phase"] == "draft"


def test_a_closed_form_market_keeps_refusing_new_applications():
    db = FakeDb(_fixtures())

    migrate(db)

    markets = _by_id(db.markets)
    assert markets["m2"]["applicationsStopped"] is True
    # A form market reached review only through the closed phase, so its form was closed too.
    assert markets["m7"]["applicationsStopped"] is True
    # A Google Form market has no application page to stop, and an open one keeps taking them.
    assert "applicationsStopped" not in markets["m3"]
    assert "applicationsStopped" not in markets["m1"]


def test_the_phase_history_names_only_phases_this_build_knows():
    db = FakeDb(_fixtures())

    migrate(db)

    for doc in db.markets.docs:
        assert not {entry["phase"] for entry in doc.get("phaseHistory", [])} & set(OLD_PHASES)
    archived = _by_id(db.markets)["m5"]["phaseHistory"]
    assert [entry["phase"] for entry in archived] == ["draft", "applications", "assignment", "archived"]
    assert archived[1]["by"] == "owner@example.com"


def test_the_dry_run_counts_each_old_phase_and_writes_nothing(capsys):
    db = FakeDb(_fixtures())
    before = copy.deepcopy(db.markets.docs)

    counts = migrate(db, dry_run=True)

    assert db.markets.docs == before
    assert {phase: counts[phase] for phase in OLD_PHASES} == {
        "applications_open": 1, "applications_closed": 2, "review": 2,
    }
    assert counts["stopped"] == 2
    assert counts["history_only"] == 1
    out = capsys.readouterr().out
    assert "Would move 5 market(s) into applications" in out
    assert "Fixture Closed Form: applications_closed -> applications (not taking applications)" in out


def test_a_second_run_changes_nothing():
    db = FakeDb(_fixtures())
    migrate(db)
    after_first = copy.deepcopy(db.markets.docs)
    writes = db.markets.writes

    counts = migrate(db)

    assert db.markets.docs == after_first
    assert db.markets.writes == writes
    assert counts["updated"] == 0
