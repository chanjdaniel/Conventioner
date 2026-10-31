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

    def test_a_member_is_their_username_and_roles_never_their_display_name(self, set_up, paged):
        paged([_member("1001", "maple.crafts", roles=["r-vendor"], global_name="Maple",
                       nick="Maple Crafts")])

        [member] = Discord.server_members(Discord.credentials(), GUILD)

        assert member == Discord.Member("1001", "maple.crafts", ("r-vendor",))

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


ROLE = "2909267986263573001"
MEMBER = "1001"
GIVE = f"/guilds/{GUILD}/members/{MEMBER}/roles/{ROLE}"


class FakeClock:
    """The client's clock, which a test moves on as time passes."""

    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


@pytest.fixture
def clock(monkeypatch, discord):
    """A clock the client reads, which each wait moves on, as ``time.sleep`` would."""
    fake = FakeClock()
    monkeypatch.setattr(Discord, "clock", fake)

    def wait(seconds):
        discord.waits.append(seconds)
        fake.now += seconds

    monkeypatch.setattr(Discord, "_wait", wait)
    return fake


REASON = "Conventioner: Give roles, Test Market"


def _grants(deadline=None):
    """One run's grants of the role, as ``give_roles`` makes them: an hour to spare by default."""
    return Discord.RoleGrants(Discord.credentials(), GUILD, ROLE, "Vendor Nov 2026",
                              reason=REASON, deadline=deadline if deadline is not None else
                              Discord.clock() + 3600)


class TestGivingARole:
    """Add Guild Member Role (https://docs.discord.com/developers/resources/guild): a 204 when it is
    given, and each refusal said in words, never Discord's."""

    def test_the_role_is_given_with_a_put_as_the_bot(self, set_up, discord):
        discord.answer("PUT", GIVE, 204)

        _grants().give(MEMBER)

        [sent] = discord.sent
        assert sent.method == "PUT"
        assert sent.url == f"https://discord.com/api/v10{GIVE}"
        assert sent.headers["Authorization"] == f"Bot {VALUES['DISCORD_BOT_TOKEN']}"

    def test_each_grant_names_conventioner_and_the_run_in_the_servers_audit_log(
        self, set_up, discord,
    ):
        """``X-Audit-Log-Reason``, URL-encoded as Discord asks
        (https://docs.discord.com/developers/resources/audit-log), so a server's moderators can
        tell a run's grants from a role given by hand."""
        discord.answer("PUT", GIVE, 204)

        _grants().give(MEMBER)

        [sent] = discord.sent
        assert sent.headers["X-Audit-Log-Reason"] == "Conventioner%3A%20Give%20roles%2C%20Test%20Market"

    def test_an_audit_reason_is_url_encoded_and_kept_within_discords_limit(self):
        reason = Discord.audit_reason("Conventioner: Give roles, Marché " + "é" * 400)

        assert reason.startswith("Conventioner%3A%20Give%20roles%2C%20March%C3%A9%20")
        assert len(reason) <= Discord.AUDIT_REASON_LIMIT
        assert not reason.endswith("%C3")

    def test_a_role_above_the_bots_is_said_by_its_name(self, set_up, discord):
        """Discord's 50013, Missing Permissions: the role sits at or above the bot's own, or the
        bot lacks Manage Roles. Every grant of the run would fail alike."""
        discord.answer("PUT", GIVE, 403, {"message": "Missing Permissions", "code": 50013})

        with pytest.raises(Discord.DiscordRefused) as refused:
            _grants().give(MEMBER)

        assert str(refused.value) == Discord.role_above_bot("Vendor Nov 2026")
        assert "Conventioner's role is below Vendor Nov 2026" in str(refused.value)
        assert "Missing Permissions" not in str(refused.value)

    @pytest.mark.parametrize("code", [10007, 10013])
    def test_a_member_who_left_is_that_members_alone(self, set_up, discord, code):
        """Unknown Member or Unknown User: they left the server after the list was read."""
        discord.answer("PUT", GIVE, 404, {"message": "Unknown Member", "code": code})

        with pytest.raises(Discord.MemberGone) as gone:
            _grants().give(MEMBER)

        assert str(gone.value) == Discord.MEMBER_GONE

    def test_a_role_the_server_no_longer_has_asks_to_choose_again(self, set_up, discord):
        discord.answer("PUT", GIVE, 404, {"message": "Unknown Role", "code": 10011})

        with pytest.raises(Discord.DiscordRefused) as refused:
            _grants().give(MEMBER)

        assert str(refused.value) == Discord.role_gone("Vendor Nov 2026")

    @pytest.mark.parametrize("status, code", [(403, 50001), (404, 10004)])
    def test_a_server_the_bot_cannot_reach_says_to_connect_again(self, set_up, discord, status,
                                                                 code):
        discord.answer("PUT", GIVE, status, {"message": "Missing Access", "code": code})

        with pytest.raises(Discord.DiscordRefused) as refused:
            _grants().give(MEMBER)

        assert str(refused.value) == Discord.BOT_NOT_IN_SERVER

    def test_a_bot_token_discord_refuses_is_the_deployments_to_fix(self, set_up, discord):
        discord.answer("PUT", GIVE, 401, {"message": "401: Unauthorized"})

        with pytest.raises(Discord.DiscordUnavailable) as refused:
            _grants().give(MEMBER)

        assert str(refused.value) == Discord.SETTINGS_REFUSED

    def test_a_429_is_waited_out_and_the_role_given(self, set_up, discord, clock):
        answers = [_answer(429, {"retry_after": 0.5, "global": False}), _answer(204)]
        discord.request = lambda *_a, **_k: answers.pop(0)
        Discord.requests.request = discord.request

        _grants().give(MEMBER)

        assert discord.waits == [0.5]
        assert answers == []


