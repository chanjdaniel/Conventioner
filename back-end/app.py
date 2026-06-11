# flask run --cert=adhoc > error.log 2>&1
import api.users as UsersApi
import api.organizations as OrgsApi
import api.markets as MarketsApi
import api.source_data as SourceDataApi
import api.attendance as AttendanceApi

from typing import Any, Dict
from flask import Flask, request, jsonify, Response
from flask_session import Session
from flask_login import LoginManager, login_user, login_required, logout_user, current_user
from flask_bcrypt import Bcrypt
from flask_cors import CORS
from datetime import timedelta, datetime
from datatypes import Market, MarketRole
from assignment.utils import convert_keys_to_camel_case, convert_keys_to_snake_case
from assignment.csv_output import convert_market_data_to_csv
import json
import os
import glob
import time
import traceback
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

SESSION_FOLDER = "flask_session"
SESSION_MAX_AGE = 7200

app = Flask(__name__)

# Session configuration: Use 'null' for Vercel serverless (stores in cookies only)
# For production with persistent sessions, consider MongoDB-backed sessions
# Set SESSION_TYPE env var to override: 'null' for Vercel, 'filesystem' for local dev
session_type = os.getenv("SESSION_TYPE", "filesystem" if os.getenv("FLASK_ENV") != "production" else "null")

app.config["SESSION_TYPE"] = session_type
app.config["SESSION_PERMANENT"] = True
app.config["PERMANENT_SESSION_LIFETIME"] = SESSION_MAX_AGE
app.config["SESSION_COOKIE_NAME"] = "session"
app.config["SESSION_COOKIE_HTTPONLY"] = True
# Only require secure cookies in production or when using HTTPS
app.config["SESSION_COOKIE_SECURE"] = os.getenv("FLASK_ENV") == "production" or os.getenv("USE_HTTPS", "true").lower() == "true"
app.config["SESSION_COOKIE_SAMESITE"] = "None"
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'TEMP_KEY_CHANGE_IN_PRODUCTION')

# Only create session folder for filesystem sessions
if session_type == "filesystem":
    os.makedirs(SESSION_FOLDER, exist_ok=True)
    app.config["SESSION_FILE_DIR"] = SESSION_FOLDER

Session(app)
bcrypt = Bcrypt(app)
login_manager = LoginManager()
login_manager.init_app(app)
login_manager.session_protection = "strong"
# Configure CORS based on environment
frontend_url = os.getenv("FRONTEND_URL", "http://localhost:5173")
if os.getenv("FLASK_ENV") == "production":
    # In production, only allow the configured frontend URL
    CORS(app, 
         origins=[frontend_url],
         supports_credentials=True)
else:
    # In development, allow all origins for easier local development
    CORS(app, supports_credentials=True)

# users

@login_manager.user_loader
def get_user(email: str) -> Any:
    return UsersApi.get_user(email)

# curl -k -X POST https://127.0.0.1:5000/register-user \
#   -H "Content-Type: application/json" \
#   -d '{"email": "testemail@test.com", "password": "testpassword", "organizations": []}'
@app.route("/register-user", methods=["POST"])
def register_user() -> Response:
    return UsersApi.register_user(bcrypt, request)

@app.route('/login', methods=['POST'])
def login() -> Response:
    return UsersApi.login(bcrypt, login_user, request)

@app.route('/logout', methods=['POST'])
@login_required
def logout() -> Response:
    return UsersApi.logout(logout_user)

@app.route('/check-session', methods=['GET'])
@login_required
def check_session() -> Response:
    return UsersApi.check_session(current_user)

@app.route('/register', methods=['POST'])
def register() -> Response:
    return UsersApi.register_user_with_captcha(bcrypt, request)

@app.route('/verify-email', methods=['POST'])
def verify_email() -> Response:
    return UsersApi.verify_email(request)

@app.route('/resend-verification', methods=['POST'])
def resend_verification() -> Response:
    return UsersApi.resend_verification_email(request)

