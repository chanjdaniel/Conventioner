from datetime import datetime, timezone
import re
import uuid
from typing import Iterable, NamedTuple, Optional, Dict, Any, List, Tuple
from pymongo.errors import DuplicateKeyError
from pymongo.results import DeleteResult
from pydantic import ValidationError
from datatypes import (
    Application,
    ApplicationForm,
    ApplicationStatus,
    AssignmentStatistics,
    EssentialFormOptions,
    FormField,
    IntakeMode,
    Market,
    MarketPerson,
    MarketPhase,
    MarketRole,
    MarketTableRow,
    Organization,
    RejectionRule,
    SetupObject,
    UnassignedTableEntry,
    User,
    intake_mode_from_market_document,
    market_name_slug,
    phase_from_market_document,
    table_code_for,
    table_code_sort_key,
)
from assignment.assignment import (
    NOTHING_TO_ASSIGN,
    IncompleteApplicationsError,
    assign_market,
    describe_stored_assignment,
    solver_vendors_for,
)
from assignment.vendor_input import SolverVendor, outside_solver_vendors
from assignment.utils import convert_keys_to_snake_case, convert_keys_to_camel_case
import api.applications as ApplicationsApi
import api.applicants as ApplicantsApi
import result_outcome as ResultOutcome
import csv_proposal as CsvProposal
import essential_fields as EssentialFields
from market_documents import (
    market_doc_field,
    market_doc_projection,
    market_doc_filter,
    market_doc_key,
    market_doc_set,
    market_from_document,
)
import api.permissions as PermissionsApi
import market_deletion as MarketDeletion
import placement_history as PlacementHistory
import phase_record as PhaseRecord
import api.attendance as AttendanceApi
import api.organizations as OrgsApi
import api.users as UsersApi
import rejection_rules as RejectionRules
import logging
from assignment.csv_output import market_csv_to_string
from guards import (
    PASSED_THROUGH,
    PreconditionResult,
    evaluate_transition,
    move_route,
    route_between,
    transition_verdicts,
)
import vendor_notes as VendorNotes
from assignment.made_from import assignment_rules, changed_since_run
from placement_reasons import orphaned_pins, overridden_placements, unplaced_dates
from db_config import get_database

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

db = get_database()
markets_collection = db["markets"]

VALID_FORM_FIELD_TYPES = {"text", "number", "select", "multi_select", "checkbox", "date", "email"}

# Field keys become document keys inside ``Application.form_data``, where a dot or a leading
# ``$`` cannot be addressed by Mongo update operators. Keys are held to the slug charset the
# builder produces so no key can ever be unaddressable.
FORM_FIELD_KEY_PATTERN = re.compile(r"^[a-z0-9_]+$")


class MarketNotFoundError(ValueError):
    """No market exists with the requested id. Callers map this to HTTP 404."""


class ApplicationFormLockedError(Exception):
    """The application form may no longer be edited. Callers map this to HTTP 409.

    A dedicated type rather than a builtin: a ``RuntimeError`` escaping any other part of an
    update is a bug, not a conflict, and must not be reported to the client as one.
    """


def _load_organization_context(
    organization_id: Optional[str],
) -> Tuple[Optional[Organization], Optional[Dict[str, Any]]]:
    """Resolve a market's organization to its model and its raw document.

    Either half is None when the organization is absent, and the model alone is None when the
    stored document fails validation - a market whose organization no longer parses is still
    servable, it just grants no organization-derived permission.
    """
    if not organization_id:
        return None, None
    org_dict = OrgsApi.get_organization(organization_id)
    if not org_dict:
        return None, None
    org_dict.pop('_id', None)
    try:
        return Organization(**org_dict), org_dict
    except Exception as e:
        logger.warning(f"Failed to parse organization {organization_id}: {e}")
        return None, org_dict


def _load_organization(organization_id: Optional[str]) -> Optional[Organization]:
    """Resolve a market's organization, or None when absent or unparseable."""
    organization, _ = _load_organization_context(organization_id)
    return organization


def _load_market_for(market_id: str, requesting_user: str, role: MarketRole, action: str) -> Market:
    """Load a market and assert the requesting user holds at least ``role`` on it."""
    market_dict = markets_collection.find_one({"id": market_id})
    if not market_dict:
        raise MarketNotFoundError("Market not found")

    try:
        market = market_from_document(market_dict)
    except Exception as e:
        raise ValueError(f"Invalid market data: {e}")

    organization = _load_organization(market.organization_id)
    if not PermissionsApi.user_has_permission(requesting_user, market, role, organization):
        raise PermissionError(f"User does not have permission to {action} this market")

    return market


ARCHIVED_REFUSAL = (
    "This market is archived. An archived market is the record of what happened, "
    "so nothing in it can be changed."
)


class MarketArchivedError(PermissionError):
    """A write to an archived market (bug 30, E26/F06/S01).

    A ``PermissionError``, because that is what it is - nobody, whatever their role, may change a
    market's record - and because every write route already answers one with a 403 carrying its
    words. A refusal that needed a new branch in each route would be one forgotten branch from a 500.
    """


def archived_refusal(market: Market) -> Optional[str]:
    """Why this market cannot be changed, or None while it can.

    The one statement of the rule, for the routes that load a market themselves; everything that
    loads through ``_load_market_to_change`` meets it there.
    """
    return ARCHIVED_REFUSAL if market.phase is MarketPhase.ARCHIVED else None


VIEWER_REFUSAL = (
    "You can view this market but not change it. Its owner or an admin can give you editing "
    "access."
)
EDITOR_REFUSAL = (
    "Moving this market's phase, publishing its results and importing applications are for its "
    "owner and admins."
)


def change_refusal(
    user_email: str, market: Market, organization: Optional[Organization],
) -> Optional[str]:
    """Why this person cannot change this market, or None while they can (E26/F08/S01).

    The bar every plan, form, placement and highlight write sets - EDITOR - asked through the same
    permission check those writes ask, and the archived rule above it. Served on the market as
    ``readOnlyReason``, so a screen offers no control its write would refuse: a Viewer was shown
    every one, and each edit appeared to work until its save failed with a 403 (bug 37).
    """
    archived = archived_refusal(market)
    if archived:
        return archived
    if PermissionsApi.user_has_permission(user_email, market, MarketRole.EDITOR, organization):
        return None
    return VIEWER_REFUSAL


def admin_actions_refusal(
    user_email: str, market: Market, organization: Optional[Organization],
) -> Optional[str]:
    """Why this person cannot take the ADMIN actions - moving the phase, publishing results,
    importing - or None while they can (E26/F08/S01). Deciding applications is not one: a verdict
    is EDITOR's (E34/F01/S01), and ``change_refusal`` answers for it.

    Served as ``adminActionsReason``. An Editor changes the plan and the seats but runs none of
    these, and the rail offered them every phase move all the same.
    """
    refused = change_refusal(user_email, market, organization)
    if refused:
        return refused
    if PermissionsApi.user_has_permission(user_email, market, MarketRole.ADMIN, organization):
        return None
    return EDITOR_REFUSAL


VERDICTS_SETTLED = (
    "The review is closed: the verdicts settled when this market began its assignment. To seat "
    "someone or free a seat, change the placement on the Result page."
)


def review_is_open(phase: MarketPhase) -> bool:
    """Whether this market can still get back to review, the one rule both the verdicts and the
    automatic rejections settle on (E36/F01/S01). A rule and a reviewer judge the same
    applications, so they close together; derived from the transition table rather than listed."""
    return route_between(phase.value, MarketPhase.REVIEW.value) is not None


def verdict_refusal(
    user_email: str, market: Market, organization: Optional[Organization],
) -> Optional[str]:
    """Why this person cannot give a verdict here, or None while they can (E34).

    A verdict - and a follow-up, a claim on a card - is EDITOR's (E34/F01/S01), and open while the
    review is (E36/F01/S01): from assignment on, a verdict is the review's record, and a mistake is
    fixed with a seat placed or freed by hand. Served as ``verdictLockReason``, so every review
    screen offers exactly what the write takes.
    """
    refused = change_refusal(user_email, market, organization)
    if refused:
        return refused
    if not review_is_open(market.phase):
        return VERDICTS_SETTLED
    return None


#: The phases a vendor who never applied is added in (E36/F03/S01): once the review has closed and
#: seats are being given.
ADDING_PHASES = (MarketPhase.ASSIGNMENT, MarketPhase.MARKET_DAYS)

NOT_YET_ADDING = (
    "A vendor is added by hand from the assignment on. Until then, vendors reach this market "
    "through its applications."
)


def adding_refusal(phase: MarketPhase) -> Optional[str]:
    """Why no vendor may be added in this phase, or None (E36/F03/S01): the write's rule."""
    return None if phase in ADDING_PHASES else NOT_YET_ADDING


def add_vendor_refusal(
    user_email: str, market: Market, organization: Optional[Organization],
) -> Optional[str]:
    """Why this person cannot add a vendor here, or None while they can (E36/F03/S01). Served as
    ``addVendorReason``, so the page offers the action exactly when the write would take it."""
    return change_refusal(user_email, market, organization) or adding_refusal(market.phase)


def _load_market_to_change(
    market_id: str, requesting_user: str, role: MarketRole, action: str,
) -> Market:
    """``_load_market_for``, for a write: an archived market is refused whoever is asking.

    Every write that loads its market here meets the archived rule without saying so, so a new
    write that loads through this cannot forget it. Roles and deletion do not come through here:
    who may see a record, and whether to keep it, are decisions about the record, not changes to it.
    """
    market = _load_market_for(market_id, requesting_user, role, action)
    refusal = archived_refusal(market)
    if refusal:
        raise MarketArchivedError(refusal)
    return market


