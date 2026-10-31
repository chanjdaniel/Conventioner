"""A market connected to a Discord server: the Discord card on the market's Tools tab (E46/F01/S02).

An Admin connects the market through Discord's own approval screen, which adds Conventioner's bot
to a server they manage, then picks the role a later run gives each vendor (Daniel, T92 Q11: "the
role is decided by the organizer"), the form's question that holds each vendor's Discord username
(Q12), and an optional invite link to share.

**Connecting is two requests around Discord's screen.** ``start`` keeps a one-time state in the
person's session, bound to this market, and answers the screen's address; Discord sends the person
back to the app's ``/discord/connected`` page with a code and that state, and the page posts both to
``connect``, which spends the state and asks Discord which server the code added the bot to. A state
this session never started, one another person started, one for another market or one left too
long is refused, so nobody can connect a market by sending someone a link.

**The card is a manual tool, not part of the plan** (Daniel, Q10, Q19): no phase gates it, and it
stays editable in every phase until the market is archived, unlike Market Setup's plan. Every
write asks the table's "Connect Discord and give roles" row (Admin by default, Q19: "admins only"),
loads through ``_load_market_to_change`` so an archived market refuses it, and records its change
in the market's history, the fields before and after.

**"Check Discord" reads who is in the server** (E46/F01/S03), from the Vendors page, under the same
row: it lists the server's members and matches each vendor's username, as the organizer reads it,
against their usernames alone, never a display name (Daniel, Q19), then keeps each vendor's state
with when it was checked. A check is one entry in the history, naming each vendor whose state it
changed.

**"Give roles" gives the card's role to every assigned vendor in the server** (E46/F01/S04), under
the same row: it reads the members as a check does, asks Discord to give the role to each assigned
vendor matched who does not hold it, never takes a role away, and keeps the run's report beside the
states it updates. A run is one entry in the history, naming each vendor it gave the role or whose
state it changed.
"""
import hmac
import re
import secrets
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from flask import session

import api.applications as ApplicationsApi
import api.market_actions as Actions
import api.markets as MarketsApi
import discord_client as Discord
import history as History
import result_outcome as ResultOutcome
from assignment.utils import convert_keys_to_camel_case
from client_errors import BadRequestError, ConflictError
from datatypes import (
    ApplicationType, DiscordConnection, DiscordRoleOutcome, DiscordRoleRun, DiscordVendorState,
    Market,
)
from market_documents import market_doc_filter, market_doc_key
from utils.email import frontend_url
from utils.email_address import normalized_email
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
    "Connect Discord again from the market's Tools tab."
)
NOT_CONNECTED = "This market is not connected to Discord. Connect Discord first."
NOT_A_ROLE = "That role is not one Conventioner can give in this server. Choose another."
NOT_A_TEXT_QUESTION = "The username question must be one of the form's text questions."
INVITE_LINK_LIMIT = 200
NOT_AN_INVITE_LINK = "An invite link is a web address starting https://, like https://discord.gg/abc123."

NO_USERNAME_QUESTION = (
    "Choose the username question on the Discord card first, on the market's Tools tab."
)
USERNAME_QUESTION_GONE = (
    "The username question is no longer on the application form. "
    "Choose the username question again on the Discord card, on the market's Tools tab."
)

#: What a server's connection is, and what is forgotten when the market connects to another one:
#: the card's choices for that server, and what its check and its last run found there.
SERVER_FIELDS = ("guild_id", "guild_name")
SERVER_CHOICES = ("role_id", "role_name", "invite_link", "checked_at", "vendor_states",
                  "role_run")
#: What the history records of a change to the card: its fields, never who connected it or when,
#: which the entry's actor and time already say, and never a check, which records its own entry.
RECORDED_FIELDS = ("guild_id", "guild_name", "role_id", "role_name", "invite_link",
                   "username_question")

#: What a check's states are read against: a card that changes any of them while the members are
#: read refuses the check's write rather than be undone by it, or carry states read for another.
CHECKED_AGAINST = ("guild_id", "role_id", "username_question")
CHANGED_WHILE_CHECKING = (
    "The Discord card changed while Discord was being checked. Check Discord again."
)

CHANGED_WHILE_GIVING = (
    "The Discord card changed while roles were being given. The roles given are in the market's "
    "history; check Discord again."
)
NO_ROLE = "Choose the role to give on the Discord card first, on the market's Tools tab."

#: Each vendor as a check finds them, in the order the Vendors page counts them.
HAS_ROLE = "has_role"
IN_SERVER = "in_server"
NOT_FOUND = "not_found"
NO_USERNAME = "no_username"
STATES = (HAS_ROLE, IN_SERVER, NOT_FOUND, NO_USERNAME)

