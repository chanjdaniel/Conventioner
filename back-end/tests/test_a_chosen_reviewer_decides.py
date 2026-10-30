"""A chosen reviewer, a Viewer included, decides (E38/F07/S03, ADR 0020).

An Admin or the owner could not put a Viewer - a volunteer, a helper from the organization - to work
on the review: a Viewer decided nothing. Being chosen is now a privilege of the market's table: an
eligible chosen reviewer takes the "Give verdicts and follow-ups" row whatever their role, so they
approve, reject and mark follow-ups, hand a follow-up on, claim a card and are handed the next one.
Who may be chosen is the table's own row, "Be chosen as a reviewer, and then give verdicts and
follow-ups" (default Viewer); the owner raising it takes the privilege back. A chosen Viewer still
changes no verdict already given: that is the change row's, refused in its own words.
"""
import pytest

from test_choosing_reviewers_deals_the_open_applications import (  # noqa: F401  (the fixture)
    ADMIN, ANA, BEN, CAT, DEE, EDITOR, MARKET, OWNER, VIEWER, _choose, _client, _read, world,
)

import api.market_actions as Actions
import api.organizations as OrgsApi
from datatypes import MarketPhase, MarketRole

ORG_ID = "org-1"
#: Dee holds no role on the market itself: the organization's membership makes them a Viewer.
MEMBER = DEE
GIVING_REFUSED = "Only an Editor, an Admin or the owner may give verdicts and follow-ups on this market."
CHANGE_REFUSED = (
    "Only an Admin or the owner may change a verdict or overturn an automatic rejection on this "
    "market.")
CHOSEN_ROW_AT_EDITOR = {"review-when-chosen": {"role": "editor", "source": "market"}}


@pytest.fixture
def organization(world, monkeypatch):
    """The market belongs to an organization the Admin runs and Dee is a member of, and Dee holds
    no role on the market itself."""
    stored = {"id": ORG_ID, "name": "Org", "owner": "user-owner", "admins": ["user-admin"],
              "members": ["user-dee"], "markets": [MARKET]}
    monkeypatch.setattr(OrgsApi, "get_organization",
                        lambda org_id: dict(stored) if org_id == ORG_ID else None)
    world.markets.doc["organizationId"] = ORG_ID
    world.markets.doc["roles"].pop("user-dee")
    return stored


def _choose_ok(addresses):
    response = _choose(addresses)
    assert response.status_code == 200, response.get_json()


def _doc(world, app_id):
    return next(d for d in world.applications.documents if d["id"] == app_id)


# Each review write, as its route takes it: what it answers.

def _verdict(who, app_id="app-v1", status="reviewer_approved"):
    return _client(who).put(f"/markets/{MARKET}/applications/{app_id}/review",
                            json={"status": status})


def _selection(who, app_ids=("app-v1", "app-v2"), status="reviewer_rejected"):
    return _client(who).post(f"/markets/{MARKET}/applications/verdicts", json={
        "status": status, "applications": [{"id": app_id} for app_id in app_ids]})


def _follow_up(who, app_id="app-v3"):
    return _verdict(who, app_id, "needs_follow_up")


def _hand_on(who, app_id="app-follow-up", to=EDITOR):
    return _client(who).put(f"/markets/{MARKET}/applications/{app_id}/follow-up-owner",
                            json={"ownerEmail": to})


def _claim(who, app_id="app-v1"):
    return _client(who).put(f"/markets/{MARKET}/applications/{app_id}/claim")


def _next(who):
    return _client(who).post(f"/markets/{MARKET}/review/next", json={})


WRITES = {
    "a verdict": _verdict, "a selection's verdict": _selection, "a follow-up": _follow_up,
    "its hand-on": _hand_on, "a claim": _claim, "review/next": _next,
}

#: Each person, and whether their role alone gives verdicts.
EVERYONE = [(OWNER, True), (ADMIN, True), (EDITOR, True), (VIEWER, False), (MEMBER, False)]


