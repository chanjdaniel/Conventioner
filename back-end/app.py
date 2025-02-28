from flask import Flask, request, jsonify
from flask_session import Session
from flask_login import LoginManager, UserMixin, login_user, login_required, logout_user, current_user
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

USER_AUTH_PATH = "./data/users.json"


class User(UserMixin):
    def __init__(self, email, organization):
        self.email = email
        self.organization = organization

    def get_id(self):
        return self.email



def load_users():
    try:
        with open(USER_AUTH_PATH, "r") as file:
            return json.load(file)
    except FileNotFoundError:
        return {}
    
def save_users(users):
    with open(USER_AUTH_PATH, "w") as file:
        json.dump(users, file, indent=4)

@login_manager.user_loader
def load_user(email):
    users = load_users()
    for user in users.values():
        if str(user["email"]) == str(email):
            return User(user["email"], user['organization'])
    return None

# curl -k -X POST https://127.0.0.1:5000/register-user \
#      -H "Content-Type: application/json" \
#      -d '{"email": "USERNAME", "password": "PASSWORD", "organization": "ORGANIZATION"}'
@app.route("/register-user", methods=["POST"])
def register_user():
    data = request.json
    email = data.get("email")
    password = data.get("password")
    organization = data.get("organization")

    users = load_users()

    if not email or not password or not organization:
        return jsonify({"msg": "Email, password, and organization required"}), 400

    if email in users:
        return jsonify({"msg": "User already exists"}), 400

    hashed_password = bcrypt.generate_password_hash(password).decode('utf-8')
    users[email] = { "email": email, "password": hashed_password, "organization": organization }
    save_users(users)

    return jsonify({"msg": "User registered successfully"}), 201

@app.route('/login', methods=['POST'])
def login():
    data = request.json
    email, password = data.get('email'), data.get('password')

    users = load_users()
    user = users.get(email)
    if email in users and bcrypt.check_password_hash(users[email]["password"], password):
        user_email = user["email"]
        user_organization = user["organization"]
        user_obj = User(user_email, user_organization)
        login_user(user_obj, remember=True)

        user_data = {"email": user_email, "organization": user_organization}
        return jsonify({"message": "Login successful", "user_data": user_data}), 200

    return jsonify({"message": "Invalid credentials"}), 401

@app.route('/logout', methods=['POST'])
@login_required
def logout():
    logout_user()
    return jsonify({"message": "Logged out"}), 200

@app.route('/check-session', methods=['GET'])
@login_required
def check_session():
    return jsonify({"email": current_user.email}), 200

def cleanup_sessions():
    now = time.time()
    for session_file in glob.glob(os.path.join(SESSION_FOLDER, "*")):
        if os.stat(session_file).st_mtime < now - SESSION_MAX_AGE:
            os.remove(session_file)

cleanup_sessions()

if __name__ == '__main__':
    app.run(debug=True)