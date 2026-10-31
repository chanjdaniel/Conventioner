"""Conventioner's one Discord bot, asked over Discord's REST API (E46).

One Discord application, Conventioner's, is added to each organizer's server through Discord's own
approval screen (Daniel, T92 Q11: "one bot"), and acts there with the permissions that screen
granted. Everything it does is a plain HTTPS request: no gateway connection is ever opened, since
the serverless back end could not hold one, and the endpoints it needs do not need one
(docs/implementation/modules/discord.md, "REST only", cites each).

The three values are the deployment's and optional: read through ``configured_secret`` when asked
for, never at import, so a blank or a published placeholder is no value, and any one missing means
Discord is not set up on this Conventioner. That is a feature turned off, never a boot error: the
values defend nothing the product serves without them.

A failure is answered in copy written here, never in Discord's own words, and never with a value
sent: Discord's message is not the organizer's to read, and a token must not reach a log or a page.
"""
import logging
import os
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlencode

import requests

from client_errors import ClientError
from utils.configured_secret import configured_secret

logger = logging.getLogger(__name__)

CLIENT_ID_ENV = "DISCORD_CLIENT_ID"
CLIENT_SECRET_ENV = "DISCORD_CLIENT_SECRET"
BOT_TOKEN_ENV = "DISCORD_BOT_TOKEN"

API = "https://discord.com/api/v10"
AUTHORIZE_URL = "https://discord.com/oauth2/authorize"
TOKEN_URL = "https://discord.com/api/oauth2/token"

# The permissions the approval screen asks for (https://docs.discord.com/developers/topics/permissions):
# Manage Roles to give the market's role, and Create Instant Invite (E46/F01/S02), so the bot may
# make invites to the server.
MANAGE_ROLES = 1 << 28
CREATE_INSTANT_INVITE = 1 << 0
BOT_PERMISSIONS = MANAGE_ROLES | CREATE_INSTANT_INVITE
# Installed to a server, not to a person's account.
GUILD_INSTALL = 0

TIMEOUT_SECONDS = 10
# A 429 says how long to wait before asking again (``retry_after``, in seconds,
# https://docs.discord.com/developers/topics/rate-limits). A request waits out a few such waits of
# a few seconds each; a longer one, or more of them, is answered as asking to slow down, so one
# request never holds the back end for long, and a run never keeps asking a limit that holds:
# 10,000 refused requests in 10 minutes block the address.
RATE_LIMIT_WAITS = 3
LONGEST_RATE_LIMIT_WAIT_SECONDS = 10
# List Guild Members answers at most 1000 a page (https://docs.discord.com/developers/resources/guild).
MEMBERS_PAGE = 1000
# Discord asks every HTTP client to name itself in this shape (https://docs.discord.com/developers/reference).
USER_AGENT = "DiscordBot (https://conventioner.io, 1.0)"

NOT_SET_UP = "Discord is not set up on this Conventioner."
CONNECT_AGAIN = (
    "Discord did not accept this connection. Connect Discord again from the market's Tools tab."
)
BOT_NOT_IN_SERVER = (
    "Conventioner's bot can no longer reach this server: it may have been removed. "
    "Connect Discord again to add it back."
)
SLOW_DOWN = "Discord asked Conventioner to slow down. Wait a moment, then try again."
# A 401 is the deployment's own values, wrong or revoked: nothing the organizer retries will fix it.
SETTINGS_REFUSED = (
    "Discord refused this Conventioner's Discord settings. Whoever runs this Conventioner needs to "
    "check them."
)
OUT_OF_REACH = "Conventioner could not reach Discord just now. Try again in a moment."


class DiscordNotSetUp(ClientError):
    """This deployment has no Discord values: the feature is off. A 503."""

    status = 503


class DiscordRefused(ClientError):
    """Discord refused what was asked, for a reason the organizer can act on. A 400."""

    status = 400


