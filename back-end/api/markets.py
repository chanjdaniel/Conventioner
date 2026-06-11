import uuid
from typing import Optional, Dict, Any, List
from pymongo.results import InsertOneResult, UpdateResult, DeleteResult
from bson import ObjectId
from datatypes import Market, MarketRole, MarketTableRow, UnassignedTableEntry
from assignment.assignment import assign_market
from assignment.utils import convert_keys_to_snake_case, convert_keys_to_camel_case
import api.source_data as SourceDataApi
import api.permissions as PermissionsApi
import api.organizations as OrgsApi
import api.users as UsersApi
import traceback
import logging
import os
import requests
from assignment.csv_output import convert_market_data_to_csv, market_csv_to_string
from db_config import get_database

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

db = get_database()
markets_collection = db["markets"]


def _strip_persisted_assignment_statistics(market_dict: Dict[str, Any]) -> None:
    """Keep assignment statistics derived at read-time only, never persisted."""
    assignment_object = market_dict.get("assignment_object")
    if isinstance(assignment_object, dict):
        assignment_object.pop("assignment_statistics", None)


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


def get_market_for_user(user_email: str, market_id: str) -> Optional[Dict[str, Any]]:
    """Get a market by id, checking user has access."""
    market_dict = markets_collection.find_one({"id": market_id})
    if not market_dict:
        return None
    
    market_dict_snake = convert_keys_to_snake_case(market_dict.copy())
    try:
        market = Market(**market_dict_snake)
    except Exception:
        return None
    
    organization = None
    if market.organization_id:
        org_dict = OrgsApi.get_organization(market.organization_id)
        if org_dict:
            org_dict.pop('_id', None)
            try:
                from datatypes import Organization
                organization = Organization(**org_dict)
            except Exception:
                pass
    
    user_role = PermissionsApi.get_user_market_role(user_email, market, organization)
    if user_role is None:
        return None
    
    market_dict['_id'] = str(market_dict['_id'])
    market_dict['user_role'] = user_role.value
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
            market['_id'] = str(market['_id'])
            market['user_role'] = market.get('roles', {}).get(user_id)
            if market.get('organization_id'):
                org = OrgsApi.get_organization(market['organization_id'])
                if org:
                    market['organization_name'] = org.get('name')
            role_emails = {}
            for uid in (market.get('roles') or {}).keys():
                u = UsersApi.get_user_by_id(uid)
                if u:
                    role_emails[uid] = u.email
            market['role_emails'] = role_emails
            result.append(market)
    
    user_orgs = OrgsApi.get_organizations_for_user(user_email)
    org_ids = [org['id'] for org in user_orgs]
    
    if org_ids:
        org_markets = markets_collection.find({
            "organization_id": {"$in": org_ids}
        })
        for market in org_markets:
            mid = market["id"]
            if mid not in seen_ids:
                seen_ids.add(mid)
                market['_id'] = str(market['_id'])
                market['user_role'] = MarketRole.VIEWER.value
                if market.get('organization_id'):
                    org = OrgsApi.get_organization(market['organization_id'])
                    if org:
                        market['organization_name'] = org.get('name')
                role_emails = {}
                for uid in (market.get('roles') or {}).keys():
                    u = UsersApi.get_user_by_id(uid)
                    if u:
                        role_emails[uid] = u.email
                market['role_emails'] = role_emails
                result.append(market)
    
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
    """Create a new market."""
    market_dict = market.model_dump()
    _strip_persisted_assignment_statistics(market_dict)
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
    existing_market_dict = markets_collection.find_one({"id": market_id})
    if not existing_market_dict:
        raise ValueError("Market not found")
    
    existing_market_dict_snake = convert_keys_to_snake_case(existing_market_dict.copy())
    try:
        existing_market = Market(**existing_market_dict_snake)
    except Exception as e:
        raise ValueError(f"Invalid market data: {e}")
    
    organization = None
    if existing_market.organization_id:
        org_dict = OrgsApi.get_organization(existing_market.organization_id)
        if org_dict:
            org_dict.pop('_id', None)
            try:
                from datatypes import Organization
                organization = Organization(**org_dict)
            except Exception:
                pass
    
    if not PermissionsApi.user_has_permission(requesting_user, existing_market, MarketRole.EDITOR, organization):
        raise PermissionError("User does not have permission to edit this market")
    
    market_dict = market.model_dump()
    _strip_persisted_assignment_statistics(market_dict)
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
        market_dict = markets_collection.find_one({"id": market_id})
        if not market_dict:
            return {"error": "Market not found"}, 404
        
        if requesting_user:
            market_dict_snake = convert_keys_to_snake_case(market_dict.copy())
            try:
                market = Market(**market_dict_snake)
            except Exception:
                return {"error": "Invalid market data"}, 400
            
            organization = None
            if market.organization_id:
                org_dict = OrgsApi.get_organization(market.organization_id)
                if org_dict:
                    org_dict.pop('_id', None)
                    try:
                        from datatypes import Organization
                        organization = Organization(**org_dict)
                    except Exception:
                        pass
            
            if not PermissionsApi.user_has_permission(requesting_user, market, MarketRole.VIEWER, organization):
                return {"error": "User does not have permission to view this market"}, 403
        
        market_dict = convert_keys_to_snake_case(market_dict)
        print("market_dict keys:", market_dict.keys())
        
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
            market = Market(**market_dict)
            assigned_market = assign_market(market, source_data)
            assigned_market_dict = assigned_market.model_dump()

            # generate CSV if the request was successful
            try:
                # Create CSV file in a dedicated directory
                csv_dir = "csv_exports"
                os.makedirs(csv_dir, exist_ok=True)
                csv_filename = os.path.join(csv_dir, f"{market_dict.get('name', market_id)}_assigned.csv")
                
                # Use absolute path to ensure file is created in the correct location
                csv_filename = os.path.abspath(csv_filename)
                
                logger.info(f"Attempting to generate CSV: {csv_filename}")
                logger.info(f"Current working directory: {os.getcwd()}")
                logger.info(f"CSV directory exists: {os.path.exists(csv_dir)}")
                logger.info(f"CSV directory absolute path: {os.path.abspath(csv_dir)}")
                logger.info(f"Source data available: {source_data is not None}")
                logger.info(f"Market data keys: {list(assigned_market_dict.keys())}")
                
                # Convert the assigned market data to CSV
                result_filename = convert_market_data_to_csv(assigned_market_dict, source_data, csv_filename)
                logger.info(f"CSV exported successfully: {result_filename}")
                logger.info(f"CSV file exists: {os.path.exists(result_filename)}")
                logger.info(f"CSV file absolute path: {os.path.abspath(result_filename)}")
                
                # List all files in csv_exports directory
                try:
                    csv_files = os.listdir(csv_dir)
                    logger.info(f"Files in csv_exports directory: {csv_files}")
                except Exception as e:
                    logger.error(f"Error listing csv_exports directory: {e}")
                
            except Exception as csv_error:
                logger.error(f"Failed to generate CSV for {market_id}: {str(csv_error)}")
                logger.error(f"CSV generation traceback: {traceback.format_exc()}")

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
        market_dict = markets_collection.find_one({"id": market_id})
        if not market_dict:
            return {"error": "Market not found"}, 404

        market_dict_snake = convert_keys_to_snake_case(market_dict.copy())
        try:
            market = Market(**market_dict_snake)
        except Exception:
            return {"error": "Invalid market data"}, 400

        if requesting_user:
            organization = None
            if market.organization_id:
                org_dict = OrgsApi.get_organization(market.organization_id)
                if org_dict:
                    org_dict.pop('_id', None)
                    try:
                        from datatypes import Organization
                        organization = Organization(**org_dict)
                    except Exception:
                        pass

            if not PermissionsApi.user_has_permission(requesting_user, market, MarketRole.VIEWER, organization):
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
        market_dict = markets_collection.find_one({"id": market_id})
        if not market_dict:
            return {"error": "Market not found"}, 404

        market_dict_snake = convert_keys_to_snake_case(market_dict.copy())
        try:
            market = Market(**market_dict_snake)
        except Exception:
            return {"error": "Invalid market data"}, 400

        if requesting_user:
            organization = None
            if market.organization_id:
                org_dict = OrgsApi.get_organization(market.organization_id)
                if org_dict:
                    org_dict.pop('_id', None)
                    try:
                        from datatypes import Organization
                        organization = Organization(**org_dict)
                    except Exception:
                        pass

            if not PermissionsApi.user_has_permission(requesting_user, market, MarketRole.VIEWER, organization):
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

        filename = _market_csv_filename(market_dict.get("name"), market_id)
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
        market_dict = markets_collection.find_one({"id": market_id})
        if not market_dict:
            return {"error": "Market not found"}, 404

        market_dict_snake = convert_keys_to_snake_case(market_dict.copy())
        try:
            market = Market(**market_dict_snake)
        except Exception:
            return {"error": "Invalid market data"}, 400

        if requesting_user:
            organization = None
            if market.organization_id:
                org_dict = OrgsApi.get_organization(market.organization_id)
                if org_dict:
                    org_dict.pop('_id', None)
                    try:
                        from datatypes import Organization
                        organization = Organization(**org_dict)
                    except Exception:
                        pass

            if not PermissionsApi.user_has_permission(requesting_user, market, MarketRole.VIEWER, organization):
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
        market_dict = markets_collection.find_one({"id": market_id})
        if not market_dict:
            return {"error": "Market not found"}, 404

        market_dict_snake = convert_keys_to_snake_case(market_dict.copy())
        try:
            market = Market(**market_dict_snake)
        except Exception:
            return {"error": "Invalid market data"}, 400

        organization = None
        if market.organization_id:
            org_dict = OrgsApi.get_organization(market.organization_id)
            if org_dict:
                org_dict.pop('_id', None)
                try:
                    from datatypes import Organization
                    organization = Organization(**org_dict)
                except Exception:
                    pass

        if not PermissionsApi.user_has_permission(requesting_user, market, MarketRole.OWNER, organization):
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
    market_dict = markets_collection.find_one({"id": market_id})
    if not market_dict:
        raise ValueError("Market not found")
    
    # Convert to Market object for permission checking
    market_dict_snake = convert_keys_to_snake_case(market_dict.copy())
    try:
        market = Market(**market_dict_snake)
    except Exception:
        raise ValueError("Invalid market data")
    
    organization = None
    if market.organization_id:
        org_dict = OrgsApi.get_organization(market.organization_id)
        if org_dict:
            org_dict.pop('_id', None)
            try:
                from datatypes import Organization
                organization = Organization(**org_dict)
            except Exception:
                pass
    
    if not PermissionsApi.can_manage_roles(requesting_user, market, role, organization):
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
    market_dict = markets_collection.find_one({"id": market_id})
    if not market_dict:
        raise ValueError("Market not found")
    
    # Convert to Market object for permission checking
    market_dict_snake = convert_keys_to_snake_case(market_dict.copy())
    try:
        market = Market(**market_dict_snake)
    except Exception:
        raise ValueError("Invalid market data")
    
    organization = None
    if market.organization_id:
        org_dict = OrgsApi.get_organization(market.organization_id)
        if org_dict:
            org_dict.pop('_id', None)
            try:
                from datatypes import Organization
                organization = Organization(**org_dict)
            except Exception:
                pass
    
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
    market_dict = markets_collection.find_one({"id": market_id})
    if not market_dict:
        raise ValueError("Market not found")
    
    # Convert to Market object for permission checking
    market_dict_snake = convert_keys_to_snake_case(market_dict.copy())
    try:
        market = Market(**market_dict_snake)
    except Exception:
        raise ValueError("Invalid market data")
    
    organization = None
    if market.organization_id:
        org_dict = OrgsApi.get_organization(market.organization_id)
        if org_dict:
            org_dict.pop('_id', None)
            try:
                from datatypes import Organization
                organization = Organization(**org_dict)
            except Exception:
                pass

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
    market_dict = markets_collection.find_one({"id": market_id})
    if not market_dict:
        raise ValueError("Market not found")

    # Convert to Market object for permission checking
    market_dict_snake = convert_keys_to_snake_case(market_dict.copy())
    try:
        market = Market(**market_dict_snake)
    except Exception:
        raise ValueError("Invalid market data")

    organization = None
    if market.organization_id:
        org_dict = OrgsApi.get_organization(market.organization_id)
        if org_dict:
            org_dict.pop('_id', None)
            try:
                from datatypes import Organization
                organization = Organization(**org_dict)
            except Exception:
                pass

    user_role = PermissionsApi.get_user_market_role(requesting_user, market, organization)
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
