"""The fake that answers for Discord on a local stack (T156 review note 6).

The bot client is asked here exactly as the check, the card and connecting ask it, with ``requests``
refusing every call, so each answer can only have come from the fake's servers.
"""
from urllib.parse import parse_qs, urlparse

import pytest
import requests

import discord_client as Discord
import discord_fake as DiscordFake

GUILD = "2909267986263577001"
VENDOR_ROLE = "2909267986263577002"
BOT_ROLE = "2909267986263577003"
ADMIN_ROLE = "2909267986263577004"


def _member(user_id, username, global_name=None, nick=None, roles=()):
    return {"user": {"id": user_id, "username": username, "global_name": global_name},
            "nick": nick, "roles": list(roles)}


SERVER = {
    "guildId": GUILD,
    "name": "Riverside Makers",
    "roles": [{"id": VENDOR_ROLE, "name": "Vendor", "position": 1, "managed": False},
              {"id": BOT_ROLE, "name": "Conventioner", "position": 2, "managed": True},
              {"id": ADMIN_ROLE, "name": "Admin", "position": 3, "managed": False}],
    "botRoles": [BOT_ROLE],
    "members": [_member("1003", "oak.and.co", roles=[VENDOR_ROLE]),
                _member("1001", "fern_studio_42", global_name="Fern Studio"),
                _member("1002", "maple", nick="Maple Crafts")],
}


class Servers:
    """The fake's collection: the servers a test wrote, oldest first."""

    def __init__(self, *servers):
        self.servers = list(servers)

    def find_one(self, query, sort=None):
        return next((server for server in self.servers
                     if all(server.get(key) == value for key, value in query.items())), None)


@pytest.fixture
def fake(monkeypatch):
    monkeypatch.setenv("ALLOW_INSECURE_LOCAL_DEV", "true")
    monkeypatch.setenv(DiscordFake.FAKE_VAR, "true")
    for name in (Discord.CLIENT_ID_ENV, Discord.CLIENT_SECRET_ENV, Discord.BOT_TOKEN_ENV):
        monkeypatch.delenv(name, raising=False)
    servers = Servers(SERVER)
    monkeypatch.setattr(DiscordFake, "_collection", lambda: servers)

    def never(*_args, **_kwargs):
        raise AssertionError("Discord itself was asked")

    monkeypatch.setattr(requests, "request", never)
    return servers


class TestWhenTheFakeAnswers:
    def test_only_under_the_local_development_hatch(self, monkeypatch):
        monkeypatch.setenv(DiscordFake.FAKE_VAR, "true")
        monkeypatch.delenv("ALLOW_INSECURE_LOCAL_DEV", raising=False)
        assert DiscordFake.on() is False

        monkeypatch.setenv("ALLOW_INSECURE_LOCAL_DEV", "true")
        assert DiscordFake.on() is True

    def test_only_when_asked_for(self, monkeypatch):
        monkeypatch.setenv("ALLOW_INSECURE_LOCAL_DEV", "true")
        monkeypatch.delenv(DiscordFake.FAKE_VAR, raising=False)
        assert DiscordFake.on() is False

    def test_a_deployment_with_the_variable_but_not_the_hatch_has_no_discord(self, monkeypatch):
        monkeypatch.delenv("ALLOW_INSECURE_LOCAL_DEV", raising=False)
        monkeypatch.setenv(DiscordFake.FAKE_VAR, "true")
        for name in (Discord.CLIENT_ID_ENV, Discord.CLIENT_SECRET_ENV, Discord.BOT_TOKEN_ENV):
            monkeypatch.delenv(name, raising=False)

        assert Discord.credentials() is None

    def test_the_client_signs_with_the_fakes_own_values(self, fake):
        assert Discord.credentials() == Discord.Credentials(
            DiscordFake.CLIENT_ID, DiscordFake.CLIENT_SECRET, DiscordFake.BOT_TOKEN)


class TestTheClientReadsTheFakeServers:
    def test_every_member_with_their_names_a_page_at_a_time(self, fake, monkeypatch):
        monkeypatch.setattr(Discord, "MEMBERS_PAGE", 2)

        members = Discord.server_members(Discord.credentials(), GUILD)

        assert members == [
            Discord.Member("1001", "fern_studio_42", (), display_name="Fern Studio"),
            Discord.Member("1002", "maple", (), nick="Maple Crafts"),
            Discord.Member("1003", "oak.and.co", (VENDOR_ROLE,)),
        ]

    def test_the_roles_that_may_be_given_each_saying_whether_the_bot_can(self, fake):
        roles = Discord.server_roles(Discord.credentials(), GUILD)

        assert roles == [Discord.Role(ADMIN_ROLE, "Admin", below_bot=False),
                         Discord.Role(VENDOR_ROLE, "Vendor", below_bot=True)]

    def test_a_server_with_no_fake_is_one_the_bot_is_not_in(self, fake):
        with pytest.raises(Discord.DiscordRefused) as refused:
            Discord.server_members(Discord.credentials(), "2909267986263579999")

        assert str(refused.value) == Discord.BOT_NOT_IN_SERVER

    def test_connecting_comes_straight_back_with_the_first_server(self, fake):
        redirect = "http://127.0.0.1:5173/discord/connected"

        url = Discord.authorization_url(Discord.credentials(), "a-market.a-nonce", redirect)

        assert url.startswith(redirect + "?")
        query = parse_qs(urlparse(url).query)
        assert query["state"] == ["a-market.a-nonce"]
        assert Discord.connected_server(Discord.credentials(), query["code"][0], redirect) == \
            Discord.Server(GUILD, "Riverside Makers")

    def test_a_code_naming_no_server_asks_to_connect_again(self, fake):
        fake.servers = []
        url = Discord.authorization_url(Discord.credentials(), "s", "http://127.0.0.1/back")

        with pytest.raises(Discord.DiscordRefused) as refused:
            Discord.connected_server(Discord.credentials(), parse_qs(urlparse(url).query)["code"][0],
                                     "http://127.0.0.1/back")

        assert str(refused.value) == Discord.CONNECT_AGAIN
