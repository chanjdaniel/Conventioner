"""A market connected to a Discord server (E46/F01/S02).

An Admin connects the market through Discord's approval screen, then picks the role to give and the
question that holds each vendor's username; the card stays editable in every phase until the market
is archived. Every write goes through the Flask client as the card sends it, with Discord's API
replaced by fakes of ``discord_client``'s three calls.
"""
import copy
import json
from pathlib import Path
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
from test_discord_client import FakeDiscord  # noqa: E402
from test_every_write_records import LiveMarkets  # noqa: E402
from test_price_groups import GOLD_AND_SILVER  # noqa: E402

#: The client's own calls, before any test's fake stands in for them.
LIST_MEMBERS = Discord.server_members
ROLE_GRANTS = Discord.RoleGrants

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
def world(monkeypatch, market_records, applications):
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
                              roles=[MODERATOR, VENDOR_TEST], codes=[], members=[], listed=[])

    def connected_server(_values, code, redirect_uri):
        discord.codes.append((code, redirect_uri))
        return discord.server

    monkeypatch.setattr(Discord, "connected_server", connected_server)
    monkeypatch.setattr(Discord, "server_roles", lambda _values, _guild: discord.roles)

    def server_members(_values, guild, deadline=None):
        discord.listed.append(guild)
        return discord.members

    monkeypatch.setattr(Discord, "server_members", server_members)

    discord.given = []
    discord.asked = []
    #: A refusal to raise when the role is given to a member, by the member's id.
    discord.refusals = {}
    #: Each run's audit-log reason.
    discord.reasons = []
    #: What happens meanwhile, after each role is given: called with the member's id.
    discord.on_give = lambda _member_id: None

    class RoleGrants:
        def __init__(self, _values, guild, role_id, _role_name, *, reason, deadline):
            self.guild, self.role_id = guild, role_id
            discord.reasons.append(reason)

        def give(self, member_id):
            discord.asked.append(member_id)
            if member_id in discord.refusals:
                raise discord.refusals[member_id]
            discord.given.append((self.guild, member_id, self.role_id))
            discord.on_give(member_id)

    monkeypatch.setattr(Discord, "RoleGrants", RoleGrants)

    def market(phase=MarketPhase.DRAFT, role=MarketRole.ADMIN, **overrides):
        monkeypatch.setattr(PermissionsApi, "get_user_market_role", lambda *_a, **_k: role)
        markets.doc = copy.deepcopy(stored_market(phase, **overrides))
        return markets.doc

    def applicant(email, username=None, updated=None, application_type="main"):
        """A vendor's application, its username written as the form's text question took it, and
        an organizer's update of it beside."""
        app_id = f"app-{email.split('@')[0]}"
        applications.insert_one({
            "id": app_id, "market_id": MARKET, "applicant_email": email,
            "application_type": application_type, "status": "reviewer_approved",
            "submitted_at": f"2026-10-01T00:00:{len(applications.documents):02d}+00:00",
            "form_data": {} if username is None else {"discord_username": username},
            **({"answer_updates": {"discord_username": {
                "value": updated, "by": ADMIN, "at": "2026-10-02T00:00:00+00:00",
                "over": username}}} if updated is not None else {}),
        })
        return app_id

    return SimpleNamespace(market=market, markets=markets, discord=discord, applicant=applicant,
                           applications=applications, history=market_records.history,
                           patch=monkeypatch)


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

    def test_a_market_created_with_a_null_discord_connects(self, client, world):
        """A created market stores ``discord: null``, and Mongo refuses a dotted write under a
        null parent: the first connection must write the whole sub-document."""
        world.market(discord=None)

        response = _connect(client)

        assert response.status_code == 200, response.get_json()
        assert _stored(world)["guildId"] == GUILD
        assert _stored(world)["guildName"] == "Market Vendors"

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

    def test_a_check_finishing_while_connecting_to_the_same_server_is_kept(self, client, world):
        world.market(discord=CONNECTED, **WITH_THE_FORM)

        def connected_server(_values, code, redirect_uri):
            world.discord.codes.append((code, redirect_uri))
            world.markets.doc["discord"]["checkedAt"] = "2026-10-31T12:00:00+00:00"
            world.markets.doc["discord"]["vendorStates"] = [
                {"applicationId": "app-maple", "state": "in_server"}]
            return world.discord.server

        world.patch.setattr(Discord, "connected_server", connected_server)

        response = _connect(client)

        assert response.status_code == 200, response.get_json()
        assert _stored(world)["checkedAt"] == "2026-10-31T12:00:00+00:00"
        assert _stored(world)["vendorStates"] == [{"applicationId": "app-maple", "state": "in_server"}]

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

    def test_a_check_finishing_while_the_card_saves_is_kept(self, client, world):
        world.market(discord=CONNECTED)

        def server_roles(_values, guild):
            world.markets.doc["discord"]["checkedAt"] = "2026-10-31T12:00:00+00:00"
            world.markets.doc["discord"]["vendorStates"] = [
                {"applicationId": "app-maple", "state": "in_server"}]
            return world.discord.roles

        world.patch.setattr(Discord, "server_roles", server_roles)

        response = client.put(f"/markets/{MARKET}/discord", json={"roleId": "r-vendor"})

        assert response.status_code == 200, response.get_json()
        assert _stored(world)["roleId"] == "r-vendor"
        assert _stored(world)["checkedAt"] == "2026-10-31T12:00:00+00:00"
        assert _stored(world)["vendorStates"] == [{"applicationId": "app-maple", "state": "in_server"}]

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


def _refusals_logged(caplog):
    """What the Discord connection's own module logged at warning level, one line each."""
    return [record.getMessage() for record in caplog.records
            if record.name == "api.discord_connection" and record.levelname == "WARNING"]


class TestARefusedSaveIsLogged:
    """A 400 from the card says which refusal it was in the log, and never what was sent."""

    @pytest.mark.parametrize("body, sent, words", [
        ({"roleId": "sent-role-id-7"}, "sent-role-id-7",
         "That role is not one Conventioner can give in this server. Choose another."),
        ({"usernameQuestion": "sent-question-key-7"}, "sent-question-key-7",
         "The username question must be one of the form's text questions."),
        ({"inviteLink": "sent.invite/link-7"}, "sent.invite/link-7",
         "An invite link is a web address starting https://, like https://discord.gg/abc123."),
        ({"inviteLink": {"$ne": "sent-object-value-7"}}, "sent-object-value-7",
         "inviteLink must be a string."),
    ])
    def test_a_refusal_logs_its_words_and_never_what_was_sent(
        self, client, world, caplog, body, sent, words,
    ):
        world.market()
        _connect(client)

        with caplog.at_level("INFO"):
            response = client.put(f"/markets/{MARKET}/discord", json=body)

        assert response.status_code == 400
        assert response.get_json() == {"error": words}
        assert _refusals_logged(caplog) == [
            f"Discord card save refused for market {MARKET}: {words}"]
        assert sent not in caplog.text

    def test_a_market_not_connected_logs_its_refusal(self, client, world, caplog):
        world.market()

        with caplog.at_level("INFO"):
            response = client.put(f"/markets/{MARKET}/discord",
                                  json={"inviteLink": "sent.invite/link-7"})

        words = "This market is not connected to Discord. Connect Discord first."
        assert response.status_code == 400
        assert response.get_json() == {"error": words}
        assert _refusals_logged(caplog) == [
            f"Discord card save refused for market {MARKET}: {words}"]
        assert "sent.invite/link-7" not in caplog.text

    def test_a_refusal_changes_nothing_and_records_nothing(self, client, world):
        world.market()
        _connect(client)
        before = _stored(world)
        recorded = len(world.history.documents)

        client.put(f"/markets/{MARKET}/discord", json={"inviteLink": "discord.gg/abc"})

        assert _stored(world) == before
        assert len(world.history.documents) == recorded

    def test_a_save_that_succeeds_logs_no_refusal(self, client, world, caplog):
        world.market()
        _connect(client)

        with caplog.at_level("INFO"):
            response = client.put(f"/markets/{MARKET}/discord", json={
                "roleId": "r-vendor", "inviteLink": "https://discord.gg/abc123"})

        assert response.status_code == 200
        assert _refusals_logged(caplog) == []


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
            client.post(f"/markets/{MARKET}/discord/check"),
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
            client.post(f"/markets/{MARKET}/discord/check"),
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


def _member(user_id, username, roles=()):
    return Discord.Member(user_id, username, tuple(roles))


CONNECTED = {"guildId": GUILD, "guildName": "Market Vendors", "usernameQuestion": "discord_username"}
WITH_THE_FORM = {"applicationForm": {"fields": [SHOP_QUESTION, DISCORD_QUESTION]}}


def _check(client):
    return client.post(f"/markets/{MARKET}/discord/check")


def _states(world):
    return {state["applicationId"]: state["state"] for state in _stored(world)["vendorStates"]}


