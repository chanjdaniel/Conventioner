from types import SimpleNamespace

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


def test_get_assignment_csv_returns_404_when_market_missing(monkeypatch):
    monkeypatch.setattr(MarketsApi.markets_collection, "find_one", lambda query: None)

    result, status = MarketsApi.get_assignment_csv("missing-market", "viewer@test.com")

    assert status == 404
    assert result["error"] == "Market not found"


def test_get_assignment_csv_returns_403_when_user_cannot_view(monkeypatch):
    monkeypatch.setattr(
        MarketsApi.markets_collection,
        "find_one",
        lambda query: _sample_market_doc_with_setup(),
    )
    monkeypatch.setattr(MarketsApi.PermissionsApi, "user_has_permission", lambda *args, **kwargs: False)

    result, status = MarketsApi.get_assignment_csv("market-123", "viewer@test.com")

    assert status == 403
    assert "does not have permission" in result["error"]


def test_get_assignment_csv_returns_400_when_setup_missing(monkeypatch):
    monkeypatch.setattr(MarketsApi.markets_collection, "find_one", lambda query: _sample_market_doc())
    monkeypatch.setattr(MarketsApi.PermissionsApi, "user_has_permission", lambda *args, **kwargs: True)

    result, status = MarketsApi.get_assignment_csv("market-123", "viewer@test.com")

    assert status == 400
    assert result["error"] == "Market has no setup configured"


def test_get_assignment_csv_bubbles_source_data_error(monkeypatch):
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

    result, status = MarketsApi.get_assignment_csv("market-123", "viewer@test.com")

    assert status == 404
    assert result["error"] == "No source data found for market"


def test_get_assignment_csv_returns_csv_string(monkeypatch):
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
    monkeypatch.setattr(
        MarketsApi,
        "assign_market",
        lambda market, source_data: SimpleNamespace(model_dump=lambda: {}),
    )
    monkeypatch.setattr(
        MarketsApi,
        "market_csv_to_string",
        lambda market_dict, source_data: "Email,Day 1\nvendor@example.com,A1 - Full Table\n",
    )

    result, status = MarketsApi.get_assignment_csv("market-123", "viewer@test.com")

    assert status == 200
    assert result["filename"] == "Test_Market_assigned.csv"
    assert result["csv_content"].startswith("Email,Day 1")
    assert "vendor@example.com" in result["csv_content"]
    assert result["market_id"] == "market-123"


def test_get_assignment_csv_surfaces_csv_value_error(monkeypatch):
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
    monkeypatch.setattr(
        MarketsApi,
        "assign_market",
        lambda market, source_data: SimpleNamespace(model_dump=lambda: {}),
    )

    def _raise_value_error(*_args, **_kwargs):
        raise ValueError("email_col_name_idx required")

    monkeypatch.setattr(MarketsApi, "market_csv_to_string", _raise_value_error)

    result, status = MarketsApi.get_assignment_csv("market-123", "viewer@test.com")

    assert status == 400
    assert "email_col_name_idx" in result["error"]


def test_market_csv_filename_sanitizes_unsafe_characters():
    assert MarketsApi._market_csv_filename("My / Weird * Market", "market-id") == "My_Weird_Market_assigned.csv"
    assert MarketsApi._market_csv_filename(None, "market-id") == "market-id_assigned.csv"
    assert MarketsApi._market_csv_filename("", "market-id") == "market-id_assigned.csv"
    assert MarketsApi._market_csv_filename("Fall 2025", "abc") == "Fall_2025_assigned.csv"


def _sample_market_doc_with_webhook():
    market = _sample_market_doc_with_setup()
    market["discordWebhookUrl"] = "https://discord.com/api/webhooks/abc/xyz"
    return market


class _FakeResponse:
    def __init__(self, status_code):
        self.status_code = status_code


def _assigned_market_for_discord():
    stats = SimpleNamespace(
        total_vendors=3,
        total_tables=2,
        total_assignments=2,
        total_assigned_vendors=2,
        total_assigned_tables=2,
        unassigned_vendors=["v3@example.com"],
        unassigned_tables={},
        assignments_per_date={"2026-01-01": 2},
        assignments_per_tier={"Gold": 2},
        assignments_per_section={"A": 2, "B": 1, "C": 1},
        assignments_per_table_choice={"Full Table": 2},
        satisfaction_score=0.85,
    )
    return SimpleNamespace(
        assignment_object=SimpleNamespace(assignment_statistics=stats)
    )


def test_post_assignment_to_discord_returns_404_when_market_missing(monkeypatch):
    monkeypatch.setattr(MarketsApi.markets_collection, "find_one", lambda query: None)

    result, status = MarketsApi.post_assignment_to_discord("missing-market", "owner@test.com")

    assert status == 404
    assert result["error"] == "Market not found"


def test_post_assignment_to_discord_returns_403_when_user_not_owner(monkeypatch):
    monkeypatch.setattr(
        MarketsApi.markets_collection,
        "find_one",
        lambda query: _sample_market_doc_with_webhook(),
    )
    monkeypatch.setattr(MarketsApi.PermissionsApi, "user_has_permission", lambda *a, **k: False)

    result, status = MarketsApi.post_assignment_to_discord("market-123", "viewer@test.com")

    assert status == 403
    assert "does not have permission" in result["error"]


