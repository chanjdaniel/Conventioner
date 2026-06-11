import os
import sys
import types
from types import SimpleNamespace

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

if "pymongo" not in sys.modules:
    fake_pymongo = types.ModuleType("pymongo")
    fake_pymongo_results = types.ModuleType("pymongo.results")

    class _FakeCollection:
        def find_one(self, *_args, **_kwargs):
            return None

        def find(self, *_args, **_kwargs):
            return iter([])

        def update_one(self, *_args, **_kwargs):
            return SimpleNamespace(matched_count=0, modified_count=0, upserted_id=None)

    class _FakeDatabase(dict):
        def __getitem__(self, _name):
            return _FakeCollection()

    class _FakeMongoClient:
        def __init__(self, *_args, **_kwargs):
            pass

        def __getitem__(self, _name):
            return _FakeDatabase()

    fake_pymongo.MongoClient = _FakeMongoClient
    fake_pymongo_results.InsertOneResult = object
    fake_pymongo_results.UpdateResult = object
    fake_pymongo_results.DeleteResult = object
    sys.modules["pymongo"] = fake_pymongo
    sys.modules["pymongo.results"] = fake_pymongo_results

if "bson" not in sys.modules:
    fake_bson = types.ModuleType("bson")
    fake_bson.ObjectId = str
    sys.modules["bson"] = fake_bson

if "flask" not in sys.modules:
    fake_flask = types.ModuleType("flask")
    fake_flask.request = SimpleNamespace()
    fake_flask.jsonify = lambda payload: payload
    fake_flask.send_file = lambda *args, **kwargs: None
    sys.modules["flask"] = fake_flask

if "flask_login" not in sys.modules:
    fake_flask_login = types.ModuleType("flask_login")

    class _FakeUserMixin:
        pass

    fake_flask_login.UserMixin = _FakeUserMixin
    sys.modules["flask_login"] = fake_flask_login

if "resend" not in sys.modules:
    fake_resend = types.ModuleType("resend")
    fake_resend.Emails = SimpleNamespace(send=lambda *_args, **_kwargs: {})
    sys.modules["resend"] = fake_resend

import api.attendance as AttendanceApi


class FakeAttendanceCollection:
    def __init__(self):
        self.docs = []
        self.last_filter = None
        self.last_update = None
        self.upsert_called = False

    def find(self, query):
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
