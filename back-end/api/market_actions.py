"""Who may do what on a market: one row per action (E39/F01/S01).

Every permission check on a market asks one of the actions below, and none names a role of its
own. A row says the lowest role that may take its action - that role and every one above it,
Owner > Admin > Editor > Viewer - and the sentence a refusal answers with, which names that role.
The built-in defaults are the rules each check held before the table existed; a fixed row is one
nobody may change.

The rules of a market's life are not rows: an archived market refuses every change, verdicts
settle on entering assignment, a vendor is added from the assignment on. Each is asked where it
always was, and refuses whoever may.

A story that gates a new action adds its row here with ``action(...)`` and asks it with
``refusal`` or ``may``; it never compares a role itself.
"""
from dataclasses import dataclass
from typing import Dict, Optional

import api.permissions as PermissionsApi
from datatypes import Market, MarketRole, Organization


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
    "Read the market: its applications, assignment, statistics, attendance, history and "
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
AMEND_FORM = action(
    "amend-form", "Market Setup", "Amend a locked form", MarketRole.ADMIN,
    "amend this market's locked form")
IMPORT_APPLICATIONS = action(
    "import-applications", "Applications", "Import applications, and start a market from a CSV",
    MarketRole.ADMIN, "import applications or start this market from a CSV")
GIVE_VERDICTS = action(
    "give-verdicts", "Applications", "Give verdicts and follow-ups", MarketRole.EDITOR,
    "give verdicts and follow-ups on this market")
MOVE_PHASE = action(
    "move-phase", "Lifecycle", "Move the phase", MarketRole.ADMIN, "move this market's phase")
PUBLISH_RESULTS = action(
    "publish-results", "Lifecycle", "Publish results", MarketRole.ADMIN,
    "publish this market's results")
ADD_VENDOR = action(
    "add-vendor", "Vendors", "Add a vendor who never applied", MarketRole.EDITOR,
    "add a vendor to this market")
WRITE_VENDOR_NOTES = action(
    "write-vendor-notes", "Vendors", "Write vendor notes", MarketRole.EDITOR,
    "write notes on this market's vendors")
ASSIGN = action(
    "assign", "Assignment", "Allocate tables, change the assignment rules, and assign, swap or free seats",
    MarketRole.EDITOR, "allocate this market's tables, change its assignment rules or assign its vendors")
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


_WHO_MAY = {
    MarketRole.VIEWER: "someone who holds a role",
    MarketRole.EDITOR: "an Editor, an Admin or the owner",
    MarketRole.ADMIN: "an Admin or the owner",
    MarketRole.OWNER: "the market's owner",
}


def refusal_sentence(row: Action) -> str:
    """The client-safe sentence a refusal of this row answers with, naming who may."""
    return f"Only {_WHO_MAY[row.default]} may {row.may_what}."


def refusal(
    row: Action, user_email: str, market: Market, organization: Optional[Organization],
) -> Optional[str]:
    """Why this person may not take this action on this market, or None when they may.

    Their role is the one ``get_user_market_role`` resolves: the market's own and the one its
    organization gives, the higher counting.
    """
    if PermissionsApi.user_has_permission(user_email, market, row.default, organization):
        return None
    return refusal_sentence(row)


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