class TestCheckingWhoIsInTheServer:
    """Check Discord (E46/F01/S03): each vendor's username, as the organizer reads it, matched to
    the server's members by username alone."""

    def test_a_username_written_with_an_at_a_tag_or_spaces_matches_the_member(self, client, world):
        world.market(discord=CONNECTED, **WITH_THE_FORM)
        world.discord.members = [_member("1001", "riverside")]
        at = world.applicant("at@example.com", "@riverside")
        tag = world.applicant("tag@example.com", "Riverside#1234")
        spaced = world.applicant("spaced@example.com", " riverside ")

        response = _check(client)

        assert response.status_code == 200, response.get_json()
        assert _states(world) == {at: "in_server", tag: "in_server", spaced: "in_server"}
        assert world.discord.listed == [GUILD]

    def test_a_display_name_or_a_nickname_never_matches(self, client, world):
        """Anyone may set their display name to anything: only the username is the person's."""
        world.market(discord=CONNECTED, **WITH_THE_FORM)
        world.discord.members = [_member("1001", "fern_studio_42")]
        fern = world.applicant("fern@example.com", "Fern Studio")

        _check(client)

        assert _states(world) == {fern: "not_found"}

    def test_each_vendor_reads_has_the_role_in_the_server_not_found_or_no_username(
        self, client, world,
    ):
        world.market(discord={**CONNECTED, "roleId": "r-vendor", "roleName": "Vendor Test"},
                     **WITH_THE_FORM)
        world.discord.members = [_member("1001", "maple", ["r-vendor"]), _member("1002", "oak")]
        maple = world.applicant("maple@example.com", "maple")
        oak = world.applicant("oak@example.com", "oak")
        birch = world.applicant("birch@example.com", "birch")
        blank = world.applicant("blank@example.com", "  ")
        never = world.applicant("never@example.com")

        response = _check(client)

        assert _states(world) == {maple: "has_role", oak: "in_server", birch: "not_found",
                                  blank: "no_username", never: "no_username"}
        assert response.get_json()["counts"] == {
            "has_role": 1, "in_server": 1, "not_found": 1, "no_username": 2}

    def test_without_a_role_chosen_a_member_is_in_the_server(self, client, world):
        world.market(discord=CONNECTED, **WITH_THE_FORM)
        world.discord.members = [_member("1001", "maple", ["r-vendor"])]
        maple = world.applicant("maple@example.com", "maple")

        _check(client)

        assert _states(world) == {maple: "in_server"}

    def test_an_organizers_update_of_the_username_is_the_one_checked(self, client, world):
        world.market(discord=CONNECTED, **WITH_THE_FORM)
        world.discord.members = [_member("1001", "maple.crafts")]
        maple = world.applicant("maple@example.com", "maple", updated="maple.crafts")

        _check(client)

        assert _states(world) == {maple: "in_server"}

    def test_a_waitlist_application_is_not_a_vendor_checked(self, client, world):
        world.market(discord=CONNECTED, **WITH_THE_FORM)
        maple = world.applicant("maple@example.com", "maple")
        world.applicant("maple@example.com", "maple", application_type="waitlist")

        _check(client)

        assert list(_states(world)) == [maple]

    def test_the_states_are_kept_with_when_they_were_checked(self, client, world):
        world.market(_id="mongo-market-123", discord=CONNECTED, **WITH_THE_FORM)
        world.patch.setattr(DiscordConnection, "_checked_at", lambda: "2026-10-31T12:00:00+00:00")
        maple = world.applicant("maple@example.com", "maple")

        _check(client)

        assert _stored(world)["checkedAt"] == "2026-10-31T12:00:00+00:00"
        assert _stored(world)["vendorStates"] == [
            {"applicationId": maple, "state": "not_found", "answer": "maple"}]
        served = client.get(f"/markets/{MARKET}").get_json()["market"]["discord"]
        assert served["checkedAt"] == "2026-10-31T12:00:00+00:00"

    def test_a_check_keeps_the_cards_choices(self, client, world):
        world.market(discord={**CONNECTED, "roleId": "r-vendor", "roleName": "Vendor Test",
                              "inviteLink": "https://discord.gg/abc123"}, **WITH_THE_FORM)

        _check(client)

        assert {key: _stored(world)[key] for key in CONNECTED} == CONNECTED
        assert _stored(world)["roleId"] == "r-vendor"
        assert _stored(world)["inviteLink"] == "https://discord.gg/abc123"

    def _changed_while_listing(self, world, connection):
        """The card written by another request while the members are read, which on a large
        server, or under a 429, takes seconds."""
        def server_members(_values, guild, deadline=None):
            world.discord.listed.append(guild)
            world.markets.doc["discord"] = connection
            return world.discord.members

        world.patch.setattr(Discord, "server_members", server_members)

    @pytest.mark.parametrize("connection", [
        pytest.param({"usernameQuestion": "discord_username"}, id="disconnected"),
        pytest.param({**CONNECTED, "roleId": "r-vendor", "roleName": "Vendor Test"},
                     id="another-role"),
        pytest.param({**CONNECTED, "guildId": OTHER_GUILD, "guildName": "Another server"},
                     id="another-server"),
        pytest.param({**CONNECTED, "usernameQuestion": "shop"}, id="another-question"),
    ])
    def test_a_card_changed_while_the_members_are_read_is_kept_and_the_check_refused(
        self, client, world, connection,
    ):
        world.market(discord=CONNECTED, **WITH_THE_FORM)
        world.applicant("maple@example.com", "maple")
        self._changed_while_listing(world, connection)

        response = _check(client)

        assert response.status_code == 409, response.get_json()
        assert response.get_json()["error"] == DiscordConnection.CHANGED_WHILE_CHECKING
        assert _stored(world) == connection
        assert world.history.documents == []

    def test_an_invite_link_saved_while_the_members_are_read_is_kept(self, client, world):
        """The states are read against the server, its role and the username question only."""
        world.market(discord=CONNECTED, **WITH_THE_FORM)
        maple = world.applicant("maple@example.com", "maple")
        self._changed_while_listing(world, {**CONNECTED, "inviteLink": "https://discord.gg/abc123"})

        response = _check(client)

        assert response.status_code == 200, response.get_json()
        assert _stored(world)["inviteLink"] == "https://discord.gg/abc123"
        assert _states(world) == {maple: "not_found"}

    def test_a_market_not_connected_is_refused(self, client, world):
        world.market(**WITH_THE_FORM)

        response = _check(client)

        assert response.status_code == 400
        assert response.get_json()["error"] == DiscordConnection.NOT_CONNECTED

    def test_a_market_with_no_username_question_is_refused(self, client, world):
        world.market(discord={"guildId": GUILD, "guildName": "Market Vendors"}, **WITH_THE_FORM)

        response = _check(client)

        assert response.status_code == 400
        assert response.get_json()["error"] == DiscordConnection.NO_USERNAME_QUESTION
        assert world.discord.listed == []

    def test_a_username_question_taken_off_the_form_asks_to_choose_it_again(self, client, world):
        """The question is checked when the card saves it, and again here: a form changed since
        may have taken it away (T113 rereview note 10)."""
        world.market(discord=CONNECTED, applicationForm={"fields": [SHOP_QUESTION]})

        response = _check(client)

        assert response.status_code == 400
        assert response.get_json()["error"] == DiscordConnection.USERNAME_QUESTION_GONE
        assert "Choose the username question again" in DiscordConnection.USERNAME_QUESTION_GONE
        assert world.discord.listed == []
        assert world.history.documents == []

    def test_connecting_to_another_server_forgets_the_check(self, client, world):
        world.market(discord=CONNECTED, **WITH_THE_FORM)
        world.applicant("maple@example.com", "maple")
        _check(client)
        world.discord.server = Discord.Server(OTHER_GUILD, "Another server")

        _connect(client)

        assert "vendorStates" not in _stored(world) and "checkedAt" not in _stored(world)

    def test_choosing_another_username_question_forgets_the_check(self, client, world):
        """The states were read against the old question's answers (T157 review note 3)."""
        world.market(discord=CONNECTED, **WITH_THE_FORM)
        world.applicant("maple@example.com", "maple")
        _check(client)

        response = client.put(f"/markets/{MARKET}/discord", json={"usernameQuestion": "shop"})

        assert response.status_code == 200, response.get_json()
        assert _stored(world)["usernameQuestion"] == "shop"
        assert "vendorStates" not in _stored(world) and "checkedAt" not in _stored(world)

    def test_restating_the_username_question_keeps_the_check(self, client, world):
        world.market(discord=CONNECTED, **WITH_THE_FORM)
        maple = world.applicant("maple@example.com", "maple")
        _check(client)

        client.put(f"/markets/{MARKET}/discord",
                   json={"usernameQuestion": "discord_username", "inviteLink": ""})

        assert _states(world) == {maple: "not_found"}

    def test_a_check_finishing_while_another_question_is_chosen_is_forgotten(self, client, world):
        """The card's write must forget the check's fields whatever the connection it read held."""
        world.market(discord=CONNECTED, **WITH_THE_FORM)
        maple = world.applicant("maple@example.com", "maple")
        load = MarketsApi._load_market_to_change

        def loaded_then_checked(*args, **kwargs):
            market = load(*args, **kwargs)
            world.markets.doc["discord"] = {
                **CONNECTED, "checkedAt": "2026-10-31T12:00:00+00:00",
                "vendorStates": [{"applicationId": maple, "state": "not_found"}]}
            return market

        world.patch.setattr(MarketsApi, "_load_market_to_change", loaded_then_checked)

        client.put(f"/markets/{MARKET}/discord", json={"usernameQuestion": "shop"})

        assert _stored(world)["usernameQuestion"] == "shop"
        assert "vendorStates" not in _stored(world) and "checkedAt" not in _stored(world)

    def test_reconnecting_with_the_question_gone_forgets_the_check(self, client, world):
        """Connecting again to the same server chooses a question afresh when the form lost the
        old one, and the states read against the old one go with it."""
        world.market(discord={**CONNECTED, "usernameQuestion": "gone",
                              "checkedAt": "2026-10-31T12:00:00+00:00",
                              "vendorStates": [{"applicationId": "app-maple",
                                                "state": "not_found"}]},
                     **WITH_THE_FORM)

        assert _connect(client).status_code == 200

        assert _stored(world)["usernameQuestion"] == "discord_username"
        assert "vendorStates" not in _stored(world) and "checkedAt" not in _stored(world)

    def test_disconnecting_forgets_the_check(self, client, world):
        world.market(discord=CONNECTED, **WITH_THE_FORM)
        world.applicant("maple@example.com", "maple")
        _check(client)

        client.delete(f"/markets/{MARKET}/discord/connection")

        assert _stored(world) == {"usernameQuestion": "discord_username"}

    def test_a_first_check_finishing_while_another_server_connects_is_forgotten(
        self, client, world,
    ):
        """The card's writes set only what they change, so the server's change must forget the
        check's fields whatever the connection read before them held: here, never checked."""
        world.market(discord=CONNECTED, **WITH_THE_FORM)
        maple = world.applicant("maple@example.com", "maple")
        state = _start(client)

        def connected_server(_values, _code, _redirect_uri):
            world.markets.doc["discord"] = {
                **CONNECTED, "checkedAt": "2026-10-31T12:00:00+00:00",
                "vendorStates": [{"applicationId": maple, "state": "not_found"}]}
            return Discord.Server(OTHER_GUILD, "Another server")

        world.patch.setattr(Discord, "connected_server", connected_server)

        assert _connect(client, state).status_code == 200

        assert _stored(world)["guildId"] == OTHER_GUILD
        assert "vendorStates" not in _stored(world) and "checkedAt" not in _stored(world)

    def test_a_first_check_finishing_while_disconnecting_is_forgotten(self, client, world):
        world.market(discord=CONNECTED, **WITH_THE_FORM)
        maple = world.applicant("maple@example.com", "maple")
        load = MarketsApi._load_market_to_change

        def loaded_then_checked(*args, **kwargs):
            market = load(*args, **kwargs)
            world.markets.doc["discord"] = {
                **CONNECTED, "checkedAt": "2026-10-31T12:00:00+00:00",
                "vendorStates": [{"applicationId": maple, "state": "not_found"}]}
            return market

        world.patch.setattr(MarketsApi, "_load_market_to_change", loaded_then_checked)

        client.delete(f"/markets/{MARKET}/discord/connection")

        assert _stored(world) == {"usernameQuestion": "discord_username"}

    def test_a_429_from_discord_is_waited_out_and_the_check_finishes(self, client, world):
        """Discord itself faked, under ``discord_client``, so the wait is the client's own."""
        world.market(discord=CONNECTED, **WITH_THE_FORM)
        maple = world.applicant("maple@example.com", "@Maple")
        # The fake of the list stands aside for the client's own, so the wait is its own.
        world.patch.setattr(Discord, "server_members", LIST_MEMBERS)
        answers = [
            SimpleNamespace(status_code=429, ok=False, headers={},
                            json=lambda: {"retry_after": 0.5, "global": False}),
            SimpleNamespace(status_code=200, ok=True, headers={}, json=lambda: [
                {"user": {"id": "1001", "username": "maple"}, "roles": []}]),
        ]
        waits = []
        world.patch.setattr(Discord.requests, "request", lambda *_a, **_k: answers.pop(0))
        world.patch.setattr(Discord, "_wait", waits.append)

        response = _check(client)

        assert response.status_code == 200, response.get_json()
        assert waits == [0.5]
        assert _states(world) == {maple: "in_server"}


