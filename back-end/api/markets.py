from datetime import datetime, timezone
import unicodedata
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
    traceback_without_messages,
)
from datatypes import (
    FORM_FIELD_KEY_PATTERN,
    Application,
    ApplicationForm,
    ApplicationStatus,
    AssignmentStatistics,
    EssentialFormOptions,
    FloorplanObject,
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
    TableTypeObject,
    UnassignedTableEntry,
    User,
    VendorAssignmentResult,
    intake_mode_from_market_document,
    market_name_slug,
    organization_people_of,
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
from assignment.utils import convert_keys_to_snake_case, convert_keys_to_camel_case, snake_to_camel
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
    market_from_document,
    leave_out_what_no_read_serves,
)
from market_write import (
    MARKET_CHANGED, MarketChanged, MarketNotFoundError, document_as_read, write_market,
)
import api.market_actions as Actions
import api.permissions as PermissionsApi
import market_deletion as MarketDeletion
import history as History
import floorplan_limits as FloorplanLimits
import layout as Layout
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
import services.gridfs_service as GridfsService
from tombstone import live, new_tombstone, tombstone_of
from utils.email_address import normalized_email

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

db = get_database()
markets_collection = db["markets"]

VALID_FORM_FIELD_TYPES = {"text", "number", "select", "multi_select", "checkbox", "date", "email"}



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
    return _organization_from_document(org_dict), org_dict


def _organization_from_document(org_dict: Dict[str, Any]) -> Optional[Organization]:
    """A stored organization as its model, or None, logged, when the document fails validation:
    the market read and the Markets list parse it here alike, so both grant through it the same."""
    try:
        return Organization(**{k: v for k, v in org_dict.items() if k != '_id'})
    except Exception as e:
        logger.warning(
            "Stored organization %s failed validation: %s", org_dict.get('id'),
            parse_failure_detail(e),
        )
        return None


def _load_organization(organization_id: Optional[str]) -> Optional[Organization]:
    """Resolve a market's organization, or None when absent or unparseable."""
    organization, _ = _load_organization_context(organization_id)
    return organization


class LoadedMarket(NamedTuple):
    """A market and its organization, as a loader read them to ask a row (``_load_market_for``)."""
    market: Market
    organization: Optional[Organization]


def _load_market_for(market_id: str, requesting_user: str, action: Actions.Action) -> Market:
    """Load a market and assert the requesting user may take ``action`` on it (E39/F01/S01)."""
    return _load_market_and_organization_for(market_id, requesting_user, action).market


def _load_market_and_organization_for(
    market_id: str, requesting_user: str, action: Actions.Action,
) -> LoadedMarket:
    """``_load_market_for``, with the organization it read to ask the row, for a write that asks
    another row too and so need not read the organization again."""
    market_dict = markets_collection.find_one(live({"id": market_id}))
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

    return LoadedMarket(market, organization)


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
#: may see it, who owns it and whether to keep it - which are not changes to it (bug 30). Every
#: other row is refused on an archived market whoever may, a row added later included.
ARCHIVED_STILL_TAKES = frozenset({
    Actions.READ, Actions.READ_HISTORY, Actions.EXPORT_CSV, Actions.MANAGE_EDITORS_AND_VIEWERS,
    Actions.MANAGE_ADMINS, Actions.HAND_ON_MARKET, Actions.DELETE_MARKET,
})

#: The rows that read the market rather than change it.
READING_ROWS = frozenset({Actions.READ, Actions.READ_HISTORY, Actions.EXPORT_CSV})
#: The rows a person may hold and still change nothing: the reading rows, and who may be chosen as a
#: reviewer, which changes nothing until someone is chosen and then lets them give verdicts by the
#: giving row (E38/F07/S03).
CHANGING_NOTHING = READING_ROWS | {Actions.REVIEW_WHEN_CHOSEN}


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
    role: Optional[MarketRole], phase: MarketPhase, rows: Mapping[str, Any], chosen: bool = False,
) -> Dict[str, Optional[str]]:
    """What a person holding ``role`` is told of every action on a market in ``phase`` holding
    ``rows`` of the table, by row id (E39/F01/S02, S03).

    Each row is asked by ``Actions.role_refusal`` of the role already resolved, the ranking the
    writes' ``Actions.refusal`` asks after resolving it: the market read resolves it once, and the
    markets list from the market and the organization its memo holds (``_summary_role``); both
    pass the market's rows as the read parses them. Served as ``actionRefusals``, so every screen offers
    a control on the answer of the action it takes. The rules of a market's life other than the
    archived one are each served on their own. ``chosen`` says whether the person is one of the
    market's chosen reviewers (``Actions.is_chosen``), who may take the giving row by it.
    """
    return _answers(phase, lambda row: Actions.role_refusal(row, role, rows, chosen))


def read_only_reason(market: Market, refusals: Dict[str, Optional[str]]) -> Optional[str]:
    """Why this person may change nothing on this market, or None while they may change something
    (E26/F08/S01, E39/F01/S02): the archived rule, then whether any of the table's changing rows
    is theirs. Served as ``readOnlyReason``, which the frame says once for every page (T15)."""
    archived = archived_refusal(market)
    if archived:
        return archived
    if any(
        refusals[row.id] is None
        for row in Actions.ACTIONS.values() if row not in CHANGING_NOTHING
    ):
        return None
    return VIEWER_REFUSAL


def review_is_open(phase: MarketPhase) -> bool:
    """Whether Assignment still lies ahead of this market, the one rule both the verdicts and the
    automatic rejections settle on (E36/F01/S01). A rule and a reviewer judge the same applications,
    so they close together; derived from the transition table rather than listed.

    Ahead, not merely reachable: Back to review (T207) leads from ``assignment`` to the stage, so
    asking whether the stage can be reached would open the review in Assignment itself. The review
    opens again only once the market is back in the stage.
    """
    return (
        phase is not MarketPhase.ASSIGNMENT
        and route_between(phase.value, MarketPhase.ASSIGNMENT.value) is not None
    )


#: What to do instead once the review cannot reopen: applicants have read their results, or the
#: market went live, so who has a table changes seat by seat.
_A_SEAT_INSTEAD = "To change who has a table, place or free a seat on Assignments."

#: Why the review is closed, by where the market stands (T207), in the words of each subject that
#: closes with it: the verdicts and the automatic rejections.
_REVIEW_CLOSED = {
    "allocating": (
        "The review is closed while tables are allocated. To change a verdict, choose Back to "
        "review under More… on the phase rail; tables are then allocated again."),
    "published": f"The review closed when results were published. {_A_SEAT_INSTEAD}",
    "live": f"The review closed when the market went live. {_A_SEAT_INSTEAD}",
}
_RULES_CLOSED = {
    "allocating": (
        "The automatic rejections are closed while tables are allocated. To change a rule, choose "
        "Back to review under More… on the phase rail; tables are then allocated again."),
    "published": f"The automatic rejections closed when results were published. {_A_SEAT_INSTEAD}",
    "live": f"The automatic rejections closed when the market went live. {_A_SEAT_INSTEAD}",
}


def _why_the_review_is_closed(market: Market) -> Optional[str]:
    """Why this market's review is closed, as a key of ``_REVIEW_CLOSED``, or None while it is open
    (T207). The one place the cases are told apart, so the verdicts, the automatic rejections and
    the reviewers say the same thing in every phase.

    Archived is the caller's: every write there gives the archived refusal. Published comes before
    the phase, since no way back is left once applicants have read their results; a Google Form
    market that went live before it could publish them (ADR 0022) is told the market went live.
    """
    if review_is_open(market.phase):
        return None
    if market.results_published:
        return "published"
    if market.phase is MarketPhase.ASSIGNMENT:
        return "allocating"
    return "live"


def review_closed_reason(market: Market) -> Optional[str]:
    """Why the review is closed on this market and what to do instead, or None while it is open
    (T207): Back to review while tables are allocated, a seat on Assignments once results are
    published or the market went live, the archived refusal on an archived market. Served as
    ``verdictsSettledReason``, which the Applications tab says in place of the review's controls,
    and returned by ``verdict_refusal``."""
    archived = archived_refusal(market)
    if archived:
        return archived
    why = _why_the_review_is_closed(market)
    return _REVIEW_CLOSED[why] if why else None


def verdict_refusal(
    user_email: str, market: Market, organization: Optional[Organization],
) -> Optional[str]:
    """Why this person cannot give a verdict here, or None while they can (E34).

    A verdict - and a follow-up, a claim on a card - is the table's "Give verdicts and follow-ups"
    row (E34/F01/S01, E39/F01/S01), and open while the review is (E36/F01/S01): from assignment on,
    a verdict is the review's record, changed through Back to review until results are published
    (T207), or after that with a seat placed or freed by hand (``review_closed_reason``).
    The screens read its parts from the market read: the row in ``actionRefusals`` and the review's
    close as ``verdictsSettledReason``.
    """
    refused = archived_refusal(market) or Actions.refusal(
        Actions.GIVE_VERDICTS, user_email, market, organization)
    return refused or review_closed_reason(market)


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
    return _load_market_and_organization_to_change(market_id, requesting_user, action).market


def _load_market_and_organization_to_change(
    market_id: str, requesting_user: str, action: Actions.Action,
) -> LoadedMarket:
    """``_load_market_to_change``, with the organization it read to ask the row."""
    loaded = _load_market_and_organization_for(market_id, requesting_user, action)
    refusal = archived_refusal(loaded.market)
    if refusal:
        raise MarketArchivedError(refusal)
    return loaded


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


def rejection_rules_lock_reason(market: Market) -> Optional[str]:
    """Why the automatic rejections may no longer change, or None while they can (E33/F03/S01).

    A rule judges applications in review, so the rules are open exactly as long as the review is
    and closed for the same reason (``_why_the_review_is_closed``, T207), said in their own
    subject. Not the form's lock: the form freezes at the first application, and the rules are
    worth most once applications are arriving.
    """
    archived = archived_refusal(market)
    if archived:
        return archived
    why = _why_the_review_is_closed(market)
    return _RULES_CLOSED[why] if why else None


