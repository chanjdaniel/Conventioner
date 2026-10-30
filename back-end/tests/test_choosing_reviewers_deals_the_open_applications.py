"""Choosing reviewers deals the open applications among them (E38/F07/S02, ADR 0020).

Every reviewer worked the same queue, first come, first served, and nobody could say "these 50 are
yours". An Admin or the owner now chooses reviewers from the people with a role on the market, and
every open application is dealt among them round robin, in the order the applications arrived and
the reviewers' addresses sort, so the deal is the same whoever chose them. Any change of reviewers
deals the open applications again; a decided application and a follow-up stay where they are. The
market's history records the choice and the deal, and an unchanged set records nothing.
"""
import copy
from types import SimpleNamespace

import pytest

from conftest import mongo_matches, mongo_project, sessions_load_through_get_user, stored_market
import app as app_module
import api.market_actions as Actions
import api.markets as MarketsApi
import api.users as UsersApi
import history as History
import review_team as ReviewTeam
from datatypes import MarketPhase, MarketRole

MARKET = "market-1"
OWNER = "owner@market.test"
ADMIN = "admin@market.test"
EDITOR = "editor@market.test"
VIEWER = "viewer@market.test"
ANA = "ana@example.com"
BEN = "ben@example.com"
CAT = "cat@example.com"
DEE = "dee@example.com"
STRANGER = "stranger@example.com"
ROLES = {
    "user-owner": "owner", "user-admin": "admin", "user-editor": "editor", "user-viewer": "viewer",
    "user-ana": "viewer", "user-ben": "editor", "user-cat": "viewer", "user-dee": "viewer",
}
PEOPLE = {
    OWNER: "user-owner", ADMIN: "user-admin", EDITOR: "user-editor", VIEWER: "user-viewer",
    ANA: "user-ana", BEN: "user-ben", CAT: "user-cat", DEE: "user-dee", STRANGER: "user-stranger",
}
EMAILS = {user_id: email for email, user_id in PEOPLE.items()}
CHOOSE_REFUSED = "Only an Admin or the owner may choose this market's reviewers."

#: The open applications, by vendor, in the order they arrived.
OPEN = ["v1", "v2", "v3", "v4", "v5", "v6", "v7"]


def _application(name, day, status="open", **fields):
    return {
        "id": f"app-{name}", "market_id": MARKET, "applicant_email": f"{name}@vendor.test",
        "form_data": {}, "status": status, "application_type": "main",
        "submitted_at": f"2026-10-{day:02d}T09:00:00+00:00",
        "updated_at": "2026-10-20T00:00:00Z", "verdict_at": None, **fields,
    }


def _set(doc, path, value):
    *parents, leaf = path.split(".")
    for part in parents:
        doc = doc.setdefault(part, {})
    doc[leaf] = value


_MISSING = object()


def _at(doc, path):
    for part in path.split("."):
        if not isinstance(doc, dict) or part not in doc:
            return _MISSING
        doc = doc[part]
    return doc


def _matches(doc, query):
    """``mongo_matches``, with a dotted key read by its path as Mongo reads one, ``$nor`` included."""
    for key, condition in query.items():
        if key == "$nor":
            if any(_matches(doc, clause) for clause in condition):
                return False
            continue
        value = _at(doc, key)
        if not mongo_matches({} if value is _MISSING else {"v": value}, {"v": condition}):
            return False
    return True


class Markets:
    """The markets collection holding one market, applying ``$set``, ``$unset`` and ``$inc`` on
    dotted paths and matching dotted filters as Mongo does, and counting the writes, so an
    unchanged choice is seen to write nothing."""

    def __init__(self, doc):
        self.doc = copy.deepcopy(doc)
        self.writes = 0

    def find_one(self, query, projection=None):
        if not _matches(self.doc, query):
            return None
        return mongo_project(copy.deepcopy(self.doc), projection)

    def find(self, query, projection=None):
        found = self.find_one(query, projection)
        return iter([found] if found is not None else [])

    def find_one_and_update(self, query, update, return_document=None, **_kwargs):
        """As Mongo answers it with ``ReturnDocument.AFTER``, the one way the deal asks it."""
        if self.update_one(query, update).matched_count == 0:
            return None
        return copy.deepcopy(self.doc)

    def update_one(self, query, update):
        if not _matches(self.doc, query):
            return SimpleNamespace(matched_count=0, modified_count=0)
        self.writes += 1
        for path, value in (update.get("$set") or {}).items():
            _set(self.doc, path, copy.deepcopy(value))
        for path in update.get("$unset") or {}:
            *parents, leaf = path.split(".")
            target = self.doc
            for part in parents:
                target = target.get(part) if isinstance(target, dict) else None
            if isinstance(target, dict):
                target.pop(leaf, None)
        for path, by in (update.get("$inc") or {}).items():
            *parents, leaf = path.split(".")
            target = self.doc
            for part in parents:
                target = target.setdefault(part, {})
            target[leaf] = target.get(leaf, 0) + by
        return SimpleNamespace(matched_count=1, modified_count=1)