def _a_paged_server_on_a_clock(world, pages, seconds_per_page, page_answer=None):
    """Discord's own API faked under ``discord_client``, on a clock each request and each wait moves
    on: ``pages`` full pages of members, ``member0`` onwards, and a last short one, each taking
    ``seconds_per_page``, or the ``timeout`` it was given if that is shorter, as a slow Discord
    would. ``page_answer(n)`` may answer the n-th page asked, from 1, instead. Each grant takes
    ``PER_REQUEST`` and is given."""
    world.patch.setattr(Discord, "server_members", LIST_MEMBERS)
    world.patch.setattr(Discord, "RoleGrants", ROLE_GRANTS)
    clock = SimpleNamespace(now=1000.0, started=1000.0, gets=0, waits=[], puts=[], read_by=None)
    world.patch.setattr(Discord, "clock", lambda: clock.now)

    def wait(seconds):
        clock.waits.append(seconds)
        clock.now += seconds

    world.patch.setattr(Discord, "_wait", wait)

    def request(method, url, timeout, **kwargs):
        if method == "PUT":
            clock.now += PER_REQUEST
            clock.puts.append(url)
            return SimpleNamespace(status_code=204, ok=True, headers={}, json=lambda: None)
        clock.gets += 1
        if seconds_per_page > timeout:
            clock.now += timeout
            raise Discord.requests.Timeout()
        clock.now += seconds_per_page
        answer = page_answer(clock.gets) if page_answer else None
        if answer is not None:
            return answer
        size = Discord.MEMBERS_PAGE if clock.gets <= pages else 1
        if size < Discord.MEMBERS_PAGE:
            clock.read_by = clock.now
        first = (clock.gets - 1) * Discord.MEMBERS_PAGE
        page = [{"user": {"id": str(10_000 + first + n), "username": f"member{first + n}"},
                 "roles": []} for n in range(size)]
        return SimpleNamespace(status_code=200, ok=True, headers={}, json=lambda: page)

    world.patch.setattr(Discord.requests, "request", request)
    return clock


#: How long Discord takes to answer a page of members on a slow day, and how many full pages, of
#: 1000 members each, are read within ``MEMBERS_READ_SECONDS`` at that pace (T155 rereview, note 6).
SLOW_PAGE_SECONDS = 0.5
PAGES_THAT_FIT = 29


class TestACheckWithinItsTime:
    """A check reads the members for ``MEMBERS_READ_SECONDS`` at most, as a run does, and a read
    that runs out answers ``CHECK_TOO_SLOW`` with nothing written or recorded: the back end is a
    function its host ends at a time limit, and a check cut off there answers in no words of its
    own (T155 rereview, finding 5)."""

    def test_a_server_whose_pages_take_four_seconds_each_is_too_slow_to_check(
        self, client, world,
    ):
        """The reviewer's plan, at the read's share: four seconds a page, which unbounded reads
        the server's five pages for twenty seconds."""
        world.market(discord=CONNECTED, **WITH_THE_FORM)
        world.applicant("maple@example.com", "maple")
        clock = _a_paged_server_on_a_clock(world, pages=4, seconds_per_page=4)

        response = _check(client)

        assert response.status_code == Discord.DiscordUnavailable.status, response.get_json()
        assert response.get_json()["error"] == DiscordConnection.CHECK_TOO_SLOW
        assert clock.now - clock.started <= DiscordConnection.MEMBERS_READ_SECONDS
        assert _stored(world) == CONNECTED
        assert world.history.documents == []

    def test_a_429_asking_past_the_checks_time_is_not_waited_out(self, client, world):
        world.market(discord=CONNECTED, **WITH_THE_FORM)
        world.applicant("maple@example.com", "maple")

        def limited_fourth_page(n):
            if n == 4:
                return SimpleNamespace(status_code=429, ok=False, headers={},
                                       json=lambda: {"retry_after": 8, "global": False})
            return None

        clock = _a_paged_server_on_a_clock(world, pages=4, seconds_per_page=3,
                                           page_answer=limited_fourth_page)

        response = _check(client)

        assert response.get_json()["error"] == DiscordConnection.CHECK_TOO_SLOW
        assert clock.waits == []
        assert _stored(world) == CONNECTED

    def test_the_pages_that_fit_at_a_slow_pace_are_checked(self, client, world):
        world.market(discord=CONNECTED, **WITH_THE_FORM)
        last = PAGES_THAT_FIT * Discord.MEMBERS_PAGE
        maple = world.applicant("maple@example.com", f"member{last}")
        clock = _a_paged_server_on_a_clock(world, pages=PAGES_THAT_FIT,
                                           seconds_per_page=SLOW_PAGE_SECONDS)

        response = _check(client)

        assert response.status_code == 200, response.get_json()
        assert _states(world) == {maple: "in_server"}
        assert clock.read_by - clock.started <= DiscordConnection.MEMBERS_READ_SECONDS

    def test_a_page_more_than_fit_at_a_slow_pace_is_too_slow(self, client, world):
        world.market(discord=CONNECTED, **WITH_THE_FORM)
        world.applicant("maple@example.com", "member0")
        _a_paged_server_on_a_clock(world, pages=PAGES_THAT_FIT + 1,
                                   seconds_per_page=SLOW_PAGE_SECONDS)

        response = _check(client)

        assert response.get_json()["error"] == DiscordConnection.CHECK_TOO_SLOW


class TestTheChecksHistory:
    def test_a_check_is_one_entry_naming_each_vendor_whose_state_changed(self, client, world):
        world.market(discord=CONNECTED, **WITH_THE_FORM)
        world.discord.members = [_member("1001", "maple")]
        maple = world.applicant("maple@example.com", "maple")
        oak = world.applicant("oak@example.com", "oak")

        _check(client)

        [entry] = world.history.documents
        assert entry["actor"] == ADMIN
        assert entry["action"] == Actions.CONNECT_DISCORD.id
        assert entry["kind"] == History.DISCORD_CHECKED
        assert entry["vendors"] == ["maple@example.com", "oak@example.com"]
        assert entry["subject"] == {"application_ids": [maple, oak]}
        assert entry["detail"] == {
            "before": {maple: None, oak: None},
            "after": {maple: "in_server", oak: "not_found"},
            "addresses": {maple: "maple@example.com", oak: "oak@example.com"},
            "counts": {"has_role": 0, "in_server": 1, "not_found": 1, "no_username": 0},
        }

    def test_each_address_is_kept_by_application_id_when_one_has_none(self, client, world):
        """The history leaves an empty address out of ``vendors``, so the entry says whose state
        is whose by id, never by position (T137 review note 4)."""
        world.market(discord=CONNECTED, **WITH_THE_FORM)
        nobody = world.applicant("nobody@example.com", "nobody")
        world.applications.documents[-1]["applicant_email"] = ""
        oak = world.applicant("oak@example.com", "oak")

        _check(client)

        [entry] = world.history.documents
        assert entry["vendors"] == ["oak@example.com"]
        assert entry["subject"] == {"application_ids": [nobody, oak]}
        assert entry["detail"]["addresses"] == {nobody: "", oak: "oak@example.com"}

    def test_a_check_again_names_only_the_vendors_it_changed(self, client, world):
        world.market(discord=CONNECTED, **WITH_THE_FORM)
        world.discord.members = [_member("1001", "maple")]
        world.applicant("maple@example.com", "maple")
        oak = world.applicant("oak@example.com", "oak")
        _check(client)
        world.history.documents.clear()
        world.discord.members = [_member("1001", "maple"), _member("1002", "oak")]

        _check(client)

        [entry] = world.history.documents
        assert entry["vendors"] == ["oak@example.com"]
        assert entry["detail"]["before"] == {oak: "not_found"}
        assert entry["detail"]["after"] == {oak: "in_server"}

    def test_a_check_that_changed_nobody_still_says_who_checked(self, client, world):
        world.market(discord=CONNECTED, **WITH_THE_FORM)
        world.applicant("maple@example.com", "maple")
        _check(client)
        world.history.documents.clear()

        _check(client)

        [entry] = world.history.documents
        assert entry["vendors"] == []
        assert entry["detail"]["before"] == {} and entry["detail"]["after"] == {}

    def test_the_vendors_own_history_holds_their_change(self, client, world):
        world.market(discord=CONNECTED, **WITH_THE_FORM)
        world.applicant("maple@example.com", "maple")
        world.applicant("oak@example.com", "oak")
        _check(client)

        # What the drawer's History tab reads: the market's history narrowed to the vendor.
        mine, _after = History.entries_page(MARKET, vendor="Oak@example.com")

        [entry] = mine
        assert entry["kind"] == History.DISCORD_CHECKED
        assert entry["actor"] == ADMIN and entry["at"]

    def test_a_choice_of_the_question_records_its_label(self, client, world):
        """The history names a question by its label, never its key (T127 review 6 note 30)."""
        world.market(discord={"guildId": GUILD, "guildName": "Market Vendors"}, **WITH_THE_FORM)

        client.put(f"/markets/{MARKET}/discord", json={"usernameQuestion": "discord_username"})

        [entry] = world.history.documents
        assert entry["detail"] == {
            "before": {"username_question": None, "username_question_label": None},
            "after": {"username_question": "discord_username",
                      "username_question_label": "Discord Username"},
        }


ROLE = "r-vendor"
WITH_THE_ROLE = {**CONNECTED, "roleId": ROLE, "roleName": "Vendor Nov 2026"}


def _seats(*emails, date="2026-11-18"):
    """The stored assignment: each of ``emails`` holding a seat on ``date``."""
    return {"assignmentObject": {"vendorAssignments": [
        {"email": email, "date": date, "tableCode": f"A-{n + 1}", "tableChoice": "Full Table",
         "section": "A", "tier": "Gold", "location": "Atrium", "handPlaced": False}
        for n, email in enumerate(emails)]}}


def _give(client):
    return client.post(f"/markets/{MARKET}/discord/role-run")


def _run(world):
    return _stored(world)["roleRun"]


def _outcomes(world):
    return {each["applicationId"]: each["outcome"] for each in _run(world)["outcomes"]}