@pytest.mark.usefixtures("organization")
class TestEachRole:
    @pytest.mark.parametrize("write", list(WRITES), ids=str)
    @pytest.mark.parametrize("who,gives", EVERYONE, ids=lambda v: str(v))
    def test_chosen_takes_every_review_write(self, world, write, who, gives):
        _choose_ok([who])

        response = WRITES[write](who)

        assert response.status_code == 200, response.get_json()

    @pytest.mark.parametrize("write", list(WRITES), ids=str)
    @pytest.mark.parametrize("who,gives", EVERYONE, ids=lambda v: str(v))
    def test_not_chosen_takes_them_only_by_their_role(self, world, write, who, gives):
        _choose_ok([CAT])
        before = {d["id"]: dict(d) for d in world.applications.documents}

        response = WRITES[write](who)

        if gives:
            assert response.status_code == 200, response.get_json()
        else:
            assert response.status_code == 403
            assert response.get_json() == {"error": GIVING_REFUSED}
            assert {d["id"]: dict(d) for d in world.applications.documents} == before

    def test_a_chosen_member_is_written_as_who_decided(self, world):
        _choose_ok([MEMBER])

        _verdict(MEMBER)

        assert _doc(world, "app-v1")["status"] == "reviewer_approved"
        assert _doc(world, "app-v1")["verdict_by"]["email"] == MEMBER


class TestAChosenViewerChangesNoVerdict:
    @pytest.fixture(autouse=True)
    def chosen(self, world):
        _choose_ok([ANA])

    @pytest.mark.parametrize("status", ["reviewer_rejected", "needs_follow_up"])
    def test_a_single_verdict_on_a_decided_one_is_the_change_rows(self, world, status):
        response = _verdict(ANA, "app-decided", status)

        assert response.status_code == 403
        assert response.get_json() == {"error": CHANGE_REFUSED}
        assert _doc(world, "app-decided")["status"] == "reviewer_approved"

    def test_a_selection_skips_the_decided_one_in_the_change_rows_words(self, world):
        response = _selection(ANA, ("app-v1", "app-decided"))

        body = response.get_json()
        assert response.status_code == 200
        assert body["written"] == ["app-v1"]
        assert [(s["id"], s["reason"]) for s in body["skipped"]] == [
            ("app-decided", CHANGE_REFUSED)]

    def test_deciding_a_follow_up_is_a_first_verdict(self, world):
        assert _verdict(ANA, "app-follow-up").status_code == 200


class TestWhenTheReviewCannotTakeVerdicts:
    @pytest.mark.parametrize("phase,refused", [
        (MarketPhase.ASSIGNMENT, "The review is closed"),
        (MarketPhase.ARCHIVED, "archived"),
    ], ids=str)
    @pytest.mark.parametrize("write", list(WRITES), ids=str)
    def test_a_chosen_viewer_is_refused(self, world, phase, refused, write):
        world.market(phase, reviewTeam={
            "reviewers": [{"userId": "user-ana", "email": ANA}], "turn": 0})

        response = WRITES[write](ANA)

        assert response.status_code == 403
        assert refused in response.get_json()["error"]