def _account(email):
    return SimpleNamespace(
        id=PEOPLE[email], email=email, is_active=True, is_authenticated=True,
        is_anonymous=False, get_id=lambda e=email: e,
    )


@pytest.fixture
def world(monkeypatch, applications, market_records):
    def market(phase=MarketPhase.APPLICATIONS, **overrides):
        markets = Markets(stored_market(
            phase, id=MARKET, _id="mongo-1", organizationId=None, roles=dict(ROLES), **overrides))
        monkeypatch.setattr(MarketsApi, "markets_collection", markets)
        monkeypatch.setattr(ReviewTeam, "markets_collection", markets)
        world.markets = markets
        return markets

    sessions_load_through_get_user(monkeypatch)
    monkeypatch.setattr(app_module.login_manager, "session_protection", None)
    monkeypatch.setattr(UsersApi, "get_user", lambda email: _account(email) if email in PEOPLE else None)
    monkeypatch.setattr(
        UsersApi, "get_user_by_id", lambda uid: _account(EMAILS[uid]) if uid in EMAILS else None)
    # Stored out of arrival order, so the deal is seen to sort them.
    applications.documents = [
        _application("v5", 5), _application("v1", 1), _application("v7", 7),
        _application("v3", 3), _application("v4", 4, status="under_review"),
        _application("v2", 2), _application("v6", 6),
        _application("decided", 0, status="reviewer_approved",
                     verdict_at="2026-10-09T00:00:00+00:00",
                     verdict_by={"kind": "person", "user_id": "user-editor", "email": EDITOR}),
        _application("follow-up", 0, status="needs_follow_up",
                     verdict_at="2026-10-09T00:00:00+00:00",
                     verdict_by={"kind": "person", "user_id": "user-editor", "email": EDITOR},
                     follow_up_owner={"user_id": "user-editor", "email": EDITOR}),
    ]
    world = SimpleNamespace(
        market=market, applications=applications, history=market_records.history, markets=None)
    market()
    return world


def _client(email=ADMIN):
    client = app_module.app.test_client()
    with client.session_transaction() as session:
        session["_user_id"] = email
        session["_fresh"] = True
    return client


def _choose(addresses, who=ADMIN):
    return _client(who).put(f"/markets/{MARKET}/reviewers", json={"reviewers": addresses})


def _reviewers(world):
    """Each application's reviewer, by vendor, as the organizer's list answers it."""
    listed = _client(VIEWER).get(f"/markets/{MARKET}/applications").get_json()
    rows = listed["applications"] if isinstance(listed, dict) else listed
    return {
        row["applicantEmail"].split("@")[0]: (row["reviewer"] or {}).get("email")
        for row in rows
    }


def _read(who=ADMIN):
    return MarketsApi.get_market_for_user(who, MARKET)


def _entries(world, kind=None):
    return [entry for entry in world.history.documents if kind is None or entry["kind"] == kind]


