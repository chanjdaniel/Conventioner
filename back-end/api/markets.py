import uuid
from typing import Optional, Dict, Any, List
from pymongo.results import InsertOneResult, UpdateResult, DeleteResult
from bson import ObjectId
from datatypes import Market, MarketRole
from assignment.assignment import assign_market
from assignment.utils import convert_keys_to_snake_case, convert_keys_to_camel_case
import api.source_data as SourceDataApi
import api.permissions as PermissionsApi
import api.organizations as OrgsApi
import api.users as UsersApi
import traceback
import logging
import os
from assignment.csv_output import convert_market_data_to_csv
from db_config import get_database

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

db = get_database()
markets_collection = db["markets"]

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
                    "max_half_table_proportion_per_section": None
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
