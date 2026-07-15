import re
import uuid
from typing import NamedTuple, Optional, Dict, Any, List, Tuple
from pymongo.results import InsertOneResult, UpdateResult, DeleteResult
from pydantic import BaseModel
from bson import ObjectId
from datatypes import (
    ApplicationForm,
    FormField,
    Market,
    MarketPhase,
    MarketRole,
    MarketTableRow,
    Organization,
    UnassignedTableEntry,
    phase_from_market_document,
)
from assignment.assignment import assign_market
from assignment.utils import convert_keys_to_snake_case, convert_keys_to_camel_case, snake_to_camel
import api.applications as ApplicationsApi
from market_documents import (
    market_doc_field,
    market_doc_filter,
    market_doc_key,
    market_from_document,
)
import api.source_data as SourceDataApi
import api.permissions as PermissionsApi
import api.organizations as OrgsApi
import api.users as UsersApi
import traceback
import logging
import requests
from assignment.csv_output import market_csv_to_string
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
            f"Current phase: {market.phase.value}."
        )

    existing_app_count = ApplicationsApi.count_applications_for_market(market.id)
    if existing_app_count > 0:
        return (
            "Application form is locked. "
            f"{existing_app_count} application(s) already exist for this market. "
            "The form cannot be modified once applicants have submitted."
        )

    return None


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
    application_form: ApplicationForm, published_at: Optional[str] = None
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
    """
    if not application_form.fields:
        raise ValueError("Application form must include at least one field")

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

    return application_form.model_copy(update={"fields": fields, "published_at": published_at})


def _application_form_dump(market: Market) -> Optional[Dict[str, Any]]:
    return market.application_form.model_dump() if market.application_form else None


def _strip_persisted_assignment_statistics(market_dict: Dict[str, Any]) -> None:
    """Keep assignment statistics derived at read-time only, never persisted."""
    assignment_object = market_dict.get("assignment_object")
    if isinstance(assignment_object, dict):
        assignment_object.pop("assignment_statistics", None)


def _preserve_server_owned_fields(
    market_dict: Dict[str, Any], market: Market, existing_market: Market
) -> None:
    """Keep market state the update payload does not own.

    `phase` is lifecycle state advanced by the server, never by an update body. `application_form`
    is written only by ``save_application_form``: a single writer keeps the D9 lock unbypassable
    and stops a stale client copy of the market from silently reverting a saved form on the next
    PUT. Both are always taken from the stored market, whatever the payload carries.

    `isDraft` is derived strictly from `phase` and rewritten here from the stored phase, never
    from the payload. No read consults the stored value while the document's `phase` is one this
    build knows -- ``Market.is_draft`` is computed, and no query filters on it. It is kept in
    agreement anyway because it is the fallback ``phase_from_market_document`` drops to when
    `phase` is missing or unrecognized (an older build reading a phase a newer one wrote, say),
    and a fallback that disagrees with the phase is worse than no fallback: it answers
    confidently and wrongly.

    The remaining Conventioner fields are carried over whenever the payload omits them, so a client
    that round-trips a market it fetched cannot null them out; an explicit null still clears them.
    """
    market_dict["phase"] = existing_market.phase.value
    market_dict["is_draft"] = existing_market.is_draft
    market_dict["application_form"] = _application_form_dump(existing_market)
    # results_published is a server-owned gate: only the publish-results endpoint flips it.
    market_dict["results_published"] = existing_market.results_published
    for field in ("review_config", "discord_guild_id"):
        if field in market.model_fields_set:
            continue
        existing_value = getattr(existing_market, field)
        if existing_value is None:
            continue
        market_dict[field] = (
            existing_value.model_dump()
            if isinstance(existing_value, BaseModel)
            else existing_value
        )


def derive_market_table_rows(assigned_market: Market) -> List[MarketTableRow]:
    """Derive one row per table/date with assignment slots."""
    setup_object = assigned_market.setup_object
    if setup_object is None:
        return []

    # Map assignment date values (often col_name) back to configured market date.
    date_aliases: Dict[str, str] = {}
    for market_date in setup_object.market_dates:
        date_aliases[market_date.date] = market_date.date
        if market_date.col_name:
            date_aliases[market_date.col_name] = market_date.date

    rows_by_key: Dict[tuple[str, str], Dict[str, Any]] = {}

    for market_date in setup_object.market_dates:
        for section in setup_object.sections:
            for idx in range(section.count):
                table_code = f"{section.name}{idx + 1}"
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
        date_value = date_aliases.get(assignment.date, assignment.date)
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
            location=row["location"],
            section=row["section"],
            table_choice=table_choice,
            table_code=row["table_code"],
            tier=row["tier"],
        ))

    return sorted(rows, key=lambda row: (row.date, row.location, row.section, row.table_code))


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


def _stamp_effective_phase(market: Dict[str, Any], phase: MarketPhase) -> None:
    """Serve a raw market document with its phase and ``isDraft`` agreeing.

    A response built from a raw document bypasses ``Market``, and with it the guarantee that
    ``is_draft`` is derived strictly from phase - a document the old publish flow wrote
    (``phase: draft`` from create, ``isDraft: false`` from the publish PUT) would otherwise go
    out with the two fields contradicting each other. Deriving ``isDraft`` from the effective
    phase here means no reader has to know which of the two to believe, migrated or not.
    """
    market['phase'] = phase.value
    market[market_doc_key('is_draft')] = phase == MarketPhase.DRAFT


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
    _stamp_effective_phase(market_dict, market.phase)
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
    _stamp_effective_phase(market, phase_from_market_document(market))
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
    
    existing_market = markets_collection.find_one({"name": market.name})
    if existing_market:
        raise ValueError("Market already exists")
    
    result = markets_collection.insert_one(market_dict)
    
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

def update_market(market_id: str, market: Market, requesting_user: str) -> UpdateResult:
    """Update an existing market. Requires EDIT permission."""
    existing_market = _load_market_for(market_id, requesting_user, MarketRole.EDITOR, "edit")

    market_dict = market.model_dump()
    _strip_persisted_assignment_statistics(market_dict)
    _preserve_server_owned_fields(market_dict, market, existing_market)
    market_dict["roles"] = _convert_roles_keys_to_user_ids(market_dict.get("roles", {}))
    market_dict = convert_keys_to_camel_case(market_dict)
    
    old_org_id = existing_market.organization_id
    new_org_id = market.organization_id
    if old_org_id != new_org_id:
        organizations_collection = db["organizations"]
        if old_org_id:
            organizations_collection.update_one(
                {"id": old_org_id},
                {"$pull": {"markets": market_id}}
            )
        if new_org_id:
            organizations_collection.update_one(
                {"id": new_org_id},
                {"$addToSet": {"markets": market_id}}
            )
    
    return markets_collection.update_one({"id": market_id}, {"$set": market_dict})

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
                    "email_col_name_idx": None,
                    "table_choice_col_name_idx": None,
                    "table_share_email_col_name_idx": None,
                    "max_days_col_name_idx": None,
                }
        
        # Fix None assignment_object
        # temp reset
        # if "assignment_object" not in market_dict or market_dict["assignment_object"] is None:
        market_dict["assignment_object"] = {
            "vendor_assignments": [],
            "assignment_date": "",
            "assignment_statistics": None
        }

        # get market source data
        source_data = None
        try:
            source_data_result = SourceDataApi.get_source_data(market_id)
            if source_data_result is None:
                raise Exception("Source data not found")
                
            source_data, _ = source_data_result  # Extract dict, ignore status code

        except Exception as e:
            logger.error(f"Error getting market source data: {str(e)}")
            logger.error(f"Error type: {type(e)}")

        # Convert dictionary to Market object
        try:
            market = market_from_document(context.document, market_dict)
            assigned_market = assign_market(market, source_data)
            assigned_market_dict = assigned_market.model_dump()

            assigned_market_dict = convert_keys_to_camel_case(assigned_market_dict)
            if market_dict.get('organization_id'):
                org = OrgsApi.get_organization(market_dict['organization_id'])
                if org:
                    assigned_market_dict['organizationName'] = org.get('name')
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

        source_data_result = SourceDataApi.get_source_data(market_id)
        if source_data_result is None:
            return {"error": "Source data not found"}, 404
        source_data, source_status = source_data_result
        if source_status != 200:
            return source_data, source_status

        # Keep persisted schema free of assignment statistics, then derive fresh.
        market.assignment_object.assignment_statistics = None
        assigned_market = assign_market(market, source_data)
        stats = assigned_market.assignment_object.assignment_statistics
        if stats is None:
            return {"error": "Unable to derive assignment statistics"}, 500

        rows = derive_market_table_rows(assigned_market)
        stats.unassigned_tables = derive_unassigned_tables_from_rows(rows)

        return convert_keys_to_camel_case(stats.model_dump()), 200
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

        source_data_result = SourceDataApi.get_source_data(market_id)
        if source_data_result is None:
            return {"error": "Source data not found"}, 404
        source_data, source_status = source_data_result
        if source_status != 200:
            return source_data, source_status

        market.assignment_object.assignment_statistics = None
        assigned_market = assign_market(market, source_data)
        assigned_market_dict = assigned_market.model_dump()

        try:
            csv_content = market_csv_to_string(assigned_market_dict, source_data)
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

        source_data_result = SourceDataApi.get_source_data(market_id)
        if source_data_result is None:
            return {"error": "Source data not found"}, 404
        source_data, source_status = source_data_result
        if source_status != 200:
            return source_data, source_status

        market.assignment_object.assignment_statistics = None
        assigned_market = assign_market(market, source_data)
        rows = derive_market_table_rows(assigned_market)
        return [convert_keys_to_camel_case(row.model_dump()) for row in rows], 200
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


def _top_n_by_count(counts: Optional[Dict[str, int]], n: int) -> List[tuple]:
    """Return the top-N (label, count) pairs by descending count for Discord summary fields."""
    if not counts:
        return []
    return sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:n]


def _build_discord_payload(market: Market, assigned_market: Market) -> Dict[str, Any]:
    """Build the Discord webhook JSON payload summarizing the assignment for one market."""
    stats = assigned_market.assignment_object.assignment_statistics

    total_assignments = stats.total_assignments if stats else 0
    total_vendors = stats.total_vendors if stats else 0
    total_tables = stats.total_tables if stats else 0
    satisfaction_pct = round((stats.satisfaction_score or 0.0) * 100, 1) if stats else 0.0
    unassigned_vendor_count = len(stats.unassigned_vendors) if stats else 0
    unassigned_table_count = (
        sum(len(entries) for entries in (stats.unassigned_tables or {}).values()) if stats else 0
    )

    fields: List[Dict[str, Any]] = [
        {"name": "Assignments", "value": str(total_assignments), "inline": True},
        {"name": "Vendors", "value": str(total_vendors), "inline": True},
        {"name": "Tables", "value": str(total_tables), "inline": True},
        {"name": "Satisfaction", "value": f"{satisfaction_pct}%", "inline": True},
        {"name": "Unassigned Vendors", "value": str(unassigned_vendor_count), "inline": True},
        {"name": "Unassigned Tables", "value": str(unassigned_table_count), "inline": True},
    ]

    top_sections = _top_n_by_count(stats.assignments_per_section if stats else None, 3)
    if top_sections:
        formatted = "\n".join(f"{name}: {count}" for name, count in top_sections)
        fields.append({"name": "Top Sections", "value": formatted, "inline": False})

    summary_line = (
        f"{market.name}: {total_assignments} assignments across "
        f"{total_vendors} vendors and {total_tables} tables "
        f"({satisfaction_pct}% satisfaction)."
    )

    return {
        "content": summary_line,
        "embeds": [
            {
                "title": market.name,
                "description": "Assignment summary",
                "fields": fields,
            }
        ],
    }


def post_assignment_to_discord(market_id: str, requesting_user: str) -> tuple[Dict[str, Any], int]:
    """Post a formatted assignment summary to the market's configured Discord webhook.

    The webhook URL is treated as a secret and never logged. Only the market owner
    may invoke this endpoint; lesser roles receive 403.
    """
    try:
        context = load_market_context(market_id)
        if context is None:
            return {"error": "Market not found"}, 404
        if context.market is None:
            return {"error": "Invalid market data"}, 400

        market = context.market

        if not PermissionsApi.user_has_permission(requesting_user, market, MarketRole.OWNER, context.organization):
            return {"error": "User does not have permission to post to Discord for this market"}, 403

        webhook_url = (market.discord_webhook_url or "").strip()
        if not webhook_url:
            return {"error": "No Discord webhook configured for this market"}, 400

        if market.setup_object is None:
            return {"error": "Market has no setup configured"}, 400

        source_data_result = SourceDataApi.get_source_data(market_id)
        if source_data_result is None:
            return {"error": "Source data not found"}, 404
        source_data, source_status = source_data_result
        if source_status != 200:
            return source_data, source_status

        market.assignment_object.assignment_statistics = None
        assigned_market = assign_market(market, source_data)

        payload = _build_discord_payload(market, assigned_market)

        try:
            response = requests.post(webhook_url, json=payload, timeout=5)
        except requests.RequestException as e:
            return {"error": f"Failed to reach Discord: {e}"}, 502

        if 200 <= response.status_code < 300:
            return {"message": "Posted to Discord", "status": "ok"}, 200
        return {"error": f"Discord webhook returned {response.status_code}"}, 502
    except Exception as e:
        logger.error(f"Unexpected error in post_assignment_to_discord: {str(e)}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        return {
            "error": "Internal server error",
            "message": str(e),
            "error_type": type(e).__name__,
            "market_id": market_id,
            "function": "post_assignment_to_discord",
        }, 500


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

    try:
        SourceDataApi.delete_source_data(market_id)
    except Exception as e:
        logger.warning(f"Failed to delete source data for {market_id}: {e}")

    if market.organization_id:
        try:
            organizations_collection = db["organizations"]
            organizations_collection.update_one(
                {"id": market.organization_id},
                {"$pull": {"markets": market_id}}
            )
        except Exception as e:
            logger.warning(f"Failed to remove market from organization: {e}")

    return markets_collection.delete_one({"id": market_id})


def save_application_form(market_id: str, application_form_data: dict, requesting_user: str) -> dict:
    """Save or update the application form for a market.

    The only writer of ``Market.application_form`` on an existing market: ``update_market``
    preserves the stored form rather than accepting one from a market body, so every write
    passes the lock below.

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
    """
    market = _load_market_for(market_id, requesting_user, MarketRole.VIEWER, "view")

    lock_reason = application_form_lock_reason(market)
    form_dict = _application_form_dump(market)

    return {
        "application_form": convert_keys_to_camel_case(form_dict) if form_dict else None,
        "editable": lock_reason is None,
        "lock_reason": lock_reason,
    }
