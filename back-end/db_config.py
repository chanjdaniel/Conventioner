import ipaddress
import os
import threading
from pymongo import MongoClient

# Every client's bounds, passed as keywords, which PyMongo lets win over the same option in
# MONGODB_URI, so these lines are the one place they are set. Why each value:
# - SERVER_SELECTION_TIMEOUT_MS: 5 seconds finds a healthy Atlas server many times over and fails a
#   blip fast, where the driver's default would hold a request half a minute on a database that is
#   not there.
# - CONNECT_TIMEOUT_MS: a new connection's handshake gets the same 5 seconds, not the default 20.
# - SOCKET_TIMEOUT_MS: 30 seconds bounds any one wait on the server's reply (a find, a batch of an
#   import's bulk write, an index build at boot) far above what any takes on today's sizes and far
#   below the host's 300-second limit, so a long request is long by its number of round trips,
#   never by one hung one. A whole operation of several round trips has no overall deadline.
#   It is not the client-wide `timeoutMS`: in PyMongo 4.18 that operation timeout replaces
#   serverSelectionTimeoutMS, so server selection waits out the rest of its 30 seconds (measured:
#   a find at a closed port failed after 30.1 seconds, and the boot probe too, not after 5 and 3).
#   So `timeoutMS` is passed as None, which also turns off one a MONGODB_URI carries; a caller
#   wanting a deadline over a few operations uses `pymongo.timeout`, as /healthz does.
# - MAX_POOL_SIZE: 20 connections is well above one instance's concurrent use, and bounds the cluster's
#   500 connections at about 19 saturated instances rather than the default 100's five.
# - MAX_IDLE_TIME_MS: a connection idle for a minute is closed, so an instance a burst grew gives
#   its connections back.
SERVER_SELECTION_TIMEOUT_MS = 5000
CONNECT_TIMEOUT_MS = 5000
SOCKET_TIMEOUT_MS = 30000
MAX_POOL_SIZE = 20
MAX_IDLE_TIME_MS = 60000

# The startup migration check runs at import, before the app can serve anything, so its client
# finds a server within 3 seconds: a database blip during a serverless cold start must not hold
# the boot even for the 5 every other client waits.
MIGRATION_PROBE_TIMEOUT_MS = 3000

def get_mongodb_client(server_selection_timeout_ms=None):
    """Get MongoDB client using environment variables or defaults, with every client's bounds.

    Supports both MongoDB Atlas connection strings (MONGODB_URI) and
    traditional connection parameters (MONGODB_HOST, etc.). A caller's
    ``server_selection_timeout_ms`` replaces the 5-second selection timeout (the boot probe's 3).
    """
    options = {
        "serverSelectionTimeoutMS": SERVER_SELECTION_TIMEOUT_MS,
        "connectTimeoutMS": CONNECT_TIMEOUT_MS,
        "socketTimeoutMS": SOCKET_TIMEOUT_MS,
        "timeoutMS": None,
        "maxPoolSize": MAX_POOL_SIZE,
        "maxIdleTimeMS": MAX_IDLE_TIME_MS,
    }
    if server_selection_timeout_ms is not None:
        options["serverSelectionTimeoutMS"] = server_selection_timeout_ms

    # Check for MongoDB Atlas connection string first (preferred for Vercel)
    mongodb_uri = os.getenv('MONGODB_URI')
    if mongodb_uri:
        return MongoClient(mongodb_uri, **options)

    # Fall back to individual connection parameters
    mongodb_host = os.getenv('MONGODB_HOST', '127.0.0.1')
    mongodb_port = os.getenv('MONGODB_PORT', '27017')
    mongodb_user = os.getenv('MONGODB_USER', 'admin')
    mongodb_password = os.getenv('MONGODB_PASSWORD', 'secret')
    mongodb_auth_db = os.getenv('MONGODB_AUTH_DB', 'admin')

    # Format: mongodb://user:password@host:port/auth_database
    connection_string = f"mongodb://{mongodb_user}:{mongodb_password}@{mongodb_host}:{mongodb_port}/{mongodb_auth_db}"
    return MongoClient(connection_string, **options)