def application_form_lock_reason(market: Market) -> Optional[str]:
    """The single source of truth for whether a market's application form may be edited.

    Returns the human-readable reason the form is locked, or None when it is editable.
    Phase gate: forms are editable only in ``draft``. D9: the form freezes for good once
    any application exists, so applicants can never have answered a question that moved. An
    archived market gives the archived reason, which is the true one (E30/F01/S02).
    """
    archived = archived_refusal(market)
    if archived:
        return archived
    if market.phase != MarketPhase.DRAFT:
        # In the words of the market's own path: a CSV market's form is the questions its imports
        # are mapped onto, and it never opened applications (E31/F03/S02).
        if market.intake_mode is IntakeMode.FORM:
            return (
                f"The application form is fixed: it cannot change {_since_leaving_draft(market)}, "
                "because applicants answer it."
            )
        return (
            f"The questions are fixed: they cannot change {_since_leaving_draft(market)}, "
            "because your imports are mapped onto them."
        )

    existing_app_count = ApplicationsApi.count_applications_for_market(market.id)
    if existing_app_count > 0:
        app_word = (
            "application has" if existing_app_count == 1 else "applications have"
        )
        return (
            "Application form is locked. "
            f"{existing_app_count} {app_word} already been submitted for this market. "
            "The form cannot be modified once applicants have submitted."
        )

    return None


ASSIGNMENT_RULES_SETTLED = (
    "The assignment for this market is settled. A rule only takes effect when the assignment "
    "runs, and this market can no longer run it. Change a single placement on the Result page "
    "instead."
)


ASSIGNMENT_RULES_PUBLISHED = (
    "Results are published, so the assignment is settled: a rule only takes effect when the "
    "assignment runs, and it is not run again once applicants have been told. Change a single "
    "placement on the Result page instead."
)


def assignment_rules_lock_reason(market: Market) -> Optional[str]:
    """Why the assignment rules may no longer change, or None while they still can (E22/F02).

    A rule - the priority, the max assignments per vendor, the half-table proportion - only takes
    effect when the assignment runs, and it runs in the ``assignment`` phase alone. So the rules
    are open for exactly as long as the market can still get there. That is derived from the
    transition table rather than listed, so a phase added or an edge moved decides it with no edit
    here: today it closes them in ``offers``, ``market_days`` and ``archived``. An archived market
    gives the archived reason, since no placement can be changed there either (E30/F01/S02).
    Publishing results settles them too (E36/F04/S02), since the run is not made again after it.
    """
    phase = market.phase
    if phase is MarketPhase.ARCHIVED:
        return ARCHIVED_REFUSAL
    if route_between(phase.value, MarketPhase.ASSIGNMENT.value) is None:
        return ASSIGNMENT_RULES_SETTLED
    if market.results_published:
        return ASSIGNMENT_RULES_PUBLISHED
    return None


REJECTION_RULES_SETTLED = (
    "The automatic rejections are settled: the market has reached Assignment, and a rule judges "
    "applications only while they can still be reviewed."
)


def rejection_rules_lock_reason(phase: MarketPhase) -> Optional[str]:
    """Why the automatic rejections may no longer change, or None while they can (E33/F03/S01).

    A rule judges applications in review, so the rules are open exactly as long as the market can
    still get back there (decision 24), derived from the transition table rather than listed. Not
    the form's lock: the form freezes at the first application, and the rules are worth most once
    applications are arriving.
    """
    if phase is MarketPhase.ARCHIVED:
        return ARCHIVED_REFUSAL
    if review_is_open(phase):
        return None
    return REJECTION_RULES_SETTLED


def rejection_facts(market: Market) -> Dict[str, Any]:
    """What the review setup needs to offer the rules, served on the market read: the questions a
    rule may name, the rules as they stand against the current form, and whether they may change."""
    book = RejectionRules.Rulebook(market)
    return {
        "rejectionQuestions": book.questions,
        "rejectionRules": book.served_rules(),
        "rejectionRulesLockReason": rejection_rules_lock_reason(market.phase),
    }


# The menu's own names for the moves back to draft (``pathTransitionLabel`` in
# ``front-end/src/utils/marketGuide.ts``), from each phase a market can still get back from.
_WAY_BACK = {
    MarketPhase.APPLICATIONS_OPEN: {
        IntakeMode.FORM: "Reopen for Editing",
        IntakeMode.CSV: "Reopen for Editing",
    },
    MarketPhase.APPLICATIONS_CLOSED: {
        IntakeMode.FORM: "Reopen Applications, then Reopen for Editing",
        IntakeMode.CSV: "Import more responses, then Reopen for Editing",
    },
}


def _since_leaving_draft(market: Market) -> str:
    """When a market left draft, as its own path says it: a CSV market imports its Google Form's
    responses rather than opening applications (E31/F03/S03, E32/F02/S01)."""
    if market.intake_mode is IntakeMode.FORM:
        return "once applications have opened"
    return "once the market has moved on to importing"


def setup_part(plan: Optional[SetupObject]) -> Dict[str, Any]:
    """The part of a plan that is the setup, in one comparable shape (E31/F01/S02).

    Everything on Market Setup: the dates, tiers, locations, sections and their tables, and the
    floorplans. Not the assignment rules (``made_from.assignment_rules``), which ride in the same
    object and keep a lock of their own.
    """
    if plan is None:
        return {}
    shape = plan.model_dump(include={"market_dates", "tiers", "locations", "sections", "floorplans"})
    shape["floorplans"] = shape.get("floorplans") or []
    return shape


def setup_lock_reason(market: Market) -> Optional[str]:
    """Why the setup may no longer change, or None while it can (E31/F01/S02).

    It settles on leaving draft, so a date an applicant chose or a section a vendor was placed in
    cannot move under them. While the market can still go back to draft - nobody has applied, and it
    is collecting or has just stopped - the reason names the moves that get it there, since that is
    the way to change it.
    """
    if market.phase is MarketPhase.DRAFT:
        return None
    settled = (
        f"The setup is settled: it cannot change {_since_leaving_draft(market)}, because "
        "applicants and the assignment rely on it."
    )
    way_back = _WAY_BACK.get(market.phase, {}).get(market.intake_mode)
    if way_back and ApplicationsApi.count_applications_for_market(market.id) == 0:
        return (
            f"{settled} While no one has applied, go back to draft to change it: {way_back}, "
            "under More… on the phase rail."
        )
    return settled


def _assert_application_form_editable(market: Market) -> None:
    reason = application_form_lock_reason(market)
    if reason:
        raise ApplicationFormLockedError(reason)


def _normalized_select_options(field: FormField, key: str) -> List[str]:
    """Options are the persisted answer values in ``Application.form_data``, so they carry the
    same burden as field keys: a duplicate is an ambiguous answer, a blank is an unselectable
    row in the applicant's form, and stray whitespace would ride along into every answer."""
    if not field.options:
        raise ValueError(
            f"Field '{key}' is type '{field.type}' but has no options defined"
        )

    options: List[str] = []
    for option in field.options:
        option_value = (option or "").strip()
        if not option_value:
            raise ValueError(f"Field '{key}' has a blank option. Options must be non-empty.")
        if option_value in options:
            raise ValueError(
                f"Duplicate option '{option_value}' in field '{key}'. Options must be unique."
            )
        options.append(option_value)

    return options


def _normalized_application_form(
    application_form: ApplicationForm,
    published_at: Optional[str] = None,
    essential_options: Optional[EssentialFormOptions] = None,
) -> ApplicationForm:
    """Validate a form and return it exactly as it will be persisted.

    Every writer of ``Market.application_form`` goes through here, so no form can reach storage
    unvalidated. Validation and normalization are one step so a stored value can never differ
    from the value that was checked. Field keys are the primary key of every applicant's answers:
    they must be present, unique, and addressable as Mongo document keys. ``order`` is
    renormalized to the array position, which is the display order every writer already implies,
    so the builder and the applicant's form can never disagree about it.

    ``published_at`` is lock-bearing lifecycle state (D9). It is taken from the server's stored
    form and any value in the payload is discarded, so a client can never forge it.
    ``essential_options`` is the frozen offering of the essential questions and is server-owned
    for the same reason: it is stamped by the first recorded applicant answer
    (``essential_fields.freeze_essential_options``) and any value in a payload is discarded.
    """
    # A form with no custom fields is a form. AGENTS.md states the rule this used to contradict:
    # "a form is its custom fields PLUS the essential questions the plan asks, and either half
    # alone is a form". Refusing to persist a zero-field form meant a market whose intake is the
    # essential questions - the common case - could not record anything ABOUT its form, including
    # which questions it does not ask (E01/F06). Whether a form asks enough to open applications is
    # FormHasFieldsGuard's decision, and it counts both halves; this is not the place for a third
    # copy of that rule.

    # Which essential questions this market declares it does not ask (E01/F06). Unlike
    # ``essential_options`` this IS the organizer's to set, so it is validated rather than
    # discarded: only a ranking may be declared, because only a ranking is a preference the solver
    # never filters on.
    unasked = [str(key).strip() for key in application_form.unasked_essentials or [] if str(key).strip()]
    unaskable_error = EssentialFields.unaskable_essential_error(unasked)
    if unaskable_error:
        raise ValueError(unaskable_error)

    fields: List[FormField] = []
    seen_keys = set()
    for index, field in enumerate(application_form.fields):
        key = (field.key or "").strip()
        if not key:
            raise ValueError(
                f"Field '{field.label or '(untitled)'}' must have a non-empty key"
            )
        if not FORM_FIELD_KEY_PATTERN.match(key):
            raise ValueError(
                f"Invalid field key '{key}'. Keys may only contain lowercase letters, "
                "numbers, and underscores."
            )
        if key.startswith(EssentialFields.ESSENTIAL_KEY_PREFIX):
            raise ValueError(
                f"Field key '{key}' uses the reserved "
                f"'{EssentialFields.ESSENTIAL_KEY_PREFIX}' prefix. Those keys belong to the "
                "essential questions every form already asks."
            )
        if key in seen_keys:
            raise ValueError(f"Duplicate field key '{key}'. Field keys must be unique.")
        seen_keys.add(key)

        label = (field.label or "").strip()
        if not label:
            raise ValueError(f"Field '{key}' must have a non-empty label")

        if field.type not in VALID_FORM_FIELD_TYPES:
            raise ValueError(
                f"Unrecognized field type '{field.type}' for field '{key}'. "
                f"Valid types: {', '.join(sorted(VALID_FORM_FIELD_TYPES))}"
            )

        options = (
            _normalized_select_options(field, key)
            if field.type in ("select", "multi_select")
            else []
        )

        fields.append(field.model_copy(update={
            "key": key,
            "label": label,
            "options": options,
            "order": index,
        }))

    return application_form.model_copy(update={
        "fields": fields,
        "published_at": published_at,
        "essential_options": essential_options,
        "unasked_essentials": unasked,
    })


