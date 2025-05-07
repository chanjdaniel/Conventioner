# flask run --cert=adhoc
import api.users as UsersApi
import api.organizations as OrgsApi
import api.markets as MarketsApi

from flask import Flask, request, jsonify
from flask_session import Session
from flask_login import LoginManager, login_user, login_required, logout_user, current_user
from flask_bcrypt import Bcrypt
from flask_cors import CORS
from datetime import timedelta
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
def load_user(email):
    return UsersApi.load_user(email)

# curl -k -X POST https://127.0.0.1:5000/register-user \
#      -H "Content-Type: application/json" \
#      -d '{"email": "USERNAME", "password": "PASSWORD", "organization": "ORGANIZATION"}'
@app.route("/register-user", methods=["POST"])
def register_user():
    return UsersApi.register_user(bcrypt, request)

@app.route('/login', methods=['POST'])
def login():
    return UsersApi.login(bcrypt, login_user, request)

@app.route('/logout', methods=['POST'])
@login_required
def logout():
    return UsersApi.logout(logout_user)

@app.route('/check-session', methods=['GET'])
@login_required
def check_session():
    return UsersApi.check_session(current_user)

# organizations

# @app.route('/assignment', methods=['POST'])
# @login_required
# def assignment():
#     data = request.json
#     setupObject = data.setupObject
#     upload = data.upload

# misc

def cleanup_sessions():
    now = time.time()
    for session_file in glob.glob(os.path.join(SESSION_FOLDER, "*")):
        if os.stat(session_file).st_mtime < now - SESSION_MAX_AGE:
            os.remove(session_file)

cleanup_sessions()

if __name__ == '__main__':
    app.run(debug=True)