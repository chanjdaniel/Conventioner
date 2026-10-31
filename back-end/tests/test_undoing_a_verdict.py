"""The person who gave a verdict undoes it within 2 minutes (E38/F10/S01).

A verdict was one click or one key with no way back for whoever gave it: an Editor who rejected by
mistake could not put it right, since changing a verdict is an Admin's (E38/F06/S01). Now the giver,
whatever their role - an Editor, a chosen Viewer - takes their own verdict back within
``UNDO_WINDOW``, while they may still give verdicts and the review is open. The undo is giving,
taken back: it asks the giving row, never the change row. It returns the application to what it was
before the verdict, open or needs follow-up with its owner, still dealt to whom it was dealt, and
only while nobody has written over the verdict since. After the window, or for someone else's
verdict, it is refused, and changing the verdict stays an Admin's.
"""
from datetime import datetime, timedelta, timezone

import pytest

from test_choosing_reviewers_deals_the_open_applications import (  # noqa: F401  (the fixture)
    ADMIN, CAT, EDITOR, MARKET, OWNER, VIEWER, _choose, _client, world,
)

import api.applications as ApplicationsApi
import history as History
from datatypes import ApplicationStatus, MarketPhase, VerdictGiver

UNDO_REFUSED = "This verdict can no longer be undone here. An Admin or the owner can change it."
# Its own sentence, never the review route's: an undo hands a follow-up to nobody (E38/F10/S01).
OWNER_GONE = (
    "This verdict can no longer be undone here: the follow-up it closed would come back to an "
    "owner you cannot see on this market. An Admin or the market's owner can change it.")


def _doc(world, app_id):
    return next(d for d in world.applications.documents if d["id"] == app_id)


def _seen(doc):
    return {"status": doc["status"], "verdictAt": doc.get("verdict_at")}


def _give(who, app_id, status, owner=None):
    body = {"status": status, **({"ownerEmail": owner} if owner else {})}
    response = _client(who).put(f"/markets/{MARKET}/applications/{app_id}/review", json=body)
    assert response.status_code == 200, response.get_json()
    return response.get_json()["application"]


def _undo(who, app_id, seen):
    return _client(who).post(f"/markets/{MARKET}/applications/{app_id}/review/undo",
                             json={"seen": seen})


def _undo_selection(who, items):
    return _client(who).post(f"/markets/{MARKET}/applications/verdicts/undo",
                             json={"applications": items})


def _seen_of(application):
    """``seen`` as the client sends it, from the application a verdict's answer carried."""
    return {"status": application["status"], "verdictAt": application["verdictAt"]}


def _ago(minutes):
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat()


def _entries(world, kind):
    return [entry for entry in world.history.documents if entry["kind"] == kind]


class TestTheWindow:
    def test_is_two_minutes(self):
        assert ApplicationsApi.UNDO_WINDOW == timedelta(minutes=2)

    def test_a_verdicts_answer_says_how_long_it_may_be_undone(self, world):
        response = _client(EDITOR).put(f"/markets/{MARKET}/applications/app-v1/review",
                                       json={"status": "reviewer_rejected"})

        assert response.get_json()["undoSeconds"] == 120

    def test_a_selections_answer_says_it_too(self, world):
        response = _client(EDITOR).post(f"/markets/{MARKET}/applications/verdicts", json={
            "status": "reviewer_rejected", "applications": [{"id": "app-v1"}]})

        assert response.get_json()["undoSeconds"] == 120


