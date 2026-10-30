"""Who may do what on a market: one row per action (E39/F01/S01).

Every permission check on a market asks one of the actions below, and none names a role of its
own. A row says the lowest role that may take its action - that role and every one above it,
Owner > Admin > Editor > Viewer - and the sentence a refusal answers with, which names that role.
The built-in defaults are the rules each check held before the table existed; a fixed row is one
nobody may change.

A market keeps the rows it differs on (``Market.permissions``, E39/F01/S03), and every check reads
the market's row where it holds one, its built-in default where not: ``minimum_role``. Only the
market's owner changes them (the fixed row ``change-the-table``), each change recorded in the
market's history (ADR 0019).

The rules of a market's life are not rows: an archived market refuses every change, verdicts
settle on entering assignment, a vendor is added from Assignment on. Each is asked where it
always was, and refuses whoever may.

A story that gates a new action adds its row here with ``action(...)`` and asks it with
``refusal`` or ``may``; it never compares a role itself.
"""
from dataclasses import dataclass
from typing import Any, Dict, List, Mapping, Optional

import api.permissions as PermissionsApi
from datatypes import Market, MarketPermission, MarketRole, Organization


@dataclass(frozen=True)
class Action:
    """One row of the table: an action and the lowest role that may take it."""

    #: Stable: the row is found, stored and logged by it.
    id: str
    group: str
    label: str
    default: MarketRole
    #: What the action is, after "may", in the refusal's sentence: "move this market's phase".
    may_what: str
    fixed: bool = False


#: Every row, by id, in the order the table lists them.
ACTIONS: Dict[str, Action] = {}


def action(
    action_id: str, group: str, label: str, default: MarketRole, may_what: str, *,
    fixed: bool = False,
) -> Action:
    """Add a row to the table and return it. An id names one row, once."""
    if action_id in ACTIONS:
        raise ValueError(f"The table already has a row {action_id!r}.")
    row = Action(action_id, group, label, default, may_what, fixed)
    ACTIONS[action_id] = row
    return row


READ = action(
    "read", "Reading",
    "Read the market: its applications, assignments, statistics, attendance, history and "
    "floorplan export",
    MarketRole.VIEWER, "see this market", fixed=True)
EXPORT_CSV = action(
    "export-csv", "Reading", "Export CSV", MarketRole.VIEWER, "export this market's CSV")
CHANGE_SETUP = action(
    "change-setup", "Market Setup", "Change Market Setup: the plan, its floorplans, the market's name",
    MarketRole.EDITOR, "change this market's setup")
CHANGE_FORM = action(
    "change-form", "Market Setup",
    "Change the form, the automatic rejections and the review highlights",
    MarketRole.EDITOR, "change this market's form, automatic rejections or review highlights")
IMPORT_APPLICATIONS = action(
    "import-applications", "Applications", "Import applications, and start a market from a CSV",
    MarketRole.ADMIN, "import applications or start this market from a CSV")
GIVE_VERDICTS = action(
    "give-verdicts", "Applications", "Give verdicts and follow-ups", MarketRole.EDITOR,
    "give verdicts and follow-ups on this market")
MOVE_PHASE = action(
    "move-phase", "Lifecycle", "Move the phase", MarketRole.ADMIN, "move this market's phase")
STOP_APPLICATIONS = action(
    "stop-applications", "Lifecycle", "Stop taking applications, and take them again",
    MarketRole.ADMIN, "stop or resume taking applications on this market")
PUBLISH_RESULTS = action(
    "publish-results", "Lifecycle", "Publish results", MarketRole.ADMIN,
    "publish this market's results")
ADD_VENDOR = action(
    "add-vendor", "Vendors", "Add a vendor who never applied", MarketRole.EDITOR,
    "add a vendor to this market")
WRITE_VENDOR_NOTES = action(
    "write-vendor-notes", "Vendors", "Write vendor notes", MarketRole.EDITOR,
    "write notes on this market's vendors")
UPDATE_VENDOR_INFO = action(
    "update-vendor-info", "Vendors", "Update a vendor's info", MarketRole.EDITOR,
    "update this market's vendors' info")
ASSIGN = action(
    "assign", "Assignment", "Allocate tables, change the assignment rules, and assign, swap or free seats",
    MarketRole.EDITOR, "allocate this market's tables, change its assignment rules or assign its vendors")
RECORD_PAYMENT = action(
    "record-payment", "Payments", "Record a payment", MarketRole.EDITOR,
    "record payments on this market")
CHECK_IN = action(
    "check-in", "The door", "Check vendors in", MarketRole.EDITOR,
    "check vendors in at this market")
MANAGE_EDITORS_AND_VIEWERS = action(
    "manage-editors-and-viewers", "People", "Give and take Editor and Viewer roles",
    MarketRole.ADMIN, "give or take Editor and Viewer roles on this market")
