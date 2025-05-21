from flask import request, jsonify
from flask_login import UserMixin
import json

USER_AUTH_PATH = "./data/users.json"

# users
class User(UserMixin):
    def __init__(self, user):
        self.email = user["email"]
        self.organizations = user["organizations"]
        self.markets = user["markets"]

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

def load_user(email):
    users = load_users()
    for user in users.values():
        if str(user["email"]) == str(email):
            return User(user)
    return None

# curl -k -X POST https://127.0.0.1:5000/register-user \
#      -H "Content-Type: application/json" \
#      -d '{"email": "USERNAME", "password": "pswrdpswrd!!!", "organizations": [], "markets": []}'
def register_user(bcrypt, request):
    data = request.json
    email = data.get("email")
    password = data.get("password")
    organizations = data.get("organizations")
    markets = data.get("markets")

    users = load_users()

    if not email or not password:
        return jsonify({"msg": "Email, password, and organization required"}), 400

    if email in users:
        return jsonify({"msg": "User already exists"}), 400

    hashed_password = bcrypt.generate_password_hash(password).decode('utf-8')
    users[email] = { "email": email, "password": hashed_password, "organizations": organizations, "markets": markets }
    save_users(users)

    return jsonify({"msg": "User registered successfully"}), 201

def login(bcrypt, login_user, request):
    data = request.json
    email, password = data.get('email'), data.get('password')

    users = load_users()
    user = users.get(email)
    if email in users and bcrypt.check_password_hash(users[email]["password"], password):
        user_email = user["email"]
        user_organizations = user["organizations"]
        user_markets = user["markets"]
        user_obj = User(user)
        login_user(user_obj, remember=True)

        user_data = { "email": user_email, "organizations": user_organizations, "markets": user_markets }
        return jsonify({"message": "Login successful", "user_data": user_data}), 200

    return jsonify({"msg": "Invalid credentials"}), 401

def logout(logout_user):
    logout_user()
    return jsonify({"msg": "Logged out"}), 200

def check_session(current_user):
    return jsonify({"email": current_user.email}), 200