class TestTheGiverUndoes:
    @pytest.mark.parametrize("status", ["reviewer_rejected", "reviewer_approved", "needs_follow_up"])
    def test_an_editors_verdict_on_an_open_application(self, world, status):
        given = _give(EDITOR, "app-v1", status)

        response = _undo(EDITOR, "app-v1", _seen_of(given))

        assert response.status_code == 200, response.get_json()
        doc = _doc(world, "app-v1")
        assert doc["status"] == "open"
        assert "verdict_by" not in doc and "verdict_at" not in doc
        assert "follow_up_owner" not in doc
        assert response.get_json()["application"]["status"] == "open"

    def test_a_follow_ups_verdict_comes_back_with_its_owner(self, world):
        given = _give(EDITOR, "app-follow-up", "reviewer_approved")

        response = _undo(EDITOR, "app-follow-up", _seen_of(given))

        assert response.status_code == 200, response.get_json()
        doc = _doc(world, "app-follow-up")
        assert doc["status"] == "needs_follow_up"
        assert doc["follow_up_owner"]["email"] == EDITOR

    def test_a_follow_up_owned_by_someone_else_comes_back_owned_by_them(self, world):
        _doc(world, "app-follow-up")["follow_up_owner"] = {"user_id": "user-admin",
                                                           "email": ADMIN}
        given = _give(EDITOR, "app-follow-up", "reviewer_rejected")

        response = _undo(EDITOR, "app-follow-up", _seen_of(given))

        assert response.status_code == 200, response.get_json()
        assert _doc(world, "app-follow-up")["follow_up_owner"]["email"] == ADMIN

    def test_the_application_stays_dealt_to_its_reviewer(self, world):
        assert _choose([CAT, EDITOR]).status_code == 200
        dealt = _doc(world, "app-v1")["reviewer"]
        given = _give(EDITOR, "app-v1", "reviewer_rejected")

        assert _undo(EDITOR, "app-v1", _seen_of(given)).status_code == 200

        assert _doc(world, "app-v1")["reviewer"] == dealt

    @pytest.mark.parametrize("who", [EDITOR, ADMIN, OWNER])
    def test_each_role_that_gives_verdicts_undoes_its_own(self, world, who):
        given = _give(who, "app-v1", "reviewer_rejected")

        assert _undo(who, "app-v1", _seen_of(given)).status_code == 200

    def test_a_chosen_viewer_undoes_their_own(self, world):
        assert _choose([VIEWER]).status_code == 200
        given = _give(VIEWER, "app-v1", "reviewer_rejected")

        response = _undo(VIEWER, "app-v1", _seen_of(given))

        assert response.status_code == 200, response.get_json()
        assert _doc(world, "app-v1")["status"] == "open"

    def test_an_editor_is_not_asked_the_change_row(self, world):
        # The change row stays the Admin's default: the undo of a just-given verdict is not one.
        given = _give(EDITOR, "app-v1", "reviewer_approved")

        assert _undo(EDITOR, "app-v1", _seen_of(given)).status_code == 200


class TestRefused:
    def test_after_the_window(self, world):
        given = _give(EDITOR, "app-v1", "reviewer_rejected")
        _doc(world, "app-v1")["verdict_at"] = _ago(3)
        before = dict(_doc(world, "app-v1"))

        response = _undo(EDITOR, "app-v1", _seen(_doc(world, "app-v1")))

        assert response.status_code == 403
        assert response.get_json() == {"error": UNDO_REFUSED}
        assert _doc(world, "app-v1") == before
        assert given["status"] == "reviewer_rejected"

    def test_for_a_verdict_someone_else_gave(self, world):
        given = _give(ADMIN, "app-v1", "reviewer_rejected")

        response = _undo(EDITOR, "app-v1", _seen_of(given))

        assert response.status_code == 403
        assert response.get_json() == {"error": UNDO_REFUSED}
        assert _doc(world, "app-v1")["status"] == "reviewer_rejected"

    def test_by_an_admin_for_someone_elses_verdict_too(self, world):
        given = _give(EDITOR, "app-v1", "reviewer_rejected")

        assert _undo(ADMIN, "app-v1", _seen_of(given)).status_code == 403

    def test_for_an_automatic_rejection(self, world):
        doc = _doc(world, "app-v1")
        doc.update(status="reviewer_rejected", verdict_at=_ago(0),
                   verdict_by={"kind": "rule", "user_id": None, "email": None, "rule": "x"})

        assert _undo(EDITOR, "app-v1", _seen(doc)).status_code == 403

    def test_on_an_application_with_no_verdict(self, world):
        response = _undo(EDITOR, "app-v1", _seen(_doc(world, "app-v1")))

        assert response.status_code == 403
        assert response.get_json() == {"error": UNDO_REFUSED}

    def test_a_verdict_written_over_since_is_not_written_over(self, world):
        given = _give(EDITOR, "app-v1", "reviewer_rejected")
        _give(ADMIN, "app-v1", "reviewer_approved")

        response = _undo(EDITOR, "app-v1", _seen_of(given))

        assert response.status_code == 409
        body = response.get_json()
        assert body["error"] == f"{ADMIN} approved this application since you opened it."
        assert body["application"]["status"] == "reviewer_approved"
        assert _doc(world, "app-v1")["status"] == "reviewer_approved"

    def test_a_verdict_given_again_by_the_giver_is_stale_too(self, world):
        first = _give(EDITOR, "app-v1", "reviewer_rejected")
        _doc(world, "app-v1")["verdict_at"] = _ago(0.5)

        assert _undo(EDITOR, "app-v1", _seen_of(first)).status_code == 409

    def test_on_a_closed_review(self, world):
        given = _give(EDITOR, "app-v1", "reviewer_rejected")
        world.markets.doc["phase"] = MarketPhase.ASSIGNMENT.value

        response = _undo(EDITOR, "app-v1", _seen_of(given))

        assert response.status_code == 403
        assert _doc(world, "app-v1")["status"] == "reviewer_rejected"

    def test_for_someone_who_no_longer_gives_verdicts(self, world):
        assert _choose([VIEWER]).status_code == 200
        given = _give(VIEWER, "app-v1", "reviewer_rejected")
        assert _choose([CAT]).status_code == 200

        response = _undo(VIEWER, "app-v1", _seen_of(given))

        assert response.status_code == 403
        assert _doc(world, "app-v1")["status"] == "reviewer_rejected"

    def test_without_saying_what_they_saw(self, world):
        _give(EDITOR, "app-v1", "reviewer_rejected")

        response = _client(EDITOR).post(
            f"/markets/{MARKET}/applications/app-v1/review/undo", json={})

        assert response.status_code == 400

    def test_of_another_markets_application(self, world):
        given = _give(EDITOR, "app-v1", "reviewer_rejected")
        _doc(world, "app-v1")["market_id"] = "market-2"

        response = _undo(EDITOR, "app-v1", _seen_of(given))

        assert response.status_code == 404