@app.route('/request-password-reset', methods=['POST'])
def request_password_reset() -> Response:
    return UsersApi.request_password_reset(request)

@app.route('/reset-password', methods=['POST'])
def reset_password() -> Response:
    return UsersApi.reset_password(bcrypt, request)

@app.route('/request-otp', methods=['POST'])
def request_otp() -> Response:
    return UsersApi.request_otp(request)

@app.route('/login-otp', methods=['POST'])
def login_otp() -> Response:
    return UsersApi.login_with_otp(login_user, request)

@app.route('/delete-user', methods=['POST'])
def delete_user() -> Response:
    """Delete a user account. Requires login for verified accounts."""
    # Get requesting user email from headers (set by login_required decorator)
    requesting_user_email = request.headers.get('X-Owner-Email') or (current_user.email if current_user.is_authenticated else None)
    
    if not requesting_user_email:
        # Allow deletion of unverified accounts without login (for cleanup)
        # But require email in request body
        return UsersApi.delete_user(request, None)
    
    return UsersApi.delete_user(request, requesting_user_email)

# organizations

@app.route('/organizations', methods=['GET'])
@login_required
def get_organizations() -> Response:
    """Get all organizations for the current user."""
    try:
        user_email = request.headers.get('X-Owner-Email')
        if not user_email:
            return jsonify({"error": "User email not provided in headers"}), 400
        
        organizations = OrgsApi.get_organizations_for_user(user_email)
        return jsonify({"organizations": organizations}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/organizations', methods=['POST'])
@login_required
def create_organization() -> Response:
    """Create a new organization."""
    try:
        data = request.json
        if not data:
            return jsonify({"error": "No data provided"}), 400
        
        name = data.get('name')
        if not name:
            return jsonify({"error": "Organization name required"}), 400
        
        owner_email = request.headers.get('X-Owner-Email')
        if not owner_email:
            return jsonify({"error": "Owner email not provided in headers"}), 400
        
        org_id = OrgsApi.create_organization(owner_email, name)
        return jsonify({
            "message": "Organization created successfully",
            "organization_id": org_id
        }), 201
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/organizations/<org_id>', methods=['GET'])
@login_required
def get_organization(org_id: str) -> Response:
    """Get an organization by id."""
    try:
        org = OrgsApi.get_organization(org_id)
        if org:
            return jsonify({"organization": org}), 200
        else:
            return jsonify({"error": "Organization not found"}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/organizations/<org_id>', methods=['PUT'])
@login_required
def update_organization(org_id: str) -> Response:
    """Update an organization. Only owner can update."""
    try:
        data = request.json
        if not data:
            return jsonify({"error": "No data provided"}), 400
        
        requesting_user = request.headers.get('X-Owner-Email')
        if not requesting_user:
            return jsonify({"error": "User email not provided in headers"}), 400
        
        result = OrgsApi.update_organization(org_id, requesting_user, data)
        return jsonify({
            "message": "Organization updated successfully",
            "modified_count": result.modified_count
        }), 200
    except PermissionError as e:
        return jsonify({"error": str(e)}), 403
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/organizations/<org_id>', methods=['DELETE'])
@login_required
def delete_organization(org_id: str) -> Response:
    """Delete an organization. Only owner can delete."""
    try:
        requesting_user = request.headers.get('X-Owner-Email')
        if not requesting_user:
            return jsonify({"error": "User email not provided in headers"}), 400
        
        result = OrgsApi.delete_organization(org_id, requesting_user)
        if result.deleted_count > 0:
            return jsonify({"message": "Organization deleted successfully"}), 200
        else:
            return jsonify({"error": "Organization not found"}), 404
    except PermissionError as e:
        return jsonify({"error": str(e)}), 403
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/organizations/<org_id>/admins', methods=['POST'])
@login_required
def add_org_admin(org_id: str) -> Response:
    """Add an admin to an organization. Only owner can add admins."""
    try:
        data = request.json
        if not data:
            return jsonify({"error": "No data provided"}), 400
        
        user_email = data.get('user_email')
        if not user_email:
            return jsonify({"error": "user_email required"}), 400
        
        requesting_user = request.headers.get('X-Owner-Email')
        if not requesting_user:
            return jsonify({"error": "User email not provided in headers"}), 400
        
        success = OrgsApi.add_org_admin(org_id, user_email, requesting_user)
        if success:
            return jsonify({"message": "Admin added successfully"}), 200
        else:
            return jsonify({"error": "Failed to add admin"}), 400
    except PermissionError as e:
        return jsonify({"error": str(e)}), 403
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/organizations/<org_id>/members', methods=['POST'])
@login_required
def add_org_member(org_id: str) -> Response:
    """Add a member to an organization. Owner or admin can add members."""
    try:
        data = request.json
        if not data:
            return jsonify({"error": "No data provided"}), 400
        
        user_email = data.get('user_email')
        if not user_email:
            return jsonify({"error": "user_email required"}), 400
        
        requesting_user = request.headers.get('X-Owner-Email')
        if not requesting_user:
            return jsonify({"error": "User email not provided in headers"}), 400
        
        success = OrgsApi.add_org_member(org_id, user_email, requesting_user)
        if success:
            return jsonify({"message": "Member added successfully"}), 200
        else:
            return jsonify({"error": "Failed to add member"}), 400
    except PermissionError as e:
        return jsonify({"error": str(e)}), 403
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/organizations/<org_id>/users/<user_id>', methods=['DELETE'])
@login_required
def remove_org_user(org_id: str, user_id: str) -> Response:
    """Remove a user from an organization."""
    try:
        requesting_user = request.headers.get('X-Owner-Email')
        if not requesting_user:
            return jsonify({"error": "User email not provided in headers"}), 400
        
        success = OrgsApi.remove_org_user(org_id, user_id, requesting_user)
        if success:
            return jsonify({"message": "User removed successfully"}), 200
        else:
            return jsonify({"error": "Failed to remove user"}), 400
    except PermissionError as e:
        return jsonify({"error": str(e)}), 403
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/organizations/<org_id>/transfer', methods=['POST'])
@login_required
def transfer_org_ownership(org_id: str) -> Response:
    """Transfer organization ownership."""
    try:
        data = request.json
        if not data:
            return jsonify({"error": "No data provided"}), 400
        
        new_owner_email = data.get('new_owner_email')
        if not new_owner_email:
            return jsonify({"error": "new_owner_email required"}), 400
        
        current_owner = request.headers.get('X-Owner-Email')
        if not current_owner:
            return jsonify({"error": "User email not provided in headers"}), 400
        
        success = OrgsApi.transfer_org_ownership(org_id, current_owner, new_owner_email)
        if success:
            return jsonify({"message": "Ownership transferred successfully"}), 200
        else:
            return jsonify({"error": "Failed to transfer ownership"}), 400
    except PermissionError as e:
        return jsonify({"error": str(e)}), 403
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# Market role management

@app.route('/markets/<market_id>/roles', methods=['POST'])
@login_required
def add_market_role(market_id: str) -> Response:
    """Add a user role to a market."""
    try:
        data = request.json
        if not data:
            return jsonify({"error": "No data provided"}), 400
        
        user_email = data.get('user_email')
        role_str = data.get('role')
        if not user_email or not role_str:
            return jsonify({"error": "user_email and role required"}), 400
        
        try:
            role = MarketRole(role_str.lower())
        except ValueError:
            return jsonify({"error": f"Invalid role: {role_str}"}), 400
        
        owner_email = request.headers.get('X-Owner-Email')
        if not owner_email:
            return jsonify({"error": "Owner email not provided in headers"}), 400
        
        requesting_user = request.headers.get('X-User-Email', owner_email)
        
        success = MarketsApi.add_market_role(market_id, user_email, role, requesting_user)
        if success:
            return jsonify({"message": "Role added successfully"}), 200
        else:
            return jsonify({"error": "Failed to add role"}), 400
    except PermissionError as e:
        return jsonify({"error": str(e)}), 403
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/markets/<market_id>/roles/<user_id>', methods=['DELETE'])
@login_required
def remove_market_role(market_id: str, user_id: str) -> Response:
    """Remove a user role from a market."""
    try:
        requesting_user = request.headers.get('X-Owner-Email')
        if not requesting_user:
            return jsonify({"error": "User email not provided in headers"}), 400
        
        success = MarketsApi.remove_market_role(market_id, user_id, requesting_user)
        if success:
            return jsonify({"message": "Role removed successfully"}), 200
        else:
            return jsonify({"error": "Failed to remove role"}), 400
    except PermissionError as e:
        return jsonify({"error": str(e)}), 403
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/markets/<market_id>/roles/<user_id>', methods=['PUT'])
@login_required
def update_market_role(market_id: str, user_id: str) -> Response:
    """Update a user's role in a market."""
    try:
        data = request.json
        if not data:
            return jsonify({"error": "No data provided"}), 400
        
        role_str = data.get('role')
        if not role_str:
            return jsonify({"error": "role required"}), 400
        
        try:
            role = MarketRole(role_str.lower())
        except ValueError:
            return jsonify({"error": f"Invalid role: {role_str}"}), 400
        
        requesting_user = request.headers.get('X-Owner-Email')
        if not requesting_user:
            return jsonify({"error": "User email not provided in headers"}), 400
        
        success = MarketsApi.update_market_role(market_id, user_id, role, requesting_user)
        if success:
            return jsonify({"message": "Role updated successfully"}), 200
        else:
            return jsonify({"error": "Failed to update role"}), 400
    except PermissionError as e:
        return jsonify({"error": str(e)}), 403
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# source data

@app.route('/source-data/<market_id>', methods=['POST'])
@login_required
def upload_source_data(market_id: str) -> Response:
    """Upload CSV source data for a market."""
    if 'file' not in request.files:
        return jsonify({"error": "No file provided"}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "No file selected"}), 400
    
    if not file.filename.lower().endswith('.csv'):
        return jsonify({"error": "File must be a CSV"}), 400
    
    result, status_code = SourceDataApi.upload_source_data(market_id, file)
    return jsonify(result), status_code

@app.route('/source-data/<market_id>', methods=['GET'])
@login_required
def get_source_data(market_id: str) -> Response:
    """Retrieve CSV source data for a market."""
    result, status_code = SourceDataApi.get_source_data(market_id)
    return jsonify(result), status_code

@app.route('/source-data/<market_id>/csv', methods=['GET'])
@login_required
def get_source_data_csv(market_id: str) -> Response:
    """Retrieve CSV source data as downloadable CSV file."""
    result, status_code = SourceDataApi.get_source_data_csv(market_id)
    if status_code == 200:
        from flask import make_response
        response = make_response(result['csv_content'])
        response.headers['Content-Type'] = 'text/csv'
        response.headers['Content-Disposition'] = f'attachment; filename={result["filename"]}'
        return response
    else:
        return jsonify(result), status_code

@app.route('/source-data/<market_id>/headers', methods=['GET'])
@login_required
def get_source_data_headers(market_id: str) -> Response:
    """Get just the headers for a market's source data."""
    result, status_code = SourceDataApi.get_source_data_headers(market_id)
    return jsonify(result), status_code

@app.route('/source-data', methods=['GET'])
@login_required
def list_source_data() -> Response:
    """List all available source data files."""
    result, status_code = SourceDataApi.list_source_data()
    return jsonify(result), status_code

@app.route('/source-data/<market_id>', methods=['DELETE'])
@login_required
def delete_source_data(market_id: str) -> Response:
    """Delete source data for a market."""
    result, status_code = SourceDataApi.delete_source_data(market_id)
    return jsonify(result), status_code

# markets

@app.route('/markets/<market_id>', methods=['GET'])
@login_required
def get_market(market_id: str) -> Response:
    """Get a market by its ID. Uses permission checks."""
    try:
        user_email = request.headers.get('X-Owner-Email')  # Reusing header name for user email
        if not user_email:
            return jsonify({"error": "User email not provided in headers"}), 400

        # Check that user exists
        user = UsersApi.get_user(user_email)
        if not user:
            return jsonify({"error": "User not found"}), 404

        # Try to find market by name (market_id is actually the name)
        market = MarketsApi.get_market_for_user(user_email, market_id)
        if market:
            return jsonify({"market": market}), 200
        else:
            return jsonify({"error": "Market not found or access denied"}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/markets', methods=['GET'])
@login_required
def get_markets_by_owner_email() -> Response:
    """Get all markets for user (via explicit role or organization)."""
    try:
        user_email = request.headers.get('X-Owner-Email')  # Reusing header name for user email
        if not user_email:
            return jsonify({"error": "User email not provided in headers"}), 400
        
        user = UsersApi.get_user(user_email)
        if not user:
            return jsonify({"error": "User not found"}), 404
        
        markets = MarketsApi.get_markets_for_user(user_email)
        return jsonify({"markets": markets}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/markets', methods=['POST'])
@login_required
def create_market() -> Response:
    """Create a new market."""
    try:
        data = request.json
        if not data:
            return jsonify({"error": "No data provided"}), 400
        
        # Validate the market data using Pydantic
        data = convert_keys_to_snake_case(data)
        market = Market(**data)

        owner_email = request.headers.get('X-Owner-Email')
        if not owner_email:
            return jsonify({"error": "Owner email not provided in headers"}), 400

        # Check that owner exists
        owner = UsersApi.get_user(owner_email)
        if not owner:
            return jsonify({"error": "Owner not found"}), 404
        
        # Validate that market has exactly one owner in roles
        roles = market.roles if hasattr(market, 'roles') else {}
        owner_count = sum(1 for role in roles.values() if role == MarketRole.OWNER)
        if owner_count != 1:
            return jsonify({"error": "Market must have exactly one owner in roles dict"}), 400
        
        # Create the market
        result, market_id = MarketsApi.create_market(market, owner_email)
        
        return jsonify({
            "message": "Market created successfully",
            "market_id": market_id
        }), 201
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@app.route('/markets/<market_id>', methods=['PUT'])
@login_required
def update_market(market_id: str) -> Response:
    """Update an existing market."""
    try:
        data = request.json
        if not data:
            return jsonify({"error": "No data provided"}), 400

        # Validate the incoming market data using Pydantic
        try:
            data = convert_keys_to_snake_case(data)
            market = Market(**data)
        except Exception as validation_error:
            print(f"Market validation error: {validation_error}")
            print(f"Validation error type: {type(validation_error)}")
            if hasattr(validation_error, 'errors'):
                print(f"Validation errors: {validation_error.errors()}")
            raise validation_error

        requesting_user = request.headers.get('X-Owner-Email')
        if not requesting_user:
            return jsonify({"error": "User email not provided in headers"}), 400

        # Check that user exists
        user = UsersApi.get_user(requesting_user)
        if not user:
            return jsonify({"error": "User not found"}), 404
        
        # Perform the update (with permission check)
        result = MarketsApi.update_market(market_id, market, requesting_user)

        # Handle no matching market
        if result.matched_count == 0:
            return jsonify({"error": "Market not found"}), 404

        return jsonify({
            "message": "Market updated successfully",
            "modified_count": result.modified_count
        }), 200

    except PermissionError as e:
        return jsonify({"error": str(e)}), 403
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@app.route('/markets/<market_id>', methods=['DELETE'])
@login_required
def delete_market(market_id: str) -> Response:
    """Delete a market. Only owner can delete."""
    try:
        requesting_user = request.headers.get('X-Owner-Email')
        if not requesting_user:
            return jsonify({"error": "User email not provided in headers"}), 400

        result = MarketsApi.delete_market(market_id, requesting_user)
        if result.deleted_count > 0:
            return jsonify({"message": "Market deleted successfully"}), 200
        else:
            return jsonify({"error": "Market not found"}), 404
    except PermissionError as e:
        return jsonify({"error": str(e)}), 403
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/markets/<market_id>/assignment', methods=['GET'])
@login_required
def get_assigned_market(market_id: str) -> Response:
    """Get an assigned market. Requires VIEW permission."""
    try:
        requesting_user = request.headers.get('X-Owner-Email')
        if not requesting_user:
            return jsonify({"error": "User email not provided in headers"}), 400

        result, status_code = MarketsApi.get_assigned_market(market_id, requesting_user)
        
        return jsonify(result), status_code
    
    except Exception as e:
        # Log the full error with traceback
        logger.error(f"Error in get_assigned_market for {market_id}: {str(e)}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        
        # Return more detailed error information
        return jsonify({
            "error": "Internal server error",
            "message": str(e),
            "endpoint": f"/markets/{market_id}/assignment",
            "timestamp": datetime.utcnow().isoformat()
        }), 500


@app.route('/markets/<market_id>/assignment-statistics', methods=['GET'])
@login_required
def get_assignment_statistics(market_id: str) -> Response:
    """Get assignment statistics derived on-demand. Requires VIEW permission."""
    try:
        requesting_user = request.headers.get('X-Owner-Email')
        if not requesting_user:
            return jsonify({"error": "User email not provided in headers"}), 400

        result, status_code = MarketsApi.get_assignment_statistics(market_id, requesting_user)
        return jsonify(result), status_code

    except Exception as e:
        logger.error(f"Error in get_assignment_statistics for {market_id}: {str(e)}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        return jsonify({
            "error": "Internal server error",
            "message": str(e),
            "endpoint": f"/markets/{market_id}/assignment-statistics",
            "timestamp": datetime.utcnow().isoformat()
        }), 500


@app.route('/markets/<market_id>/assignment-csv', methods=['GET'])
@login_required
def get_assignment_csv(market_id: str) -> Response:
    """Download assignment results as a CSV file. Requires VIEW permission."""
    try:
        requesting_user = request.headers.get('X-Owner-Email')
        if not requesting_user:
            return jsonify({"error": "User email not provided in headers"}), 400

        result, status_code = MarketsApi.get_assignment_csv(market_id, requesting_user)
        if status_code == 200:
            from flask import make_response
            response = make_response(result["csv_content"])
            response.headers['Content-Type'] = 'text/csv; charset=utf-8'
            response.headers['Content-Disposition'] = f'attachment; filename="{result["filename"]}"'
            return response
        return jsonify(result), status_code
    except Exception as e:
        logger.error(f"Error in get_assignment_csv for {market_id}: {str(e)}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        return jsonify({
            "error": "Internal server error",
            "message": str(e),
            "endpoint": f"/markets/{market_id}/assignment-csv",
            "timestamp": datetime.utcnow().isoformat()
        }), 500


@app.route('/markets/<market_id>/discord/notify-assignment', methods=['POST'])
@login_required
def post_assignment_to_discord(market_id: str) -> Response:
    """Send the assignment summary to the market's configured Discord webhook. Owner only."""
    try:
        requesting_user = request.headers.get('X-Owner-Email')
        if not requesting_user:
            return jsonify({"error": "User email not provided in headers"}), 400

        result, status_code = MarketsApi.post_assignment_to_discord(market_id, requesting_user)
        return jsonify(result), status_code
    except Exception as e:
        logger.error(f"Error in post_assignment_to_discord for {market_id}: {str(e)}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        return jsonify({
            "error": "Internal server error",
            "message": str(e),
            "endpoint": f"/markets/{market_id}/discord/notify-assignment",
            "timestamp": datetime.utcnow().isoformat()
        }), 500


@app.route('/markets/<market_id>/tables', methods=['GET'])
@login_required
def get_market_tables(market_id: str) -> Response:
    """Get table-level assignments derived on-demand. Requires VIEW permission."""
    try:
        requesting_user = request.headers.get('X-Owner-Email')
        if not requesting_user:
            return jsonify({"error": "User email not provided in headers"}), 400

        result, status_code = MarketsApi.get_market_tables(market_id, requesting_user)
        return jsonify(result), status_code
    except Exception as e:
        logger.error(f"Error in get_market_tables for {market_id}: {str(e)}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        return jsonify({
            "error": "Internal server error",
            "message": str(e),
            "endpoint": f"/markets/{market_id}/tables",
            "timestamp": datetime.utcnow().isoformat()
        }), 500


