"""Conventioner's one Discord bot, asked over REST (E46/F01/S02).

Discord is never called here: ``requests`` is replaced by a fake that answers each URL as Discord's
documentation says it answers, so these pin what is sent and how each answer is read.
"""
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

import pytest

import discord_client as Discord

GUILD = "2909267986263572999"
BOT = "1565000000000000001"

VALUES = {
    "DISCORD_CLIENT_ID": "1565000000000000001",
    "DISCORD_CLIENT_SECRET": "a-client-secret-of-the-deployments",
    "DISCORD_BOT_TOKEN": "a-bot-token-of-the-deployments",
}


@pytest.fixture
def set_up(monkeypatch):
    for name, value in VALUES.items():
        monkeypatch.setenv(name, value)


def _answer(status, body=None, headers=None):
    return SimpleNamespace(status_code=status, json=lambda: body, ok=200 <= status < 300,
                           headers=headers or {})


class FakeDiscord:
    """Discord's REST API as the docs describe it, keyed by method and path."""

    def __init__(self):
        self.answers = {}
        self.sent = []
        self.waits = []

    def answer(self, method, path, status, body=None):
        self.answers[(method, path)] = _answer(status, body)

    def request(self, method, url, **kwargs):
        self.sent.append(SimpleNamespace(method=method, url=url, **kwargs))
        path = url.split("discord.com/api", 1)[1]
        path = path[len("/v10"):] if path.startswith("/v10") else path
        return self.answers.get((method, path), _answer(404, {"message": "Unknown"}))


@pytest.fixture
def discord(monkeypatch):
    fake = FakeDiscord()
    monkeypatch.setattr(Discord.requests, "request", fake.request)
    monkeypatch.setattr(Discord, "_wait", fake.waits.append)
    return fake


class TestTheValues:
    def test_all_three_values_set_the_bot_up(self, set_up):
        values = Discord.credentials()

        assert values == Discord.Credentials(
            VALUES["DISCORD_CLIENT_ID"], VALUES["DISCORD_CLIENT_SECRET"],
            VALUES["DISCORD_BOT_TOKEN"])

    @pytest.mark.parametrize("missing", sorted(VALUES))
    def test_any_one_missing_is_no_bot_at_all(self, set_up, monkeypatch, missing):
        monkeypatch.delenv(missing)

        assert Discord.credentials() is None

    @pytest.mark.parametrize("placeholder", ["", "   ", "your-bot-token", "xxxxxxxxxxxx"])
    def test_a_blank_or_a_placeholder_is_no_value(self, set_up, monkeypatch, placeholder):
        monkeypatch.setenv("DISCORD_BOT_TOKEN", placeholder)

        assert Discord.credentials() is None

    def test_they_are_read_when_asked_never_at_import(self, set_up, monkeypatch):
        assert Discord.credentials() is not None
        monkeypatch.delenv("DISCORD_CLIENT_SECRET")

        assert Discord.credentials() is None


class TestTheApprovalScreen:
    def test_it_asks_to_add_the_bot_with_manage_roles_and_create_invite(self, set_up):
        url = Discord.authorization_url(
            Discord.credentials(), "market-123.nonce", "https://conventioner.io/discord/connected")

        parsed = urlparse(url)
        query = {key: values[0] for key, values in parse_qs(parsed.query).items()}
        assert f"{parsed.scheme}://{parsed.netloc}{parsed.path}" == "https://discord.com/oauth2/authorize"
        assert query == {
            "client_id": VALUES["DISCORD_CLIENT_ID"],
            "scope": "bot",
            "permissions": str((1 << 28) | (1 << 0)),
            "response_type": "code",
            "redirect_uri": "https://conventioner.io/discord/connected",
            "state": "market-123.nonce",
            "integration_type": "0",
        }