def _application_form_dump(market: Market) -> Optional[Dict[str, Any]]:
    return market.application_form.model_dump() if market.application_form else None


def _strip_persisted_assignment_statistics(market_dict: Dict[str, Any]) -> None:
    """Keep assignment statistics derived at read-time only, never persisted."""
    assignment_object = market_dict.get("assignment_object")
    if isinstance(assignment_object, dict):
        assignment_object.pop("assignment_statistics", None)


def assignment_to_show(market: Market, vendors=None) -> Market:
    """The assignment every read-only view should describe: the stored one, and only that.

    A market that HAS been assigned is shown what it stored, because that is what check-in reads
    and what the organizer has been editing (E11/F03/S01). A market that has not is shown nobody
    placed (E31/F03/S05): it used to be shown the run it would get, drawn exactly like a result, so
    Vendors said "197 of 197 vendors assigned" before anyone had pressed Assign. The run it would
    get is ``GET /markets/:id/assignment``, which says it is a preview. Deciding this once, in one
    function, is what stops the payoff screen and the tables grid describing different markets.
    """
    if market.setup_object is None:
        # A market as the create dialog leaves it has no plan, so no table to place anyone at.
        # That is an empty assignment, not an error: Result and Vendors answered 500 (E30/F01/S01).
        everyone = [vendor.email for vendor in vendors or []]
        market.assignment_object.assignment_statistics = AssignmentStatistics(
            total_vendors=len(everyone), total_tables=0, total_assignments=0,
            total_assigned_vendors=0, total_assigned_tables=0, unassigned_vendors=everyone,
            unassigned_tables={}, assignments_per_date={}, assignments_per_tier={},
            assignments_per_section={},
        )
        return market
    return describe_stored_assignment(market, vendors)


def derive_market_table_rows(assigned_market: Market) -> List[MarketTableRow]:
    """Derive one row per table/date with assignment slots."""
    setup_object = assigned_market.setup_object
    if setup_object is None:
        return []

    rows_by_key: Dict[tuple[str, str], Dict[str, Any]] = {}

    for market_date in setup_object.market_dates:
        for section in setup_object.sections:
            for idx in range(section.count):
                table_code = table_code_for(section.name, idx + 1)
                rows_by_key[(market_date.date, table_code)] = {
                    "date": market_date.date,
                    "assignment_slots": [None, None],
                    "location": section.location.name if section.location else "",
                    "section": section.name,
                    "table_choice": "Full Table",
                    "table_code": table_code,
                    "tier": section.tier.name if section.tier else "",
                }

    for assignment in assigned_market.assignment_object.vendor_assignments:
        date_value = assignment.date
        key = (date_value, assignment.table_code)

        if key not in rows_by_key:
            rows_by_key[key] = {
                "date": date_value,
                "assignment_slots": [None, None],
                "location": assignment.location,
                "section": assignment.section,
                "table_choice": "Full Table",
                "table_code": assignment.table_code,
                "tier": assignment.tier,
            }

        row = rows_by_key[key]
        choice_normalized = assignment.table_choice.strip().lower()
        if "full table" in choice_normalized:
            row["assignment_slots"] = [assignment.email, assignment.email]
        elif "half table" in choice_normalized and "left" in choice_normalized:
            row["assignment_slots"][0] = assignment.email
        elif "half table" in choice_normalized and "right" in choice_normalized:
            row["assignment_slots"][1] = assignment.email
        else:
            if row["assignment_slots"][0] is None:
                row["assignment_slots"][0] = assignment.email
            elif row["assignment_slots"][1] is None:
                row["assignment_slots"][1] = assignment.email

    rows: List[MarketTableRow] = []
    for row in rows_by_key.values():
        left_slot, right_slot = row["assignment_slots"]
        assignment: List[str]
        table_choice = "Full Table"

        if left_slot is None and right_slot is None:
            assignment = []
        elif left_slot and right_slot:
            if left_slot == right_slot:
                assignment = [left_slot, right_slot]
                table_choice = "Full Table"
            else:
                assignment = [left_slot, right_slot]
                table_choice = "Half Table"
        else:
            # Defensive fallback for partially represented rows.
            only_email = left_slot or right_slot
            assignment = [only_email] if only_email else []
            table_choice = "Half Table"

        rows.append(MarketTableRow(
            date=row["date"],
            assignment=assignment,
            # Seat by seat, so "the right half is free" is answerable. ``assignment`` above keeps
            # its meaning - the occupants, and nothing else - because its LENGTH is what
            # ``derive_unassigned_tables_from_rows`` reads to count spare capacity.
            assignment_slots=[left_slot, right_slot],
            location=row["location"],
            section=row["section"],
            table_choice=table_choice,
            table_code=row["table_code"],
            tier=row["tier"],
        ))

    return sorted(
        rows,
        key=lambda row: (row.date, row.location, row.section, table_code_sort_key(row.table_code)),
    )


def derive_unassigned_tables_from_rows(rows: List[MarketTableRow]) -> Dict[str, List[UnassignedTableEntry]]:
    """Build assignment statistics unassigned tables from normalized market table rows."""
    unassigned_tables: Dict[str, List[UnassignedTableEntry]] = {}

    for row in rows:
        # Consider table rows with no vendor or only one-side occupancy as unassigned capacity.
        if len(row.assignment) > 1:
            continue

        if row.date not in unassigned_tables:
            unassigned_tables[row.date] = []
        unassigned_tables[row.date].append(UnassignedTableEntry(
            table_code=row.table_code,
            table_choice=row.table_choice,
        ))

    return unassigned_tables

def get_market(market_id: str) -> Optional[Dict[str, Any]]:
    """Get a market by id. (Deprecated - use get_market_for_user instead)"""
    return markets_collection.find_one({"id": market_id})


class MarketContext(NamedTuple):
    """Everything a permission check needs about a stored market.

    ``market`` is None when the stored document fails validation; the raw
    ``document`` is still returned so callers can tell that case apart from
    a missing market.
    """
    document: Dict[str, Any]
    market: Optional[Market]
    organization: Optional[Organization]
    organization_dict: Optional[Dict[str, Any]]


def load_market_context(market_id: str) -> Optional[MarketContext]:
    """Load a market with its parsed model and owning organization, or None if absent."""
    market_dict = markets_collection.find_one({"id": market_id})
    if not market_dict:
        return None

    try:
        market = market_from_document(market_dict)
    except Exception as e:
        logger.warning("Stored market %s failed validation: %s", market_id, e)
        return MarketContext(market_dict, None, None, None)

    organization, org_dict = _load_organization_context(market.organization_id)

    return MarketContext(market_dict, market, organization, org_dict)


def _stamp_effective_market_state(market: Dict[str, Any], phase: MarketPhase) -> None:
    """Serve a raw market document with its derived fields agreeing with what it stores.

    A response built from a raw document bypasses ``Market``, and with it the guarantee that
    ``is_draft`` is derived strictly from phase - a document the old publish flow wrote
    (``phase: draft`` from create, ``isDraft: false`` from the publish PUT) would otherwise go
    out with the two fields contradicting each other. Deriving ``isDraft`` from the effective
    phase here means no reader has to know which of the two to believe, migrated or not.

    Intake mode is stamped for the same reason, one field over: a document that names none, or
    names one this build does not recognize, is served the value every reader on the server side
    has already agreed it has. Without that, a client round-tripping such a market would PUT back
    a value the model refuses, and a draft market would answer 400 on an edit that touched
    something else entirely.
    """
    market['phase'] = phase.value
    market[market_doc_key('is_draft')] = phase == MarketPhase.DRAFT
    market[market_doc_key('intake_mode')] = intake_mode_from_market_document(market).value


