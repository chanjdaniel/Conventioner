from datetime import datetime, timezone
import uuid
from typing import Any, Callable, Dict, Iterable, List, Mapping, NamedTuple, Optional, Tuple
from pymongo.errors import DuplicateKeyError
from pymongo.results import DeleteResult
from pydantic import ValidationError
from client_errors import (
    BadRequestError,
    ConflictError,
    ForbiddenError,
    NotFoundError,
    field_named_copy,
    parse_failure_detail,
)
from datatypes import (
    FORM_FIELD_KEY_PATTERN,
    Application,
    ApplicationForm,
    ApplicationStatus,
    AssignmentStatistics,
    EssentialFormOptions,
    FormField,
    IntakeMode,
    Market,
    MarketPermission,
    MarketPerson,
    MarketPhase,
    MarketRole,
    MarketTableRow,
    Organization,
    RejectionRule,
    SetupObject,
    UnassignedTableEntry,
    User,
    VendorAssignmentResult,
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
    vendors_to_show,
)
from assignment.vendor_input import SolverVendor, outside_solver_vendors
from assignment.utils import convert_keys_to_snake_case, convert_keys_to_camel_case
import api.applications as ApplicationsApi
import api.applicants as ApplicantsApi
import result_outcome as ResultOutcome
import csv_import as CsvImport
import csv_proposal as CsvProposal
import discord_client as DiscordClient
import essential_fields as EssentialFields
from market_documents import (
    market_doc_field,
    market_doc_projection,
    market_doc_filter,
    market_doc_key,
    market_doc_set,
    market_from_document,
)
import api.market_actions as Actions
import api.permissions as PermissionsApi
import market_deletion as MarketDeletion
import history as History
import pricing as Pricing
import phase_record as PhaseRecord
import api.attendance as AttendanceApi
import api.organizations as OrgsApi
import api.users as UsersApi
import rejection_rules as RejectionRules
import review_team as ReviewTeam
import logging
from assignment.csv_output import market_csv_to_string
from guards import (
    VALID_TRANSITIONS,
    PreconditionResult,
    evaluate_transition,
    route_between,
    transition_verdicts,
)
import vendor_notes as VendorNotes
from assignment.made_from import assignment_rules, changed_since_run
from placement_reasons import orphaned_pins, overridden_placements, unplaced_dates
from db_config import get_database
from utils.email_address import normalized_email

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

db = get_database()
markets_collection = db["markets"]

VALID_FORM_FIELD_TYPES = {"text", "number", "select", "multi_select", "checkbox", "date", "email"}



class MarketNotFoundError(NotFoundError):
    """No market exists with the requested id: a 404."""


class ApplicationFormLockedError(ConflictError):
    """The application form may no longer be edited: a 409.

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
        logger.warning(
            "Stored organization %s failed validation: %s", organization_id, parse_failure_detail(e),
        )
        return None, org_dict


def _load_organization(organization_id: Optional[str]) -> Optional[Organization]:
    """Resolve a market's organization, or None when absent or unparseable."""
    organization, _ = _load_organization_context(organization_id)
    return organization


def _load_market_for(market_id: str, requesting_user: str, action: Actions.Action) -> Market:
    """Load a market and assert the requesting user may take ``action`` on it (E39/F01/S01)."""
    market_dict = markets_collection.find_one({"id": market_id})
    if not market_dict:
        raise MarketNotFoundError("Market not found")

    try:
        market = market_from_document(market_dict)
    except Exception as e:
        _log_unreadable_market(market_id, e)
        raise BadRequestError("Invalid market data") from e

    organization = _load_organization(market.organization_id)
    refused = Actions.refusal(action, requesting_user, market, organization)
    if refused:
        raise ForbiddenError(refused)

    return market


ARCHIVED_REFUSAL = (
    "This market is archived. An archived market is the record of what happened, "
    "so nothing in it can be changed."
)


class MarketArchivedError(ForbiddenError):
    """A write to an archived market (bug 30, E26/F06/S01).

    Forbidden, because that is what it is - nobody, whatever their role, may change a market's
    record - and so a 403 carrying its words wherever it is raised. A refusal that needed a new
    branch in each route would be one forgotten branch from a 500.
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

#: The rows an archived market still takes: reading it, and the decisions about its record - who
#: may see it and whether to keep it - which are not changes to it (bug 30). Every other row is
#: refused on an archived market whoever may, a row added later included.
ARCHIVED_STILL_TAKES = frozenset({
    Actions.READ, Actions.READ_HISTORY, Actions.EXPORT_CSV, Actions.MANAGE_EDITORS_AND_VIEWERS,
    Actions.MANAGE_ADMINS, Actions.DELETE_MARKET,
})

#: The rows that read the market rather than change it.
READING_ROWS = frozenset({Actions.READ, Actions.READ_HISTORY, Actions.EXPORT_CSV})


def _answers(
    phase: MarketPhase, refused: Callable[[Actions.Action], Optional[str]],
) -> Dict[str, Optional[str]]:
    """Every row's answer, by id: None where the person may take it, else why not - the archived
    rule first, as the screens always said it, then the row's own sentence."""
    archived = ARCHIVED_REFUSAL if phase is MarketPhase.ARCHIVED else None
    return {
        row.id: (None if row in ARCHIVED_STILL_TAKES else archived) or refused(row)
        for row in Actions.ACTIONS.values()
    }


def role_action_refusals(
    role: Optional[MarketRole], phase: MarketPhase, rows: Mapping[str, Any],
) -> Dict[str, Optional[str]]:
    """What a person holding ``role`` is told of every action on a market in ``phase`` holding
    ``rows`` of the table, by row id (E39/F01/S02, S03).

    Each row is asked by ``Actions.role_refusal`` of the role already resolved, the ranking the
    writes' ``Actions.refusal`` asks after resolving it: the market read resolves it once, and the
    markets list from the documents it holds. Served as ``actionRefusals``, so every screen offers
    a control on the answer of the action it takes. The rules of a market's life other than the
    archived one are each served on their own.
    """
    return _answers(phase, lambda row: Actions.role_refusal(row, role, rows))


def deprecated_screen_reasons(
    refusals: Dict[str, Optional[str]], verdicts_settled: Optional[str],
    adding_vendors: Optional[str], publish_waits: Optional[str],
) -> Dict[str, Optional[str]]:
    """Deprecated: the reasons the screens read before each asked its row (E39/F01/S02), each now
    its row's answer and the rule of the market's life it carried.

    The back end deploys before the front end, and a tab keeps its bundle until it reloads; an old
    bundle reads a missing reason as "allowed" and offers what the server refuses. Served for one
    more release so it keeps refusing; the next release removes them, and the read's ``user_role``.
    """
    return {
        # The old bundle says these words only on the import screens, and asks the rest only
        # whether it is null: the import row's answer is the move row's yes and no in its words.
        'adminActionsReason': refusals[Actions.IMPORT_APPLICATIONS.id],
        'verdictLockReason': refusals[Actions.GIVE_VERDICTS.id] or verdicts_settled,
        'addVendorReason': refusals[Actions.ADD_VENDOR.id] or adding_vendors,
        'publishResultsReason': refusals[Actions.PUBLISH_RESULTS.id] or publish_waits,
    }


def read_only_reason(market: Market, refusals: Dict[str, Optional[str]]) -> Optional[str]:
    """Why this person may change nothing on this market, or None while they may change something
    (E26/F08/S01, E39/F01/S02): the archived rule, then whether any of the table's changing rows
    is theirs. Served as ``readOnlyReason``, which the frame says once for every page (T15)."""
    archived = archived_refusal(market)
    if archived:
        return archived
    if any(
        refusals[row.id] is None
        for row in Actions.ACTIONS.values() if row not in READING_ROWS
    ):
        return None
    return VIEWER_REFUSAL


VERDICTS_SETTLED = (
    "The review is closed: the verdicts settled when this market entered Assignment. To assign "
    "someone or free a seat, change the assignment on the Assignments page."
)


def review_is_open(phase: MarketPhase) -> bool:
    """Whether this market can still get back to the stage where applications are reviewed, the one
    rule both the verdicts and the automatic rejections settle on (E36/F01/S01). A rule and a
    reviewer judge the same applications, so they close together; derived from the transition table
    rather than listed."""
    return route_between(phase.value, MarketPhase.APPLICATIONS.value) is not None


def verdict_refusal(
    user_email: str, market: Market, organization: Optional[Organization],
) -> Optional[str]:
    """Why this person cannot give a verdict here, or None while they can (E34).

    A verdict - and a follow-up, a claim on a card - is the table's "Give verdicts and follow-ups"
    row (E34/F01/S01, E39/F01/S01), and open while the review is (E36/F01/S01): from assignment on,
    a verdict is the review's record, and a mistake is fixed with a seat placed or freed by hand.
    The screens read its parts from the market read: the row in ``actionRefusals`` and the review's
    close as ``verdictsSettledReason``.
    """
    refused = archived_refusal(market) or Actions.refusal(
        Actions.GIVE_VERDICTS, user_email, market, organization)
    if refused:
        return refused
    if not review_is_open(market.phase):
        return VERDICTS_SETTLED
    return None


def may_overturn(user_email: str, market: Market) -> bool:
    """Whether this person may overturn an automatic rejection here: the table's change row
    (E38/F06/S01). A write of theirs that judges the rules again returns a rule's rejection no rule
    meets any longer to open only when they may; for anyone else it stands."""
    return Actions.may(
        Actions.CHANGE_VERDICTS, user_email, market, _load_organization(market.organization_id))


