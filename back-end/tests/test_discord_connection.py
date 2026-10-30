"""A market connected to a Discord server (E46/F01/S02).

An Admin connects the market through Discord's approval screen, then picks the role to give and the
question that holds each vendor's username; the card stays editable in every phase until the market
is archived. Every write goes through the Flask client as the card sends it, with Discord's API
replaced by fakes of ``discord_client``'s three calls.
"""
import copy
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

import pytest

from conftest import sessions_load_through_get_user, skip_without_real_dependencies, stored_market

skip_without_real_dependencies()

import app as app_module  # noqa: E402
import api.discord_connection as DiscordConnection  # noqa: E402
import api.market_actions as Actions  # noqa: E402
import api.markets as MarketsApi  # noqa: E402
import api.organizations as OrgsApi  # noqa: E402
import api.permissions as PermissionsApi  # noqa: E402
import api.users as UsersApi  # noqa: E402
import discord_client as Discord  # noqa: E402
import history as History  # noqa: E402
from datatypes import MarketPhase, MarketRole  # noqa: E402
from test_every_write_records import LiveMarkets  # noqa: E402

MARKET = "market-123"
ADMIN = "admin@example.com"
GUILD = "2909267986263572999"
OTHER_GUILD = "2909267986263573111"
VENDOR_TEST = Discord.Role("r-vendor", "Vendor Test", below_bot=True)
MODERATOR = Discord.Role("r-mod", "Moderator", below_bot=False)
DISCORD_QUESTION = {"key": "discord_username", "label": "Discord Username", "type": "text"}
SHOP_QUESTION = {"key": "shop", "label": "Shop name", "type": "text"}
DAYS_QUESTION = {"key": "days", "label": "Days", "type": "select", "options": ["One", "Two"]}


def _account(email):
    return SimpleNamespace(id=f"user-{email.split('@')[0]}", email=email, is_active=True,
                           is_authenticated=True, is_anonymous=False, get_id=lambda: email)


@pytest.fixture
def world(monkeypatch, market_records):
    markets = LiveMarkets()
    monkeypatch.setattr(MarketsApi, "markets_collection", markets)
    monkeypatch.setattr(UsersApi, "get_user", _account)
    monkeypatch.setattr(UsersApi, "get_user_by_id", lambda _uid: None)
    monkeypatch.setattr(OrgsApi, "get_organization", lambda _oid: None)
    monkeypatch.setenv("DISCORD_CLIENT_ID", "1565000000000000001")
    monkeypatch.setenv("DISCORD_CLIENT_SECRET", "a-client-secret-of-the-deployments")
    monkeypatch.setenv("DISCORD_BOT_TOKEN", "a-bot-token-of-the-deployments")
    monkeypatch.setenv("FRONTEND_URL", "https://conventioner.io")

    discord = SimpleNamespace(server=Discord.Server(GUILD, "Market Vendors"),
                              roles=[MODERATOR, VENDOR_TEST], codes=[])

    def connected_server(_values, code, redirect_uri):
        discord.codes.append((code, redirect_uri))
        return discord.server

    monkeypatch.setattr(Discord, "connected_server", connected_server)
    monkeypatch.setattr(Discord, "server_roles", lambda _values, _guild: discord.roles)

    def market(phase=MarketPhase.DRAFT, role=MarketRole.ADMIN, **overrides):
        monkeypatch.setattr(PermissionsApi, "get_user_market_role", lambda *_a, **_k: role)
        markets.doc = copy.deepcopy(stored_market(phase, **overrides))
        return markets.doc

    return SimpleNamespace(market=market, markets=markets, discord=discord,
                           history=market_records.history, patch=monkeypatch)


@pytest.fixture
def client(monkeypatch, world):
    monkeypatch.setattr(app_module.login_manager, "session_protection", None)
    sessions_load_through_get_user(monkeypatch)
    client = app_module.app.test_client()
    with client.session_transaction() as session:
        session["_user_id"] = ADMIN
        session["_fresh"] = True
    return client


def _start(client):
    response = client.post(f"/markets/{MARKET}/discord/authorization")
    assert response.status_code == 200, response.get_json()
    query = parse_qs(urlparse(response.get_json()["url"]).query)
    return query["state"][0]


def _connect(client, state=None, code="a-code"):
    state = state if state is not None else _start(client)
    return client.post(f"/markets/{MARKET}/discord/connection", json={"code": code, "state": state})


