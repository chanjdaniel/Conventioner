from typing import Optional, Dict, Any, List
from pymongo.results import InsertOneResult, UpdateResult
from bson import ObjectId
from datatypes import Market, MarketRole
from assignment.assignment import assign_market
from assignment.utils import convert_keys_to_snake_case, convert_keys_to_camel_case
import api.source_data as SourceDataApi
import api.permissions as PermissionsApi
import api.organizations as OrgsApi
import traceback
import logging
import os
from assignment.csv_output import convert_market_data_to_csv
from db_config import get_database

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

db = get_database()
markets_collection = db["markets"]

def get_market(market_name: str) -> Optional[Dict[str, Any]]:
    """Get a market by name. (Deprecated - use get_market_for_user instead)"""
    return markets_collection.find_one({"name": market_name})


def get_market_for_user(user_email: str, market_name: str) -> Optional[Dict[str, Any]]:
    """Get a market by name, checking user has access."""
    # Try to find market (may have different owners, so search by name first)
    market_dict = markets_collection.find_one({"name": market_name})
    if not market_dict:
        return None
    
    # Convert to Market object for permission checking
    market_dict_snake = convert_keys_to_snake_case(market_dict.copy())
    try:
        market = Market(**market_dict_snake)
    except Exception:
        # If conversion fails, return None
        return None
    
    # Get organization if market belongs to one
    organization = None
    if market.organization:
        org_dict = OrgsApi.get_organization(market.organization)
        if org_dict:
            org_dict.pop('_id', None)
            try:
                from datatypes import Organization
                organization = Organization(**org_dict)
            except Exception:
                pass
    
    # Check user has access
    user_role = PermissionsApi.get_user_market_role(user_email, market, organization)
    if user_role is None:
        return None  # No access
    
    market_dict['_id'] = str(market_dict['_id'])
    market_dict['user_role'] = user_role.value
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
    market_ids = set()
    result = []
    
    # Get markets where user has explicit role
    markets_with_role = markets_collection.find({
        f"roles.{user_email}": {"$exists": True}
    })
    
    for market in markets_with_role:
        market_id = (market["name"], market["owner"])
        if market_id not in market_ids:
            market_ids.add(market_id)
            market['_id'] = str(market['_id'])
            # Add user's role to market dict
            market['user_role'] = market.get('roles', {}).get(user_email)
            result.append(market)
    
    # Get user's organizations
    user_orgs = OrgsApi.get_organizations_for_user(user_email)
    org_names = [org['name'] for org in user_orgs]
    
    # Get markets belonging to user's organizations
    if org_names:
        org_markets = markets_collection.find({
            "organization": {"$in": org_names}
        })
        
        for market in org_markets:
            market_id = market["name"]  # Use name as unique identifier
            if market_id not in market_ids:
                market_ids.add(market_id)
                market['_id'] = str(market['_id'])
                # User gets VIEWER role via organization
                market['user_role'] = MarketRole.VIEWER.value
                result.append(market)
    
    return result

def create_market(market: Market) -> InsertOneResult:
    """Create a new market."""
    market_dict = market.model_dump()
    
    # Validate that roles dict has exactly one owner
    owner_count = sum(1 for role in market_dict.get('roles', {}).values() if role == MarketRole.OWNER.value)
    if owner_count != 1:
        raise ValueError("Market must have exactly one owner in roles dict")
    
    market_dict = convert_keys_to_camel_case(market_dict)
    existing_market = markets_collection.find_one({"name": market.name})
    if existing_market:
        raise ValueError("Market already exists")
    
    result = markets_collection.insert_one(market_dict)
    
    # If market belongs to organization, add to organization's markets list
    if market.organization:
        try:
            import api.organizations as OrgsApi
            org = OrgsApi.get_organization(market.organization)
            if org:
                from db_config import get_database
                db = get_database()
                organizations_collection = db["organizations"]
                organizations_collection.update_one(
                    {"name": market.organization},
                    {"$addToSet": {"markets": market.name}}
                )
        except Exception as e:
            logger.warning(f"Failed to add market to organization: {e}")
    
    return result

