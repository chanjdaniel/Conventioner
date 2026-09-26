from datetime import datetime, timezone
import re
import uuid
from typing import NamedTuple, Optional, Dict, Any, List, Tuple
from pymongo.errors import DuplicateKeyError
from pymongo.results import DeleteResult
from pydantic import ValidationError
from datatypes import (
    ApplicationForm,
    EssentialFormOptions,
    FormField,
    IntakeMode,
    Market,
    MarketPhase,
    MarketRole,
    MarketTableRow,
    Organization,
    SetupObject,
    UnassignedTableEntry,
    intake_mode_from_market_document,
    market_name_slug,
    phase_label,
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
from assignment.utils import convert_keys_to_snake_case, convert_keys_to_camel_case
import api.applications as ApplicationsApi
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
import placement_history as PlacementHistory
import api.organizations as OrgsApi
import api.users as UsersApi
import traceback
import logging
from assignment.csv_output import market_csv_to_string
from guards import route_between
from assignment.made_from import assignment_rules, changed_since_run
from placement_reasons import overridden_placements, unplaced_dates
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


def application_form_lock_reason(market: Market) -> Optional[str]:
    """The single source of truth for whether a market's application form may be edited.

    Returns the human-readable reason the form is locked, or None when it is editable.
    Phase gate: forms are editable only in ``draft``. D9: the form freezes for good once
    any application exists, so applicants can never have answered a question that moved.
    """
    if market.phase != MarketPhase.DRAFT:
        return (
            "Application form can only be edited while the market is in draft phase. "
            f"Current phase: {phase_label(market.phase)}."
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
    "runs, and this market can no longer run it; change a single placement from the result instead."
)


def assignment_rules_lock_reason(phase: MarketPhase) -> Optional[str]:
    """Why the assignment rules may no longer change, or None while they still can (E22/F02).

    A rule - the priority, the max assignments per vendor, the half-table proportion - only takes
    effect when the assignment runs, and it runs in the ``assignment`` phase alone. So the rules
    are open for exactly as long as the market can still get there. That is derived from the
    transition table rather than listed, so a phase added or an edge moved decides it with no edit
    here: today it closes them in ``offers``, ``market_days`` and ``archived``.
    """
    if route_between(phase.value, MarketPhase.ASSIGNMENT.value) is not None:
        return None
    return ASSIGNMENT_RULES_SETTLED


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
    """The assignment every read-only view should describe: the stored one, when there is one.

    A market that has never been assigned has nothing stored, and showing it the run it would get
    is the only useful thing to show - the statistics screen exists to be looked at before Assign
    is pressed. A market that HAS been assigned is shown what it stored, because that is what
    check-in reads and what the organizer has been editing (E11/F03/S01). Deciding this once, in
    one function, is what stops the payoff screen and the tables grid describing different markets.
    """
    if market.assignment_object.vendor_assignments:
        return describe_stored_assignment(market, vendors)
    return assign_market(market, vendors)


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
    market_dict['assignmentRulesLockReason'] = assignment_rules_lock_reason(market.phase)
    # Which of the rules, the plan and the approved applications changed since the stored
    # assignment ran (E22/F03/S01). Computed on read, never stored; empty when nothing has, or when
    # the assignment predates the fingerprints and so is not known to be out of date.
    market_dict['assignmentOutOfDate'] = changed_since_run(market)
    if market.organization_id and org_dict:
        market_dict['organization_name'] = org_dict.get('name')
    role_emails = {}
    for uid in (market_dict.get('roles') or {}).keys():
        u = UsersApi.get_user_by_id(uid)
        if u:
            role_emails[uid] = u.email
    market_dict['role_emails'] = role_emails
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

    pipeline = [
        {"$addFields": {"roles_array": {"$objectToArray": {"$ifNull": ["$roles", {}]}}}},
        {"$match": {"roles_array": {"$elemMatch": {"k": user_id}}}},
        {"$project": {"roles_array": 0}}
    ]
    markets_with_role = markets_collection.aggregate(pipeline)

    for market in markets_with_role:
        mid = market["id"]
        if mid not in seen_ids:
            seen_ids.add(mid)
            result.append(_decorate_market_summary(
                market, market.get('roles', {}).get(user_id), lookups
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
                result.append(_decorate_market_summary(market, MarketRole.VIEWER.value, lookups))

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
    try:
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
        try:
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

        except Exception as validation_error:
            logger.error(f"Market validation error: {validation_error}")
            logger.error(f"Validation error type: {type(validation_error)}")
            logger.error(f"Full traceback: {traceback.format_exc()}")  # Add this line
            if hasattr(validation_error, 'errors'):
                logger.error(f"Validation errors: {validation_error.errors()}")
            
            # Return more detailed validation error
            error_details = {
                "error": "Market validation failed",
                "message": str(validation_error),
                "error_type": type(validation_error).__name__,
                "market_id": market_id
            }
            
            if hasattr(validation_error, 'errors'):
                error_details["validation_errors"] = validation_error.errors()
            
            return error_details, 400

    except Exception as e:
        logger.error(f"Unexpected error in get_assigned_market: {str(e)}")
        logger.error(f"Error type: {type(e)}")
        
        # Return detailed error information
        return {
            "error": "Internal server error",
            "message": str(e),
            "error_type": type(e).__name__,
            "market_id": market_id,
            "function": "get_assigned_market"
        }, 500


def get_assignment_statistics(market_id: str, requesting_user: Optional[str] = None) -> tuple[Dict[str, Any], int]:
    """Derive and return assignment statistics for a market."""
    try:
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
            for entry in overridden_placements(vendors, placed_rows)
        ]
        # Unassigned vendors are a list of bare addresses; this is what lets the payoff screen
        # name them. A vendor with no stored name has no entry and renders as they did before.
        payload["vendorNames"] = ApplicationsApi.vendor_names_for_market(market_id)
        return payload, 200
    except Exception as e:
        logger.error(f"Unexpected error in get_assignment_statistics: {str(e)}")
        logger.error(f"Error type: {type(e)}")
        return {
            "error": "Internal server error",
            "message": str(e),
            "error_type": type(e).__name__,
            "market_id": market_id,
            "function": "get_assignment_statistics"
        }, 500


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
    try:
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
            assigned_market = assignment_to_show(market)
        except IncompleteApplicationsError as incomplete:
            # The organizer has to go and fix something, so say who.
            return {"error": incomplete.message()}, 400
        assigned_market_dict = assigned_market.model_dump()

        try:
            csv_content = market_csv_to_string(
                assigned_market_dict, ApplicationsApi.vendor_names_for_market(market_id),
            )
        except ValueError as e:
            return {"error": str(e)}, 400

        filename = _market_csv_filename(context.document.get("name"), market_id)
        return {"csv_content": csv_content, "filename": filename, "market_id": market_id}, 200
    except Exception as e:
        logger.error(f"Unexpected error in get_assignment_csv: {str(e)}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        return {
            "error": "Internal server error",
            "message": str(e),
            "error_type": type(e).__name__,
            "market_id": market_id,
            "function": "get_assignment_csv",
        }, 500


def get_market_tables(market_id: str, requesting_user: Optional[str] = None) -> tuple[List[Dict[str, Any]] | Dict[str, Any], int]:
    """Derive and return table rows for a market."""
    try:
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
            # Who may be put in a seat, and what they asked for. Sent with the grid because the
            # view has to warn - before the change, not after - when a placement would alter a
            # vendor's table choice away from their own answer (E11/F03/S01).
            "vendors": [
                {
                    "email": vendor.email,
                    "tableChoice": vendor.table_choice,
                    "availableDates": sorted(vendor.available_dates),
                }
                for vendor in vendors
            ],
        }, 200
    except Exception as e:
        logger.error(f"Unexpected error in get_market_tables: {str(e)}")
        logger.error(f"Error type: {type(e)}")
        return {
            "error": "Internal server error",
            "message": str(e),
            "error_type": type(e).__name__,
            "market_id": market_id,
            "function": "get_market_tables"
        }, 500


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
    the publish path - and does NOT stamp. A market published straight from draft never opened its
    form to anybody, and the two fields therefore say different things: ``phase`` is where the
    market is now, this is whether the form was ever opened to applicants.

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


def apply_phase_transition(market_id: str, document: Dict[str, Any], to_phase: str) -> None:
    """Write one phase change, conditional on the market still being where the caller thinks.

    Extracted from the transition endpoint so the form-amendment chain (E20/F03/S01) walks the
    market with the SAME writer rather than a second copy of it. A second copy is how the
    `isDraft` stamp and the finalization stamp come to disagree with `phase`.

    ONE atomic update, and one conditional on the stored phase: a failure between the phase and
    the stamp would leave a market whose two answers disagree, which is the class of bug
    `migrate_is_draft_consistency` exists to repair, and a lost update would move a market a
    concurrent request had already moved.

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
        {"$set": {
            phase_key: to_phase,
            is_draft_key: to_phase == MarketPhase.DRAFT.value,
            **finalization_update(from_phase, to_phase, document),
        }},
    )

    if result.matched_count:
        return

    latest = markets_collection.find_one({"id": market_id})
    if latest is None:
        raise MarketNotFoundError("Market not found")
    raise PhaseChangedUnderRequest(phase_from_market_document(latest).value)


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

    # The placement trail is kept WITH the market, not beyond it (E11/F04/S01). It names the
    # organizers who made each change, so leaving it behind would outlive the thing it describes.
    try:
        PlacementHistory.delete_for_market(market_id)
    except Exception as e:
        logger.warning(f"Failed to delete placement history for market {market_id}: {e}")

    return markets_collection.delete_one({"id": market_id})


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

    market = _load_market_for(market_id, requesting_user, MarketRole.EDITOR, "rename")
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

    market = _load_market_for(market_id, requesting_user, MarketRole.EDITOR, "edit")

    try:
        plan = SetupObject(**convert_keys_to_snake_case(body["setupObject"]))
    except ValidationError as e:
        raise ValueError(f"Invalid plan: {e}") from e
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

    # The plan saves as the organizer types, in every phase, and always carries the rules it holds;
    # restating the stored rules is not a change, and anything else is refused once they are
    # settled (E22/F02/S01).
    settled = assignment_rules_lock_reason(market.phase)
    if settled and assignment_rules(plan) != assignment_rules(market.setup_object):
        raise ValueError(settled)

    markets_collection.update_one(market_doc_filter("id", market_id), {"$set": update})


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
    _load_market_for(market_id, requesting_user, MarketRole.EDITOR, "edit")

    seen: List[str] = []
    for key in keys:
        cleaned = key.strip()
        if cleaned and cleaned not in seen:
            seen.append(cleaned)

    markets_collection.update_one({"id": market_id}, market_doc_set("review_highlights", seen))
    return seen


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
    market = _load_market_for(market_id, requesting_user, MarketRole.EDITOR, "edit")
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

    form_dict = convert_keys_to_camel_case(application_form.model_dump())
    markets_collection.update_one(
        {"id": market_id},
        {"$set": {"applicationForm": form_dict}}
    )

    return form_dict


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
