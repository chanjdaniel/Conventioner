"""There is no whole-market PUT (E21/F03/S06).

`PUT /markets/:id` stored the client's entire copy of a market, and the server survived it only by
re-applying every field it owns - phase, form, assignment, intake mode, highlights, results - one
"a stale client copy overwrote X" bug at a time, and by missing the ones nobody had thought of yet
(the organization it would move a market to, the name it would let two markets share). Every write
names what it changes now: the plan, the name, the form, the placements, a transition. A client
sending its whole copy of a market is a client claiming to be the truth, and nothing answers it.
"""
from types import SimpleNamespace

import pytest

from conftest import skip_without_real_dependencies

skip_without_real_dependencies()

import app as app_module
import api.users as UsersApi

OWNER_EMAIL = "owner@example.com"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(app_module.login_manager, "session_protection", None)
    monkeypatch.setattr(
        UsersApi, "get_user",
        lambda email: SimpleNamespace(
            id="user-1", email=email, is_active=True, is_authenticated=True,
            is_anonymous=False, get_id=lambda e=email: e,
        ) if email == OWNER_EMAIL else None,
    )
    client = app_module.app.test_client()
    with client.session_transaction() as session:
        session["_user_id"] = OWNER_EMAIL
        session["_fresh"] = True
    return client


def test_a_whole_market_put_is_not_a_route(client):
    response = client.put("/markets/market-123", json={"id": "market-123", "name": "Anything"})

    assert response.status_code == 405


def test_the_writes_that_replaced_it_are(client):
    """The named writes answer on their own paths - a 405 here would mean the deletion took one."""
    rules = {(rule.rule, method) for rule in app_module.app.url_map.iter_rules() for method in rule.methods}

    for path in ("/plan", "/name", "/application-form", "/placements", "/review-highlights"):
        assert (f"/markets/<market_id>{path}", "PUT") in rules
