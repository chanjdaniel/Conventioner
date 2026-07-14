from types import SimpleNamespace

import pytest

import api.attendance as AttendanceApi
from market_documents import market_name_slug


class FakeAttendanceCollection:
    def __init__(self):
        self.docs = []
        self.last_filter = None
        self.last_update = None
        self.upsert_called = False

    def find(self, query, projection=None):
        out = []
        for d in self.docs:
            if all(d.get(k) == v for k, v in query.items()):
                out.append(d)
        return iter(out)

    def update_one(self, filter_query, update, upsert=False):
        self.last_filter = filter_query
        self.last_update = update
        self.upsert_called = upsert
        set_doc = update.get("$set", {})
        for d in self.docs:
            if all(d.get(k) == v for k, v in filter_query.items()):
                d.update(set_doc)
                return SimpleNamespace(matched_count=1, modified_count=1, upserted_id=None)
        self.docs.append(dict(set_doc))
        return SimpleNamespace(matched_count=0, modified_count=0, upserted_id="x")


def _market_with_assignment():
    return {
        "id": "market-123",
        "name": "Test Market",
        "creationDate": "2026-01-01T00:00:00Z",
        "roles": {"user-123": "owner"},
        "modificationList": [],
        "isDraft": False,
        "assignmentObject": {
            "assignmentDate": "",
            "vendorAssignments": [
                {
                    "email": "vendor@example.com",
                    "date": "2026-05-01",
                    "tableCode": "A1",
                    "tableChoice": "Full Table",
                    "section": "A",
                    "tier": "Gold",
                    "location": "Main Hall",
                }
            ],
            "assignmentStatistics": None,
        },
    }


def test_record_attendance_validates_input(monkeypatch):
    result, status = AttendanceApi.record_attendance("", "v@example.com", "2026-05-01")
    assert status == 400
    result, status = AttendanceApi.record_attendance("m", "", "2026-05-01")
    assert status == 400
    result, status = AttendanceApi.record_attendance("m", "v@example.com", "")
    assert status == 400


def test_record_attendance_404_when_market_missing(monkeypatch):
    monkeypatch.setattr(AttendanceApi.markets_collection, "find_one", lambda q: None)
    result, status = AttendanceApi.record_attendance("missing", "v@example.com", "2026-05-01")
    assert status == 404
    assert result["error"] == "Market not found"


def test_record_attendance_404_when_no_assignment_for_vendor_on_date(monkeypatch):
    monkeypatch.setattr(AttendanceApi.markets_collection, "find_one", lambda q: _market_with_assignment())
    result, status = AttendanceApi.record_attendance("market-123", "other@example.com", "2026-05-01")
    assert status == 404
    assert "No assignment" in result["error"]


def test_record_attendance_upserts_with_timestamp(monkeypatch):
    fake_coll = FakeAttendanceCollection()
    monkeypatch.setattr(AttendanceApi.markets_collection, "find_one", lambda q: _market_with_assignment())
    monkeypatch.setattr(AttendanceApi, "attendance_collection", fake_coll)

    result, status = AttendanceApi.record_attendance("market-123", "Vendor@Example.com", "2026-05-01")
    assert status == 200
    assert result["message"] == "Checked in"
    assert "checkedInAt" in result and result["checkedInAt"]
    assert fake_coll.upsert_called is True
    assert fake_coll.last_filter == {
        "market_id": "market-123",
        "vendor_email": "vendor@example.com",
        "date": "2026-05-01",
    }
    set_doc = fake_coll.last_update["$set"]
    assert set_doc["checked_in_at"] == result["checkedInAt"]

    result2, status2 = AttendanceApi.record_attendance("market-123", "vendor@example.com", "2026-05-01")
    assert status2 == 200
    assert len(fake_coll.docs) == 1


def test_get_vendor_assignment_summary_404_when_market_missing(monkeypatch):
    monkeypatch.setattr(AttendanceApi, "get_published_market_by_slug", lambda slug: None)
    result, status = AttendanceApi.get_vendor_assignment_summary("nope", "v@example.com")
    assert status == 404
    assert result["error"] == "Market not found"