#: Each assigned vendor as a "Give roles" run leaves them, in the order its report counts them.
GIVEN = "given"
ALREADY_HAD = "already_had"
FAILED = "failed"
OUTCOMES = (GIVEN, ALREADY_HAD, NOT_FOUND, NO_USERNAME, FAILED)

#: An old Discord tag, "name#1234", from before usernames were unique: its number is not part of
#: the username a member now has.
_OLD_TAG = re.compile(r"#\d{4}$")


def redirect_uri() -> str:
    return frontend_url().rstrip("/") + REDIRECT_PATH


def _now() -> float:
    return time.time()


def start(market_id: str, requesting_user: str) -> Dict[str, str]:
    """Begin connecting: keep a one-time state for this market and answer Discord's screen.

    The state leads with the market's id, so the page Discord sends the person back to knows which
    market to post to and to return to; the random part is what is checked.
    """
    MarketsApi._load_market_to_change(market_id, requesting_user, Actions.CONNECT_DISCORD)
    values = Discord.required_credentials()
    state = f"{market_id}.{secrets.token_urlsafe(24)}"
    session[SESSION_KEY] = {
        "state": state, "market_id": market_id, "by": requesting_user, "at": _now()}
    return {"url": Discord.authorization_url(values, state, redirect_uri())}