def rejection_facts(market: Market) -> Dict[str, Any]:
    """What the review setup needs to offer the rules, served on the market read: the questions a
    rule may name, the rules as they stand against the current form, and whether they may change."""
    book = RejectionRules.Rulebook(market)
    return {
        "rejectionQuestions": book.questions,
        "rejectionRules": book.served_rules(),
        "rejectionRulesLockReason": rejection_rules_lock_reason(market),
    }


def price_facts(market: Market) -> Dict[str, Any]:
    """The questions the price groups read, served on the market read: adding a vendor asks the
    form's own of them, and updating any of them asks the row "Update info the assignment or price
    reads" (E43/F01/S03)."""
    return {"priceReads": Pricing.Groups(market).keys()}


# The menu's own name for the move back to draft (``pathTransitionLabel`` in
# ``front-end/src/utils/marketGuide.ts``).
_WAY_BACK = "Reopen for editing"


def _since_leaving_draft(market: Market) -> str:
    """When a market left draft, as its own path says it: a CSV market imports its Google Form's
    responses rather than opening applications (E31/F03/S03, E32/F02/S01)."""
    if market.intake_mode is IntakeMode.FORM:
        return "once applications have opened"
    return "once its responses have been imported"


def setup_part(plan: Optional[SetupObject]) -> Dict[str, Any]:
    """The part of a plan that is the setup, in one comparable shape (E31/F01/S02).

    Everything on Market Setup: the dates, tiers, locations, sections and their tables, the
    prices (E43/F01/S01), and of the layouts what settles: each floorplan's seats and the
    market's table types (``layout.settled_part``), never where a table stands, which a layout's
    save still changes past draft (``layout.settled_layout_refusal``). Not the assignment rules
    (``made_from.assignment_rules``), which ride in the same object and keep a lock of their own.
    """
    if plan is None:
        return {}
    shape = plan.model_dump(include={"market_dates", "tiers", "locations", "sections", "pricing"})
    shape.update(Layout.settled_part(plan))
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
    return markets_collection.find_one(live({"id": market_id}))


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


def _readable_market(document: Dict[str, Any]) -> Optional[Market]:
    """A stored market as its model, or None, logged, when the model refuses the document: the
    market read and the Markets list parse it here alike, so a document one cannot read the other
    does not serve."""
    try:
        return market_from_document(document)
    except Exception as e:
        _log_unreadable_market(document.get('id'), e)
        return None


def read_refused(market: Market, role: Optional[MarketRole]) -> bool:
    """Whether the market read answers a market as absent to someone holding ``role``, the role
    ``market_role_of`` gives them.

    The one question the read (``get_market_for_user``) and the Markets list
    (``get_markets_for_user``) both ask of a market ``_readable_market`` read, so every card the
    list shows opens.
    """
    return Actions.role_refusal(Actions.READ, role, market.permissions) is not None


def load_market_context(market_id: str) -> Optional[MarketContext]:
    """Load a market with its parsed model and owning organization, or None if absent or being
    deleted (``tombstone``)."""
    market_dict = markets_collection.find_one(live({"id": market_id}))
    if not market_dict:
        return None

    market = _readable_market(market_dict)
    if market is None:
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


def leave_out_every_answer(market_document: Dict[str, Any]) -> None:
    """Serve a market's columns without ``answers``, as a copy, so the document it was read from
    keeps them (ADR 0023). The read keeps them for someone who may change the form while it can
    still change; every other answer that holds a market asks this unconditionally."""
    key = market_doc_key("example_columns")
    columns = market_document.get(key)
    if isinstance(columns, list):
        market_document[key] = [
            {field: value for field, value in column.items() if field != "answers"}
            for column in columns]


def get_market_for_user(user_email: str, market_id: str) -> Optional[Dict[str, Any]]:
    """Get a market by id, checking user has access."""
    context = load_market_context(market_id)
    if context is None or context.market is None:
        return None

    market_dict = context.document
    market = context.market
    org_dict = context.organization_dict

    # The person's role, resolved once: every answer below is asked of it (E39/F01/S02), and of
    # whether they are a chosen reviewer, which lets them give verdicts (E38/F07/S03).
    # The reader's account is read here once, and every other account the read names through
    # ``accounts``, all of them in one database read however many people the lists below name
    # (E38/F12/S01, T204), and only once the reader is let in: a refused read reads no one else.
    reader = UsersApi.get_user(user_email)
    user_role = PermissionsApi.get_user_market_role(
        user_email, market, context.organization, user=reader)
    chosen = Actions.is_chosen(user_email, market)
    if read_refused(market, user_role):
        return None
    accounts = _Accounts(reader, _named_by_the_read(market, context.organization))

    market_dict['_id'] = str(market_dict['_id'])
    leave_out_what_no_read_serves(market_dict)
    _stamp_effective_market_state(market_dict, market.phase)
    # The form lock rides on the market every screen reads (E21/F02/S03): it depends on whether an
    # application exists, which only the server knows, and the store re-reads the market after every
    # write - so a transition reaches the form builder the moment it lands. Served, never stored.
    form_lock_reason = application_form_lock_reason(market)
    market_dict['applicationFormLockReason'] = form_lock_reason
    # So does the assignment rules' (E22/F02/S02): the rules page mirrors the plan write's refusal
    # from the market it holds, rather than deciding the phases for itself.
    market_dict['assignmentRulesLockReason'] = assignment_rules_lock_reason(market)
    # And whether the assignment may run (E36/F04/S02): not once results are published.
    from api.placements import assign_refusal
    market_dict['assignRefusalReason'] = assign_refusal(market)
    # And what an automatic rejection may name, and whether it may change (E33/F03/S01).
    market_dict.update(rejection_facts(market))
    # And whether the review setup's two "none"s were chosen (T206), false when the document has
    # neither, as the model reads them.
    market_dict['nothingLeadsTheCard'] = market.nothing_leads_the_card
    market_dict['noAutomaticRejections'] = market.no_automatic_rejections
    # And what the price groups read, which adding a vendor asks and updating guards (E43/F01/S03).
    market_dict.update(price_facts(market))
    # And the setup's (E31/F01/S02), for Market Setup to read as settled rather than as editable.
    market_dict['setupLockReason'] = setup_lock_reason(market)
    # And the plan's revision, which Market Setup sends back with every save (T274): a market that
    # never stored one reads as 0, as the model does.
    market_dict[PLAN_REVISION_KEY] = market.plan_revision
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
    refusals = role_action_refusals(user_role, market.phase, market.permissions, chosen)
    market_dict['actionRefusals'] = refusals
    market_dict['readOnlyReason'] = read_only_reason(market, refusals)
    # And the table itself, for Manage market to show every row's role and where it came from
    # (E39/F01/S03): the rows this market holds, the built-in default for the rest.
    market_dict['permissionTable'] = Actions.table(market)
    # The rules of the market's life the table never overrides, each on its own: the verdicts
    # settle on entering assignment, served as why the review is closed (E36/F01/S01, T207), a
    # vendor is added from the assignment on (E36/F03/S01), and results wait for the allocation
    # (E36/F04/S01), with how many will read each outcome for the confirmation of someone who may
    # publish now.
    verdicts_settled = review_closed_reason(market)
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
    # What would refuse each move open from this phase (E31/F02/S01), judged as the transition
    # endpoint judges it, so the rail can disable a move and name why before anyone clicks it.
    market_dict['transitionBlockers'] = {
        to_phase: [blocker.payload() for blocker in blockers]
        for to_phase, blockers in transition_verdicts(market, db).items()
    }
    # Whether this deployment has Discord's values (E46/F01/S02): the Discord card offers nothing
    # without them, and says so.
    market_dict['discordSetUp'] = DiscordClient.credentials() is not None
    # And each vendor as the last "Check Discord" found them, as the pages show them (E46/F01/S05):
    # "Possible match" and "Check again" are worked out here, once, against the applications as
    # the organizer reads them now, so the Vendors page, the drawer and the export agree. Read
    # only once a check has run.
    from api.discord_connection import leave_out_what_is_not_served, shown_vendors
    market_dict['discordVendors'] = [vendor.served() for vendor in shown_vendors(market).values()]
    leave_out_what_is_not_served(market_dict)
    if form_lock_reason is not None or Actions.role_refusal(
            Actions.CHANGE_FORM, user_role, market.permissions) is not None:
        leave_out_every_answer(market_dict)
    if market.organization_id and org_dict:
        market_dict['organization_name'] = org_dict.get('name')
    # Everyone with access, at the role that counts and where it comes from, which Manage market
    # lists (E38/F12/S01). The organization's people are named only to a reader who belongs to it or
    # may give and take roles here (the table's row); anyone else reads the market's own roles.
    reader_id = reader.id if reader else None
    in_organization = PermissionsApi.in_market_organization(market, context.organization, reader_id)
    may_give_roles = Actions.role_refusal(
        Actions.MANAGE_EDITORS_AND_VIEWERS, user_role, market.permissions) is None
    market_dict['peopleWithAccess'] = [
        {"userId": person.user_id, "email": person.email, "role": person.role.value,
         "marketRole": person.market_role.value if person.market_role else None,
         "organizationRole": person.organization_role,
         "fromOrganization": person.from_organization}
        for person in PermissionsApi.people_with_access(
            market, context.organization, in_organization or may_give_roles, accounts.email_of)
    ]
    # Whether this reader may open Manage organization, which the list points to.
    market_dict['inOrganization'] = in_organization
    # Deprecated, for a tab on the old bundle, whose Manage market lists the market's own roles by
    # it; the next release removes it.
    market_dict['role_emails'] = {
        uid: account.email
        for uid in (market_dict.get('roles') or {}) if (account := accounts.of(uid))
    }
    # Whom this reader may hand a follow-up to (T15), served only to someone who may give a verdict
    # and so name one (the table's verdicts row, a chosen reviewer's too): the organization's
    # people too, if the reader is one.
    may_give_verdicts = Actions.role_refusal(
        Actions.GIVE_VERDICTS, user_role, market.permissions, chosen) is None
    follow_up_owners = [
        account for uid in PermissionsApi.follow_up_owners_for(
            market, context.organization, reader_id)
        if (account := accounts.of(uid))
    ] if may_give_verdicts else []
    market_dict['peopleOnMarket'] = [account.email for account in follow_up_owners]
    # Who reviews which application (E38/F07/S02): the chosen reviewers to every reader, never the
    # turn, which the stored team is served over, and whom this reader may choose from, served only
    # to someone who may choose them while the review is open, when the panel offers the choice:
    # those they may hand a follow-up to whose role the table lets be chosen.
    market_dict['reviewTeam'] = ReviewTeam.served(
        ReviewTeam.team_of(market), market, context.organization)
    may_choose = review_is_open(market.phase) and Actions.role_refusal(
        Actions.CHOOSE_REVIEWERS, user_role, market.permissions) is None
    candidates = [
        account.email
        for uid in reviewer_candidate_ids(market, context.organization, reader)
        if (account := accounts.of(uid))
    ] if may_choose else []
    market_dict['reviewerCandidates'] = sorted(candidates)
    return market_dict