def test_get_vendor_assignment_summary_404_when_no_assignment(monkeypatch):
    market = _market_with_assignment()
    monkeypatch.setattr(AttendanceApi, "get_published_market_by_slug", lambda slug: market)
    monkeypatch.setattr(AttendanceApi.SourceDataApi, "get_source_data", lambda mid: ({"headers": [], "data": []}, 200))

    assigned = SimpleNamespace(
        setup_object=None,
        assignment_object=SimpleNamespace(vendor_assignments=[
            SimpleNamespace(
                email="someone@else.com", date="2026-05-01",
                table_code="A1", table_choice="Full Table",
                section="A", tier="Gold", location="Main Hall",
            )
        ]),
    )
    monkeypatch.setattr(AttendanceApi, "assign_market", lambda m, s: assigned)

    result, status = AttendanceApi.get_vendor_assignment_summary("test-market", "vendor@example.com")
    assert status == 404
    assert "No assignment" in result["error"]


def test_get_vendor_assignment_summary_returns_camel_case_with_attendance_flag(monkeypatch):
    market = _market_with_assignment()
    monkeypatch.setattr(AttendanceApi, "get_published_market_by_slug", lambda slug: market)
    monkeypatch.setattr(AttendanceApi.SourceDataApi, "get_source_data", lambda mid: ({"headers": [], "data": []}, 200))

    assigned = SimpleNamespace(
        setup_object=SimpleNamespace(market_dates=[SimpleNamespace(date="2026-05-01", col_name="Day 1")]),
        assignment_object=SimpleNamespace(vendor_assignments=[
            SimpleNamespace(
                email="vendor@example.com", date="Day 1",
                table_code="A1", table_choice="Full Table",
                section="A", tier="Gold", location="Main Hall",
            ),
            SimpleNamespace(
                email="vendor@example.com", date="2026-05-02",
                table_code="A2", table_choice="Full Table",
                section="A", tier="Gold", location="Main Hall",
            ),
        ]),
    )
    monkeypatch.setattr(AttendanceApi, "assign_market", lambda m, s: assigned)

    fake_coll = FakeAttendanceCollection()
    fake_coll.docs.append({
        "market_id": "market-123",
        "vendor_email": "vendor@example.com",
        "date": "2026-05-01",
        "checked_in_at": "2026-05-01T10:00:00",
    })
    monkeypatch.setattr(AttendanceApi, "attendance_collection", fake_coll)

    result, status = AttendanceApi.get_vendor_assignment_summary("test-market", "Vendor@Example.com")
    assert status == 200
    assert result["marketName"] == "Test Market"
    assert result["vendorEmail"] == "vendor@example.com"
    assert len(result["assignments"]) == 2
    first = result["assignments"][0]
    assert first["date"] == "2026-05-01"
    assert first["tableCode"] == "A1"
    assert first["tableChoice"] == "Full Table"
    assert first["checkedInAt"] == "2026-05-01T10:00:00"
    second = result["assignments"][1]
    assert second["date"] == "2026-05-02"
    assert second["checkedInAt"] is None


def test_get_attendance_for_market_returns_camel_case_records(monkeypatch):
    fake_coll = FakeAttendanceCollection()
    fake_coll.docs.extend([
        {"market_id": "m1", "vendor_email": "a@example.com", "date": "2026-05-01", "checked_in_at": "2026-05-01T09:00:00"},
        {"market_id": "m1", "vendor_email": "b@example.com", "date": "2026-05-01", "checked_in_at": "2026-05-01T09:10:00"},
        {"market_id": "m2", "vendor_email": "c@example.com", "date": "2026-05-01", "checked_in_at": "2026-05-01T09:20:00"},
    ])
    monkeypatch.setattr(AttendanceApi, "attendance_collection", fake_coll)

    result, status = AttendanceApi.get_attendance_for_market("m1")
    assert status == 200
    assert len(result) == 2
    assert result[0]["marketId"] == "m1"
    assert result[0]["vendorEmail"] == "a@example.com"
    assert result[0]["checkedInAt"] == "2026-05-01T09:00:00"


def _mongo_matches(doc, query):
    """Evaluate a Mongo filter the way the server does.

    `$ne`, `$exists` and `$nor` are modelled exactly, because the distinction is the whole point
    of these tests: Mongo matches `{"$ne": "draft"}` against a document that has no such field at
    all, so a filter cannot tell a published market from a market written before `phase` existed.
    `$nor` is how the lookup prunes the documents that are unambiguously drafts without asking a
    filter to decide the question.
    """
    for key, condition in (query or {}).items():
        if key == "$nor":
            if any(_mongo_matches(doc, clause) for clause in condition):
                return False
            continue
        present = key in doc
        if isinstance(condition, dict):
            if "$exists" in condition and present != condition["$exists"]:
                return False
            if "$ne" in condition and doc.get(key) == condition["$ne"]:
                return False
        elif not present or doc[key] != condition:
            return False
    return True