class TestGivingTheRole:
    """Give roles (E46/F01/S04): the market's role to every assigned vendor in the server, in one
    run, never taking one away."""

    def test_a_run_over_five_assigned_vendors_gives_exactly_two_roles(self, client, world):
        """Discord's own API faked, under ``discord_client``: what is sent is what Discord gets."""
        world.patch.setattr(Discord, "server_members", LIST_MEMBERS)
        world.patch.setattr(Discord, "RoleGrants", ROLE_GRANTS)
        world.market(discord=WITH_THE_ROLE, **WITH_THE_FORM, **_seats(
            "ana@example.com", "ben@example.com", "cy@example.com", "dee@example.com",
            "eve@example.com"))
        ana = world.applicant("ana@example.com", "ana.makes")
        ben = world.applicant("ben@example.com", "@Ben_Prints")
        cy = world.applicant("cy@example.com", "cy")
        dee = world.applicant("dee@example.com", "dee.crafts")
        eve = world.applicant("eve@example.com")
        # In the server, but holding no seat: never given the role.
        world.applicant("fay@example.com", "fay")
        fake = FakeDiscord()
        fake.answer("GET", f"/guilds/{GUILD}/members", 200, [
            {"user": {"id": "1001", "username": "ana.makes"}, "roles": []},
            {"user": {"id": "1002", "username": "ben_prints"}, "roles": ["r-other"]},
            {"user": {"id": "1003", "username": "cy"}, "roles": [ROLE]},
            {"user": {"id": "1006", "username": "fay"}, "roles": []},
        ])
        for member in ("1001", "1002"):
            fake.answer("PUT", f"/guilds/{GUILD}/members/{member}/roles/{ROLE}", 204)
        world.patch.setattr(Discord.requests, "request", fake.request)

        response = _give(client)

        assert response.status_code == 200, response.get_json()
        assert [(sent.method, sent.url.rsplit("/guilds/", 1)[1]) for sent in fake.sent
                if sent.method != "GET"] == [
            ("PUT", f"{GUILD}/members/1001/roles/{ROLE}"),
            ("PUT", f"{GUILD}/members/1002/roles/{ROLE}"),
        ]
        assert _outcomes(world) == {ana: "given", ben: "given", cy: "already_had",
                                    dee: "not_found", eve: "no_username"}
        assert response.get_json()["counts"] == {
            "given": 2, "already_had": 1, "not_found": 1, "no_username": 1, "not_yet": 0,
            "failed": 0}

    def test_the_run_reads_the_server_once_and_gives_to_assigned_vendors_alone(
        self, client, world,
    ):
        world.market(discord=WITH_THE_ROLE, **WITH_THE_FORM, **_seats("ana@example.com"))
        world.discord.members = [_member("1001", "ana"), _member("1002", "ben")]
        world.applicant("ana@example.com", "ana")
        world.applicant("ben@example.com", "ben")

        _give(client)

        assert world.discord.listed == [GUILD]
        assert world.discord.given == [(GUILD, "1001", ROLE)]

    def test_assigned_means_a_seat_on_any_date(self, client, world):
        seats = _seats("ana@example.com", date="2026-11-18")
        seats["assignmentObject"]["vendorAssignments"] += _seats(
            "ben@example.com", date="2026-11-20")["assignmentObject"]["vendorAssignments"]
        world.market(discord=WITH_THE_ROLE, **WITH_THE_FORM, **seats)
        world.discord.members = [_member("1001", "ana"), _member("1002", "ben")]
        world.applicant("Ana@Example.com", "ana")
        world.applicant("ben@example.com", "ben")

        _give(client)

        assert [member for _, member, _ in world.discord.given] == ["1001", "1002"]

    def test_a_vendor_who_lost_their_seat_keeps_the_role_after_another_run(self, client, world):
        """A run only gives (Daniel, T92 Q19: "no" to taking a role away)."""
        world.patch.setattr(Discord, "server_members", LIST_MEMBERS)
        world.patch.setattr(Discord, "RoleGrants", ROLE_GRANTS)
        world.market(discord=WITH_THE_ROLE, **WITH_THE_FORM, **_seats("ben@example.com"))
        ana = world.applicant("ana@example.com", "ana")
        world.applicant("ben@example.com", "ben")
        fake = FakeDiscord()
        fake.answer("GET", f"/guilds/{GUILD}/members", 200, [
            {"user": {"id": "1001", "username": "ana"}, "roles": [ROLE]},
            {"user": {"id": "1002", "username": "ben"}, "roles": [ROLE]},
        ])
        world.patch.setattr(Discord.requests, "request", fake.request)

        response = _give(client)

        assert response.status_code == 200, response.get_json()
        assert {sent.method for sent in fake.sent} == {"GET"}
        assert ana not in _outcomes(world)
        assert _states(world)[ana] == "has_role"

    def test_a_role_above_the_bots_fails_the_rest_with_its_reason_asking_once(
        self, client, world,
    ):
        """Every grant would fail alike, so the run stops asking: 10,000 refused requests in ten
        minutes block the address."""
        world.market(discord=WITH_THE_ROLE, **WITH_THE_FORM, **_seats(
            "ana@example.com", "ben@example.com"))
        world.discord.members = [_member("1001", "ana"), _member("1002", "ben")]
        ana = world.applicant("ana@example.com", "ana")
        ben = world.applicant("ben@example.com", "ben")
        reason = Discord.role_above_bot("Vendor Nov 2026")
        world.discord.refusals["1001"] = Discord.DiscordRefused(reason)

        response = _give(client)

        assert response.status_code == 200, response.get_json()
        assert world.discord.asked == ["1001"]
        assert _run(world)["outcomes"] == [
            {"applicationId": ana, "outcome": "failed", "reason": reason},
            {"applicationId": ben, "outcome": "failed", "reason": reason},
        ]
        assert _states(world) == {ana: "in_server", ben: "in_server"}

    def test_a_member_who_left_meanwhile_fails_alone_and_the_run_goes_on(self, client, world):
        world.market(discord=WITH_THE_ROLE, **WITH_THE_FORM, **_seats(
            "ana@example.com", "ben@example.com"))
        world.discord.members = [_member("1001", "ana"), _member("1002", "ben")]
        ana = world.applicant("ana@example.com", "ana")
        ben = world.applicant("ben@example.com", "ben")
        world.discord.refusals["1001"] = Discord.MemberGone(Discord.MEMBER_GONE)

        _give(client)

        assert world.discord.given == [(GUILD, "1002", ROLE)]
        assert _run(world)["outcomes"][0] == {
            "applicationId": ana, "outcome": "failed", "reason": Discord.MEMBER_GONE}
        assert _states(world) == {ana: "not_found", ben: "has_role"}

    def test_discord_out_of_reach_midway_keeps_what_was_given(self, client, world):
        world.market(discord=WITH_THE_ROLE, **WITH_THE_FORM, **_seats(
            "ana@example.com", "ben@example.com", "cy@example.com"))
        world.discord.members = [_member("1001", "ana"), _member("1002", "ben"),
                                 _member("1003", "cy")]
        ana = world.applicant("ana@example.com", "ana")
        ben = world.applicant("ben@example.com", "ben")
        cy = world.applicant("cy@example.com", "cy")
        world.discord.refusals["1002"] = Discord.DiscordUnavailable(Discord.SLOW_DOWN)

        response = _give(client)

        assert response.status_code == 200, response.get_json()
        assert world.discord.asked == ["1001", "1002"]
        assert _outcomes(world) == {ana: "given", ben: "failed", cy: "failed"}
        assert {each["reason"] for each in _run(world)["outcomes"][1:]} == {Discord.SLOW_DOWN}
        [entry] = world.history.documents
        assert entry["detail"]["given"] == [ana]

    def test_the_states_update_from_the_run(self, client, world):
        world.patch.setattr(DiscordConnection, "_checked_at", lambda: "2026-10-31T12:00:00+00:00")
        world.market(discord=WITH_THE_ROLE, **WITH_THE_FORM, **_seats("ana@example.com"))
        world.discord.members = [_member("1001", "ana"), _member("1002", "ben")]
        ana = world.applicant("ana@example.com", "ana")
        ben = world.applicant("ben@example.com", "ben")
        cy = world.applicant("cy@example.com", "cy")

        _give(client)

        assert _states(world) == {ana: "has_role", ben: "in_server", cy: "not_found"}
        assert _stored(world)["checkedAt"] == "2026-10-31T12:00:00+00:00"

    def test_the_last_runs_report_is_kept_and_served_to_every_reader(self, client, world):
        world.patch.setattr(DiscordConnection, "_checked_at", lambda: "2026-10-31T12:00:00+00:00")
        world.market(_id="mongo-market-123", discord=WITH_THE_ROLE, **WITH_THE_FORM,
                     **_seats("ana@example.com"))
        world.discord.members = [_member("1001", "ana")]
        ana = world.applicant("ana@example.com", "ana")
        _give(client)
        world.patch.setattr(PermissionsApi, "get_user_market_role",
                            lambda *_a, **_k: MarketRole.VIEWER)

        served = client.get(f"/markets/{MARKET}").get_json()["market"]["discord"]["roleRun"]

        assert served == {
            "ranAt": "2026-10-31T12:00:00+00:00", "roleName": "Vendor Nov 2026",
            "outcomes": [{"applicationId": ana, "outcome": "given", "reason": None}],
        }

    def test_a_second_run_replaces_the_report(self, client, world):
        world.market(discord=WITH_THE_ROLE, **WITH_THE_FORM, **_seats("ana@example.com"))
        world.discord.members = [_member("1001", "ana")]
        ana = world.applicant("ana@example.com", "ana")
        _give(client)
        world.discord.members = [_member("1001", "ana", [ROLE])]

        _give(client)

        assert _outcomes(world) == {ana: "already_had"}

    def test_no_role_chosen_is_refused_before_discord_is_asked(self, client, world):
        world.market(discord=CONNECTED, **WITH_THE_FORM, **_seats("ana@example.com"))
        world.applicant("ana@example.com", "ana")

        response = _give(client)

        assert response.status_code == 400
        assert response.get_json()["error"] == DiscordConnection.NO_ROLE
        assert world.discord.listed == [] and world.history.documents == []

    def test_a_username_question_taken_off_the_form_is_refused(self, client, world):
        world.market(discord=WITH_THE_ROLE, applicationForm={"fields": [SHOP_QUESTION]})

        response = _give(client)

        assert response.status_code == 400
        assert response.get_json()["error"] == DiscordConnection.USERNAME_QUESTION_GONE
        assert world.discord.listed == []

    def test_a_market_not_connected_is_refused(self, client, world):
        world.market(**WITH_THE_FORM)

        response = _give(client)

        assert response.status_code == 400
        assert response.get_json()["error"] == DiscordConnection.NOT_CONNECTED

    @pytest.mark.parametrize("role", [MarketRole.EDITOR, MarketRole.VIEWER])
    def test_below_an_admin_is_refused(self, client, world, role):
        world.market(role=role, discord=WITH_THE_ROLE, **WITH_THE_FORM,
                     **_seats("ana@example.com"))

        response = _give(client)

        assert response.status_code == 403
        assert world.discord.listed == [] and world.discord.given == []

    def test_an_archived_market_refuses_it(self, client, world):
        world.market(phase=MarketPhase.ARCHIVED, discord=WITH_THE_ROLE, **WITH_THE_FORM,
                     **_seats("ana@example.com"))

        response = _give(client)

        assert response.status_code in (400, 403, 409)
        assert world.discord.given == []

    def test_connecting_to_another_server_forgets_the_run(self, client, world):
        world.market(discord=WITH_THE_ROLE, **WITH_THE_FORM, **_seats("ana@example.com"))
        world.applicant("ana@example.com", "ana")
        _give(client)
        world.discord.server = Discord.Server(OTHER_GUILD, "Another server")

        _connect(client)

        assert "roleRun" not in _stored(world)

    def test_disconnecting_forgets_the_run(self, client, world):
        world.market(discord=WITH_THE_ROLE, **WITH_THE_FORM, **_seats("ana@example.com"))
        world.applicant("ana@example.com", "ana")
        _give(client)

        client.delete(f"/markets/{MARKET}/discord/connection")

        assert _stored(world) == {"usernameQuestion": "discord_username"}

    def test_choosing_another_username_question_forgets_the_run(self, client, world):
        """Its outcomes were read against the old question's answers, so the report would name
        vendors as not found for a username they may since have given (T157 rereview finding 11)."""
        world.market(discord=WITH_THE_ROLE, **WITH_THE_FORM, **_seats("ana@example.com"))
        world.applicant("ana@example.com", "ana")
        _give(client)
        assert "roleRun" in _stored(world)

        response = client.put(f"/markets/{MARKET}/discord", json={"usernameQuestion": "shop"})

        assert response.status_code == 200, response.get_json()
        assert "roleRun" not in _stored(world)

    def test_restating_the_username_question_keeps_the_run(self, client, world):
        world.market(discord=WITH_THE_ROLE, **WITH_THE_FORM, **_seats("ana@example.com"))
        ana = world.applicant("ana@example.com", "ana")
        _give(client)

        client.put(f"/markets/{MARKET}/discord",
                   json={"usernameQuestion": "discord_username", "inviteLink": ""})

        assert _outcomes(world) == {ana: "not_found"}

    def test_a_run_finishing_while_another_question_is_chosen_is_forgotten(self, client, world):
        """The card's write must forget the run's report whatever the connection it read held."""
        world.market(discord=WITH_THE_ROLE, **WITH_THE_FORM, **_seats("ana@example.com"))
        ana = world.applicant("ana@example.com", "ana")
        load = MarketsApi._load_market_to_change

        def loaded_then_run(*args, **kwargs):
            market = load(*args, **kwargs)
            world.markets.doc["discord"] = {
                **WITH_THE_ROLE, "roleRun": {
                    "ranAt": "2026-10-31T12:00:00+00:00", "roleName": "Vendor Nov 2026",
                    "outcomes": [{"applicationId": ana, "outcome": "not_found"}]}}
            return market

        world.patch.setattr(MarketsApi, "_load_market_to_change", loaded_then_run)

        client.put(f"/markets/{MARKET}/discord", json={"usernameQuestion": "shop"})

        assert _stored(world)["usernameQuestion"] == "shop"
        assert "roleRun" not in _stored(world)

    def test_reconnecting_with_the_question_gone_forgets_the_run(self, client, world):
        world.market(discord={**WITH_THE_ROLE, "usernameQuestion": "gone", "roleRun": {
            "ranAt": "2026-10-31T12:00:00+00:00", "roleName": "Vendor Nov 2026",
            "outcomes": [{"applicationId": "app-ana", "outcome": "not_found"}]}},
            **WITH_THE_FORM)

        assert _connect(client).status_code == 200

        assert _stored(world)["usernameQuestion"] == "discord_username"
        assert "roleRun" not in _stored(world)

    def test_a_card_changed_meanwhile_keeps_it_and_still_records_the_roles_given(
        self, client, world,
    ):
        """The roles are given in Discord before the market is written, so a card changed while
        the run asked is kept, and what the run did is still in the history."""
        world.market(discord=WITH_THE_ROLE, **WITH_THE_FORM, **_seats("ana@example.com"))
        world.discord.members = [_member("1001", "ana")]
        ana = world.applicant("ana@example.com", "ana")
        changed = {**WITH_THE_ROLE, "roleId": "r-other", "roleName": "Other"}

        world.discord.on_give = lambda _member: world.markets.doc.update(discord=changed)

        response = _give(client)

        assert response.status_code == 409, response.get_json()
        assert response.get_json()["error"] == DiscordConnection.CHANGED_WHILE_GIVING
        assert _stored(world) == changed
        [entry] = world.history.documents
        assert entry["detail"]["given"] == [ana]
        assert entry["vendors"] == ["ana@example.com"]


