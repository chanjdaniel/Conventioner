"""Reading the market's history in Manage market (E40/F01/S03).

Every change, newest first, a page at a time: the newest entries, then older ones on request, and
filtered by who, by the group of the table their action is in, by vendor and by date. A market
with thousands of entries reads its first page as quickly as a market with ten, because the read
asks Mongo for one page and a cursor, never for the whole history.
"""
from datetime import datetime, timedelta, timezone

import pytest

from conftest import FakeMarketsCollection, mongo_matches, mongo_project, stored_market

import api.market_actions as Actions
import api.markets as MarketsApi
import api.permissions as PermissionsApi
import history as History
from datatypes import MarketRole
from lookup_indexes import LOOKUP_INDEXES

MARKET = "market-123"
START = datetime(2026, 11, 1, 9, 0, tzinfo=timezone.utc)


def _at(minutes: int) -> str:
    return (START + timedelta(minutes=minutes)).isoformat()


class Cursor:
    """A Mongo cursor over a fake's documents: sorted and limited, as the server would hand them
    back, counting how many documents the read was handed."""

    def __init__(self, collection, docs):
        self.collection = collection
        self.docs = docs

    def sort(self, keys):
        self.collection.sorts.append(list(keys))
        for field, direction in reversed(keys):
            self.docs.sort(key=lambda doc: doc.get(field) or "", reverse=direction < 0)
        return self

    def limit(self, count):
        self.collection.limits.append(count)
        self.docs = self.docs[:count]
        return self

    def __iter__(self):
        self.collection.handed += len(self.docs)
        return iter(self.docs)


def _matches(doc, query):
    for key, condition in query.items():
        if key == "$and":
            if not all(_matches(doc, clause) for clause in condition):
                return False
        elif key == "$or":
            if not any(_matches(doc, clause) for clause in condition):
                return False
        elif isinstance(condition, dict) and any(op in condition for op in (
                "$lt", "$lte", "$gt", "$gte")):
            value = doc.get(key)
            if value is None:
                return False
            if "$lt" in condition and not value < condition["$lt"]:
                return False
            if "$lte" in condition and not value <= condition["$lte"]:
                return False
            if "$gt" in condition and not value > condition["$gt"]:
                return False
            if "$gte" in condition and not value >= condition["$gte"]:
                return False
        elif isinstance(doc.get(key), list) and not isinstance(condition, dict):
            if condition not in doc[key]:
                return False
        elif not mongo_matches(doc, {key: condition}):
            return False
    return True


def _projected(doc, projection):
    """Mongo's projection, the exclusion form included, which the shared fake does not model."""
    if projection and all(not value for value in projection.values()):
        return {key: value for key, value in doc.items() if key not in projection}
    return mongo_project(dict(doc), projection)


class PagedHistory:
    """The ``history`` collection, read through a cursor."""

    def __init__(self):
        self.docs = []
        self.sorts = []
        self.limits = []
        self.handed = 0

    def insert_one(self, document):
        self.docs.append(document)

    def find(self, query, projection=None):
        found = [_projected(doc, projection) for doc in self.docs if _matches(doc, query)]
        return Cursor(self, found)

    def distinct(self, field, query):
        return list({doc.get(field) for doc in self.docs if _matches(doc, query)})


@pytest.fixture
def history(monkeypatch):
    fake = PagedHistory()
    monkeypatch.setattr(History, "history_collection", fake)
    monkeypatch.setattr(History, "legacy_placement_collection", PagedHistory())
    return fake


@pytest.fixture
def legacy(monkeypatch):
    fake = PagedHistory()
    monkeypatch.setattr(History, "legacy_placement_collection", fake)
    return fake


def entry(history, minutes, action="give-verdicts", kind="verdict", actor="dana@x.test",
          vendors=(), detail=None, market=MARKET, entry_id=None):
    doc = {
        "id": entry_id or f"e-{minutes:05d}",
        "market_id": market,
        "actor": actor,
        "at": _at(minutes),
        "action": action,
        "kind": kind,
        "vendors": list(vendors),
        "subject": {},
        "detail": detail or {"before": {"status": "pending"}, "after": {"status": "approved"}},
    }
    history.docs.append(doc)
    return doc


def ids(entries):
    return [e["id"] for e in entries]