class TestChoosingDeals:
    def test_three_reviewers_deal_seven_open_applications_3_2_2_in_address_order(self, world):
        response = _choose([CAT, "Ana@Example.com ", BEN])

        assert response.status_code == 200, response.get_json()
        assert response.get_json() == {
            "reviewTeam": {"reviewers": [
                {"email": ANA, "able": True}, {"email": BEN, "able": True},
                {"email": CAT, "able": True},
            ]},
            "dealt": 7,
        }
        dealt = _reviewers(world)
        assert [dealt[v] for v in OPEN] == [ANA, BEN, CAT, ANA, BEN, CAT, ANA]

    def test_the_market_keeps_the_team_in_deal_order_and_the_turn_the_deal_reached(self, world):
        _choose([CAT, ANA, BEN])

        assert world.markets.doc["reviewTeam"] == {
            "reviewers": [
                {"userId": "user-ana", "email": ANA}, {"userId": "user-ben", "email": BEN},
                {"userId": "user-cat", "email": CAT},
            ],
            "turn": 7,
        }

    def test_a_decided_application_and_a_follow_up_are_not_dealt(self, world):
        _choose([ANA, BEN, CAT])

        dealt = _reviewers(world)
        assert (dealt["decided"], dealt["follow-up"]) == (None, None)

    def test_adding_a_fourth_deals_every_open_one_again_and_leaves_the_decided_where_they_are(
            self, world):
        _choose([ANA, BEN, CAT])
        decided = next(d for d in world.applications.documents if d["id"] == "app-v1")
        decided.update(status="reviewer_rejected", verdict_at="2026-10-21T00:00:00+00:00",
                       verdict_by={"kind": "person", "user_id": "user-ana", "email": ANA})

        response = _choose([ANA, BEN, CAT, DEE])

        dealt = _reviewers(world)
        assert dealt["v1"] == ANA
        assert [dealt[v] for v in OPEN[1:]] == [ANA, BEN, CAT, DEE, ANA, BEN]
        assert (dealt["decided"], dealt["follow-up"]) == (None, None)
        # v2 to v7 were Ben, Cat, Ana, Ben, Cat, Ana: every one of them moves.
        assert response.get_json()["dealt"] == 6
        assert world.markets.doc["reviewTeam"]["turn"] == 6

    def test_an_unchanged_set_writes_and_records_nothing(self, world):
        _choose([ANA, BEN, CAT])
        writes, entries = world.markets.writes, len(world.history.documents)

        response = _choose([" cat@example.com", BEN, "ANA@example.com"])

        assert response.status_code == 200
        assert response.get_json()["dealt"] == 0
        assert world.markets.writes == writes
        assert len(world.history.documents) == entries

    def test_removing_every_reviewer_returns_the_open_ones_to_first_come_first_served(self, world):
        _choose([ANA, BEN, CAT])

        response = _choose([])

        assert response.get_json() == {"reviewTeam": {"reviewers": []}, "dealt": 7}
        assert set(_reviewers(world).values()) == {None}
        assert world.markets.doc["reviewTeam"] == {"reviewers": [], "turn": 0}

    def test_an_application_decided_while_the_deal_runs_is_not_written(self, world):
        real = world.applications.update_one
        late = next(d for d in world.applications.documents if d["id"] == "app-v3")

        def a_verdict_lands_first(query, update):
            if query.get("id") == "app-v3":
                late.update(status="reviewer_approved",
                            verdict_at="2026-10-21T00:00:00+00:00",
                            verdict_by={"kind": "person", "user_id": "user-ben", "email": BEN})
            return real(query, update)

        world.applications.update_one = a_verdict_lands_first

        response = _choose([ANA, BEN, CAT])

        assert "reviewer" not in late
        assert response.get_json()["dealt"] == 6

    def test_a_draft_stores_the_team_with_nothing_to_deal(self, world):
        world.market(MarketPhase.DRAFT)
        world.applications.documents = []

        response = _choose([ANA])

        assert response.get_json() == {
            "reviewTeam": {"reviewers": [{"email": ANA, "able": True}]}, "dealt": 0}
        assert world.markets.doc["reviewTeam"] == {
            "reviewers": [{"userId": "user-ana", "email": ANA}], "turn": 0}


class TestWhoMayChoose:
    def test_the_row_is_the_tables_with_admin_as_its_default(self):
        row = Actions.ACTIONS["choose-reviewers"]

        assert row is Actions.CHOOSE_REVIEWERS
        assert (row.group, row.label, row.default, row.fixed) == (
            "Applications", "Choose reviewers", MarketRole.ADMIN, False)
        assert Actions.refusal_sentence(row) == CHOOSE_REFUSED

    @pytest.mark.parametrize("who", [OWNER, ADMIN])
    def test_an_admin_and_the_owner_may(self, world, who):
        assert _choose([ANA], who=who).status_code == 200

    @pytest.mark.parametrize("who", [EDITOR, VIEWER])
    def test_anyone_else_is_refused_with_the_rows_sentence(self, world, who):
        response = _choose([ANA], who=who)

        assert response.status_code == 403
        assert response.get_json()["error"] == CHOOSE_REFUSED
        assert "reviewTeam" not in world.markets.doc

    def test_the_owner_lowering_the_row_lets_an_editor_choose(self, world):
        world.market(permissions={"choose-reviewers": {"role": "editor", "source": "market"}})

        assert _choose([ANA], who=EDITOR).status_code == 200

    def test_an_archived_market_is_refused(self, world):
        world.market(MarketPhase.ARCHIVED)

        response = _choose([ANA])

        assert response.status_code == 403
        assert response.get_json()["error"] == MarketsApi.ARCHIVED_REFUSAL

    @pytest.mark.parametrize("phase", [MarketPhase.ASSIGNMENT, MarketPhase.MARKET_DAYS])
    def test_a_closed_review_is_refused(self, world, phase):
        world.market(phase)

        response = _choose([ANA])

        assert response.status_code == 400
        assert response.get_json()["error"] == MarketsApi.REVIEWERS_SETTLED
        assert "reviewTeam" not in world.markets.doc

    def test_an_address_the_chooser_is_not_offered_is_refused_by_name(self, world):
        response = _choose([ANA, STRANGER])

        assert response.status_code == 400
        assert STRANGER in response.get_json()["error"]
        assert "reviewTeam" not in world.markets.doc

    def test_a_current_reviewer_who_is_no_longer_offered_may_stay(self, world):
        _choose([ANA, BEN])
        world.markets.doc["roles"].pop("user-ben")

        response = _choose([ANA, BEN, CAT])

        assert response.status_code == 200, response.get_json()

    @pytest.mark.parametrize("body", [{}, {"reviewers": "ana@example.com"}, {"reviewers": [1]}])
    def test_a_body_that_names_no_list_of_addresses_is_refused(self, world, body):
        response = _client().put(f"/markets/{MARKET}/reviewers", json=body)

        assert response.status_code == 400