def get_markets_by_owner_email(owner_email: str) -> List[Dict[str, Any]]:
    """Get all markets by owner. (Deprecated - use get_markets_for_user instead)"""
    # Find markets where owner_email has OWNER role
    return list(markets_collection.find(live({f"roles.{owner_email}": MarketRole.OWNER.value})))


def _named_by_the_read(market: Market, organization: Optional[Organization]) -> List[str]:
    """Every user id the market read can name: the market's roles, and its organization's owner,
    admins and members when it is the market's. ``people_with_market_role``,
    ``follow_up_owners_for`` and ``reviewer_candidate_ids`` only ever name ids from these, so the
    read needs no account beyond them. Reading an account here serves it to no one: each list keeps
    its own rule on whom a reader is served."""
    named = list(market.roles or {})
    if organization is not None and organization.id == market.organization_id:
        named += [organization.owner, *organization.admins, *organization.members]
    return named


class _Accounts:
    """Memo for the accounts the read of one market names, by user id: the reader's, already read
    by address, and every other one it can name read up front in one ``get_users_by_ids``, however
    many of its lists name them (T204)."""

    def __init__(self, reader: Any, named: List[str]) -> None:
        others = [user_id for user_id in dict.fromkeys(named) if user_id and not (
            reader and user_id == reader.id)]
        # An id with no account is remembered as None, so it is never read again alone.
        self._by_id: Dict[str, Any] = dict.fromkeys(others)
        self._by_id.update(UsersApi.get_users_by_ids(others))
        if reader:
            self._by_id[reader.id] = reader

    def of(self, user_id: str) -> Any:
        """The account with this id, or None when there is none; an id the read did not name up
        front, which none of its lists makes, falls back to a read of its own."""
        if user_id not in self._by_id:
            self._by_id[user_id] = UsersApi.get_user_by_id(user_id)
        return self._by_id[user_id]

    def email_of(self, user_id: str) -> Optional[str]:
        """The address of the account with this id, or None when there is none."""
        account = self.of(user_id)
        return account.email if account else None


class _SummaryLookups:
    """Memo for the organization reads a market list makes.

    Decorating one market costs an organization read, and a list repeats the same few
    organizations across every entry. The organizations the caller already fetched seed the memo,
    so the common case - every market belonging to an organization the user is a member of -
    costs no organization read at all.
    """

    def __init__(self, organizations: Optional[List[Dict[str, Any]]] = None) -> None:
        self._organizations: Dict[str, Any] = {org['id']: org for org in (organizations or [])}
        self._models: Dict[str, Optional[Organization]] = {}

    def organization(self, org_id: str) -> Optional[Dict[str, Any]]:
        if org_id not in self._organizations:
            self._organizations[org_id] = OrgsApi.get_organization(org_id)
        return self._organizations[org_id]

    def organization_model(self, org_id: Optional[str]) -> Optional[Organization]:
        """The organization as the market read parses it, so it grants what the read grants:
        nothing when its document fails validation."""
        if not org_id:
            return None
        if org_id not in self._models:
            org = self.organization(org_id)
            self._models[org_id] = _organization_from_document(org) if org else None
        return self._models[org_id]


def _decorate_market_summary(
    market: Dict[str, Any], parsed: Market, user_role: Optional[MarketRole],
    lookups: _SummaryLookups, *, chosen: bool,
) -> Dict[str, Any]:
    """Add the read-time fields every market list entry carries to the stored document ``market``,
    whose model ``parsed`` is, as ``_readable_market`` read it. ``chosen`` says whether the reader
    is one of the market's chosen reviewers, as the read asks it (``Actions.is_chosen``).

    Kept in one place so a market exposes the same derived state - phase included -
    whether it was served by the list endpoint or by ``get_market_for_user``.
    """
    market['_id'] = str(market['_id'])
    leave_out_what_no_read_serves(market)
    # A Discord check's stored inputs, which no list entry serves, as no market read does.
    from api.discord_connection import leave_out_what_is_not_served
    leave_out_what_is_not_served(market)
    # Every answer a market keeps, which would grow the list by every market it names (ADR 0023).
    leave_out_every_answer(market)
    phase = phase_from_market_document(market)
    _stamp_effective_market_state(market, phase)
    # The table's answers for the role the entry names, asked of the market's rows as the read
    # parses them, so the card offers Manage on its row as the market's own page does (E39/F01/S02),
    # and of whether the reader is chosen, which lets them give verdicts (E38/F07/S03).
    market['actionRefusals'] = role_action_refusals(user_role, phase, parsed.permissions, chosen)
    organization_id = market_doc_field(market, 'organization_id')
    if organization_id:
        org = lookups.organization(organization_id)
        if org:
            market['organization_name'] = org.get('name')
    return market


def _summary_role(market: Market, user_id: str, lookups: _SummaryLookups) -> Optional[MarketRole]:
    """The role a list entry names: the one ``get_user_market_role`` would serve on the market.

    Worked by the same rule, from the organization the list's memo already holds, so a card offers
    Manage to exactly the people the market's own page lets manage it: an organization's admins
    run its markets, and the list called them viewers.
    """
    return PermissionsApi.market_role_of(
        user_id, market, lookups.organization_model(market.organization_id))


def _listed(
    document: Dict[str, Any], user_id: str, user_email: str, lookups: _SummaryLookups,
) -> Optional[Dict[str, Any]]:
    """A stored market as its list entry, or None when the market read would not serve it to this
    reader: the list asks the read's own question (``read_refused``), so no card opens on "not
    found". The reader is named by id, as roles are, and by address, as chosen reviewers are."""
    market = _readable_market(document)
    if market is None:
        return None
    role = _summary_role(market, user_id, lookups)
    if read_refused(market, role):
        return None
    return _decorate_market_summary(
        document, market, role, lookups, chosen=Actions.is_chosen(user_email, market))


def get_markets_for_user(user_email: str) -> List[Dict[str, Any]]:
    """
    Get all markets a user has access to (via explicit role or organization): exactly those the
    market read serves them, each entry with the table's answers the read gives this reader.
    """
    user = UsersApi.get_user(user_email)
    if not user:
        return []
    user_id = user.id

    seen_ids = set()
    result = []

    user_orgs = OrgsApi.organization_documents_of(user_id)
    lookups = _SummaryLookups(user_orgs)

    # A role is a key of the market's roles map, so "has one" is that key existing - which the
    # wildcard index on the map serves (``lookup_indexes``). It was read by turning every market's
    # map into an array first, which no index can serve: every Markets page read every market.
    markets_with_role = markets_collection.find(
        live({f"{market_doc_key('roles')}.{user_id}": {"$exists": True}})
    )
    org_ids = [org['id'] for org in user_orgs]
    org_markets = markets_collection.find(
        live(market_doc_filter("organization_id", {"$in": org_ids}))
    ) if org_ids else []

    for documents in (markets_with_role, org_markets):
        for document in documents:
            mid = document["id"]
            if mid in seen_ids:
                continue
            seen_ids.add(mid)
            entry = _listed(document, user_id, user_email, lookups)
            if entry is not None:
                result.append(entry)

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


#: What a person chooses when they create a market: every other field of a new market starts at its
#: default, or is the server's to write (``new_market``). An allow-list, as the plan write's
#: ``PLAN_WRITE_FIELDS`` is, so a field added to ``Market`` is the server's until it is listed here.
MARKET_CREATE_FIELDS = (
    "name", "creation_date", "organization_id", "intake_mode", "setup_object", "application_form",
)


def new_market(body: Dict[str, Any], roles: Dict[str, Any]) -> Market:
    """A new market of ``body``'s chosen fields and ``roles``, every other field at its default.

    A key outside ``MARKET_CREATE_FIELDS`` is dropped, not refused: a tab still open on the build
    before sends the whole new-market object, and nothing else in it is the creator's to decide.
    Raises pydantic's ``ValidationError`` when a chosen field cannot be read.
    """
    chosen = {field: body[field] for field in MARKET_CREATE_FIELDS if field in body}
    return Market.model_validate(
        {**chosen, "roles": roles, "modification_list": [], "assignment_object": {}})


def create_market(market: Market, owner_email: str) -> tuple:
    """Create a new market of ``market``'s chosen fields (``new_market``).

    A create body may carry an application form, so it passes through the same validation and
    normalization as ``save_application_form``: one contract for every writer of the form.
    """
    market = new_market(market.model_dump(), market.roles)
    # Its plan is held to what the plan write holds every plan to, and made as the plan write makes
    # it, against the market as it stands before it holds one: the body's floorplans and table types
    # are dropped, since only a layout's own write passes them, and its counts are derived (T257).
    if market.setup_object:
        plan, _removed = _with_the_layouts(
            market.model_copy(update={"setup_object": None}), market.setup_object, None, None)
        refusal = _plan_refusal(plan)
        if refusal:
            raise BadRequestError(refusal)
        market = market.model_copy(update={"setup_object": plan})
    market_dict = market.model_dump()
    # Server-owned: the one entry every market starts with (E26/F06/S03).
    market_dict["phase_history"] = [
        PhaseRecord.phase_entry(MarketPhase.DRAFT.value, owner_email).model_dump()
    ]
    # Server-owned too: a new market starts with its organization's default rows, each marked as
    # copied from it; a market of no organization, or of one that sets none, starts at the built-in
    # table (E39/F02/S01). A copy, not a link.
    market_dict["permissions"] = _organization_default_rows(market.organization_id)
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
    
    market_id = market.id
    market_dict = convert_keys_to_camel_case(market_dict)
    
    refusal = market_name_refusal(market.name) or public_address_refusal(market.name)
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
            added = OrgsApi.organizations_collection.update_one(
                live({"id": market.organization_id}),
                {"$addToSet": {"markets": market_id}}
            )
        except Exception as e:
            logger.warning(f"Failed to add market to organization: {e}")
        else:
            if added.matched_count == 0:
                # Its organization began its deletion (or went) since the request read it, and
                # that deletion may have listed its markets already: this one is taken back rather
                # than left belonging to nothing (``tombstone``).
                markets_collection.delete_one({"id": market_id})
                raise NotFoundError("Organization not found")
    
    return result, market_id