class TestTheServerItWasAddedTo:
    def test_the_server_is_the_one_in_discords_token_answer(self, set_up, discord):
        discord.answer("POST", "/oauth2/token", 200, {
            "token_type": "Bearer", "access_token": "a-user-token", "scope": "bot",
            "guild": {"id": GUILD, "name": "Market Vendors", "owner_id": "53908232999183680"},
        })

        server = Discord.connected_server(
            Discord.credentials(), "a-code", "https://conventioner.io/discord/connected")

        assert server == Discord.Server(GUILD, "Market Vendors")
        [sent] = discord.sent
        assert sent.data == {
            "grant_type": "authorization_code", "code": "a-code",
            "redirect_uri": "https://conventioner.io/discord/connected",
        }
        assert sent.auth == (VALUES["DISCORD_CLIENT_ID"], VALUES["DISCORD_CLIENT_SECRET"])

    def test_a_code_discord_refuses_is_refused_in_words(self, set_up, discord):
        discord.answer("POST", "/oauth2/token", 400, {"error": "invalid_grant"})

        with pytest.raises(Discord.DiscordRefused) as refused:
            Discord.connected_server(Discord.credentials(), "used", "https://x.test/discord/connected")

        assert "Connect Discord again" in str(refused.value)

    def test_settings_discord_refuses_are_said_to_be_the_deployments_and_logged(
        self, set_up, discord, caplog,
    ):
        discord.answer("POST", "/oauth2/token", 401, {"error": "invalid_client"})

        with pytest.raises(Discord.DiscordUnavailable) as refused:
            Discord.connected_server(Discord.credentials(), "c", "https://x.test/discord/connected")

        assert str(refused.value) == Discord.SETTINGS_REFUSED
        assert "401" in caplog.text
        assert VALUES["DISCORD_CLIENT_SECRET"] not in caplog.text

    def test_an_answer_with_no_server_is_refused(self, set_up, discord):
        discord.answer("POST", "/oauth2/token", 200, {"access_token": "t", "scope": "bot"})

        with pytest.raises(Discord.DiscordRefused):
            Discord.connected_server(Discord.credentials(), "c", "https://x.test/discord/connected")

    def test_discord_out_of_reach_is_said_so(self, set_up, monkeypatch):
        def unreachable(*_a, **_k):
            raise Discord.requests.ConnectionError("no route to host")

        monkeypatch.setattr(Discord.requests, "request", unreachable)

        with pytest.raises(Discord.DiscordUnavailable):
            Discord.connected_server(Discord.credentials(), "c", "https://x.test/discord/connected")


def _role(role_id, name, position, managed=False):
    return {"id": role_id, "name": name, "position": position, "managed": managed,
            "permissions": "0"}


class TestTheServersRoles:
    @pytest.fixture
    def server(self, discord):
        discord.answer("GET", "/users/@me", 200, {"id": BOT, "username": "Conventioner", "bot": True})
        discord.answer("GET", f"/guilds/{GUILD}/members/{BOT}", 200, {"roles": ["r-bot"]})
        discord.answer("GET", f"/guilds/{GUILD}/roles", 200, [
            _role(GUILD, "@everyone", 0),
            _role("r-vendor", "Vendor Test", 1),
            _role("r-bot", "Conventioner", 2, managed=True),
            _role("r-mod", "Moderator", 3),
            _role("r-same", "Helper", 2),
        ])
        return discord

    def test_each_role_says_whether_the_bot_can_give_it(self, set_up, server):
        roles = Discord.server_roles(Discord.credentials(), GUILD)

        assert roles == [
            Discord.Role("r-mod", "Moderator", below_bot=False),
            Discord.Role("r-same", "Helper", below_bot=False),
            Discord.Role("r-vendor", "Vendor Test", below_bot=True),
        ]

    def test_everyone_and_an_integrations_own_role_are_never_offered(self, set_up, server):
        ids = {role.id for role in Discord.server_roles(Discord.credentials(), GUILD)}

        assert GUILD not in ids and "r-bot" not in ids

    def test_every_call_is_the_bots_own(self, set_up, server):
        Discord.server_roles(Discord.credentials(), GUILD)

        assert {sent.headers["Authorization"] for sent in server.sent} == {
            f"Bot {VALUES['DISCORD_BOT_TOKEN']}"}
        assert all(sent.url.startswith("https://discord.com/api/v10/") for sent in server.sent)
        assert {sent.headers["User-Agent"] for sent in server.sent} == {Discord.USER_AGENT}

    def test_a_server_the_bot_has_left_says_to_connect_again(self, set_up, discord):
        discord.answer("GET", "/users/@me", 200, {"id": BOT})
        discord.answer("GET", f"/guilds/{GUILD}/members/{BOT}", 403, {"message": "Missing Access"})

        with pytest.raises(Discord.DiscordRefused) as refused:
            Discord.server_roles(Discord.credentials(), GUILD)

        assert "Connect Discord again" in str(refused.value)

    def test_a_bot_token_discord_refuses_is_the_deployments_to_fix(self, set_up, discord, caplog):
        discord.answer("GET", "/users/@me", 401, {"message": "401: Unauthorized"})

        with pytest.raises(Discord.DiscordUnavailable) as refused:
            Discord.server_roles(Discord.credentials(), GUILD)

        assert str(refused.value) == Discord.SETTINGS_REFUSED
        assert "401" in caplog.text
        assert VALUES["DISCORD_BOT_TOKEN"] not in caplog.text

    def test_being_asked_to_slow_down_and_again_is_said_so(self, set_up, discord):
        discord.answer("GET", "/users/@me", 429, {"retry_after": 1.5, "global": False})

        with pytest.raises(Discord.DiscordUnavailable) as refused:
            Discord.server_roles(Discord.credentials(), GUILD)

        assert "try again" in str(refused.value)
        assert discord.waits == [1.5] * Discord.RATE_LIMIT_WAITS

    def test_a_failure_never_quotes_the_token(self, set_up, discord):
        discord.answer("GET", "/users/@me", 500, {"message": VALUES["DISCORD_BOT_TOKEN"]})

        with pytest.raises(Discord.DiscordUnavailable) as refused:
            Discord.server_roles(Discord.credentials(), GUILD)

        assert VALUES["DISCORD_BOT_TOKEN"] not in str(refused.value)


