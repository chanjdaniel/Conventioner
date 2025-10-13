from flask import request, jsonify
from flask_login import UserMixin
from pymongo import MongoClient
from datatypes import User

client = MongoClient("mongodb://admin:secret@localhost:27017/admin")

db = client["market_maker"]
users_collection = db["users"]

# users
class AuthUser(UserMixin):
    def __init__(self, user: User):
        self.email = user.email
        self.organizations = user.organizations
        self.markets = user.markets

    def get_id(self):
        return self.email

def get_user(email):
    """Load user from MongoDB using email as the key"""
    user_doc = users_collection.find_one({"email": email})
    if user_doc:
        # Remove MongoDB's _id field before creating User object
        user_doc.pop('_id', None)
        return AuthUser(User(**user_doc))
    return None

# curl -k -X POST https://127.0.0.1:5000/register-user \
#      -H "Content-Type: application/json" \
#      -d '{"email": "USERNAME", "password": "pswrdpswrd!!!", "organizations": [], "markets": []}'
def register_user(bcrypt, request):
    data = request.json
    email = data.get("email")
    password = data.get("password")
    organizations = data.get("organizations", [])
    markets = data.get("markets", [])

    if not email or not password:
        return jsonify({"msg": "Email and password required"}), 400

    # Check if user already exists in MongoDB
    existing_user = users_collection.find_one({"email": email})
    if existing_user:
        return jsonify({"msg": "User already exists"}), 400

    hashed_password = bcrypt.generate_password_hash(password).decode('utf-8')
    user_doc = {
        "email": email,
        "password": hashed_password,
        "organizations": organizations,
        "markets": markets
    }
    
    # Insert user into MongoDB
    result = users_collection.insert_one(user_doc)
    
    if result.inserted_id:
        return jsonify({"msg": "User registered successfully"}), 201
    else:
        return jsonify({"msg": "Failed to register user"}), 500

def login(bcrypt, login_user, request):
    data = request.json
    email, password = data.get('email'), data.get('password')

    # Find user in MongoDB
    user_doc = users_collection.find_one({"email": email})
    if user_doc and bcrypt.check_password_hash(user_doc["password"], password):
        # Remove MongoDB's _id field before creating User object
        user_doc.pop('_id', None)
        auth_user = AuthUser(User(**user_doc))
        login_user(auth_user, remember=True)

        user_data = {
            "email": auth_user.email,
            "organizations": auth_user.organizations,
            "markets": auth_user.markets
        }
        return jsonify({"message": "Login successful", "user_data": user_data}), 200

    return jsonify({"message": "Invalid credentials"}), 401

def logout(logout_user):
    logout_user()
    return jsonify({"message": "Logged out"}), 200

def check_session(current_user):
    return jsonify({"email": current_user.email}), 200