def _organization_default_rows(organization_id: Optional[str]) -> Dict[str, Dict[str, str]]:
    """The organization's default rows as a market of it holds them, copied (E39/F02/S01)."""
    organization = OrgsApi.get_organization(organization_id) if organization_id else None
    rows = Actions.organization_rows((organization or {}).get(OrgsApi.DEFAULT_PERMISSIONS))
    return {row_id: held.model_dump() for row_id, held in rows.items()}


MARKET_NAME_MAX = 100


def market_name_refusal(name: str) -> Optional[str]:
    """Why no market may be called this, in words for the organizer, or None when it may (T273).

    The name is the market's heading on every screen and its words in the vendor's sign-in code
    mail, so it is something, at most ``MARKET_NAME_MAX`` characters (code points, as ``len``
    counts; a browser's ``maxlength`` counts UTF-16 units, so it is never looser), and on one line.
    Blank and the length are judged with the ends trimmed, as a rename stores it; a control
    character (a line break, a tab) or a line or paragraph separator (U+2028, U+2029) is refused
    anywhere in the name as sent, since a create stores the name as given. Asked only by a create
    and a rename: a name stored before the rule still loads, lists and is mailed, escaped and on
    one line (``utils.email.one_line``).
    """
    trimmed = (name or "").strip()
    if not trimmed:
        return "A market needs a name."
    if any(unicodedata.category(character) in ("Cc", "Zl", "Zp") for character in name):
        return "A market's name must be on one line."
    if len(trimmed) > MARKET_NAME_MAX:
        return f"A market's name can be at most {MARKET_NAME_MAX} characters."
    return None


def public_address_refusal(name: str, market_id: Optional[str] = None) -> Optional[str]:
    """Why no market may be called this, or None when it may (E21/F03/S03).

    The name decides the slug and the slug is the market's public address - its vendor page, served
    before anyone signs in (ADR 0022) - so two markets answering one address
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
        market = new_market(data, {owner.id: MarketRole.OWNER.value})
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
    if user is None or user.id not in organization_people_of(organization):
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
    leave_out_every_answer(assigned_market_dict)
    if context.organization_dict:
        assigned_market_dict['organizationName'] = context.organization_dict.get('name')
    return assigned_market_dict, 200


class CountedAssignment(NamedTuple):
    """The stored assignment, counted as the Assignments page's strip reads it."""
    #: The market with its stored assignment described (``assignment_to_show``).
    market: Market
    #: Its statistics, the vendors added by hand counted in beside the run's.
    statistics: AssignmentStatistics
    #: The vendors the run reads.
    vendors: List[SolverVendor]
    #: Every applicant the run does not read, with their application.
    outside: List[Tuple[SolverVendor, Application]]
    #: One row per table and date, as the tables grid draws them (``derive_market_table_rows``).
    rows: List[MarketTableRow]


def counted_assignment(market: Market) -> Optional[CountedAssignment]:
    """Count the market's stored assignment, never a fresh run, for the Assignments page's strip
    (``get_assignment_statistics``) and the Stats tab's headlines (``market_stats.py``), so the two
    tell the same figures. ``None`` when the statistics could not be counted."""
    # Keep persisted schema free of assignment statistics, then derive fresh.
    market.assignment_object.assignment_statistics = None
    # The vendors are read once and handed to both: the stored seats are described against
    # them, and the reasons the strip's caller computes are against the same set, so the two can
    # never disagree about who applied.
    vendors = vendors_to_show(market)
    assigned_market = assignment_to_show(market, vendors)
    stats = assigned_market.assignment_object.assignment_statistics
    if stats is None:
        return None

    rows = derive_market_table_rows(assigned_market)
    stats.unassigned_tables = derive_unassigned_tables_from_rows(rows)
    # Everyone the run does not read, read once: the vendors added by hand are counted below, and
    # the applicants the review did not approve are marked where a seat overrides them.
    outside = outside_solver_vendors(
        market.id, EssentialFields.effective_essential_options_for_market(market),
        {vendor.email for vendor in vendors},
    )
    count_added_vendors(
        stats, [vendor.email for vendor, application in outside if needs_a_table(application)],
        assigned_market.assignment_object.vendor_assignments or [],
    )
    return CountedAssignment(assigned_market, stats, vendors, outside, rows)


def table_days_free(rows: Iterable[MarketTableRow]) -> int:
    """The table-days nobody holds any of: the tables grid's "Empty" count, unfiltered
    (``rowStatus`` in ``front-end/src/utils/resultFilters.ts``). Half a table held is used."""
    return sum(1 for row in rows if not any(row.assignment_slots))


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

    counted = counted_assignment(market)
    if counted is None:
        return {"error": "The result's statistics could not be counted."}, 500
    assigned_market, stats, vendors, outside = (
        counted.market, counted.statistics, counted.vendors, counted.outside)
    placed_rows = assigned_market.assignment_object.vendor_assignments or []

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


#: The table's groups that change something, in its order: the kinds of change the history is
#: narrowed by. An applicant's own change (``History.APPLY``), which no row asks, is an
#: application's.
_HISTORY_GROUPS_LEFT_OUT = frozenset({"Reading"})
#: A row no entry is recorded under: who may be chosen as a reviewer changes nothing itself, the
#: choice is Choose reviewers' and a chosen reviewer's verdicts are Give verdicts' (E38/F07/S03).
_HISTORY_ROWS_LEFT_OUT = frozenset({Actions.REVIEW_WHEN_CHOSEN})
#: Entries recorded under another group's row that a group reads too, as (action, kind): a free's
#: $0 taken back as the day is seated again is recorded under Assign, the row the seating asked,
#: and it undoes a change to what is owed, so Payments reads it beside that change (E44/F01/S02).
_HISTORY_GROUP_ALSO_READS = {"Payments": ((Actions.ASSIGN.id, History.OWED_TAKEN_BACK),)}


def history_groups() -> List[Dict[str, Any]]:
    """The groups of the table the history may be narrowed to, each with its actions' ids and
    labels, for the screen's kind filter."""
    groups: Dict[str, List[Dict[str, str]]] = {}
    for row in Actions.ACTIONS.values():
        if row.group not in _HISTORY_GROUPS_LEFT_OUT and row not in _HISTORY_ROWS_LEFT_OUT:
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


def _history_day(value: Optional[str]) -> bool:
    """Whether a filter's market day reads: absent, or a calendar day as a placement stores it,
    ``YYYY-MM-DD`` and no other spelling, since any other would match nothing stored."""
    if not value:
        return True
    try:
        return datetime.strptime(value, "%Y-%m-%d").date().isoformat() == value
    except ValueError:
        return False