#: How long the fake Discord takes to answer each request, on the fake clock.
PER_REQUEST = 0.05


def _discord_on_a_clock(world, members, put_answer):
    """Discord's own API faked under ``discord_client``, on a clock that each request and each wait
    moves on, as the back end's would. ``put_answer(n)`` answers the n-th grant asked, from 1."""
    world.patch.setattr(Discord, "server_members", LIST_MEMBERS)
    world.patch.setattr(Discord, "RoleGrants", ROLE_GRANTS)
    clock = SimpleNamespace(now=1000.0, waits=[], puts=[], started=None)
    world.patch.setattr(Discord, "clock", lambda: clock.now)

    def wait(seconds):
        clock.waits.append(seconds)
        clock.now += seconds

    world.patch.setattr(Discord, "_wait", wait)

    def request(method, url, **kwargs):
        if clock.started is None:
            clock.started = clock.now
        clock.now += PER_REQUEST
        if method == "GET":
            return SimpleNamespace(status_code=200, ok=True, headers={}, json=lambda: members)
        clock.puts.append(SimpleNamespace(url=url, **kwargs))
        status, body, headers = put_answer(len(clock.puts))
        return SimpleNamespace(status_code=status, ok=200 <= status < 300, headers=headers,
                               json=lambda: body)

    world.patch.setattr(Discord.requests, "request", request)
    return clock


def _given(_n):
    return 204, None, {}


class TestARunWithinItsTime:
    """A run asks Discord for ``ROLE_RUN_SECONDS`` at most, then reports the rest as not given yet
    and records what it gave: the back end is a function its host ends at a time limit, and a run
    cut off there would have given roles and recorded nothing (T155 review, finding 1)."""

    def test_the_back_end_keeps_fluid_computes_limit_well_past_the_run(self):
        """The run's time is sized to Fluid compute's 300 seconds on the Hobby plan: without Fluid
        the default is 10, and a run of ``ROLE_RUN_SECONDS`` would be ended mid-run."""
        config = json.loads((Path(__file__).resolve().parents[1] / "vercel.json").read_text())

        assert config.get("fluid") is True
        assert all(function.get("maxDuration", 300) >= 2 * DiscordConnection.ROLE_RUN_SECONDS
                   for function in config.get("functions", {}).values())
        assert DiscordConnection.MEMBERS_READ_SECONDS < DiscordConnection.ROLE_RUN_SECONDS

    def _fifty_four(self, world, has_role=()):
        emails = [f"vendor{n}@example.com" for n in range(54)]
        world.market(discord=WITH_THE_ROLE, **WITH_THE_FORM, **_seats(*emails))
        ids = [world.applicant(email, f"vendor{n}") for n, email in enumerate(emails)]
        members = [{"user": {"id": str(2000 + n), "username": f"vendor{n}"},
                    "roles": [ROLE] if n in has_role else []} for n in range(54)]
        return ids, members

    def test_every_tenth_grant_meeting_a_429_of_eight_seconds_ends_within_the_runs_time(
        self, client, world,
    ):
        """The reviewer's plan: 54 assigned vendors in the server, every tenth grant answered with
        a 429 asking eight seconds."""
        ids, members = self._fifty_four(world)

        def every_tenth_limited(n):
            if n % 10 == 0:
                return 429, {"retry_after": 8, "global": False}, {}
            return 204, None, {}

        clock = _discord_on_a_clock(world, members, every_tenth_limited)

        response = _give(client)

        assert response.status_code == 200, response.get_json()
        assert clock.now - clock.started <= DiscordConnection.ROLE_RUN_SECONDS + PER_REQUEST
        outcomes = _outcomes(world)
        given = [app_id for app_id in ids if outcomes[app_id] == "given"]
        not_yet = [app_id for app_id in ids if outcomes[app_id] == "not_yet"]
        assert len(given) + len(not_yet) == 54
        assert {each["reason"] for each in _run(world)["outcomes"]
                if each["outcome"] == "not_yet"} <= {DiscordConnection.NOT_GIVEN_YET}
        [entry] = world.history.documents
        assert entry["detail"]["given"] == given
        assert entry["detail"]["counts"]["not_yet"] == len(not_yet)
        assert all(_states(world)[app_id] == "has_role" for app_id in given)
        assert all(_states(world)[app_id] == "in_server" for app_id in not_yet)

    def test_a_refill_later_than_the_runs_time_leaves_the_rest_not_given_yet(
        self, client, world,
    ):
        """Discord says the route has no request left until after the run's time: the run stops
        asking there, rather than wait or meet a 429."""
        ids, members = self._fifty_four(world)

        def exhausted_at_once(_n):
            return 204, None, {"X-RateLimit-Remaining": "0",
                               "X-RateLimit-Reset-After": str(DiscordConnection.ROLE_RUN_SECONDS)}

        clock = _discord_on_a_clock(world, members, exhausted_at_once)

        response = _give(client)

        assert response.status_code == 200, response.get_json()
        assert len(clock.puts) == 1
        assert clock.waits == []
        assert response.get_json()["counts"] == {
            "given": 1, "already_had": 0, "not_found": 0, "no_username": 0, "not_yet": 53,
            "failed": 0}
        assert _run(world)["outcomes"][1] == {
            "applicationId": ids[1], "outcome": "not_yet",
            "reason": DiscordConnection.NOT_GIVEN_YET}

    def test_the_pages_that_fit_at_a_slow_pace_are_read_and_the_role_given(self, client, world):
        """A server of ``PAGES_THAT_FIT`` thousand members read at a slow pace leaves the grants
        the rest of the run's time."""
        last = PAGES_THAT_FIT * Discord.MEMBERS_PAGE
        world.market(discord=WITH_THE_ROLE, **WITH_THE_FORM, **_seats("ana@example.com"))
        ana = world.applicant("ana@example.com", f"member{last}")
        clock = _a_paged_server_on_a_clock(world, pages=PAGES_THAT_FIT,
                                           seconds_per_page=SLOW_PAGE_SECONDS)

        response = _give(client)

        assert response.status_code == 200, response.get_json()
        assert _outcomes(world) == {ana: "given"}
        assert clock.read_by - clock.started <= DiscordConnection.MEMBERS_READ_SECONDS
        assert len(clock.puts) == 1

    def test_a_read_past_its_share_stops_there_not_at_the_runs_end(self, client, world):
        """A read that runs out answers ``MEMBERS_TOO_SLOW``, with no grant, no write and no
        history, at the end of its share rather than of the run."""
        world.market(discord=WITH_THE_ROLE, **WITH_THE_FORM, **_seats("ana@example.com"))
        world.applicant("ana@example.com", "member0")
        clock = _a_paged_server_on_a_clock(world, pages=PAGES_THAT_FIT + 1,
                                           seconds_per_page=SLOW_PAGE_SECONDS)

        response = _give(client)

        assert response.get_json()["error"] == DiscordConnection.MEMBERS_TOO_SLOW
        assert clock.now - clock.started <= DiscordConnection.MEMBERS_READ_SECONDS
        assert clock.puts == []
        assert _stored(world) == WITH_THE_ROLE
        assert world.history.documents == []

    def test_a_second_run_gives_the_rest(self, client, world):
        ids, members = self._fifty_four(world, has_role=range(9))
        clock = _discord_on_a_clock(world, members, _given)

        response = _give(client)

        assert response.status_code == 200, response.get_json()
        assert len(clock.puts) == 45
        assert response.get_json()["counts"]["given"] == 45
        assert response.get_json()["counts"]["already_had"] == 9
        assert response.get_json()["counts"]["not_yet"] == 0

    def test_the_rate_limit_is_paced_rather_than_met(self, client, world):
        """Discord says how many grants the route has left: at none, the next waits for the refill
        within the run's time, and no 429 is met."""
        ids, members = self._fifty_four(world)

        def a_bucket_of_five(n):
            left = 5 - (n - 1) % 5 - 1
            return 204, None, {"X-RateLimit-Remaining": str(left), "X-RateLimit-Reset-After": "0.4"}

        clock = _discord_on_a_clock(world, members, a_bucket_of_five)

        response = _give(client)

        assert response.status_code == 200, response.get_json()
        assert clock.waits and all(wait == pytest.approx(0.4) for wait in clock.waits)
        assert len(clock.puts) == response.get_json()["counts"]["given"]

    def test_each_grant_names_conventioner_and_the_market_in_the_audit_log(self, client, world):
        _ids, members = self._fifty_four(world)
        clock = _discord_on_a_clock(world, members[:1], _given)

        _give(client)

        assert clock.puts[0].headers["X-Audit-Log-Reason"] == Discord.audit_reason(
            "Conventioner: Give roles for Test Market")