# attendance

@app.route('/public/markets/<market_slug>/vendors/<path:vendor_email>/assignments', methods=['GET'])
def public_get_vendor_assignments(market_slug: str, vendor_email: str) -> Response:
    """Public vendor assignment lookup by slug + email."""
    try:
        result, status_code = AttendanceApi.get_vendor_assignment_summary(market_slug, vendor_email)
        return jsonify(result), status_code
    except Exception as e:
        logger.error(f"Error in public_get_vendor_assignments {market_slug} {vendor_email}: {e}")
        logger.error(traceback.format_exc())
        return jsonify({"error": "Internal server error"}), 500


@app.route('/public/markets/<market_slug>/attendance/checkin', methods=['POST'])
def public_attendance_checkin(market_slug: str) -> Response:
    """Public attendance check-in by slug + vendor email + date."""
    try:
        data = request.json or {}
        vendor_email = data.get('vendorEmail') or data.get('vendor_email') or ''
        date = data.get('date') or ''

        market_doc = AttendanceApi.get_published_market_by_slug(market_slug)
        if not market_doc:
            return jsonify({"error": "Market not found"}), 404

        result, status_code = AttendanceApi.record_attendance(
            market_doc.get("id", ""), vendor_email, date,
        )
        return jsonify(result), status_code
    except Exception as e:
        logger.error(f"Error in public_attendance_checkin {market_slug}: {e}")
        logger.error(traceback.format_exc())
        return jsonify({"error": "Internal server error"}), 500