def get_history(
    market_id: str, requesting_user: str, args: Dict[str, str],
) -> tuple[Dict[str, Any], int]:
    """One page of this market's history, newest first, for Manage market (E40/F01/S03). Asks
    ``Actions.READ_HISTORY``.

    ``args`` are the request's: ``before`` (the cursor the last page answered with), ``actor``,
    ``group`` (a group of the table), ``vendor``, ``since`` and ``until`` (ISO instants, the first
    kept and the second not), and ``day`` (a market day, ``YYYY-MM-DD``: that day's entries and
    those about no one day). The first page also answers what the filters may offer: the
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
    day = args.get("day")
    if not (since_read and until_read and _history_day(day)):
        return {"error": "The history's dates could not be read."}, 400
    before = args.get("before")
    if before and History.parse_cursor(before) is None:
        return {"error": "That page of the history could not be read."}, 400

    entries, after = History.entries_page(
        market_id, before=before or None, actor=args.get("actor") or None, actions=actions,
        kinds=_HISTORY_GROUP_ALSO_READS.get(group, ()),
        vendor=args.get("vendor") or None, since=since, until=until, day=day or None,
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


def taking_applications_update(
    from_phase: str, to_phase: str, document: Dict[str, Any],
) -> Dict[str, Any]:
    """A stop belongs to the one stay in the stage it was made in (E38/F04/S02).

    Reopen for editing and then Open applications is opening applications, so a stop made before
    must not leave the form shut; cleared on entering draft and on entering the stage from draft, in
    the update that moves the phase. Back to review (T207) is the review again, not applying: a
    market whose vendors apply on its page enters the stage from Assignment with its form stopped,
    and Take applications again is the organizer's way to reopen it; a Google Form market has no
    form to stop, and is left as it is. Elsewhere it is left alone: past the stage the phase closes
    the form whatever the flag says.
    """
    stopped_key = market_doc_key("applications_stopped")
    if to_phase == MarketPhase.APPLICATIONS.value and from_phase == MarketPhase.ASSIGNMENT.value:
        if intake_mode_from_market_document(document) is IntakeMode.FORM:
            return {stopped_key: True}
        return {}
    if to_phase in (MarketPhase.DRAFT.value, MarketPhase.APPLICATIONS.value):
        return {stopped_key: False}
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


class MoveBlockedUnderRequest(ConflictError):
    """The phase stayed, but a fact the move's guards passed on changed under this request: a 409.

    Answered as the guards answer, with the blockers the move meets now, so the rail shows why
    where it shows a guard.
    """

    def __init__(self, current_phase: str, target_phase: str, blockers: List[PreconditionResult]):
        self.current_phase = current_phase
        self.target_phase = target_phase
        self.blockers = blockers
        super().__init__(blockers[0].message)

    def body(self) -> Dict[str, Any]:
        return convert_keys_to_camel_case({
            "error": "preconditions_not_met",
            "current_phase": self.current_phase,
            "target_phase": self.target_phase,
            "blockers": [b.payload() for b in self.blockers],
        })


def _what_the_move_stood_on(from_phase: str, to_phase: str) -> Tuple[str, ...]:
    """What a move's guards passed on that another request can change under it: the stored keys
    the move's write holds at their value as read (``write_market``'s ``holds``).

    Back to review (T207) is refused once results are published, and Publish results writes the
    flag without moving the phase, so the move's write holds the flag as its guard read it: two
    requests in flight together never leave a market in the review with its results published.
    Publish results' write holds the phase the same way (``publish_results``).

    Open applications judges the form and the plan as read and stamps the form published, so it
    holds both revisions: a form or a plan save landing in its window refuses the move rather than
    opening a form or a setup its guards never read, after which the setup is settled. The move
    counts neither revision, since it changes no question and no part of the plan.
    """
    if (from_phase, to_phase) == (MarketPhase.ASSIGNMENT.value, MarketPhase.APPLICATIONS.value):
        return (market_doc_key("results_published"),)
    if (from_phase, to_phase) == (MarketPhase.DRAFT.value, MarketPhase.APPLICATIONS.value):
        return (FORM_REVISION_KEY, PLAN_REVISION_KEY)
    return ()


def _what_changed_under_the_move(latest: Dict[str, Any], to_phase: str) -> List[PreconditionResult]:
    """The blockers a move meets on the market as it now stands, its phase unmoved: what its guards
    say now, or, when they pass, that the market changed under it, so the rail still says why the
    move was not taken and to reload."""
    blockers = evaluate_transition(market_from_document(latest), to_phase, db)
    return blockers or [PreconditionResult(id="market_changed", passed=False, message=MARKET_CHANGED)]


def apply_phase_transition(
    document: Dict[str, Any], to_phase: str, by: Optional[str] = None,
) -> None:
    """Write one phase change to the market ``document`` was read from, only while it still is.

    The ONE writer of a market's phase: every move, the transition endpoint's and a Google Form
    market's first import's, comes through ``take_move`` to it. A second copy is how the `isDraft` stamp and the
    finalization stamp come to disagree with `phase` - and how a move goes unrecorded.

    ONE atomic update, through ``write_market``, which holds the stored phase as read: a failure
    between the phase and the stamp would leave a market whose two answers disagree, which is the
    class of bug `migrate_is_draft_consistency` exists to repair, and a lost update would move a
    market a concurrent request had already moved. The same update records the phase entered, and
    who moved it there, in the market's phase history (E26/F06/S03). A move whose guard read a
    fact another write can change without moving the phase holds that fact too
    (``_what_the_move_stood_on``).

    The rail shows a refused move as a blocker beside the phase the market is in, so the
    ``MarketChanged`` the write raises is answered in those terms, from the market it carries.

    Raises:
        PhaseChangedUnderRequest: the stored phase moved under this request.
        MoveBlockedUnderRequest: the phase stayed, but what the move stood on changed.
        MarketNotFoundError: the market is gone.
    """
    phase_key = market_doc_key("phase")
    is_draft_key = market_doc_key("is_draft")
    from_phase = phase_from_market_document(document).value

    try:
        write_market(document, {
            "$set": {
                phase_key: to_phase,
                is_draft_key: to_phase == MarketPhase.DRAFT.value,
                **finalization_update(from_phase, to_phase, document),
                **taking_applications_update(from_phase, to_phase, document),
            },
            "$push": PhaseRecord.push_entries(document, to_phase, by),
        }, holds=_what_the_move_stood_on(from_phase, to_phase))
    except MarketChanged as changed:
        latest = changed.latest
        actual_phase = phase_from_market_document(latest).value
        if actual_phase == from_phase and latest.get(phase_key) == document.get(phase_key):
            raise MoveBlockedUnderRequest(
                from_phase, to_phase, _what_changed_under_the_move(latest, to_phase)) from None
        raise PhaseChangedUnderRequest(actual_phase, from_phase, to_phase) from None


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
    apply_phase_transition(context.document, to_phase, by=by)

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
        except Exception as error:
            # By its type and frames: a database error's message can quote a document it touched.
            logger.error(
                "Phase advanced to market_days for market %s but the "
                "assignment_sent -> vendor_refused sweep failed\n%s",
                market_id,
                traceback_without_messages(error),
            )
    # After the sweep, so the move's entry counts the offers it turned to refusals: no entry of
    # their own says who refused those vendors.
    History.record(market_id, by, Actions.MOVE_PHASE, detail=lambda: {
        **History.changes({"phase": from_phase}, {"phase": to_phase}), **swept})
    return []


def add_market_role(market_id: str, user_email: str, role: MarketRole, requesting_user: str) -> None:
    """Add a user role to a market. Asks the row that gives the role (``Actions.roles_row``).

    Sets that person's key alone, holding it absent and the requester's role as read
    (``_write_role``), so an add never undoes another organizer's change to someone else.

    Raises:
        MarketChanged: the person was given a role, or the requester's changed, since the read.
    """
    context = load_market_context(market_id)
    if context is None:
        raise MarketNotFoundError("Market not found")
    if context.market is None:
        raise BadRequestError("Invalid market data")

    market = context.market
    roles = context.document.get('roles') or {}

    refused = Actions.refusal(Actions.roles_row(role), requesting_user, market, context.organization)
    if refused:
        raise ForbiddenError(refused)

    if role == MarketRole.OWNER:
        for uid, existing_role in roles.items():
            if existing_role == MarketRole.OWNER.value:
                raise BadRequestError("Market already has an owner. Transfer ownership first.")

    user = UsersApi.get_user(user_email)
    if not user:
        raise BadRequestError("User not found")

    # Adding never changes a role: overwriting one here would skip update_market_role's guards and
    # let an Admin demote the Owner.
    if user.id in roles:
        raise BadRequestError(
            f"{user.email} already has a role on this market. Change it in their row under Users with access."
        )

    _write_role(market, {"$set": {_role_key(user.id): role.value}}, user.id, requesting_user,
                owner_count_read=role == MarketRole.OWNER)
    _record_role(market_id, requesting_user, History.ROLE_GIVEN, user.id, None, role)


NO_LONGER_ON_THE_MARKET = "They no longer have a role on this market."


def remove_market_role(market_id: str, user_id: str, requesting_user: str) -> None:
    """Remove a user role from a market. Asks the row that takes the role (``Actions.roles_row``).

    Taking the role of someone who holds none here, another organizer having taken it first, is
    a 404 saying so, written and recorded as nothing, and Manage market reads it as done. A
    requester whom neither roles row lets take a role is refused first, in one sentence, so they
    learn nothing of whether the person is the only owner, an Admin, anyone else or nobody.

    Unsets that person's key alone, holding their role and the requester's as read
    (``_write_role``).

    Raises:
        MarketChanged: their role, or the requester's, changed since the read, and they still hold one.
    """
    context = load_market_context(market_id)
    if context is None:
        raise MarketNotFoundError("Market not found")
    if context.market is None:
        raise BadRequestError("Invalid market data")

    market = context.market
    organization = context.organization

    refusals = [Actions.refusal(row, requesting_user, market, organization)
                for row in (Actions.MANAGE_EDITORS_AND_VIEWERS, Actions.MANAGE_ADMINS)]
    if all(refusals):
        raise ForbiddenError(refusals[0])

    roles = context.document.get('roles') or {}
    if user_id not in roles:
        raise NotFoundError(NO_LONGER_ON_THE_MARKET)

    taking_an_owner = roles.get(user_id) == MarketRole.OWNER.value
    if taking_an_owner:
        owner_count = sum(1 for r in roles.values() if r == MarketRole.OWNER.value)
        if owner_count <= 1:
            raise BadRequestError("Cannot remove the only owner. Transfer ownership first.")

    # The role as the market model read it, which takes only the four roles: every removal asks
    # the row of the role it takes.
    refused = Actions.refusal(
        Actions.roles_row(market.roles[user_id]), requesting_user, market, organization)
    if refused:
        raise ForbiddenError(refused)

    try:
        _write_role(market, {"$unset": {_role_key(user_id): ""}}, user_id, requesting_user,
                    owner_count_read=taking_an_owner)
    except MarketChanged as changed:
        # Someone else took the role between the read and this write.
        if user_id not in (changed.latest.get('roles') or {}):
            raise NotFoundError(NO_LONGER_ON_THE_MARKET) from changed
        raise
    _record_role(market_id, requesting_user, History.ROLE_TAKEN, user_id,
                 market.roles[user_id], None)


def update_market_role(market_id: str, user_id: str, new_role: MarketRole, requesting_user: str) -> bool:
    """Update a user's role in a market. Asks the row of the role taken and of the one given.

    Sets that person's key alone, holding their role and the requester's as read (``_write_role``).
    Answers False, writing nothing, when they already hold ``new_role``.

    Raises:
        MarketChanged: their role, or the requester's, changed since the read.
    """
    context = load_market_context(market_id)
    if context is None:
        raise MarketNotFoundError("Market not found")
    if context.market is None:
        raise BadRequestError("Invalid market data")

    market = context.market
    organization = context.organization

    roles = context.document.get('roles') or {}
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

    if current_role_value == new_role.value:
        return False

    _write_role(market, {"$set": {_role_key(user_id): new_role.value}}, user_id, requesting_user,
                owner_count_read=new_role == MarketRole.OWNER)
    _record_role(market_id, requesting_user, History.ROLE_CHANGED, user_id,
                 current_role, new_role)
    return True


#: Said of a hand-on to anyone the market read does not find with access, the Owner included.
HAND_ON_ONLY_TO_SOMEONE_WITH_ACCESS = (
    "You can hand this market only to someone who has access to it.")


def hand_on_market(market_id: str, user_id: str, requesting_user: str) -> None:
    """Make ``user_id`` the market's Owner and its Owner, the requester, an Admin (T283).

    Asks the fixed row ``hand-on-market``, which only the Owner reaches, then refuses anyone but
    the people the market read finds with access (``people_with_market_role``), the Owner aside,
    so the id the write names is one the server found. Allowed in every phase, archived included:
    who owns a record is a decision about it, and an archived market still needs someone who can
    delete it.

    One write, holding the Owner's role and the new Owner's as read (absent when their access
    comes through the organization): the Owner was the one Owner as read, so a second hand-on of
    theirs meets their role changed, and the market never has two Owners or none.

    Raises:
        MarketChanged: either role changed since the read.
    """
    context = load_market_context(market_id)
    if context is None:
        raise MarketNotFoundError("Market not found")
    if context.market is None:
        raise BadRequestError("Invalid market data")

    market = context.market
    organization = context.organization
    refused = Actions.refusal(Actions.HAND_ON_MARKET, requesting_user, market, organization)
    if refused:
        raise ForbiddenError(refused)

    owner = UsersApi.get_user(requesting_user)
    if owner is None or market.roles.get(owner.id) != MarketRole.OWNER:
        # The row lets in only a market role of Owner, which only ``roles`` holds.
        raise ForbiddenError(Actions.refusal_sentence(Actions.HAND_ON_MARKET))
    with_access = PermissionsApi.people_with_market_role(market, organization)
    if user_id == owner.id or user_id not in with_access:
        raise BadRequestError(HAND_ON_ONLY_TO_SOMEONE_WITH_ACCESS)
    # A role a gone account left behind is no one to hand it to, and the read lists no such row:
    # its accounts are read as the read reads them (``_Accounts``).
    new_owner = UsersApi.get_users_by_ids([user_id]).get(user_id)
    if new_owner is None:
        raise BadRequestError(HAND_ON_ONLY_TO_SOMEONE_WITH_ACCESS)

    write_market(market, {"$set": {
        _role_key(owner.id): MarketRole.ADMIN.value, _role_key(user_id): MarketRole.OWNER.value,
    }}, holds=[_role_key(owner.id), _role_key(user_id)])
    History.record(
        market_id, requesting_user, Actions.HAND_ON_MARKET, kind=History.HANDED_ON,
        subject={"user_id": user_id, "email": new_owner.email},
        detail=lambda: History.changes({"owner": owner.email}, {"owner": new_owner.email}),
    )


def _role_key(user_id: str) -> str:
    """The stored key of one person's role on the market."""
    return f"{market_doc_key('roles')}.{user_id}"