def get_market_for_user(user_email: str, market_id: str) -> Optional[Dict[str, Any]]:
    """Get a market by id, checking user has access."""
    context = load_market_context(market_id)
    if context is None or context.market is None:
        return None

    market_dict = context.document
    market = context.market
    org_dict = context.organization_dict

    user_role = PermissionsApi.get_user_market_role(user_email, market, context.organization)
    if user_role is None:
        return None

    market_dict['_id'] = str(market_dict['_id'])
    market_dict['user_role'] = user_role.value
    _stamp_effective_market_state(market_dict, market.phase)
    # The form lock rides on the market every screen reads (E21/F02/S03): it depends on whether an
    # application exists, which only the server knows, and the store re-reads the market after every
    # write - so a transition reaches the form builder the moment it lands. Served, never stored.
    market_dict['applicationFormLockReason'] = application_form_lock_reason(market)
    # So does the assignment rules' (E22/F02/S02): the rules page mirrors the plan write's refusal
    # from the market it holds, rather than deciding the phases for itself.
    market_dict['assignmentRulesLockReason'] = assignment_rules_lock_reason(market)
    # And whether the assignment may run (E36/F04/S02): not once results are published.
    from api.placements import assign_refusal
    market_dict['assignRefusalReason'] = assign_refusal(market)
    # And what an automatic rejection may name, and whether it may change (E33/F03/S01).
    market_dict.update(rejection_facts(market))
    # And the setup's (E31/F01/S02), for Market Setup to read as settled rather than as editable.
    market_dict['setupLockReason'] = setup_lock_reason(market)
    # And why this market cannot be started from a Google Form's CSV (E24/F03): the flow and the
    # Market Setup action mirror the proposal's own refusal rather than deciding it for themselves.
    market_dict['csvStartRefusal'] = CsvProposal.refusal(market_dict)
    # Which of the rules, the plan and the approved applications changed since the stored
    # assignment ran (E22/F03/S01). Computed on read, never stored; empty when nothing has, or when
    # the assignment predates the fingerprints and so is not known to be out of date. Only in
    # `assignment`, the one phase that can act on it by running again: every other read - a running
    # market's above all - is spared reading the approved applications to compute it.
    market_dict['assignmentOutOfDate'] = (
        changed_since_run(market) if market.phase is MarketPhase.ASSIGNMENT else []
    )
    # Hand placements at a seat the plan no longer has, for Result and the vendor's panel to mark
    # (bug 31). The guard refuses Publish on the same list; reading it here keeps the pages from
    # deciding for themselves which seats exist.
    market_dict['orphanedPins'] = [
        {"email": pin.email, "date": pin.date, "tableCode": pin.table_code}
        for pin in orphaned_pins(
            market.setup_object, market.assignment_object.vendor_assignments or [],
        )
    ]
    # Where this market has been (E26/F06/S03), for the archived rail to say how far it got.
    # `phaseRecordComplete` false means a phase missing from the list is unknown, not never.
    reached = PhaseRecord.phases_reached(market_dict, AttendanceApi.market_has_attendance)
    market_dict['phasesReached'] = sorted(reached.phases)
    market_dict['phaseRecordComplete'] = reached.complete
    # Why this person cannot change this market, or take its admin actions; null while they can
    # (E26/F06/S01, E26/F08/S01). The same rules every write meets, served so each screen offers
    # no control the server would refuse.
    market_dict['readOnlyReason'] = change_refusal(user_email, market, context.organization)
    market_dict['verdictLockReason'] = verdict_refusal(user_email, market, context.organization)
    market_dict['addVendorReason'] = add_vendor_refusal(user_email, market, context.organization)
    # Results wait for the allocation (E36/F04/S01): offered exactly when the endpoint would take
    # them, with how many will read each outcome for the confirmation.
    publish_reason = admin_actions_refusal(
        user_email, market, context.organization,
    ) or ApplicantsApi.publish_results_refusal(market)
    market_dict['publishResultsReason'] = publish_reason
    market_dict['publishOutcomes'] = (
        None if publish_reason else ResultOutcome.outcome_counts(market)
    )
    market_dict['adminActionsReason'] = admin_actions_refusal(
        user_email, market, context.organization,
    )
    # What would refuse each move open from this phase (E31/F02/S01), judged as the transition
    # endpoint judges it, so the rail can disable a move and name why before anyone clicks it.
    market_dict['transitionBlockers'] = {
        to_phase: [blocker.payload() for blocker in blockers]
        for to_phase, blockers in transition_verdicts(market, db).items()
    }
    # The phases this market's path steps through rather than stops in (E32/F02/S01), for the rail
    # to leave off its stages. The moves themselves are the keys above; the browser keeps no copy
    # of the rule that makes either.
    market_dict['phasesPassedThrough'] = sorted(PASSED_THROUGH.get(market.intake_mode, ()))
    if market.organization_id and org_dict:
        market_dict['organization_name'] = org_dict.get('name')
    # The roles on the market itself, which Manage market lists, served to every reader; and
    # whom this reader may hand a follow-up to (T15), served only to someone who may give a verdict
    # and so name one (E34's EDITOR gate): the organization's people too, if the reader is one.
    may_give_verdicts = PermissionsApi.user_has_permission(
        user_email, market, MarketRole.EDITOR, context.organization,
    )
    reader = UsersApi.get_user(user_email) if may_give_verdicts else None
    ids = (
        PermissionsApi.follow_up_owners_for(
            market, context.organization, reader.id if reader else None)
        if may_give_verdicts
        else list((market_dict.get('roles') or {}).keys())
    )
    email_by_user_id = {}
    for uid in ids:
        user = UsersApi.get_user_by_id(uid)
        if user:
            email_by_user_id[uid] = user.email
    market_dict['role_emails'] = {
        uid: email_by_user_id[uid]
        for uid in (market_dict.get('roles') or {}) if uid in email_by_user_id
    }
    market_dict['peopleOnMarket'] = list(email_by_user_id.values()) if may_give_verdicts else []
    return market_dict

def get_markets_by_owner_email(owner_email: str) -> List[Dict[str, Any]]:
    """Get all markets by owner. (Deprecated - use get_markets_for_user instead)"""
    # Find markets where owner_email has OWNER role
    return list(markets_collection.find({f"roles.{owner_email}": MarketRole.OWNER.value}))


class _SummaryLookups:
    """Memo for the organization and user reads a market list makes.

    Decorating one market costs an organization read plus a user read per role entry, and a
    list repeats the same few organizations and the same few members across every entry. The
    organizations the caller already fetched seed the memo, so the common case - every market
    belonging to an organization the user is a member of - costs no organization read at all.
    """

    def __init__(self, organizations: Optional[List[Dict[str, Any]]] = None) -> None:
        self._organizations: Dict[str, Any] = {org['id']: org for org in (organizations or [])}
        self._users: Dict[str, Any] = {}

    def organization(self, org_id: str) -> Optional[Dict[str, Any]]:
        if org_id not in self._organizations:
            self._organizations[org_id] = OrgsApi.get_organization(org_id)
        return self._organizations[org_id]

    def user(self, user_id: str) -> Any:
        if user_id not in self._users:
            self._users[user_id] = UsersApi.get_user_by_id(user_id)
        return self._users[user_id]


def _decorate_market_summary(
    market: Dict[str, Any], user_role: Optional[str], lookups: _SummaryLookups
) -> Dict[str, Any]:
    """Add the read-time fields every market list entry carries.

    Kept in one place so a market exposes the same derived state - phase included -
    whether it was served by the list endpoint or by ``get_market_for_user``.
    """
    market['_id'] = str(market['_id'])
    market['user_role'] = user_role
    _stamp_effective_market_state(market, phase_from_market_document(market))
    organization_id = market_doc_field(market, 'organization_id')
    if organization_id:
        org = lookups.organization(organization_id)
        if org:
            market['organization_name'] = org.get('name')
    role_emails = {}
    for uid in (market_doc_field(market, 'roles') or {}).keys():
        u = lookups.user(uid)
        if u:
            role_emails[uid] = u.email
    market['role_emails'] = role_emails
    return market


def _summary_role(
    market: Dict[str, Any], user_id: str, lookups: _SummaryLookups
) -> Optional[str]:
    """The role a list entry names: the one ``get_user_market_role`` would serve on the market.

    Worked from the raw documents the list already holds, by the same two rules, so a card offers
    Manage to exactly the people the market's own page lets manage it: an organization's admins
    run its markets, and the list called them viewers.
    """
    explicit = (market_doc_field(market, 'roles') or {}).get(user_id)
    try:
        on_the_market = MarketRole(explicit) if explicit else None
    except ValueError:
        on_the_market = None
    organization_id = market_doc_field(market, 'organization_id')
    org = lookups.organization(organization_id) if organization_id else None
    through_organization = PermissionsApi.organization_market_role(
        user_id, org.get('owner'), org.get('admins') or [], org.get('members') or [],
    ) if org else None
    role = PermissionsApi.higher_role(on_the_market, through_organization)
    return role.value if role else explicit


def get_markets_for_user(user_email: str) -> List[Dict[str, Any]]:
    """
    Get all markets a user has access to (via explicit role or organization).
    Returns markets with user's effective role included.
    """
    user = UsersApi.get_user(user_email)
    if not user:
        return []
    user_id = user.id

    seen_ids = set()
    result = []

    user_orgs = OrgsApi.get_organizations_for_user(user_email)
    lookups = _SummaryLookups(user_orgs)

    # A role is a key of the market's roles map, so "has one" is that key existing - which the
    # wildcard index on the map serves (``lookup_indexes``). It was read by turning every market's
    # map into an array first, which no index can serve: every Markets page read every market.
    markets_with_role = markets_collection.find(
        {f"{market_doc_key('roles')}.{user_id}": {"$exists": True}}
    )

    for market in markets_with_role:
        mid = market["id"]
        if mid not in seen_ids:
            seen_ids.add(mid)
            result.append(_decorate_market_summary(
                market, _summary_role(market, user_id, lookups), lookups
            ))

    org_ids = [org['id'] for org in user_orgs]

    if org_ids:
        org_markets = markets_collection.find(
            market_doc_filter("organization_id", {"$in": org_ids})
        )
        for market in org_markets:
            mid = market["id"]
            if mid not in seen_ids:
                seen_ids.add(mid)
                result.append(_decorate_market_summary(
                    market, _summary_role(market, user_id, lookups), lookups
                ))

    return result

def _convert_roles_keys_to_user_ids(roles: Dict[str, str]) -> Dict[str, str]:
    """Convert roles dict keys from email to user_id where needed."""
    result = {}
    for key, role in roles.items():
        if "@" in key:
            user = UsersApi.get_user(key)
            if user:
                result[user.id] = role
            else:
                result[key] = role
        else:
            result[key] = role
    return result


def create_market(market: Market, owner_email: str) -> tuple:
    """Create a new market.

    A create body may carry an application form, so it passes through the same validation and
    normalization as ``save_application_form``: one contract for every writer of the form.
    """
    market_dict = market.model_dump()
    _strip_persisted_assignment_statistics(market_dict)
    market_dict["phase"] = MarketPhase.DRAFT.value
    market_dict["is_draft"] = True  # phase is always DRAFT at creation; kept in sync as the phase fallback
    # Server-owned, like the phase: whatever a create body carried is replaced by the one entry
    # every market starts with (E26/F06/S03).
    market_dict["phase_history"] = [
        PhaseRecord.phase_entry(MarketPhase.DRAFT.value, owner_email).model_dump()
    ]
    market_dict["application_form"] = (
        _normalized_application_form(market.application_form).model_dump()
        if market.application_form
        else None
    )
    roles = market_dict.get('roles', {})
    roles = _convert_roles_keys_to_user_ids(roles)
    market_dict["roles"] = roles
    
    owner_count = sum(1 for role in roles.values() if role == MarketRole.OWNER.value)
    if owner_count != 1:
        raise ValueError("Market must have exactly one owner in roles dict")
    
    market_id = str(uuid.uuid4())
    market_dict["id"] = market_id
    market_dict = convert_keys_to_camel_case(market_dict)
    
    refusal = public_address_refusal(market.name)
    if refusal:
        raise ValueError(refusal)
    
    try:
        result = markets_collection.insert_one(market_dict)
    except DuplicateKeyError as e:
        # Two creations passed the check above and raced; the unique `market_slug` index refused
        # the second. It is the same clash, so it reads the same (code review of E21).
        raise ValueError(_address_taken(market.name)) from e
    
    if market.organization_id:
        try:
            organizations_collection = db["organizations"]
            organizations_collection.update_one(
                {"id": market.organization_id},
                {"$addToSet": {"markets": market_id}}
            )
        except Exception as e:
            logger.warning(f"Failed to add market to organization: {e}")
    
    return result, market_id

