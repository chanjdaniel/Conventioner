# flask run --cert=adhoc
import api.users as UsersApi
import api.organizations as OrgsApi
import api.markets as MarketsApi
import api.source_data as SourceDataApi

from typing import Any, Dict
from flask import Flask, request, jsonify, Response
from flask_session import Session
from flask_login import LoginManager, login_user, login_required, logout_user, current_user
from flask_bcrypt import Bcrypt
from flask_cors import CORS
from datetime import timedelta
from datatypes import Market
import json
import os
import glob
import time

SESSION_FOLDER = "flask_session"
SESSION_MAX_AGE = 7200

app = Flask(__name__)

app.config["SESSION_TYPE"] = "filesystem"
app.config["SESSION_PERMANENT"] = True
app.config["PERMANENT_SESSION_LIFETIME"] = SESSION_MAX_AGE
app.config["SESSION_COOKIE_NAME"] = "session"
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SECURE"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "None"
app.config['SECRET_KEY'] = 'TEMP_KEY'

Session(app)
bcrypt = Bcrypt(app)
login_manager = LoginManager()
login_manager.init_app(app)
login_manager.session_protection = "strong"
CORS(app, supports_credentials=True)

# users

@login_manager.user_loader
def get_user(email: str) -> Any:
    return UsersApi.get_user(email)

# curl -k -X POST https://127.0.0.1:5000/register-user \
#   -H "Content-Type: application/json" \
#   -d '{"email": "testemail@test.com", "password": "testpassword", "organizations": [], "markets": []}'
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

# organizations

# @app.route('/assignment', methods=['POST'])
# @login_required
# def assignment():
#     data = request.json
#     setupObject = data.setupObject
#     upload = data.upload

# source data

@app.route('/source-data/<market_name>', methods=['POST'])
@login_required
def upload_source_data(market_name: str) -> Response:
    """Upload CSV source data for a market."""
    if 'file' not in request.files:
        return jsonify({"error": "No file provided"}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "No file selected"}), 400
    
    if not file.filename.lower().endswith('.csv'):
        return jsonify({"error": "File must be a CSV"}), 400
    
    result, status_code = SourceDataApi.upload_source_data(market_name, file)
    return jsonify(result), status_code

@app.route('/source-data/<market_name>', methods=['GET'])
@login_required
def get_source_data(market_name: str) -> Response:
    """Retrieve CSV source data for a market."""
    result, status_code = SourceDataApi.get_source_data(market_name)
    return jsonify(result), status_code

@app.route('/source-data/<market_name>/csv', methods=['GET'])
@login_required
def get_source_data_csv(market_name: str) -> Response:
    """Retrieve CSV source data as downloadable CSV file."""
    result, status_code = SourceDataApi.get_source_data_csv(market_name)
    if status_code == 200:
        from flask import make_response
        response = make_response(result['csv_content'])
        response.headers['Content-Type'] = 'text/csv'
        response.headers['Content-Disposition'] = f'attachment; filename={result["filename"]}'
        return response
    else:
        return jsonify(result), status_code

@app.route('/source-data/<market_name>/headers', methods=['GET'])
@login_required
def get_source_data_headers(market_name: str) -> Response:
    """Get just the headers for a market's source data."""
    result, status_code = SourceDataApi.get_source_data_headers(market_name)
    return jsonify(result), status_code

@app.route('/source-data', methods=['GET'])
@login_required
def list_source_data() -> Response:
    """List all available source data files."""
    result, status_code = SourceDataApi.list_source_data()
    return jsonify(result), status_code

@app.route('/source-data/<market_name>', methods=['DELETE'])
@login_required
def delete_source_data(market_name: str) -> Response:
    """Delete source data for a market."""
    result, status_code = SourceDataApi.delete_source_data(market_name)
    return jsonify(result), status_code

# markets

@app.route('/markets/<market_id>', methods=['GET'])
@login_required
def get_market(market_id: str) -> Response:
    """Get a market by its ID."""
    try:
        market = MarketsApi.get_market(market_id)
        if market:
            # Convert ObjectId to string for JSON serialization
            market['_id'] = str(market['_id'])
            return jsonify({"market": market}), 200
        else:
            return jsonify({"error": "Market not found"}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/markets', methods=['GET'])
@login_required
def get_markets_by_owner_email() -> Response:
    """Get all markets by owner."""
    try:
        owner_email = request.headers.get('X-Owner-Email')
        if not owner_email:
            return jsonify({"error": "Owner email not provided in headers"}), 400
        owner = UsersApi.get_user(owner_email)
        if owner:
            markets = MarketsApi.get_markets_by_owner_email(owner_email)
            # Convert ObjectIds to strings for JSON serialization
            for market in markets:
                market['_id'] = str(market['_id'])
            return jsonify({"markets": markets}), 200
        else:
            return jsonify({"error": "Owner not found"}), 404
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
        market = Market(**data)
        
        # Create the market
        result = MarketsApi.create_market(market)
        
        return jsonify({
            "message": "Market created successfully",
            "market_id": str(result.inserted_id)
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
        
        # Validate the market data using Pydantic
        market = Market(**data)
        
        # Update the market
        result = MarketsApi.update_market(market_id, market)
        
        if result.matched_count == 0:
            return jsonify({"error": "Market not found"}), 404
        
        return jsonify({
            "message": "Market updated successfully",
            "modified_count": result.modified_count
        }), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 400

# misc

def cleanup_sessions() -> None:
    """Clean up expired session files."""
    now = time.time()
    for session_file in glob.glob(os.path.join(SESSION_FOLDER, "*")):
        if os.stat(session_file).st_mtime < now - SESSION_MAX_AGE:
            os.remove(session_file)

cleanup_sessions()

if __name__ == '__main__':
    app.run(debug=True)