class FakeSlugMarketsCollection:
    """Stand-in for the markets collection the slug lookup queries.

    `find` matches the filter the way the server does, and records the filters it was handed, so
    a lookup that asks Mongo for more documents than it should -- every published market, say --
    fails here rather than passing on a query no index can serve.
    """

    def __init__(self, docs):
        self.docs = docs
        self.scanned = []
        self.queries = []

    def find(self, query, projection=None):
        matched = [dict(d) for d in self.docs if _mongo_matches(d, query)]
        self.scanned = [d["id"] for d in matched]
        self.queries.append(query)
        if projection:
            matched = [{k: v for k, v in d.items() if k in projection} for d in matched]
        return iter(matched)

    def find_one(self, query):
        for doc in self.docs:
            if _mongo_matches(doc, query):
                return dict(doc)
        return None


def _slug_market(name, **overrides):
    """A market document as it is stored: with the slug the migration and every write stamp on it."""
    doc = {"id": name, "name": name, "slug": market_name_slug(name)}
    doc.update(overrides)
    return doc


def test_get_published_market_by_slug_skips_legacy_draft_without_phase(monkeypatch):
    """A draft written before the phase field existed must not be publicly reachable.

    Regression: the lookup filtered on `phase != draft` in Mongo, and `$ne` also matches a
    document with no `phase` key at all -- which put every legacy draft on a check-in URL.
    """
    fake = FakeSlugMarketsCollection([_slug_market("Legacy Draft", isDraft=True)])
    monkeypatch.setattr(AttendanceApi, "markets_collection", fake)

    assert AttendanceApi.get_published_market_by_slug("legacy-draft") is None


def test_get_published_market_by_slug_finds_legacy_published_without_phase(monkeypatch):
    """The other half of the legacy mapping: no phase + isDraft false is published."""
    fake = FakeSlugMarketsCollection([_slug_market("Legacy Published", isDraft=False)])
    monkeypatch.setattr(AttendanceApi, "markets_collection", fake)

    found = AttendanceApi.get_published_market_by_slug("legacy-published")
    assert found is not None and found["name"] == "Legacy Published"


def test_get_published_market_by_slug_skips_draft_phase(monkeypatch):
    fake = FakeSlugMarketsCollection([_slug_market("Draft Market", phase="draft", isDraft=True)])
    monkeypatch.setattr(AttendanceApi, "markets_collection", fake)

    assert AttendanceApi.get_published_market_by_slug("draft-market") is None


def test_get_published_market_by_slug_finds_archived_phase(monkeypatch):
    fake = FakeSlugMarketsCollection([
        _slug_market("Draft Market", phase="draft", isDraft=True),
        _slug_market("Live Market", phase="archived", isDraft=False),
    ])
    monkeypatch.setattr(AttendanceApi, "markets_collection", fake)

    found = AttendanceApi.get_published_market_by_slug("live-market")
    assert found is not None and found["name"] == "Live Market"


class TestSlugLookupPrunesInMongo:
    """The lookup runs on unauthenticated public endpoints, and a market document carries the
    whole setupObject and assignmentObject, so it must not decode the collection to answer.

    Mongo prunes only the documents that are unambiguously drafts; the Python test still decides
    what counts as published, so pruning can never be what publishes or hides a market.
    """

    def test_unambiguous_drafts_are_never_decoded(self, monkeypatch):
        fake = FakeSlugMarketsCollection([
            _slug_market("Phase Draft", phase="draft", isDraft=True),
            _slug_market("Legacy Draft", isDraft=True),
            _slug_market("Live Market", phase="archived", isDraft=False),
        ])
        monkeypatch.setattr(AttendanceApi, "markets_collection", fake)

        AttendanceApi.get_published_market_by_slug("live-market")

        assert fake.scanned == ["Live Market"]

    def test_a_draft_the_prune_cannot_rule_out_is_still_rejected_in_python(self, monkeypatch):
        """No phase and no isDraft maps to draft, but no filter can see that -- Python must."""
        fake = FakeSlugMarketsCollection([_slug_market("Bare Market")])
        monkeypatch.setattr(AttendanceApi, "markets_collection", fake)

        assert AttendanceApi.get_published_market_by_slug("bare-market") is None
        assert fake.scanned == ["Bare Market"]

    @pytest.mark.parametrize(
        "overrides",
        [
            {"phase": "archived", "isDraft": False},
            {"phase": "applications_open", "isDraft": True},
            {"isDraft": False},
            {"phase": "phase_from_a_future_build", "isDraft": False},
        ],
    )
    def test_the_prune_never_hides_a_published_market(self, monkeypatch, overrides):
        fake = FakeSlugMarketsCollection([_slug_market("Live Market", **overrides)])
        monkeypatch.setattr(AttendanceApi, "markets_collection", fake)

        found = AttendanceApi.get_published_market_by_slug("live-market")

        assert found is not None and found["name"] == "Live Market"