def _write_role(
    market: Market, update: Dict[str, Any], user_id: str, requesting_user: str, *,
    owner_count_read: bool,
) -> None:
    """Write one person's role, holding what the decision read (ADR 0024): that person's role and
    the requester's, each as read (absent when the requester's right comes through the
    organization), and the whole map when the decision counted the market's owners, so two role
    changes at once land on the people they name and never undo each other.

    Raises ``MarketChanged`` when any of them moved."""
    holds = [_role_key(user_id)]
    requester = UsersApi.get_user(requesting_user)
    if requester is not None and requester.id != user_id:
        holds.append(_role_key(requester.id))
    if owner_count_read:
        holds.append(market_doc_key('roles'))
    write_market(market, update, holds=holds)


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
    write = ({f"{key}.{row.id}": after.model_dump()} if _stored_rows_are_a_map(market)
             else {key: {row.id: after.model_dump()}})
    write_market(market, {"$set": write}, holds=_rows_held(market, [row]))
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
    write_market(market, {"$unset": {f"{market_doc_key('permissions')}.{row.id}": ""}},
                 holds=_rows_held(market, [row]))
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
    write_market(market, {"$unset": {f"{key}.{row.id}": "" for row, _ in held_rows}},
                 holds=_rows_held(market, [row for row, _ in held_rows]))
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
    if _stored_rows_are_a_map(market):
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
    write_market(market, update, holds=_rows_held(market, [row for row, _, _ in changed]))
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


def _stored_rows_are_a_map(market: Market) -> bool:
    """Whether the market's ``permissions``, as it was read, is a map or absent, as Mongo can set
    a key in."""
    return isinstance(document_as_read(market).get(market_doc_key('permissions'), {}), dict)


def _rows_held(market: Market, rows: List[Actions.Action]) -> Tuple[str, ...]:
    """What a write to ``rows`` of the market's table holds as it was read: each row it changes,
    so a row changed meanwhile in another tab is not overwritten, or the whole ``permissions``
    where the stored rows are not a map, since the write then replaces it whole."""
    key = market_doc_key('permissions')
    if not _stored_rows_are_a_map(market):
        return (key,)
    return tuple(f"{key}.{row.id}" for row in rows)


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
    """Delete a market, as its owner: its tombstone first, then its records, then it.

    A deletion cut at any step is resumed by the same request sent again: the market is read
    whatever its state, so the retry finds the tombstone and goes on with its trail id, under which
    the organization's history records that it went, once. A market its organization's deletion is
    taking reads as absent here; that deletion finishes it.
    """
    document = markets_collection.find_one({"id": market_id})
    if document is None:
        raise MarketNotFoundError("Market not found")
    market = _readable_market(document)
    if market is None:
        raise BadRequestError("Invalid market data")
    organization = _load_organization(market.organization_id)
    if market.organization_id and _organization_is_deleting(market.organization_id):
        raise MarketNotFoundError("Market not found")

    refused = Actions.refusal(Actions.DELETE_MARKET, requesting_user, market, organization)
    if refused:
        raise ForbiddenError(refused)

    tombstone = tombstone_of(document) or MarketDeletion.mark_deleting(
        markets_collection, document, new_tombstone(requesting_user))
    if tombstone is None:
        raise MarketNotFoundError("Market not found")

    if market.organization_id:
        try:
            OrgsApi.organizations_collection.update_one(
                {"id": market.organization_id},
                {"$pull": {"markets": market_id}}
            )
        except Exception as e:
            logger.warning(f"Failed to remove market from organization: {e}")

    # Its applications, check-ins, sign-in codes and placement trail go with it (bug 47): each
    # names people, and leaving them behind would outlive the thing they describe.
    MarketDeletion.delete_records(market_id)
    # Its own history went with it; its organization's keeps that it went (E40/F02/S01), recorded
    # under the deletion's trail id before the market goes, so a retry records it once.
    if market.organization_id:
        History.record_for_organization(
            market.organization_id, tombstone.get("by") or requesting_user, History.DELETE_MARKET,
            subject={"market_id": market_id},
            detail=lambda: History.changes({"name": market.name}, {"name": None}),
            entry_id=tombstone["trail_id"],
        )
        # Its organization's deletion may have taken the market meanwhile, and the organization's
        # history with it: the entry just written would outlive them, so it goes as theirs did.
        if MarketDeletion.organization_taken(market.organization_id):
            History.delete_for_organization(market.organization_id)
    return markets_collection.delete_one({"id": market_id})


def _organization_is_deleting(organization_id: str) -> bool:
    """Whether the market's organization carries a tombstone: its deletion owns the market's."""
    return tombstone_of(OrgsApi.organizations_collection.find_one({"id": organization_id})) is not None