class TestACheckAndARunTogether:
    """A check and a run that overlap: the run's states stand, since its grants are newer than any
    member list read before them (T155 review, finding 3)."""

    def test_a_check_that_read_the_server_before_a_run_never_puts_back_its_states(
        self, client, world,
    ):
        world.market(discord=WITH_THE_ROLE, **WITH_THE_FORM, **_seats("ana@example.com"))
        world.discord.members = [_member("1001", "ana")]
        ana = world.applicant("ana@example.com", "ana")
        runs = []
        reads = []

        def server_members(_values, _guild, deadline=None):
            reads.append(_guild)
            members = list(world.discord.members)
            if len(reads) == 1:
                # The run lands between the check's read of the members and its write.
                runs.append(_give(client))
            return members

        world.patch.setattr(Discord, "server_members", server_members)

        response = _check(client)

        assert runs[0].status_code == 200, runs[0].get_json()
        assert response.status_code == 409, response.get_json()
        assert response.get_json()["error"] == DiscordConnection.CHANGED_WHILE_CHECKING
        assert _states(world) == {ana: "has_role"}
        assert [entry["kind"] for entry in world.history.documents] == [
            History.DISCORD_ROLES_GIVEN]

    def test_a_check_landing_while_a_run_asks_is_overwritten_by_the_run(self, client, world):
        world.market(discord=WITH_THE_ROLE, **WITH_THE_FORM, **_seats("ana@example.com"))
        world.discord.members = [_member("1001", "ana")]
        ana = world.applicant("ana@example.com", "ana")
        checks = []

        def check_meanwhile(_member_id):
            checks.append(_check(client))

        world.discord.on_give = check_meanwhile

        response = _give(client)

        assert checks[0].status_code == 200, checks[0].get_json()
        assert response.status_code == 200, response.get_json()
        assert _states(world) == {ana: "has_role"}


class TestTheRunsHistory:
    def test_a_run_is_one_entry_naming_each_vendor_it_changed(self, client, world):
        world.market(discord=WITH_THE_ROLE, **WITH_THE_FORM, **_seats(
            "ana@example.com", "ben@example.com", "cy@example.com"))
        world.discord.members = [_member("1001", "ana"), _member("1003", "cy", [ROLE])]
        ana = world.applicant("ana@example.com", "ana")
        ben = world.applicant("ben@example.com", "ben")
        world.applicant("cy@example.com", "cy")
        _check(client)
        world.history.documents.clear()

        _give(client)

        [entry] = world.history.documents
        assert entry["actor"] == ADMIN and entry["at"]
        assert entry["action"] == Actions.CONNECT_DISCORD.id
        assert entry["kind"] == History.DISCORD_ROLES_GIVEN
        assert entry["vendors"] == ["ana@example.com"]
        assert entry["subject"] == {"application_ids": [ana]}
        assert entry["detail"] == {
            "role_name": "Vendor Nov 2026",
            "given": [ana],
            "before": {ana: "in_server"},
            "after": {ana: "has_role"},
            "addresses": {ana: "ana@example.com"},
            "counts": {"given": 1, "already_had": 1, "not_found": 1, "no_username": 0, "not_yet": 0,
                       "failed": 0},
        }
        assert ben not in entry["detail"]["before"]

    def test_a_role_given_over_a_stale_has_the_role_is_still_named(self, client, world):
        """Someone took the role away in Discord since the last check: the state reads the same
        before and after, but the run gave it."""
        world.market(discord=WITH_THE_ROLE, **WITH_THE_FORM, **_seats("ana@example.com"))
        world.discord.members = [_member("1001", "ana", [ROLE])]
        ana = world.applicant("ana@example.com", "ana")
        _check(client)
        world.history.documents.clear()
        world.discord.members = [_member("1001", "ana")]

        _give(client)

        [entry] = world.history.documents
        assert entry["vendors"] == ["ana@example.com"]
        assert entry["detail"]["given"] == [ana]
        assert entry["detail"]["before"] == {ana: "has_role"}

    def test_a_run_that_changed_nobody_still_says_who_ran_it(self, client, world):
        world.market(discord=WITH_THE_ROLE, **WITH_THE_FORM, **_seats("ana@example.com"))
        world.applicant("ana@example.com", "ana")
        _give(client)
        world.history.documents.clear()

        _give(client)

        [entry] = world.history.documents
        assert entry["actor"] == ADMIN
        assert entry["vendors"] == [] and entry["detail"]["given"] == []
        assert entry["detail"]["counts"]["not_found"] == 1

    def test_the_vendors_own_history_holds_the_role_given(self, client, world):
        world.market(discord=WITH_THE_ROLE, **WITH_THE_FORM, **_seats(
            "ana@example.com", "ben@example.com"))
        world.discord.members = [_member("1001", "ana"), _member("1002", "ben")]
        world.applicant("ana@example.com", "ana")
        world.applicant("ben@example.com", "ben")

        _give(client)

        # What the drawer's History tab reads: the market's history narrowed to the vendor.
        mine, _after = History.entries_page(MARKET, vendor="Ben@example.com")
        [entry] = mine
        assert entry["kind"] == History.DISCORD_ROLES_GIVEN
        assert entry["actor"] == ADMIN and entry["at"]
        everyone, _after = History.entries_page(MARKET)
        assert [each["kind"] for each in everyone] == [History.DISCORD_ROLES_GIVEN]


def _alike(user_id, username, display_name=None, nick=None, roles=()):
    return Discord.Member(user_id, username, tuple(roles), display_name=display_name, nick=nick)


def _vendor_state(world, app_id):
    [state] = [state for state in _stored(world)["vendorStates"]
               if state["applicationId"] == app_id]
    return state


def _decline(client, app_id, username):
    return client.post(f"/markets/{MARKET}/discord/possible-matches/{app_id}/declined",
                       json={"username": username})


