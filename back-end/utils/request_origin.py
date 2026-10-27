"""Which state-changing requests this deployment takes, by where the browser says they came from.

CORS decides which origins may *read* a response; it does not stop a request from being sent. A
plain form post goes without a preflight, and the session cookie is ``SameSite=None``, so the
browser attaches it to that post whatever page sent it. So a write is checked for where it came
from before its route runs, against the same list CORS answers from (``utils.cors``), so there is
one list of the app's origins.

The decision is OWASP's Fetch Metadata check with its ``Origin`` fallback:

- ``GET``, ``HEAD`` and ``OPTIONS`` pass: they change nothing, and a CORS preflight is one.
- ``Sec-Fetch-Site: same-origin`` or ``none`` passes: the browser says the app (or the person, from
  the address bar) sent it. Local development and the E2E stack reach the API through Vite's
  ``/api`` proxy, which the browser sees as same-origin.
- Otherwise a request with an ``Origin`` passes only when that origin is in the list. Production's
  app calls its API on a sibling host, which is ``same-site`` with a listed origin.
- A request with ``Sec-Fetch-Site`` but no ``Origin`` is refused: every browser that sends Fetch
  Metadata sends ``Origin`` on a write.
- A request with neither header passes: it is not a browser (a script, the E2E API helper, a health
  check), or a browser too old to send either, and there is nothing to check.
"""

from typing import List, Optional

from flask import jsonify, request

from utils.cors import AllowedOrigin, origin_is_allowed

REQUEST_ORIGIN_REFUSAL = "Request origin not allowed"

_METHODS_THAT_CHANGE_NOTHING = frozenset({"GET", "HEAD", "OPTIONS"})
_THE_BROWSERS_OWN = frozenset({"same-origin", "none"})


def request_origin_allowed(
    method: str,
    fetch_site: Optional[str],
    origin: Optional[str],
    origins: List[AllowedOrigin],
) -> bool:
    """Whether a request with this method, ``Sec-Fetch-Site`` and ``Origin`` may go on to its route."""
    if method.upper() in _METHODS_THAT_CHANGE_NOTHING:
        return True
    if fetch_site is not None and fetch_site.lower() in _THE_BROWSERS_OWN:
        return True
    if origin is not None:
        return origin_is_allowed(origin, origins)
    return fetch_site is None


def install_request_origin_check(app, origins: List[AllowedOrigin]) -> None:
    """Refuse, on every route, a write whose browser says it came from outside ``origins``.

    Installed as a ``before_request``, so it answers before the route (and its sign-in check) runs,
    and a route added later is covered without doing anything.
    """

    @app.before_request
    def refuse_a_write_from_another_origin():
        if request_origin_allowed(
            request.method,
            request.headers.get("Sec-Fetch-Site"),
            request.headers.get("Origin"),
            origins,
        ):
            return None
        return jsonify({"error": REQUEST_ORIGIN_REFUSAL}), 403