class TestAPage:
    def test_it_is_the_newest_entries_first_and_a_cursor_to_the_rest(self, history):
        for minutes in range(30):
            entry(history, minutes)

        first, after = History.entries_page(MARKET, limit=10)

        assert ids(first) == [f"e-{m:05d}" for m in range(29, 19, -1)]
        assert after

        second, after = History.entries_page(MARKET, before=after, limit=10)
        assert ids(second) == [f"e-{m:05d}" for m in range(19, 9, -1)]

        third, after = History.entries_page(MARKET, before=after, limit=10)
        assert ids(third) == [f"e-{m:05d}" for m in range(9, -1, -1)]
        assert after is None

    def test_entries_written_in_the_same_instant_are_neither_lost_nor_repeated(self, history):
        for n in range(5):
            entry(history, 0, entry_id=f"same-{n}")

        first, after = History.entries_page(MARKET, limit=2)
        second, after = History.entries_page(MARKET, before=after, limit=2)
        third, after = History.entries_page(MARKET, before=after, limit=2)

        assert ids(first) + ids(second) + ids(third) == [f"same-{n}" for n in range(4, -1, -1)]
        assert after is None

    def test_it_reads_one_market_only(self, history):
        entry(history, 1)
        entry(history, 2, market="other-market")

        page, _after = History.entries_page(MARKET)

        assert ids(page) == ["e-00001"]

    def test_an_entry_is_served_whole_but_for_its_storage_keys(self, history):
        entry(history, 1, vendors=["ana@x.test"])

        [served], _after = History.entries_page(MARKET)

        assert set(served) == {"id", "actor", "at", "action", "kind", "vendors", "subject",
                               "detail"}

    def test_a_cursor_that_is_not_one_reads_nothing(self):
        assert History.parse_cursor("not a cursor") is None
        assert History.parse_cursor("") is None
        assert History.parse_cursor(f"{_at(1)}|e-1") == (_at(1), "e-1")


class TestTheFilters:
    def test_who_narrows_to_one_persons_changes(self, history):
        entry(history, 1, actor="dana@x.test")
        entry(history, 2, actor="priya@x.test")

        page, _after = History.entries_page(MARKET, actor="priya@x.test")

        assert ids(page) == ["e-00002"]

    def test_a_group_narrows_to_its_actions(self, history):
        entry(history, 1, action="give-verdicts")
        entry(history, 2, action="assign", kind="placed")
        entry(history, 3, action="change-setup", kind="plan")

        page, _after = History.entries_page(MARKET, actions=["assign"])

        assert ids(page) == ["e-00002"]

    def test_a_vendor_narrows_to_the_entries_naming_them(self, history):
        entry(history, 1, vendors=["ana@x.test"])
        entry(history, 2, vendors=["ben@x.test", "ana@x.test"])
        entry(history, 3, vendors=["ben@x.test"])

        page, _after = History.entries_page(MARKET, vendor="Ana@X.test")

        assert ids(page) == ["e-00002", "e-00001"]

    def test_a_date_range_keeps_the_entries_inside_it(self, history):
        for minutes in (0, 60, 120, 180):
            entry(history, minutes)

        page, _after = History.entries_page(MARKET, since=_at(60), until=_at(180))

        assert ids(page) == ["e-00120", "e-00060"]

    def test_the_filters_hold_from_page_to_page(self, history):
        for minutes in range(20):
            entry(history, minutes, actor="dana@x.test" if minutes % 2 else "priya@x.test")

        first, after = History.entries_page(MARKET, actor="dana@x.test", limit=5)
        second, after = History.entries_page(MARKET, actor="dana@x.test", before=after, limit=5)

        assert ids(first) + ids(second) == [f"e-{m:05d}" for m in range(19, 0, -2)]
        assert after is None


