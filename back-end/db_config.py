import os
import threading
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

_default_clients = {}
_default_clients_lock = threading.Lock()


def get_database(db_name='conventioner', server_selection_timeout_ms=None):
    """Get database instance.

    The default client is made once per process and reused. A ``MongoClient`` is a connection
    POOL with its own background monitoring threads, and it is never closed - so building one per
    request leaks a pool and its threads for the life of the process. Most API modules already
    called this once at import; ``api/applicants.py`` called it inside four request handlers, so
    every public applicant request leaked one. Measured against a running stack: forty applicant
    requests grew MongoDB's open connection count while forty requests to an endpoint whose module
    builds one client at import did not move it at all.

    Memoizing here rather than hoisting those four calls to module level keeps ``get_database`` as
    the seam the applicant tests patch, and makes the leak structurally impossible rather than
    fixed at four call sites someone can add a fifth to.

    A caller that passes ``server_selection_timeout_ms`` is asking for a handle on its own terms
    and gets a fresh client: that is the startup migration probe, which wants a short-lived,
    time-bounded one and runs once.
    """
    if server_selection_timeout_ms is not None:
        return get_mongodb_client(server_selection_timeout_ms)[db_name]

    with _default_clients_lock:
        client = _default_clients.get(db_name)
        if client is None:
            client = get_mongodb_client(None)
            _default_clients[db_name] = client
    return client[db_name]

def get_migration_probe_database(db_name='conventioner'):
    """A short-lived, time-bounded handle for the startup migration check in app.py."""
    return get_database(db_name, server_selection_timeout_ms=MIGRATION_PROBE_TIMEOUT_MS)
