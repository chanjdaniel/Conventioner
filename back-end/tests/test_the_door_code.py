"""The market's door code, which a vendor scans at the entrance to check in (ADR 0022).

One live code per market, stored on the market document as ``doorCode`` and served only by its own
endpoints, never by a market read: anyone who reads the market may not check vendors in, and a
Viewer holding the code could check vendors in by proxy (story 42). Both endpoints are held to the
table's "Check vendors in" row, the code is made only in Market Days, and a new one ends the old.
"""
import copy
import re
from types import SimpleNamespace

import pytest

from conftest import mongo_project, sessions_load_through_get_user, stored_market
from test_every_write_records import LiveMarkets
import app as app_module
import api.door as DoorApi
import api.markets as MarketsApi
import market_write as MarketWrite
import api.permissions as PermissionsApi
import api.users as UsersApi
import history as History
from datatypes import MarketPhase, MarketRole

MARKET = "market-123"
ORGANIZER = "door@example.com"
PATH = f"/markets/{MARKET}/door-code"
ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"


class Markets(LiveMarkets):
    """The one market, found by id or by a role key, as the market list asks."""

    def find(self, query, projection=None):
        (key, condition), = query.items() if len(query) == 1 else ((None, None),)
        if key and key.startswith("roles.") and self.doc is not None:
            held = key.split(".", 1)[1] in self.doc.get("roles", {})
            return iter([mongo_project(dict(self.doc), projection)] if held == condition["$exists"]
                        else [])
        return super().find(query, projection)


@pytest.fixture
def world(monkeypatch, market_records):
    markets = Markets()
    markets.doc = copy.deepcopy(stored_market(
        MarketPhase.MARKET_DAYS, name="Harbour Night Market", roles={"user-door": "owner"},
        _id="mongo-market-123"))
    held = {"role": MarketRole.EDITOR}
    monkeypatch.setattr(MarketsApi, "markets_collection", markets)
    monkeypatch.setattr(MarketWrite, "markets_collection", MarketsApi.markets_collection)
    monkeypatch.setattr(
        PermissionsApi, "get_user_market_role", lambda *_a, **_k: held["role"])
    account = SimpleNamespace(
        id="user-door", email=ORGANIZER, is_active=True, is_authenticated=True,
        is_anonymous=False, get_id=lambda: ORGANIZER)
    monkeypatch.setattr(UsersApi, "get_user", lambda email: account if email == ORGANIZER else None)
    monkeypatch.setattr(app_module.login_manager, "session_protection", None)
    monkeypatch.setenv("FRONTEND_URL", "https://conventioner.test")
    sessions_load_through_get_user(monkeypatch)

    def holding(role):
        held["role"] = role

    return SimpleNamespace(
        markets=markets, history=market_records.history, holding=holding,
        phase=lambda phase: markets.doc.update(phase=phase.value))


@pytest.fixture
def client(world):
    client = app_module.app.test_client()
    with client.session_transaction() as session:
        session["_user_id"] = ORGANIZER
        session["_fresh"] = True
    return client


def made(client):
    response = client.post(PATH)
    assert response.status_code == 200, response.get_json()
    return response.get_json()


class TestReadingIt:
    def test_a_market_with_no_code_yet_answers_none(self, client):
        response = client.get(PATH)

        assert response.status_code == 200
        assert response.get_json() == {"code": None}

    def test_it_answers_the_code_who_made_it_when_and_the_address_it_opens(self, client):
        made(client)

        body = client.get(PATH).get_json()

        assert set(body) == {"code", "madeAt", "madeBy", "url"}
        assert body["madeBy"] == ORGANIZER
        assert body["madeAt"]
        assert body["url"] == f"https://conventioner.test/harbour-night-market?door={body['code']}"

    def test_it_is_read_in_any_phase_for_whoever_may_check_vendors_in(self, client, world):
        code = made(client)["code"]
        world.phase(MarketPhase.ARCHIVED)

        assert client.get(PATH).get_json()["code"] == code