class TestARunsTime:
    """A run's grants stop at its deadline rather than wait past it: the back end is a function
    that its host ends at its time limit, and a run cut off there would record nothing."""

    def test_a_429_whose_wait_would_pass_the_deadline_is_not_waited(self, set_up, discord, clock):
        discord.answer("PUT", GIVE, 429, {"retry_after": 8, "global": False})

        with pytest.raises(Discord.OutOfTime):
            _grants(deadline=clock() + 6).give(MEMBER)

        assert discord.waits == []
        assert len(discord.sent) == 1

    def test_a_429_that_fits_before_the_deadline_is_waited_out(self, set_up, discord, clock):
        answers = [_answer(429, {"retry_after": 2, "global": False}), _answer(204)]
        discord.request = lambda *_a, **_k: answers.pop(0)
        Discord.requests.request = discord.request

        _grants(deadline=clock() + 6).give(MEMBER)

        assert discord.waits == [2]

    def test_a_long_429_still_says_slow_down(self, set_up, discord, clock):
        """A wait longer than any run holds is Discord's limit, said as any call says it."""
        discord.answer("PUT", GIVE, 429, {"retry_after": 600, "global": True})

        with pytest.raises(Discord.DiscordUnavailable) as refused:
            _grants(deadline=clock() + 6).give(MEMBER)

        assert str(refused.value) == Discord.SLOW_DOWN

    def test_a_grant_asked_at_the_deadline_is_never_sent(self, set_up, discord, clock):
        discord.answer("PUT", GIVE, 204)
        grants = _grants(deadline=clock() + 6)
        clock.now += 6

        with pytest.raises(Discord.OutOfTime):
            grants.give(MEMBER)

        assert discord.sent == []

    def test_a_request_waits_no_longer_than_the_time_left(self, set_up, discord, clock):
        discord.answer("PUT", GIVE, 204)
        grants = _grants(deadline=clock() + 6)
        clock.now += 4.5

        grants.give(MEMBER)

        [sent] = discord.sent
        assert sent.timeout == pytest.approx(1.5)

    def test_a_request_the_time_left_cut_short_is_out_of_time(self, set_up, discord, clock):
        """The grant may have landed: a second run finds the role held and asks nothing."""
        def timed_out(*_a, **_k):
            raise Discord.requests.Timeout()

        Discord.requests.request = timed_out
        grants = _grants(deadline=clock() + 6)
        clock.now += 4.5

        with pytest.raises(Discord.OutOfTime):
            grants.give(MEMBER)

    def test_a_request_timing_out_on_its_own_is_discord_out_of_reach(self, set_up, discord, clock):
        def timed_out(*_a, **_k):
            raise Discord.requests.Timeout()

        Discord.requests.request = timed_out

        with pytest.raises(Discord.DiscordUnavailable) as refused:
            _grants().give(MEMBER)

        assert str(refused.value) == Discord.OUT_OF_REACH


class TestPacing:
    """Discord says with each answer how many requests the route has left and when it refills
    (``X-RateLimit-Remaining``, ``X-RateLimit-Reset-After``,
    https://docs.discord.com/developers/topics/rate-limits): the next grant waits for the refill
    rather than meet a 429."""

    def _exhausted(self, reset_after):
        return _answer(204, None, {"X-RateLimit-Remaining": "0",
                                   "X-RateLimit-Reset-After": str(reset_after)})

    def test_the_next_grant_waits_for_the_bucket_to_refill(self, set_up, discord, clock):
        answers = [self._exhausted(1.5), _answer(204)]
        discord.request = lambda *_a, **_k: answers.pop(0)
        Discord.requests.request = discord.request
        grants = _grants()

        grants.give("1001")
        grants.give("1002")

        assert discord.waits == [1.5]
        assert answers == []

    def test_a_bucket_with_room_is_not_waited_for(self, set_up, discord, clock):
        answers = [_answer(204, None, {"X-RateLimit-Remaining": "4",
                                       "X-RateLimit-Reset-After": "1.5"}), _answer(204)]
        discord.request = lambda *_a, **_k: answers.pop(0)
        Discord.requests.request = discord.request
        grants = _grants()

        grants.give("1001")
        grants.give("1002")

        assert discord.waits == []

    def test_time_already_passed_is_not_waited_again(self, set_up, discord, clock):
        answers = [self._exhausted(1.5), _answer(204)]
        discord.request = lambda *_a, **_k: answers.pop(0)
        Discord.requests.request = discord.request
        grants = _grants()

        grants.give("1001")
        clock.now += 1.0
        grants.give("1002")

        assert discord.waits == [pytest.approx(0.5)]

    def test_a_refill_after_the_deadline_is_out_of_time_without_asking(
        self, set_up, discord, clock,
    ):
        answers = [self._exhausted(8)]
        discord.request = lambda *_a, **_k: answers.pop(0)
        Discord.requests.request = discord.request
        grants = _grants(deadline=clock() + 6)

        grants.give("1001")
        with pytest.raises(Discord.OutOfTime):
            grants.give("1002")

        assert discord.waits == []