def update_market(market_name: str, market: Market, requesting_user: str) -> UpdateResult:
    """Update an existing market. Requires EDIT permission."""
    # Get existing market
    existing_market_dict = markets_collection.find_one({"name": market_name})
    if not existing_market_dict:
        raise ValueError("Market not found")
    
    # Convert to Market object for permission checking
    existing_market_dict_snake = convert_keys_to_snake_case(existing_market_dict.copy())
    try:
        existing_market = Market(**existing_market_dict_snake)
    except Exception as e:
        raise ValueError(f"Invalid market data: {e}")
    
    # Get organization if market belongs to one
    organization = None
    if existing_market.organization:
        org_dict = OrgsApi.get_organization(existing_market.organization)
        if org_dict:
            org_dict.pop('_id', None)
            try:
                from datatypes import Organization
                organization = Organization(**org_dict)
            except Exception:
                pass
    
    # Check user has EDIT permission (Owner/Admin/Editor)
    if not PermissionsApi.user_has_permission(requesting_user, existing_market, MarketRole.EDITOR, organization):
        raise PermissionError("User does not have permission to edit this market")
    
    market_dict = market.model_dump()
    market_dict = convert_keys_to_camel_case(market_dict)
    
    return markets_collection.update_one({"name": market_name}, {"$set": market_dict})

def get_assigned_market(market_name: str, requesting_user: Optional[str] = None) -> tuple[Dict[str, Any], int]:
    """Get an assigned market. Requires VIEW permission."""
    try:
        market_dict = markets_collection.find_one({"name": market_name})
        if not market_dict:
            return {"error": "Market not found"}, 404
        
        # Check permission if requesting_user is provided
        if requesting_user:
            market_dict_snake = convert_keys_to_snake_case(market_dict.copy())
            try:
                market = Market(**market_dict_snake)
            except Exception:
                return {"error": "Invalid market data"}, 400
            
            # Get organization if market belongs to one
            organization = None
            if market.organization:
                org_dict = OrgsApi.get_organization(market.organization)
                if org_dict:
                    org_dict.pop('_id', None)
                    try:
                        from datatypes import Organization
                        organization = Organization(**org_dict)
                    except Exception:
                        pass
            
            # Check user has VIEW permission
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
            # Get source data and extract the dictionary
            source_data_result = SourceDataApi.get_source_data(market_name)
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
                csv_filename = os.path.join(csv_dir, f"{market_name}_assigned.csv")
                
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
                # Log CSV generation error but don't fail the API call
                logger.error(f"Failed to generate CSV for {market_name}: {str(csv_error)}")
                logger.error(f"CSV generation traceback: {traceback.format_exc()}")

            assigned_market_dict = convert_keys_to_camel_case(assigned_market_dict)
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
                "market_name": market_name
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
            "market_name": market_name,
            "function": "get_assigned_market"
        }, 500


def add_market_role(market_name: str, user_email: str, role: MarketRole, requesting_user: str) -> bool:
    """Add a user role to a market. Requires permission to manage roles."""
    market_dict = markets_collection.find_one({"name": market_name})
    if not market_dict:
        raise ValueError("Market not found")
    
    # Convert to Market object for permission checking
    market_dict_snake = convert_keys_to_snake_case(market_dict.copy())
    try:
        market = Market(**market_dict_snake)
    except Exception:
        raise ValueError("Invalid market data")
    
    # Get organization if market belongs to one
    organization = None
    if market.organization:
        org_dict = OrgsApi.get_organization(market.organization)
        if org_dict:
            org_dict.pop('_id', None)
            try:
                from datatypes import Organization
                organization = Organization(**org_dict)
            except Exception:
                pass
    
    # Check requesting user can manage this role
    if not PermissionsApi.can_manage_roles(requesting_user, market, role, organization):
        raise PermissionError("User does not have permission to manage this role")
    
    # Validate role constraints
    if role == MarketRole.OWNER:
        # Check if there's already an owner
        current_roles = market_dict.get('roles', {})
        for email, existing_role in current_roles.items():
            if existing_role == MarketRole.OWNER.value:
                raise ValueError("Market already has an owner. Transfer ownership first.")
    
    # Add user to roles dict
    roles = market_dict.get('roles', {})
    roles[user_email] = role.value
    
    # Update market
    result = markets_collection.update_one(
        {"name": market_name},
        {"$set": {"roles": roles}}
    )
    
    return result.modified_count > 0