def public_address_refusal(name: str, market_id: Optional[str] = None) -> Optional[str]:
    """Why no market may be called this, or None when it may (E21/F03/S03).

    The name decides the slug and the slug is the market's public address - its applicant links
    and its check-in page, served without authentication - so two markets answering one address
    could hand a stranger the wrong market. Asked by creation and by a rename alike, against every
    OTHER market; the unique ``market_slug`` index is the database's refusal of the same thing.

    A name with nothing sluggable in it has no public address, so it can only clash by name.
    """
    slug = market_name_slug(name or "")
    query: Dict[str, Any] = (
        market_doc_filter("slug", slug) if slug else market_doc_filter("name", name)
    )
    if market_id is not None:
        query.update(market_doc_filter("id", {"$ne": market_id}))
    if markets_collection.find_one(query, market_doc_projection(["id"])) is None:
        return None
    return _address_taken(name)


def _address_taken(name: str) -> str:
    """The refusal for a market whose address another market already answers."""
    slug = market_name_slug(name or "")
    if slug:
        return (
            f"Another market already uses the web address /{slug}. "
            "Choose a name that is different in more than accents or punctuation."
        )
    return "Another market already has this name."


def create_owned_market(owner: User, data: Dict[str, Any]) -> str:
    """Create a market from a snake_case body, owned by ``owner`` and nobody else. Returns its id.

    The one way a market is created: ``POST /markets`` and the test-market seeder
    (``seed_test_markets.py``) both come here. Whoever creates a market owns it, and only they do.
    The body's roles were taken on trust, so a client could create a market owned by another user
    or by an id that is nobody, which then sat in the organization with no one able to manage it
    (bug 46). Anyone else is added afterwards, through the endpoints that manage a market's people.

    Raises ValueError, in words for the organizer, when the market may not be made.
    """
    market = Market(**{**data, "roles": {owner.id: MarketRole.OWNER.value}})
    refusal = organization_refusal(owner.email, data.get("organization_id"))
    if refusal:
        raise ValueError(refusal)
    _result, market_id = create_market(market, owner.email)
    return market_id


def organization_refusal(user_email: str, organization_id: Optional[str]) -> Optional[str]:
    """Why this user's market may not belong to this organization, or None when it may.

    Asked by creation, the one door a market's organization passes through (E21/F03/S01, S05, S06:
    no write changes it afterwards). A market belongs to exactly one organization - its members see
    the market, and deleting the organization deletes it - so a market that names none, names one
    that does not exist, or names one its writer is not part of is a state the product refuses to
    produce.
    """
    if not organization_id:
        return "organization_id is required"
    organization = OrgsApi.get_organization(organization_id)
    if not organization:
        return "Organization not found"
    user = UsersApi.get_user(user_email)
    user_id = user.id if user else None
    if (
        user_id is None
        or user_id != organization.get("owner")
        and user_id not in organization.get("admins", [])
        and user_id not in organization.get("members", [])
    ):
        return "User is not a member of this organization"
    return None


def get_assigned_market(market_id: str, requesting_user: Optional[str] = None) -> tuple[Dict[str, Any], int]:
    """Get an assigned market. Requires VIEW permission."""
    context = load_market_context(market_id)
    if context is None:
        return {"error": "Market not found"}, 404

    if requesting_user:
        if context.market is None:
            return {"error": "Invalid market data"}, 400

        if not PermissionsApi.user_has_permission(requesting_user, context.market, MarketRole.VIEWER, context.organization):
            return {"error": "User does not have permission to view this market"}, 403

    market_dict = convert_keys_to_snake_case(context.document)

    # Fix missing assignment_options in setup_object
    if "setup_object" in market_dict and market_dict["setup_object"]:
        if "assignment_options" not in market_dict["setup_object"]:
            market_dict["setup_object"]["assignment_options"] = {
                "max_assignments_per_vendor": None,
                "max_half_table_proportion_per_section": None,
            }

    # Fix None assignment_object
    # temp reset
    # if "assignment_object" not in market_dict or market_dict["assignment_object"] is None:
    market_dict["assignment_object"] = {
        "vendor_assignments": [],
        "assignment_date": "",
        "assignment_statistics": None
    }

    # Convert dictionary to Market object
    market = market_from_document(context.document, market_dict)
    try:
        vendors = solver_vendors_for(market)
    except IncompleteApplicationsError as incomplete:
        # The organizer has to go and fix something, so say who.
        return {"error": incomplete.message()}, 400

    # Running the solver over nobody produced a screen that looked exactly like a
    # completed run - 0 assignments, 0/24 tables, 0/0 vendors - which reads as a market
    # that failed rather than one that was never asked anything. Refused HERE rather than
    # inside the solver, because the read-only views of an assignment (statistics, the
    # tables grid, the CSV) are right to show an empty market's empty picture; it is
    # *asking for an assignment* that has nothing to do.
    if not vendors:
        return {"error": NOTHING_TO_ASSIGN}, 400

    assigned_market = assign_market(market, vendors)
    assigned_market_dict = assigned_market.model_dump()

    assigned_market_dict = convert_keys_to_camel_case(assigned_market_dict)
    if context.organization_dict:
        assigned_market_dict['organizationName'] = context.organization_dict.get('name')
    return assigned_market_dict, 200


def get_assignment_statistics(market_id: str, requesting_user: Optional[str] = None) -> tuple[Dict[str, Any], int]:
    """Derive and return assignment statistics for a market."""
    context = load_market_context(market_id)
    if context is None:
        return {"error": "Market not found"}, 404
    if context.market is None:
        return {"error": "Invalid market data"}, 400

    market = context.market

    if requesting_user:
        if not PermissionsApi.user_has_permission(requesting_user, market, MarketRole.VIEWER, context.organization):
            return {"error": "User does not have permission to view this market"}, 403

    # Keep persisted schema free of assignment statistics, then derive fresh.
    market.assignment_object.assignment_statistics = None
    try:
        # The vendors are read once and handed to both: the solver places them, and the
        # reasons below are computed against the same set, so the two can never disagree
        # about who applied.
        vendors = solver_vendors_for(market)
        assigned_market = assignment_to_show(market, vendors)
    except IncompleteApplicationsError as incomplete:
        # The organizer has to go and fix something, so say who.
        return {"error": incomplete.message()}, 400
    stats = assigned_market.assignment_object.assignment_statistics
    if stats is None:
        return {"error": "Unable to derive assignment statistics"}, 500

    rows = derive_market_table_rows(assigned_market)
    stats.unassigned_tables = derive_unassigned_tables_from_rows(rows)

    payload = convert_keys_to_camel_case(stats.model_dump())
    # Why each vendor holds no table, computed from the plan, the applications and the
    # assignment as they stand (E12/F01/S01). Sent with the statistics that report the
    # unplaced, so the panel listing them can say why without a second request.
    placed_rows = assigned_market.assignment_object.vendor_assignments or []
    payload["unplacedDates"] = [
        {"email": entry.email, "date": entry.date, "reason": entry.reason.value}
        for entry in unplaced_dates(
            assigned_market.setup_object, vendors, placed_rows,
        )
    ]
    # A hand placement that contradicts what the vendor asked for stands - admins edit
    # without restriction - but it is never silent: tier sets the price, and someone will be
    # charged for a table they did not choose (E11/F02/S02). Computed on read beside the
    # reasons above, because "why is this vendor here" and "why is this vendor nowhere" are
    # one question asked twice.
    payload["overriddenPlacements"] = [
        {
            "email": entry.email,
            "date": entry.date,
            "tableCode": entry.table_code,
            "overrides": [override.value for override in entry.overrides],
        }
        for entry in overridden_placements(
            vendors, placed_rows,
            not_approved_vendors(market, {vendor.email for vendor in vendors}),
        )
    ]
    # Unassigned vendors are a list of bare addresses; this is what lets the payoff screen
    # name them. A vendor with no stored name has no entry and renders as they did before.
    payload["vendorNames"] = ApplicationsApi.vendor_names_for_market(market_id)
    return payload, 200


def get_placement_history(
    market_id: str, requesting_user: str, vendor: Optional[str] = None
) -> tuple[Dict[str, Any], int]:
    """This market's placement trail, newest first. Requires VIEW permission.

    Read at VIEWER, written at EDITOR: the trail describes the market, and anyone who may look at
    where vendors are sitting may look at how they came to be sitting there.
    """
    context = load_market_context(market_id)
    if context is None:
        return {"error": "Market not found"}, 404
    if context.market is None:
        return {"error": "Invalid market data"}, 400

    if not PermissionsApi.user_has_permission(
        requesting_user, context.market, MarketRole.VIEWER, context.organization
    ):
        return {"error": "User does not have permission to view this market"}, 403

    entries = PlacementHistory.entries_for_market(market_id, vendor)
    return {
        "entries": [convert_keys_to_camel_case(entry) for entry in entries],
        # Names against addresses, as every other vendor surface gets them, so the log reads as
        # people rather than as a column of email.
        "vendorNames": ApplicationsApi.vendor_names_for_market(market_id),
    }, 200


def _market_csv_filename(market_name: Optional[str], market_id: str) -> str:
    """Build a deterministic, filesystem-safe CSV filename for assignment downloads."""
    name = (market_name or market_id or "market").strip() or "market"
    safe = "".join(c if c.isalnum() or c in (" ", "-", "_") else " " for c in name)
    safe = "_".join(safe.split())
    return f"{safe}_assigned.csv"