def _member(user_id, username, roles=(), global_name=None, nick=None, bot=False):
    return {"user": {"id": user_id, "username": username, "global_name": global_name,
                     "bot": bot},
            "nick": nick, "roles": list(roles)}


class PagedMembers(FakeDiscord):
    """List Guild Members as Discord pages it: ``limit`` members whose id is above ``after``,
    in id order (https://docs.discord.com/developers/resources/guild#list-guild-members)."""

    def __init__(self, members):
        super().__init__()
        self.members = sorted(members, key=lambda member: int(member["user"]["id"]))
        self.limited = []

    def request(self, method, url, **kwargs):
        if not url.endswith(f"/guilds/{GUILD}/members"):
            return super().request(method, url, **kwargs)
        self.sent.append(SimpleNamespace(method=method, url=url, **kwargs))
        if self.limited:
            return self.limited.pop(0)
        params = kwargs.get("params") or {}
        after = int(params.get("after") or 0)
        limit = int(params["limit"])
        return _answer(200, [m for m in self.members if int(m["user"]["id"]) > after][:limit])


@pytest.fixture
def paged(monkeypatch):
    def server(members):
        fake = PagedMembers(members)
        monkeypatch.setattr(Discord.requests, "request", fake.request)
        monkeypatch.setattr(Discord, "_wait", fake.waits.append)
        return fake
    return server


class TestTheServersMembers:
    def test_every_member_is_read_a_page_of_1000_at_a_time(self, set_up, paged):
        server = paged([_member(str(1000 + n), f"vendor{n}") for n in range(2500)])

        members = Discord.server_members(Discord.credentials(), GUILD)

        assert len(members) == 2500
        assert [sent.params for sent in server.sent] == [
            {"limit": 1000, "after": "0"},
            {"limit": 1000, "after": "1999"},
            {"limit": 1000, "after": "2999"},
        ]

    def test_a_member_is_their_username_and_roles_with_their_names_beside(self, set_up, paged):
        """The display name and the server nickname are kept for offering a possible match
        (E46/F01/S05), never for matching: anyone may set them to anything."""
        paged([_member("1001", "maple.crafts", roles=["r-vendor"], global_name="Maple",
                       nick="Maple Crafts"),
               _member("1002", "oak")])

        maple, oak = Discord.server_members(Discord.credentials(), GUILD)

        assert maple == Discord.Member("1001", "maple.crafts", ("r-vendor",),
                                       display_name="Maple", nick="Maple Crafts")
        assert oak == Discord.Member("1002", "oak", ())
        assert oak.display_name is None and oak.nick is None

    def test_a_429_is_waited_out_and_the_list_finishes(self, set_up, paged):
        server = paged([_member(str(1000 + n), f"vendor{n}") for n in range(1500)])
        server.limited = [_answer(429, {"retry_after": 0.25, "global": False})]

        members = Discord.server_members(Discord.credentials(), GUILD)

        assert len(members) == 1500
        assert server.waits == [0.25]

    def test_a_429_without_a_body_is_waited_out_by_its_header(self, set_up, paged):
        server = paged([_member("1001", "maple.crafts")])
        server.limited = [_answer(429, None, {"Retry-After": "2"})]

        assert len(Discord.server_members(Discord.credentials(), GUILD)) == 1
        assert server.waits == [2.0]

    def test_a_wait_longer_than_a_request_can_hold_is_said_so(self, set_up, paged):
        server = paged([_member("1001", "maple.crafts")])
        server.limited = [_answer(429, {"retry_after": 600, "global": True})]

        with pytest.raises(Discord.DiscordUnavailable) as refused:
            Discord.server_members(Discord.credentials(), GUILD)

        assert str(refused.value) == Discord.SLOW_DOWN
        assert server.waits == []

    def test_a_server_the_bot_cannot_read_says_to_connect_again(self, set_up, discord):
        discord.answer("GET", f"/guilds/{GUILD}/members", 403, {
            "message": "Missing Access", "code": 50001})

        with pytest.raises(Discord.DiscordRefused) as refused:
            Discord.server_members(Discord.credentials(), GUILD)

        assert str(refused.value) == Discord.BOT_NOT_IN_SERVER
