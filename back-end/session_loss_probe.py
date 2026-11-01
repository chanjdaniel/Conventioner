"""TEMPORARY (T177): log what ends an organizer's session, to find why E2E sessions end mid-test.

Reverted before review. It logs the client a sign-in recorded and the client of a request that
session protection refused, so the CI log shows which of the two changed; the stack's addresses
and Playwright's browser string are all it can name there.
"""
import logging
import os

from flask import Flask, request, session
from flask_login import session_protected, user_logged_in
from flask_login.utils import _get_remote_addr

logger = logging.getLogger("session_loss_probe")


def _client() -> str:
    return (
        f"addr={_get_remote_addr()!r} xff={request.headers.get('X-Forwarded-For')!r} "
        f"ua=...{(request.headers.get('User-Agent') or '')[-40:]!r}"
    )


def _sid() -> str:
    return (request.cookies.get("session") or "")[:6]


def install(app: Flask) -> None:
    @user_logged_in.connect_via(app)
    def _signed_in(_app, user, **_):
        logger.warning(
            "PROBE sign-in sid=%s id=%s %s %s", _sid(), str(session.get("_id"))[:8], request.path,
            _client(),
        )

    @session_protected.connect_via(app)
    def _protected(_app, **_):
        logger.warning(
            "PROBE protected sid=%s now-id=%s %s %s %s", _sid(),
            app.login_manager._session_identifier_generator()[:8], request.method, request.path,
            _client(),
        )

    @app.after_request
    def _refused(response):
        if response.status_code == 401 and request.cookies.get("session"):
            stored = None
            cache = getattr(app.session_interface, "cache", None)
            if cache is not None:
                stored = os.path.exists(cache._get_filename("session:" + request.cookies["session"]))
            logger.warning(
                "PROBE 401 sid=%s stored-file=%s keys=%s %s %s %s", _sid(), stored,
                sorted(session.keys()), request.method, request.path, _client(),
            )
        return response