class TestPossibleMatches:
    """A vendor "Not found" is offered the members whose name looks like the username on file, as
    "Possible match: confirm?" (E46/F01/S05). An offer only: the organizer confirms it into an
    update of the vendor's answer, never the check (Daniel, T92 Q19)."""

    def test_a_member_whose_display_name_looks_like_the_answer_is_offered(self, client, world):
        world.market(discord=CONNECTED, **WITH_THE_FORM)
        world.discord.members = [_alike("1001", "fern_studio_42", display_name="Fern Studio"),
                                 _alike("1002", "oak", display_name="Oak & Co")]
        fern = world.applicant("fern@example.com", "Fern Studio")

        _check(client)

        state = _vendor_state(world, fern)
        assert state["state"] == "not_found"
        assert state["possibleMatches"] == [
            {"username": "fern_studio_42", "displayName": "Fern Studio"}]

    def test_a_nickname_or_a_username_alike_but_for_case_spaces_and_marks_is_offered(
        self, client, world,
    ):
        world.market(discord=CONNECTED, **WITH_THE_FORM)
        world.discord.members = [
            _alike("1001", "maple.42", nick="MAPLE-crafts \N{MAPLE LEAF}"),
            _alike("1002", "maple_crafts"),
            _alike("1003", "maple", display_name="Maple"),
        ]
        maple = world.applicant("maple@example.com", "@Maple Crafts")

        _check(client)

        assert _vendor_state(world, maple)["possibleMatches"] == [
            {"username": "maple.42", "nick": "MAPLE-crafts \N{MAPLE LEAF}"},
            {"username": "maple_crafts"},
        ]

    def test_a_vendor_matched_or_with_no_username_is_offered_nothing(self, client, world):
        world.market(discord=CONNECTED, **WITH_THE_FORM)
        world.discord.members = [_alike("1001", "maple", display_name="maple"),
                                 _alike("1002", "maple2", display_name="Maple")]
        maple = world.applicant("maple@example.com", "maple")
        blank = world.applicant("blank@example.com", " @ ")

        _check(client)

        assert "possibleMatches" not in _vendor_state(world, maple)
        assert "possibleMatches" not in _vendor_state(world, blank)
        assert _vendor_state(world, blank)["state"] == "no_username"

    def test_a_name_with_no_letter_or_digit_offers_nobody(self, client, world):
        """Emoji and marks alone look like every other name made of them."""
        world.market(discord=CONNECTED, **WITH_THE_FORM)
        world.discord.members = [_alike("1001", "sun.42", display_name="\N{SUN WITH FACE}")]
        sun = world.applicant("sun@example.com", "\N{SUN WITH FACE}!")

        _check(client)

        assert _vendor_state(world, sun) == {
            "applicationId": sun, "state": "not_found", "answer": "\N{SUN WITH FACE}!"}

    def test_at_most_five_are_offered(self, client, world):
        world.market(discord=CONNECTED, **WITH_THE_FORM)
        world.discord.members = [_alike(str(1000 + n), f"fern{n}", display_name="Fern")
                                 for n in range(8)]
        fern = world.applicant("fern@example.com", "fern")

        _check(client)

        assert [m["username"] for m in _vendor_state(world, fern)["possibleMatches"]] == [
            "fern0", "fern1", "fern2", "fern3", "fern4"]

    def test_each_state_keeps_the_answer_it_was_read_for(self, client, world):
        """So a page can tell a username updated since the check from one the check read."""
        world.market(discord=CONNECTED, **WITH_THE_FORM)
        maple = world.applicant("maple@example.com", "maple", updated=" Maple.Crafts ")
        never = world.applicant("never@example.com")

        _check(client)

        assert _vendor_state(world, maple)["answer"] == " Maple.Crafts "
        assert "answer" not in _vendor_state(world, never)

    def test_confirming_stores_an_update_and_the_next_check_reads_in_the_server(
        self, client, world,
    ):
        world.market(discord=CONNECTED, **WITH_THE_FORM)
        world.discord.members = [_alike("1001", "fern_studio_42", display_name="Fern Studio")]
        fern = world.applicant("fern@example.com", "Fern Studio")
        _check(client)
        [offered] = _vendor_state(world, fern)["possibleMatches"]

        # Confirming is the ordinary update of the vendor's answer (E41/F01/S01).
        response = client.put(f"/markets/{MARKET}/applications/{fern}/answers",
                              json={"answers": {"discord_username": offered["username"]}})
        assert response.status_code == 200, response.get_json()
        [application] = world.applications.documents
        assert application["form_data"]["discord_username"] == "Fern Studio"
        assert application["answer_updates"]["discord_username"]["value"] == "fern_studio_42"
        assert application["answer_updates"]["discord_username"]["over"] == "Fern Studio"

        _check(client)

        assert _vendor_state(world, fern) == {
            "applicationId": fern, "state": "in_server", "answer": "fern_studio_42"}

    def test_confirming_is_in_the_markets_history_and_the_vendors_with_who_and_when(
        self, client, world,
    ):
        world.market(discord=CONNECTED, **WITH_THE_FORM)
        world.discord.members = [_alike("1001", "fern_studio_42", display_name="Fern Studio")]
        fern = world.applicant("fern@example.com", "Fern Studio")
        _check(client)

        client.put(f"/markets/{MARKET}/applications/{fern}/answers",
                   json={"answers": {"discord_username": "fern_studio_42"}})

        market_wide, _ = History.entries_page(MARKET)
        mine, _ = History.entries_page(MARKET, vendor="fern@example.com")
        for entries in (market_wide, mine):
            updated = [e for e in entries if e["action"] == Actions.UPDATE_VENDOR_INFO.id]
            [entry] = updated
            assert entry["actor"] == ADMIN and entry["at"]
            assert entry["detail"]["before"] == {"discord_username": "Fern Studio"}
            assert entry["detail"]["after"] == {"discord_username": "fern_studio_42"}

    def test_declining_leaves_the_vendor_not_found_and_records_who_and_when(self, client, world):
        world.market(discord=CONNECTED, **WITH_THE_FORM)
        world.discord.members = [_alike("1001", "fern_studio_42", display_name="Fern Studio")]
        fern = world.applicant("fern@example.com", "Fern Studio")
        _check(client)

        response = _decline(client, fern, "fern_studio_42")

        assert response.status_code == 200, response.get_json()
        assert _vendor_state(world, fern)["state"] == "not_found"
        assert _stored(world)["declinedMatches"] == {fern: ["fern_studio_42"]}
        [application] = world.applications.documents
        assert "answer_updates" not in application
        market_wide, _ = History.entries_page(MARKET)
        mine, _ = History.entries_page(MARKET, vendor="fern@example.com")
        for entries in (market_wide, mine):
            [entry] = [e for e in entries if e["kind"] == History.DISCORD_MATCH_DECLINED]
            assert entry["action"] == Actions.UPDATE_VENDOR_INFO.id
            assert entry["actor"] == ADMIN and entry["at"]
            assert entry["vendors"] == ["fern@example.com"]
            assert entry["subject"] == {"application_id": fern}
            assert entry["detail"] == {"username": "fern_studio_42", "display_name": "Fern Studio",
                                       "nick": None, "answer": "Fern Studio"}

    def test_a_member_declined_is_never_offered_again_for_that_vendor(self, client, world):
        world.market(discord=CONNECTED, **WITH_THE_FORM)
        world.discord.members = [_alike("1001", "fern_studio_42", display_name="Fern Studio"),
                                 _alike("1002", "fernstudio")]
        fern = world.applicant("fern@example.com", "Fern Studio")
        other = world.applicant("other@example.com", "Fern Studio")
        _check(client)
        _decline(client, fern, "fern_studio_42")

        _check(client)

        assert _vendor_state(world, fern)["possibleMatches"] == [{"username": "fernstudio"}]
        assert len(_vendor_state(world, other)["possibleMatches"]) == 2

    def test_a_member_not_offered_to_that_vendor_cannot_be_declined(self, client, world):
        world.market(discord=CONNECTED, **WITH_THE_FORM)
        world.discord.members = [_alike("1001", "fern_studio_42", display_name="Fern Studio")]
        fern = world.applicant("fern@example.com", "Fern Studio")
        oak = world.applicant("oak@example.com", "oak")
        _check(client)

        for app_id, username in ((fern, "someone.else"), (oak, "fern_studio_42"),
                                 ("app-nobody", "fern_studio_42")):
            response = _decline(client, app_id, username)
            assert response.status_code == 400, response.get_json()
            assert response.get_json()["error"] == DiscordConnection.NOT_OFFERED
        assert "declinedMatches" not in _stored(world)
        assert not [e for e in world.history.documents
                    if e["kind"] == History.DISCORD_MATCH_DECLINED]

    def test_a_username_that_is_not_a_string_is_refused(self, client, world):
        world.market(discord=CONNECTED, **WITH_THE_FORM)
        fern = world.applicant("fern@example.com", "Fern Studio")

        response = client.post(f"/markets/{MARKET}/discord/possible-matches/{fern}/declined",
                               json={"username": {"$ne": ""}})

        assert response.status_code == 400

    def test_whoever_may_update_a_vendors_info_answers_an_offer(self, client, world):
        """The offer is answered under the row "Update a vendor's info", as the update it confirms
        into is (Editor by default), not the check's row."""
        world.market(discord=CONNECTED, **WITH_THE_FORM)
        world.discord.members = [_alike("1001", "fern_studio_42", display_name="Fern Studio")]
        fern = world.applicant("fern@example.com", "Fern Studio")
        _check(client)
        world.market(role=MarketRole.EDITOR, discord=copy.deepcopy(_stored(world)),
                     **WITH_THE_FORM)

        assert _decline(client, fern, "fern_studio_42").status_code == 200

    def test_a_viewer_and_an_archived_market_are_refused(self, client, world):
        world.market(discord=CONNECTED, **WITH_THE_FORM)
        world.discord.members = [_alike("1001", "fern_studio_42", display_name="Fern Studio")]
        fern = world.applicant("fern@example.com", "Fern Studio")
        _check(client)
        checked = copy.deepcopy(_stored(world))

        world.market(role=MarketRole.VIEWER, discord=copy.deepcopy(checked), **WITH_THE_FORM)
        viewer = _decline(client, fern, "fern_studio_42")
        world.market(MarketPhase.ARCHIVED, role=MarketRole.OWNER, discord=copy.deepcopy(checked),
                     **WITH_THE_FORM)
        archived = _decline(client, fern, "fern_studio_42")

        assert viewer.status_code == 403
        assert viewer.get_json()["error"] == Actions.refusal_sentence(Actions.UPDATE_VENDOR_INFO)
        assert archived.status_code == 403
        assert archived.get_json()["error"] == MarketsApi.ARCHIVED_REFUSAL
        assert "declinedMatches" not in _stored(world)

    def test_connecting_to_another_server_or_disconnecting_forgets_what_was_declined(
        self, client, world,
    ):
        world.market(discord=CONNECTED, **WITH_THE_FORM)
        world.discord.members = [_alike("1001", "fern_studio_42", display_name="Fern Studio")]
        fern = world.applicant("fern@example.com", "Fern Studio")
        _check(client)
        _decline(client, fern, "fern_studio_42")
        declined = copy.deepcopy(_stored(world))

        world.discord.server = Discord.Server(OTHER_GUILD, "Another server")
        _connect(client)
        assert "declinedMatches" not in _stored(world)

        world.market(discord=declined, **WITH_THE_FORM)
        client.delete(f"/markets/{MARKET}/discord/connection")
        assert _stored(world) == {"usernameQuestion": "discord_username"}

    def test_a_check_keeps_what_was_declined_while_the_members_were_read(self, client, world):
        """A check writes its own fields only: a decline landing meanwhile is not undone."""
        world.market(discord=CONNECTED, **WITH_THE_FORM)
        world.discord.members = [_alike("1001", "fern_studio_42", display_name="Fern Studio")]
        fern = world.applicant("fern@example.com", "Fern Studio")
        _check(client)

        def server_members(_values, _guild, deadline=None):
            assert _decline(client, fern, "fern_studio_42").status_code == 200
            return world.discord.members

        world.patch.setattr(Discord, "server_members", server_members)
        _check(client)

        assert _stored(world)["declinedMatches"] == {fern: ["fern_studio_42"]}

    def test_a_decline_landing_after_another_server_connected_is_refused(self, client, world):
        """The declined members are about the server the offers came from: one connected meanwhile
        never inherits them."""
        world.market(discord=CONNECTED, **WITH_THE_FORM)
        world.discord.members = [_alike("1001", "fern_studio_42", display_name="Fern Studio")]
        fern = world.applicant("fern@example.com", "Fern Studio")
        _check(client)
        read_the_username = DiscordConnection._string

        def another_server_connects_meanwhile(body, key):
            world.markets.doc["discord"] = {**CONNECTED, "guildId": OTHER_GUILD}
            return read_the_username(body, key)

        world.patch.setattr(DiscordConnection, "_string", another_server_connects_meanwhile)
        response = _decline(client, fern, "fern_studio_42")

        assert response.status_code == 409, response.get_json()
        assert response.get_json()["error"] == DiscordConnection.CHANGED_WHILE_DECLINING
        assert "declinedMatches" not in _stored(world)
        assert not [e for e in world.history.documents
                    if e["kind"] == History.DISCORD_MATCH_DECLINED]

    def test_an_answer_a_price_reads_asks_that_row_to_decline_as_to_confirm(self, client, world):
        """Declining asks what confirming asks: where a price group reads the username question,
        the row "Update info the assignment or price reads" too (T156 review note 3). A price group
        reads a choice question only, so this holds only once the question stopped being text."""
        offered = {"applicationId": "app-fern", "state": "not_found", "answer": "Fern",
                   "possibleMatches": [{"username": "fern_studio_42", "displayName": "Fern"}]}
        priced_question = {**DISCORD_QUESTION, "type": "select",
                           "options": ["fern_studio_42", "oak"]}
        plan = copy.deepcopy(GOLD_AND_SILVER)
        plan["pricing"] = {
            "currency": "CAD", "halfTablePercent": 50,
            "groups": [{"name": "Fern's friends",
                        "conditions": [{"key": "discord_username", "answers": ["fern_studio_42"]}],
                        "prices": [{"tier": "Gold", "cents": 1000}]}],
            "everyoneElse": [{"tier": "Gold", "cents": 2000}]}
        priced = {"discord": {**CONNECTED, "vendorStates": [offered]}, "setupObject": plan,
                  "applicationForm": {"fields": [SHOP_QUESTION, priced_question]}}
        world.applicant("fern@example.com", "Fern")

        world.market(MarketPhase.ASSIGNMENT, role=MarketRole.EDITOR, **copy.deepcopy(priced))
        editor = _decline(client, "app-fern", "fern_studio_42")
        world.market(MarketPhase.ASSIGNMENT, role=MarketRole.ADMIN, **copy.deepcopy(priced))
        admin = _decline(client, "app-fern", "fern_studio_42")

        assert editor.status_code == 403
        assert editor.get_json()["error"] == Actions.refusal_sentence(
            Actions.UPDATE_ASSIGNMENT_OR_PRICE_INFO)
        assert admin.status_code == 200, admin.get_json()


