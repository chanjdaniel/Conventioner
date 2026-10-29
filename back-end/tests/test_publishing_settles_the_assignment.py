"""Publishing settles the table allocation (E36/F04/S02).

Once applicants have been told whether they have a table, allocating again could move them: so
tables are not allocated again, the assignment rules lock with it, and assignments change only by
hand. And a market whose vendors
apply on its page does not go live until they have been told.
"""
import pytest

import api.markets as MarketsApi
import api.placements as PlacementsApi
import guards as Guards
from conftest import FakeMarketsCollection, client_market, stored_market
from datatypes import IntakeMode, MarketPhase


def published(phase=MarketPhase.ASSIGNMENT, **overrides):
    return client_market(phase=phase, results_published=True, **overrides)


class TestTheRunAfterPublishing:
    def test_it_is_refused_saying_why(self):
        refusal = PlacementsApi.assign_refusal(published())

        assert "published" in refusal
        assert "Result page" in refusal

    def test_before_publishing_it_runs_as_ever(self):
        assert PlacementsApi.assign_refusal(client_market(phase=MarketPhase.ASSIGNMENT)) is None

    def test_the_endpoint_refuses_it(self, monkeypatch):
        import api.permissions as PermissionsApi
        monkeypatch.setattr(MarketsApi, "markets_collection", FakeMarketsCollection(
            stored_market(MarketPhase.ASSIGNMENT, resultsPublished=True)))
        monkeypatch.setattr(PermissionsApi, "user_has_permission", lambda *_a, **_k: True)

        with pytest.raises(PlacementsApi.AssignPhaseError, match="published"):
            PlacementsApi.run_assignment("market-123", "user-1")


class TestTheRulesAfterPublishing:
    def test_they_lock(self):
        assert MarketsApi.assignment_rules_lock_reason(published()) == \
            MarketsApi.ASSIGNMENT_RULES_PUBLISHED

    def test_before_publishing_they_stay_open_in_assignment(self):
        assert MarketsApi.assignment_rules_lock_reason(
            client_market(phase=MarketPhase.ASSIGNMENT)) is None


class TestGoingLive:
    guard = Guards.ResultsPublishedGuard()

    def test_a_form_market_waits_for_its_results(self):
        result = self.guard.evaluate(
            client_market(phase=MarketPhase.ASSIGNMENT, intake_mode=IntakeMode.FORM), None)

        assert not result.passed
        assert result.resolution_link == "applications"

    def test_once_published_it_may_go(self):
        result = self.guard.evaluate(published(intake_mode=IntakeMode.FORM), None)

        assert result.passed

    def test_a_csv_market_has_nobody_to_tell(self):
        result = self.guard.evaluate(
            client_market(phase=MarketPhase.ASSIGNMENT, intake_mode=IntakeMode.CSV), None)

        assert result.passed

    def test_every_way_into_market_days_carries_it(self):
        assert self.guard.id in {g.id for g in Guards.PHASE_ENTRY_INVARIANTS["market_days"]}