class TestWhatItComesBackTo:
    """The server keeps what the application was when the verdict was written, and the undo
    returns it to that: never what the request names (the review's finding 1)."""

    def test_a_follow_up_comes_back_a_follow_up_whatever_the_request_names(self, world):
        given = _give(EDITOR, "app-follow-up", "reviewer_approved")

        response = _client(EDITOR).post(
            f"/markets/{MARKET}/applications/app-follow-up/review/undo",
            json={"seen": _seen_of(given), "back": "open"})

        assert response.status_code == 200, response.get_json()
        doc = _doc(world, "app-follow-up")
        assert doc["status"] == "needs_follow_up"
        assert doc["follow_up_owner"] == {"user_id": "user-editor", "email": EDITOR}

    def test_a_follow_up_comes_back_with_its_marker_and_time(self, world):
        doc = _doc(world, "app-follow-up")
        doc["verdict_by"] = {"kind": "person", "user_id": "user-admin", "email": ADMIN}
        doc["follow_up_owner"] = {"user_id": "user-admin", "email": ADMIN}
        given = _give(EDITOR, "app-follow-up", "reviewer_rejected")

        assert _undo(EDITOR, "app-follow-up", _seen_of(given)).status_code == 200

        doc = _doc(world, "app-follow-up")
        assert doc["verdict_by"] == {"kind": "person", "user_id": "user-admin", "email": ADMIN}
        assert doc["verdict_at"] == "2026-10-09T00:00:00+00:00"
        assert "undo_to" not in doc

    def test_a_follow_up_brought_back_is_not_undone_again(self, world):
        given = _give(EDITOR, "app-follow-up", "reviewer_approved")
        undone = _undo(EDITOR, "app-follow-up", _seen_of(given)).get_json()["application"]

        response = _undo(EDITOR, "app-follow-up", _seen_of(undone))

        assert response.status_code == 403
        assert _doc(world, "app-follow-up")["status"] == "needs_follow_up"

    def test_what_is_kept_is_what_was_there_when_the_verdict_landed(self, world):
        # A follow-up handed on between the reviewer's read and their verdict's write: the write
        # does not land, rather than keep an owner the follow-up no longer had.
        read = dict(_doc(world, "app-follow-up"))
        _doc(world, "app-follow-up")["follow_up_owner"] = {"user_id": "user-admin",
                                                           "email": ADMIN}
        giver = VerdictGiver(kind="person", user_id="user-editor", email=EDITOR)

        written = ApplicationsApi.update_application_status(
            "app-follow-up", ApplicationStatus.REVIEWER_APPROVED, by=giver,
            kept_for_undo=ApplicationsApi.undo_to_of(read))

        assert written is False
        assert _doc(world, "app-follow-up")["status"] == "needs_follow_up"

    def test_any_other_write_clears_what_was_kept(self, world):
        _give(EDITOR, "app-v1", "reviewer_rejected")
        assert _doc(world, "app-v1")["undo_to"]["status"] == "open"

        ApplicationsApi.update_application_status(
            "app-v1", ApplicationStatus.REVIEWER_REJECTED,
            by=VerdictGiver(kind="rule", rule="x"), reason="r")

        assert "undo_to" not in _doc(world, "app-v1")

    def test_a_verdict_that_kept_nothing_is_not_undone(self, world):
        doc = _doc(world, "app-v1")
        doc.update(status="reviewer_rejected", verdict_at=_ago(0),
                   verdict_by={"kind": "person", "user_id": "user-editor", "email": EDITOR})

        assert _undo(EDITOR, "app-v1", _seen(doc)).status_code == 403
        assert _doc(world, "app-v1")["status"] == "reviewer_rejected"

    def test_a_verdict_that_changed_one_is_not_undone(self, world):
        _give(EDITOR, "app-v1", "reviewer_rejected")
        changed = _give(ADMIN, "app-v1", "reviewer_approved")

        response = _undo(ADMIN, "app-v1", _seen_of(changed))

        assert response.status_code == 403
        assert response.get_json() == {"error": UNDO_REFUSED}
        assert _doc(world, "app-v1")["status"] == "reviewer_approved"

    def test_a_verdict_that_changed_one_offers_no_undo(self, world):
        _give(EDITOR, "app-v1", "reviewer_rejected")

        response = _client(ADMIN).put(f"/markets/{MARKET}/applications/app-v1/review",
                                      json={"status": "reviewer_approved"})

        assert "undoSeconds" not in response.get_json()

    def test_a_selection_that_changed_one_offers_no_undo(self, world):
        response = _client(ADMIN).post(f"/markets/{MARKET}/applications/verdicts", json={
            "status": "reviewer_rejected",
            "applications": [{"id": "app-v1"}, {"id": "app-decided"}]})

        assert response.get_json()["written"] == ["app-v1", "app-decided"]
        assert "undoSeconds" not in response.get_json()

    def test_a_follow_up_whose_owner_lost_their_role_is_not_brought_back(self, world):
        _doc(world, "app-follow-up")["follow_up_owner"] = {"user_id": "user-admin",
                                                           "email": ADMIN}
        given = _give(EDITOR, "app-follow-up", "reviewer_approved")
        del world.markets.doc["roles"]["user-admin"]

        response = _undo(EDITOR, "app-follow-up", _seen_of(given))

        assert response.status_code == 400
        assert response.get_json() == {"error": OWNER_GONE}
        assert _doc(world, "app-follow-up")["status"] == "reviewer_approved"