def _shown(client):
    """What the market read serves of each vendor's Discord state, by application id."""
    served = client.get(f"/markets/{MARKET}").get_json()["market"]["discordVendors"]
    return {vendor.pop("applicationId"): vendor for vendor in served}


def _kept(*states):
    """A check's states as an earlier check stored them."""
    return {**CONNECTED, "checkedAt": "2026-10-31T12:00:00+00:00", "vendorStates": list(states)}


class TestWhatThePageShows:
    """The market read serves each vendor as the page shows them (E46/F01/S05, T156 review note
    1): the check's state, "Possible match" for a vendor not found with a member still offered, or
    "Check again" for one whose username changed since the check read it. One rule, the back end's,
    which the page and the export both read."""

    def test_a_vendor_not_found_with_a_member_offered_shows_possible_match(self, client, world):
        world.market(_id="mongo-market-123", discord=CONNECTED, **WITH_THE_FORM)
        world.discord.members = [_alike("1001", "fern_studio_42", display_name="Fern Studio"),
                                 _alike("1002", "oak.and.co")]
        fern = world.applicant("fern@example.com", "Fern Studio")
        oak = world.applicant("oak@example.com", "oak.and.co")
        bob = world.applicant("bob@example.com", "bob")
        never = world.applicant("never@example.com")
        _check(client)

        assert _shown(client) == {
            fern: {"state": "not_found", "shown": "possible_match", "moreMatches": 0,
                   "possibleMatches": [{"username": "fern_studio_42", "displayName": "Fern Studio",
                                        "nick": None}]},
            oak: {"state": "in_server", "shown": "in_server", "possibleMatches": [],
                  "moreMatches": 0},
            bob: {"state": "not_found", "shown": "not_found", "possibleMatches": [],
                  "moreMatches": 0},
            never: {"state": "no_username", "shown": "no_username", "possibleMatches": [],
                    "moreMatches": 0},
        }

    def test_a_give_roles_run_keeps_the_offers_and_what_was_declined(self, client, world):
        """A run writes every vendor's state as a check does (E46/F01/S04), so it offers what a
        check would: a vendor it gave the role reads "Has the role", not "Check again", and one
        not found keeps the members offered, the declined left out."""
        world.market(_id="mongo-market-123", discord={**CONNECTED, "roleId": "r-vendor",
                                                      "roleName": "Vendor Test"},
                     **WITH_THE_FORM, **_seats("fern@example.com", "oak@example.com"))
        world.discord.members = [_alike("1001", "fern_studio_42", display_name="Fern Studio"),
                                 _alike("1003", "fern.studio", nick="Fern Studio"),
                                 _alike("1002", "oak.and.co")]
        fern = world.applicant("fern@example.com", "Fern Studio")
        oak = world.applicant("oak@example.com", "oak.and.co")
        _check(client)
        assert _decline(client, fern, "fern.studio").status_code == 200

        assert _give(client).status_code == 200

        assert _shown(client) == {
            fern: {"state": "not_found", "shown": "possible_match", "moreMatches": 0,
                   "possibleMatches": [{"username": "fern_studio_42", "displayName": "Fern Studio",
                                        "nick": None}]},
            oak: {"state": "has_role", "shown": "has_role", "possibleMatches": [],
                  "moreMatches": 0},
        }

    def test_a_member_declined_is_left_out_and_with_none_left_the_vendor_is_not_found(
        self, client, world,
    ):
        world.market(_id="mongo-market-123", discord=CONNECTED, **WITH_THE_FORM)
        world.discord.members = [_alike("1001", "fern_studio_42", display_name="Fern Studio"),
                                 _alike("1002", "fernstudio", nick="Fern Studio")]
        fern = world.applicant("fern@example.com", "Fern Studio")
        _check(client)

        _decline(client, fern, "fern_studio_42")
        assert [m["username"] for m in _shown(client)[fern]["possibleMatches"]] == ["fernstudio"]

        _decline(client, fern, "fernstudio")
        assert _shown(client)[fern] == {"state": "not_found", "shown": "not_found",
                                        "possibleMatches": [], "moreMatches": 0}

    def test_a_username_updated_since_the_check_shows_check_again_with_nothing_offered(
        self, client, world,
    ):
        """T137 ticket 28's note: a corrected username kept its old state until the next check."""
        world.market(_id="mongo-market-123", discord=CONNECTED, **WITH_THE_FORM)
        world.discord.members = [_alike("1001", "fern_studio_42", display_name="Fern Studio")]
        fern = world.applicant("fern@example.com", "Fern Studio")
        _check(client)

        client.put(f"/markets/{MARKET}/applications/{fern}/answers",
                   json={"answers": {"discord_username": "fern_studio_42"}})

        assert _shown(client)[fern] == {"state": "not_found", "shown": "check_again",
                                        "possibleMatches": [], "moreMatches": 0}
        _check(client)
        assert _shown(client)[fern]["shown"] == "in_server"

    def test_a_match_updated_since_the_check_shows_check_again(self, client, world):
        """The projected read keeps an organizer's update in its place: a matched vendor whose
        username changed reads as changed, never as the check's old match."""
        world.market(_id="mongo-market-123", discord=CONNECTED, **WITH_THE_FORM)
        world.discord.members = [_alike("1001", "maple")]
        maple = world.applicant("maple@example.com", "maple")
        _check(client)

        client.put(f"/markets/{MARKET}/applications/{maple}/answers",
                   json={"answers": {"discord_username": "fern_studio_42"}})

        assert _shown(client)[maple] == {"state": "in_server", "shown": "check_again",
                                         "possibleMatches": [], "moreMatches": 0}

    def test_an_update_the_check_reads_alike_keeps_the_state(self, client, world):
        """Case, spaces, a leading @ and an old tag are tidied away before matching, so a change
        of only those reads the same member and the state still holds."""
        world.market(_id="mongo-market-123", discord=CONNECTED, **WITH_THE_FORM)
        world.discord.members = [_alike("1001", "maple")]
        maple = world.applicant("maple@example.com", "maple")
        _check(client)

        client.put(f"/markets/{MARKET}/applications/{maple}/answers",
                   json={"answers": {"discord_username": " @Maple#1234 "}})

        assert _shown(client)[maple]["shown"] == "in_server"

    def test_a_state_an_older_build_kept_reads_as_kept_unless_a_username_was_added(
        self, client, world,
    ):
        """A state kept before the answer was kept beside it cannot tell a change, save "No
        username": that one had nothing, so a username that tidies to something is new (T156
        review note 2: " @ " still has none)."""
        world.market(_id="mongo-market-123", **WITH_THE_FORM, discord=_kept(
            {"applicationId": "app-blank", "state": "no_username"},
            {"applicationId": "app-added", "state": "no_username"},
            {"applicationId": "app-maple", "state": "in_server"}))
        world.applicant("blank@example.com", " @ ")
        world.applicant("added@example.com", "added.later")
        world.applicant("maple@example.com", "someone.else")

        shown = {app_id: vendor["shown"] for app_id, vendor in _shown(client).items()}

        assert shown == {"app-blank": "no_username", "app-added": "check_again",
                         "app-maple": "in_server"}

    def test_past_five_alike_the_rest_are_counted(self, client, world):
        world.market(_id="mongo-market-123", discord=CONNECTED, **WITH_THE_FORM)
        world.discord.members = [_alike(str(1000 + n), f"fern{n}", display_name="Fern")
                                 for n in range(8)]
        fern = world.applicant("fern@example.com", "fern")
        _check(client)

        assert _vendor_state(world, fern)["moreMatches"] == 3
        assert _shown(client)[fern]["moreMatches"] == 3
        assert len(_shown(client)[fern]["possibleMatches"]) == 5

    def test_a_market_never_checked_serves_none(self, client, world):
        world.market(_id="mongo-market-123", discord=CONNECTED, **WITH_THE_FORM)
        world.applicant("fern@example.com", "Fern Studio")

        assert _shown(client) == {}

    def test_the_market_serves_the_vendors_once_as_the_page_shows_them(
        self, client, world,
    ):
        """What the check stored and what was declined are the rule's inputs, never served beside
        it (T156 rereview note 8): ``discordVendors`` is the one copy a page or the export reads,
        on the market's own read and on the Markets list alike."""
        world.market(_id="mongo-market-123", roles={"user-1": "owner", "user-admin": "admin"},
                     **WITH_THE_FORM,
                     discord={**_kept({"applicationId": "app-fern", "state": "not_found",
                                       "answer": "Fern Studio"}),
                              "declinedMatches": {"app-fern": ["fern_studio_42"]}})
        world.patch.setattr(OrgsApi, "get_organizations_for_user", lambda _email: [])
        world.applicant("fern@example.com", "Fern Studio")

        read = client.get(f"/markets/{MARKET}").get_json()["market"]
        [listed] = client.get("/markets").get_json()["markets"]

        for served in (read["discord"], listed["discord"]):
            assert served["checkedAt"] == "2026-10-31T12:00:00+00:00"
            assert "vendorStates" not in served
            assert "declinedMatches" not in served
        assert [vendor["shown"] for vendor in read["discordVendors"]] == ["not_found"]
        assert world.markets.doc["discord"]["declinedMatches"] == {"app-fern": ["fern_studio_42"]}

    def test_the_market_contract_declares_what_the_read_serves(self, client, world):
        """``docs/schema.d.ts``, generated from ``MarketSchemaContract``, is the market as the front
        end receives it (T156 rereview note 9): its connection declares no field the read leaves
        out, and ``discordVendors`` is declared as served. A "Give roles" run first, so its report
        is served too."""
        from datatypes import MarketSchemaContract

        world.market(_id="mongo-market-123", discord={**CONNECTED, "roleId": "r-vendor",
                                                      "roleName": "Vendor Test",
                                                      "inviteLink": "https://discord.gg/abc123"},
                     **WITH_THE_FORM, **_seats("fern@example.com"))
        world.discord.members = [_alike("1001", "fern_studio_42", display_name="Fern Studio")]
        fern = world.applicant("fern@example.com", "Fern Studio")
        assert _give(client).status_code == 200
        _check(client)
        _decline(client, fern, "fern_studio_42")
        world.discord.members.append(_alike("1002", "fernstudio", nick="Fern Studio"))
        _check(client)
        read = client.get(f"/markets/{MARKET}").get_json()["market"]

        def declared(model):
            return {field.alias or name for name, field in model.model_fields.items()}

        market = MarketSchemaContract.model_fields
        connection = market["discord"].annotation.__args__[0]
        assert set(read["discord"]) == declared(connection)
        [vendor] = read["discordVendors"]
        served_vendor = market["discord_vendors"].annotation.__args__[0].__args__[0]
        assert set(vendor) == declared(served_vendor)
        [match] = vendor["possibleMatches"]
        assert set(match) == declared(
            served_vendor.model_fields["possible_matches"].annotation.__args__[0])