def _stored(world):
    return world.markets.doc.get("discord")


class TestConnecting:
    def test_the_approval_screen_comes_back_to_the_app(self, client, world):
        world.market()

        response = client.post(f"/markets/{MARKET}/discord/authorization")

        query = parse_qs(urlparse(response.get_json()["url"]).query)
        assert query["redirect_uri"] == ["https://conventioner.io/discord/connected"]
        assert query["state"][0].startswith(f"{MARKET}.")

    def test_an_admin_connects_the_market_to_the_server_discord_names(self, client, world):
        world.market()

        response = _connect(client)

        assert response.status_code == 200, response.get_json()
        assert _stored(world)["guildId"] == GUILD
        assert _stored(world)["guildName"] == "Market Vendors"
        assert set(_stored(world)) == {"guildId", "guildName"}
        assert world.discord.codes == [("a-code", "https://conventioner.io/discord/connected")]

    def test_the_answer_names_the_market_so_the_app_goes_back_to_it(self, client, world):
        world.market()

        assert _connect(client).get_json()["marketId"] == MARKET

    def test_a_state_this_session_never_started_is_refused(self, client, world):
        world.market()
        _start(client)

        response = _connect(client, state=f"{MARKET}.someone-elses")

        assert response.status_code == 400
        assert "Connect Discord again" in response.get_json()["error"]
        assert _stored(world) is None
        assert world.discord.codes == []

    def test_a_state_another_person_started_is_refused(self, client, world):
        """Two accounts on one browser: the second cannot finish what the first began."""
        world.market()
        state = _start(client)
        with client.session_transaction() as session:
            session["_user_id"] = "another-admin@example.com"

        response = _connect(client, state)

        assert response.status_code == 400
        assert _stored(world) is None
        assert world.discord.codes == []

    def test_a_state_is_spent_once(self, client, world):
        world.market()
        state = _start(client)
        assert _connect(client, state).status_code == 200

        assert _connect(client, state).status_code == 400

    def test_a_state_started_for_another_market_is_refused(self, client, world):
        world.market()
        state = _start(client)

        world.markets.doc["id"] = "market-456"
        response = client.post("/markets/market-456/discord/connection",
                               json={"code": "a-code", "state": state})

        assert response.status_code == 400
        assert _stored(world) is None

    def test_a_state_left_too_long_is_refused(self, client, world):
        world.market()
        state = _start(client)
        world.patch.setattr(DiscordConnection, "_now", lambda: 10 ** 12)

        assert _connect(client, state).status_code == 400

    def test_a_username_question_about_discord_is_chosen_on_connecting(self, client, world):
        world.market(applicationForm={"fields": [SHOP_QUESTION, DISCORD_QUESTION]})

        _connect(client)

        assert _stored(world)["usernameQuestion"] == "discord_username"

    def test_connecting_again_to_the_same_server_keeps_the_choices(self, client, world):
        world.market()
        _connect(client)
        client.put(f"/markets/{MARKET}/discord",
                   json={"roleId": "r-vendor", "inviteLink": "https://discord.gg/abc123"})

        _connect(client)

        assert _stored(world)["roleId"] == "r-vendor"
        assert _stored(world)["inviteLink"] == "https://discord.gg/abc123"

    def test_connecting_to_another_server_forgets_the_first_servers_role(self, client, world):
        world.market()
        _connect(client)
        client.put(f"/markets/{MARKET}/discord",
                   json={"roleId": "r-vendor", "inviteLink": "https://discord.gg/abc123"})
        world.discord.server = Discord.Server(OTHER_GUILD, "Another Server")

        _connect(client)

        assert _stored(world)["guildId"] == OTHER_GUILD
        assert _stored(world).get("roleId") is None
        assert _stored(world).get("inviteLink") is None