class TestTheHistory:
    def test_shows_the_verdict_and_its_undo_as_two_entries(self, world):
        assert _choose([CAT, EDITOR]).status_code == 200
        dealt = _doc(world, "app-v1")["reviewer"]["email"]
        given = _give(EDITOR, "app-v1", "reviewer_rejected")

        _undo(EDITOR, "app-v1", _seen_of(given))

        verdicts = _entries(world, History.VERDICT)
        undone = _entries(world, History.VERDICT_UNDONE)
        assert len(verdicts) == 1 and len(undone) == 1
        entry = undone[0]
        assert (entry["actor"], entry["action"]) == (EDITOR, "give-verdicts")
        assert entry["vendors"] == ["v1@vendor.test"]
        assert entry["subject"] == {"application_id": "app-v1"}
        assert entry["detail"] == {"before": {"status": "reviewer_rejected"},
                                   "after": {"status": "open"}, "dealt_to": dealt}

    def test_a_refused_undo_records_nothing(self, world):
        given = _give(ADMIN, "app-v1", "reviewer_rejected")

        _undo(EDITOR, "app-v1", _seen_of(given))

        assert _entries(world, History.VERDICT_UNDONE) == []


def _decide(world, who, ids, status="reviewer_approved"):
    """A selection's verdict, and what each application it wrote looks like now."""
    response = _client(who).post(f"/markets/{MARKET}/applications/verdicts", json={
        "status": status, "applications": [{"id": app_id} for app_id in ids]})
    assert response.status_code == 200, response.get_json()
    return {app_id: _seen(_doc(world, app_id)) for app_id in ids}


