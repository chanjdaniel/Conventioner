"""Giving a verdict is an Editor's; changing one is an Admin's or the owner's (E38/F06/S01).

One gate covered both, Editor and above, so an Editor could turn an approval into a rejection, or
overturn an automatic rejection, as freely as they gave a first verdict. A verdict is approved or
rejected: giving one to an open application or a follow-up stays an Editor's, and any write on an
application already approved or rejected - the other verdict, back to needs follow-up - is a change,
refused below Admin with a sentence the screen can show.
"""
import os
import sys
from types import SimpleNamespace

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import api.applications as ApplicationsApi  # noqa: E402
import api.markets as MarketsApi  # noqa: E402
from api.permissions import ROLE_RANK  # noqa: E402
import api.users as UsersApi  # noqa: E402
from conftest import client_market, sessions_load_through_get_user, stored_market  # noqa: E402
from datatypes import ApplicationStatus, MarketPhase, MarketRole, VerdictGiver  # noqa: E402

PEOPLE = {
    "owner@market.test": "user-owner",
    "admin@market.test": "user-admin",
    "editor@market.test": "user-editor",
    "viewer@market.test": "user-viewer",
}
RULE = {"kind": "rule", "user_id": None, "email": None, "rule": "rule-1"}
KAI = {"kind": "person", "user_id": "user-kai", "email": "kai@market.test", "rule": None}

APPROVED = ApplicationStatus.REVIEWER_APPROVED
REJECTED = ApplicationStatus.REVIEWER_REJECTED
FOLLOW_UP = ApplicationStatus.NEEDS_FOLLOW_UP


def _application(app_id, status, by=None):
    decided = status in (APPROVED, REJECTED, FOLLOW_UP)
    return {
        "id": app_id, "market_id": "market-1", "applicant_email": f"{app_id}@example.com",
        "form_data": {}, "status": status.value, "application_type": "main",
        "submitted_at": None, "updated_at": "2026-10-01T00:00:00Z",
        "verdict_at": "2026-10-02T00:00:00+00:00" if decided else None,
        **({"verdict_by": by or KAI} if decided else {}),
        **({"follow_up_owner": {"user_id": "user-kai", "email": "kai@market.test"}}
           if status is FOLLOW_UP else {}),
    }


def _seen(doc):
    return {"status": doc["status"], "verdictAt": doc["verdict_at"]}


@pytest.fixture
def client(monkeypatch, applications):
    import app as app_module

    monkeypatch.setattr(app_module.login_manager, "session_protection", None)

    def _get_user(email):
        if email not in PEOPLE:
            return None
        return SimpleNamespace(id=PEOPLE[email], email=email, is_active=True, is_authenticated=True,
                               is_anonymous=False, get_id=lambda e=email: e)

    sessions_load_through_get_user(monkeypatch)
    monkeypatch.setattr(UsersApi, "get_user", _get_user)
    document = stored_market(MarketPhase.REVIEW, id="market-1", _id="mongo-1", organizationId=None,
                             roles={"user-owner": "owner", "user-admin": "admin",
                                    "user-editor": "editor", "user-viewer": "viewer"})

    class Markets:
        def find_one(self, query, *args, **kwargs):
            return dict(document) if query.get("id") in (None, "market-1") else None

    monkeypatch.setattr(MarketsApi, "markets_collection", Markets())
    applications.documents = [
        _application("open", ApplicationStatus.OPEN),
        _application("follow-up", FOLLOW_UP),
        _application("approved", APPROVED),
        _application("rejected", REJECTED),
        _application("ruled-out", REJECTED, by=RULE),
    ]
    client = app_module.app.test_client()
    client.stored = {doc["id"]: doc for doc in applications.documents}
    return client


def _as(client, email):
    with client.session_transaction() as session:
        session["_user_id"] = email


def _review(client, app_id, status, seen=True):
    body = {"status": status.value}
    if seen:
        body["seen"] = _seen(client.stored[app_id])
    return client.put(f"/markets/market-1/applications/{app_id}/review", json=body)


class TestAnEditorGivesAVerdict:
    @pytest.mark.parametrize("app_id", ["open", "follow-up"])
    @pytest.mark.parametrize("status", [APPROVED, REJECTED])
    def test_on_an_open_application_or_a_follow_up(self, client, app_id, status):
        _as(client, "editor@market.test")

        response = _review(client, app_id, status)

        assert response.status_code == 200
        assert client.stored[app_id]["status"] == status.value
        assert client.stored[app_id]["verdict_by"]["email"] == "editor@market.test"

    def test_and_marks_an_open_one_for_follow_up(self, client):
        _as(client, "editor@market.test")

        assert _review(client, "open", FOLLOW_UP).status_code == 200