class TestTheMarketRead:
    def test_none_chosen_reads_as_no_reviewers(self, world):
        assert _read(VIEWER)["reviewTeam"] == {"reviewers": []}

    def test_every_reader_is_served_the_reviewers_and_never_the_turn(self, world):
        _choose([BEN, ANA])

        assert _read(VIEWER)["reviewTeam"] == {
            "reviewers": [{"email": ANA, "able": True}, {"email": BEN, "able": True}]}

    def test_someone_who_may_choose_is_offered_everyone_with_a_role_sorted(self, world):
        assert _read(ADMIN)["reviewerCandidates"] == sorted(
            email for email in PEOPLE if email != STRANGER)

    @pytest.mark.parametrize("who", [EDITOR, VIEWER])
    def test_anyone_else_is_offered_no_one(self, world, who):
        assert _read(who)["reviewerCandidates"] == []

    @pytest.mark.parametrize("phase", [MarketPhase.ASSIGNMENT, MarketPhase.ARCHIVED])
    def test_no_one_is_offered_once_the_review_has_closed(self, world, phase):
        world.market(phase)

        assert _read(ADMIN)["reviewerCandidates"] == []

    def test_the_read_looks_each_person_up_once(self, world, monkeypatch):
        looked_up = []
        real = UsersApi.get_user_by_id
        monkeypatch.setattr(UsersApi, "get_user_by_id",
                            lambda uid: looked_up.append(uid) or real(uid))

        _read(ADMIN)

        assert sorted(looked_up) == sorted(set(looked_up))

    def test_the_organizers_list_names_no_reviewer_before_any_deal(self, world):
        assert set(_reviewers(world).values()) == {None}


class TestTheHistory:
    def test_a_choice_records_the_reviewers_and_the_deal(self, world):
        _choose([CAT, ANA, BEN])

        [chosen] = _entries(world, History.REVIEWERS)
        assert (chosen["actor"], chosen["action"], chosen["vendors"], chosen["subject"]) == (
            ADMIN, "choose-reviewers", [], {})
        assert chosen["detail"] == {
            "before": {"reviewers": []}, "after": {"reviewers": [ANA, BEN, CAT]}}

        [deal] = _entries(world, History.DEALT)
        ids = [f"app-{v}" for v in OPEN]
        assert (deal["actor"], deal["action"]) == (ADMIN, "choose-reviewers")
        assert deal["vendors"] == [f"{v}@vendor.test" for v in OPEN]
        assert deal["subject"] == {"application_ids": ids}
        assert deal["detail"] == {
            "cause": "reviewers_changed",
            "before": {i: {"reviewer": None} for i in ids},
            "after": dict(zip(ids, ({"reviewer": r} for r in [ANA, BEN, CAT, ANA, BEN, CAT, ANA]))),
        }

    def test_a_deal_names_only_the_applications_it_moved(self, world):
        _choose([ANA, BEN, CAT])
        world.history.documents.clear()

        _choose([ANA, BEN, CAT, DEE])

        [deal] = _entries(world, History.DEALT)
        assert deal["subject"]["application_ids"] == ["app-v4", "app-v5", "app-v6", "app-v7"]
        assert deal["detail"]["before"]["app-v4"] == {"reviewer": ANA}
        assert deal["detail"]["after"]["app-v4"] == {"reviewer": DEE}

    def test_a_change_that_moves_nothing_records_the_reviewers_alone(self, world):
        world.applications.documents = []

        _choose([ANA])

        assert [entry["kind"] for entry in world.history.documents] == [History.REVIEWERS]

    def test_removing_every_reviewer_is_recorded_as_such(self, world):
        _choose([ANA, BEN])
        world.history.documents.clear()

        _choose([])

        [chosen] = _entries(world, History.REVIEWERS)
        assert chosen["detail"] == {
            "before": {"reviewers": [ANA, BEN]}, "after": {"reviewers": []}}
        [deal] = _entries(world, History.DEALT)
        assert set(map(str, deal["detail"]["after"].values())) == {str({"reviewer": None})}