class TestTheCardsChoices:
    def test_the_role_is_one_of_the_servers_and_its_name_is_kept(self, client, world):
        world.market()
        _connect(client)

        response = client.put(f"/markets/{MARKET}/discord", json={"roleId": "r-vendor"})

        assert response.status_code == 200, response.get_json()
        assert (_stored(world)["roleId"], _stored(world)["roleName"]) == ("r-vendor", "Vendor Test")

    def test_a_role_above_the_bots_may_be_chosen(self, client, world):
        """The organizer decides the role (Q11); the card says to move the bot's role above it."""
        world.market()
        _connect(client)

        response = client.put(f"/markets/{MARKET}/discord", json={"roleId": "r-mod"})

        assert response.status_code == 200
        assert _stored(world)["roleId"] == "r-mod"

    def test_a_role_the_server_does_not_have_is_refused(self, client, world):
        world.market()
        _connect(client)

        response = client.put(f"/markets/{MARKET}/discord", json={"roleId": "r-gone"})

        assert response.status_code == 400
        assert _stored(world).get("roleId") is None

    def test_the_username_question_is_one_of_the_forms_text_questions(self, client, world):
        world.market(applicationForm={"fields": [SHOP_QUESTION, DAYS_QUESTION]})
        _connect(client)

        assert client.put(f"/markets/{MARKET}/discord",
                          json={"usernameQuestion": "shop"}).status_code == 200
        assert client.put(f"/markets/{MARKET}/discord",
                          json={"usernameQuestion": "days"}).status_code == 400
        assert client.put(f"/markets/{MARKET}/discord",
                          json={"usernameQuestion": "nope"}).status_code == 400
        assert _stored(world)["usernameQuestion"] == "shop"

    @pytest.mark.parametrize("link", ["discord.gg/abc", "javascript:alert(1)", "http://discord.gg/abc",
                                      "https://" + "a" * 300])
    def test_an_invite_link_is_an_https_address(self, client, world, link):
        world.market()
        _connect(client)

        response = client.put(f"/markets/{MARKET}/discord", json={"inviteLink": link})

        assert response.status_code == 400
        assert _stored(world).get("inviteLink") is None

    def test_a_blank_invite_link_clears_it(self, client, world):
        world.market()
        _connect(client)
        client.put(f"/markets/{MARKET}/discord", json={"inviteLink": "https://discord.gg/abc123"})

        client.put(f"/markets/{MARKET}/discord", json={"inviteLink": "  "})

        assert _stored(world).get("inviteLink") is None

    def test_a_choice_of_a_market_not_connected_is_refused(self, client, world):
        world.market()

        response = client.put(f"/markets/{MARKET}/discord", json={"roleId": "r-vendor"})

        assert response.status_code == 400

    def test_a_value_that_is_not_a_string_is_refused(self, client, world):
        world.market()
        _connect(client)

        response = client.put(f"/markets/{MARKET}/discord", json={"roleId": {"$ne": None}})

        assert response.status_code == 400

    @pytest.mark.parametrize("phase", [MarketPhase.ASSIGNMENT, MarketPhase.MARKET_DAYS])
    def test_the_card_stays_editable_after_draft(self, client, world, phase):
        world.market(phase)

        assert _connect(client).status_code == 200
        assert client.put(f"/markets/{MARKET}/discord",
                          json={"roleId": "r-vendor"}).status_code == 200

    def test_the_servers_roles_are_read_for_the_card(self, client, world):
        world.market()
        _connect(client)

        response = client.get(f"/markets/{MARKET}/discord/roles")

        assert response.status_code == 200
        assert response.get_json() == {"roles": [
            {"id": "r-mod", "name": "Moderator", "belowBot": False},
            {"id": "r-vendor", "name": "Vendor Test", "belowBot": True},
        ]}


class TestDisconnecting:
    def test_it_forgets_the_server_and_keeps_the_username_question(self, client, world):
        world.market(applicationForm={"fields": [DISCORD_QUESTION]})
        _connect(client)
        client.put(f"/markets/{MARKET}/discord", json={"roleId": "r-vendor"})

        response = client.delete(f"/markets/{MARKET}/discord/connection")

        assert response.status_code == 200
        assert _stored(world) == {"usernameQuestion": "discord_username"}

    def test_a_market_not_connected_records_nothing(self, client, world):
        world.market()

        assert client.delete(f"/markets/{MARKET}/discord/connection").status_code == 200
        assert world.history.documents == []