class TestTheEntriesNotYetMoved:
    """Until a database runs the move from ``placement_history``, its older placements are read
    from there too, so the market's history does not start where the migration has not run."""

    def test_they_are_read_in_their_place_as_assign_entries(self, history, legacy):
        entry(history, 3)
        legacy.docs.append({
            "id": "old-1", "market_id": MARKET, "actor": "dana@x.test", "at": _at(2),
            "kind": "freed", "vendors": ["ana@x.test"],
            "detail": {"date": "2026-11-18", "table_code": "A1"},
        })
        entry(history, 1)

        page, _after = History.entries_page(MARKET)

        assert ids(page) == ["e-00003", "old-1", "e-00001"]
        old = page[1]
        assert old["action"] == "assign"
        assert old["subject"] == {"date": "2026-11-18", "table_codes": ["A1"]}

    def test_an_entry_in_both_is_read_once(self, history, legacy):
        moved = entry(history, 2, action="assign", kind="freed")
        legacy.docs.append({**moved})
        del legacy.docs[0]["action"]

        page, _after = History.entries_page(MARKET)

        assert ids(page) == [moved["id"]]

    def test_they_are_left_out_of_a_group_that_is_not_the_assignment(self, history, legacy):
        legacy.docs.append({
            "id": "old-1", "market_id": MARKET, "actor": "dana@x.test", "at": _at(2),
            "kind": "freed", "vendors": [], "detail": {},
        })

        page, _after = History.entries_page(MARKET, actions=["give-verdicts"])

        assert page == []


class TestThousandsOfEntries:
    def test_the_first_page_asks_for_one_page_on_the_index_never_the_whole_history(self, history):
        """5,000 entries: the read asks Mongo for the newest page and one more, sorted on the
        index it is read by, so Mongo walks that many index keys and stops."""
        for minutes in range(5000):
            entry(history, minutes)

        page, after = History.entries_page(MARKET)

        assert len(page) == History.PAGE_SIZE
        assert after
        assert history.limits == [History.PAGE_SIZE + 1]
        assert history.handed == History.PAGE_SIZE + 1
        assert history.sorts == [[("at", -1), ("id", -1)]]
        assert ("market_id", "at", "id") in LOOKUP_INDEXES[History.HISTORY_COLLECTION]

    def test_a_page_is_never_larger_than_the_page_size(self, history):
        for minutes in range(200):
            entry(history, minutes)

        page, _after = History.entries_page(MARKET, limit=10_000)

        assert len(page) == History.PAGE_SIZE


@pytest.fixture
def market(monkeypatch):
    fake = FakeMarketsCollection(stored_market())
    monkeypatch.setattr(MarketsApi, "markets_collection", fake)
    monkeypatch.setattr(MarketsApi.ApplicationsApi, "vendor_names_for_market",
                        lambda _market_id: {"ana@x.test": "Ana Vendor"})
    return fake


def _as(monkeypatch, role):
    monkeypatch.setattr(PermissionsApi, "get_user_market_role", lambda *_a, **_k: role)