def get_assignment_csv(market_id: str, requesting_user: Optional[str] = None) -> tuple[Dict[str, Any], int]:
    """Derive assignment CSV in-memory for download. Requires VIEW permission.

    Returns either ({"csv_content": str, "filename": str}, 200) on success or
    an error dict with the appropriate HTTP status code.
    """
    context = load_market_context(market_id)
    if context is None:
        return {"error": "Market not found"}, 404
    if context.market is None:
        return {"error": "Invalid market data"}, 400

    market = context.market

    if requesting_user:
        if not PermissionsApi.user_has_permission(requesting_user, market, MarketRole.VIEWER, context.organization):
            return {"error": "User does not have permission to view this market"}, 403

    if market.setup_object is None:
        return {"error": "Market has no setup configured"}, 400

    market.assignment_object.assignment_statistics = None
    try:
        vendors = solver_vendors_for(market)
        assigned_market = assignment_to_show(market, vendors)
    except IncompleteApplicationsError as incomplete:
        # The organizer has to go and fix something, so say who.
        return {"error": incomplete.message()}, 400
    assigned_market_dict = assigned_market.model_dump()

    csv_content = market_csv_to_string(
        assigned_market_dict, ApplicationsApi.vendor_names_for_market(market_id),
        ApplicationsApi.vendor_full_names_for_market(market_id),
        {vendor.email for vendor in not_approved_vendors(
            market, {vendor.email for vendor in vendors})},
    )

    filename = _market_csv_filename(context.document.get("name"), market_id)
    return {"csv_content": csv_content, "filename": filename, "market_id": market_id}, 200


def is_not_approved(application: Application) -> bool:
    """Whether the review left this applicant out (E36/F02/S02): any status but approved. A vendor
    added by hand is approved, and outside the run for another reason."""
    return application.status is not ApplicationStatus.REVIEWER_APPROVED


def not_approved_vendors(market: Market, in_the_run: Iterable[str]) -> List[SolverVendor]:
    """The applicants outside the run whom the review did not approve (E36/F02/S03): a seat given
    to one by hand is marked "not approved" wherever the other overrides show."""
    return [
        vendor
        for vendor, application in outside_solver_vendors(
            market.id, EssentialFields.effective_essential_options_for_market(market), in_the_run)
        if is_not_approved(application)
    ]


def _placeable(vendor: SolverVendor, outside: Optional[Application]) -> Dict[str, Any]:
    """One vendor the place dialog may offer: what they answered, whether the run reads them, and -
    for an applicant outside it - their status and who gave it, which the dialog's "Not approved"
    warning words, or that they were added by hand with nothing answered to check a seat against."""
    not_approved = None
    if outside is not None and is_not_approved(outside):
        not_approved = {
            "status": outside.status.value,
            "verdictBy": ApplicantsApi.giver_payload(outside.verdict_by),
            "verdictAt": outside.verdict_at,
            "verdictReason": outside.verdict_reason,
        }
    return {
        # Said, never inferred (E36/F02/S04): a vendor added by hand is approved and still outside
        # the run, and counting them in it made Vendors and Result disagree again (bug 10).
        "inTheRun": outside is None,
        "addedByHand": bool(outside is not None and outside.added_by),
        "email": vendor.email,
        "tableChoice": vendor.table_choice,
        "availableDates": sorted(vendor.available_dates),
        # And the two answers a hand change could override without a word (bugs 18 and 32): the
        # tiers they accept on each date - empty when never asked, which accepts any - and how
        # many dates they want, None for no personal limit.
        "acceptedTiersByDate": {
            date: sorted(tiers) for date, tiers in vendor.accepted_tiers_by_date.items()
        },
        "maxDates": vendor.max_dates,
        "notApproved": not_approved,
    }


def get_market_tables(market_id: str, requesting_user: Optional[str] = None) -> tuple[List[Dict[str, Any]] | Dict[str, Any], int]:
    """Derive and return table rows for a market."""
    context = load_market_context(market_id)
    if context is None:
        return {"error": "Market not found"}, 404
    if context.market is None:
        return {"error": "Invalid market data"}, 400

    market = context.market

    if requesting_user:
        if not PermissionsApi.user_has_permission(requesting_user, market, MarketRole.VIEWER, context.organization):
            return {"error": "User does not have permission to view this market"}, 403

    market.assignment_object.assignment_statistics = None
    try:
        vendors = solver_vendors_for(market)
    except IncompleteApplicationsError as incomplete:
        # The organizer has to go and fix something, so say who.
        return {"error": incomplete.message()}, 400

    # The STORED assignment, when the market has one. This is the screen an organizer edits
    # placements on, and `assignmentObject.vendorAssignments` is what check-in reads at the
    # door - a grid drawn from a fresh solver run would be a picture of what WOULD happen if
    # they pressed Assign, and every seat they moved a vendor into would be a seat they had
    # never actually seen. A market with nothing stored still shows the run it would get.
    assigned_market = assignment_to_show(market, vendors)

    rows = derive_market_table_rows(assigned_market)
    return {
        "rows": [convert_keys_to_camel_case(row.model_dump()) for row in rows],
        # Name against address, for the surfaces that only ever knew the address. Sent with
        # the rows rather than fetched separately so the grid and its occupants' names can
        # never be a request apart.
        "vendorNames": ApplicationsApi.vendor_names_for_market(market_id),
        # What the page's search finds each vendor by, beyond their address (E35/F02/S01).
        "vendorSearch": ApplicationsApi.vendor_search_terms_for_market(
            market_id,
            market.application_form.fields if market.application_form else [],
            {email for row in rows for email in row.assignment_slots if email},
        ),
        # Who may be put in a seat, and what they asked for. Sent with the grid because the
        # view has to warn - before the change, not after - when a placement would alter a
        # vendor's table choice away from their own answer (E11/F03/S01).
        # Every applicant, the ones outside the run with why (E36/F02/S02): an organizer may
        # seat anyone by hand, warned, and the run's own vendors come first.
        "vendors": [_placeable(vendor, None) for vendor in vendors] + [
            _placeable(vendor, application)
            for vendor, application in outside_solver_vendors(
                market_id,
                EssentialFields.effective_essential_options_for_market(market),
                {vendor.email for vendor in vendors},
            )
        ],
    }, 200


def finalization_update(
    from_phase: str, to_phase: str, document: Dict[str, Any]
) -> Dict[str, Any]:
    """The `$set` entries that record whether this market's form is finalized (E18/F03/S01).

    **Leaving draft IS finalizing.** There is no separate act for an organizer to discover, and no
    new guard: ``FormHasFieldsGuard`` already counts PLAN-DERIVED asked keys, so a market whose plan
    offers nothing - and whose form therefore asks nothing - is already refused. Only the stamp was
    missing.

    Returning to draft, which stays legal only while no application exists, clears it. So the field
    answers exactly one question: is this form finalized right now?

    **It is not a restatement of ``phase != draft``**, because ``draft -> archived`` also exists -
    abandoning a draft - and does NOT stamp. A market archived straight from draft never opened its
    form to anybody, and the two fields therefore say different things: ``phase`` is where the
    market is now, this is whether the form is opened to applicants.

    If that edge is ever retired, this field becomes derivable and should be DELETED rather than
    maintained. Left here so that is a decision next time and not an archaeology problem.

    A market may reach ``applications_open`` with no stored form at all: a form is its custom fields
    PLUS the essential questions the plan asks, and either half alone is a form. Such a market is
    still finalized, so it gets one with no custom fields rather than no stamp.
    """
    form_key = market_doc_key("application_form")
    stored_form = document.get(form_key)

    if from_phase == MarketPhase.DRAFT.value and to_phase == MarketPhase.APPLICATIONS_OPEN.value:
        stamp = datetime.now(timezone.utc).isoformat()
        published_key = market_doc_key("published_at")
        if isinstance(stored_form, dict):
            return {f"{form_key}.{published_key}": stamp}
        return {form_key: {"fields": [], published_key: stamp}}

    if to_phase == MarketPhase.DRAFT.value:
        if isinstance(stored_form, dict):
            return {f"{form_key}.{market_doc_key('published_at')}": None}
        return {}

    return {}


class PhaseChangedUnderRequest(Exception):
    """The market's stored phase was not what this write expected.

    Carries the phase it actually holds, so a caller can say so rather than retrying blindly.
    """

    def __init__(self, actual_phase: str):
        self.actual_phase = actual_phase
        super().__init__(f"Market is in '{actual_phase}'")


def apply_phase_transition(
    market_id: str, document: Dict[str, Any], to_phase: str, by: Optional[str] = None,
) -> None:
    """Write one phase change, conditional on the market still being where the caller thinks.

    The ONE writer of a market's phase: the transition endpoint and the form-amendment chain
    (E20/F03/S01) both move a market through it. A second copy is how the `isDraft` stamp and the
    finalization stamp come to disagree with `phase` - and how a move goes unrecorded.

    ONE atomic update, and one conditional on the stored phase: a failure between the phase and
    the stamp would leave a market whose two answers disagree, which is the class of bug
    `migrate_is_draft_consistency` exists to repair, and a lost update would move a market a
    concurrent request had already moved. The same update records the phase entered, and who
    moved it there, in the market's phase history (E26/F06/S03).

    Raises:
        PhaseChangedUnderRequest: the stored phase moved under this request.
        MarketNotFoundError: the market is gone.
    """
    phase_key = market_doc_key("phase")
    is_draft_key = market_doc_key("is_draft")
    from_phase = phase_from_market_document(document).value
    stored_phase = document[phase_key] if phase_key in document else {"$exists": False}

    result = markets_collection.update_one(
        {"id": market_id, phase_key: stored_phase},
        {
            "$set": {
                phase_key: to_phase,
                is_draft_key: to_phase == MarketPhase.DRAFT.value,
                **finalization_update(from_phase, to_phase, document),
            },
            "$push": PhaseRecord.push_entries(document, to_phase, by),
        },
    )

    if result.matched_count:
        return

    latest = markets_collection.find_one({"id": market_id})
    if latest is None:
        raise MarketNotFoundError("Market not found")
    raise PhaseChangedUnderRequest(phase_from_market_document(latest).value)