def connect(market_id: str, code: Optional[str], state: Optional[str], requesting_user: str) -> None:
    """Finish connecting: spend the state, and keep the server Discord says the bot was added to.

    Connecting again to the same server keeps the card's choices; to another server forgets that
    server's role and invite link. A username question is chosen when none is yet: the form's
    first text question whose label names Discord, as a market started from a Google Form with a
    "Discord Username" question has (Q12).
    """
    market = MarketsApi._load_market_to_change(market_id, requesting_user, Actions.CONNECT_DISCORD)
    values = Discord.required_credentials()
    started = session.pop(SESSION_KEY, None)
    if not _state_is_this_sessions(started, market_id, requesting_user, state) or not code:
        raise BadRequestError(NOT_STARTED_HERE)

    server = Discord.connected_server(values, code, redirect_uri())
    before = market.discord or DiscordConnection()
    after = before.model_copy(update={
        "guild_id": server.id, "guild_name": server.name,
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


def check(market_id: str, requesting_user: str) -> Dict[str, Any]:
    """Read who is in the server, keep each vendor's state with when it was checked, and answer
    how many are in each.

    Every main application of the market is a vendor checked, by its username as the organizer
    reads it (an update in its place, ``effective_answers``). The username question is checked
    again here, since it is checked only when the card saves it and the form may have lost it
    since.
    """
    market = MarketsApi._load_market_to_change(market_id, requesting_user, Actions.CONNECT_DISCORD)
    before = _connection(market)
    question = _username_question(market, before)

    members = _members_by_username(before)
    vendors = _vendors_usernames(market_id, question)
    states = _states(vendors, members, before.role_id)
    after = before.model_copy(update={"checked_at": _checked_at(), "vendor_states": states})
    if not _write_found(market, before, after, ("checked_at", "vendor_states")):
        raise ConflictError(CHANGED_WHILE_CHECKING)

    counts = _counts(STATES, (vendor.state for vendor in states))
    changed = _changed_states(before, states, vendors)
    History.record(
        market.id, requesting_user, Actions.CONNECT_DISCORD, kind=History.DISCORD_CHECKED,
        vendors=[email for _, email in changed],
        subject={"application_ids": [app_id for app_id, _ in changed]},
        # Each vendor's address beside their state, by application id: ``vendors`` leaves out an
        # application with no address, so it does not pair with the ids by position.
        detail=_state_detail(before, states, changed, counts))
    return {"counts": counts, "checkedAt": after.checked_at}


def give_roles(market_id: str, requesting_user: str) -> Dict[str, Any]:
    """Give the card's role to every assigned vendor in the server, keep the run's report and each
    vendor's state as the run found them, and answer how many ended in each outcome.

    Assigned is holding a seat on any date of the stored assignment (``seated_addresses``). A run
    only ever gives: a vendor who lost their seat keeps the role they have (Daniel, T92 Q19). It
    reads the server's members once, as a check does, so it updates every vendor's state, and asks
    Discord to give the role only to an assigned vendor whose username a member has and who does
    not hold it yet. A refusal of one member (they left meanwhile) is theirs alone; any other
    refusal would refuse every grant alike, so the run stops asking and the rest fail with it.
    """
    market = MarketsApi._load_market_to_change(market_id, requesting_user, Actions.CONNECT_DISCORD)
    before = _connection(market)
    if not before.role_id:
        raise BadRequestError(NO_ROLE)
    question = _username_question(market, before)
    values = Discord.required_credentials()

    members = _members_by_username(before)
    vendors = _vendors_usernames(market_id, question)
    states = {vendor.application_id: vendor
              for vendor in _states(vendors, members, before.role_id)}
    seated = ResultOutcome.seated_addresses(market)
    role_name = before.role_name or ""
    outcomes: List[DiscordRoleOutcome] = []
    given: List[str] = []
    stopped: Optional[str] = None
    for app_id, email, username in vendors:
        if normalized_email(email) not in seated:
            continue
        member = members.get(username) if username else None
        reason = None
        if not username:
            outcome = NO_USERNAME
        elif member is None:
            outcome = NOT_FOUND
        elif before.role_id in member.roles:
            outcome = ALREADY_HAD
        elif stopped:
            outcome, reason = FAILED, stopped
        else:
            try:
                Discord.give_role(values, before.guild_id, member.id, before.role_id, role_name)
                outcome = GIVEN
                given.append(app_id)
                states[app_id] = DiscordVendorState(application_id=app_id, state=HAS_ROLE)
            except Discord.MemberGone as gone:
                outcome, reason = FAILED, str(gone)
                states[app_id] = DiscordVendorState(application_id=app_id, state=NOT_FOUND)
            except (Discord.DiscordRefused, Discord.DiscordUnavailable) as refused:
                stopped = str(refused)
                outcome, reason = FAILED, stopped
        outcomes.append(DiscordRoleOutcome(application_id=app_id, outcome=outcome, reason=reason))

    ran_at = _checked_at()
    counts = _counts(OUTCOMES, (each.outcome for each in outcomes))
    found = list(states.values())
    after = before.model_copy(update={
        "checked_at": ran_at, "vendor_states": found,
        "role_run": DiscordRoleRun(ran_at=ran_at, role_name=role_name or None, outcomes=outcomes),
    })
    written = _write_found(market, before, after, ("checked_at", "vendor_states", "role_run"))
    # The roles are given in Discord whether or not the market could be written: the history says
    # so either way, and the states only when they were kept.
    changed = _changed_states(before, found, vendors) if written else []
    named = {app_id for app_id, _ in changed} | set(given)
    named_vendors = [(app_id, email) for app_id, email, _ in vendors if app_id in named]
    History.record(
        market.id, requesting_user, Actions.CONNECT_DISCORD, kind=History.DISCORD_ROLES_GIVEN,
        vendors=[email for _, email in named_vendors],
        subject={"application_ids": [app_id for app_id, _ in named_vendors]},
        detail={"role_name": role_name, "given": given,
                **_state_detail(before, found, named_vendors, counts)})
    if not written:
        raise ConflictError(CHANGED_WHILE_GIVING)
    return {"counts": counts, "ranAt": ran_at}


def _username_question(market: Market, connection: DiscordConnection) -> str:
    """The card's username question, checked again: the form may have lost it since it was saved."""
    question = connection.username_question
    if not question:
        raise BadRequestError(NO_USERNAME_QUESTION)
    if question not in _text_questions(market):
        raise BadRequestError(USERNAME_QUESTION_GONE)
    return question


def _members_by_username(connection: DiscordConnection) -> Dict[str, Discord.Member]:
    """The server's members by their username, tidied as a vendor's is."""
    members: Dict[str, Discord.Member] = {}
    for member in Discord.server_members(Discord.required_credentials(), connection.guild_id):
        members.setdefault(tidied_username(member.username), member)
    return members


def _states(vendors: List[tuple], members: Dict[str, Discord.Member],
            role_id: Optional[str]) -> List[DiscordVendorState]:
    return [
        DiscordVendorState(application_id=app_id, state=_state(username, members, role_id))
        for app_id, _email, username in vendors
    ]


def _write_found(market: Market, before: DiscordConnection, after: DiscordConnection,
                 fields: tuple) -> bool:
    """Write ``fields`` of ``after``, and only while the card still names the server, the role and
    the username question they were read against: the members take seconds to read, and a card
    saved meanwhile is not undone. Whether it was written."""
    discord = market_doc_key("discord")
    stored = convert_keys_to_camel_case(after.model_dump(include=set(fields)))
    unchanged = {f"{discord}.{market_doc_key(field)}": getattr(before, field)
                 for field in CHECKED_AGAINST}
    written = MarketsApi.markets_collection.update_one(
        {**market_doc_filter("id", market.id), **unchanged},
        {"$set": {f"{discord}.{key}": value for key, value in stored.items()}})
    return written.matched_count > 0


def _counts(kinds: tuple, found: Any) -> Dict[str, int]:
    counts = {kind: 0 for kind in kinds}
    for kind in found:
        counts[kind] = counts.get(kind, 0) + 1
    return counts


def _changed_states(before: DiscordConnection, states: List[DiscordVendorState],
                    vendors: List[tuple]) -> List[tuple]:
    """Each vendor whose state is not the one the last check or run kept: id and address."""
    was = {vendor.application_id: vendor.state for vendor in before.vendor_states or []}
    now = {vendor.application_id: vendor.state for vendor in states}
    return [(app_id, email) for app_id, email, _ in vendors if was.get(app_id) != now.get(app_id)]


def _state_detail(before: DiscordConnection, states: List[DiscordVendorState],
                  changed: List[tuple], counts: Dict[str, int]) -> Dict[str, Any]:
    """The states of the vendors a check or a run ``changed``, before and after, with each one's
    address, by application id, and how many it found in each state or outcome."""
    was = {vendor.application_id: vendor.state for vendor in before.vendor_states or []}
    now = {vendor.application_id: vendor.state for vendor in states}
    return {
        "before": {app_id: was.get(app_id) for app_id, _ in changed},
        "after": {app_id: now.get(app_id) for app_id, _ in changed},
        "addresses": {app_id: email for app_id, email in changed},
        "counts": counts,
    }


def tidied_username(written: str) -> str:
    """A username as a vendor may have written it, as Discord's own: lowercase, trimmed, with no
    leading ``@`` and no old ``#1234`` tag."""
    username = written.strip().lower().lstrip("@").strip()
    return _OLD_TAG.sub("", username).strip()


def _state(username: str, members: Dict[str, Discord.Member], role_id: Optional[str]) -> str:
    if not username:
        return NO_USERNAME
    member = members.get(username)
    if member is None:
        return NOT_FOUND
    return HAS_ROLE if role_id and role_id in member.roles else IN_SERVER


def _vendors_usernames(market_id: str, question: str) -> List[tuple]:
    """Each vendor's application id, address and tidied username, in the order the market's
    applications are read: one main application each."""
    vendors = []
    for doc in ApplicationsApi.list_applications_for_market(market_id):
        if doc.get(ApplicationsApi.APPLICATION_TYPE_FIELD) != ApplicationType.MAIN.value:
            continue
        answer = ApplicationsApi.effective_answers(doc).get(question)
        username = tidied_username(answer) if isinstance(answer, str) else ""
        email = str(doc.get(ApplicationsApi.APPLICANT_EMAIL_FIELD) or "").strip().lower()
        vendors.append((str(doc.get("id")), email, username))
    return vendors


def _checked_at() -> str:
    return datetime.now(timezone.utc).isoformat()


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


def _state_is_this_sessions(
    started: Any, market_id: str, requesting_user: str, state: Optional[str],
) -> bool:
    """Whether ``state`` is the one this session started, for this market, by this person: a
    second account signed in on the same browser cannot finish what the first one began."""
    if not isinstance(started, dict) or not state:
        return False
    return (
        hmac.compare_digest(str(started.get("state", "")), state)
        and started.get("market_id") == market_id
        and started.get("by") == requesting_user
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
    if market.discord is None:
        # A market the product creates stores ``discord: null``, and Mongo cannot create a field
        # under an explicit null parent: the first connection writes the whole sub-document.
        stored = convert_keys_to_camel_case(after.model_dump(exclude_none=True))
        update = ({"$set": {market_doc_key("discord"): stored}} if stored
                  else {"$unset": {market_doc_key("discord"): ""}})
        MarketsApi.markets_collection.update_one(market_doc_filter("id", market.id), update)
    else:
        before_fields = before.model_dump()
        # A change of server forgets what was about the old one, whatever ``before`` read of it:
        # a check may have written its fields after ``before`` was loaded.
        forgotten = SERVER_CHOICES if after.guild_id != before.guild_id else ()
        update: Dict[str, Any] = {}
        for field, value in after.model_dump().items():
            if value == before_fields[field] and field not in forgotten:
                continue
            key = f"{market_doc_key('discord')}.{market_doc_key(field)}"
            if value is None:
                update.setdefault("$unset", {})[key] = ""
            else:
                update.setdefault("$set", {})[key] = convert_keys_to_camel_case(value)
        if update:
            MarketsApi.markets_collection.update_one(market_doc_filter("id", market.id), update)
    History.record(market.id, requesting_user, Actions.CONNECT_DISCORD, kind=kind,
                   detail=lambda: History.changes(_recorded(market, before),
                                                  _recorded(market, after)))


def _recorded(market: Market, connection: DiscordConnection) -> Dict[str, Any]:
    """The card's fields as the history keeps them: the question by its label as well as its key,
    since the history reads it by its label and the form may lose the question later."""
    labels = {field.key: field.label for field in (
        market.application_form.fields if market.application_form else [])}
    recorded = {field: getattr(connection, field) for field in RECORDED_FIELDS}
    recorded["username_question_label"] = labels.get(connection.username_question or "")
    return recorded
