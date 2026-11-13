"""Transferring a market's ownership, on a real server, with real threads meeting (T283).

A transfer is one write holding the Owner's role and the new Owner's as read, so the market never
has two Owners. The hermetic suite lands a second transfer between one's read and its write
(``test_handing_a_market_on.py``); this runs that losing branch where it lives: both threads read
the market and judge who has access, and only then do their writes meet on the server.
"""
import threading

import pytest

import api.markets as MarketsApi
import api.permissions as PermissionsApi
from datatypes import MarketPhase
from market_write import MarketChanged
from real_mongo import harness
from real_mongo.test_a_judged_write_lands_only_on_the_market_it_judged import _history, _stored

OWNER = "fixture-owner@example.com"
ADMIN = "fixture-admin@example.com"
EDITOR = "fixture-editor@example.com"
#: The judgment of who has access, as the module holds it before the test wraps it.
WITH_ACCESS = PermissionsApi.people_with_market_role
#: How long a racing thread waits for the other at the meeting point, so a bug fails, not hangs.
MEETING_TIMEOUT_SECONDS = 20


@pytest.mark.parametrize("phase", [MarketPhase.APPLICATIONS, MarketPhase.ARCHIVED], ids=str)
def test_two_hand_ons_by_the_owner_to_two_people_land_one(
        signed_in, market_in, real_db, market_records, monkeypatch, race, phase):
    owner, admin, editor = (signed_in(email) for email in (OWNER, ADMIN, EDITOR))
    market = market_in(phase, roles={
        owner.account_id: "owner", admin.account_id: "admin", editor.account_id: "editor"})
    both_judged = threading.Barrier(2, timeout=MEETING_TIMEOUT_SECONDS)

    def judged_then_meet(*args, **kwargs):
        try:
            return WITH_ACCESS(*args, **kwargs)
        finally:
            both_judged.wait()

    monkeypatch.setattr(PermissionsApi, "people_with_market_role", judged_then_meet)
    harness.warm(real_db["markets"], 2)
    to = [admin, editor]

    answered = race(2, lambda i: MarketsApi.hand_on_market(market["id"], to[i].account_id, OWNER))

    unexpected = [a for a in answered if a is not None and not isinstance(a, MarketChanged)]
    assert unexpected == []
    landed = [i for i, a in enumerate(answered) if a is None]
    refused = [i for i, a in enumerate(answered) if isinstance(a, MarketChanged)]
    assert len(landed) == 1 and len(refused) == 1, answered
    roles = _stored(real_db, market)["roles"]
    assert [person for person, role in roles.items() if role == "owner"] == [
        to[landed[0]].account_id]
    assert roles[owner.account_id] == "admin"
    assert roles[to[refused[0]].account_id] == market["roles"][to[refused[0]].account_id]
    assert [(entry["kind"], entry["subject"]["email"]) for entry in _history(
        market_records, market)] == [("handed_on", to[landed[0]].email)]


def test_a_refused_hand_on_answers_409_through_the_route(
        signed_in, market_in, real_db, market_records, interleave):
    owner, admin, editor = (signed_in(email) for email in (OWNER, ADMIN, EDITOR))
    market = market_in(MarketPhase.APPLICATIONS, roles={
        owner.account_id: "owner", admin.account_id: "admin", editor.account_id: "editor"})
    # The Owner's other tab transfers it to the Admin between this request's read and its write.
    interleave("api.markets.load_market_context",
               lambda: MarketsApi.hand_on_market(market["id"], admin.account_id, OWNER))

    response = owner.post(f"/markets/{market['id']}/hand-on", json={"userId": editor.account_id})

    assert response.status_code == 409, response.get_json()
    assert response.get_json()["code"] == "market_changed"
    roles = _stored(real_db, market)["roles"]
    assert roles[admin.account_id] == "owner"
    assert roles[owner.account_id] == "admin"
    assert roles[editor.account_id] == "editor"