@app.route('/markets/<market_id>/attendance', methods=['GET'])
@login_required
def get_market_attendance(market_id: str) -> Response:
    """Owner-facing attendance status for a market. Requires VIEWER permission."""
    try:
        requesting_user = request.headers.get('X-Owner-Email')
        if not requesting_user:
            return jsonify({"error": "User email not provided in headers"}), 400

        from datatypes import MarketRole as _MR
        import api.permissions as _Permissions
        import api.organizations as _Orgs

        market_doc = MarketsApi.markets_collection.find_one({"id": market_id})
        if not market_doc:
            return jsonify({"error": "Market not found"}), 404

        market_snake = convert_keys_to_snake_case(market_doc.copy())
        try:
            market_obj = Market(**market_snake)
        except Exception:
            return jsonify({"error": "Invalid market data"}), 400

        organization = None
        if market_obj.organization_id:
            org_dict = _Orgs.get_organization(market_obj.organization_id)
            if org_dict:
                org_dict.pop('_id', None)
                try:
                    from datatypes import Organization
                    organization = Organization(**org_dict)
                except Exception:
                    pass

        if not _Permissions.user_has_permission(requesting_user, market_obj, _MR.VIEWER, organization):
            return jsonify({"error": "User does not have permission to view this market"}), 403

        result, status_code = AttendanceApi.get_attendance_for_market(market_id)
        return jsonify({"attendance": result}), status_code
    except Exception as e:
        logger.error(f"Error in get_market_attendance {market_id}: {e}")
        logger.error(traceback.format_exc())
        return jsonify({"error": "Internal server error"}), 500


# misc

def cleanup_sessions() -> None:
    """Clean up expired session files. Only runs for filesystem sessions."""
    if app.config["SESSION_TYPE"] == "filesystem":
        now = time.time()
        for session_file in glob.glob(os.path.join(SESSION_FOLDER, "*")):
            if os.stat(session_file).st_mtime < now - SESSION_MAX_AGE:
                os.remove(session_file)

cleanup_sessions()

# Vercel automatically detects Flask apps, but we can export the app instance
# The app instance will be used by Vercel's Python runtime

if __name__ == '__main__':
    app.run(debug=True)