class TestAnEditorChangesNone:
    @pytest.mark.parametrize("app_id,status", [
        ("approved", REJECTED), ("rejected", APPROVED),
        ("approved", FOLLOW_UP), ("rejected", FOLLOW_UP),
        ("ruled-out", APPROVED),
    ])
    def test_is_refused_with_a_sentence_to_show(self, client, app_id, status):
        _as(client, "editor@market.test")
        before = dict(client.stored[app_id])

        response = _review(client, app_id, status)

        assert response.status_code == 403
        assert response.get_json() == {"error": MarketsApi.CHANGING_A_VERDICT}
        assert client.stored[app_id] == before

    def test_refused_without_saying_what_they_saw(self, client):
        """``seen`` is optional on the wire: without it the write is not conditional, and the rule
        must still hold."""
        _as(client, "editor@market.test")

        response = _review(client, "approved", REJECTED, seen=False)

        assert response.status_code == 403
        assert client.stored["approved"]["status"] == APPROVED.value

    def test_a_verdict_given_in_between_is_still_written_over_by_nobody(self, client):
        """An Editor who opened the card open, after someone else approved it, is told who did (409),
        as two reviewers always were; the write never lands on the decided application."""
        _as(client, "editor@market.test")
        seen = _seen(client.stored["open"])
        client.stored["open"].update(status=APPROVED.value, verdict_by=KAI,
                                     verdict_at="2026-10-03T00:00:00+00:00")

        response = client.put("/markets/market-1/applications/open/review",
                              json={"status": REJECTED.value, "seen": seen})

        assert response.status_code == 409
        assert client.stored["open"]["status"] == APPROVED.value

    def test_nor_on_a_selection_whose_decided_rows_are_skipped_saying_why(self, client):
        _as(client, "editor@market.test")
        ticked = ["open", "rejected", "ruled-out"]

        response = client.post("/markets/market-1/applications/verdicts", json={
            "status": APPROVED.value,
            "applications": [{"id": i, "seen": _seen(client.stored[i])} for i in ticked],
        })

        assert response.status_code == 200
        assert response.get_json() == {
            "written": ["open"],
            "skipped": [
                {"id": "rejected", "email": "rejected@example.com",
                 "reason": MarketsApi.CHANGING_A_VERDICT},
                {"id": "ruled-out", "email": "ruled-out@example.com",
                 "reason": MarketsApi.CHANGING_A_VERDICT},
            ],
        }
        assert client.stored["rejected"]["status"] == REJECTED.value


class TestAnAdminAndTheOwnerChangeVerdicts:
    @pytest.mark.parametrize("email", ["admin@market.test", "owner@market.test"])
    @pytest.mark.parametrize("app_id,status", [
        ("approved", REJECTED), ("rejected", APPROVED),
        ("approved", FOLLOW_UP), ("ruled-out", APPROVED),
    ])
    def test_any_verdict_an_automatic_rejection_included(self, client, email, app_id, status):
        _as(client, email)

        response = _review(client, app_id, status)

        assert response.status_code == 200
        assert client.stored[app_id]["status"] == status.value
        assert client.stored[app_id]["verdict_by"] == VerdictGiver(
            kind="person", user_id=PEOPLE[email], email=email).model_dump()

    @pytest.mark.parametrize("email", ["admin@market.test", "owner@market.test"])
    def test_on_a_selection(self, client, email):
        _as(client, email)
        ticked = ["rejected", "ruled-out"]

        response = client.post("/markets/market-1/applications/verdicts", json={
            "status": APPROVED.value,
            "applications": [{"id": i, "seen": _seen(client.stored[i])} for i in ticked],
        })

        assert response.get_json()["written"] == ["rejected", "ruled-out"]

    def test_a_viewer_neither_gives_nor_changes(self, client):
        _as(client, "viewer@market.test")

        assert _review(client, "open", APPROVED).status_code == 403
        assert _review(client, "approved", REJECTED).status_code == 403


class TestTheReasonIsServed:
    """``verdictChangeReason``: why this person cannot change a verdict here, so every review screen
    offers a change exactly when the write would take it."""

    @pytest.mark.parametrize("role", [MarketRole.ADMIN, MarketRole.OWNER])
    def test_none_for_an_admin_and_the_owner(self, role, monkeypatch):
        monkeypatch.setattr(MarketsApi, "verdict_refusal", lambda *_a: None)
        monkeypatch.setattr(MarketsApi.PermissionsApi, "user_has_permission",
                            lambda _e, _m, needed, _o: ROLE_RANK[needed] <= ROLE_RANK[role])

        assert MarketsApi.verdict_change_refusal(
            "a@x.test", client_market(phase=MarketPhase.REVIEW), None) is None

    def test_the_sentence_for_an_editor(self, monkeypatch):
        monkeypatch.setattr(MarketsApi, "verdict_refusal", lambda *_a: None)
        monkeypatch.setattr(MarketsApi.PermissionsApi, "user_has_permission",
                            lambda _e, _m, needed, _o: ROLE_RANK[needed] <= ROLE_RANK[MarketRole.EDITOR])

        assert MarketsApi.verdict_change_refusal(
            "e@x.test", client_market(phase=MarketPhase.REVIEW), None) == MarketsApi.CHANGING_A_VERDICT

    def test_whoever_gives_no_verdict_changes_none_and_is_told_that_first(self, monkeypatch):
        monkeypatch.setattr(MarketsApi, "verdict_refusal", lambda *_a: "The review is closed.")

        assert MarketsApi.verdict_change_refusal(
            "o@x.test", client_market(phase=MarketPhase.ASSIGNMENT), None) == "The review is closed."

    def test_on_the_market_read(self, client):
        _as(client, "editor@market.test")
        editor = client.get("/markets/market-1").get_json()["market"]
        _as(client, "admin@market.test")
        admin = client.get("/markets/market-1").get_json()["market"]

        assert editor["verdictLockReason"] is None
        assert editor["verdictChangeReason"] == MarketsApi.CHANGING_A_VERDICT
        assert admin["verdictChangeReason"] is None