#: The phases a vendor who never applied is added in (E36/F03/S01): once the review has closed and
#: seats are being given.
ADDING_PHASES = (MarketPhase.ASSIGNMENT, MarketPhase.MARKET_DAYS)

NOT_YET_ADDING = (
    "A vendor is added by hand from Assignment on. Until then, vendors reach this market "
    "through its applications."
)


def adding_refusal(phase: MarketPhase) -> Optional[str]:
    """Why no vendor may be added in this phase, or None (E36/F03/S01): the write's rule."""
    return None if phase in ADDING_PHASES else NOT_YET_ADDING


def _load_market_to_change(
    market_id: str, requesting_user: str, action: Actions.Action,
) -> Market:
    """``_load_market_for``, for a write: an archived market is refused whoever is asking.

    Every write that loads its market here meets the archived rule without saying so, so a new
    write that loads through this cannot forget it. Roles and deletion do not come through here:
    who may see a record, and whether to keep it, are decisions about the record, not changes to it.
    """
    market = _load_market_for(market_id, requesting_user, action)
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
    "The table allocation for this market is settled. A rule only takes effect when tables are "
    "allocated, and this market can no longer allocate them. Change a single assignment on the "
    "Assignments page instead."
)


ASSIGNMENT_RULES_PUBLISHED = (
    "Results are published, so the table allocation is settled: a rule only takes effect when "
    "tables are allocated, and they are not allocated again once applicants have been told. Change "
    "a single assignment on the Assignments page instead."
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


# The menu's own name for the move back to draft (``pathTransitionLabel`` in
# ``front-end/src/utils/marketGuide.ts``).
_WAY_BACK = "Reopen for Editing"


def _since_leaving_draft(market: Market) -> str:
    """When a market left draft, as its own path says it: a CSV market imports its Google Form's
    responses rather than opening applications (E31/F03/S03, E32/F02/S01)."""
    if market.intake_mode is IntakeMode.FORM:
        return "once applications have opened"
    return "once its responses have been imported"


def setup_part(plan: Optional[SetupObject]) -> Dict[str, Any]:
    """The part of a plan that is the setup, in one comparable shape (E31/F01/S02).

    Everything on Market Setup: the dates, tiers, locations, sections and their tables, the
    floorplans and the prices (E43/F01/S01). Not the assignment rules
    (``made_from.assignment_rules``), which ride in the same object and keep a lock of their own.
    """
    if plan is None:
        return {}
    shape = plan.model_dump(
        include={"market_dates", "tiers", "locations", "sections", "floorplans", "pricing"})
    shape["floorplans"] = shape.get("floorplans") or []
    return shape


def setup_lock_reason(market: Market) -> Optional[str]:
    """Why the setup may no longer change, or None while it can (E31/F01/S02).

    It settles on leaving draft, so a date an applicant chose or a section a vendor was placed in
    cannot move under them. While the market can still go back to draft - nobody has applied - the
    reason names the move that gets it there, since that is the way to change it.
    """
    if market.phase is MarketPhase.DRAFT:
        return None
    settled = (
        f"The setup is settled: it cannot change {_since_leaving_draft(market)}, because "
        "applicants and the table allocation rely on it."
    )
    can_return = (market.phase.value, MarketPhase.DRAFT.value) in VALID_TRANSITIONS
    if can_return and ApplicationsApi.count_applications_for_market(market.id) == 0:
        return (
            f"{settled} While no one has applied, go back to draft to change it: {_WAY_BACK}, "
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
        raise BadRequestError(
            f"Field '{key}' is type '{field.type}' but has no options defined"
        )

    options: List[str] = []
    for option in field.options:
        option_value = (option or "").strip()
        if not option_value:
            raise BadRequestError(f"Field '{key}' has a blank option. Options must be non-empty.")
        if option_value in options:
            raise BadRequestError(
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
        raise BadRequestError(unaskable_error)

    fields: List[FormField] = []
    seen_keys = set()
    for index, field in enumerate(application_form.fields):
        key = (field.key or "").strip()
        if not key:
            raise BadRequestError(
                f"Field '{field.label or '(untitled)'}' must have a non-empty key"
            )
        if not FORM_FIELD_KEY_PATTERN.match(key):
            raise BadRequestError(
                f"Invalid field key '{key}'. Keys may only contain lowercase letters, "
                "numbers, and underscores."
            )
        if key.startswith(EssentialFields.ESSENTIAL_KEY_PREFIX):
            raise BadRequestError(
                f"Field key '{key}' uses the reserved "
                f"'{EssentialFields.ESSENTIAL_KEY_PREFIX}' prefix. Those keys belong to the "
                "essential questions every form already asks."
            )
        if key in CsvImport.RESERVED_TARGETS:
            raise BadRequestError(
                f"Field key '{key}' is reserved: the import reads that column as "
                f"{CsvImport.RESERVED_TARGETS[key]}. Choose another key."
            )
        if key in seen_keys:
            raise BadRequestError(f"Duplicate field key '{key}'. Field keys must be unique.")
        seen_keys.add(key)

        label = (field.label or "").strip()
        if not label:
            raise BadRequestError(f"Field '{key}' must have a non-empty label")

        if field.type not in VALID_FORM_FIELD_TYPES:
            raise BadRequestError(
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


def _log_unreadable_market(market_id: str, error: Exception) -> None:
    """A stored market the model refuses is answered "Invalid market data"; why is logged, never
    what the document held."""
    logger.warning("Stored market %s failed validation: %s", market_id, parse_failure_detail(error))


def load_market_context(market_id: str) -> Optional[MarketContext]:
    """Load a market with its parsed model and owning organization, or None if absent."""
    market_dict = markets_collection.find_one({"id": market_id})
    if not market_dict:
        return None

    try:
        market = market_from_document(market_dict)
    except Exception as e:
        _log_unreadable_market(market_id, e)
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

    # The person's role, resolved once: every answer below is asked of it (E39/F01/S02).
    user_role = PermissionsApi.get_user_market_role(user_email, market, context.organization)
    if Actions.role_refusal(Actions.READ, user_role, market.permissions):
        return None

    market_dict['_id'] = str(market_dict['_id'])
    # Deprecated: no screen reads the role since each asks the table (E39/F01/S02); an old bundle's
    # Manage market does, and the next release removes it with ``deprecated_screen_reasons``.
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
    # Hand placements at a seat the plan no longer has, for Assignments and the vendor's panel to mark
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
    # What this person is told of every action here, by row (E39/F01/S02), and why they may change
    # nothing at all (E26/F06/S01, T15): asked of the role resolved above by the ranking every
    # write asks, served so each screen offers no control the server would refuse.
    refusals = role_action_refusals(user_role, market.phase, market.permissions)
    market_dict['actionRefusals'] = refusals
    market_dict['readOnlyReason'] = read_only_reason(market, refusals)
    # And the table itself, for Manage market to show every row's role and where it came from
    # (E39/F01/S03): the rows this market holds, the built-in default for the rest.
    market_dict['permissionTable'] = Actions.table(market)
    # The rules of the market's life the table never overrides, each on its own: the verdicts
    # settle on entering assignment (E36/F01/S01), a vendor is added from the assignment on
    # (E36/F03/S01), and results wait for the allocation (E36/F04/S01), with how many will read
    # each outcome for the confirmation of someone who may publish now.
    verdicts_settled = None if review_is_open(market.phase) else VERDICTS_SETTLED
    market_dict['verdictsSettledReason'] = verdicts_settled
    adding_vendors = adding_refusal(market.phase)
    market_dict['addingVendorsReason'] = adding_vendors
    publish_waits = ApplicantsApi.publish_results_refusal(market)
    market_dict['publishWaitsReason'] = publish_waits
    market_dict['publishOutcomes'] = (
        None if refusals[Actions.PUBLISH_RESULTS.id] or publish_waits
        else ResultOutcome.outcome_counts(market)
    )
    # Stopping and resuming applications (E38/F04/S02): whether the form is stopped now, and the
    # rule of the stage that says when it may be, beside the table's Stop taking applications
    # answer, so the rail offers the action exactly when the endpoint would take it.
    market_dict['applicationsStopped'] = market.applications_stopped
    market_dict['applicationsStopReason'] = ApplicantsApi.applications_stop_refusal(market)
    # Deprecated, for a tab still on the old bundle; the next release removes them.
    market_dict.update(deprecated_screen_reasons(
        refusals, verdicts_settled, adding_vendors, publish_waits))
    # What would refuse each move open from this phase (E31/F02/S01), judged as the transition
    # endpoint judges it, so the rail can disable a move and name why before anyone clicks it.
    market_dict['transitionBlockers'] = {
        to_phase: [blocker.payload() for blocker in blockers]
        for to_phase, blockers in transition_verdicts(market, db).items()
    }
    # Whether this deployment has Discord's values (E46/F01/S02): the Discord card offers nothing
    # without them, and says so.
    market_dict['discordSetUp'] = DiscordClient.credentials() is not None
    if market.organization_id and org_dict:
        market_dict['organization_name'] = org_dict.get('name')
    # The roles on the market itself, which Manage market lists, served to every reader; and
    # whom this reader may hand a follow-up to (T15), served only to someone who may give a verdict
    # and so name one (the table's verdicts row): the organization's people too, if the reader is
    # one.
    may_give_verdicts = Actions.role_refusal(
        Actions.GIVE_VERDICTS, user_role, market.permissions) is None
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
    # Who reviews which application (E38/F07/S02): the chosen reviewers to every reader, never the
    # turn, which the stored team is served over, and whom this reader may choose from, served only
    # to someone who may choose them while the review is open, when the panel offers the choice.
    # They are the people a follow-up may be handed to, already read above for someone who gives
    # verdicts, so the read looks nobody up twice.
    market_dict['reviewTeam'] = ReviewTeam.served(
        ReviewTeam.team_of(market), market, context.organization)
    may_choose = review_is_open(market.phase) and Actions.role_refusal(
        Actions.CHOOSE_REVIEWERS, user_role, market.permissions) is None
    if not may_choose:
        candidates: List[str] = []
    elif may_give_verdicts:
        candidates = list(email_by_user_id.values())
    else:
        candidates = [person.email for person in reviewer_candidates(
            market, context.organization, UsersApi.get_user(user_email))]
    market_dict['reviewerCandidates'] = sorted(candidates)
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
    # Deprecated, as the market read's: an old bundle's card offers Manage on it.
    market['user_role'] = user_role
    phase = phase_from_market_document(market)
    _stamp_effective_market_state(market, phase)
    # The table's answers for the role the entry names, so the card offers Manage on its row as
    # the market's own page does (E39/F01/S02).
    market['actionRefusals'] = role_action_refusals(
        _market_role(user_role), phase, market_doc_field(market, 'permissions') or {})
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


def _market_role(value: Optional[str]) -> Optional[MarketRole]:
    """A stored role value as a role, or None for no role or one this server does not know."""
    try:
        return MarketRole(value) if value else None
    except ValueError:
        return None


def _summary_role(
    market: Dict[str, Any], user_id: str, lookups: _SummaryLookups
) -> Optional[str]:
    """The role a list entry names: the one ``get_user_market_role`` would serve on the market.

    Worked from the raw documents the list already holds, by the same two rules, so a card offers
    Manage to exactly the people the market's own page lets manage it: an organization's admins
    run its markets, and the list called them viewers.
    """
    explicit = (market_doc_field(market, 'roles') or {}).get(user_id)
    on_the_market = _market_role(explicit)
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
    # Server-owned too: the import mapping is the import's and the start's to write, and what the
    # start kept of its file the start's alone (E38/F02), so a new market carries neither.
    market_dict["import_mapping"] = None
    market_dict["example_columns"] = None
    # Server-owned too: a new market starts with its organization's default rows, each marked as
    # copied from it, whatever the body carried; a market of no organization, or of one that sets
    # none, starts at the built-in table (E39/F02/S01). A copy, not a link.
    market_dict["permissions"] = _organization_default_rows(market.organization_id)
    # And the reviewers: chosen on the market once it exists, by their own write (E38/F07/S02).
    market_dict["review_team"] = None
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
        # A builtin: ``create_owned_market`` sets the one owner, so this escaping is a bug, a 500.
        raise ValueError("Market must have exactly one owner in roles dict")
    
    market_id = str(uuid.uuid4())
    market_dict["id"] = market_id
    market_dict = convert_keys_to_camel_case(market_dict)
    
    refusal = public_address_refusal(market.name)
    if refusal:
        raise BadRequestError(refusal)
    
    try:
        result = markets_collection.insert_one(market_dict)
    except DuplicateKeyError as e:
        # Two creations passed the check above and raced; the unique `market_slug` index refused
        # the second. It is the same clash, so it reads the same (code review of E21).
        raise BadRequestError(_address_taken(market.name)) from e
    
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

def _organization_default_rows(organization_id: Optional[str]) -> Dict[str, Dict[str, str]]:
    """The organization's default rows as a market of it holds them, copied (E39/F02/S01)."""
    organization = OrgsApi.get_organization(organization_id) if organization_id else None
    rows = Actions.organization_rows((organization or {}).get(OrgsApi.DEFAULT_PERMISSIONS))
    return {row_id: held.model_dump() for row_id, held in rows.items()}


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

    Raises a ``BadRequestError``, in words for the organizer, when the market may not be made.
    """
    try:
        market = Market.model_validate({**data, "roles": {owner.id: MarketRole.OWNER.value}})
    except ValidationError as e:
        logger.warning("Refused a new market: %s", parse_failure_detail(e))
        raise BadRequestError(field_named_copy("Invalid market", e)) from e
    refusal = organization_refusal(owner.email, data.get("organization_id"))
    if refusal:
        raise BadRequestError(refusal)
    _result, market_id = create_market(market, owner.email)
    # The market's own history starts empty; its creation is the organization's change.
    History.record_for_organization(
        data["organization_id"], owner.email, History.CREATE_MARKET,
        subject={"market_id": market_id},
        detail=lambda: History.changes({"name": None}, {"name": market.name}),
    )
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
    """Get an assigned market. Asks ``Actions.READ``."""
    context = load_market_context(market_id)
    if context is None:
        return {"error": "Market not found"}, 404

    if requesting_user:
        if context.market is None:
            return {"error": "Invalid market data"}, 400

        refused = Actions.refusal(Actions.READ, requesting_user, context.market, context.organization)
        if refused:
            return {"error": refused}, 403

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
        refused = Actions.refusal(Actions.READ, requesting_user, market, context.organization)
        if refused:
            return {"error": refused}, 403

    # Keep persisted schema free of assignment statistics, then derive fresh.
    market.assignment_object.assignment_statistics = None
    # The vendors are read once and handed to both: the stored seats are described against
    # them, and the reasons below are computed against the same set, so the two can never
    # disagree about who applied.
    vendors = vendors_to_show(market)
    assigned_market = assignment_to_show(market, vendors)
    stats = assigned_market.assignment_object.assignment_statistics
    if stats is None:
        return {"error": "The result's statistics could not be counted."}, 500

    rows = derive_market_table_rows(assigned_market)
    stats.unassigned_tables = derive_unassigned_tables_from_rows(rows)
    placed_rows = assigned_market.assignment_object.vendor_assignments or []
    # Everyone the run does not read, read once: the vendors added by hand are counted below, and
    # the applicants the review did not approve are marked where a seat overrides them.
    outside = outside_solver_vendors(
        market.id, EssentialFields.effective_essential_options_for_market(market),
        {vendor.email for vendor in vendors},
    )
    count_added_vendors(
        stats, [vendor.email for vendor, application in outside if needs_a_table(application)],
        placed_rows,
    )

    payload = convert_keys_to_camel_case(stats.model_dump())
    # Why each vendor holds no table, computed from the plan, the applications and the
    # assignment as they stand (E12/F01/S01). Sent with the statistics that report the
    # unplaced, so the panel listing them can say why without a second request.
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
            [vendor for vendor, application in outside if is_not_approved(application)],
        )
    ]
    # Unassigned vendors are a list of bare addresses; this is what lets the payoff screen
    # name them. A vendor with no stored name has no entry and renders as they did before.
    payload["vendorNames"] = ApplicationsApi.vendor_names_for_market(market_id)
    return payload, 200


def get_placement_history(market_id: str, requesting_user: str) -> tuple[Dict[str, Any], int]:
    """This market's placement trail - its history narrowed to placements - newest first. Asks
    ``Actions.READ_HISTORY``.

    Read on the history's row, written on the Assignment row: the trail is the market's history
    narrowed, and anyone who may read that history may read how vendors came to sit where they do.
    """
    context = load_market_context(market_id)
    if context is None:
        return {"error": "Market not found"}, 404
    if context.market is None:
        return {"error": "Invalid market data"}, 400

    refused = Actions.refusal(
        Actions.READ_HISTORY, requesting_user, context.market, context.organization)
    if refused:
        return {"error": refused}, 403

    entries = History.placement_entries(market_id)
    return {
        "entries": [convert_keys_to_camel_case(entry) for entry in entries],
        # Names against addresses, as every other vendor surface gets them, so the log reads as
        # people rather than as a column of email.
        "vendorNames": ApplicationsApi.vendor_names_for_market(market_id),
    }, 200


#: The table's groups that change something, in its order: the kinds of change the history is
#: narrowed by. An applicant's own change (``History.APPLY``), which no row asks, is an
#: application's.
_HISTORY_GROUPS_LEFT_OUT = frozenset({"Reading"})


def history_groups() -> List[Dict[str, Any]]:
    """The groups of the table the history may be narrowed to, each with its actions' ids and
    labels, for the screen's kind filter."""
    groups: Dict[str, List[Dict[str, str]]] = {}
    for row in Actions.ACTIONS.values():
        if row.group not in _HISTORY_GROUPS_LEFT_OUT:
            groups.setdefault(row.group, []).append({"id": row.id, "label": row.label})
    groups.setdefault("Applications", []).append(
        {"id": History.APPLY, "label": "Apply, or change one's own application"})
    return [{"group": group, "actions": actions} for group, actions in groups.items()]


def _history_instant(value: Optional[str]) -> Tuple[Optional[str], bool]:
    """A filter's instant, in the format the history stores ``at`` in, and whether it read: an
    absent one reads as None; one without its offset does not read, since it names no instant."""
    if not value:
        return None, True
    try:
        instant = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None, False
    if instant.tzinfo is None:
        return None, False
    return instant.astimezone(timezone.utc).isoformat(), True


def get_history(
    market_id: str, requesting_user: str, args: Dict[str, str],
) -> tuple[Dict[str, Any], int]:
    """One page of this market's history, newest first, for Manage market (E40/F01/S03). Asks
    ``Actions.READ_HISTORY``.

    ``args`` are the request's: ``before`` (the cursor the last page answered with), ``actor``,
    ``group`` (a group of the table), ``vendor``, and ``since`` and ``until`` (ISO instants, the
    first kept and the second not). The first page also answers what the filters may offer: the
    people who changed something, and the groups.
    """
    context = load_market_context(market_id)
    if context is None:
        return {"error": "Market not found"}, 404
    if context.market is None:
        return {"error": "Invalid market data"}, 400

    refused = Actions.refusal(
        Actions.READ_HISTORY, requesting_user, context.market, context.organization)
    if refused:
        return {"error": refused}, 403

    groups = history_groups()
    actions = None
    group = args.get("group")
    if group:
        actions = next(
            ([row["id"] for row in g["actions"]] for g in groups if g["group"] == group), None)
        if actions is None:
            return {"error": "The history has no such kind of change."}, 400
    since, since_read = _history_instant(args.get("since"))
    until, until_read = _history_instant(args.get("until"))
    if not (since_read and until_read):
        return {"error": "The history's dates could not be read."}, 400
    before = args.get("before")
    if before and History.parse_cursor(before) is None:
        return {"error": "That page of the history could not be read."}, 400

    entries, after = History.entries_page(
        market_id, before=before or None, actor=args.get("actor") or None, actions=actions,
        vendor=args.get("vendor") or None, since=since, until=until,
    )
    body: Dict[str, Any] = {
        # Only the entry's own fields are recased: its subject and detail are served as stored,
        # since their keys are data (a question's key, an application's id).
        "entries": [
            {**convert_keys_to_camel_case({k: v for k, v in entry.items()
                                           if k not in ("subject", "detail")}),
             "subject": entry.get("subject") or {}, "detail": entry.get("detail")}
            for entry in entries
        ],
        "next": after,
        # Names against addresses, so an entry reads as people.
        "vendorNames": ApplicationsApi.vendor_names_for_market(market_id),
    }
    if not before:
        body["actors"] = History.actors(market_id)
        body["groups"] = groups
    return body, 200


def _market_csv_filename(
    market_name: Optional[str], market_id: str, kind: str = "assigned",
) -> str:
    """Build a deterministic, filesystem-safe CSV filename for a market's downloads: the
    assignment's, or the vendors' export (``kind``)."""
    name = (market_name or market_id or "market").strip() or "market"
    safe = "".join(c if c.isalnum() or c in (" ", "-", "_") else " " for c in name)
    safe = "_".join(safe.split())
    return f"{safe}_{kind}.csv"


def get_assignment_csv(market_id: str, requesting_user: Optional[str] = None) -> tuple[Dict[str, Any], int]:
    """Derive assignment CSV in-memory for download. Asks ``Actions.EXPORT_CSV``.

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
        refused = Actions.refusal(Actions.EXPORT_CSV, requesting_user, market, context.organization)
        if refused:
            return {"error": refused}, 403

    if market.setup_object is None:
        return {"error": "Market has no setup configured"}, 400

    market.assignment_object.assignment_statistics = None
    vendors = vendors_to_show(market)
    assigned_market = assignment_to_show(market, vendors)
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


def needs_a_table(outside: Optional[Application]) -> bool:
    """Whether a vendor needs a table (E38/F08/S02): everyone the run reads (``outside`` None), and
    an applicant outside it whom nothing left out - a vendor added by hand, approved by the adding.

    Said apart from "in the run", which is only who the run places: an added vendor stays out of
    the run, whose answers they may not have, and is still unassigned like anyone until seated. A
    rejected or undecided applicant needs none, seated by hand or not (bug 10)."""
    return outside is None or not is_not_approved(outside)


def count_added_vendors(
    stats: AssignmentStatistics, added: Iterable[str], placements: Iterable[VendorAssignmentResult],
) -> None:
    """Count the vendors added by hand in the statistics' vendors (E38/F08/S02), beside the run's.

    The run counts only the vendors it reads, so a vendor added without a table was missing from
    "N unassigned" while Vendors' "Unassigned only" listed them, and the link led to a list longer
    than its number. An added vendor needs a table on every market day, and holds one when seated
    on any, as the run's vendors do; satisfaction stays the run's, measured against their answers.
    """
    seated = {placement.email for placement in placements}
    for email in sorted(set(added)):
        stats.total_vendors += 1
        if email in seated:
            stats.total_assigned_vendors += 1
        else:
            stats.unassigned_vendors.append(email)


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
        # And whether they need a table, said apart (E38/F08/S02): a vendor added by hand is out
        # of the run and unassigned like anyone until seated.
        "needsATable": needs_a_table(outside),
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
        refused = Actions.refusal(Actions.READ, requesting_user, market, context.organization)
        if refused:
            return {"error": refused}, 403

    market.assignment_object.assignment_statistics = None
    vendors = vendors_to_show(market)

    # The STORED assignment, when the market has one. This is the screen an organizer edits
    # placements on, and `assignmentObject.vendorAssignments` is what check-in reads at the
    # door - a grid drawn from a fresh solver run would be a picture of what WOULD happen if
    # they pressed Assign, and every seat they moved a vendor into would be a seat they had
    # never actually seen. A market with nothing stored shows nobody placed.
    assigned_market = assignment_to_show(market, vendors)

    rows = derive_market_table_rows(assigned_market)
    groups = Pricing.Groups(market)
    answers = Pricing.vendor_answers(groups, market_id)
    # Who may be put in a seat, and what they asked for. Sent with the grid because the view has
    # to warn - before the change, not after - when a placement would alter a vendor's table choice
    # away from their own answer (E11/F03/S01). Every applicant, the ones outside the run with why
    # (E36/F02/S02): an organizer may seat anyone by hand, warned, and the run's own come first.
    placeable = [_placeable(vendor, None) for vendor in vendors] + [
        _placeable(vendor, application)
        for vendor, application in outside_solver_vendors(
            market_id,
            EssentialFields.effective_essential_options_for_market(market),
            {vendor.email for vendor in vendors},
        )
    ]
    return {
        # Each occupant's price and the card's row that set it ride on their row, for the
        # organizer's eyes only: this read is the market's people's, never an applicant's
        # (E43/F01/S01, S02; Q20.2).
        "rows": [
            {**convert_keys_to_camel_case(row.model_dump()),
             "prices": Pricing.row_prices(groups, row, answers)}
            for row in rows
        ],
        # Name against address, for the surfaces that only ever knew the address. Sent with
        # the rows rather than fetched separately so the grid and its occupants' names can
        # never be a request apart.
        "vendorNames": ApplicationsApi.vendor_names_for_market(market_id),
        # What the page's search finds each vendor by, beyond their address (E35/F02/S01): every
        # vendor at a table, and every one the place dialog offers, whose picker searches by the
        # same terms (E38/F08/S03).
        "vendorSearch": ApplicationsApi.vendor_search_terms_for_market(
            market_id,
            market.application_form.fields if market.application_form else [],
            {email for row in rows for email in row.assignment_slots if email}
            | {vendor["email"] for vendor in placeable},
        ),
        "vendors": placeable,
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

    A market may reach ``applications`` with no stored form at all: a form is its custom fields
    PLUS the essential questions the plan asks, and either half alone is a form. Such a market is
    still finalized, so it gets one with no custom fields rather than no stamp.
    """
    form_key = market_doc_key("application_form")
    stored_form = document.get(form_key)

    if from_phase == MarketPhase.DRAFT.value and to_phase == MarketPhase.APPLICATIONS.value:
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


def taking_applications_update(to_phase: str) -> Dict[str, Any]:
    """A stop belongs to the one stay in the stage it was made in (E38/F04/S02).

    Reopen for Editing and then Open Applications is opening applications, so a stop made before
    must not leave the form shut; cleared on entering draft and on entering the stage, in the
    update that moves the phase. Elsewhere it is left alone: past the stage the phase closes the
    form whatever the flag says.
    """
    if to_phase in (MarketPhase.DRAFT.value, MarketPhase.APPLICATIONS.value):
        return {market_doc_key("applications_stopped"): False}
    return {}


class PhaseChangedUnderRequest(ConflictError):
    """The market's stored phase was not what this write expected: a 409.

    Carries the phase it actually holds, and the move that was asked for, so the organizer is told
    to reload rather than the request retrying blindly.
    """

    def __init__(self, actual_phase: str, from_phase: str, target_phase: str):
        self.actual_phase = actual_phase
        self.from_phase = from_phase
        self.target_phase = target_phase
        super().__init__(
            f"This market moved to the '{actual_phase}' phase while the request was in flight, so "
            f"it can no longer move to '{target_phase}' from '{from_phase}'. "
            "Reload the market and try again."
        )

    def body(self) -> Dict[str, Any]:
        """Read as a move's blockers are, so the rail shows the conflict where it shows a guard."""
        conflict = PreconditionResult(id="phase_changed", passed=False, message=self.message)
        return convert_keys_to_camel_case({
            "error": "phase_changed",
            "current_phase": self.actual_phase,
            "target_phase": self.target_phase,
            "blockers": [conflict.payload()],
        })


def apply_phase_transition(
    market_id: str, document: Dict[str, Any], to_phase: str, by: Optional[str] = None,
) -> None:
    """Write one phase change, conditional on the market still being where the caller thinks.

    The ONE writer of a market's phase: every move, the transition endpoint's and a Google Form
    market's first import's, comes through ``take_move`` to it. A second copy is how the `isDraft` stamp and the
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
                **taking_applications_update(to_phase),
            },
            "$push": PhaseRecord.push_entries(document, to_phase, by),
        },
    )

    if result.matched_count:
        return

    latest = markets_collection.find_one({"id": market_id})
    if latest is None:
        raise MarketNotFoundError("Market not found")
    raise PhaseChangedUnderRequest(phase_from_market_document(latest).value, from_phase, to_phase)


class MoveUnavailable(BadRequestError):
    """The move is not open from the phase the market stands in: a 400."""


def take_move(context: MarketContext, to_phase: str, by: Optional[str] = None) -> List[PreconditionResult]:
    """Judge a move and, when nothing blocks it, take it. Returns its blockers; none means taken.

    The one way a market is moved: the transition endpoint, a Google Form market's first import
    (``csv_import.import_applications``) and the operator's seeder (``seed_test_markets.py``) all
    come here, so none can take a move unjudged. Who may move it is the caller's to ask first.

    Raises ``MoveUnavailable``, and what ``apply_phase_transition`` raises.
    """
    market = context.market
    market_id = context.document["id"]
    from_phase = market.phase.value
    if (from_phase, to_phase) not in VALID_TRANSITIONS:
        raise MoveUnavailable(
            f"Transition from '{from_phase}' to '{to_phase}' is not available in the current phase."
        )
    blockers = evaluate_transition(market, to_phase, db)
    if blockers:
        return blockers
    # Through the one phase writer, so the phase, its two stamps and the phase history move in one
    # atomic update (E26/F06/S03).
    apply_phase_transition(market_id, context.document, to_phase, by=by)

    # Only after the phase is written.
    swept: Dict[str, int] = {}
    if from_phase == MarketPhase.OFFERS.value and to_phase == MarketPhase.MARKET_DAYS.value:
        try:
            swept["swept"] = ApplicationsApi.sweep_unanswered_offers(market_id)
            logger.info(
                "Swept %d assignment_sent applications to vendor_refused for market %s",
                swept["swept"],
                market_id,
            )
        except Exception:
            logger.error(
                "Phase advanced to market_days for market %s but the "
                "assignment_sent -> vendor_refused sweep failed",
                market_id,
                exc_info=True,
            )
    # After the sweep, so the move's entry counts the offers it turned to refusals: no entry of
    # their own says who refused those vendors.
    History.record(market_id, by, Actions.MOVE_PHASE, detail=lambda: {
        **History.changes({"phase": from_phase}, {"phase": to_phase}), **swept})
    return []


def add_market_role(market_id: str, user_email: str, role: MarketRole, requesting_user: str) -> bool:
    """Add a user role to a market. Asks the row that gives the role (``Actions.roles_row``)."""
    context = load_market_context(market_id)
    if context is None:
        raise MarketNotFoundError("Market not found")
    if context.market is None:
        raise BadRequestError("Invalid market data")

    market_dict = context.document
    market = context.market

    refused = Actions.refusal(Actions.roles_row(role), requesting_user, market, context.organization)
    if refused:
        raise ForbiddenError(refused)

    if role == MarketRole.OWNER:
        current_roles = market_dict.get('roles', {})
        for uid, existing_role in current_roles.items():
            if existing_role == MarketRole.OWNER.value:
                raise BadRequestError("Market already has an owner. Transfer ownership first.")
    
    user = UsersApi.get_user(user_email)
    if not user:
        raise BadRequestError("User not found")

    roles = market_dict.get('roles', {})
    # Adding never changes a role: overwriting one here would skip update_market_role's guards and
    # let an Admin demote the Owner.
    if user.id in roles:
        raise BadRequestError(
            f"{user.email} already has a role on this market. Change it in their row under Users with access."
        )
    roles[user.id] = role.value
    
    result = markets_collection.update_one(
        {"id": market_id},
        {"$set": {"roles": roles}}
    )
    
    if result.modified_count > 0:
        _record_role(market_id, requesting_user, History.ROLE_GIVEN, user.id, None, role)
    return result.modified_count > 0


def remove_market_role(market_id: str, user_id: str, requesting_user: str) -> bool:
    """Remove a user role from a market. Asks the row that takes the role (``Actions.roles_row``)."""
    context = load_market_context(market_id)
    if context is None:
        raise MarketNotFoundError("Market not found")
    if context.market is None:
        raise BadRequestError("Invalid market data")

    market_dict = context.document
    market = context.market
    organization = context.organization

    roles = market_dict.get('roles', {})
    if user_id not in roles:
        raise BadRequestError("User does not have a role in this market")
    
    if roles.get(user_id) == MarketRole.OWNER.value:
        # Count how many owners there are
        owner_count = sum(1 for r in roles.values() if r == MarketRole.OWNER.value)
        if owner_count <= 1:
            raise BadRequestError("Cannot remove the only owner. Transfer ownership first.")
    
    # The role as the market model read it, which takes only the four roles: every removal asks
    # the row of the role it takes.
    refused = Actions.refusal(
        Actions.roles_row(market.roles[user_id]), requesting_user, market, organization)
    if refused:
        raise ForbiddenError(refused)

    del roles[user_id]
    
    result = markets_collection.update_one(
        {"id": market_id},
        {"$set": {"roles": roles}}
    )
    
    if result.modified_count > 0:
        _record_role(market_id, requesting_user, History.ROLE_TAKEN, user_id,
                     market.roles[user_id], None)
    return result.modified_count > 0


def update_market_role(market_id: str, user_id: str, new_role: MarketRole, requesting_user: str) -> bool:
    """Update a user's role in a market. Asks the row of the role taken and of the one given."""
    context = load_market_context(market_id)
    if context is None:
        raise MarketNotFoundError("Market not found")
    if context.market is None:
        raise BadRequestError("Invalid market data")

    market_dict = context.document
    market = context.market
    organization = context.organization

    roles = market_dict.get('roles', {})
    current_role_value = roles.get(user_id)
    if not current_role_value:
        raise BadRequestError("User does not have a role in this market")

    current_role = market.roles[user_id]

    # Owners cannot have their role changed
    if current_role == MarketRole.OWNER:
        raise ForbiddenError("Cannot change owner's role")

    # Taking an Admin role is the Admin row's, and so is giving the new one: each row is asked
    # for the role it gives or takes.
    for role in (current_role, new_role):
        refused = Actions.refusal(Actions.roles_row(role), requesting_user, market, organization)
        if refused:
            raise ForbiddenError(refused)
    
    if new_role == MarketRole.OWNER:
        for uid, existing_role in roles.items():
            if uid != user_id and existing_role == MarketRole.OWNER.value:
                raise BadRequestError("Market already has an owner. Transfer ownership first.")
    
    roles[user_id] = new_role.value
    
    result = markets_collection.update_one(
        {"id": market_id},
        {"$set": {"roles": roles}}
    )
    
    if result.modified_count > 0:
        _record_role(market_id, requesting_user, History.ROLE_CHANGED, user_id,
                     current_role, new_role)
    return result.modified_count > 0


NO_SUCH_ROW = "This market's table has no such row."


def _row_to_change(market_id: str, action_id: Any, requesting_user: str) -> Tuple[Market, Actions.Action]:
    """The market and the row its owner is changing, or the refusal (E39/F01/S03).

    Asks the fixed row ``change-the-table`` first, which only the market's owner reaches (an
    organization's admins hold Admin on its markets, never Owner), and the archived rule with it:
    an archived market's table is its record too. Then the row: one the table has, and not fixed.
    """
    market = _load_market_to_change(market_id, requesting_user, Actions.CHANGE_THE_TABLE)
    row = Actions.ACTIONS.get(action_id) if isinstance(action_id, str) else None
    if row is None:
        raise BadRequestError(NO_SUCH_ROW)
    if row.fixed:
        raise BadRequestError(Actions.fixed_row_refusal(row))
    return market, row


def _record_permission(
    market_id: str, requesting_user: str, kind: str, row: Actions.Action,
    before: Optional[MarketPermission], after: Optional[MarketPermission],
) -> None:
    History.record(
        market_id, requesting_user, Actions.CHANGE_THE_TABLE, kind=kind,
        subject={"action": row.id},
        detail={"before": Actions.row_state(row, before), "after": Actions.row_state(row, after)},
    )


def set_permission(
    market_id: str, action_id: Any, role: Any, requesting_user: str,
) -> List[Dict[str, Any]]:
    """Set the role a row of this market's table asks, as its owner (E39/F01/S03). Asks
    ``Actions.CHANGE_THE_TABLE``.

    The row is then the market's own, whatever it was before, except that setting the role it
    already asks stores and records nothing: who may take it has not changed, so a row copied from
    the organization keeps its source. Returns the market's table.
    """
    market, row = _row_to_change(market_id, action_id, requesting_user)
    if not isinstance(role, str) or role not in {r.value for r in MarketRole}:
        raise BadRequestError(Actions.NOT_A_ROLE)

    before = Actions.held_row(row, market.permissions)
    if Actions.minimum_role(row, market).value == role:
        return Actions.table(market)
    after = MarketPermission(role=role, source=Actions.ON_THIS_MARKET)
    key = market_doc_key('permissions')
    # Mongo cannot set a key inside a stored null or string, so a field that is not a map, which
    # the read already takes as no rows held, is replaced by one holding this row.
    write = ({f"{key}.{row.id}": after.model_dump()} if _stored_rows_are_a_map(market_id)
             else {key: {row.id: after.model_dump()}})
    markets_collection.update_one(market_doc_filter("id", market_id), {"$set": write})
    _record_permission(market_id, requesting_user, History.PERMISSION_SET, row, before, after)
    market.permissions[row.id] = after
    return Actions.table(market)


def reset_permission(market_id: str, action_id: Any, requesting_user: str) -> List[Dict[str, Any]]:
    """Return a row of this market's table to its built-in default, as its owner (E39/F01/S03).
    Asks ``Actions.CHANGE_THE_TABLE``.

    The market stops holding the row, whether it was changed here or copied from the organization.
    A row it does not hold is already at its default, and resetting it records nothing. Returns
    the market's table.
    """
    market, row = _row_to_change(market_id, action_id, requesting_user)
    before = Actions.held_row(row, market.permissions)
    if before is None:
        return Actions.table(market)
    markets_collection.update_one(market_doc_filter("id", market_id), {"$unset": {
        f"{market_doc_key('permissions')}.{row.id}": "",
    }})
    _record_permission(market_id, requesting_user, History.PERMISSION_RESET, row, before, None)
    market.permissions.pop(row.id, None)
    return Actions.table(market)


def reset_permissions(market_id: str, requesting_user: str) -> List[Dict[str, Any]]:
    """Return every row of this market's table to its built-in default, as its owner
    (E39/F01/S04). Asks ``Actions.CHANGE_THE_TABLE``.

    One write and one history entry for the one act, its detail every row the market held, before
    and after, so the record reads as the owner did it rather than as a row-by-row run. A market
    holding no row it can read is already at the built-in table, and resetting it records nothing. Returns the
    market's table.
    """
    market = _load_market_to_change(market_id, requesting_user, Actions.CHANGE_THE_TABLE)
    held_rows = [
        (row, held) for row in Actions.ACTIONS.values()
        if (held := Actions.held_row(row, market.permissions)) is not None
    ]
    if not held_rows:
        return Actions.table(market)
    # Exactly the rows it returns: a row this build cannot read (a later build's, a malformed one)
    # is left as the per-row reset leaves it, and is not in the entry.
    key = market_doc_key('permissions')
    markets_collection.update_one(market_doc_filter("id", market_id), {"$unset": {
        f"{key}.{row.id}": "" for row, _ in held_rows
    }})
    History.record(
        market_id, requesting_user, Actions.CHANGE_THE_TABLE, kind=History.PERMISSION_TABLE_RESET,
        detail=lambda: {
            "before": {row.id: Actions.row_state(row, held) for row, held in held_rows},
            "after": {row.id: Actions.row_state(row, None) for row, _ in held_rows},
        },
    )
    for row, _ in held_rows:
        market.permissions.pop(row.id, None)
    return Actions.table(market)


NO_ORGANIZATION_TO_COPY = "This market belongs to no organization, so it has no default to copy."


def copy_organization_default(market_id: str, requesting_user: str) -> List[Dict[str, Any]]:
    """Replace this market's table with its organization's default as it is now, as its owner
    (E39/F02/S01). Asks ``Actions.CHANGE_THE_TABLE``.

    For a market created before its organization's default changed, which a copy at creation never
    follows: every row the organization sets is copied, marked so, and every other row returns to
    its built-in default, the rows its owner changed here included. One write and one entry, every
    row it changed before and after; a market already holding the default records nothing.
    Returns the market's table.
    """
    market = _load_market_to_change(market_id, requesting_user, Actions.CHANGE_THE_TABLE)
    organization = (
        OrgsApi.get_organization(market.organization_id) if market.organization_id else None)
    if organization is None:
        raise BadRequestError(NO_ORGANIZATION_TO_COPY)
    copied = Actions.organization_rows(organization.get(OrgsApi.DEFAULT_PERMISSIONS))

    changed = []
    for row in Actions.ACTIONS.values():
        before = Actions.held_row(row, market.permissions)
        after = copied.get(row.id)
        if Actions.row_state(row, before) != Actions.row_state(row, after):
            changed.append((row, before, after))
    if not changed:
        return Actions.table(market)

    key = market_doc_key('permissions')
    if _stored_rows_are_a_map(market_id):
        # Row by row, so a row this build cannot read stays, as a reset leaves it.
        update: Dict[str, Any] = {}
        sets = {f"{key}.{row.id}": after.model_dump() for row, _, after in changed if after}
        unsets = {f"{key}.{row.id}": "" for row, _, after in changed if after is None}
        if sets:
            update["$set"] = sets
        if unsets:
            update["$unset"] = unsets
    else:
        update = {"$set": {key: {row_id: held.model_dump() for row_id, held in copied.items()}}}
    markets_collection.update_one(market_doc_filter("id", market_id), update)
    History.record(
        market_id, requesting_user, Actions.CHANGE_THE_TABLE, kind=History.PERMISSION_TABLE_COPIED,
        detail=lambda: {
            "before": {row.id: Actions.row_state(row, before) for row, before, _ in changed},
            "after": {row.id: Actions.row_state(row, after) for row, _, after in changed},
        },
    )
    for row, _, after in changed:
        if after is None:
            market.permissions.pop(row.id, None)
        else:
            market.permissions[row.id] = after
    return Actions.table(market)


def _stored_rows_are_a_map(market_id: str) -> bool:
    """Whether the market's stored ``permissions`` is a map or absent, as Mongo can set a key in."""
    key = market_doc_key('permissions')
    stored = markets_collection.find_one(market_doc_filter("id", market_id), {key: 1}) or {}
    return isinstance(stored.get(key, {}), dict)


def get_permission_history(market_id: str, requesting_user: str) -> List[Dict[str, Any]]:
    """Every change to this market's table, newest first: who, when, the row, and its role and
    source before and after (E39/F01/S03). Asks ``Actions.READ_HISTORY``: these changes are the
    market's history narrowed, so they are read on the history's row, as the whole history is."""
    _load_market_for(market_id, requesting_user, Actions.READ_HISTORY)
    return [convert_keys_to_camel_case(entry) for entry in History.permission_entries(market_id)]


def _record_role(
    market_id: str, requesting_user: str, kind: str, user_id: str,
    before: Optional[MarketRole], after: Optional[MarketRole],
) -> None:
    """A role given, changed or taken, as the row that gives it: the Admin row when an Admin or
    Owner role is either side of it, as its check asked."""
    rows = [Actions.roles_row(role) for role in (before, after) if role is not None]
    row = Actions.MANAGE_ADMINS if Actions.MANAGE_ADMINS in rows else Actions.MANAGE_EDITORS_AND_VIEWERS

    def person() -> Dict[str, Any]:
        user = UsersApi.get_user_by_id(user_id)
        return {"user_id": user_id, "email": user.email if user else None}

    History.record(
        market_id, requesting_user, row, kind=kind, subject=person,
        detail=lambda: History.changes(
            {"role": before.value if before else None}, {"role": after.value if after else None}),
    )


def delete_market(market_id: str, requesting_user: str) -> DeleteResult:
    """Delete a market. Only owner can delete."""
    context = load_market_context(market_id)
    if context is None:
        raise MarketNotFoundError("Market not found")
    if context.market is None:
        raise BadRequestError("Invalid market data")

    market = context.market

    refused = Actions.refusal(Actions.DELETE_MARKET, requesting_user, market, context.organization)
    if refused:
        raise ForbiddenError(refused)

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
    result = MarketDeletion.delete_market_and_records(markets_collection, market_id)
    # Its own history went with it; its organization's keeps that it went (E40/F02/S01), when this
    # deletion is the one that took it.
    if market.organization_id and result.deleted_count == 1:
        History.record_for_organization(
            market.organization_id, requesting_user, History.DELETE_MARKET,
            subject={"market_id": market_id},
            detail=lambda: History.changes({"name": market.name}, {"name": None}),
        )
    return result


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
    held to the same public-address rule as creation. Asks ``Actions.CHANGE_SETUP``.
    """
    name = (name or "").strip()
    if not name:
        raise BadRequestError("A market needs a name.")

    market = _load_market_to_change(market_id, requesting_user, Actions.CHANGE_SETUP)
    if market.phase is not MarketPhase.DRAFT:
        raise BadRequestError(RENAME_REFUSED_AFTER_DRAFT)
    if name == market.name:
        return

    refusal = public_address_refusal(name, market_id)
    if refusal:
        raise BadRequestError(refusal)

    try:
        markets_collection.update_one(
            market_doc_filter("id", market_id),
            {"$set": {market_doc_key("name"): name, market_doc_key("slug"): market_name_slug(name)}},
        )
    except DuplicateKeyError as e:
        # A rename that raced another write to the same address, refused by the unique index.
        raise BadRequestError(_address_taken(name)) from e
    History.record(market_id, requesting_user, Actions.CHANGE_SETUP, kind=History.RENAMED,
                   detail=lambda: History.changes({"name": market.name}, {"name": name}))


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
    not a change. Asks ``Actions.CHANGE_SETUP``, and ``Actions.ASSIGN`` too when it changes the
    assignment rules, which are that row's though they ride in the plan (E39/F01/S01).
    """
    extra = sorted(set(body) - set(PLAN_WRITE_FIELDS))
    if extra:
        raise BadRequestError(f"The plan write carries only the plan; it does not accept {', '.join(extra)}.")
    if "setupObject" not in body:
        raise BadRequestError("setupObject is required.")

    market = _load_market_to_change(market_id, requesting_user, Actions.CHANGE_SETUP)
    update = prepared_plan(market, body)
    plan = SetupObject.model_validate(convert_keys_to_snake_case(body["setupObject"]))
    if assignment_rules(plan) != assignment_rules(market.setup_object):
        refused = Actions.refusal(
            Actions.ASSIGN, requesting_user, market, _load_organization(market.organization_id))
        if refused:
            raise ForbiddenError(refused)
    markets_collection.update_one(market_doc_filter("id", market_id), {"$set": update})
    _record_plan(market, plan, update, requesting_user)


#: The plan's fields that are Market Setup's; the rest, ``assignment_rules``, are the Assignment row's.
_SETUP_FIELDS = ("market_dates", "tiers", "locations", "sections", "floorplans")


def _record_plan(
    market: Market, plan: SetupObject, update: Dict[str, Any], requesting_user: str,
) -> None:
    """A plan write as the actions it took: Market Setup's fields and the intake mode as one
    entry, the prices as another, the assignment rules as a third, each only when it changed - the
    plan saves as the organizer types, and restating it changes nothing."""
    def setup() -> Optional[Dict[str, Any]]:
        stored = market.setup_object.model_dump() if market.setup_object else {}
        proposed = plan.model_dump()
        intake = update.get(market_doc_key("intake_mode"), market.intake_mode.value)
        return History.changes(
            {**{field: stored.get(field) for field in _SETUP_FIELDS},
             "intake_mode": market.intake_mode.value},
            {**{field: proposed.get(field) for field in _SETUP_FIELDS}, "intake_mode": intake},
        )

    History.record(market.id, requesting_user, Actions.CHANGE_SETUP, kind=History.PLAN,
                   detail=setup)
    History.record(market.id, requesting_user, Actions.CHANGE_SETUP, kind=History.PRICING,
                   subject=lambda: Pricing.pricing_subject(plan),
                   detail=lambda: History.changes(
                       Pricing.pricing_fields(market.setup_object), Pricing.pricing_fields(plan)))
    History.record(market.id, requesting_user, Actions.ASSIGN, kind=History.RULES,
                   detail=lambda: History.changes(
                       assignment_rules(market.setup_object), assignment_rules(plan)))


def prepared_plan(market: Market, body: Dict[str, Any]) -> Dict[str, Any]:
    """The plan write's ``$set``, judged against ``market`` and not yet written.

    The one statement of what a plan write may carry and when; ``save_plan`` writes it, and the
    CSV start writes it in the same update as the form and the mapping it makes.
    """
    try:
        plan = SetupObject.model_validate(convert_keys_to_snake_case(body["setupObject"]))
    except ValidationError as e:
        logger.warning("Refused a plan for market %s: %s", market.id, parse_failure_detail(e))
        raise BadRequestError(field_named_copy("Invalid plan", e)) from e
    share = plan.assignment_options.max_half_table_proportion_per_section
    if share is not None and not 0 <= share <= 100:
        raise BadRequestError(
            "max_half_table_proportion_per_section must be between 0 and 100, or null for the "
            "default."
        )
    priced = Pricing.pricing_refusal(plan)
    if priced:
        raise BadRequestError(priced)
    update: Dict[str, Any] = {market_doc_key("setup_object"): convert_keys_to_camel_case(plan.model_dump())}

    if body.get("intakeMode") is not None:
        try:
            intake = IntakeMode(body["intakeMode"])
        except ValueError as e:
            raise BadRequestError(f"Unknown intake mode: {body['intakeMode']!r}.") from e
        if intake is not market.intake_mode:
            if market.phase is not MarketPhase.DRAFT:
                raise BadRequestError(
                    "How vendors reach a market can only be changed while it is a draft."
                )
            update[market_doc_key("intake_mode")] = intake.value

    # And the setup the same way, from leaving draft on (E31/F01/S02): restating it is not a change.
    setup_settled = setup_lock_reason(market)
    if setup_settled and setup_part(plan) != setup_part(market.setup_object):
        raise BadRequestError(setup_settled)

    # The plan saves as the organizer types, in every phase, and always carries the rules it holds;
    # restating the stored rules is not a change, and anything else is refused once they are
    # settled (E22/F02/S01).
    settled = assignment_rules_lock_reason(market)
    if settled and assignment_rules(plan) != assignment_rules(market.setup_object):
        raise BadRequestError(settled)
    return update


def save_review_highlights(
    market_id: str, keys: List[str], requesting_user: str
) -> List[str]:
    """Set which answers a reviewer reads first. Asks ``Actions.CHANGE_FORM``.

    The list IS the order the card leads with, so a repeat is dropped where it recurs rather than
    resorting what an organizer arranged. An empty list clears them, and clearing is a write of
    ``[]`` rather than a delete: absent and empty both mean "nothing is marked", and one shape for
    that keeps the card from having to tell them apart.

    Deliberately NOT gated on ``application_form_lock_reason``. That lock freezes the form the
    moment an applicant submits - which is the moment these first become knowable, because an
    organizer learns which answers they needed by reading real applications. A highlight that
    inherited the form's lock would be settable only before anyone could know what to set.
    """
    market = _load_market_to_change(market_id, requesting_user, Actions.CHANGE_FORM)

    seen: List[str] = []
    for key in keys:
        cleaned = key.strip()
        if cleaned and cleaned not in seen:
            seen.append(cleaned)

    markets_collection.update_one({"id": market_id}, market_doc_set("review_highlights", seen))
    History.record(market_id, requesting_user, Actions.CHANGE_FORM, kind=History.REVIEW_HIGHLIGHTS,
                   detail=lambda: History.changes(
                       {"review_highlights": market.review_highlights or []},
                       {"review_highlights": seen}))
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
    Raises a ``BadRequestError`` with the refusal's words otherwise; to someone outside the organization
    they never tell an organization address from a stranger's.
    """
    offered = PermissionsApi.follow_up_owners_for(market, organization, requester.user_id)
    user = UsersApi.get_user(email) if email else None
    if user is not None and user.id in offered:
        return MarketPerson(user_id=user.id, email=user.email)
    if market.organization_id and not PermissionsApi.in_market_organization(
            market, organization, requester.user_id):
        raise BadRequestError("You can hand a follow-up only to someone named in this market's roles.")
    raise BadRequestError("A follow-up's owner must have a role on this market.")


def reviewer_candidates(
    market: Market, organization: Optional[Organization], chooser: Any,
) -> List[MarketPerson]:
    """Whom this person may choose as a reviewer (E38/F07/S02): everyone they may hand a follow-up
    to (``follow_up_owners_for``), so someone outside the market's organization is never offered
    its people."""
    people = []
    for user_id in PermissionsApi.follow_up_owners_for(
            market, organization, chooser.id if chooser else None):
        user = UsersApi.get_user_by_id(user_id)
        if user:
            people.append(MarketPerson(user_id=user.id, email=user.email))
    return people


REVIEWERS_SETTLED = (
    "The review is closed: the verdicts settled when this market entered Assignment, so its "
    "reviewers no longer change."
)


def choose_reviewers(market_id: str, addresses: Any, requesting_user: str) -> Dict[str, Any]:
    """Choose who reviews this market's applications, and deal the open ones among them
    (E38/F07/S02). Asks ``Actions.CHOOSE_REVIEWERS``.

    ``addresses`` is the whole team, in any case and order; an empty list removes every reviewer.
    Refused on an archived market, once the review has closed, and for an address the chooser is
    not offered (``reviewer_candidates``, asked of the same list), which the refusal names; a
    current reviewer they are not offered may stay. Answers the team as the market read serves it, and how many it dealt.
    """
    if not isinstance(addresses, list) or not all(isinstance(a, str) for a in addresses):
        raise BadRequestError("reviewers is a list of addresses")
    market = _load_market_to_change(market_id, requesting_user, Actions.CHOOSE_REVIEWERS)
    if not review_is_open(market.phase):
        raise BadRequestError(REVIEWERS_SETTLED)
    organization = _load_organization(market.organization_id)
    chooser = UsersApi.get_user(requesting_user)
    offered = set(PermissionsApi.follow_up_owners_for(
        market, organization, chooser.id if chooser else None))
    current = {
        normalized_email(person.email): person for person in ReviewTeam.team_of(market).reviewers}
    chosen = []
    for address in addresses:
        person = current.get(normalized_email(address))
        if person is None:
            user = UsersApi.get_user(normalized_email(address))
            if user is None or user.id not in offered:
                raise BadRequestError(
                    f"{address.strip()} is not someone you can choose as a reviewer on this "
                    "market.")
            person = MarketPerson(user_id=user.id, email=user.email)
        chosen.append(person)
    team, dealt = ReviewTeam.choose(market, organization, chosen, requesting_user)
    return {"reviewTeam": ReviewTeam.served(team, market, organization), "dealt": dealt}


def save_rejection_rules(
    market_id: str, rules: Any, requesting_user: str
) -> List[Dict[str, Any]]:
    """Set which answers reject an application automatically (E33/F03/S01). Asks
    ``Actions.CHANGE_FORM``.

    The rules' own write, the whole list at once like the highlights. Not gated on the form's lock:
    rules are worth most once applications arrive, which is when the form freezes. Refused once the
    market can no longer return to review (``rejection_rules_lock_reason``). A rule narrowed or
    taken away returns what it rejected to open only for someone who may overturn an automatic
    rejection (``may_overturn``, E38/F06/S01); for anyone else those rejections stand.
    """
    market = _load_market_to_change(market_id, requesting_user, Actions.CHANGE_FORM)
    settled = rejection_rules_lock_reason(market.phase)
    if settled:
        raise BadRequestError(settled)
    prepared = RejectionRules.Rulebook(market).prepared(rules)
    markets_collection.update_one({"id": market_id}, market_doc_set("rejection_rules", prepared))
    # Every undecided application, and every one a rule rejected, is judged again (E33/F03/S02).
    judged = market.model_copy(update={"rejection_rules": [RejectionRule(**r) for r in prepared]})
    verdicts = RejectionRules.judge(RejectionRules.Rulebook(judged), market_id,
                                    overturns=may_overturn(requesting_user, market))
    History.record(market_id, requesting_user, Actions.CHANGE_FORM, kind=History.REJECTION_RULES,
                   detail=lambda: _with_counts(History.changes(
                       {"rejection_rules": [rule.model_dump() for rule in market.rejection_rules or []]},
                       {"rejection_rules": [rule.model_dump() for rule in judged.rejection_rules or []]},
                   ), verdicts))
    # What the rules returned to open is an arrival, dealt to the next reviewer (E38/F07/S03).
    if verdicts.returned:
        ReviewTeam.deal_arrivals(judged, requesting_user, Actions.CHANGE_FORM)
    return prepared


def save_application_form(market_id: str, application_form_data: dict, requesting_user: str) -> dict:
    """Save or update the application form for a market.

    The only writer of ``Market.application_form`` on an existing market - the whole-market PUT
    that once carried one is gone (E21/F03/S06) - so every write passes the lock below.

    Returns the saved ``ApplicationForm`` as a camelCase dict on success.

    Raises:
        MarketNotFoundError: no such market
        BadRequestError: validation failure
        ForbiddenError: ``Actions.CHANGE_FORM`` refuses the user
        ApplicationFormLockedError: phase gate or D9 lock prevents editing
    """
    market = _load_market_to_change(market_id, requesting_user, Actions.CHANGE_FORM)
    form_dict, verdicts = write_application_form(
        market, application_form_data, overturns=may_overturn(requesting_user, market))
    History.record(market_id, requesting_user, Actions.CHANGE_FORM, kind=History.FORM,
                   detail=lambda: _with_counts(form_changes(market, form_dict), verdicts))
    if verdicts.returned:
        ReviewTeam.deal_arrivals(market, requesting_user, Actions.CHANGE_FORM)
    return form_dict


def _with_counts(
    detail: Optional[Dict[str, Any]], verdicts: RejectionRules.Judged,
) -> Optional[Dict[str, Any]]:
    """A write's detail with what the rules decided as it landed; a write that changed nothing
    stays unrecorded, as the rules judged nothing new."""
    return {**detail, **verdicts.counts()} if detail else None


def write_application_form(
    market: Market, application_form_data: dict, overturns: bool = True,
) -> Tuple[dict, RejectionRules.Judged]:
    """Judge and store the form on ``market``, loaded and asked by the caller, and return it as
    stored with what the rules decided against it; the caller records it, as the action it was -
    the form write, or an amendment. ``overturns`` is whether the writer may overturn an automatic
    rejection, as ``RejectionRules.judge`` takes it."""
    form_dict = prepared_application_form(market, application_form_data)
    markets_collection.update_one(
        {"id": market.id},
        {"$set": {"applicationForm": form_dict}}
    )
    # The rules stand against the form as it now is (E33/F03/S02): a question taken away judges
    # nobody, and what it rejected is judged again.
    rewritten = load_market_context(market.id)
    if rewritten is not None and rewritten.market is not None:
        return form_dict, RejectionRules.judge(
            RejectionRules.Rulebook(rewritten.market), market.id, overturns=overturns)
    return form_dict, RejectionRules.Judged()


def form_changes(market: Market, saved: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """The questions a form write changed, by key, as they were and as they are, and the order and
    the unasked essentials when those changed; None when the write changed nothing."""
    def shape(form: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        fields = (form or {}).get("fields") or []
        return {
            "questions": {field.get("key"): field for field in fields},
            "order": [field.get("key") for field in fields],
            "unasked_essentials": (form or {}).get("unasked_essentials") or [],
        }

    before = shape(_application_form_dump(market))
    after = shape(convert_keys_to_snake_case(saved))
    questions = History.changes(before.pop("questions"), after.pop("questions"))
    rest = History.changes(before, after)
    if not questions and not rest:
        return None
    return {
        "before": {**({"questions": questions["before"]} if questions else {}),
                   **(rest["before"] if rest else {})},
        "after": {**({"questions": questions["after"]} if questions else {}),
                  **(rest["after"] if rest else {})},
    }


def prepared_application_form(market: Market, application_form_data: dict) -> dict:
    """The form as it would be stored, judged against ``market`` - its lock, its validator - and
    not yet written.

    The one statement of what a form write may be; ``save_application_form`` writes it, and the
    CSV start writes it in the same update as the plan and the mapping it makes.
    """
    _assert_application_form_editable(market)

    application_form = parsed_application_form(market.id, application_form_data)

    stored_form = market.application_form
    application_form = _normalized_application_form(
        application_form,
        published_at=stored_form.published_at if stored_form else None,
        essential_options=stored_form.essential_options if stored_form else None,
    )
    return convert_keys_to_camel_case(application_form.model_dump())


def parsed_application_form(market_id: str, application_form_data: Any) -> ApplicationForm:
    """The form a request body proposes, or a ``BadRequestError`` naming each field it gets wrong.

    The one parse of a proposed form, for the form write.
    """
    try:
        return ApplicationForm.model_validate(application_form_data)
    except ValidationError as e:
        logger.warning(
            "Refused an application form for market %s: %s", market_id, parse_failure_detail(e),
        )
        raise BadRequestError(field_named_copy("Invalid application form data", e)) from e


def get_application_form(market_id: str, requesting_user: str) -> dict:
    """Retrieve the application form for a market along with its lock state.

    Asks ``Actions.READ``. ``application_form`` is camelCase, matching the
    front-end contract and the persisted market document. ``editable``/``lock_reason``
    let the builder render read-only before an organizer invests work in a locked form.

    ``essential_options`` is what the essential questions currently offer: the frozen
    snapshot once one exists, otherwise the market plan as it stands. The builder renders
    the always-present essential questions from it.
    """
    market = _load_market_for(market_id, requesting_user, Actions.READ)

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
    """Both kinds of note on this market's vendors, by address (E31/F04). Asks ``Actions.READ``:
    everyone with a role reads them; the vendor, who has none, never does.

    Each vendor's own request is joined in from their application, so every page that shows a
    vendor - review, Vendors, the door - reads both kinds from one place, each under its own key.
    """
    _load_market_for(market_id, requesting_user, Actions.READ)
    notes = VendorNotes.notes_for_market(market_id)
    for application in ApplicationsApi.list_applications_for_market(market_id):
        request = str(
            ApplicationsApi.effective_answers(application).get(EssentialFields.REQUEST_KEY) or "")
        email = str(application.get("applicant_email") or "").strip().lower()
        if request.strip() and email:
            notes.setdefault(email, VendorNotes.no_notes())["request"] = request.strip()
    for entry in notes.values():
        entry.setdefault("request", "")
    return notes


def save_vendor_note(market_id: str, vendor_email: str, text: str, requesting_user: str) -> None:
    """Replace the organizer's note on one vendor. Asks ``Actions.WRITE_VENDOR_NOTES``,
    which a door volunteer recording "chair given" meets; an archived market refuses it."""
    _load_market_to_change(market_id, requesting_user, Actions.WRITE_VENDOR_NOTES)
    before, after = VendorNotes.write_note(market_id, vendor_email, text, requesting_user)
    _record_note(market_id, vendor_email, requesting_user, History.NOTE, "note", before, after)


def mark_vendor_request_handled(
    market_id: str, vendor_email: str, handled: bool, requesting_user: str,
) -> None:
    """Mark a vendor's request handled, or take the mark back. Asks ``Actions.WRITE_VENDOR_NOTES``."""
    _load_market_to_change(market_id, requesting_user, Actions.WRITE_VENDOR_NOTES)
    was = VendorNotes.mark_request_handled(market_id, vendor_email, handled, requesting_user)
    _record_note(market_id, vendor_email, requesting_user, History.REQUEST_HANDLED, "handled",
                 was, handled)


def _record_note(
    market_id: str, vendor_email: str, requesting_user: str, kind: str, field: str,
    before: Any, after: Any,
) -> None:
    History.record(market_id, requesting_user, Actions.WRITE_VENDOR_NOTES, kind=kind,
                   vendors=[vendor_email],
                   detail=lambda: History.changes({field: before}, {field: after}))