class TestSlugLookupQueriesTheStoredSlug:
    """The lookup asks Mongo for the market with this slug, not for every published market.

    It runs on unauthenticated endpoints -- check-in, the application form, applicant sign-in --
    and a market document carries the whole setupObject and assignmentObject, so a lookup that
    fetched every published market and slugified their names in Python would be an O(markets)
    decode that any stranger could drive by typing a URL, with a slug that matches nothing costing
    exactly as much as one that matches. The slug is stored and indexed so the question goes to the
    index.
    """

    def _fake(self, monkeypatch, *docs):
        fake = FakeSlugMarketsCollection(list(docs))
        monkeypatch.setattr(AttendanceApi, "markets_collection", fake)
        return fake

    def test_the_query_names_the_slug(self, monkeypatch):
        fake = self._fake(
            monkeypatch,
            _slug_market("Other Market", phase="archived", isDraft=False, setupObject={"big": 1}),
            _slug_market("Live Market", phase="archived", isDraft=False, setupObject={"big": 1}),
        )

        AttendanceApi.get_published_market_by_slug("live-market")

        assert [q.get("slug") for q in fake.queries] == ["live-market"]
        assert fake.scanned == ["Live Market"], "no other market was fetched to answer"

    def test_a_slug_that_matches_nothing_fetches_nothing(self, monkeypatch):
        fake = self._fake(
            monkeypatch,
            _slug_market("Live Market", phase="archived", isDraft=False),
        )

        assert AttendanceApi.get_published_market_by_slug("no-such-market") is None
        assert fake.scanned == [], "a miss must not cost a pass over the collection"

    def test_the_match_is_returned_whole(self, monkeypatch):
        """One query, and it is the market itself: no projection, no second fetch."""
        self._fake(
            monkeypatch,
            _slug_market(
                "Live Market",
                phase="archived",
                isDraft=False,
                setupObject={"colNames": ["Saturday"]},
                assignmentObject={"vendorAssignments": []},
            ),
        )

        found = AttendanceApi.get_published_market_by_slug("live-market")

        assert found["setupObject"] == {"colNames": ["Saturday"]}
        assert found["assignmentObject"] == {"vendorAssignments": []}

    def test_a_market_with_no_stored_slug_is_not_reachable(self, monkeypatch):
        """The migration's contract, stated as a test.

        A document the slug backfill has not reached is invisible to every public URL, which is
        exactly why the app refuses to boot until the migration is recorded
        (``assert_market_key_migration_recorded``). Softening this into a read-time fallback would
        put the O(markets) scan back on the miss path, where an attacker lives.
        """
        doc = _slug_market("Live Market", phase="archived", isDraft=False)
        del doc["slug"]
        self._fake(monkeypatch, doc)

        assert AttendanceApi.get_published_market_by_slug("live-market") is None

    def test_a_stored_slug_that_contradicts_the_name_serves_nothing(self, monkeypatch):
        """The stored slug narrows the query; the name is what decides.

        Nothing in this codebase can write the two out of step -- ``Market.slug`` is computed from
        the name -- and this is what keeps a hand-edited document from putting a market on a URL
        its name does not spell.
        """
        self._fake(
            monkeypatch,
            _slug_market("Live Market", phase="archived", isDraft=False, slug="other-market"),
        )

        assert AttendanceApi.get_published_market_by_slug("other-market") is None

    def test_the_document_returned_is_the_one_the_draft_test_ran_on(self, monkeypatch):
        """One read, so there is no second version of the market to disagree with the first.

        The lookup used to match on a projected pass and then re-fetch the winner, which left a
        window: a market unpublished between the two reads would be served on a public URL by a
        decision made about the version before it. The window is gone because the read is one.
        """
        fake = self._fake(
            monkeypatch, _slug_market("Live Market", phase="archived", isDraft=False)
        )
        fake.find_one = lambda query: pytest.fail("the lookup must not re-fetch the market")

        found = AttendanceApi.get_published_market_by_slug("live-market")

        assert found["name"] == "Live Market"