def walk_route(market_id: str, document: Dict[str, Any], route: List[str], by: Optional[str] = None) -> None:
    """Take a move's steps in order through the one phase writer, each recorded as the phase it
    entered (E32/F02/S01). The first step is conditional on the document the caller loaded; each
    later one re-reads it, because the phase history is pushed from the document, and is taken only
    if the market still stands where the step before left it - a request that moved it in between
    stops the walk there rather than being carried over.

    Raises what ``apply_phase_transition`` raises, at the step where it happened.
    """
    for index, target in enumerate(route):
        if index:
            document = markets_collection.find_one({"id": market_id})
            if document is None:
                raise MarketNotFoundError("Market not found")
            standing = phase_from_market_document(document).value
            if standing != route[index - 1]:
                raise PhaseChangedUnderRequest(standing)
        apply_phase_transition(market_id, document, target, by=by)


class MoveUnavailable(ValueError):
    """The move is not open from the phase the market stands in. Callers map this to HTTP 400."""


def take_move(context: MarketContext, to_phase: str, by: Optional[str] = None) -> List[PreconditionResult]:
    """Judge a move and, when nothing blocks it, take it. Returns its blockers; none means taken.

    The one way a market is moved: the transition endpoint and the operator's seeder
    (``seed_test_markets.py``) both come here, so neither can take a move unjudged. A move on the
    market's path may step through a phase it does not stop in, every step's guards judged before
    the first is taken (E32/F02/S01). Who may move it is the caller's to ask first.

    Raises ``MoveUnavailable``, and what ``walk_route`` raises.
    """
    market = context.market
    market_id = context.document["id"]
    from_phase = market.phase.value
    route = move_route(market, to_phase)
    if route is None:
        raise MoveUnavailable(
            f"Transition from '{from_phase}' to '{to_phase}' is not available in the current phase."
        )
    blockers = evaluate_transition(market, to_phase, db)
    if blockers:
        return blockers
    # Through the one phase writer, so the phase, its two stamps and the phase history move in one
    # atomic update a step (E26/F06/S03); a route of two steps is two such updates.
    walk_route(market_id, context.document, route, by=by)

    # Only after the phase is written.
    if from_phase == MarketPhase.OFFERS.value and to_phase == MarketPhase.MARKET_DAYS.value:
        try:
            swept = ApplicationsApi.sweep_unanswered_offers(market_id)
            logger.info(
                "Swept %d assignment_sent applications to vendor_refused for market %s",
                swept,
                market_id,
            )
        except Exception:
            logger.error(
                "Phase advanced to market_days for market %s but the "
                "assignment_sent -> vendor_refused sweep failed",
                market_id,
                exc_info=True,
            )
    return []


def add_market_role(market_id: str, user_email: str, role: MarketRole, requesting_user: str) -> bool:
    """Add a user role to a market. Requires permission to manage roles."""
    context = load_market_context(market_id)
    if context is None:
        raise ValueError("Market not found")
    if context.market is None:
        raise ValueError("Invalid market data")

    market_dict = context.document
    market = context.market

    if not PermissionsApi.can_manage_roles(requesting_user, market, role, context.organization):
        raise PermissionError("User does not have permission to manage this role")

    if role == MarketRole.OWNER:
        current_roles = market_dict.get('roles', {})
        for uid, existing_role in current_roles.items():
            if existing_role == MarketRole.OWNER.value:
                raise ValueError("Market already has an owner. Transfer ownership first.")
    
    user = UsersApi.get_user(user_email)
    if not user:
        raise ValueError("User not found")

    roles = market_dict.get('roles', {})
    # Adding never changes a role: overwriting one here would skip update_market_role's guards and
    # let an Admin demote the Owner.
    if user.id in roles:
        raise ValueError(
            f"{user.email} already has a role on this market. Change it in their row under Users with access."
        )
    roles[user.id] = role.value
    
    result = markets_collection.update_one(
        {"id": market_id},
        {"$set": {"roles": roles}}
    )
    
    return result.modified_count > 0


def remove_market_role(market_id: str, user_id: str, requesting_user: str) -> bool:
    """Remove a user role from a market. Requires permission to manage roles."""
    context = load_market_context(market_id)
    if context is None:
        raise ValueError("Market not found")
    if context.market is None:
        raise ValueError("Invalid market data")

    market_dict = context.document
    market = context.market
    organization = context.organization

    roles = market_dict.get('roles', {})
    if user_id not in roles:
        raise ValueError("User does not have a role in this market")
    
    if roles.get(user_id) == MarketRole.OWNER.value:
        # Count how many owners there are
        owner_count = sum(1 for r in roles.values() if r == MarketRole.OWNER.value)
        if owner_count <= 1:
            raise ValueError("Cannot remove the only owner. Transfer ownership first.")
    
    user_role_value = roles.get(user_id)
    if user_role_value:
        try:
            user_role = MarketRole(user_role_value)
        except ValueError:
            user_role = MarketRole.VIEWER
        if not PermissionsApi.can_manage_roles(requesting_user, market, user_role, organization):
            raise PermissionError("User does not have permission to remove this role")
    
    del roles[user_id]
    
    result = markets_collection.update_one(
        {"id": market_id},
        {"$set": {"roles": roles}}
    )
    
    return result.modified_count > 0


def update_market_role(market_id: str, user_id: str, new_role: MarketRole, requesting_user: str) -> bool:
    """Update a user's role in a market. Requires permission to manage roles."""
    context = load_market_context(market_id)
    if context is None:
        raise ValueError("Market not found")
    if context.market is None:
        raise ValueError("Invalid market data")

    market_dict = context.document
    market = context.market
    organization = context.organization

    roles = market_dict.get('roles', {})
    current_role_value = roles.get(user_id)
    if not current_role_value:
        raise ValueError("User does not have a role in this market")

    try:
        current_role = MarketRole(current_role_value)
    except ValueError:
        current_role = MarketRole.VIEWER  # Default if invalid

    # Owners cannot have their role changed
    if current_role == MarketRole.OWNER:
        raise PermissionError("Cannot change owner's role")

    # Admins can only be changed by owners
    if current_role == MarketRole.ADMIN:
        requesting_role = PermissionsApi.get_user_market_role(requesting_user, market, organization)
        if requesting_role != MarketRole.OWNER:
            raise PermissionError("Only owners can change admin roles")

    # Check requesting user can manage this role
    if not PermissionsApi.can_manage_roles(requesting_user, market, new_role, organization):
        raise PermissionError("User does not have permission to manage this role")
    
    if new_role == MarketRole.OWNER:
        for uid, existing_role in roles.items():
            if uid != user_id and existing_role == MarketRole.OWNER.value:
                raise ValueError("Market already has an owner. Transfer ownership first.")
    
    roles[user_id] = new_role.value
    
    result = markets_collection.update_one(
        {"id": market_id},
        {"$set": {"roles": roles}}
    )
    
    return result.modified_count > 0


def delete_market(market_id: str, requesting_user: str) -> DeleteResult:
    """Delete a market. Only owner can delete."""
    context = load_market_context(market_id)
    if context is None:
        raise ValueError("Market not found")
    if context.market is None:
        raise ValueError("Invalid market data")

    market = context.market

    user_role = PermissionsApi.get_user_market_role(requesting_user, market, context.organization)
    if user_role != MarketRole.OWNER:
        raise PermissionError("Only the market owner can delete this market")

    if market.organization_id:
        try:
            organizations_collection = db["organizations"]
            organizations_collection.update_one(
                {"id": market.organization_id},
                {"$pull": {"markets": market_id}}
            )
        except Exception as e:
            logger.warning(f"Failed to remove market from organization: {e}")

    # Its applications, check-ins, sign-in codes and placement trail go with it (bug 47): each
    # names people, and leaving them behind would outlive the thing they describe.
    return MarketDeletion.delete_market_and_records(markets_collection, market_id)


RENAME_REFUSED_AFTER_DRAFT = (
    "This market's public web address comes from its name, and it has already been shared - "
    "on its application link or its check-in page - so its name can no longer change."
)


def rename_market(market_id: str, name: str, requesting_user: str) -> None:
    """Rename a market, only while it is a draft (E21/F03/S04).

    The name decides the slug and the slug is the public address, so after draft a rename would move
    an address that has already been handed out; it is refused with that reason instead. Decoupling
    the slug from the name was considered and held back (the-market-frame ticket 04): it would add a
    second stored identity to every public lookup for a need nobody has yet.

    Its own write - the whole-market PUT that used to carry it is gone - carrying only the name, and
    held to the same public-address rule as creation. Requires EDITOR, as renaming always has.
    """
    name = (name or "").strip()
    if not name:
        raise ValueError("A market needs a name.")

    market = _load_market_to_change(market_id, requesting_user, MarketRole.EDITOR, "rename")
    if market.phase is not MarketPhase.DRAFT:
        raise ValueError(RENAME_REFUSED_AFTER_DRAFT)
    if name == market.name:
        return

    refusal = public_address_refusal(name, market_id)
    if refusal:
        raise ValueError(refusal)

    try:
        markets_collection.update_one(
            market_doc_filter("id", market_id),
            {"$set": {market_doc_key("name"): name, market_doc_key("slug"): market_name_slug(name)}},
        )
    except DuplicateKeyError as e:
        # A rename that raced another write to the same address, refused by the unique index.
        raise ValueError(_address_taken(name)) from e


PLAN_WRITE_FIELDS = ("setupObject", "intakeMode")


def save_plan(market_id: str, body: Dict[str, Any], requesting_user: str) -> None:
    """Write the market plan and, while the market is a draft, how vendors reach it (E21/F03/S02).

    The plan's own write. It used to travel inside a PUT of the whole market, which stored the
    client's entire copy and stayed safe only by re-applying every field the server owns - added
    one "a stale copy overwrote X" bug at a time. This carries the plan and the intake mode and
    refuses anything else by name, rather than quietly re-applying over it.

    The intake mode is fixed once the market leaves draft - switching it mid-lifecycle strands what
    the previous mode produced, as flipping a form market to CSV after people applied would; a body
    that merely restates the stored mode is not a change, because the plan saves itself in every
    phase and says which mode it holds. The assignment rules close the same way once the market can
    no longer run its assignment (``assignment_rules_lock_reason``), and restating them is likewise
    not a change. Requires EDITOR, the bar every market write has.
    """
    extra = sorted(set(body) - set(PLAN_WRITE_FIELDS))
    if extra:
        raise ValueError(f"The plan write carries only the plan; it does not accept {', '.join(extra)}.")
    if "setupObject" not in body:
        raise ValueError("setupObject is required.")

    market = _load_market_to_change(market_id, requesting_user, MarketRole.EDITOR, "edit")
    markets_collection.update_one(market_doc_filter("id", market_id),
                                  {"$set": prepared_plan(market, body)})