class DiscordUnavailable(ClientError):
    """Discord could not be reached or failed. A 502, as a gateway's failure is."""

    status = 502


@dataclass(frozen=True)
class Credentials:
    client_id: str
    client_secret: str
    bot_token: str


@dataclass(frozen=True)
class Server:
    """A Discord server ("guild" in Discord's API) the bot was added to."""

    id: str
    name: str


@dataclass(frozen=True)
class Role:
    """A role of a server that may be given: never ``@everyone``, never an integration's own.

    ``below_bot`` is whether it sits below the bot's highest role, the only roles a bot may give
    ("A bot can grant roles to other users that are of a lower position than its own highest role",
    https://docs.discord.com/developers/topics/permissions).
    """

    id: str
    name: str
    below_bot: bool


@dataclass(frozen=True)
class Member:
    """A member of a server: their user id, their username (never a display name or a server
    nickname, which anyone may set to anything), and the ids of their roles."""

    id: str
    username: str
    roles: Tuple[str, ...]


def credentials() -> Optional[Credentials]:
    """The deployment's three Discord values, or None when any one is missing. Read when asked."""
    values = [configured_secret(os.getenv(name, ""))
              for name in (CLIENT_ID_ENV, CLIENT_SECRET_ENV, BOT_TOKEN_ENV)]
    if not all(values):
        return None
    return Credentials(*values)


def required_credentials() -> Credentials:
    """The deployment's Discord values, or ``DiscordNotSetUp``."""
    values = credentials()
    if values is None:
        raise DiscordNotSetUp(NOT_SET_UP)
    return values


def authorization_url(values: Credentials, state: str, redirect_uri: str) -> str:
    """Discord's approval screen, adding the bot to a server the person chooses there.

    Through the code grant (``response_type=code``), so Discord sends the person back with a code
    whose exchange names the server the bot was added to (``connected_server``).
    """
    return AUTHORIZE_URL + "?" + urlencode({
        "client_id": values.client_id,
        "scope": "bot",
        "permissions": str(BOT_PERMISSIONS),
        "response_type": "code",
        "redirect_uri": redirect_uri,
        "state": state,
        "integration_type": str(GUILD_INSTALL),
    })


