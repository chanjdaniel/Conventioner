"""Every verdict says who gave it, and a reviewer gives one at EDITOR (E34/F01/S01).

With a team reviewing, "who decided this" had no answer: a verdict was an unconditional write that
recorded nobody, and giving one needed ADMIN, which also moves the market's phase. A verdict now
stores its giver and time beside the status, and an EDITOR may give one; moving the phase stays
ADMIN.
"""
import os
import sys
from types import SimpleNamespace

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import api.applicants as ApplicantsApi  # noqa: E402
import api.applications as ApplicationsApi  # noqa: E402
import api.market_actions as Actions  # noqa: E402
import api.markets as MarketsApi  # noqa: E402
import api.users as UsersApi  # noqa: E402
from conftest import FakeApplicationsCollection, sessions_load_through_get_user  # noqa: E402
from datatypes import ApplicationStatus, MarketPhase, VerdictGiver  # noqa: E402

ALEX = VerdictGiver(kind="person", user_id="user-alex", email="alex@market.test")


def _application(status=ApplicationStatus.OPEN, **extra):
    return {
        "id": "app-1", "market_id": "market-1", "applicant_email": "vendor@example.com",
        "form_data": {}, "status": status.value, "application_type": "main",
        "submitted_at": None, "updated_at": "2026-10-01T00:00:00Z", **extra,
    }


@pytest.fixture
def stored(monkeypatch):
    fake = FakeApplicationsCollection()
    fake.documents = [_application()]
    monkeypatch.setattr(ApplicationsApi, "applications_collection", fake)
    return fake.documents


class TestTheGiverIsStored:
    def test_a_verdict_stores_its_giver_and_time_and_serves_them(self, stored):
        result, status = ApplicantsApi.review_application(
            "market-1", "app-1", ApplicationStatus.REVIEWER_APPROVED, by=ALEX)

        assert status == 200
        assert stored[0]["verdict_by"] == {
            "kind": "person", "user_id": "user-alex", "email": "alex@market.test", "rule": None}
        assert stored[0]["verdict_at"]
        served = result["application"]
        assert served["verdictBy"]["email"] == "alex@market.test"
        assert served["verdictAt"] == stored[0]["verdict_at"]

    def test_a_status_that_is_no_verdict_clears_the_giver(self, stored):
        ApplicantsApi.review_application(
            "market-1", "app-1", ApplicationStatus.REVIEWER_APPROVED, by=ALEX)

        # Answers that changed send an approval back to review (the import, E32/F02/S02).
        ApplicationsApi.update_application_status("app-1", ApplicationStatus.OPEN)

        assert "verdict_by" not in stored[0] and "verdict_at" not in stored[0]

    def test_an_application_stored_before_this_has_no_giver(self, stored):
        stored[0]["status"] = ApplicationStatus.REVIEWER_REJECTED.value

        result, _ = ApplicantsApi.list_market_applications("market-1")

        assert result["applications"][0]["verdictBy"] is None
        assert result["applications"][0]["verdictAt"] is None


@pytest.fixture
def client(monkeypatch):
    import app as app_module
    from conftest import stored_market

    monkeypatch.setattr(app_module.login_manager, "session_protection", None)
    people = {"editor@market.test": "user-editor", "viewer@market.test": "user-viewer"}

    def _get_user(email):
        if email not in people:
            return None
        return SimpleNamespace(id=people[email], email=email, is_active=True, is_authenticated=True,
                               is_anonymous=False, get_id=lambda e=email: e)

    sessions_load_through_get_user(monkeypatch)
    monkeypatch.setattr(UsersApi, "get_user", _get_user)
    document = stored_market(MarketPhase.APPLICATIONS, id="market-1", organizationId=None,
                             roles={"user-owner": "owner", "user-editor": "editor",
                                    "user-viewer": "viewer"})

    class Markets:
        def find_one(self, query, *args, **kwargs):
            return dict(document) if query.get("id") in (None, "market-1") else None

    monkeypatch.setattr(MarketsApi, "markets_collection", Markets())
    given = []
    monkeypatch.setattr(ApplicantsApi, "review_application",
                        lambda market_id, application_id, status, by, owner=None, seen=None, **_kw: (
                            given.append((status, by)) or ({"application": {}}, 200)))
    client = app_module.app.test_client()
    client.given = given
    return client


def _as(client, email):
    with client.session_transaction() as session:
        session["_user_id"] = email


class TestAnEditorGivesVerdicts:
    def test_an_editor_may_decide_and_is_named_its_giver(self, client):
        _as(client, "editor@market.test")

        response = client.put("/markets/market-1/applications/app-1/review",
                              json={"status": "reviewer_rejected"})

        assert response.status_code == 200
        assert client.given == [(ApplicationStatus.REVIEWER_REJECTED, VerdictGiver(
            kind="person", user_id="user-editor", email="editor@market.test"))]

    def test_a_viewer_may_not(self, client):
        _as(client, "viewer@market.test")

        response = client.put("/markets/market-1/applications/app-1/review",
                              json={"status": "reviewer_rejected"})

        assert response.status_code == 403
        assert client.given == []

    def test_an_editor_still_cannot_move_the_phase(self, client):
        _as(client, "editor@market.test")

        response = client.post("/markets/market-1/transition", json={"toPhase": "assignment"})

        assert response.status_code == 403


class TestWhenAVerdictMayChange:
    """While the market can still get back to review (E36/F01/S01): from assignment on, a verdict is
    the review's record, and a mistake is fixed with a seat placed or freed by hand."""

    @pytest.mark.parametrize("phase", [MarketPhase.APPLICATIONS])
    def test_open_while_the_review_is(self, phase, monkeypatch):
        monkeypatch.setattr(Actions, "refusal", lambda *_a: None)
        from conftest import client_market

        assert MarketsApi.verdict_refusal("e@x.test", client_market(phase=phase), None) is None

    @pytest.mark.parametrize("phase", [MarketPhase.ASSIGNMENT, MarketPhase.OFFERS,
                                       MarketPhase.MARKET_DAYS])
    def test_settled_on_entering_assignment(self, phase, monkeypatch):
        monkeypatch.setattr(Actions, "refusal", lambda *_a: None)
        from conftest import client_market

        assert MarketsApi.verdict_refusal(
            "e@x.test", client_market(phase=phase), None) == MarketsApi.VERDICTS_SETTLED

    @pytest.mark.parametrize("phase", list(MarketPhase))
    def test_the_verdicts_and_the_automatic_rejections_settle_together(self, phase, monkeypatch):
        """One rule, not two that agree today: a rule and a reviewer judge the same applications."""
        monkeypatch.setattr(Actions, "refusal", lambda *_a: None)
        from conftest import client_market

        verdicts_open = MarketsApi.verdict_refusal(
            "e@x.test", client_market(phase=phase), None) is None
        rules_open = MarketsApi.rejection_rules_lock_reason(phase) is None
        assert verdicts_open == rules_open or phase is MarketPhase.ARCHIVED

    def test_a_person_who_may_not_change_the_market_is_told_that_first(self, monkeypatch):
        monkeypatch.setattr(Actions, "refusal", lambda *_a: "Viewers read.")
        from conftest import client_market

        assert MarketsApi.verdict_refusal(
            "e@x.test", client_market(phase=MarketPhase.MARKET_DAYS), None) == "Viewers read."
