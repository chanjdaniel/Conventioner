"""A market connected to a Discord server: the Discord card on Market Setup (E46/F01/S02).

An Admin connects the market through Discord's own approval screen, which adds Conventioner's bot
to a server they manage, then picks the role a later run gives each vendor (Daniel, T92 Q11: "the
role is decided by the organizer"), the form's question that holds each vendor's Discord username
(Q12), and an optional invite link to share.

**Connecting is two requests around Discord's screen.** ``start`` keeps a one-time state in the
person's session, bound to this market, and answers the screen's address; Discord sends the person
back to the app's ``/discord/connected`` page with a code and that state, and the page posts both to
``connect``, which spends the state and asks Discord which server the code added the bot to. A state
this session never started, one for another market or one left too long is refused, so nobody can
connect a market by sending someone a link.

**The card is a manual tool, not part of the plan** (Daniel, Q10, Q19): no phase gates it, and it
stays editable in every phase until the market is archived, unlike the rest of Market Setup. Every
write asks the table's "Connect Discord and give roles" row (Admin by default, Q19: "admins only"),
loads through ``_load_market_to_change`` so an archived market refuses it, and records its change
in the market's history, the fields before and after.
"""
import hmac
import secrets
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from flask import session

import api.market_actions as Actions
import api.markets as MarketsApi
import discord_client as Discord
import history as History
from assignment.utils import convert_keys_to_camel_case
from client_errors import BadRequestError
from datatypes import DiscordConnection, Market
from market_documents import market_doc_filter, market_doc_key
from utils.email import frontend_url
from utils.request_body import string_field

#: The app's page Discord sends the person back to. Registered as a redirect in the Developer Portal
#: for each deployment: ``FRONTEND_URL`` followed by this path.
REDIRECT_PATH = "/discord/connected"
#: Where the started connection is kept in the person's session until the page posts it back.
SESSION_KEY = "discord_connecting"
#: How long the approval screen may take.
STATE_LIFETIME_SECONDS = 15 * 60

NOT_STARTED_HERE = (
    "This Discord connection was not started here, or took too long. "
    "Connect Discord again from Market Setup."
)
NOT_CONNECTED = "This market is not connected to Discord. Connect Discord first."
NOT_A_ROLE = "That role is not one Conventioner can give in this server. Choose another."
NOT_A_TEXT_QUESTION = "The username question must be one of the form's text questions."
INVITE_LINK_LIMIT = 200
NOT_AN_INVITE_LINK = "An invite link is a web address starting https://, like https://discord.gg/abc123."

#: What a server's connection is, and what is forgotten when the market connects to another one.
SERVER_FIELDS = ("guild_id", "guild_name")
SERVER_CHOICES = ("role_id", "role_name", "invite_link")
#: What the history records of a connection: the card's fields, never who connected it or when,
#: which the entry's actor and time already say.
RECORDED_FIELDS = (*SERVER_FIELDS, *SERVER_CHOICES, "username_question")


def redirect_uri() -> str:
    return frontend_url().rstrip("/") + REDIRECT_PATH


def _now() -> float:
    return time.time()


def start(market_id: str, requesting_user: str) -> Dict[str, str]:
    """Begin connecting: keep a one-time state for this market and answer Discord's screen.

    The state leads with the market's id, so the page Discord sends the person back to knows which
    market to post to and to return to; the random part is what is checked.
    """
    values = Discord.required_credentials()
    MarketsApi._load_market_to_change(market_id, requesting_user, Actions.CONNECT_DISCORD)
    state = f"{market_id}.{secrets.token_urlsafe(24)}"
    session[SESSION_KEY] = {"state": state, "market_id": market_id, "at": _now()}
    return {"url": Discord.authorization_url(values, state, redirect_uri())}


def connect(market_id: str, code: Optional[str], state: Optional[str], requesting_user: str) -> None:
    """Finish connecting: spend the state, and keep the server Discord says the bot was added to.

    Connecting again to the same server keeps the card's choices; to another server forgets that
    server's role and invite link. A username question is chosen when none is yet: the form's
    first text question whose label names Discord, as a market started from a Google Form with a
    "Discord Username" question has (Q12).
    """
    values = Discord.required_credentials()
    market = MarketsApi._load_market_to_change(market_id, requesting_user, Actions.CONNECT_DISCORD)
    started = session.pop(SESSION_KEY, None)
    if not _state_is_this_sessions(started, market_id, state) or not code:
        raise BadRequestError(NOT_STARTED_HERE)

    server = Discord.connected_server(values, code, redirect_uri())
    before = market.discord or DiscordConnection()
    after = before.model_copy(update={
        "guild_id": server.id, "guild_name": server.name,
        "connected_by": requesting_user,
        "connected_at": datetime.now(timezone.utc).isoformat(),
        **({} if before.guild_id == server.id else {field: None for field in SERVER_CHOICES}),
        "username_question": (
            before.username_question if before.username_question in _text_questions(market)
            else _discord_question(market)
        ),
    })
    _write(market, before, after, History.DISCORD_CONNECTED, requesting_user)


