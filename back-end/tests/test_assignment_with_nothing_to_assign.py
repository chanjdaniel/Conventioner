"""Asking for an assignment on a market with no approved applications says so.

It used to run the solver over nobody and produce a screen that looked exactly like a completed
run: 0 assignments, 0 of 24 tables, 0 of 0 vendors, 0.0%. An organizer cannot tell that from a
market whose assignment failed.

Only the *ask* is refused. The read-only views of an assignment - the statistics, the tables grid,
the CSV - are right to show an empty market's empty picture, which is why the check lives at the
endpoint rather than inside the solver.
"""
import api.markets as MarketsApi
from assignment.assignment import NOTHING_TO_ASSIGN


def _market_doc():
    return {
        "_id": "mongo-market-id",
        "id": "market-123",
        "name": "Test Market",
        "creationDate": "2026-01-01T00:00:00Z",
        "roles": {"organizer@test.com": "owner"},
        "modificationList": [],
        "phase": "assignment",
        "isDraft": False,
        "slug": "test-market",
        "setupObject": {
            "priority": [],
            "marketDates": [{"date": "2026-08-01"}],
            "tiers": [{"id": 1, "name": "Gold"}],
            "locations": [{"name": "Main Hall"}],
            "sections": [{"name": "Front", "count": 2, "tier": {"id": 1, "name": "Gold"}}],
            "assignmentOptions": {
                "maxAssignmentsPerVendor": 1,
                "maxHalfTableProportionPerSection": 100,
            },
        },
        "assignmentObject": {"vendorAssignments": [], "assignmentStatistics": None},
    }


def _served(monkeypatch, vendors, requesting_user=None):
    monkeypatch.setattr(MarketsApi.markets_collection, "find_one", lambda _q: _market_doc())
    monkeypatch.setattr(MarketsApi.OrgsApi, "get_organization", lambda _id: None)
    monkeypatch.setattr(MarketsApi, "solver_vendors_for", lambda _market: vendors)
    return MarketsApi.get_assigned_market("market-123", requesting_user)


def test_an_empty_approved_set_is_refused_rather_than_assigned(monkeypatch):
    result, status = _served(monkeypatch, [])

    assert status == 400
    assert result["error"] == NOTHING_TO_ASSIGN


def test_the_refusal_names_the_step_the_organizer_has_to_take(monkeypatch):
    result, _ = _served(monkeypatch, [])

    assert "Approve applications" in result["error"]


def test_the_solver_never_runs_on_an_empty_set(monkeypatch):
    ran = []
    monkeypatch.setattr(
        MarketsApi, "assign_market", lambda *args: ran.append(args) or args[0]
    )

    _served(monkeypatch, [])

    assert ran == []
