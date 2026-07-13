import os
from pymongo import MongoClient

# The startup migration check runs at import, before the app can serve anything, so it must
# never inherit pymongo's 30 second default server selection timeout: a database blip during a
# serverless cold start would otherwise block boot for half a minute.
MIGRATION_PROBE_TIMEOUT_MS = 3000

def get_mongodb_client(server_selection_timeout_ms=None):
    """Get MongoDB client using environment variables or defaults.

    Supports both MongoDB Atlas connection strings (MONGODB_URI) and
    traditional connection parameters (MONGODB_HOST, etc.).
    """
    options = {}
    if server_selection_timeout_ms is not None:
        options["serverSelectionTimeoutMS"] = server_selection_timeout_ms

    # Check for MongoDB Atlas connection string first (preferred for Vercel)
    mongodb_uri = os.getenv('MONGODB_URI')
    if mongodb_uri:
        return MongoClient(mongodb_uri, **options)

    # Fall back to individual connection parameters
    mongodb_host = os.getenv('MONGODB_HOST', 'localhost')
    mongodb_port = os.getenv('MONGODB_PORT', '27017')
    mongodb_user = os.getenv('MONGODB_USER', 'admin')
    mongodb_password = os.getenv('MONGODB_PASSWORD', 'secret')
    mongodb_auth_db = os.getenv('MONGODB_AUTH_DB', 'admin')

    # Format: mongodb://user:password@host:port/auth_database
    connection_string = f"mongodb://{mongodb_user}:{mongodb_password}@{mongodb_host}:{mongodb_port}/{mongodb_auth_db}"
    return MongoClient(connection_string, **options)

def get_database(db_name='conventioner', server_selection_timeout_ms=None):
    """Get database instance."""
    client = get_mongodb_client(server_selection_timeout_ms)
    return client[db_name]

def get_migration_probe_database(db_name='conventioner'):
    """A short-lived, time-bounded handle for the startup migration check in app.py."""
    return get_database(db_name, server_selection_timeout_ms=MIGRATION_PROBE_TIMEOUT_MS)
