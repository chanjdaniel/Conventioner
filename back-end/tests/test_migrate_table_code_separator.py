"""The separator migration decides where a section name ends from the market's own sections.

The ambiguous case is the whole reason this is not a regular expression: a section may end in a
digit, so "Hall 21" is table 1 of "Hall 2" or table 21 of "Hall", and only the section list says
which.
"""
import copy
from types import SimpleNamespace

from migrate_table_code_separator import migrate, rewritten_code


class FakeCollection:
    def __init__(self, docs):
        self.docs = docs

    def find(self, query):
        assert query == {"assignmentObject.vendorAssignments.0": {"$exists": True}}
        return [
            copy.deepcopy(doc)
            for doc in self.docs
            if (doc.get("assignmentObject") or {}).get("vendorAssignments")
        ]

    def update_one(self, query, update):
        for doc in self.docs:
            if doc["_id"] != query["_id"]:
                continue
            for path, value in update["$set"].items():
                target = doc
                parts = path.split(".")
                for part in parts[:-1]:
                    target = target[int(part)] if part.isdigit() else target[part]
                target[parts[-1]] = value
            return SimpleNamespace(modified_count=1)
        raise AssertionError(f"no such document: {query}")


class FakeDatabase:
    def __init__(self, docs):
        self.markets = FakeCollection(docs)


def market(section_names, codes, unassigned=None):
    return {
        "_id": 1,
        "id": "m1",
        "setupObject": {"sections": [{"name": name} for name in section_names]},
        "assignmentObject": {
            "vendorAssignments": [{"tableCode": code} for code in codes],
            "assignmentStatistics": {"unassignedTables": unassigned or {}},
        },
    }


def codes(db):
    return [p["tableCode"] for p in db.markets.docs[0]["assignmentObject"]["vendorAssignments"]]


class TestRewritingOneCode:
    def test_separates_a_concatenated_code(self):
        assert rewritten_code("Front Row1", ["Front Row"]) == "Front Row 1"

    def test_leaves_a_code_that_already_carries_its_separator(self):
        assert rewritten_code("Front Row 1", ["Front Row"]) is None

    def test_leaves_a_code_no_section_claims(self):
        assert rewritten_code("Balcony7", ["Front Row"]) is None

    def test_prefers_the_longest_matching_section_name(self):
        # "Hall 21" under a market holding both names is table 1 of "Hall 2", not table 21 of
        # "Hall". A shorter-first match would move a vendor to a different table.
        assert rewritten_code("Hall 21", ["Hall", "Hall 2"]) == "Hall 2 1"

    def test_leaves_a_code_whose_remainder_is_not_a_number(self):
        assert rewritten_code("Front RowA", ["Front Row"]) is None


class TestMigratingAMarket:
    def test_rewrites_every_placement(self):
        db = FakeDatabase([market(["Front Row"], ["Front Row1", "Front Row2"])])
        migrate(db)
        assert codes(db) == ["Front Row 1", "Front Row 2"]

    def test_is_idempotent(self):
        db = FakeDatabase([market(["Front Row"], ["Front Row1"])])
        migrate(db)
        migrate(db)
        assert codes(db) == ["Front Row 1"]

    def test_rewrites_the_unassigned_table_entries_too(self):
        db = FakeDatabase([
            market(
                ["Front Row"],
                ["Front Row1"],
                unassigned={"2026-11-21": [{"tableCode": "Front Row2", "tableChoice": "Full Table"}]},
            )
        ])
        migrate(db)
        entries = db.markets.docs[0]["assignmentObject"]["assignmentStatistics"]["unassignedTables"]
        assert entries["2026-11-21"][0]["tableCode"] == "Front Row 2"

    def test_leaves_a_market_whose_sections_are_gone(self):
        # Without the section list there is no safe split, and guessing one moves a vendor.
        db = FakeDatabase([market([], ["Front Row1"])])
        migrate(db)
        assert codes(db) == ["Front Row1"]