class TestTheRow:
    def test_raising_it_to_editor_takes_the_privilege_from_a_chosen_viewer(self, world):
        _choose_ok([ANA, BEN])
        world.markets.doc["permissions"] = CHOSEN_ROW_AT_EDITOR

        for write in WRITES.values():
            response = write(ANA)
            assert response.status_code == 403
            assert response.get_json() == {"error": GIVING_REFUSED}
        assert _verdict(BEN).status_code == 200

    def test_raising_it_serves_the_chosen_viewer_not_able(self, world):
        _choose_ok([ANA, BEN])
        world.markets.doc["permissions"] = CHOSEN_ROW_AT_EDITOR

        assert _read()["reviewTeam"]["reviewers"] == [
            {"email": ANA, "able": False}, {"email": BEN, "able": True}]

    def test_raising_it_deals_the_chosen_viewer_nothing_new(self, world):
        _choose_ok([ANA, BEN])
        world.markets.doc["permissions"] = CHOSEN_ROW_AT_EDITOR

        _choose_ok([ANA, BEN, EDITOR])

        dealt = {(d.get("reviewer") or {}).get("email") for d in world.applications.documents
                 if d["status"] in ("open", "under_review")}
        assert dealt == {BEN, EDITOR}

    def test_the_candidates_follow_it(self, world):
        assert _read()["reviewerCandidates"] == sorted(
            [ADMIN, ANA, BEN, CAT, DEE, EDITOR, OWNER, VIEWER])

        world.markets.doc["permissions"] = CHOSEN_ROW_AT_EDITOR

        assert _read()["reviewerCandidates"] == sorted([ADMIN, BEN, EDITOR, OWNER])

    def test_someone_it_refuses_is_not_offered_and_choosing_them_is_refused(self, world):
        world.markets.doc["permissions"] = CHOSEN_ROW_AT_EDITOR

        response = _choose([ANA])

        assert response.status_code == 400
        assert ANA in response.get_json()["error"]

    def test_a_current_reviewer_it_now_refuses_may_stay_chosen(self, world):
        _choose_ok([ANA, BEN])
        world.markets.doc["permissions"] = CHOSEN_ROW_AT_EDITOR

        assert _choose([ANA, BEN, EDITOR]).status_code == 200


class TestTheMarketRead:
    def test_serves_a_chosen_viewer_the_giving_row_and_the_people(self, world):
        _choose_ok([ANA])

        served = _read(ANA)

        assert served["actionRefusals"]["give-verdicts"] is None
        assert served["actionRefusals"]["change-verdicts"] == CHANGE_REFUSED
        assert served["readOnlyReason"] is None
        assert ANA in served["peopleOnMarket"] and EDITOR in served["peopleOnMarket"]

    def test_serves_an_unchosen_viewer_as_before(self, world):
        _choose_ok([ANA])

        served = _read(VIEWER)

        assert served["actionRefusals"]["give-verdicts"] == GIVING_REFUSED
        assert served["readOnlyReason"] is not None
        assert served["peopleOnMarket"] == []

    def test_serves_a_chosen_viewer_as_one_it_refuses_once_the_row_is_raised(self, world):
        _choose_ok([ANA])
        world.markets.doc["permissions"] = CHOSEN_ROW_AT_EDITOR

        served = _read(ANA)

        assert served["actionRefusals"]["give-verdicts"] == GIVING_REFUSED
        assert served["peopleOnMarket"] == []



class TestTheActionsModule:
    """Being chosen passes the giving row in the one module that compares roles, for a write that
    reads it off the market's team and for the read that passes it."""

    def test_a_resolved_viewer_passes_the_giving_row_only_when_chosen(self):
        def refused(chosen, rows=None):
            return Actions.role_refusal(
                Actions.GIVE_VERDICTS, MarketRole.VIEWER, rows or {}, chosen=chosen)

        assert refused(False) == GIVING_REFUSED
        assert refused(True) is None
        assert refused(True, CHOSEN_ROW_AT_EDITOR) == GIVING_REFUSED

    def test_being_chosen_passes_no_other_row(self):
        for row in Actions.ACTIONS.values():
            if row is Actions.GIVE_VERDICTS:
                continue
            for role in (None, MarketRole.VIEWER):
                refused = Actions.role_refusal(row, role, {}, chosen=True)
                if row.on_top_of is Actions.GIVE_VERDICTS and role is not None:
                    # Asked on top of the giving row, which being chosen passes: its own words.
                    assert refused == Actions.refusal_sentence(row), row.id
                else:
                    assert refused == Actions.role_refusal(row, role, {}), row.id

    def test_holding_no_role_is_never_enough(self):
        assert Actions.role_refusal(
            Actions.GIVE_VERDICTS, None, {}, chosen=True) == GIVING_REFUSED