def test_post_assignment_to_discord_returns_400_when_webhook_missing(monkeypatch):
    doc = _sample_market_doc_with_setup()
    doc["discordWebhookUrl"] = None
    monkeypatch.setattr(MarketsApi.markets_collection, "find_one", lambda query: doc)
    monkeypatch.setattr(MarketsApi.PermissionsApi, "user_has_permission", lambda *a, **k: True)

    result, status = MarketsApi.post_assignment_to_discord("market-123", "owner@test.com")

    assert status == 400
    assert result["error"] == "No Discord webhook configured for this market"


def test_post_assignment_to_discord_returns_400_when_setup_missing(monkeypatch):
    doc = _sample_market_doc()
    doc["discordWebhookUrl"] = "https://discord.com/api/webhooks/abc/xyz"
    monkeypatch.setattr(MarketsApi.markets_collection, "find_one", lambda query: doc)
    monkeypatch.setattr(MarketsApi.PermissionsApi, "user_has_permission", lambda *a, **k: True)

    result, status = MarketsApi.post_assignment_to_discord("market-123", "owner@test.com")

    assert status == 400
    assert result["error"] == "Market has no setup configured"


def test_post_assignment_to_discord_returns_404_when_source_data_missing(monkeypatch):
    monkeypatch.setattr(
        MarketsApi.markets_collection,
        "find_one",
        lambda query: _sample_market_doc_with_webhook(),
    )
    monkeypatch.setattr(MarketsApi.PermissionsApi, "user_has_permission", lambda *a, **k: True)
    monkeypatch.setattr(
        MarketsApi.SourceDataApi,
        "get_source_data",
        lambda market_id: ({"error": "No source data found for market"}, 404),
    )

    result, status = MarketsApi.post_assignment_to_discord("market-123", "owner@test.com")

    assert status == 404
    assert result["error"] == "No source data found for market"


def test_post_assignment_to_discord_success(monkeypatch):
    monkeypatch.setattr(
        MarketsApi.markets_collection,
        "find_one",
        lambda query: _sample_market_doc_with_webhook(),
    )
    monkeypatch.setattr(MarketsApi.PermissionsApi, "user_has_permission", lambda *a, **k: True)
    monkeypatch.setattr(
        MarketsApi.SourceDataApi,
        "get_source_data",
        lambda market_id: ({"headers": [], "data": []}, 200),
    )
    monkeypatch.setattr(MarketsApi, "assign_market", lambda m, s: _assigned_market_for_discord())

    captured = {}

    def fake_post(url, json=None, timeout=None):
        captured["url"] = url
        captured["json"] = json
        captured["timeout"] = timeout
        return _FakeResponse(204)

    monkeypatch.setattr(MarketsApi.requests, "post", fake_post)

    result, status = MarketsApi.post_assignment_to_discord("market-123", "owner@test.com")

    assert status == 200
    assert result == {"message": "Posted to Discord", "status": "ok"}
    assert captured["url"] == "https://discord.com/api/webhooks/abc/xyz"
    assert captured["timeout"] == 5
    assert "embeds" in captured["json"]
    assert captured["json"]["embeds"][0]["title"] == "Test Market"


def test_post_assignment_to_discord_returns_502_on_discord_error_status(monkeypatch):
    monkeypatch.setattr(
        MarketsApi.markets_collection,
        "find_one",
        lambda query: _sample_market_doc_with_webhook(),
    )
    monkeypatch.setattr(MarketsApi.PermissionsApi, "user_has_permission", lambda *a, **k: True)
    monkeypatch.setattr(
        MarketsApi.SourceDataApi,
        "get_source_data",
        lambda market_id: ({"headers": [], "data": []}, 200),
    )
    monkeypatch.setattr(MarketsApi, "assign_market", lambda m, s: _assigned_market_for_discord())
    monkeypatch.setattr(
        MarketsApi.requests,
        "post",
        lambda url, json=None, timeout=None: _FakeResponse(500),
    )

    result, status = MarketsApi.post_assignment_to_discord("market-123", "owner@test.com")

    assert status == 502
    assert "500" in result["error"]


def test_post_assignment_to_discord_returns_502_on_connection_error(monkeypatch):
    monkeypatch.setattr(
        MarketsApi.markets_collection,
        "find_one",
        lambda query: _sample_market_doc_with_webhook(),
    )
    monkeypatch.setattr(MarketsApi.PermissionsApi, "user_has_permission", lambda *a, **k: True)
    monkeypatch.setattr(
        MarketsApi.SourceDataApi,
        "get_source_data",
        lambda market_id: ({"headers": [], "data": []}, 200),
    )
    monkeypatch.setattr(MarketsApi, "assign_market", lambda m, s: _assigned_market_for_discord())

    def _raise_conn_error(url, json=None, timeout=None):
        raise MarketsApi.requests.ConnectionError("boom")

    monkeypatch.setattr(MarketsApi.requests, "post", _raise_conn_error)

    result, status = MarketsApi.post_assignment_to_discord("market-123", "owner@test.com")

    assert status == 502
    assert "Failed to reach Discord" in result["error"]


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