def connected_server(values: Credentials, code: str, redirect_uri: str) -> Server:
    """The server the bot was added to, from Discord's answer to the code's exchange.

    The ``guild_id`` Discord also puts on the redirect is "only a hint" (OAuth2, Advanced Bot
    Authorization) and anyone can type one, so it is never read: the token answer's ``guild`` is.
    The user's access token in the same answer is neither kept nor used.
    """
    answer = _send(
        "POST", TOKEN_URL, auth=(values.client_id, values.client_secret),
        data={"grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri},
    )
    if answer.status_code == 401:
        _refused_settings("the code exchange")
    if answer.status_code == 400:
        raise DiscordRefused(CONNECT_AGAIN)
    body = _body(answer)
    guild = body.get("guild") if isinstance(body, dict) else None
    if not isinstance(guild, dict) or not guild.get("id"):
        raise DiscordRefused(CONNECT_AGAIN)
    return Server(str(guild["id"]), str(guild.get("name") or ""))


def server_roles(values: Credentials, guild_id: str) -> List[Role]:
    """The roles of the server that may be given, highest first, each saying whether the bot can.

    A role at the bot's own highest position or above is listed, since the organizer may move the
    bot's role up in their server's settings; the bot cannot give it until they do.
    """
    me = _bot(values, "GET", "/users/@me")
    member = _bot(values, "GET", f"/guilds/{guild_id}/members/{me['id']}")
    roles = _bot(values, "GET", f"/guilds/{guild_id}/roles")
    position = {str(role["id"]): int(role.get("position") or 0) for role in roles}
    bot_top = max((position.get(str(role_id), 0) for role_id in member.get("roles") or []),
                  default=0)
    offered = [
        role for role in roles
        if str(role["id"]) != str(guild_id) and not role.get("managed")
    ]
    offered.sort(key=lambda role: -position[str(role["id"])])
    return [
        Role(str(role["id"]), str(role.get("name") or ""), position[str(role["id"])] < bot_top)
        for role in offered
    ]


def server_members(values: Credentials, guild_id: str) -> List[Member]:
    """Every member of the server, a page of 1000 at a time, each page after the last member read.

    Needs the ``GUILD_MEMBERS`` privileged intent, switched on for the application in the Developer
    Portal; without it Discord refuses the list as it refuses a server the bot has left.
    """
    members: List[Member] = []
    after = "0"
    while True:
        page = _bot(values, "GET", f"/guilds/{guild_id}/members",
                    params={"limit": MEMBERS_PAGE, "after": after})
        page = page if isinstance(page, list) else []
        for member in page:
            user = member.get("user") or {}
            if user.get("id"):
                members.append(Member(str(user["id"]), str(user.get("username") or ""),
                                      tuple(str(role) for role in member.get("roles") or [])))
        if len(page) < MEMBERS_PAGE or not members:
            return members
        after = members[-1].id


def _bot(values: Credentials, method: str, path: str, **kwargs: Any) -> Any:
    """One call as the bot, its answer's body, or the refusal it amounts to."""
    answer = _send(method, API + path, headers={"Authorization": f"Bot {values.bot_token}"},
                   **kwargs)
    if answer.status_code == 401:
        _refused_settings("the bot's token")
    if answer.status_code in (403, 404):
        raise DiscordRefused(BOT_NOT_IN_SERVER)
    if not answer.ok:
        logger.warning("Discord answered %s to %s %s", answer.status_code, method,
                       path.split("/")[1])
        raise DiscordUnavailable(OUT_OF_REACH)
    return _body(answer)


def _refused_settings(what: str) -> None:
    """A 401: the deployment's client secret or bot token is not one Discord takes. Logged by its
    status alone, so an operator can find it; the value is never named."""
    logger.warning("Discord answered 401 to %s: check the deployment's Discord values", what)
    raise DiscordUnavailable(SETTINGS_REFUSED)


def _send(method: str, url: str, headers: Optional[Dict[str, str]] = None, **kwargs: Any) -> Any:
    """One request, asked again after each 429's wait while the waits are short and few."""
    for waited in range(RATE_LIMIT_WAITS + 1):
        try:
            answer = requests.request(
                method, url, timeout=TIMEOUT_SECONDS,
                headers={"User-Agent": USER_AGENT, **(headers or {})}, **kwargs)
        except requests.RequestException as e:
            logger.warning("Could not reach Discord: %s", type(e).__name__)
            raise DiscordUnavailable(OUT_OF_REACH) from e
        if answer.status_code != 429:
            break
        wait = _retry_after(answer)
        if waited == RATE_LIMIT_WAITS or wait is None or wait > LONGEST_RATE_LIMIT_WAIT_SECONDS:
            logger.warning("Discord answered 429 and asked to wait %s seconds", wait)
            raise DiscordUnavailable(SLOW_DOWN)
        _wait(wait)
    if answer.status_code >= 500:
        logger.warning("Discord answered %s", answer.status_code)
        raise DiscordUnavailable(OUT_OF_REACH)
    return answer


def _retry_after(answer: Any) -> Optional[float]:
    """How long a 429 asks to wait, in seconds: its body's ``retry_after``, else its
    ``Retry-After`` header; None when it says neither."""
    body = _body(answer)
    said = body.get("retry_after") if isinstance(body, dict) else None
    if said is None:
        said = (getattr(answer, "headers", None) or {}).get("Retry-After")
    try:
        return max(float(said), 0.0) if said is not None else None
    except (TypeError, ValueError):
        return None


def _wait(seconds: float) -> None:
    time.sleep(seconds)


def _body(answer: Any) -> Any:
    try:
        return answer.json()
    except ValueError:
        return None