def prepared_plan(market: Market, body: Dict[str, Any]) -> Dict[str, Any]:
    """The plan write's ``$set``, judged against ``market`` and not yet written.

    The one statement of what a plan write may carry and when; ``save_plan`` writes it, and the
    CSV start writes it in the same update as the form and the mapping it makes.
    """
    try:
        plan = SetupObject(**convert_keys_to_snake_case(body["setupObject"]))
    except ValidationError as e:
        raise ValueError(f"Invalid plan: {e}") from e
    share = plan.assignment_options.max_half_table_proportion_per_section
    if share is not None and not 0 <= share <= 100:
        raise ValueError(
            "max_half_table_proportion_per_section must be between 0 and 100, or null for the "
            "default."
        )
    update: Dict[str, Any] = {market_doc_key("setup_object"): convert_keys_to_camel_case(plan.model_dump())}

    if body.get("intakeMode") is not None:
        try:
            intake = IntakeMode(body["intakeMode"])
        except ValueError as e:
            raise ValueError(f"Unknown intake mode: {body['intakeMode']!r}.") from e
        if intake is not market.intake_mode:
            if market.phase is not MarketPhase.DRAFT:
                raise ValueError(
                    "How vendors reach a market can only be changed while it is a draft."
                )
            update[market_doc_key("intake_mode")] = intake.value

    # And the setup the same way, from leaving draft on (E31/F01/S02): restating it is not a change.
    setup_settled = setup_lock_reason(market)
    if setup_settled and setup_part(plan) != setup_part(market.setup_object):
        raise ValueError(setup_settled)

    # The plan saves as the organizer types, in every phase, and always carries the rules it holds;
    # restating the stored rules is not a change, and anything else is refused once they are
    # settled (E22/F02/S01).
    settled = assignment_rules_lock_reason(market)
    if settled and assignment_rules(plan) != assignment_rules(market.setup_object):
        raise ValueError(settled)
    return update


def save_review_highlights(
    market_id: str, keys: List[str], requesting_user: str
) -> List[str]:
    """Set which answers a reviewer reads first. Requires EDIT permission.

    The list IS the order the card leads with, so a repeat is dropped where it recurs rather than
    resorting what an organizer arranged. An empty list clears them, and clearing is a write of
    ``[]`` rather than a delete: absent and empty both mean "nothing is marked", and one shape for
    that keeps the card from having to tell them apart.

    Deliberately NOT gated on ``application_form_lock_reason``. That lock freezes the form the
    moment an applicant submits - which is the moment these first become knowable, because an
    organizer learns which answers they needed by reading real applications. A highlight that
    inherited the form's lock would be settable only before anyone could know what to set.
    """
    _load_market_to_change(market_id, requesting_user, MarketRole.EDITOR, "edit")

    seen: List[str] = []
    for key in keys:
        cleaned = key.strip()
        if cleaned and cleaned not in seen:
            seen.append(cleaned)

    markets_collection.update_one({"id": market_id}, market_doc_set("review_highlights", seen))
    return seen


def follow_up_owner(
    market: Market, organization: Optional[Organization], requester: MarketPerson,
    email: Optional[str],
) -> MarketPerson:
    """The person with this address, if the requester may hand them a follow-up (E34/F02/S01).

    A follow-up is owned by someone who can see the market to work on it: anyone the role rule
    gives a role, named in its roles or reached through its organization (T15), as far as the
    requester is offered them (``follow_up_owners_for``). Asked of the same list the market read
    serves this requester as ``peopleOnMarket``, so the server takes exactly whom the dialog offers.
    Raises ``ValueError`` with the refusal's words otherwise; to someone outside the organization
    they never tell an organization address from a stranger's.
    """
    offered = PermissionsApi.follow_up_owners_for(market, organization, requester.user_id)
    user = UsersApi.get_user(email) if email else None
    if user is not None and user.id in offered:
        return MarketPerson(user_id=user.id, email=user.email)
    if market.organization_id and not PermissionsApi.in_market_organization(
            market, organization, requester.user_id):
        raise ValueError("You can hand a follow-up only to someone named in this market's roles.")
    raise ValueError("A follow-up's owner must have a role on this market.")


def save_rejection_rules(
    market_id: str, rules: Any, requesting_user: str
) -> List[Dict[str, Any]]:
    """Set which answers reject an application automatically (E33/F03/S01). Requires EDITOR.

    The rules' own write, the whole list at once like the highlights. Not gated on the form's lock:
    rules are worth most once applications arrive, which is when the form freezes. Refused once the
    market can no longer return to review (``rejection_rules_lock_reason``).
    """
    market = _load_market_to_change(market_id, requesting_user, MarketRole.EDITOR, "edit")
    settled = rejection_rules_lock_reason(market.phase)
    if settled:
        raise ValueError(settled)
    prepared = RejectionRules.Rulebook(market).prepared(rules)
    markets_collection.update_one({"id": market_id}, market_doc_set("rejection_rules", prepared))
    # Every undecided application, and every one a rule rejected, is judged again (E33/F03/S02).
    judged = market.model_copy(update={"rejection_rules": [RejectionRule(**r) for r in prepared]})
    RejectionRules.judge(RejectionRules.Rulebook(judged), market_id)
    return prepared


def save_application_form(market_id: str, application_form_data: dict, requesting_user: str) -> dict:
    """Save or update the application form for a market.

    The only writer of ``Market.application_form`` on an existing market - the whole-market PUT
    that once carried one is gone (E21/F03/S06) - so every write passes the lock below.

    Returns the saved ``ApplicationForm`` as a camelCase dict on success.

    Raises:
        MarketNotFoundError: no such market
        ValueError: validation failure
        PermissionError: user lacks EDITOR+ permission
        ApplicationFormLockedError: phase gate or D9 lock prevents editing
    """
    market = _load_market_to_change(market_id, requesting_user, MarketRole.EDITOR, "edit")
    form_dict = prepared_application_form(market, application_form_data)
    markets_collection.update_one(
        {"id": market_id},
        {"$set": {"applicationForm": form_dict}}
    )
    # The rules stand against the form as it now is (E33/F03/S02): a question taken away judges
    # nobody, and what it rejected is judged again.
    rewritten = load_market_context(market_id)
    if rewritten is not None and rewritten.market is not None:
        RejectionRules.judge(RejectionRules.Rulebook(rewritten.market), market_id)

    return form_dict


def prepared_application_form(market: Market, application_form_data: dict) -> dict:
    """The form as it would be stored, judged against ``market`` - its lock, its validator - and
    not yet written.

    The one statement of what a form write may be; ``save_application_form`` writes it, and the
    CSV start writes it in the same update as the plan and the mapping it makes.
    """
    _assert_application_form_editable(market)

    try:
        application_form = ApplicationForm(**application_form_data)
    except Exception as e:
        raise ValueError(f"Invalid application form data: {e}")

    stored_form = market.application_form
    application_form = _normalized_application_form(
        application_form,
        published_at=stored_form.published_at if stored_form else None,
        essential_options=stored_form.essential_options if stored_form else None,
    )
    return convert_keys_to_camel_case(application_form.model_dump())


def get_application_form(market_id: str, requesting_user: str) -> dict:
    """Retrieve the application form for a market along with its lock state.

    Requires VIEWER+ permission. ``application_form`` is camelCase, matching the
    front-end contract and the persisted market document. ``editable``/``lock_reason``
    let the builder render read-only before an organizer invests work in a locked form.

    ``essential_options`` is what the essential questions currently offer: the frozen
    snapshot once one exists, otherwise the market plan as it stands. The builder renders
    the always-present essential questions from it.
    """
    market = _load_market_for(market_id, requesting_user, MarketRole.VIEWER, "view")

    lock_reason = application_form_lock_reason(market)
    form_dict = _application_form_dump(market)

    return {
        "application_form": convert_keys_to_camel_case(form_dict) if form_dict else None,
        "essential_options": EssentialFields.essential_options_payload(
            EssentialFields.effective_essential_options_for_market(market)
        ),
        "editable": lock_reason is None,
        "lock_reason": lock_reason,
    }


def get_vendor_notes(market_id: str, requesting_user: str) -> Dict[str, Dict[str, Any]]:
    """Both kinds of note on this market's vendors, by address (E31/F04). Requires VIEWER:
    everyone with a role reads them; the vendor, who has none, never does.

    Each vendor's own request is joined in from their application, so every page that shows a
    vendor - review, Vendors, the door - reads both kinds from one place, each under its own key.
    """
    _load_market_for(market_id, requesting_user, MarketRole.VIEWER, "view")
    notes = VendorNotes.notes_for_market(market_id)
    for application in ApplicationsApi.list_applications_for_market(market_id):
        request = str((application.get("form_data") or {}).get(EssentialFields.REQUEST_KEY) or "")
        email = str(application.get("applicant_email") or "").strip().lower()
        if request.strip() and email:
            notes.setdefault(email, VendorNotes.no_notes())["request"] = request.strip()
    for entry in notes.values():
        entry.setdefault("request", "")
    return notes


def save_vendor_note(market_id: str, vendor_email: str, text: str, requesting_user: str) -> None:
    """Replace the organizer's note on one vendor. Requires EDITOR, the bar every market write has,
    which a door volunteer recording "chair given" meets; an archived market refuses it."""
    _load_market_to_change(market_id, requesting_user, MarketRole.EDITOR, "edit")
    VendorNotes.write_note(market_id, vendor_email, text, requesting_user)


def mark_vendor_request_handled(
    market_id: str, vendor_email: str, handled: bool, requesting_user: str,
) -> None:
    """Mark a vendor's request handled, or take the mark back. Requires EDITOR."""
    _load_market_to_change(market_id, requesting_user, MarketRole.EDITOR, "edit")
    VendorNotes.mark_request_handled(market_id, vendor_email, handled, requesting_user)
