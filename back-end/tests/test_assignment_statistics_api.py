import os
import sys
from types import SimpleNamespace
import types

# Add the parent directory to the path to import our modules
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

if "pymongo" not in sys.modules:
    fake_pymongo = types.ModuleType("pymongo")
    fake_pymongo_results = types.ModuleType("pymongo.results")

    class _FakeCollection:
        def find_one(self, *_args, **_kwargs):
            return None

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

import api.markets as MarketsApi


def _sample_market_doc():
    return {
        "id": "market-123",
        "name": "Test Market",
        "creationDate": "2026-01-01T00:00:00Z",
        "roles": {"user-123": "owner"},
        "modificationList": [],
        "assignmentObject": {
            "assignmentDate": "",
            "vendorAssignments": [],
            "assignmentStatistics": None,
        },
    }


def _sample_market_doc_with_setup():
    market = _sample_market_doc()
    market["setupObject"] = {
        "colNames": ["Email", "Table Choice", "Table Share Email", "Day 1"],
        "colValues": [],
        "colInclude": [True, True, True, True],
        "enumPriorityOrder": [],
        "priority": [],
        "marketDates": [{"date": "2026-01-01", "colNameIdx": 3, "colName": "Day 1"}],
        "tiers": [{"id": 1, "name": "Gold"}],
        "locations": [{"name": "Main Hall"}],
        "sections": [
            {
                "name": "A",
                "count": 2,
                "location": {"name": "Main Hall"},
                "tier": {"id": 1, "name": "Gold"},
            }
        ],
        "assignmentOptions": {
            "emailColNameIdx": 0,
            "tableChoiceColNameIdx": 1,
            "tableShareEmailColNameIdx": 2,
            "maxDaysColNameIdx": None,
            "maxAssignmentsPerVendor": None,
            "maxHalfTableProportionPerSection": None,
        },
    }
    return market


def test_strip_persisted_assignment_statistics_removes_stats_field():
    market_dict = {
        "assignment_object": {
            "assignment_date": "",
            "vendor_assignments": [],
            "assignment_statistics": {"total_vendors": 10},
        }
    }

    MarketsApi._strip_persisted_assignment_statistics(market_dict)

    assert "assignment_statistics" not in market_dict["assignment_object"]


def test_get_assignment_statistics_returns_404_when_market_missing(monkeypatch):
    monkeypatch.setattr(MarketsApi.markets_collection, "find_one", lambda query: None)

    result, status = MarketsApi.get_assignment_statistics("missing-market", "viewer@test.com")

    assert status == 404
    assert result["error"] == "Market not found"


def test_get_assignment_statistics_returns_403_when_user_cannot_view(monkeypatch):
    monkeypatch.setattr(MarketsApi.markets_collection, "find_one", lambda query: _sample_market_doc())
    monkeypatch.setattr(MarketsApi.PermissionsApi, "user_has_permission", lambda *args, **kwargs: False)

    result, status = MarketsApi.get_assignment_statistics("market-123", "viewer@test.com")

    assert status == 403
    assert "does not have permission" in result["error"]


def test_get_assignment_statistics_bubbles_source_data_error(monkeypatch):
    monkeypatch.setattr(MarketsApi.markets_collection, "find_one", lambda query: _sample_market_doc())
    monkeypatch.setattr(MarketsApi.PermissionsApi, "user_has_permission", lambda *args, **kwargs: True)
    monkeypatch.setattr(
        MarketsApi.SourceDataApi,
        "get_source_data",
        lambda market_id: ({"error": "No source data found for market"}, 404),
    )

    result, status = MarketsApi.get_assignment_statistics("market-123", "viewer@test.com")

    assert status == 404
    assert result["error"] == "No source data found for market"


