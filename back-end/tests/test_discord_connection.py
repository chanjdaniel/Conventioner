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
from test_discord_client import FakeDiscord  # noqa: E402
from test_every_write_records import LiveMarkets  # noqa: E402

#: The client's own calls, before any test's fake stands in for them.
LIST_MEMBERS = Discord.server_members
GIVE_ROLE = Discord.give_role

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

    def server_members(_values, guild):
        discord.listed.append(guild)
        return discord.members

    monkeypatch.setattr(Discord, "server_members", server_members)

    discord.given = []
    discord.asked = []
    #: A refusal to raise when the role is given to a member, by the member's id.
    discord.refusals = {}

    def give_role(_values, guild, member_id, role_id, _role_name):
        discord.asked.append(member_id)
        if member_id in discord.refusals:
            raise discord.refusals[member_id]
        discord.given.append((guild, member_id, role_id))

    monkeypatch.setattr(Discord, "give_role", give_role)

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
        world.discord.members = [_member("1001", "fern.studio.42")]
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

        served = client.get(f"/markets/{MARKET}").get_json()["market"]["discord"]
        assert served["checkedAt"] == "2026-10-31T12:00:00+00:00"
        assert served["vendorStates"] == [{"applicationId": maple, "state": "not_found"}]

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
        def server_members(_values, guild):
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
        world.patch.setattr(Discord, "give_role", GIVE_ROLE)
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
            "given": 2, "already_had": 1, "not_found": 1, "no_username": 1, "failed": 0}

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
        world.patch.setattr(Discord, "give_role", GIVE_ROLE)
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

    def test_a_card_changed_meanwhile_keeps_it_and_still_records_the_roles_given(
        self, client, world,
    ):
        """The roles are given in Discord before the market is written, so a card changed while
        the run asked is kept, and what the run did is still in the history."""
        world.market(discord=WITH_THE_ROLE, **WITH_THE_FORM, **_seats("ana@example.com"))
        world.discord.members = [_member("1001", "ana")]
        ana = world.applicant("ana@example.com", "ana")
        changed = {**WITH_THE_ROLE, "roleId": "r-other", "roleName": "Other"}

        def give_role(_values, guild, member_id, role_id, _role_name):
            world.discord.given.append((guild, member_id, role_id))
            world.markets.doc["discord"] = changed

        world.patch.setattr(Discord, "give_role", give_role)

        response = _give(client)

        assert response.status_code == 409, response.get_json()
        assert response.get_json()["error"] == DiscordConnection.CHANGED_WHILE_GIVING
        assert _stored(world) == changed
        [entry] = world.history.documents
        assert entry["detail"]["given"] == [ana]
        assert entry["vendors"] == ["ana@example.com"]


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
            "counts": {"given": 1, "already_had": 1, "not_found": 1, "no_username": 0,
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