RENAME_REFUSED_AFTER_DRAFT = (
    "This market's public web address comes from its name, and it has already been shared - "
    "on its vendor page - so its name can no longer change."
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
    refusal = market_name_refusal(name)
    if refusal:
        raise BadRequestError(refusal)
    name = name.strip()

    market = _load_market_to_change(market_id, requesting_user, Actions.CHANGE_SETUP)
    if market.phase is not MarketPhase.DRAFT:
        raise BadRequestError(RENAME_REFUSED_AFTER_DRAFT)
    if name == market.name:
        return

    refusal = public_address_refusal(name, market_id)
    if refusal:
        raise BadRequestError(refusal)

    try:
        # Held at the phase it was judged on: a rename landing after the market left draft would
        # move the public address it handed out (``MarketChanged``).
        write_market(market, {"$set": {
            market_doc_key("name"): name, market_doc_key("slug"): market_name_slug(name)}})
    except DuplicateKeyError as e:
        # A rename that raced another write to the same address, refused by the unique index.
        raise BadRequestError(_address_taken(name)) from e
    History.record(market_id, requesting_user, Actions.CHANGE_SETUP, kind=History.RENAMED,
                   detail=lambda: History.changes({"name": market.name}, {"name": name}))


#: The stored count of the plan's writes (``Market.plan_revision``), which a plan save holds at
#: the revision its copy was read at and counts up, and every other writer of the plan counts.
PLAN_REVISION_KEY = market_doc_key("plan_revision")
#: What a plan save's body that names a revision not a count is told.
PLAN_REVISION_NOT_A_COUNT = "planRevision must be a whole number."
PLAN_WRITE_FIELDS = ("setupObject", "intakeMode", PLAN_REVISION_KEY)


def save_plan(market_id: str, body: Dict[str, Any], requesting_user: str) -> int:
    """Write the market plan and, while the market is a draft, how vendors reach it (E21/F03/S02),
    and answer the plan's revision now stored, for the next save.

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
    assignment rules, which are that row's though they ride in the plan (E39/F01/S01,
    ``Actions.ask_assign_if_the_rules_change``).

    The body carries ``planRevision``, the revision the page's copy of the plan was read at, since
    the plan is sent whole: a copy older than the stored plan would put back whatever was saved
    since (ADR 0024). The write holds it, the phase and ``resultsPublished`` (the rules' lock reads
    it) as the judgment read them, so a save from an older copy, one crossing a phase move and one
    crossing Publish results are each refused instead of stored.

    Raises:
        MarketChanged: the body names no revision, or the market changed since its copy was read.
        BadRequestError: the plan is refused, or the revision is not a count.
    """
    extra = sorted(set(body) - set(PLAN_WRITE_FIELDS))
    if extra:
        raise BadRequestError(f"The plan write carries only the plan; it does not accept {', '.join(extra)}.")
    if "setupObject" not in body:
        raise BadRequestError("setupObject is required.")

    market, organization = _load_market_and_organization_to_change(
        market_id, requesting_user, Actions.CHANGE_SETUP)
    plan_revision = _revision_in(body, PLAN_REVISION_KEY, PLAN_REVISION_NOT_A_COUNT)
    prepared = prepared_plan(market, body)
    plan, update = prepared.plan, prepared.update
    Actions.ask_assign_if_the_rules_change(market, plan, requesting_user, organization)
    if plan_revision is _NO_REVISION:
        raise MarketChanged(dict(document_as_read(market)))
    written = write_market(market, {"$set": update},
                           holds=(market_doc_key("results_published"),),
                           revisions={PLAN_REVISION_KEY: plan_revision})
    _record_plan(market, plan, update, requesting_user)
    release_removed_floorplans(market, prepared.removed_floorplans, requesting_user)
    return written.revisions[PLAN_REVISION_KEY]


#: The plan's fields that are Market Setup's and recorded by its entry; the rest,
#: ``assignment_rules``, are the Assignment row's, and the layouts and table types, which the plan
#: write keeps as stored, are recorded by their own writes (T257).
_SETUP_FIELDS = ("market_dates", "tiers", "locations", "sections")


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


#: Why a floorplan naming an image another market, no market or nothing holds is refused (T272).
UNTIED_FLOORPLAN_IMAGE = "The floorplan's image was not uploaded for this market."


def _floorplans_refusal(market: Market, proposed: List[FloorplanObject]) -> Optional[str]:
    """Why a plan's floorplans may not be written, or None: their bounds (``floorplan_limits``),
    and each changed floorplan's image, which must be one uploaded for this market.

    A floorplan the market already holds, restated unchanged, is judged by neither: restating is
    not a change, so a market stored before the bounds keeps saving its plan, and a plan write,
    which keeps the stored floorplans, is never refused for them.
    """
    stored = (market.setup_object.floorplans if market.setup_object else None) or []
    refused = FloorplanLimits.floorplans_refusal(proposed, stored)
    if refused:
        return refused
    for floorplan in FloorplanLimits.changed_floorplans(proposed, stored):
        image = floorplan.image_gridfs_id
        if image is not None and GridfsService.get_image_market_id(image) != market.id:
            return UNTIED_FLOORPLAN_IMAGE
    return None


#: Why a plan write from a page opened before every location and section had an id is refused
#: where a row it sends with none would read as another row than the market's, on a market with a
#: layout (T257): it would drop the layout and delete its image, or take tables out of a section.
PAGE_FROM_BEFORE_IDS = (
    "This page was opened before an update, so this change was not saved. "
    "Reload the page, then make the change again."
)


def _an_id_missing(row: Any) -> bool:
    return isinstance(row, dict) and not (isinstance(row.get("id"), str) and row["id"].strip())


def _from_a_page_before_ids(body_plan: Any, plan: SetupObject, stored: Optional[SetupObject]) -> bool:
    """Whether a row ``body_plan`` sends with no id is given one (``plan``, as it parsed) that none
    of the stored rows of its kind has, while the market holds a layout: a page of the bundle
    before ids, whose location a later page minted or which it renamed, would write that layout's
    location or a table's section away. A row the market reads with the id its name gives, as a
    market stored before ids does, is no such row."""
    if not isinstance(body_plan, dict) or stored is None or not Layout.laid_out(stored):
        return False
    for key, rows, stored_rows in (("locations", plan.locations, stored.locations),
                                   ("sections", plan.sections, stored.sections)):
        sent = body_plan.get(key) if isinstance(body_plan.get(key), list) else []
        known = {row.id for row in stored_rows}
        if any(_an_id_missing(row) and index < len(rows) and rows[index].id not in known
               for index, row in enumerate(sent)):
            return True
    return False


def _plan_refusal(plan: SetupObject) -> Optional[str]:
    """Why ``plan`` may not be a market's, whatever phase it is in, or None: the bounds of the
    half-table share and the prices (``Pricing.pricing_refusal``).

    Asked by every writer of a plan, the plan write and the create alike, of the plan holding its
    layouts and its derived counts (``_with_the_layouts``). A layout's floorplans and table types
    are judged by the layout's own write, the only one that passes them (``prepared_plan``).
    """
    share = plan.assignment_options.max_half_table_proportion_per_section
    if share is not None and not 0 <= share <= 100:
        return (
            "max_half_table_proportion_per_section must be between 0 and 100, or null for the "
            "default."
        )
    return Pricing.pricing_refusal(plan)


class PreparedPlan(NamedTuple):
    """A plan write judged and not yet written: the plan as parsed, the ``$set`` that writes it,
    and the layouts it drops because their location is gone, whose images and history entries
    ``release_removed_floorplans`` sees to once the write has landed."""
    plan: SetupObject
    update: Dict[str, Any]
    removed_floorplans: List[FloorplanObject] = []


def _with_the_layouts(
    market: Market, plan: SetupObject,
    floorplans: Optional[List[FloorplanObject]], table_types: Optional[List[TableTypeObject]],
) -> Tuple[SetupObject, List[FloorplanObject]]:
    """The plan holding the layouts and table types it is written with, its counts derived, and
    the layouts it drops (T257).

    Those of the body are never read: the stored ones are kept unless the layout's own write passes
    its own, so Market Setup's autosave, which carries the whole working copy it read, never
    overwrites a layout saved in between. A layout whose location is no longer one of the plan's
    goes with it; a beta floorplan, of no location, is kept and ignored until
    ``migrations/migrate_layouts.py`` removes it.
    """
    stored = market.setup_object
    if floorplans is None:
        floorplans = stored.floorplans if stored else None
    if table_types is None:
        table_types = stored.table_types if stored else []
    locations = {location.id for location in plan.locations}

    def stays(floorplan: FloorplanObject) -> bool:
        return floorplan.location_id is None or floorplan.location_id in locations

    kept = [floorplan for floorplan in floorplans or [] if stays(floorplan)]
    removed = [floorplan for floorplan in floorplans or [] if not stays(floorplan)]
    plan = plan.model_copy(update={
        "floorplans": kept if floorplans is not None else None,
        "table_types": list(table_types),
    })
    return Layout.derive_counts(plan), removed


def release_removed_floorplans(
    market: Market, removed: List[FloorplanObject], requesting_user: str,
) -> None:
    """Once a plan write has landed, delete the image of each layout it dropped, by its id, and
    record ``floorplan_removed`` for it, naming the location as the market last held it."""
    stored_locations = {
        location.id: location.name
        for location in (market.setup_object.locations if market.setup_object else [])
    }
    for floorplan in removed:
        if floorplan.image_gridfs_id:
            GridfsService.delete_image(floorplan.image_gridfs_id)
        History.record(
            market.id, requesting_user, Actions.CHANGE_SETUP, kind=History.FLOORPLAN_REMOVED,
            subject={"floorplan_id": floorplan.id,
                     "location": stored_locations.get(floorplan.location_id)},
            detail=History.changes({"tables": len(floorplan.tables)}, {"tables": None}),
        )


def prepared_plan(
    market: Market, body: Dict[str, Any], *,
    floorplans: Optional[List[FloorplanObject]] = None,
    table_types: Optional[List[TableTypeObject]] = None,
) -> PreparedPlan:
    """The plan write's ``$set``, judged against ``market`` and not yet written, beside the plan it
    parsed, so a caller reading the plan does not parse it again.

    The one statement of what a plan write may carry and when; ``save_plan`` writes it, the CSV
    start writes it in the same update as the form and the mapping it makes, and a layout's save
    writes it with the ``floorplans`` (and the ``table_types``) it changes, the only way either is
    written: the body's own are ignored and the stored ones kept (``_with_the_layouts``). Every
    write stores counts derived from the layouts (``layout.derive_counts``).
    """
    try:
        plan = SetupObject.model_validate(convert_keys_to_snake_case(body["setupObject"]))
    except ValidationError as e:
        logger.warning("Refused a plan for market %s: %s", market.id, parse_failure_detail(e))
        raise BadRequestError(field_named_copy("Invalid plan", e)) from e
    if _from_a_page_before_ids(body["setupObject"], plan, market.setup_object):
        raise ConflictError(PAGE_FROM_BEFORE_IDS)
    if table_types is not None:
        types_refused = FloorplanLimits.table_types_refusal(table_types)
        if types_refused:
            raise BadRequestError(types_refused)
    # Judged before a layout of a location gone is dropped, so the bounds answer first.
    floorplan_refused = _floorplans_refusal(market, floorplans or [])
    if floorplan_refused:
        raise BadRequestError(floorplan_refused)
    plan, removed_floorplans = _with_the_layouts(market, plan, floorplans, table_types)
    refused = _plan_refusal(plan)
    if refused:
        raise BadRequestError(refused)
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
    return PreparedPlan(plan, update, removed_floorplans)


#: Why "Nothing leads the card" is refused beside a marked answer (T206): it would read as decided
#: both ways at once.
NOTHING_LEADS_BESIDE_A_MARK = (
    "Choose Nothing leads the card only while no answer is marked to lead it: take the marks off "
    "first, or keep them."
)


def save_review_highlights(
    market_id: str, keys: List[str], requesting_user: str, nothing_leads_the_card: bool = False,
) -> Dict[str, Any]:
    """Set which answers a reviewer reads first, or that nothing leads the card, and answer both as
    stored. Asks ``Actions.CHANGE_FORM``.

    The list IS the order the card leads with, so a repeat is dropped where it recurs rather than
    resorting what an organizer arranged. An empty list clears them, and clearing is a write of
    ``[]`` rather than a delete: absent and empty both mean "nothing is marked", and one shape for
    that keeps the card from having to tell them apart.

    Neither shape says anyone decided it, so ``nothing_leads_the_card`` does (T206): the only
    writer of ``Market.nothing_leads_the_card``, true only beside an empty list (refused with a
    mark), and stored false by every write that does not ask for it, so marking an answer replaces it.
    Whether the two decide what a reviewer reads first, which a draft must before Review, is
    ``review_highlights.highlights_decided``: a kept mark may name a question the form has dropped.

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
    if nothing_leads_the_card and seen:
        raise BadRequestError(NOTHING_LEADS_BESIDE_A_MARK)

    write_market(market, {"$set": {
        market_doc_key("review_highlights"): seen,
        market_doc_key("nothing_leads_the_card"): nothing_leads_the_card,
    }})
    History.record(market_id, requesting_user, Actions.CHANGE_FORM, kind=History.REVIEW_HIGHLIGHTS,
                   detail=lambda: History.changes(
                       {"review_highlights": market.review_highlights or [],
                        "nothing_leads_the_card": market.nothing_leads_the_card},
                       {"review_highlights": seen,
                        "nothing_leads_the_card": nothing_leads_the_card}))
    return {"reviewHighlights": seen, "nothingLeadsTheCard": nothing_leads_the_card}


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


def reviewer_candidate_ids(
    market: Market, organization: Optional[Organization], chooser: Any,
) -> List[str]:
    """Whom this person may choose as a reviewer (E38/F07/S02), by user id: everyone they may hand
    a follow-up to (``follow_up_owners_for``), so someone outside the market's organization is
    never offered its people, whom ``Actions.may_be_chosen`` lets be chosen."""
    return [
        user_id for user_id in PermissionsApi.follow_up_owners_for(
            market, organization, chooser.id if chooser else None)
        if Actions.may_be_chosen(user_id, market, organization)
    ]


REVIEWERS_SETTLED = "The review is closed, so its reviewers no longer change."


def choose_reviewers(market_id: str, addresses: Any, requesting_user: str) -> Dict[str, Any]:
    """Choose who reviews this market's applications, and deal the open ones among them
    (E38/F07/S02). Asks ``Actions.CHOOSE_REVIEWERS``.

    ``addresses`` is the whole team, in any case and order; an empty list removes every reviewer.
    Refused on an archived market, once the review has closed, and for an address the chooser is
    not offered (``reviewer_candidate_ids``, asked of the same list), which the refusal names; a
    current reviewer they are not offered may stay. Answers the team as the market read serves it, and how many it dealt.
    """
    if not isinstance(addresses, list) or not all(isinstance(a, str) for a in addresses):
        raise BadRequestError("reviewers is a list of addresses")
    market = _load_market_to_change(market_id, requesting_user, Actions.CHOOSE_REVIEWERS)
    closed = review_closed_reason(market)
    if closed:
        raise BadRequestError(f"{REVIEWERS_SETTLED} {closed}")
    organization = _load_organization(market.organization_id)
    chooser = UsersApi.get_user(requesting_user)
    offered = set(reviewer_candidate_ids(market, organization, chooser))
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


#: Why "No automatic rejections" is refused beside a rule (T206), one with no answer yet included:
#: it is a rule the organizer is building, which the "none" would silently discard.
NO_REJECTIONS_BESIDE_A_RULE = (
    "Choose No automatic rejections only while the market has no rule: remove its rules first, or "
    "keep them."
)


def save_rejection_rules(
    market_id: str, rules: Any, requesting_user: str, no_automatic_rejections: bool = False,
) -> Dict[str, Any]:
    """Set which answers reject an application automatically (E33/F03/S01), or that none does, and
    answer both as stored. Asks ``Actions.CHANGE_FORM``.

    The rules' own write, the whole list at once like the highlights. Not gated on the form's lock:
    rules are worth most once applications arrive, which is when the form freezes. Refused while the
    review is closed (``rejection_rules_lock_reason``). A rule narrowed or
    taken away returns what it rejected to open only for someone who may overturn an automatic
    rejection (``may_overturn``, E38/F06/S01); for anyone else those rejections stand.

    The only writer of ``Market.no_automatic_rejections`` (T206), as ``save_review_highlights`` is
    of ``nothing_leads_the_card``: true only with no rule at all, stored false by every write that
    does not ask for it.
    """
    market = _load_market_to_change(market_id, requesting_user, Actions.CHANGE_FORM)
    settled = rejection_rules_lock_reason(market)
    if settled:
        raise BadRequestError(settled)
    prepared = RejectionRules.Rulebook(market).prepared(rules)
    if no_automatic_rejections and prepared:
        raise BadRequestError(NO_REJECTIONS_BESIDE_A_RULE)
    # Held at the phase the lock was judged on, so rules never land after the review closed.
    write_market(market, {"$set": {
        market_doc_key("rejection_rules"): prepared,
        market_doc_key("no_automatic_rejections"): no_automatic_rejections,
    }})
    # Every undecided application, and every one a rule rejected, is judged again (E33/F03/S02).
    judged = market.model_copy(update={"rejection_rules": [RejectionRule(**r) for r in prepared]})
    verdicts = RejectionRules.judge(RejectionRules.Rulebook(judged), market_id,
                                    overturns=may_overturn(requesting_user, market))
    History.record(market_id, requesting_user, Actions.CHANGE_FORM, kind=History.REJECTION_RULES,
                   detail=lambda: _with_counts(History.changes(
                       {"rejection_rules": [rule.model_dump() for rule in market.rejection_rules or []],
                        "no_automatic_rejections": market.no_automatic_rejections},
                       {"rejection_rules": [rule.model_dump() for rule in judged.rejection_rules or []],
                        "no_automatic_rejections": no_automatic_rejections},
                   ), verdicts))
    # What the rules returned to open is an arrival, dealt to the next reviewer (E38/F07/S03).
    if verdicts.returned:
        ReviewTeam.deal_arrivals(judged, requesting_user, Actions.CHANGE_FORM)
    return {"rejectionRules": prepared, "noAutomaticRejections": no_automatic_rejections}


#: The stored count of the form's question writes (``Market.form_revision``), which a form save
#: holds at the revision its copy was read at and counts up.
FORM_REVISION_KEY = market_doc_key("form_revision")
#: What a form save's body that names a revision not a count is told.
FORM_REVISION_NOT_A_COUNT = "formRevision must be a whole number."


def save_application_form(market_id: str, application_form_data: dict, requesting_user: str) -> dict:
    """Save or update the application form for a market.

    The only writer of ``Market.application_form`` on an existing market - the whole-market PUT
    that once carried one is gone (E21/F03/S06) - so every write passes the lock below.
    ``application_form_data`` is the form, beside the ``form_revision`` the page's copy of it was
    read at, which the write holds (``write_application_form``).

    Returns the saved ``ApplicationForm`` as a camelCase dict, under ``application_form``, and the
    revision now stored, under ``formRevision``, as the form read answers them.

    Raises:
        MarketNotFoundError: no such market
        BadRequestError: validation failure, or a revision that is not a count
        ForbiddenError: ``Actions.CHANGE_FORM`` refuses the user
        ApplicationFormLockedError: phase gate or D9 lock prevents editing
        MarketChanged: the body names no revision, or the market changed since its copy was read
    """
    market = _load_market_to_change(market_id, requesting_user, Actions.CHANGE_FORM)
    form_data = {key: value for key, value in application_form_data.items() if key != "form_revision"}
    written = write_application_form(
        market, form_data,
        _revision_in(application_form_data, "form_revision", FORM_REVISION_NOT_A_COUNT),
        overturns=may_overturn(requesting_user, market))
    History.record(market_id, requesting_user, Actions.CHANGE_FORM, kind=History.FORM,
                   detail=lambda: _with_counts(form_changes(market, written.form), written.verdicts))
    if written.verdicts.returned:
        ReviewTeam.deal_arrivals(market, requesting_user, Actions.CHANGE_FORM)
    return {"application_form": written.form, "formRevision": written.revision}


_NO_REVISION = object()


def _revision_in(body: Mapping[str, Any], key: str, not_a_count: str) -> Any:
    """The revision a save's body says its copy was read at, under ``key``: ``_NO_REVISION`` when
    it names none (the page from before the revision existed), or a ``BadRequestError`` saying
    ``not_a_count`` for one that is not a count; ``True`` is refused, though Python counts it as 1."""
    if key not in body:
        return _NO_REVISION
    revision = body[key]
    if isinstance(revision, bool) or not isinstance(revision, int) or revision < 0:
        raise BadRequestError(not_a_count)
    return revision


def _with_counts(
    detail: Optional[Dict[str, Any]], verdicts: RejectionRules.Judged,
) -> Optional[Dict[str, Any]]:
    """A write's detail with what the rules decided as it landed; a write that changed nothing
    stays unrecorded, as the rules judged nothing new."""
    return {**detail, **verdicts.counts()} if detail else None


class FormWritten(NamedTuple):
    """What a form write stored: the form as stored, what the rules decided against it, and the
    form's revision now."""
    form: Dict[str, Any]
    verdicts: RejectionRules.Judged
    revision: int


def write_application_form(
    market: Market, application_form_data: dict, form_revision: Any, overturns: bool = True,
) -> FormWritten:
    """Judge and store the form on ``market``, loaded and asked by the caller, and return it as
    stored with what the rules decided against it; the caller records it. ``form_revision`` is the
    revision the writer's copy was read at (``_NO_REVISION`` when it named none), and
    ``overturns`` whether the writer may overturn an automatic rejection, as
    ``RejectionRules.judge`` takes it.

    The write sets the questions and the unasked essentials alone, never the published stamp or the
    frozen offering, which Open applications and the first application write while the market is
    being edited; it holds the phase, the offering as read (the first application's freeze lands
    there before any answer does) and the revision, so a save from an older copy, or one crossing
    either of those, is refused instead of erasing them. A market with no form yet gets it whole,
    held absent as read.

    Raises:
        MarketChanged: no revision named, or the market changed since it was read.
    """
    form_dict = prepared_application_form(market, application_form_data)
    if form_revision is _NO_REVISION:
        raise MarketChanged(dict(document_as_read(market)))
    form_key = market_doc_key("application_form")
    # A stored form that is not a form fails the market's parse, so the model has one exactly when
    # the stored document does.
    if market.application_form is not None:
        fields_key, unasked_key = snake_to_camel("fields"), snake_to_camel("unasked_essentials")
        update = {"$set": {f"{form_key}.{fields_key}": form_dict[fields_key],
                           f"{form_key}.{unasked_key}": form_dict[unasked_key]}}
        holds: Tuple[str, ...] = (f"{form_key}.{snake_to_camel('essential_options')}",)
    else:
        update = {"$set": {form_key: {**form_dict, snake_to_camel("published_at"): None,
                                      snake_to_camel("essential_options"): None}}}
        holds = (form_key,)
    written = write_market(market, update, holds=holds, revisions={FORM_REVISION_KEY: form_revision})
    revision = written.revisions[FORM_REVISION_KEY]
    # The rules stand against the form as it now is (E33/F03/S02): a question taken away judges
    # nobody, and what it rejected is judged again.
    rewritten = load_market_context(market.id)
    if rewritten is not None and rewritten.market is not None:
        return FormWritten(form_dict, RejectionRules.judge(
            RejectionRules.Rulebook(rewritten.market), market.id, overturns=overturns), revision)
    return FormWritten(form_dict, RejectionRules.Judged(), revision)


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
        # The revision a save of this copy carries, so one from an older copy is refused.
        "formRevision": market.form_revision,
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
