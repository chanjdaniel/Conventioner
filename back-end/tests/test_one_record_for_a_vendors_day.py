"""One vendor's day is one record, held by a unique index the back end will not boot without (T270).

Attendance was kept by an upsert on (market, vendor, date) with no unique index behind it, so two
check-ins landing at once - two organizers at the door, or a tap and the vendor's own door-code
check-in - could store two records: one Undo then left the vendor reading as here, and the history
held two arrivals. The index is the referee now. These tests cover what the fakes can: the
helper that builds it and names the duplicates that stop it, the boot's refusal, and the
read-only check run before a release is promoted. That the database itself refuses a second
record is the E2E spec's, on the stack's real MongoDB (``one-record-for-a-vendors-day.spec.ts``).
"""
import logging
import os
import sys

import pytest
from pymongo.errors import DuplicateKeyError, PyMongoError

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                                "migrations"))

import api.attendance as AttendanceApi  # noqa: E402
import app as app_module  # noqa: E402
import check_vendor_day_duplicates as Check  # noqa: E402
import unique_indexes as UniqueIndexes  # noqa: E402

MARKET = "market-123"
DAY = "2099-08-01"
ANA = "ana@example.com"
BEN = "ben@example.com"


class VendorDays:
    """A collection of vendor-day records as MongoDB would hold them, with its indexes; it can
    group by aggregation, and it has no write but building an index."""

    def __init__(self, name="attendance", docs=(), indexes=None, build_fails=False,
                 read_fails=False):
        self.name = name
        self.docs = [dict(doc) for doc in docs]
        self.indexes = {"_id_": {"key": [("_id", 1)]}, **(indexes or {})}
        self.build_fails = build_fails
        self.read_fails = read_fails
        self.built = []
        self.read = False

    def index_information(self):
        return {name: dict(info) for name, info in self.indexes.items()}

    def create_index(self, keys, **options):
        if self.build_fails:
            # As MongoDB words it: the duplicate key quotes the vendor's address.
            raise DuplicateKeyError(
                f'E11000 duplicate key error dup key: {{ vendor_email: "{ANA}" }}', code=11000)
        self.indexes[options["name"]] = {"key": list(keys), **options}
        self.built.append((list(keys), options))
        return options["name"]

    def aggregate(self, pipeline):
        self.read = True
        if self.read_fails:
            raise PyMongoError("the read failed")
        group, match, project = (stage for stage in pipeline)
        # Each key field as {"$ifNull": ["$<field>", None]}: a missing field groups as null.
        key_of = {name: ref["$ifNull"][0][1:] for name, ref in group["$group"]["_id"].items()}
        groups = {}
        for doc in self.docs:
            key = tuple((name, doc.get(field)) for name, field in key_of.items())
            groups.setdefault(key, []).append(doc["_id"])
        assert match == {"$match": {"n": {"$gt": 1}}}
        out = []
        for key, ids in groups.items():
            if len(ids) < 2:
                continue
            values = dict(key)
            row = {}
            for name, ref in project["$project"].items():
                if name == "ids":
                    row["ids"] = ids
                elif isinstance(ref, str) and ref.startswith("$_id."):
                    row[name] = values[ref[len("$_id."):]]
            out.append(row)
        return iter(out)


def _record(record_id, email, market=MARKET, date=DAY):
    return {"_id": record_id, "market_id": market, "vendor_email": email, "date": date}


TWICE = [_record("rec-1", ANA), _record("rec-2", ANA), _record("rec-3", BEN),
         _record("rec-4", BEN, date="2099-08-02")]


def test_a_missing_field_groups_as_null_as_the_index_keys_it():
    """The unique index keys a missing field as null, so the two records below block it; the
    groups must say so, or the refusal would read "none found"."""
    missing = {"_id": "rec-5", "market_id": MARKET, "date": DAY}
    null = {"_id": "rec-6", "market_id": MARKET, "vendor_email": None, "date": DAY}

    groups = UniqueIndexes.duplicate_groups(
        VendorDays(docs=[missing, null]), UniqueIndexes.VENDOR_DAY_FIELDS,
        UniqueIndexes.VENDOR_DAY_SHOWN)

    assert groups == [{"ids": ["rec-5", "rec-6"], "market_id": MARKET, "date": DAY}]


