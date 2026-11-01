"""A stand-in for Discord's API, for a local stack and its E2E (T156 review note 6).

The back end's bot client (``discord_client``) sends every request through one function, ``_send``;
with the fake on, that function asks this module instead of Discord, so a check, the card's roles
and connecting run the client's own requests, paging and reading end to end against servers a test
writes to the database. Nothing else in the back end knows the fake is there.

**It is on only when asked for twice**: ``DISCORD_FAKE`` set true, and only under
``ALLOW_INSECURE_LOCAL_DEV`` (``utils.deployment``), as ``DISABLE_CAPTCHA`` and ``DISABLE_EMAIL``
are, so a deployment that inherited the variable from a copied env file still talks to Discord.
Each use is logged as the hatch logs every defense it turns off.

**A fake server is one document** in ``fake_discord_servers``, written in Discord's own shapes so
the client reads it as it reads Discord::

    {"guildId": "...", "name": "Riverside Makers",
     "roles": [{"id": "...", "name": "Vendor", "position": 1, "managed": false}],
     "botRoles": ["<the id of the bot's own role>"],
     "members": [{"user": {"id": "...", "username": "fern_studio_42",
                           "global_name": "Fern Studio"},
                  "nick": null, "roles": []}]}

A server with no document answers 404, as Discord answers a bot that is not in it. Connecting
skips Discord's approval screen: the address the card opens is the market's own return address,
with a code naming the first fake server, which the code exchange answers with that server.
"""
import logging
import os
import re
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlencode, urlparse

from utils.deployment import insecure_local_dev, warn_insecure_local_dev

logger = logging.getLogger(__name__)

FAKE_VAR = "DISCORD_FAKE"
COLLECTION = "fake_discord_servers"
#: The bot's own user id in every fake server.
BOT_ID = "1565000000000000999"
#: The values the client signs its requests with while the fake answers them: never Discord's.
CLIENT_ID = "fake-discord-client"
CLIENT_SECRET = "fake-discord-secret"
BOT_TOKEN = "fake-discord-bot-token"
#: The code a fake approval sends back: the server it names is the one connected.
CODE_PREFIX = "fake-discord-server-"

_TRUTHY = ("true", "1")
_API_PATH = re.compile(r"^/api/v\d+(?P<route>/.*)$")
_TOKEN_PATH = "/api/oauth2/token"


def on() -> bool:
    """Whether Discord's API is answered by this fake: ``DISCORD_FAKE`` under the hatch only."""
    if os.getenv(FAKE_VAR, "").strip().lower() not in _TRUTHY:
        return False
    if not insecure_local_dev():
        return False
    warn_insecure_local_dev(f"Discord ({FAKE_VAR}: a fake answers for it)")
    return True


class Answer:
    """What ``requests`` would hand back, as much of it as the client reads."""

    def __init__(self, status_code: int, body: Any):
        self.status_code = status_code
        self.ok = status_code < 400
        self.headers: Dict[str, str] = {}
        self._body = body

    def json(self) -> Any:
        return self._body


def authorization_url(state: str, redirect_uri: str) -> str:
    """The market's own return address, as Discord would send the person back to it once they
    approved: with a code naming the first fake server, and the state the card asked with."""
    first = _collection().find_one({}, sort=[("_id", 1)])
    code = CODE_PREFIX + (str(first.get("guildId")) if first else "none")
    return redirect_uri + "?" + urlencode({"code": code, "state": state})


def answer(method: str, url: str, params: Optional[Dict[str, Any]] = None,
           data: Optional[Dict[str, Any]] = None, **_ignored: Any) -> Answer:
    """Discord's answer to one request, from the fake servers."""
    path = urlparse(url).path
    if method == "POST" and path == _TOKEN_PATH:
        return _code_exchange(data or {})
    matched = _API_PATH.match(path)
    if method != "GET" or not matched:
        return _unknown()
    route = matched.group("route").rstrip("/")
    if route == "/users/@me":
        return Answer(200, {"id": BOT_ID, "username": "conventioner"})
    guild_id, rest = _guild_route(route)
    if guild_id is None:
        return _unknown()
    server = _collection().find_one({"guildId": guild_id})
    if server is None:
        return _unknown()
    if rest == "/roles":
        return Answer(200, [{"id": guild_id, "name": "@everyone", "position": 0, "managed": False},
                            *server.get("roles", [])])
    if rest == f"/members/{BOT_ID}":
        return Answer(200, {"user": {"id": BOT_ID}, "roles": server.get("botRoles", [])})
    if rest == "/members":
        return Answer(200, _members_page(server.get("members", []), params or {}))
    return _unknown()


def _code_exchange(data: Dict[str, Any]) -> Answer:
    code = str(data.get("code") or "")
    guild_id = code[len(CODE_PREFIX):] if code.startswith(CODE_PREFIX) else ""
    server = _collection().find_one({"guildId": guild_id}) if guild_id else None
    if server is None:
        return Answer(400, {"error": "invalid_grant"})
    return Answer(200, {"guild": {"id": guild_id, "name": server.get("name", "")}})


def _guild_route(route: str) -> Tuple[Optional[str], str]:
    parts = route.split("/", 3)
    if len(parts) < 3 or parts[1] != "guilds":
        return None, ""
    return parts[2], "/" + parts[3] if len(parts) > 3 else ""


def _members_page(members: List[Dict[str, Any]], params: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Discord's List Guild Members: by user id, after the one given, at most ``limit``."""
    after = int(_first(params.get("after")) or 0)
    limit = int(_first(params.get("limit")) or 1)
    ordered = sorted(members, key=lambda member: int(member["user"]["id"]))
    return [member for member in ordered if int(member["user"]["id"]) > after][:limit]


def _first(value: Any) -> Any:
    return value[0] if isinstance(value, list) else value


def _unknown() -> Answer:
    return Answer(404, {"message": "Unknown Guild", "code": 10004})


def _collection():
    from db_config import get_database
    return get_database()[COLLECTION]