def test_get_assignment_statistics_returns_derived_statistics(monkeypatch):
    monkeypatch.setattr(MarketsApi.markets_collection, "find_one", lambda query: _sample_market_doc())
    monkeypatch.setattr(MarketsApi.PermissionsApi, "user_has_permission", lambda *args, **kwargs: True)
    monkeypatch.setattr(
        MarketsApi.SourceDataApi,
        "get_source_data",
        lambda market_id: ({"headers": [], "data": []}, 200),
    )

    class DummyStats:
        def __init__(self):
            self.unassigned_tables = {}

        def model_dump(self):
            return {
                "total_vendors": 4,
                "total_tables": 2,
                "total_assignments": 3,
                "total_assigned_vendors": 3,
                "total_assigned_tables": 2,
                "unassigned_vendors": ["v4@example.com"],
                "unassigned_tables": {
                    date: [entry.model_dump() for entry in entries]
                    for date, entries in self.unassigned_tables.items()
                },
                "assignments_per_date": {"2026-01-01": 3},
                "assignments_per_tier": {"Gold": 2, "Silver": 1},
                "assignments_per_section": {"A": 2, "B": 1},
                "assignments_per_table_choice": {"Full table": 2, "Half table - Left": 1},
                "satisfaction_score": 75.0,
            }

    assigned_market = SimpleNamespace(
        assignment_object=SimpleNamespace(assignment_statistics=DummyStats())
    )
    monkeypatch.setattr(MarketsApi, "assign_market", lambda market, source_data: assigned_market)
    monkeypatch.setattr(
        MarketsApi,
        "derive_market_table_rows",
        lambda assigned_market: [
            MarketsApi.MarketTableRow(
                date="2026-01-01",
                assignment=["a@example.com", "a@example.com"],
                location="Main Hall",
                section="A",
                table_choice="Full Table",
                table_code="A1",
                tier="Gold",
            ),
            MarketsApi.MarketTableRow(
                date="2026-01-01",
                assignment=[],
                location="Main Hall",
                section="A",
                table_choice="Full Table",
                table_code="A2",
                tier="Gold",
            ),
            MarketsApi.MarketTableRow(
                date="2026-01-01",
                assignment=["partial@example.com"],
                location="Main Hall",
                section="A",
                table_choice="Half Table",
                table_code="A3",
                tier="Gold",
            ),
        ],
    )

    result, status = MarketsApi.get_assignment_statistics("market-123", "viewer@test.com")

    assert status == 200
    assert result["totalVendors"] == 4
    assert result["totalTables"] == 2
    assert result["assignmentsPerDate"]["2026-01-01"] == 3
    assert result["assignmentsPerTier"]["Gold"] == 2
    assert result["unassignedTables"] == {
        "2026-01-01": [
            {"tableCode": "A2", "tableChoice": "Full Table"},
            {"tableCode": "A3", "tableChoice": "Half Table"},
        ]
    }


def test_derive_unassigned_tables_from_rows_includes_partial_half_table():
    rows = [
        MarketsApi.MarketTableRow(
            date="2026-01-01",
            assignment=["full@example.com", "full@example.com"],
            location="Main Hall",
            section="A",
            table_choice="Full Table",
            table_code="A1",
            tier="Gold",
        ),
        MarketsApi.MarketTableRow(
            date="2026-01-01",
            assignment=[],
            location="Main Hall",
            section="A",
            table_choice="Full Table",
            table_code="A2",
            tier="Gold",
        ),
        MarketsApi.MarketTableRow(
            date="2026-01-01",
            assignment=["left@example.com"],
            location="Main Hall",
            section="A",
            table_choice="Half Table",
            table_code="A3",
            tier="Gold",
        ),
        MarketsApi.MarketTableRow(
            date="2026-01-01",
            assignment=["left@example.com", "right@example.com"],
            location="Main Hall",
            section="A",
            table_choice="Half Table",
            table_code="A4",
            tier="Gold",
        ),
    ]

    unassigned_tables = MarketsApi.derive_unassigned_tables_from_rows(rows)

    assert {
        date: [entry.model_dump() for entry in entries]
        for date, entries in unassigned_tables.items()
    } == {
        "2026-01-01": [
            {"table_code": "A2", "table_choice": "Full Table"},
            {"table_code": "A3", "table_choice": "Half Table"},
        ]
    }


def test_get_market_tables_returns_404_when_market_missing(monkeypatch):
    monkeypatch.setattr(MarketsApi.markets_collection, "find_one", lambda query: None)

    result, status = MarketsApi.get_market_tables("missing-market", "viewer@test.com")

    assert status == 404
    assert result["error"] == "Market not found"


def test_get_market_tables_returns_403_when_user_cannot_view(monkeypatch):
    monkeypatch.setattr(
        MarketsApi.markets_collection,
        "find_one",
        lambda query: _sample_market_doc_with_setup(),
    )
    monkeypatch.setattr(MarketsApi.PermissionsApi, "user_has_permission", lambda *args, **kwargs: False)

    result, status = MarketsApi.get_market_tables("market-123", "viewer@test.com")

    assert status == 403
    assert "does not have permission" in result["error"]