def remove_market_role(market_name: str, user_email: str, requesting_user: str) -> bool:
    """Remove a user role from a market. Requires permission to manage roles."""
    market_dict = markets_collection.find_one({"name": market_name})
    if not market_dict:
        raise ValueError("Market not found")
    
    # Convert to Market object for permission checking
    market_dict_snake = convert_keys_to_snake_case(market_dict.copy())
    try:
        market = Market(**market_dict_snake)
    except Exception:
        raise ValueError("Invalid market data")
    
    # Get organization if market belongs to one
    organization = None
    if market.organization:
        org_dict = OrgsApi.get_organization(market.organization)
        if org_dict:
            org_dict.pop('_id', None)
            try:
                from datatypes import Organization
                organization = Organization(**org_dict)
            except Exception:
                pass
    
    # Check user exists in roles
    roles = market_dict.get('roles', {})
    if user_email not in roles:
        raise ValueError("User does not have a role in this market")
    
    # Check if trying to remove owner
    if roles.get(user_email) == MarketRole.OWNER.value:
        # Count how many owners there are
        owner_count = sum(1 for r in roles.values() if r == MarketRole.OWNER.value)
        if owner_count <= 1:
            raise ValueError("Cannot remove the only owner. Transfer ownership first.")
    
    # Check requesting user can manage this role
    user_role_value = roles.get(user_email)
    if user_role_value:
        try:
            user_role = MarketRole(user_role_value)
        except ValueError:
            user_role = MarketRole.VIEWER  # Default if invalid
        
        if not PermissionsApi.can_manage_roles(requesting_user, market, user_role, organization):
            raise PermissionError("User does not have permission to remove this role")
    
    # Remove user from roles dict
    del roles[user_email]
    
    # Update market
    result = markets_collection.update_one(
        {"name": market_name},
        {"$set": {"roles": roles}}
    )
    
    return result.modified_count > 0


def update_market_role(market_name: str, user_email: str, new_role: MarketRole, requesting_user: str) -> bool:
    """Update a user's role in a market. Requires permission to manage roles."""
    market_dict = markets_collection.find_one({"name": market_name})
    if not market_dict:
        raise ValueError("Market not found")
    
    # Convert to Market object for permission checking
    market_dict_snake = convert_keys_to_snake_case(market_dict.copy())
    try:
        market = Market(**market_dict_snake)
    except Exception:
        raise ValueError("Invalid market data")
    
    # Get organization if market belongs to one
    organization = None
    if market.organization:
        org_dict = OrgsApi.get_organization(market.organization)
        if org_dict:
            org_dict.pop('_id', None)
            try:
                from datatypes import Organization
                organization = Organization(**org_dict)
            except Exception:
                pass
    
    # Check requesting user can manage this role
    if not PermissionsApi.can_manage_roles(requesting_user, market, new_role, organization):
        raise PermissionError("User does not have permission to manage this role")
    
    # Validate role constraints
    roles = market_dict.get('roles', {})
    if new_role == MarketRole.OWNER:
        # Check if there's already an owner (and it's not the same user)
        for email, existing_role in roles.items():
            if email != user_email and existing_role == MarketRole.OWNER.value:
                raise ValueError("Market already has an owner. Transfer ownership first.")
    
    # Update role in dict
    roles[user_email] = new_role.value
    
    # Update market
    result = markets_collection.update_one(
        {"name": market_name},
        {"$set": {"roles": roles}}
    )
    
    return result.modified_count > 0
