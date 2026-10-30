"""A verdict's history names whom the application was dealt to (E38/F07/S02, ADR 0020).

An application keeps its reviewer after it is decided, and the verdict's entry in the market's
history records it beside who decided it, so "who had this one, and who decided it" has one answer
in the vendor's History tab, help and mistakes told apart. With no reviewer nothing is added, and
every verdict, follow-up, hand-on and change is still recorded either way.
"""
import pytest

from test_choosing_reviewers_deals_the_open_applications import (  # noqa: F401  (the fixture)
    ADMIN, ANA, BEN, CAT, EDITOR, MARKET, _choose, _client, world,
)

import history as History


def _review(app_id, status, who=ADMIN, **body):
    response = _client(who).put(f"/markets/{MARKET}/applications/{app_id}/review",
                                json={"status": status, **body})
    assert response.status_code == 200, response.get_json()


def _select(app_ids, status, who=ADMIN):
    response = _client(who).post(f"/markets/{MARKET}/applications/verdicts", json={
        "status": status, "applications": [{"id": app_id} for app_id in app_ids]})
    assert response.status_code == 200, response.get_json()
    assert response.get_json()["written"] == app_ids


def _hand_on(app_id, to, who=ADMIN):
    response = _client(who).put(f"/markets/{MARKET}/applications/{app_id}/follow-up-owner",
                                json={"ownerEmail": to})
    assert response.status_code == 200, response.get_json()


def _last(world, kind):
    return [entry for entry in world.history.documents if entry["kind"] == kind][-1]


class TestWithNoReviewersChosen:
    def test_every_review_write_records_its_entry_with_nothing_added(self, world):
        _review("app-v1", "reviewer_approved")
        _review("app-v1", "reviewer_rejected")
        _review("app-v2", "needs_follow_up")
        _hand_on("app-v2", EDITOR)
        _select(["app-v3", "app-v4"], "reviewer_approved")

        entries = [(e["action"], e["kind"]) for e in world.history.documents]
        assert entries == [
            ("give-verdicts", History.VERDICT), ("change-verdicts", History.VERDICT),
            ("give-verdicts", History.VERDICT), ("give-verdicts", History.FOLLOW_UP_OWNER),
            ("give-verdicts", History.VERDICTS),
        ]
        assert not any("dealt_to" in e["detail"] for e in world.history.documents)


class TestWithReviewersChosen:
    @pytest.fixture(autouse=True)
    def dealt(self, world):
        # v1 to Ana, v2 to Ben, v3 to Cat, v4 to Ana, v5 to Ben.
        _choose([ANA, BEN, CAT])
        world.history.documents.clear()

    def test_a_reviewer_deciding_their_own_records_themselves(self, world):
        _review("app-v2", "reviewer_approved", who=BEN)

        entry = _last(world, History.VERDICT)
        assert (entry["actor"], entry["detail"]["dealt_to"]) == (BEN, BEN)

    def test_someone_deciding_anothers_records_whose_it_was(self, world):
        _review("app-v1", "reviewer_rejected")

        entry = _last(world, History.VERDICT)
        assert (entry["actor"], entry["detail"]["dealt_to"]) == (ADMIN, ANA)
        assert entry["detail"]["after"] == {"status": "reviewer_rejected"}

    def test_a_follow_up_and_a_change_of_verdict_record_it_too(self, world):
        _review("app-v3", "needs_follow_up")
        assert _last(world, History.VERDICT)["detail"]["dealt_to"] == CAT

        _review("app-v3", "reviewer_approved")
        _review("app-v3", "reviewer_rejected")
        changed = _last(world, History.VERDICT)
        assert (changed["action"], changed["detail"]["dealt_to"]) == ("change-verdicts", CAT)

    def test_a_hand_on_is_recorded_as_it_always_was(self, world):
        _review("app-v3", "needs_follow_up")

        _hand_on("app-v3", EDITOR)

        entry = _last(world, History.FOLLOW_UP_OWNER)
        assert entry["detail"] == {"before": {"follow_up_owner": ADMIN},
                                   "after": {"follow_up_owner": EDITOR}}

    def test_a_selection_records_it_by_application_for_those_that_have_one(self, world):
        _select(["app-v4", "app-v5", "app-decided"], "reviewer_rejected")

        entry = _last(world, History.VERDICTS)
        assert entry["detail"]["dealt_to"] == {"app-v4": ANA, "app-v5": BEN}
