import os
from pymongo import MongoClient

def get_mongodb_client():
    """Get MongoDB client using environment variables or defaults.
    
    Supports both MongoDB Atlas connection strings (MONGODB_URI) and 
    traditional connection parameters (MONGODB_HOST, etc.).
    """
    # Check for MongoDB Atlas connection string first (preferred for Vercel)
    mongodb_uri = os.getenv('MONGODB_URI')
    if mongodb_uri:
        return MongoClient(mongodb_uri)
    
    # Fall back to individual connection parameters
    mongodb_host = os.getenv('MONGODB_HOST', 'localhost')
    mongodb_port = os.getenv('MONGODB_PORT', '27017')
    mongodb_user = os.getenv('MONGODB_USER', 'admin')
    mongodb_password = os.getenv('MONGODB_PASSWORD', 'secret')
    mongodb_auth_db = os.getenv('MONGODB_AUTH_DB', 'admin')
    
    # Format: mongodb://user:password@host:port/auth_database
    connection_string = f"mongodb://{mongodb_user}:{mongodb_password}@{mongodb_host}:{mongodb_port}/{mongodb_auth_db}"
    return MongoClient(connection_string)

def get_database(db_name='conventioner'):
    """Get database instance."""
    client = get_mongodb_client()
    return client[db_name]