UNNAMED_DATABASE_REFUSAL = (
    "Refusing: neither MONGODB_HOST nor MONGODB_URI is set, so this would use 127.0.0.1:27017, "
    "which on a developer's machine is the primary checkout's stack. Run it in the back-end container "
    "of the stack you mean, which sets MONGODB_HOST (scripts/th-compose.sh exec backend python "
    "/app/<script>, or docker compose exec for the primary stack), or set MONGODB_HOST and "
    "MONGODB_PORT to that stack's MongoDB."
)

PRIMARY_STACK_REFUSAL = (
    "Refusing: the environment names {target}, which on a developer's machine is the primary "
    "checkout's stack, and a stale MONGODB_HOST (back-end/.env.example's 127.0.0.1, say) names it "
    "as easily as a meant one. Run it in the back-end container of the stack you mean (scripts/"
    "th-compose.sh exec backend python /app/<script>, or docker compose exec for the primary stack), "
    "or set MONGODB_PORT to a slot's MongoDB (27017 + slot * 10). To reach the primary stack's "
    "MongoDB from the host after all, set ALLOW_PRIMARY_STACK=true as well."
)

# The default port, which only the primary checkout's stack publishes on the host; a slot's is
# 27017 + slot * 10, and inside a stack MongoDB is the host `mongodb`.
PRIMARY_STACK_PORT = 27017

_TRUTHY = ("true", "1")


def _is_loopback(host):
    if host.lower() == "localhost":
        return True
    try:
        address = ipaddress.ip_address(host.strip("[]"))
    except ValueError:
        return False
    return address.is_loopback or address.is_unspecified


def _host_and_port(address, default_port):
    """``host[:port]``, an IPv6 one in brackets, as (host, port)."""
    if address.startswith("["):
        host, _, rest = address[1:].partition("]")
        port = rest[1:] if rest.startswith(":") else ""
    elif address.count(":") == 1:
        host, port = address.split(":")
    else:
        host, port = address, ""
    return host, int(port) if port.isdigit() else default_port


def _targets():
    """Every (host, port) the environment points the client at."""
    uri = os.getenv('MONGODB_URI')
    if uri:
        if not uri.startswith("mongodb://"):
            return []  # mongodb+srv:// names a hosted cluster by DNS
        hosts = uri[len("mongodb://"):].split("/", 1)[0].split("?", 1)[0].rpartition("@")[2]
        return [_host_and_port(h, PRIMARY_STACK_PORT) for h in hosts.split(",") if h]
    port = os.getenv('MONGODB_PORT', '')
    return [(os.environ['MONGODB_HOST'], int(port) if port.isdigit() else PRIMARY_STACK_PORT)]


def require_named_database():
    """Refuse, for a script that resets or seeds test data, unless the environment names its database,
    and names another than the primary checkout's stack's.

    Unnamed, ``get_mongodb_client`` falls back to 127.0.0.1:27017, the primary checkout's stack on a
    developer's machine, so such a script run on the host would reset or seed that stack whatever
    stack it was run for; and a MONGODB_HOST left over from running the back end on the host names
    the same database. So a loopback or unspecified host on the default port is refused too, unless
    the caller opts in with ALLOW_PRIMARY_STACK. Every stack's back-end container sets
    MONGODB_HOST=mongodb.
    """
    if not (os.getenv('MONGODB_URI') or os.getenv('MONGODB_HOST')):
        raise SystemExit(UNNAMED_DATABASE_REFUSAL)
    if os.getenv('ALLOW_PRIMARY_STACK', '').strip().lower() in _TRUTHY:
        return
    for host, port in _targets():
        if _is_loopback(host) and port == PRIMARY_STACK_PORT:
            raise SystemExit(PRIMARY_STACK_REFUSAL.format(target=f"{host}:{port}"))


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