MANAGE_ADMINS = action(
    "manage-admins", "People", "Give and take Admin roles", MarketRole.OWNER,
    "give or take Admin roles on this market", fixed=True)
DELETE_MARKET = action(
    "delete-market", "People", "Delete the market", MarketRole.OWNER, "delete this market",
    fixed=True)
CHANGE_THE_TABLE = action(
    "change-the-table", "People", "Change this table", MarketRole.OWNER,
    "change who may do what on this market", fixed=True)


#: Where a row's role came from, as the market read serves it: no row held, copied from the
#: organization's default when the market was created, or changed on this market by its owner.
BUILT_IN = "built-in"
FROM_ORGANIZATION = "organization"
ON_THIS_MARKET = "market"
_STORED_SOURCES = (FROM_ORGANIZATION, ON_THIS_MARKET)


def held_row(row: Action, rows: Mapping[str, Any]) -> Optional[MarketPermission]:
    """The market's own row for this action, or None when it reads the built-in default.

    ``rows`` is a market's ``permissions``, as the model holds it or as a raw document stores it.
    A fixed row is never the market's, whatever is stored; nor is a row whose role or source this
    build does not know, which reads as no row held rather than failing the market's read.
    """
    if row.fixed or not isinstance(rows, Mapping):
        return None
    held = rows.get(row.id)
    if isinstance(held, dict):
        try:
            held = MarketPermission(**held)
        except Exception:
            return None
    if not isinstance(held, MarketPermission):
        return None
    if held.role not in _ROLE_VALUES or held.source not in _STORED_SOURCES:
        return None
    return held


_ROLE_VALUES = frozenset(role.value for role in MarketRole)


def _minimum_role_of(row: Action, rows: Mapping[str, Any]) -> MarketRole:
    held = held_row(row, rows)
    return MarketRole(held.role) if held else row.default


def minimum_role(row: Action, market: Market) -> MarketRole:
    """The lowest role that may take this action on this market: its own row, else the default."""
    return _minimum_role_of(row, market.permissions)


def table(market: Market) -> List[Dict[str, Any]]:
    """The market's table for display, every row in order: its label and group, the role it asks,
    its built-in default, where the role came from, whether it is fixed, and what the action is
    after "may", for Manage market's confirmation of a change (E39/F01/S04)."""
    served = []
    for row in ACTIONS.values():
        held = held_row(row, market.permissions)
        served.append({
            "id": row.id,
            "group": row.group,
            "label": row.label,
            "role": (MarketRole(held.role) if held else row.default).value,
            "default": row.default.value,
            "source": held.source if held else BUILT_IN,
            "fixed": row.fixed,
            "mayWhat": row.may_what,
        })
    return served


_WHO_MAY = {
    MarketRole.VIEWER: "someone who holds a role",
    MarketRole.EDITOR: "an Editor, an Admin or the owner",
    MarketRole.ADMIN: "an Admin or the owner",
    MarketRole.OWNER: "the market's owner",
}


def refusal_sentence(row: Action, required: Optional[MarketRole] = None) -> str:
    """The client-safe sentence a refusal of this row answers with, naming who may: ``required``,
    the role the row asks on the market refusing, its built-in default when not given."""
    return f"Only {_WHO_MAY[required or row.default]} may {row.may_what}."


def refusal(
    row: Action, user_email: str, market: Market, organization: Optional[Organization],
) -> Optional[str]:
    """Why this person may not take this action on this market, or None when they may.

    The row asks the market's role for it (``minimum_role``). The person's role is the one
    ``get_user_market_role`` resolves: the market's own and the one its organization gives, the
    higher counting.
    """
    required = minimum_role(row, market)
    if PermissionsApi.user_has_permission(user_email, market, required, organization):
        return None
    return refusal_sentence(row, required)


def role_refusal(
    row: Action, role: Optional[MarketRole], rows: Mapping[str, Any],
) -> Optional[str]:
    """``refusal`` for a role already resolved, on a market holding ``rows``: the market read
    resolves the person's role once and asks every row of it, and the markets list resolves each
    entry's role from the documents it holds (``_summary_role``) and passes the document's stored
    rows; each asks the row of that rather than resolving it again.
    """
    required = _minimum_role_of(row, rows)
    if PermissionsApi.role_reaches(role, required):
        return None
    return refusal_sentence(row, required)


def may(
    row: Action, user_email: str, market: Market, organization: Optional[Organization],
) -> bool:
    """Whether this person may take this action on this market."""
    return refusal(row, user_email, market, organization) is None


def roles_row(role: MarketRole) -> Action:
    """The row that gives and takes ``role``: Editor and Viewer roles one, Admin roles another.

    A market's one Owner is never given through Manage market, so giving the Owner role is the
    Admin row's, as giving it always took the owner.
    """
    if role in (MarketRole.EDITOR, MarketRole.VIEWER):
        return MANAGE_EDITORS_AND_VIEWERS
    return MANAGE_ADMINS
