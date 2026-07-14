"""Which browser origins this deployment lets spend an organizer's session cookie.

CORS with ``supports_credentials=True`` is what decides who may make a request that *carries the
organizer's session*, and this product's session cookie is ``SameSite=None``, so the browser attaches
it to cross-site XHR. Configured with no origin list, flask-cors reflects whatever ``Origin`` the
caller sent back in ``Access-Control-Allow-Origin`` and pairs it with
``Access-Control-Allow-Credentials: true`` - which is every website on the internet reading and
writing the organizer API, including the applications collection, as whichever organizer happens to
be visiting it.

So the origin list is configuration, not a default, and there is no wildcard: a credentialed wildcard
is not a permissive setting, it is the absence of the control. ``CORS_ALLOWED_ORIGINS`` is the
comma-separated list of origins that may do it, and a process that has not been told refuses to boot,
naming the variable - the same shape as the reCAPTCHA secret and the signing secret, and for the same
reason: this used to be keyed on ``FLASK_ENV != "production"``,
and the repo's own image exported ``FLASK_ENV=development``, so every deployment built from it served
the reflect-any-origin branch. A security control keyed on a variable whose default is the insecure value
is not a control.

The local-development escape hatch (see ``utils.deployment``) does not restore the wildcard either.
It allows *loopback* origins on any port - which is what a dev machine and the e2e stack actually
need, since the Vite port moves per worktree - and nothing else. An attacker's page is not served
from the developer's loopback, so this is an origin list too; it is just one nobody had to type.
"""

import logging
import os
import re
from typing import List, Pattern, Union

from flask_cors import CORS

from utils.deployment import (
    INSECURE_LOCAL_DEV_VAR,
    insecure_local_dev,
    warn_insecure_local_dev,
)

logger = logging.getLogger(__name__)

CORS_ALLOWED_ORIGINS_VAR = "CORS_ALLOWED_ORIGINS"

AllowedOrigin = Union[str, Pattern[str]]

LOOPBACK_ORIGINS = re.compile(r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$", re.IGNORECASE)

_ORIGIN_SYNTAX = re.compile(r"^https?://[A-Za-z0-9.\-]+(:\d+)?$")


class CorsConfigError(RuntimeError):
    """There is no origin list, so the credentialed CORS policy would allow every website."""


def allowed_origins() -> List[AllowedOrigin]:
    """The origins allowed to make credentialed requests to this deployment.

    Raises:
        CorsConfigError: when no list is configured and this is not an opted-in local development
            process, when the list contains a wildcard, or when an entry is not an origin.
    """
    entries = [entry.strip() for entry in os.getenv(CORS_ALLOWED_ORIGINS_VAR, "").split(",")]
    entries = [entry for entry in entries if entry]

    if "*" in entries:
        raise CorsConfigError(
            f"{CORS_ALLOWED_ORIGINS_VAR} contains `*`. This API is served with credentials, and a "
            f"credentialed wildcard means any website an organizer visits can read and write the "
            f"organizer API - markets, vendors, applications - using their live session cookie, "
            f"which is `SameSite=None` and therefore rides along on cross-site requests. List the "
            f"origins that may do that, in full (`https://app.example.com`), or set "
            f"{INSECURE_LOCAL_DEV_VAR}=true to allow loopback origins on a development machine."
        )

    malformed = [entry for entry in entries if not _ORIGIN_SYNTAX.match(entry)]
    if malformed:
        raise CorsConfigError(
            f"{CORS_ALLOWED_ORIGINS_VAR} holds {malformed!r}, which are not origins. A browser "
            f"sends `Origin: scheme://host[:port]` with no trailing slash and no path, and an entry "
            f"in any other shape matches nothing - so the origin it was meant to allow is refused "
            f"at the browser instead. Write each one as, for example, `https://app.example.com`."
        )

    if entries:
        return list(entries)

    if insecure_local_dev():
        warn_insecure_local_dev(f"a configured browser origin list ({CORS_ALLOWED_ORIGINS_VAR})")
        logger.warning(
            "Allowing credentialed requests from any loopback origin (%s). Set %s to the origins "
            "this deployment's front end is served from.",
            LOOPBACK_ORIGINS.pattern, CORS_ALLOWED_ORIGINS_VAR,
        )
        return [LOOPBACK_ORIGINS]

    raise CorsConfigError(
        f"{CORS_ALLOWED_ORIGINS_VAR} is not set. It is the comma-separated list of browser origins "
        f"allowed to make credentialed requests to this API (for example "
        f"`https://app.example.com`). Without it there is nothing to check an `Origin` against, and "
        f"a policy that allows every origin while carrying the organizer's `SameSite=None` session "
        f"cookie lets any website an organizer visits read and write the organizer API as them. "
        f"There is deliberately no default and no wildcard. Set {CORS_ALLOWED_ORIGINS_VAR}, or set "
        f"{INSECURE_LOCAL_DEV_VAR}=true if this really is a local development machine."
    )


def install_cors(app, origins: List[AllowedOrigin]) -> None:
    """Install the credentialed CORS policy for an already-validated origin list.

    Takes the origins rather than reading them, so that deciding whether this deployment is
    configured and *changing* the app are two different calls: flask-cors installs an
    ``after_request`` handler per invocation, and a check that quietly installed one would leave a
    handler behind every time anything asked it a question.
    """
    CORS(app, origins=origins, supports_credentials=True)


def describe_origins(origins: List[AllowedOrigin]) -> str:
    """The origin list as an operator can read it back in the boot log."""
    return ", ".join(
        origin.pattern if isinstance(origin, re.Pattern) else origin for origin in origins
    )