class TestWhoMay:
    @pytest.mark.parametrize("role", [MarketRole.EDITOR, MarketRole.VIEWER])
    def test_every_write_refuses_below_an_admin(self, client, world, role):
        world.market(role=MarketRole.ADMIN)
        _connect(client)
        world.market(role=role, discord=copy.deepcopy(_stored(world)))
        before = copy.deepcopy(_stored(world))
        sentence = Actions.refusal_sentence(Actions.CONNECT_DISCORD)

        for response in (
            client.post(f"/markets/{MARKET}/discord/authorization"),
            client.post(f"/markets/{MARKET}/discord/connection", json={"code": "c", "state": "s"}),
            client.put(f"/markets/{MARKET}/discord", json={"roleId": "r-vendor"}),
            client.delete(f"/markets/{MARKET}/discord/connection"),
            client.get(f"/markets/{MARKET}/discord/roles"),
        ):
            assert response.status_code == 403
            assert response.get_json()["error"] == sentence
        assert _stored(world) == before

    def test_the_row_is_an_admins_by_default(self):
        assert Actions.CONNECT_DISCORD.default is MarketRole.ADMIN
        assert Actions.refusal_sentence(Actions.CONNECT_DISCORD) == (
            "Only an Admin or the owner may connect this market to Discord or give its role.")

    def test_an_archived_market_refuses_every_change(self, client, world):
        world.market(MarketPhase.ARCHIVED, role=MarketRole.OWNER,
                     discord={"guildId": GUILD, "guildName": "Market Vendors"})

        for response in (
            client.post(f"/markets/{MARKET}/discord/authorization"),
            client.post(f"/markets/{MARKET}/discord/connection", json={"code": "c", "state": "s"}),
            client.put(f"/markets/{MARKET}/discord", json={"inviteLink": ""}),
            client.delete(f"/markets/{MARKET}/discord/connection"),
        ):
            assert response.status_code == 403
            assert response.get_json()["error"] == MarketsApi.ARCHIVED_REFUSAL


class TestADeploymentWithoutDiscord:
    def test_someone_the_row_refuses_is_told_that_first(self, client, world, monkeypatch):
        world.market(role=MarketRole.EDITOR)
        monkeypatch.delenv("DISCORD_BOT_TOKEN")

        response = client.post(f"/markets/{MARKET}/discord/authorization")

        assert response.status_code == 403
        assert response.get_json()["error"] == Actions.refusal_sentence(Actions.CONNECT_DISCORD)

    def test_connecting_says_discord_is_not_set_up(self, client, world, monkeypatch):
        world.market()
        monkeypatch.delenv("DISCORD_BOT_TOKEN")

        response = client.post(f"/markets/{MARKET}/discord/authorization")

        assert response.status_code == 503
        assert response.get_json()["error"] == Discord.NOT_SET_UP

    def test_the_market_read_says_whether_discord_is_set_up(self, client, world, monkeypatch):
        world.market(_id="mongo-market-123")
        assert client.get(f"/markets/{MARKET}").get_json()["market"]["discordSetUp"] is True

        monkeypatch.delenv("DISCORD_CLIENT_ID")

        assert client.get(f"/markets/{MARKET}").get_json()["market"]["discordSetUp"] is False


class TestTheHistory:
    def test_connecting_records_who_and_the_server_before_and_after(self, client, world):
        world.market()

        _connect(client)

        [entry] = world.history.documents
        assert entry["actor"] == ADMIN
        assert entry["action"] == Actions.CONNECT_DISCORD.id
        assert entry["kind"] == History.DISCORD_CONNECTED
        assert entry["detail"]["before"] == {"guild_id": None, "guild_name": None}
        assert entry["detail"]["after"] == {"guild_id": GUILD, "guild_name": "Market Vendors"}

    def test_a_choice_records_what_it_changed(self, client, world):
        world.market()
        _connect(client)
        world.history.documents.clear()

        client.put(f"/markets/{MARKET}/discord", json={"roleId": "r-vendor"})

        [entry] = world.history.documents
        assert entry["kind"] == History.DISCORD_SETTINGS
        assert entry["detail"] == {
            "before": {"role_id": None, "role_name": None},
            "after": {"role_id": "r-vendor", "role_name": "Vendor Test"},
        }

    def test_a_choice_restated_records_nothing(self, client, world):
        world.market()
        _connect(client)
        client.put(f"/markets/{MARKET}/discord", json={"roleId": "r-vendor"})
        world.history.documents.clear()

        client.put(f"/markets/{MARKET}/discord", json={"roleId": "r-vendor"})

        assert world.history.documents == []

    def test_disconnecting_records_what_it_forgot(self, client, world):
        world.market()
        _connect(client)
        world.history.documents.clear()

        client.delete(f"/markets/{MARKET}/discord/connection")

        [entry] = world.history.documents
        assert entry["kind"] == History.DISCORD_DISCONNECTED
        assert entry["detail"]["before"] == {"guild_id": GUILD, "guild_name": "Market Vendors"}
        assert entry["detail"]["after"] == {"guild_id": None, "guild_name": None}