def roles(market_id: str, requesting_user: str) -> List[Dict[str, Any]]:
    """The connected server's roles for the card's choice, highest first."""
    market = MarketsApi._load_market_for(market_id, requesting_user, Actions.CONNECT_DISCORD)
    connection = _connection(market)
    return [
        {"id": role.id, "name": role.name, "belowBot": role.below_bot}
        for role in Discord.server_roles(Discord.required_credentials(), connection.guild_id)
    ]


def save(market_id: str, body: Dict[str, Any], requesting_user: str) -> None:
    """Change the card's choices: any of ``roleId``, ``usernameQuestion`` and ``inviteLink``.

    A role is one the server has and the bot may be given to hold: never ``@everyone`` or an
    integration's own. One above the bot's own may be chosen; the card says to move the bot's role
    above it, since until then giving it fails.
    """
    market = MarketsApi._load_market_to_change(market_id, requesting_user, Actions.CONNECT_DISCORD)
    before = _connection(market)
    update: Dict[str, Any] = {}

    if "roleId" in body:
        role_id = _string(body, "roleId")
        if role_id:
            offered = {role.id: role for role in Discord.server_roles(
                Discord.required_credentials(), before.guild_id)}
            if role_id not in offered:
                raise BadRequestError(NOT_A_ROLE)
            update.update(role_id=role_id, role_name=offered[role_id].name)
        else:
            update.update(role_id=None, role_name=None)

    if "usernameQuestion" in body:
        key = _string(body, "usernameQuestion")
        if key and key not in _text_questions(market):
            raise BadRequestError(NOT_A_TEXT_QUESTION)
        update["username_question"] = key or None

    if "inviteLink" in body:
        link = _string(body, "inviteLink").strip()
        if link and not _is_invite_link(link):
            raise BadRequestError(NOT_AN_INVITE_LINK)
        update["invite_link"] = link or None

    _write(market, before, before.model_copy(update=update), History.DISCORD_SETTINGS,
           requesting_user)


def disconnect(market_id: str, requesting_user: str) -> None:
    """Forget the server, its role and its invite link; keep the username question, which is about
    the market's form. The bot stays in the server until someone removes it there: another market
    may still use it."""
    market = MarketsApi._load_market_to_change(market_id, requesting_user, Actions.CONNECT_DISCORD)
    before = market.discord
    if before is None or not before.guild_id:
        return
    after = DiscordConnection(username_question=before.username_question)
    _write(market, before, after, History.DISCORD_DISCONNECTED, requesting_user)


def _state_is_this_sessions(started: Any, market_id: str, state: Optional[str]) -> bool:
    if not isinstance(started, dict) or not state:
        return False
    return (
        hmac.compare_digest(str(started.get("state", "")), state)
        and started.get("market_id") == market_id
        and _now() - float(started.get("at") or 0) <= STATE_LIFETIME_SECONDS
    )


def _connection(market: Market) -> DiscordConnection:
    if market.discord is None or not market.discord.guild_id:
        raise BadRequestError(NOT_CONNECTED)
    return market.discord


def _string(body: Dict[str, Any], key: str) -> str:
    """A choice's value: a string, or null for none. Anything else is refused, never queried."""
    if body.get(key) is None:
        return ""
    value = string_field(body, key)
    if value is None:
        raise BadRequestError(f"{key} must be a string.")
    return value


def _text_questions(market: Market) -> List[str]:
    form = market.application_form
    return [field.key for field in (form.fields if form else []) if field.type == "text"]


def _discord_question(market: Market) -> Optional[str]:
    form = market.application_form
    for field in form.fields if form else []:
        if field.type == "text" and "discord" in field.label.lower():
            return field.key
    return None


def _is_invite_link(link: str) -> bool:
    return (
        link.startswith("https://") and len(link) <= INVITE_LINK_LIMIT
        and not any(character.isspace() for character in link)
    )


def _write(
    market: Market, before: DiscordConnection, after: DiscordConnection, kind: str,
    requesting_user: str,
) -> None:
    stored = after.model_dump(exclude_none=True)
    if stored:
        update = {"$set": {market_doc_key("discord"): convert_keys_to_camel_case(stored)}}
    else:
        update = {"$unset": {market_doc_key("discord"): ""}}
    MarketsApi.markets_collection.update_one(market_doc_filter("id", market.id), update)
    History.record(market.id, requesting_user, Actions.CONNECT_DISCORD, kind=kind,
                   detail=lambda: History.changes(
                       {field: getattr(before, field) for field in RECORDED_FIELDS},
                       {field: getattr(after, field) for field in RECORDED_FIELDS}))