class TestASelection:
    def test_undoes_what_it_wrote_and_says_what_it_skipped(self, world):
        seen = _decide(world, EDITOR, ["app-v1", "app-v2", "app-follow-up"])
        _give(ADMIN, "app-v2", "reviewer_rejected")

        response = _undo_selection(EDITOR, [
            {"id": "app-v1", "seen": seen["app-v1"]},
            {"id": "app-v2", "seen": seen["app-v2"]},
            {"id": "app-follow-up", "seen": seen["app-follow-up"]},
        ])

        assert response.status_code == 200, response.get_json()
        body = response.get_json()
        assert body["written"] == ["app-v1", "app-follow-up"]
        assert body["skipped"] == [{
            "id": "app-v2", "email": "v2@vendor.test",
            "reason": f"{ADMIN} rejected this application since you opened it."}]
        assert _doc(world, "app-v1")["status"] == "open"
        assert _doc(world, "app-v2")["status"] == "reviewer_rejected"
        assert _doc(world, "app-follow-up")["status"] == "needs_follow_up"
        assert _doc(world, "app-follow-up")["follow_up_owner"]["email"] == EDITOR

    def test_skips_after_the_window_and_someone_elses(self, world):
        seen = _decide(world, EDITOR, ["app-v1"])
        _doc(world, "app-v1")["verdict_at"] = seen["app-v1"]["verdictAt"] = _ago(3)
        theirs = _decide(world, ADMIN, ["app-v2"])

        body = _undo_selection(EDITOR, [
            {"id": "app-v1", "seen": seen["app-v1"]},
            {"id": "app-v2", "seen": theirs["app-v2"]},
            {"id": "app-nowhere", "seen": seen["app-v1"]},
        ]).get_json()

        assert body["written"] == []
        assert body["skipped"] == [
            {"id": "app-v1", "email": "v1@vendor.test", "reason": UNDO_REFUSED},
            {"id": "app-v2", "email": "v2@vendor.test", "reason": UNDO_REFUSED},
            {"id": "app-nowhere", "email": None, "reason": "Not an application here."},
        ]
        assert _entries(world, History.VERDICTS_UNDONE) == []

    def test_skips_a_follow_up_whose_owner_lost_their_role(self, world):
        _doc(world, "app-follow-up")["follow_up_owner"] = {"user_id": "user-admin",
                                                           "email": ADMIN}
        seen = _decide(world, EDITOR, ["app-v1", "app-follow-up"])
        del world.markets.doc["roles"]["user-admin"]

        response = _undo_selection(EDITOR, [
            {"id": "app-v1", "seen": seen["app-v1"]},
            {"id": "app-follow-up", "seen": seen["app-follow-up"]},
        ])

        assert response.status_code == 200, response.get_json()
        body = response.get_json()
        assert body["written"] == ["app-v1"]
        assert body["skipped"] == [
            {"id": "app-follow-up", "email": "follow-up@vendor.test", "reason": OWNER_GONE}]
        assert _doc(world, "app-v1")["status"] == "open"
        assert _doc(world, "app-follow-up")["status"] == "reviewer_approved"

    def test_a_chosen_viewer_undoes_their_selection(self, world):
        assert _choose([VIEWER]).status_code == 200
        seen = _decide(world, VIEWER, ["app-v1", "app-v2"], "reviewer_rejected")

        body = _undo_selection(VIEWER, [
            {"id": app_id, "seen": seen[app_id]} for app_id in seen]).get_json()

        assert body["written"] == ["app-v1", "app-v2"]

    def test_is_one_entry_in_the_history(self, world):
        seen = _decide(world, EDITOR, ["app-v1", "app-v2"])

        _undo_selection(EDITOR, [
            {"id": app_id, "seen": seen[app_id]} for app_id in seen])

        [entry] = _entries(world, History.VERDICTS_UNDONE)
        assert (entry["actor"], entry["action"]) == (EDITOR, "give-verdicts")
        assert entry["subject"] == {"application_ids": ["app-v1", "app-v2"]}
        assert entry["detail"]["before"] == {"app-v1": {"status": "reviewer_approved"},
                                             "app-v2": {"status": "reviewer_approved"}}
        assert entry["detail"]["after"] == {"app-v1": {"status": "open"},
                                            "app-v2": {"status": "open"}}

    def test_on_a_closed_review(self, world):
        seen = _decide(world, EDITOR, ["app-v1"])
        world.markets.doc["phase"] = MarketPhase.ASSIGNMENT.value

        response = _undo_selection(EDITOR, [{"id": "app-v1", "seen": seen["app-v1"]}])

        assert response.status_code == 403

    @pytest.mark.parametrize("items", [[], None, [{"id": "app-v1"}]])
    def test_refuses_a_request_naming_nothing_to_undo(self, world, items):
        assert _undo_selection(EDITOR, items).status_code == 400