class TestTheEndpoint:
    def test_a_viewer_reads_the_first_page_with_what_the_filters_offer(
            self, market, history, monkeypatch):
        _as(monkeypatch, MarketRole.VIEWER)
        entry(history, 1, actor="dana@x.test", vendors=["ana@x.test"])
        entry(history, 2, action="apply", kind="submitted", actor="ana@x.test")
        entry(history, 3, action="check-in", kind="checked_in", actor=None)

        body, status = MarketsApi.get_history(MARKET, "viewer@x.test", {})

        assert status == 200
        assert ids(body["entries"]) == ["e-00003", "e-00002", "e-00001"]
        assert body["next"] is None
        assert body["vendorNames"] == {"ana@x.test": "Ana Vendor"}
        # Who changed something here, organizers only: an applicant's own change is found by
        # their name, and a check-in from the public page has nobody to name.
        assert body["actors"] == ["dana@x.test"]
        groups = {group["group"]: [a["id"] for a in group["actions"]] for group in body["groups"]}
        assert "Reading" not in groups
        assert groups["Applications"] == ["import-applications", "give-verdicts", "apply"]
        assert groups["Assignment"] == ["assign"]

    def test_detail_and_subject_are_served_as_stored(self, market, history, monkeypatch):
        """Their keys are data - a question's key, an application's id - so they are not
        recased the way an entry's own fields are."""
        _as(monkeypatch, MarketRole.VIEWER)
        entry(history, 1, action="give-verdicts", kind="verdicts",
              detail={"before": {"app_one": {"follow_up_owner": None}}, "after": {}})

        body, _status = MarketsApi.get_history(MARKET, "viewer@x.test", {})

        assert body["entries"][0]["detail"] == {
            "before": {"app_one": {"follow_up_owner": None}}, "after": {}}

    def test_load_more_is_the_page_after_the_cursor(self, market, history, monkeypatch):
        _as(monkeypatch, MarketRole.VIEWER)
        for minutes in range(History.PAGE_SIZE + 3):
            entry(history, minutes)

        first, _status = MarketsApi.get_history(MARKET, "viewer@x.test", {})
        more, _status = MarketsApi.get_history(
            MARKET, "viewer@x.test", {"before": first["next"]})

        assert len(first["entries"]) == History.PAGE_SIZE
        assert ids(more["entries"]) == ["e-00002", "e-00001", "e-00000"]
        assert more["next"] is None
        # The filters' choices came with the first page; a later one does not ask again.
        assert "actors" not in more

    def test_the_filters_are_read_from_the_request(self, market, history, monkeypatch):
        _as(monkeypatch, MarketRole.VIEWER)
        entry(history, 1, action="assign", kind="placed", actor="dana@x.test",
              vendors=["ana@x.test"])
        entry(history, 2, action="assign", kind="placed", actor="priya@x.test",
              vendors=["ana@x.test"])
        entry(history, 3, action="give-verdicts", actor="dana@x.test", vendors=["ana@x.test"])
        entry(history, 600, action="assign", kind="placed", actor="dana@x.test",
              vendors=["ana@x.test"])

        body, status = MarketsApi.get_history(MARKET, "viewer@x.test", {
            "actor": "dana@x.test", "group": "Assignment", "vendor": "ana@x.test",
            "since": "2026-11-01T09:00:00.000Z", "until": "2026-11-01T10:00:00.000Z",
        })

        assert status == 200
        assert ids(body["entries"]) == ["e-00001"]

    @pytest.mark.parametrize("args", [
        {"group": "Not a group"},
        {"group": "Reading"},
        {"since": "yesterday"},
        {"until": "2026-13-45"},
        {"before": "not a cursor"},
    ])
    def test_a_filter_it_cannot_read_is_refused(self, market, history, monkeypatch, args):
        _as(monkeypatch, MarketRole.VIEWER)

        body, status = MarketsApi.get_history(MARKET, "viewer@x.test", args)

        assert status == 400
        assert body["error"]

    def test_a_person_below_the_row_is_refused_in_its_words(self, market, history, monkeypatch):
        _as(monkeypatch, None)
        entry(history, 1)

        body, status = MarketsApi.get_history(MARKET, "stranger@x.test", {})

        assert status == 403
        assert body == {"error": Actions.refusal_sentence(Actions.READ_HISTORY)}

    def test_the_read_asks_the_history_row(self, market, history, monkeypatch):
        asked = []
        monkeypatch.setattr(Actions, "refusal", lambda row, *_a: asked.append(row) or "No.")

        _body, status = MarketsApi.get_history(MARKET, "editor@x.test", {})

        assert status == 403
        assert asked == [Actions.READ_HISTORY]

    def test_a_missing_market_is_not_found(self, history, monkeypatch):
        monkeypatch.setattr(MarketsApi, "markets_collection", FakeMarketsCollection(None))

        _body, status = MarketsApi.get_history("nope", "viewer@x.test", {})

        assert status == 404


class TestTheRow:
    def test_reading_the_history_is_a_viewers_by_default(self):
        row = Actions.READ_HISTORY
        assert (row.id, row.group, row.label, row.default, row.fixed) == (
            "read-history", "Reading", "Read the market's history", MarketRole.VIEWER, False)

    def test_a_person_with_no_role_is_told_no_by_the_market_read(self):
        refusals = MarketsApi.role_action_refusals(None, MarketsApi.MarketPhase.DRAFT)
        viewer = MarketsApi.role_action_refusals(MarketRole.VIEWER, MarketsApi.MarketPhase.DRAFT)

        assert refusals["read-history"] == Actions.refusal_sentence(Actions.READ_HISTORY)
        assert viewer["read-history"] is None

    def test_an_archived_market_is_still_read(self):
        refusals = MarketsApi.role_action_refusals(
            MarketRole.VIEWER, MarketsApi.MarketPhase.ARCHIVED)

        assert refusals["read-history"] is None