class TestMakingIt:
    def test_a_code_is_six_characters_with_no_0_o_1_or_i(self, client):
        codes = {made(client)["code"] for _ in range(40)}

        for code in codes:
            assert re.fullmatch(f"[{ALPHABET}]{{6}}", code), code
        # Random, not one code over and over.
        assert len(codes) > 30

    def test_it_comes_from_secrets(self, client, monkeypatch):
        picks = iter("K7M4QP")
        monkeypatch.setattr(DoorApi.secrets, "choice", lambda alphabet: next(picks))

        assert made(client)["code"] == "K7M4QP"

    def test_the_answer_is_what_a_read_then_gives(self, client):
        body = made(client)

        assert body == client.get(PATH).get_json()

    def test_a_new_code_replaces_the_old(self, client, world):
        first = made(client)["code"]
        second = made(client)["code"]

        assert first != second
        assert client.get(PATH).get_json()["code"] == second
        assert world.markets.doc["doorCode"]["code"] == second

    @pytest.mark.parametrize("phase", [
        MarketPhase.DRAFT, MarketPhase.APPLICATIONS, MarketPhase.ASSIGNMENT])
    def test_it_is_refused_before_market_days(self, client, world, phase):
        world.phase(phase)

        response = client.post(PATH)

        assert response.status_code == 409
        assert response.get_json()["error"] == DoorApi.NO_DOOR_CODE_YET
        assert "doorCode" not in world.markets.doc
        assert world.history.documents == []

    def test_it_is_refused_on_an_archived_market(self, client, world):
        world.phase(MarketPhase.ARCHIVED)

        response = client.post(PATH)

        assert response.status_code == 403
        assert response.get_json()["error"] == MarketsApi.ARCHIVED_REFUSAL
        assert "doorCode" not in world.markets.doc


class TestWhoMay:
    @pytest.mark.parametrize("role", [MarketRole.EDITOR, MarketRole.ADMIN, MarketRole.OWNER])
    def test_whoever_may_check_vendors_in_reads_and_makes_it(self, client, world, role):
        world.holding(role)

        assert client.post(PATH).status_code == 200
        assert client.get(PATH).status_code == 200

    @pytest.mark.parametrize("role", [MarketRole.VIEWER, None])
    def test_nobody_else_reads_or_makes_it(self, client, world, role):
        world.holding(MarketRole.EDITOR)
        made(client)
        world.holding(role)
        stored = copy.deepcopy(world.markets.doc["doorCode"])

        read, make = client.get(PATH), client.post(PATH)

        for response in (read, make):
            assert response.status_code == 403
            assert "code" not in response.get_json()
        assert world.markets.doc["doorCode"] == stored

    def test_it_follows_the_market_s_own_row(self, client, world):
        world.markets.doc["permissions"] = {"check-in": {"role": "admin", "source": "market"}}

        world.holding(MarketRole.EDITOR)
        assert client.get(PATH).status_code == 403
        assert client.post(PATH).status_code == 403

        world.holding(MarketRole.ADMIN)
        assert client.post(PATH).status_code == 200

    def test_a_market_that_does_not_exist_is_not_found(self, client):
        assert client.get("/markets/market-missing/door-code").status_code == 404
        assert client.post("/markets/market-missing/door-code").status_code == 404


class TestTheHistory:
    def test_a_new_code_is_recorded_as_the_organizer_s_with_no_code_in_it(self, client, world):
        first = made(client)["code"]
        second = made(client)["code"]

        entries = world.history.documents
        assert [(e["actor"], e["action"], e["kind"], e["vendors"]) for e in entries] == [
            (ORGANIZER, "check-in", History.DOOR_CODE_MADE, []),
        ] * 2
        assert [e["detail"] for e in entries] == [{"replaced": False}, {"replaced": True}]
        for code in (first, second):
            assert code not in repr(entries)


class TestNoMarketReadServesIt:
    def test_the_market_read(self, client):
        code = made(client)["code"]

        response = client.get(f"/markets/{MARKET}")

        assert response.status_code == 200, response.get_json()
        assert "doorCode" not in response.get_json()["market"]
        assert code not in response.get_data(as_text=True)

    def test_the_market_list(self, client, monkeypatch):
        monkeypatch.setattr(MarketsApi.OrgsApi, "organization_documents_of", lambda _user_id: [])
        code = made(client)["code"]

        response = client.get("/markets")

        assert response.status_code == 200, response.get_json()
        [entry] = response.get_json()["markets"]
        assert "doorCode" not in entry
        assert code not in response.get_data(as_text=True)

    def test_the_stored_document_keeps_it(self, client, world):
        """Leaving it out of a read never takes it off the market."""
        code = made(client)["code"]
        client.get(f"/markets/{MARKET}")

        assert world.markets.doc["doorCode"]["code"] == code