class TestTheUniqueIndexHelper:
    def test_it_builds_the_index_unique_under_its_name(self):
        collection = VendorDays()

        UniqueIndexes.ensure_vendor_day_index(collection, "attendance")

        [(keys, options)] = collection.built
        assert keys == [("market_id", 1), ("vendor_email", 1), ("date", 1)]
        assert options == {"unique": True, "name": "attendance_vendor_day_unique"}

    def test_an_index_that_stands_unique_is_left_alone_and_nothing_is_read(self):
        collection = VendorDays(indexes={"attendance_vendor_day_unique": {
            "key": [("market_id", 1), ("vendor_email", 1), ("date", 1)], "unique": True}})

        UniqueIndexes.ensure_vendor_day_index(collection, "attendance")

        assert collection.built == []
        assert collection.read is False

    def test_a_partial_index_carries_its_filter(self):
        collection = VendorDays(name="payments")

        UniqueIndexes.ensure_unique_index(
            collection, ("market_id", "request_key"), "a_key", shown=("market_id",), one="one key",
            partial={"request_key": {"$type": "string"}})

        [(_keys, options)] = collection.built
        assert options["partialFilterExpression"] == {"request_key": {"$type": "string"}}

    def test_a_refusal_names_each_vendor_day_by_market_date_and_id_never_the_address(self):
        collection = VendorDays(docs=TWICE, build_fails=True)

        with pytest.raises(UniqueIndexes.UniqueIndexError) as refused:
            UniqueIndexes.ensure_vendor_day_index(collection, "attendance")

        message = str(refused.value)
        assert message == (
            "The unique index attendance_vendor_day_unique on attendance (market_id, vendor_email, "
            "date) could not be built (DuplicateKeyError, code 11000), so nothing stops two records "
            "for one vendor's day. Records sharing one vendor's day, by market_id, date and record "
            f"id: market_id {MARKET}, date {DAY}: rec-1, rec-2. Keep one of each "
            "(docs/OPERATIONS.md, When the back end refuses to boot), then restart."
        )
        assert ANA not in message and BEN not in message
        # Nor kept as the cause, where a traceback would print it.
        assert refused.value.__cause__ is None and refused.value.__suppress_context__

    def test_a_refusal_with_no_duplicates_found_says_so(self):
        collection = VendorDays(docs=TWICE[2:], build_fails=True)

        with pytest.raises(UniqueIndexes.UniqueIndexError, match="record id: none found\\."):
            UniqueIndexes.ensure_vendor_day_index(collection, "attendance")

    def test_a_refusal_whose_read_fails_says_it_was_not_read(self):
        collection = VendorDays(docs=TWICE, build_fails=True, read_fails=True)

        with pytest.raises(UniqueIndexes.UniqueIndexError,
                           match="record id: not read \\(PyMongoError\\)\\."):
            UniqueIndexes.ensure_vendor_day_index(collection, "attendance")

    def test_a_shown_field_outside_the_key_is_refused(self):
        with pytest.raises(ValueError):
            UniqueIndexes.duplicate_groups(VendorDays(), ("market_id",), ("vendor_email",))


class TestTheBoot:
    def test_the_boot_builds_the_attendance_index(self, monkeypatch):
        collection = VendorDays()
        monkeypatch.setattr(AttendanceApi, "attendance_collection", collection)

        app_module.verify_attendance_indexes()

        assert "attendance_vendor_day_unique" in collection.indexes

    def test_the_boot_refuses_naming_the_duplicates_and_no_address(self, monkeypatch, caplog):
        monkeypatch.setattr(AttendanceApi, "attendance_collection",
                            VendorDays(docs=TWICE, build_fails=True))

        with caplog.at_level(logging.CRITICAL), pytest.raises(UniqueIndexes.UniqueIndexError):
            app_module.verify_attendance_indexes()

        [logged] = [r for r in caplog.records if r.levelno == logging.CRITICAL]
        assert logged.getMessage().startswith("Refusing to start: The unique index "
                                              "attendance_vendor_day_unique")
        assert "rec-1, rec-2" in logged.getMessage()
        assert ANA not in caplog.text and BEN not in caplog.text


class TestTheCheckBeforeARelease:
    """``migrations/check_vendor_day_duplicates.py``, which Daniel runs against production before
    promoting the release whose boot refuses on a duplicate."""

    def test_none_found_exits_0(self, capsys):
        database = {"attendance": VendorDays(docs=TWICE[2:])}

        assert Check.check(database) == 0

        out = capsys.readouterr().out
        assert "attendance: no vendor's day has more than one record." in out

    def test_duplicates_exit_1_named_without_an_address(self, capsys):
        database = {"attendance": VendorDays(docs=TWICE)}

        assert Check.check(database) == 1

        out = capsys.readouterr().out
        assert "attendance: 1 vendor's day has more than one record" in out
        assert f"market_id {MARKET}, date {DAY}: rec-1, rec-2" in out
        assert ANA not in out and BEN not in out

    def test_it_checks_every_vendor_day_collection(self):
        assert set(Check.CHECKED) == set(UniqueIndexes.VENDOR_DAY_INDEXES)
