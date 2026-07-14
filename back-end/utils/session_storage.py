"""Where this process keeps the organizer's session, and why it has to be told rather than guess.

There is no default that is right for both hosts this app is deployed to. A container or VM keeps
sessions on disk; a serverless function has no disk that outlives a request, so it has to keep the
session in the signed cookie instead. Pick either one as the default and it is wrong - silently, and
only on the other host.

That was the state this variable was in. ``SESSION_TYPE`` fell back to ``filesystem`` unless
``FLASK_ENV == "production"``, and the Dockerfile exported ``FLASK_ENV=development`` with nothing
overriding it - the same shape as the CORS hole this package exists to close: a variable derived from
another variable whose default lies. ``FLASK_ENV`` is gone from this repository entirely now, which
is what makes the rule structural: a variable nobody sets is one nobody can key on. A serverless deployment that trusted the derivation got
``filesystem``, ``os.makedirs`` raised on the read-only filesystem at import, and every request
answered 500 without naming a thing.

So the backend is configuration, and an unset value is a boot refusal that names itself - the same
answer, and for the same reason, as the four in ``check_public_endpoint_defenses`` (``app.py``). The
local-development escape hatch (see ``utils.deployment``) keeps sessions on disk, because a laptop
has one.

``null`` installs *nothing*: Flask's own session interface already keeps the session in the signed
cookie, which is the only store a serverless function has. flask-session has no ``null`` backend -
handing it one raises ``ValueError`` at import - so the cookie-only deployment is the one that does
not call ``Session(app)`` at all.
"""

import logging
import os

from flask import Flask
from flask_session import Session

from utils.deployment import INSECURE_LOCAL_DEV_VAR, insecure_local_dev

logger = logging.getLogger(__name__)

SESSION_TYPE_VAR = "SESSION_TYPE"

ON_DISK = "filesystem"
IN_COOKIE = "null"

SESSION_FOLDER = "flask_session"


class SessionStorageNotConfiguredError(RuntimeError):
    """Nothing has said where sessions live, and the wrong guess does not fail until it is deployed."""


def session_backend() -> str:
    """Where this deployment keeps the organizer's session.

    Returns:
        ``filesystem`` (server-side, on local disk) or ``null`` (in the signed cookie only).

    Raises:
        SessionStorageNotConfiguredError: when nothing is configured and this is not an opted-in
            local development process, or when the configured value is not a backend this app
            supports.
    """
    configured = os.getenv(SESSION_TYPE_VAR, "").strip().lower()

    if configured in (ON_DISK, IN_COOKIE):
        return configured

    if configured:
        raise SessionStorageNotConfiguredError(
            f"{SESSION_TYPE_VAR} is set to '{configured}', which is not a session backend this app "
            f"supports, and flask-session raises on an unrecognized one - so this process would "
            f"fail at import rather than serve anything. Set it to '{ON_DISK}' (sessions on local "
            f"disk: a container or a VM) or '{IN_COOKIE}' (sessions in the signed cookie only: a "
            f"serverless function, which has no disk that outlives a request)."
        )

    if insecure_local_dev():
        logger.warning(
            "%s is not set, so sessions are kept on disk ('%s'). That is this process's business "
            "because it has declared itself a local development one (%s); a deployment has to say "
            "where its sessions live, because the right answer depends on the host.",
            SESSION_TYPE_VAR, ON_DISK, INSECURE_LOCAL_DEV_VAR,
        )
        return ON_DISK

    raise SessionStorageNotConfiguredError(
        f"{SESSION_TYPE_VAR} is not set. It says where this process keeps the organizer's session, "
        f"and there is deliberately no default, because no default is right for both hosts this app "
        f"is deployed to: a serverless function has no disk that outlives a request, so '{ON_DISK}' "
        f"there fails at import - every request answers 500 and nothing names this variable - while "
        f"a container that kept its sessions in the cookie would be carrying state it has a disk "
        f"for. This used to be derived from FLASK_ENV, which the Dockerfile exported as 'development' "
        f"on every deployment built from it, so the derivation answered '{ON_DISK}' exactly where "
        f"it was wrong. Set {SESSION_TYPE_VAR}='{IN_COOKIE}' on a serverless host (Vercel) or "
        f"'{ON_DISK}' on a container or VM, or set {INSECURE_LOCAL_DEV_VAR}=true if this really is "
        f"a local development machine."
    )


def install_session_storage(app: Flask, backend: str) -> None:
    """Install the session store the check confirmed this host can actually keep.

    Takes the backend rather than reading it, for the same reason ``install_cors`` takes the origin
    list: asking whether this deployment is configured must not configure it.

    ``null`` installs nothing on purpose. Flask's own session interface signs the session into the
    cookie, which is what a serverless function needs and what flask-session cannot give it - there
    is no ``null`` backend, and ``Session(app)`` raises on one.
    """
    app.config[SESSION_TYPE_VAR] = backend

    if backend != ON_DISK:
        return

    os.makedirs(SESSION_FOLDER, exist_ok=True)
    app.config["SESSION_FILE_DIR"] = SESSION_FOLDER
    Session(app)