def test_get_market_tables_bubbles_source_data_error(monkeypatch):
    monkeypatch.setattr(
        MarketsApi.markets_collection,
        "find_one",
        lambda query: _sample_market_doc_with_setup(),
    )
    monkeypatch.setattr(MarketsApi.PermissionsApi, "user_has_permission", lambda *args, **kwargs: True)
    monkeypatch.setattr(
        MarketsApi.SourceDataApi,
        "get_source_data",
        lambda market_id: ({"error": "No source data found for market"}, 404),
    )

    result, status = MarketsApi.get_market_tables("market-123", "viewer@test.com")

    assert status == 404
    assert result["error"] == "No source data found for market"


def test_get_market_tables_returns_camel_case_rows(monkeypatch):
    monkeypatch.setattr(
        MarketsApi.markets_collection,
        "find_one",
        lambda query: _sample_market_doc_with_setup(),
    )
    monkeypatch.setattr(MarketsApi.PermissionsApi, "user_has_permission", lambda *args, **kwargs: True)
    monkeypatch.setattr(
        MarketsApi.SourceDataApi,
        "get_source_data",
        lambda market_id: ({"headers": [], "data": []}, 200),
    )
    monkeypatch.setattr(MarketsApi, "assign_market", lambda market, source_data: SimpleNamespace())
    monkeypatch.setattr(
        MarketsApi,
        "derive_market_table_rows",
        lambda assigned_market: [
            MarketsApi.MarketTableRow(
                date="2026-01-01",
                assignment=["a@example.com", "a@example.com"],
                location="Main Hall",
                section="A",
                table_choice="Full Table",
                table_code="A1",
                tier="Gold",
            ),
            MarketsApi.MarketTableRow(
                date="2026-01-01",
                assignment=[],
                location="Main Hall",
                section="A",
                table_choice="Full Table",
                table_code="A2",
                tier="Gold",
            ),
        ],
    )

    result, status = MarketsApi.get_market_tables("market-123", "viewer@test.com")

    assert status == 200
    assert isinstance(result, list)
    assert result[0]["assignment"] == ["a@example.com", "a@example.com"]
    assert result[0]["tableChoice"] == "Full Table"
    assert result[0]["tableCode"] == "A1"
    assert result[1]["assignment"] == []
    assert result[1]["tableCode"] == "A2"


def test_derive_market_table_rows_includes_unassigned_tables():
    assigned_market = SimpleNamespace(
        setup_object=SimpleNamespace(
            market_dates=[SimpleNamespace(date="2026-01-01", col_name="Day 1")],
            sections=[
                SimpleNamespace(
                    name="A",
                    count=2,
                    location=SimpleNamespace(name="Main Hall"),
                    tier=SimpleNamespace(name="Gold"),
                )
            ],
        ),
        assignment_object=SimpleNamespace(
            vendor_assignments=[
                SimpleNamespace(
                    email="full@example.com",
                    date="Day 1",
                    table_code="A1",
                    table_choice="Full Table",
                    section="A",
                    tier="Gold",
                    location="Main Hall",
                )
            ]
        ),
    )

    rows = MarketsApi.derive_market_table_rows(assigned_market)

    assert len(rows) == 2
    rows_by_code = {row.table_code: row for row in rows}
    assert rows_by_code["A1"].date == "2026-01-01"
    assert rows_by_code["A1"].assignment == ["full@example.com", "full@example.com"]
    assert rows_by_code["A1"].table_choice == "Full Table"
    assert rows_by_code["A2"].assignment == []
    assert rows_by_code["A2"].table_choice == "Full Table"


def test_derive_market_table_rows_builds_half_table_assignments():
    assigned_market = SimpleNamespace(
        setup_object=SimpleNamespace(
            market_dates=[SimpleNamespace(date="2026-01-01", col_name="Day 1")],
            sections=[
                SimpleNamespace(
                    name="A",
                    count=1,
                    location=SimpleNamespace(name="Main Hall"),
                    tier=SimpleNamespace(name="Gold"),
                )
            ],
        ),
        assignment_object=SimpleNamespace(
            vendor_assignments=[
                SimpleNamespace(
                    email="left@example.com",
                    date="Day 1",
                    table_code="A1",
                    table_choice="Half Table (Left)",
                    section="A",
                    tier="Gold",
                    location="Main Hall",
                ),
                SimpleNamespace(
                    email="right@example.com",
                    date="Day 1",
                    table_code="A1",
                    table_choice="Half Table (Right)",
                    section="A",
                    tier="Gold",
                    location="Main Hall",
                ),
            ]
        ),
    )

    rows = MarketsApi.derive_market_table_rows(assigned_market)

    assert len(rows) == 1
    assert rows[0].assignment == ["left@example.com", "right@example.com"]
    assert rows[0].table_choice == "Half Table"
