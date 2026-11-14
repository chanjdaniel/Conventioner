# flask run --port=5001 --cert=adhoc > error.log 2>&1
# First, before the imports below build their Mongo clients from it. Nothing reads a *secret* at
# import any more - the three that used to are now read on call, so the boot check answers for the
# environment as it stands rather than for the import order that produced it. See utils.env_file.
from utils.env_file import load_env_file

load_env_file()

import api.users as UsersApi
import organizer_sessions as OrganizerSessions
import api.organizations as OrgsApi
import api.markets as MarketsApi
import api.layouts as LayoutsApi
import api.placements as PlacementsApi
import api.added_vendors as AddedVendorsApi
import api.vendor_info as VendorInfoApi
import api.payments as PaymentsApi
import api.vendor_export as VendorExportApi
import api.discord_connection as DiscordConnectionApi
import csv_import as CsvImport
import csv_proposal as CsvProposal
import csv_start as CsvStart
import host_limits as HostLimits
import typesafe_client as TypeSafe
import market_stats as MarketStats
import api.attendance as AttendanceApi
import payments as Payments
import api.door as DoorApi
import api.vendor_check_in as VendorCheckInApi
import api.applications as ApplicationsApi
import api.applicant_auth as ApplicantAuthApi
import api.applicants as ApplicantsApi
import api.market_actions as Actions
import history as History
import review_team as ReviewTeam
from api.floorplans import floorplans_bp
from api.floorplans_placement import floorplans_placement_bp
from api.floorplans_templates import floorplans_templates_bp
from api.floorplans_save import floorplans_save_bp

from typing import Any, Dict, List, NamedTuple, Optional
from flask import Flask, g, request, jsonify, make_response, Response, session
from flask_login import (
    LoginManager,
    current_user,
    login_required,
    login_user,
    logout_user,
    session_protected,
    user_loaded_from_cookie,
    user_loaded_from_request,
    user_logged_in,
    user_logged_out,
)
from flask_bcrypt import Bcrypt
from datatypes import ApplicationStatus, Market, MarketPerson, MarketPhase, MarketRole, Organization, VerdictGiver
from assignment.utils import convert_keys_to_camel_case, convert_keys_to_snake_case
from market_documents import (
    MarketKeyMigrationError,
    assert_market_key_migration_recorded,
)
import db_config
import pymongo
from lookup_indexes import ensure_lookup_indexes
import market_deletion as MarketDeletion
from tombstone import live
from unique_indexes import UniqueIndexError
import json
import os
import glob
import time
import logging

from utils.captcha import (
    CaptchaNotConfiguredError,
    assert_captcha_configured,
)
from utils.cors import (
    AllowedOrigin,
    CorsConfigError,
    allowed_origins,
    describe_origins,
    install_cors,
)
from utils.deployment import (
    LocalSwitchOnDeployedHostError,
    assert_no_local_switch_on_deployed_host,
    deployed_host,
    insecure_local_dev,
)
from utils.email import (
    MailLinksNotConfiguredError,
    MailerNotConfiguredError,
    SenderNotConfiguredError,
    assert_mail_links_configured,
    assert_mailer_configured,
    assert_sender_configured,
)
from utils.proxy import (
    TrustedProxyConfigError,
    install_trusted_proxy_fix,
    trusted_proxy_hops,
)
from utils.request_origin import install_request_origin_check
from utils.security_headers import install_security_headers
from client_errors import BadRequestError, install_error_answers
from utils.secret_key import (
    SecretKeyNotConfiguredError,
    signing_secret,
)
from utils.identity import authenticated_email
from utils.request_body import json_object, string_field
from utils.session_storage import (
    ON_DISK,
    SESSION_FOLDER,
    SessionStorageNotConfiguredError,
    install_session_storage,
    keeps_sessions_on_disk,
    session_backend,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def verify_market_key_migration() -> None:
    """Refuse to boot unless the market-key migration is recorded as applied.

    Reads name the canonical camelCase key only, so a market left under the legacy snake_case
    keys is simply invisible - vendors are told the market does not exist at check-in, and org
    members get an empty market list, with nothing logged anywhere. Nothing auto-runs the
    migration (rewriting stored documents is the operator's call), so this check is what makes
    skipping it impossible to miss.

    It reads the migration's marker document by ``_id``: one indexed lookup, bounded by a short
    server selection timeout so a database blip cannot hang boot. Being that cheap is what lets
    it fail closed on every outcome that is not a confirmed marker - an unreachable database
    could not serve a request anyway, and an unknown migration state must never be taken for a
    migrated one.
    """
    probe = db_config.get_migration_probe_database()
    try:
        assert_market_key_migration_recorded(probe)
    except MarketKeyMigrationError as e:
        logger.critical("%s", e)
        raise
    finally:
        probe.client.close()


verify_market_key_migration()


def verify_application_indexes() -> None:
    """Refuse to boot unless the uniqueness the application endpoints rest on is enforced.

    One applicant is one application at a market, and that guarantee is one a unique
    database index carries: the write that creates an application is an upsert on a
    public endpoint, so it is a read-then-write race that only the database can settle.
    A process that could not build the index would run with the guarantee silently
    absent -- duplicate applications on the organizer's list, and the D9 form lock
    double-counted into uselessness.

    So it is built here, once, at boot, and a build that fails takes the process with
    it, exactly as a missing market-key migration does. An index that will not build
    almost always means the collection already holds the duplicates the index exists to
    forbid; that is a state to stop and fix, not to serve more traffic into.

    Building it here also takes it off the request path: the lazy build the module
    keeps is for tooling and tests, and in a booted process it has already been done.
    """
    try:
        ApplicationsApi.ensure_application_indexes()
    except ApplicationsApi.ApplicationIndexError as e:
        logger.critical("Refusing to start: %s", e)
        raise


verify_application_indexes()


def verify_applicant_login_indexes() -> None:
    """Refuse to boot unless the applicant login challenge indexes are in place.

    The applicant login endpoints rest on two indexes: a unique compound index
    on (market_id, email) that ensures one active challenge per address, and a
    TTL index on expires_at that cleans up expired challenges. Without them,
    code replay is possible and expired challenges accumulate forever.

    Built here, once, at boot, so a deployment that cannot hold them says so
    before it takes a request rather than in the middle of one.
    """
    try:
        ApplicantAuthApi.ensure_applicant_login_indexes()
    except ApplicantAuthApi.ApplicantLoginIndexError as e:
        logger.critical("Refusing to start: %s", e)
        raise


verify_applicant_login_indexes()


def verify_user_indexes() -> None:
    """Refuse to boot unless one address can be only one account (E32/F03/S04).

    Register is a read-then-insert, and a double click on it made two accounts for one address. The
    unique index on the stored, lowercased address is the referee, so it is built here and a
    process that cannot hold it - addresses not yet lowercased, or duplicates already stored - says
    so, naming what to do, before it takes a request.
    """
    try:
        UsersApi.ensure_user_indexes()
    except UsersApi.UserIndexError as e:
        logger.critical("Refusing to start: %s", e)
        raise


verify_user_indexes()


def verify_organizer_session_indexes() -> None:
    """Refuse to boot unless an organizer's sign-ins can be kept on the server (ADR 0029).

    Every sign-in is a record in ``organizer_sessions``; a TTL index removes one once it has ended,
    and an index by account serves ending all of an account's at once. Built here, so a process
    that cannot hold them says so before it takes a request.
    """
    try:
        OrganizerSessions.ensure_organizer_session_indexes()
    except OrganizerSessions.OrganizerSessionIndexError as e:
        logger.critical("Refusing to start: %s", e)
        raise


verify_organizer_session_indexes()


def verify_attendance_indexes() -> None:
    """Refuse to boot unless one vendor's day can be only one attendance record (T270).

    A check-in is an upsert by market, vendor and date, and two at once could store two records,
    so one Undo left the vendor reading as here. The unique index is the referee, built here; a
    process that cannot hold it - the collection already holding such duplicates - says so, naming
    them by market, date and record id, before it takes a request (``unique_indexes``).
    """
    try:
        AttendanceApi.ensure_attendance_indexes()
    except UniqueIndexError as e:
        logger.critical("Refusing to start: %s", e)
        raise


verify_attendance_indexes()


def verify_payment_indexes() -> None:
    """Refuse to boot unless one vendor's day can be only one owed record (T270).

    The freed line and an amount set by hand are each an upsert by market, vendor and date, and
    an Admin's set as an Editor freed the seat could store two records, so whichever the server
    found first won. The unique index is the referee, built here; a process that cannot hold it
    says so, naming the duplicates by market, date and record id, before it takes a request
    (``unique_indexes``).
    """
    try:
        Payments.ensure_payment_indexes()
    except UniqueIndexError as e:
        logger.critical("Refusing to start: %s", e)
        raise


verify_payment_indexes()


def build_lookup_indexes() -> None:
    """Index every field a document is looked up by (``lookup_indexes``), once, at boot.

    Not a refusal like the ones above: these carry no guarantee, only speed. A database that cannot
    build one cannot serve a request either, so its error is left to stop the boot as it is.
    """
    ensure_lookup_indexes()


build_lookup_indexes()


class PublicEndpointDefenseError(RuntimeError):
    """The public endpoints are not configured to defend themselves."""


class PublicEndpointDefenses(NamedTuple):
    """What a passing check found, so the caller that installs it does not fetch it a second time."""

    signing_secret: str
    origins: List[AllowedOrigin]
    session_backend: str
    trusted_proxy_hops: int


def check_public_endpoint_defenses() -> PublicEndpointDefenses:
    """Refuse to boot without the configuration this app's public surface rests on.

    The signup, verification, password-reset and OTP endpoints are unauthenticated, they write to
    the database, and they send mail from this domain. What keeps a script off them is a reCAPTCHA
    secret; what makes the session cookie they hand back mean anything is a signing secret; what
    decides which websites may spend that cookie against the organizer API is the browser origin
    list; what carries every mail by which an organizer account is ever reached is a mail key, sent
    from ``FROM_EMAIL`` with links to ``FRONTEND_URL``; what says where that session is kept at all,
    which has no answer that is right for both a container and a serverless function, is
    ``SESSION_TYPE``; and what decides whose address the captcha is actually scored against, when
    something the deployment owns sits in front of Flask, is ``TRUSTED_PROXY_HOPS``.

    Three of the eight fail *silently* when unset: the captcha passes everybody, a session cookie
    signed with a key the repository publishes is a session anyone can forge, and a credentialed
    CORS policy with no origin list hands the organizer API to every website an organizer visits.
    The mail key, the two mail addresses and the session backend are here for the mirror-image
    reason - unset, the key fails *every* registration, reset and OTP with a 500 that names nothing,
    the addresses mail links to a laptop from a sender that delivers to nobody, and the session
    backend sends a serverless deployment looking for a disk it does not have, failing at import and
    naming nothing either - and a variable whose absence has to be diagnosed one broken deployment
    at a time belongs in the same refusal as the ones whose absence is never diagnosed at all. The
    hop count is the quietest of all: unset behind a proxy, every signup in the world is reported to
    Google as coming from one address, and a reCAPTCHA score is the only place it ever shows. As with
    the market-key migration above, an unknown state is never taken for a safe one: it fails at
    boot, naming the variables, rather than in production, naming nothing.

    This is a *check*: it reads configuration and nothing else, so asking whether this deployment is
    configured cannot change it. Installing what it found is ``configure_public_endpoint_defenses``.

    Every check runs, and the refusal carries *all* of them. Stopping at the first would hand an
    operator one variable at a time and a redeploy between each, which turns one loud failure into
    a sequence of them and invites the third to be met by giving up. What is required is written
    down where the promotion is - ``docs/RELEASING.md`` - because this is a boot-time contract,
    and a deployment that has not met it does not serve the organizer app either.

    This runs for *every* process, not only one that calls itself production. Conditioning it on
    ``FLASK_ENV`` is what made the whole check dead code: the repo's own image exported
    ``FLASK_ENV=development`` and nothing overrode it, so the deployments that most needed the
    check were exactly the ones exempt from it. The escape hatch is opt-in and it is loud - see
    ``utils.deployment`` - so a development machine can still boot unconfigured while a deployment
    that forgets cannot. And the hatch, with the test switches it unlocks, is refused first on a
    host the platform says is deployed, since there it would pass every other check by itself.

    Raises:
        PublicEndpointDefenseError: naming every variable that is missing, all at once.
    """
    problems = []
    secret = ""
    origins: List[AllowedOrigin] = []
    sessions = ON_DISK
    hops = 0

    try:
        assert_no_local_switch_on_deployed_host()
    except LocalSwitchOnDeployedHostError as e:
        problems.append(str(e))

    try:
        assert_captcha_configured()
    except CaptchaNotConfiguredError as e:
        problems.append(str(e))

    try:
        assert_mailer_configured()
    except MailerNotConfiguredError as e:
        problems.append(str(e))

    try:
        assert_mail_links_configured()
    except MailLinksNotConfiguredError as e:
        problems.append(str(e))

    try:
        assert_sender_configured()
    except SenderNotConfiguredError as e:
        problems.append(str(e))

    try:
        secret = signing_secret()
    except SecretKeyNotConfiguredError as e:
        problems.append(str(e))

    try:
        origins = allowed_origins()
    except CorsConfigError as e:
        problems.append(str(e))

    try:
        sessions = session_backend()
    except SessionStorageNotConfiguredError as e:
        problems.append(str(e))

    try:
        hops = trusted_proxy_hops()
    except TrustedProxyConfigError as e:
        problems.append(str(e))

    if problems:
        message = "\n\n".join([
            f"Refusing to start: {len(problems)} of the things this app's public surface rests on "
            f"are not as a deployment needs them, and not one of them announces itself - each is a "
            f"defense that quietly stops defending, the mail without which no organizer account "
            f"can be reached, the store the session is kept in, the address a caller is taken to "
            f"be at, or a local-development switch left on where the platform says this is "
            f"deployed. All of them are named below. See the required production environment in "
            f"docs/RELEASING.md before promoting.",
            *problems,
        ])
        logger.critical("%s", message)
        raise PublicEndpointDefenseError(message)

    return PublicEndpointDefenses(
        signing_secret=secret,
        origins=origins,
        session_backend=sessions,
        trusted_proxy_hops=hops,
    )


def configure_public_endpoint_defenses(
    flask_app: Flask, defenses: PublicEndpointDefenses,
) -> None:
    """Install what the check confirmed: the signing key, the origins it may be spent from (which
    are also the origins a write is taken from), the store it is kept in, and the hops a caller's
    address may be read back through.

    The session store goes on last, because a cookie-only session *is* the signed cookie: the
    interface is built against the app's ``SECRET_KEY``, which the first line here is what puts
    there.
    """
    flask_app.config["SECRET_KEY"] = defenses.signing_secret
    install_cors(flask_app, defenses.origins)
    install_request_origin_check(flask_app, defenses.origins)
    logger.info(
        "Allowing credentialed browser requests from: %s", describe_origins(defenses.origins),
    )
    install_trusted_proxy_fix(flask_app, defenses.trusted_proxy_hops)
    install_session_storage(flask_app, defenses.session_backend)


app = Flask(__name__)

# How long a sign-in lasts (E38/F14/S01): the two lengths are `organizer_sessions`', and each
# sign-in's record there ends it at its own. The session cookie ends with the browser in either
# store (flask-session's own default is a lasting cookie); a store on disk keeps a session for an
# unremembered sign-in's length from its last change. The remember cookie expires when a
# remembered sign-in ends, and use does not extend it. Its `__Host-` prefix holds it to this host:
# a browser takes it, and its deletion, only with Secure, `Path=/` and no Domain, so none is set
# and `RefusingLoginManager` deletes it with the attributes it was set with.
app.config["SESSION_PERMANENT"] = False
app.config["PERMANENT_SESSION_LIFETIME"] = UsersApi.SIGN_IN_LIFETIME
# A session is written only when a request changed it. flask-session's store on disk otherwise
# writes every request's session back as that request read it, so a read in flight while the
# browser signed in again wrote back the sign-in the new one had ended, and signed the browser out.
# The cookie store writes an unchanged session only when it is permanent, which none is.
app.config["SESSION_REFRESH_EACH_REQUEST"] = False
app.config["REMEMBER_COOKIE_NAME"] = UsersApi.REMEMBER_COOKIE
app.config["REMEMBER_COOKIE_PATH"] = "/"
app.config["REMEMBER_COOKIE_DURATION"] = UsersApi.REMEMBERED_SIGN_IN_LIFETIME
app.config["REMEMBER_COOKIE_REFRESH_EACH_REQUEST"] = False
app.config["SESSION_COOKIE_NAME"] = "session"
app.config["SESSION_COOKIE_HTTPONLY"] = True
# None of it is configurable. The session cookie and the remember cookie are SameSite=Lax, so a
# browser sends them only on a request from this site, or on a top-level GET navigation to the API
# from another site. Lax holds because every front end that signs in is on the API's site:
# `conventioner.io` and `api.conventioner.io` are one site (a site ignores the subdomain and the
# port), and the local and E2E stacks are one origin, the front end reaching the API through its
# `/api` proxy. A front end on another site cannot sign in: a browser keeps neither cookie from its
# answers. Both are Secure, which loopback satisfies as a secure context, so local dev is
# unaffected; the remember cookie is HttpOnly by Flask-Login's default. A vendor's remember cookie,
# `__Host-vendor_remember_<market id>` (`remembered_sign_ins`, ADR 0022), stays SameSite=None, which
# a browser takes only on a Secure cookie; that module sets it from the three
# VENDOR_REMEMBER_COOKIE_ keys below, HttpOnly so no script on the vendor page reads it, and its
# prefix makes a browser refuse it without Secure.
app.config["SESSION_COOKIE_SECURE"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["REMEMBER_COOKIE_SECURE"] = True
app.config["REMEMBER_COOKIE_SAMESITE"] = "Lax"
app.config["VENDOR_REMEMBER_COOKIE_SECURE"] = True
app.config["VENDOR_REMEMBER_COOKIE_SAMESITE"] = "None"
app.config["VENDOR_REMEMBER_COOKIE_HTTPONLY"] = True

configure_public_endpoint_defenses(app, check_public_endpoint_defenses())
install_error_answers(app)
install_security_headers(app)

# The host's own limit, so a local stack refuses what production refuses (host_limits.py).
app.config["MAX_CONTENT_LENGTH"] = HostLimits.MAX_REQUEST_BODY_BYTES

bcrypt = Bcrypt(app)


class RefusingLoginManager(LoginManager):
    """Flask-Login's "strong" session protection, refusing a request without ending the sign-in.

    "strong" holds a session to the client that signed in, its address and browser, and refuses a
    request from any other. Flask-Login refuses one by deleting a session that is not permanent,
    and the remember-me cookie with it, and only marks a permanent one not fresh. Sessions were
    permanent until E38/F14/S01; since then one request the server could not hold to the browser
    signed it out (T177). In the store on disk the deletion is on the server, so it held even when
    nobody read the answer: a request a closed connection cut short of its User-Agent, say. In the
    cookie store the deletion travels in the answer, so it signed out a browser that read it.

    So a request from another client, its session permanent or not, is answered as signed out, and
    the session and the remember-me cookie stay as they were for the browser that signed in. A
    copied session cookie is refused as before, at every request; a browser whose address changes
    is too, until it is back on the first address or signs in again (E47).
    """

    def _session_protection_failed(self) -> bool:
        if app.config.get("SESSION_PROTECTION", self.session_protection) != "strong":
            return super()._session_protection_failed()
        if not session or session.get("_id") == self._session_identifier_generator():
            return False
        session_protected.send(app)
        return True

    def _clear_cookie(self, response: Response) -> None:
        """Delete the remember cookie with the attributes it was set with.

        Flask-Login deletes it with its name, path and domain only, and a browser refuses the
        deletion of a `__Host-` cookie that is not Secure, so the cookie would outlive sign-out in
        the browser.
        """
        config = app.config
        response.delete_cookie(
            config["REMEMBER_COOKIE_NAME"], path=config["REMEMBER_COOKIE_PATH"],
            secure=config["REMEMBER_COOKIE_SECURE"], httponly=True,
            samesite=config["REMEMBER_COOKIE_SAMESITE"],
        )


login_manager = RefusingLoginManager()
login_manager.init_app(app)
login_manager.session_protection = "strong"


@user_loaded_from_cookie.connect_via(app)
def hold_a_restored_session_to_its_browser(_app: Flask, user: Any) -> None:
    """Hold a session the remember-me cookie restored to the browser that restored it.

    "strong" refuses a session whose client identifier is not the one it holds
    (`RefusingLoginManager`); a sign-in records the identifier (`login_user`), but Flask-Login's
    restore from the cookie does not, so the session it restored was refused at its next request
    and "Remember me" lasted one request (E38/F14/S01). Recorded here, the way `login_user` does.
    """
    session["_id"] = login_manager._session_identifier_generator()


@login_manager.request_loader
def a_legacy_remembered_account(_request: Any) -> Any:
    """The account a legacy `remember_token` cookie names, read for one release (ADR 0029).

    The remember cookie of a sign-in made before sign-ins were kept on the server: Flask-Login asks
    here once the session has loaded no one and the browser holds no new remember cookie. Restored
    into the session as Flask-Login's own restore does, and held to the browser by
    `hold_a_restored_session_to_its_browser`; a replaced login id ends it, and a sign-in or sign-out
    deletes the cookie (`forget_the_legacy_remember_cookie`).
    """
    restored = UsersApi.legacy_remembered_account(
        request.cookies.get(UsersApi.LEGACY_REMEMBER_COOKIE))
    if restored is None:
        return None
    sign_in, account = restored
    session["_user_id"] = sign_in
    session["_fresh"] = False
    return account


user_loaded_from_request.connect(hold_a_restored_session_to_its_browser, app)


@user_logged_in.connect_via(app)
@user_logged_out.connect_via(app)
def _a_sign_in_or_out_forgets_the_legacy_cookie(_app: Flask, **_extra: Any) -> None:
    g.forget_the_legacy_remember_cookie = True


@app.after_request
def forget_the_legacy_remember_cookie(response: Response) -> Response:
    """Delete a legacy `remember_token` the browser sent, once this request signed in or out, so
    it cannot bring a sign-in back."""
    if (g.get("forget_the_legacy_remember_cookie")
            and UsersApi.LEGACY_REMEMBER_COOKIE in request.cookies):
        response.delete_cookie(
            UsersApi.LEGACY_REMEMBER_COOKIE, path="/", secure=True, httponly=True,
            samesite=app.config["REMEMBER_COOKIE_SAMESITE"],
        )
    return response


app.register_blueprint(floorplans_bp, url_prefix="/floorplans")
app.register_blueprint(floorplans_placement_bp, url_prefix="/floorplans")
app.register_blueprint(floorplans_templates_bp, url_prefix="/floorplans")
app.register_blueprint(floorplans_save_bp, url_prefix="/floorplans")


# The health check's own bound on its ping, the same as every client's server selection.
HEALTH_CHECK_TIMEOUT_SECONDS = 5


@app.route('/healthz', methods=['GET'])
def healthz() -> Response:
    """Whether this deployment can serve a request, and which commit it was deployed from.

    Booting already proves the configuration and the migration markers (both refuse at import),
    so the one thing left that can fail after a good deploy is the database. The Deploy workflow
    and the uptime check read this; it says nothing about any market, so it needs no login.

    `commit` is the deployment's `BUILD_COMMIT`, which the Deploy workflow sets on each deployment
    and compares with the commit it released, so a domain still on an older build cannot pass for
    the new one. A build with no `BUILD_COMMIT`, or a blank one, says `null`; any other value is
    reported as given. It is public on purpose: every released commit is on the public `main`.

    `deployed` says whether a platform variable says this host is deployed, and `localDev` whether
    `ALLOW_INSECURE_LOCAL_DEV` is on (`utils.deployment`). The Deploy workflow refuses a build that
    does not answer `true` and `false`, so the boot's refusal of local switches is proven armed on
    every release. Neither is secret: production answers `true` and `false`.
    """
    commit = os.environ.get("BUILD_COMMIT", "")
    commit = commit if commit.strip() else None
    seen = {"commit": commit, "deployed": deployed_host() is not None, "localDev": insecure_local_dev()}
    try:
        # Bounded on its own, so a server that is found but does not answer fails the check
        # within about 5 seconds too, not after the client's 30-second wait for a reply.
        with pymongo.timeout(HEALTH_CHECK_TIMEOUT_SECONDS):
            MarketsApi.markets_collection.database.command("ping")
    except Exception:
        logger.exception("Health check: the database did not answer")
        return jsonify({"status": "unavailable", **seen}), 503
    return jsonify({"status": "ok", **seen}), 200


# users

@login_manager.user_loader
def get_user(sign_in: str) -> Any:
    return UsersApi.signed_in_account(sign_in)



@app.route('/login', methods=['POST'])
def login() -> Response:
    return UsersApi.login(bcrypt, login_user)

@app.route('/logout', methods=['POST'])
@login_required
def logout() -> Response:
    return UsersApi.logout(logout_user)

@app.route('/logout-everywhere', methods=['POST'])
@login_required
def logout_everywhere() -> Response:
    return UsersApi.logout_everywhere(current_user, logout_user)

@app.route('/check-session', methods=['GET'])
@login_required
def check_session() -> Response:
    return UsersApi.check_session(current_user)

@app.route('/register', methods=['POST'])
def register() -> Response:
    return UsersApi.register_user_with_captcha(bcrypt)

@app.route('/verify-email', methods=['POST'])
def verify_email() -> Response:
    return UsersApi.verify_email()

@app.route('/resend-verification', methods=['POST'])
def resend_verification() -> Response:
    return UsersApi.resend_verification_email()

@app.route('/request-password-reset', methods=['POST'])
def request_password_reset() -> Response:
    return UsersApi.request_password_reset()

@app.route('/reset-password', methods=['POST'])
def reset_password() -> Response:
    return UsersApi.reset_password(bcrypt)

@app.route('/request-otp', methods=['POST'])
def request_otp() -> Response:
    return UsersApi.request_otp()

@app.route('/login-otp', methods=['POST'])
def login_otp() -> Response:
    return UsersApi.login_with_otp(login_user)

@app.route('/delete-user', methods=['POST'])
@login_required
def delete_user() -> Response:
    """Delete the signed-in user's own account.

    The identity comes from the session and from nowhere else. This endpoint used to take it from
    the ``X-Owner-Email`` header, with no ``@login_required`` at all, and compare that header to the
    email in the request body - two values the caller controls, so the ownership check always passed
    and an anonymous ``curl`` could delete any verified account.

    There is deliberately no anonymous cleanup path for unverified accounts any more. Cleaning up
    orphaned registrations is maintenance work, not something a stranger may ask for.
    """
    return UsersApi.delete_user(current_user.email)

# organizations

@app.route('/organizations', methods=['GET'])
@login_required
def get_organizations() -> Response:
    """Get all organizations for the current user."""
    organizations = OrgsApi.get_organizations_for_user(authenticated_email())
    return jsonify({"organizations": organizations}), 200

@app.route('/organizations', methods=['POST'])
@login_required
def create_organization() -> Response:
    """Create a new organization."""
    data = json_object(required=True)

    name = (string_field(data, 'name') or '').strip()
    if not name:
        return jsonify({"error": "Organization name required"}), 400

    org_id = OrgsApi.create_organization(authenticated_email(), name)
    return jsonify({
        "message": "Organization created successfully",
        "organization_id": org_id
    }), 201

@app.route('/organizations/<org_id>', methods=['GET'])
@login_required
def get_organization(org_id: str) -> Response:
    """Get an organization by id, for its owner, admins and members only."""
    return jsonify({"organization": OrgsApi.read_organization(org_id, authenticated_email())}), 200

@app.route('/organizations/<org_id>', methods=['PUT'])
@login_required
def update_organization(org_id: str) -> Response:
    """Rename an organization. Only owner can update. Body: { "name": "..." }; nothing else is read."""
    data = json_object(required=True)

    name = (string_field(data, 'name') or '').strip()
    if not name:
        return jsonify({"error": "Organization name required"}), 400

    result = OrgsApi.update_organization(org_id, authenticated_email(), name)
    return jsonify({
        "message": "Organization updated successfully",
        "modified_count": result.modified_count
    }), 200

@app.route('/organizations/<org_id>/history', methods=['GET'])
@login_required
def get_organization_history(org_id: str) -> Response:
    """One page of the organization's own changes, newest first, for Manage organization's History.

    Its owner, admins and members read it. ``?before=`` is the cursor the last page answered with.
    """
    return jsonify(OrgsApi.get_history(org_id, authenticated_email(), request.args.get("before"))), 200

@app.route('/organizations/<org_id>/default-permissions/<action_id>', methods=['PUT'])
@login_required
def set_organization_default_permission(org_id: str, action_id: str) -> Response:
    """Set the role one row of the organization's default asks, as its owner or an admin
    (E39/F02/S01); markets created from now on copy it. Recorded in the organization's history.

    Body: { "role": "admin" }. Answers the default table.
    """
    data = json_object(required=False)
    table = OrgsApi.set_default_permission(org_id, action_id, data.get("role"), authenticated_email())
    return jsonify({"permissionTable": table}), 200

@app.route('/organizations/<org_id>/default-permissions/<action_id>', methods=['DELETE'])
@login_required
def reset_organization_default_permission(org_id: str, action_id: str) -> Response:
    """Return one row of the organization's default to its built-in default, as its owner or an
    admin (E39/F02/S01). Recorded in the organization's history. Answers the default table."""
    table = OrgsApi.reset_default_permission(org_id, action_id, authenticated_email())
    return jsonify({"permissionTable": table}), 200

@app.route('/organizations/<org_id>/default-permissions', methods=['DELETE'])
@login_required
def reset_organization_default_permissions(org_id: str) -> Response:
    """Return every row of the organization's default to its built-in default, as its owner or an
    admin (E39/F02/S01); one entry in its history. Answers the default table."""
    table = OrgsApi.reset_default_permissions(org_id, authenticated_email())
    return jsonify({"permissionTable": table}), 200

@app.route('/organizations/<org_id>/default-permission-history', methods=['GET'])
@login_required
def get_organization_default_permission_history(org_id: str) -> Response:
    """Every change to the organization's default, newest first (E39/F02/S01). Its owner, admins
    and members read it."""
    entries = OrgsApi.get_default_permission_history(org_id, authenticated_email())
    return jsonify({"entries": entries}), 200

@app.route('/organizations/<org_id>/deletion-preview', methods=['GET'])
@login_required
def organization_deletion_preview(org_id: str) -> Response:
    """What deleting this organization would destroy, and what would refuse it (E20/F04/S01).

    The confirmation dialog's whole content. A COUNT of markets does not let an organizer decide,
    so this names each one: its name, its phase, whether it ran, how many placements it holds and
    the public URL that stops resolving.
    """
    preview = OrgsApi.organization_deletion_preview(org_id, authenticated_email())
    return jsonify(convert_keys_to_camel_case(preview)), 200


@app.route('/organizations/<org_id>', methods=['DELETE'])
@login_required
def delete_organization(org_id: str) -> Response:
    """Delete an organization, and the drafts and archived markets it holds. Only owner can delete.

    Refused while it holds a market that is mid-lifecycle, and the refusal NAMES them: "you cannot
    delete this" without saying which market is a refusal an organizer can only answer by guessing.
    That refusal is ``OrganizationHasLiveMarkets``, a 409 whose body carries the blocking markets.
    """
    result = OrgsApi.delete_organization(org_id, authenticated_email())
    if result.deleted_count == 0:
        return jsonify({"error": "Organization not found"}), 404
    return jsonify({"message": "Organization deleted successfully"}), 200

@app.route('/organizations/<org_id>/admins', methods=['POST'])
@login_required
def add_org_admin(org_id: str) -> Response:
    """Add an admin to an organization. Only owner can add admins."""
    data = json_object(required=True)

    user_email = string_field(data, 'user_email')
    if not user_email:
        return jsonify({"error": "user_email required"}), 400

    OrgsApi.add_org_admin(org_id, user_email, authenticated_email())
    return jsonify({"message": "Admin added successfully"}), 200

@app.route('/organizations/<org_id>/members', methods=['POST'])
@login_required
def add_org_member(org_id: str) -> Response:
    """Add a member to an organization. Owner or admin can add members."""
    data = json_object(required=True)

    user_email = string_field(data, 'user_email')
    if not user_email:
        return jsonify({"error": "user_email required"}), 400

    OrgsApi.add_org_member(org_id, user_email, authenticated_email())
    return jsonify({"message": "Member added successfully"}), 200

@app.route('/organizations/<org_id>/users/<user_id>', methods=['DELETE'])
@login_required
def remove_org_user(org_id: str, user_id: str) -> Response:
    """Remove a user from an organization."""
    OrgsApi.remove_org_user(org_id, user_id, authenticated_email())
    return jsonify({"message": "User removed successfully"}), 200

@app.route('/organizations/<org_id>/users/<user_id>', methods=['PUT'])
@login_required
def change_org_place(org_id: str, user_id: str) -> Response:
    """Make an admin of an organization a member, or a member an admin: the owner's to do. The body
    is ``{"place": "admin" | "member"}``."""
    data = json_object(required=True)
    OrgsApi.change_org_place(org_id, user_id, string_field(data, 'place'), authenticated_email())
    return jsonify({"message": "Place changed"}), 200

@app.route('/organizations/<org_id>/transfer', methods=['POST'])
@login_required
def transfer_org_ownership(org_id: str) -> Response:
    """Transfer the organization's ownership to one of its admins or members: its owner's to do.
    The body is ``{"new_owner_email": "<address>"}``."""
    data = json_object(required=True)

    new_owner_email = string_field(data, 'new_owner_email')
    if not new_owner_email:
        return jsonify({"error": "new_owner_email required"}), 400

    OrgsApi.transfer_org_ownership(org_id, authenticated_email(), new_owner_email)
    return jsonify({"message": "Ownership transferred successfully"}), 200

# Market role management

def _named_market_role(name: str) -> Optional[MarketRole]:
    """The market role a request names, in any case, or None when it names none."""
    return next((role for role in MarketRole if role.value == name.lower()), None)

@app.route('/markets/<market_id>/roles', methods=['POST'])
@login_required
def add_market_role(market_id: str) -> Response:
    """Add a user role to a market."""
    data = json_object(required=True)

    user_email = string_field(data, 'user_email')
    role_str = string_field(data, 'role')
    if not user_email or not role_str:
        return jsonify({"error": "user_email and role required"}), 400

    role = _named_market_role(role_str)
    if role is None:
        return jsonify({"error": f"Invalid role: {role_str}"}), 400

    MarketsApi.add_market_role(market_id, user_email, role, authenticated_email())
    return jsonify({"message": "Role added successfully"}), 200

@app.route('/markets/<market_id>/roles/<user_id>', methods=['DELETE'])
@login_required
def remove_market_role(market_id: str, user_id: str) -> Response:
    """Remove a user role from a market."""
    MarketsApi.remove_market_role(market_id, user_id, authenticated_email())
    return jsonify({"message": "Role removed successfully"}), 200

@app.route('/markets/<market_id>/roles/<user_id>', methods=['PUT'])
@login_required
def update_market_role(market_id: str, user_id: str) -> Response:
    """Update a user's role in a market."""
    data = json_object(required=True)

    role_str = string_field(data, 'role')
    if not role_str:
        return jsonify({"error": "role required"}), 400

    role = _named_market_role(role_str)
    if role is None:
        return jsonify({"error": f"Invalid role: {role_str}"}), 400

    if not MarketsApi.update_market_role(market_id, user_id, role, authenticated_email()):
        return jsonify({"error": "Failed to update role"}), 400
    return jsonify({"message": "Role updated successfully"}), 200

#: Said of a transfer of ownership that names no one to transfer it to.
CHOOSE_WHO_TO_TRANSFER_TO = "Choose who to transfer ownership to."

@app.route('/markets/<market_id>/hand-on', methods=['POST'])
@login_required
def hand_on_market(market_id: str) -> Response:
    """Transfer the market's ownership (T283): body ``{"userId": "<id>"}``, someone with access,
    who becomes its Owner while the requester, its Owner, stays on it as an Admin. Answers the
    market as the market read serves it to the requester now."""
    user_id = string_field(json_object(required=False), 'userId')
    if not user_id:
        return jsonify({"error": CHOOSE_WHO_TO_TRANSFER_TO}), 400
    requester = authenticated_email()
    MarketsApi.hand_on_market(market_id, user_id, requester)
    return jsonify({"market": MarketsApi.get_market_for_user(requester, market_id)}), 200

# source data

@app.route('/markets/<market_id>', methods=['GET'])
@login_required
def get_market(market_id: str) -> Response:
    """Get a market by its ID. Uses permission checks."""
    user_email = authenticated_email()

    # Check that user exists
    user = UsersApi.get_user(user_email)
    if not user:
        return jsonify({"error": "User not found"}), 404

    market = MarketsApi.get_market_for_user(user_email, market_id)
    if market:
        return jsonify({"market": market}), 200
    return jsonify({"error": "Market not found or access denied"}), 404

@app.route('/markets', methods=['GET'])
@login_required
def get_markets_by_owner_email() -> Response:
    """Get all markets for user (via explicit role or organization)."""
    user_email = authenticated_email()

    user = UsersApi.get_user(user_email)
    if not user:
        return jsonify({"error": "User not found"}), 404

    markets = MarketsApi.get_markets_for_user(user_email)
    return jsonify({"markets": markets}), 200

@app.route('/markets', methods=['POST'])
@login_required
def create_market() -> Response:
    """Create a new market.

    Every market belongs to an organization: the payload must carry an
    `organizationId` that names an existing organization the requesting user
    owns or belongs to (as admin or member). A missing, unknown, or
    non-member organization is rejected with 400, and a body the model refuses is rejected with
    400 naming each field it refused.
    """
    data = json_object(required=True)

    owner_email = authenticated_email()
    owner = UsersApi.get_user(owner_email)
    if not owner:
        return jsonify({"error": "Owner not found"}), 404

    market_id = MarketsApi.create_owned_market(owner, convert_keys_to_snake_case(data))

    return jsonify({
        "message": "Market created successfully",
        "market_id": market_id
    }), 201

@app.route('/markets/<market_id>/name', methods=['PUT'])
@login_required
def rename_market(market_id: str) -> Response:
    """Rename a market while it is a draft (E21/F03/S04). Body: { "name": "..." }."""
    data = json_object(required=False)
    MarketsApi.rename_market(market_id, string_field(data, "name") or "", authenticated_email())
    return jsonify({"message": "Market renamed"}), 200


@app.route('/markets/<market_id>/plan', methods=['PUT'])
@login_required
def save_plan(market_id: str) -> Response:
    """Write the market plan, and while it is a draft how vendors reach it (E21/F03/S02).

    Body: { "setupObject": {...}, "intakeMode": "csv" | "form", "planRevision": <int> }. Anything
    else is refused by name: the plan's autosave sends what the plan owns, not the whole market.
    ``planRevision`` is the revision the page's copy of the plan was read at (the market read
    serves it); a copy older than the stored plan, or a body naming none, is refused with the 409
    ``MarketChanged``. The answer carries the revision now stored, for the next save.
    """
    data = json_object(required=True)
    revision = MarketsApi.save_plan(market_id, data, authenticated_email())
    return jsonify({"message": "Plan saved", "planRevision": revision}), 200


@app.route('/markets/<market_id>/table-types', methods=['PUT'])
@login_required
def save_table_types(market_id: str) -> Response:
    """Replace the market's table types, which size a layout's tables (T257).

    Body: { "tableTypes": [{ "id", "name", "widthMm", "depthMm" }, ...] }. Answers the types as
    stored. A type tables use is not taken away, and the types settle on leaving draft.
    """
    data = json_object(required=False)
    table_types = LayoutsApi.save_table_types(market_id, data, authenticated_email())
    return jsonify({"tableTypes": table_types}), 200


@app.route('/markets/<market_id>/discord/authorization', methods=['POST'])
@login_required
def start_discord_connection(market_id: str) -> Response:
    """Begin connecting the market to a Discord server (E46/F01/S02): the address of Discord's
    approval screen, which sends the person back to the app's ``/discord/connected``. Asks
    ``Actions.CONNECT_DISCORD``."""
    return jsonify(DiscordConnectionApi.start(market_id, authenticated_email())), 200


@app.route('/markets/<market_id>/discord/connection', methods=['POST'])
@login_required
def connect_discord(market_id: str) -> Response:
    """Finish connecting, from the page Discord sent the person back to. Body: { "code", "state" }.
    Asks ``Actions.CONNECT_DISCORD``."""
    data = json_object(required=True)
    DiscordConnectionApi.connect(
        market_id, string_field(data, "code"), string_field(data, "state"), authenticated_email())
    return jsonify({"marketId": market_id}), 200


@app.route('/markets/<market_id>/discord/connection', methods=['DELETE'])
@login_required
def disconnect_discord(market_id: str) -> Response:
    """Forget the market's Discord server. Asks ``Actions.CONNECT_DISCORD``."""
    DiscordConnectionApi.disconnect(market_id, authenticated_email())
    return jsonify({"message": "Disconnected"}), 200


@app.route('/markets/<market_id>/discord', methods=['PUT'])
@login_required
def save_discord(market_id: str) -> Response:
    """Change the Discord card's choices. Body: any of { "roleId", "usernameQuestion",
    "inviteLink" }, each a string or null. Asks ``Actions.CONNECT_DISCORD``."""
    DiscordConnectionApi.save(market_id, json_object(required=True), authenticated_email())
    return jsonify({"message": "Saved"}), 200


@app.route('/markets/<market_id>/discord/roles', methods=['GET'])
@login_required
def discord_roles(market_id: str) -> Response:
    """The connected server's roles, for the Discord card. Asks ``Actions.CONNECT_DISCORD``."""
    return jsonify({"roles": DiscordConnectionApi.roles(market_id, authenticated_email())}), 200


@app.route('/markets/<market_id>/discord/check', methods=['POST'])
@login_required
def check_discord(market_id: str) -> Response:
    """Read who is in the connected server and keep each vendor's state (E46/F01/S03): answers
    how many are in each, and when. Asks ``Actions.CONNECT_DISCORD``."""
    return jsonify(DiscordConnectionApi.check(market_id, authenticated_email())), 200


@app.route('/markets/<market_id>/discord/role-run', methods=['POST'])
@login_required
def give_discord_roles(market_id: str) -> Response:
    """Give the market's role to every assigned vendor in the server (E46/F01/S04), never taking
    one away: answers how many ended in each outcome, and when. Asks ``Actions.CONNECT_DISCORD``."""
    return jsonify(DiscordConnectionApi.give_roles(market_id, authenticated_email())), 200


@app.route('/markets/<market_id>/discord/possible-matches/<application_id>/declined',
           methods=['POST'])
@login_required
def decline_discord_match(market_id: str, application_id: str) -> Response:
    """A member the check offered as a possible match is not this vendor (E46/F01/S05). Body:
    { "username" }. Asks ``Actions.UPDATE_VENDOR_INFO``, as confirming one, an update of the
    vendor's answer, does."""
    DiscordConnectionApi.decline_match(
        market_id, application_id, json_object(required=True), authenticated_email())
    return jsonify({"message": "Declined"}), 200


@app.route('/markets/<market_id>/vendor-notes', methods=['GET'])
@login_required
def get_vendor_notes(market_id: str) -> Response:
    """The organizer's notes on this market's vendors, by address (E31/F04)."""
    return jsonify({"notes": MarketsApi.get_vendor_notes(market_id, authenticated_email())}), 200


@app.route('/markets/<market_id>/vendor-notes/<path:vendor_email>', methods=['PUT'])
@login_required
def save_vendor_note(market_id: str, vendor_email: str) -> Response:
    """Replace the organizer's note on one vendor. Body: { "note": "Promised an extra chair" }"""
    data = json_object(required=False)
    if not isinstance(data.get("note"), str):
        return jsonify({"error": "note is required"}), 400
    MarketsApi.save_vendor_note(market_id, vendor_email, data["note"], authenticated_email())
    return jsonify({"message": "Note saved"}), 200


@app.route('/markets/<market_id>/vendor-notes/<path:vendor_email>/request-handled', methods=['PUT'])
@login_required
def mark_vendor_request_handled(market_id: str, vendor_email: str) -> Response:
    """Mark a vendor's request handled, or take the mark back. Body: { "handled": true }"""
    data = json_object(required=False)
    if not isinstance(data.get("handled"), bool):
        return jsonify({"error": "handled is required"}), 400
    MarketsApi.mark_vendor_request_handled(
        market_id, vendor_email, data["handled"], authenticated_email())
    return jsonify({"message": "Saved"}), 200


@app.route('/markets/<market_id>/payments', methods=['GET'])
@login_required
def get_market_payments(market_id: str) -> Response:
    """The Payments page (E44/F02/S01): every vendor with a line or a payment, and the market's
    totals, by tier and by date. Asks ``Actions.READ``."""
    return jsonify(PaymentsApi.market_payments(market_id, authenticated_email())), 200


@app.route('/markets/<market_id>/payments/<path:vendor_email>', methods=['GET'])
@login_required
def get_vendor_account(market_id: str, vendor_email: str) -> Response:
    """What one vendor owes for each table-day, and the payments recorded (E44/F01/S01). Asks
    ``Actions.READ``."""
    return jsonify(PaymentsApi.vendor_account(market_id, vendor_email, authenticated_email())), 200


@app.route('/markets/<market_id>/payments/<path:vendor_email>', methods=['POST'])
@login_required
def record_payment(market_id: str, vendor_email: str) -> Response:
    """Record one payment a vendor made, and answer their account. Asks
    ``Actions.RECORD_PAYMENT``.

    Body: { "cents": 3500, "method": "e-transfer", "paidOn": "2026-11-01", "note": "",
    "requestKey": "<the press's UUID>" }; a repeat of the key records nothing new (T270).
    """
    data = json_object(required=True)
    return jsonify(PaymentsApi.record_payment(
        market_id, vendor_email, data, authenticated_email())), 200


@app.route('/markets/<market_id>/payments/<path:vendor_email>/refunds', methods=['POST'])
@login_required
def record_refund(market_id: str, vendor_email: str) -> Response:
    """Record money given back to a vendor, kept as a negative entry (E44/F01/S02). Asks
    ``Actions.ADJUST_PAID``. Body: as a payment's."""
    data = json_object(required=True)
    return jsonify(PaymentsApi.record_refund(
        market_id, vendor_email, data, authenticated_email())), 200


@app.route('/markets/<market_id>/payments/<path:vendor_email>/owed/<date>', methods=['PUT'])
@login_required
def set_amount_owed(market_id: str, vendor_email: str, date: str) -> Response:
    """Set what a vendor owes for one table-day. Asks ``Actions.CHANGE_OWED``.

    Body: { "cents": 0 }, $0 being how a fee is waived.
    """
    data = json_object(required=True)
    return jsonify(PaymentsApi.set_amount_owed(
        market_id, vendor_email, date, data, authenticated_email())), 200


@app.route('/markets/<market_id>/payments/<path:vendor_email>/owed/<date>', methods=['DELETE'])
@login_required
def use_calculated_price(market_id: str, vendor_email: str, date: str) -> Response:
    """Take back an amount set by hand: the table-day owes its calculated price again. Asks
    ``Actions.CHANGE_OWED``."""
    return jsonify(PaymentsApi.use_calculated_price(
        market_id, vendor_email, date, authenticated_email())), 200


@app.route('/markets/<market_id>/payment-entries/<payment_id>', methods=['PUT'])
@login_required
def edit_payment(market_id: str, payment_id: str) -> Response:
    """Change a payment or a refund, kept with what it read before. Asks
    ``Actions.ADJUST_PAID``. Body: as a payment's."""
    data = json_object(required=True)
    return jsonify(PaymentsApi.edit_payment(
        market_id, payment_id, data, authenticated_email())), 200


@app.route('/markets/<market_id>/payment-entries/<payment_id>', methods=['DELETE'])
@login_required
def remove_payment(market_id: str, payment_id: str) -> Response:
    """Take a payment or a refund out of the amount paid, kept and marked removed. Asks
    ``Actions.ADJUST_PAID``."""
    return jsonify(PaymentsApi.remove_payment(market_id, payment_id, authenticated_email())), 200


@app.route('/markets/<market_id>/review-highlights', methods=['PUT'])
@login_required
def save_review_highlights(market_id: str) -> Response:
    """Set which answers a reviewer reads first (E19/F03/S01).

    The only writer of the field. A reviewer changes these mid-queue, which is why there is one
    writer and no market-wide write that could carry a stale list back over it.

    Body: { "keys": ["business_name", "essential_available_dates"] }, or
    { "keys": [], "nothingLeadsTheCard": true } to decide that nothing leads the card (T206).
    Answers { "reviewHighlights", "nothingLeadsTheCard" } as stored.

    Deliberately NOT gated on the application-form lock: an organizer learns which answers they
    needed while reviewing, which is after that lock closes.
    """
    data = json_object(required=False)
    keys = data.get("keys")
    if not isinstance(keys, list) or not all(isinstance(key, str) for key in keys):
        return jsonify({"error": "keys is required"}), 400
    nothing_leads = data.get("nothingLeadsTheCard", False)
    if not isinstance(nothing_leads, bool):
        return jsonify({"error": "nothingLeadsTheCard is true or false."}), 400

    stored = MarketsApi.save_review_highlights(
        market_id, keys, authenticated_email(), nothing_leads_the_card=nothing_leads)
    return jsonify(stored), 200


@app.route('/markets/<market_id>/permissions/<action_id>', methods=['PUT'])
@login_required
def set_market_permission(market_id: str, action_id: str) -> Response:
    """Set the role one row of the market's table asks, as its owner (E39/F01/S03). Asks
    ``Actions.CHANGE_THE_TABLE``; recorded in the market's history.

    Body: { "role": "admin" }. Answers the market's table.
    """
    data = json_object(required=False)
    table = MarketsApi.set_permission(market_id, action_id, data.get("role"), authenticated_email())
    return jsonify({"permissionTable": table}), 200


@app.route('/markets/<market_id>/permissions/<action_id>', methods=['DELETE'])
@login_required
def reset_market_permission(market_id: str, action_id: str) -> Response:
    """Return one row of the market's table to its built-in default, as its owner (E39/F01/S03).
    Asks ``Actions.CHANGE_THE_TABLE``; recorded in the market's history. Answers the table."""
    table = MarketsApi.reset_permission(market_id, action_id, authenticated_email())
    return jsonify({"permissionTable": table}), 200


@app.route('/markets/<market_id>/permissions', methods=['DELETE'])
@login_required
def reset_market_permissions(market_id: str) -> Response:
    """Return every row of the market's table to its built-in default, as its owner (E39/F01/S04).
    Asks ``Actions.CHANGE_THE_TABLE``; one entry in the market's history. Answers the table."""
    table = MarketsApi.reset_permissions(market_id, authenticated_email())
    return jsonify({"permissionTable": table}), 200


@app.route('/markets/<market_id>/permissions/organization-default', methods=['POST'])
@login_required
def copy_market_organization_default(market_id: str) -> Response:
    """Replace the market's table with its organization's default as it is now, as its owner
    (E39/F02/S01). Asks ``Actions.CHANGE_THE_TABLE``; one entry in the market's history. Answers
    the table."""
    table = MarketsApi.copy_organization_default(market_id, authenticated_email())
    return jsonify({"permissionTable": table}), 200


@app.route('/markets/<market_id>/permission-history', methods=['GET'])
@login_required
def get_market_permission_history(market_id: str) -> Response:
    """Every change to the market's table, newest first (E39/F01/S03). Asks ``Actions.READ_HISTORY``."""
    entries = MarketsApi.get_permission_history(market_id, authenticated_email())
    return jsonify({"entries": entries}), 200


@app.route('/markets/<market_id>/rejection-rules', methods=['PUT'])
@login_required
def save_rejection_rules(market_id: str) -> Response:
    """Set which answers reject an application automatically (E33/F03/S01).

    Body: { "rules": [{ "key": "no_shows", "answers": ["not ticked"] }] }, or
    { "rules": [], "noAutomaticRejections": true } to decide that none rejects (T206). Answers
    { "rejectionRules", "noAutomaticRejections" } as stored.

    The only writer of the field. Refused, in words, for a rule a question cannot carry, and while
    the review is closed.
    """
    data = json_object(required=False)
    if "rules" not in data:
        return jsonify({"error": "rules is required"}), 400
    no_rejections = data.get("noAutomaticRejections", False)
    if not isinstance(no_rejections, bool):
        return jsonify({"error": "noAutomaticRejections is true or false."}), 400
    stored = MarketsApi.save_rejection_rules(
        market_id, data["rules"], authenticated_email(), no_automatic_rejections=no_rejections)
    return jsonify(stored), 200


@app.route('/markets/<market_id>/reviewers', methods=['PUT'])
@login_required
def choose_reviewers(market_id: str) -> Response:
    """Choose who reviews this market's applications, and deal the open ones among them
    (E38/F07/S02).

    Body: { "reviewers": ["sam@example.com", ...] }, the whole team; an empty list removes every
    reviewer. Answers { "reviewTeam": {"reviewers": [{"email", "able"}]}, "dealt": <count> }, or
    409 while another deal holds the market for longer than a choice waits.

    The only writer of the market's reviewers.
    """
    data = json_object(required=False)
    if "reviewers" not in data:
        return jsonify({"error": "reviewers is required"}), 400
    return jsonify(MarketsApi.choose_reviewers(
        market_id, data["reviewers"], authenticated_email())), 200


@app.route('/markets/<market_id>/application-form', methods=['PUT'])
@login_required
def save_application_form(market_id: str) -> Response:
    """Save or update the application form for a market.

    The only writer of the application form on an existing market.
    Only allowed in ``draft`` phase.  Once any application exists for the market
    the form is locked (D9) and further edits are refused.

    Body: the form, and ``formRevision``, the revision the page's copy was read at (the form read
    answers it). A copy older than the stored form, or a body naming none, is refused with the
    409 ``MarketChanged``; the answer carries the revision now stored, for the next save.
    """
    data = json_object(required=True)

    requesting_user = authenticated_email()

    user = UsersApi.get_user(requesting_user)
    if not user:
        return jsonify({"error": "User not found"}), 404

    data = convert_keys_to_snake_case(data)
    result = MarketsApi.save_application_form(market_id, data, requesting_user)

    return jsonify({"message": "Application form saved successfully", **result}), 200


@app.route('/markets/<market_id>/application-form', methods=['GET'])
@login_required
def get_application_form(market_id: str) -> Response:
    """Retrieve the application form for a market."""
    requesting_user = authenticated_email()

    user = UsersApi.get_user(requesting_user)
    if not user:
        return jsonify({"error": "User not found"}), 404

    return jsonify(MarketsApi.get_application_form(market_id, requesting_user)), 200


@app.route('/markets/<market_id>', methods=['DELETE'])
@login_required
def delete_market(market_id: str) -> Response:
    """Delete a market. Only owner can delete."""
    result = MarketsApi.delete_market(market_id, authenticated_email())
    if result.deleted_count > 0:
        return jsonify({"message": "Market deleted successfully"}), 200
    return jsonify({"error": "Market not found"}), 404


def _named_phase(name: Any) -> Optional[MarketPhase]:
    """The phase a request names, or None when it names none."""
    return next((phase for phase in MarketPhase if phase.value == name), None)


@app.route('/markets/<market_id>/transition', methods=['POST'])
@login_required
def transition_market(market_id: str) -> Response:
    """Advance a market to a new lifecycle phase. Evaluates guards server-side.

    Body: { "toPhase": "applications" }

    Returns:
        200 on success with { "phase": "<new_phase>" }
        409 with a camelCase blocker list when preconditions are not met, or
            when the phase changed underneath this request
        400 when the transition is not valid from the current phase
    """
    data = json_object(required=True)

    data = convert_keys_to_snake_case(data)
    to_phase_raw = data.get("to_phase")
    if not to_phase_raw:
        return jsonify({"error": "to_phase is required"}), 400

    to_phase = _named_phase(to_phase_raw)
    if to_phase is None:
        valid = [p.value for p in MarketPhase]
        return jsonify({
            "error": f"Unknown phase: '{to_phase_raw}'. Valid phases: {', '.join(valid)}"
        }), 400

    user_email = authenticated_email()

    if not UsersApi.get_user(user_email):
        return jsonify({"error": "User not found"}), 404

    context = MarketsApi.load_market_context(market_id)
    if context is None:
        return jsonify({"error": "Market not found"}), 404
    if context.market is None:
        return jsonify({"error": "Invalid market data"}), 400

    market = context.market

    refused = Actions.refusal(Actions.MOVE_PHASE, user_email, market, context.organization)
    if refused:
        return jsonify({"error": refused}), 403

    from_phase = market.phase.value
    blockers = MarketsApi.take_move(context, to_phase.value, by=user_email)
    if blockers:
        return jsonify(convert_keys_to_camel_case({
            "error": "preconditions_not_met",
            "current_phase": from_phase,
            "target_phase": to_phase.value,
            "blockers": [b.payload() for b in blockers],
        })), 409

    return jsonify({"phase": to_phase.value}), 200


@app.route('/markets/<market_id>/pending-offers-count', methods=['GET'])
@login_required
def pending_offers_count(market_id: str) -> Response:
    """Return how many applications are still in ``assignment_sent`` - the count of
    offers that will be swept to ``vendor_refused`` when the market advances from
    ``offers`` to ``market_days``.

    Nothing in the front end reads this today (E10/F04/S02). It drove the publish confirmation,
    which asked "how many offers will be refused?" - a question whose answer is always zero,
    because offers are out of MVP scope and nothing ever sets ``assignment_sent``. A dialog
    answering it was answering a question the organizer had never asked, about a feature the
    product does not have; publishing now says what publishing actually does.

    The sweep it counts is real and still happens server-side on that edge, so the count is kept
    for the offers phase rather than deleted with the dialog that misused it.
    """
    user_email = authenticated_email()

    if not UsersApi.get_user(user_email):
        return jsonify({"error": "User not found"}), 404

    context = MarketsApi.load_market_context(market_id)
    if context is None or context.market is None:
        return jsonify({"error": "Market not found"}), 404

    refused = Actions.refusal(Actions.READ, user_email, context.market, context.organization)
    if refused:
        return jsonify({"error": refused}), 403

    count = ApplicationsApi.count_applications_with_status(
        market_id, ApplicationStatus.ASSIGNMENT_SENT.value,
    )

    return jsonify({"count": count}), 200


@app.route('/markets/<market_id>/assignment', methods=['GET'])
@login_required
def get_assigned_market(market_id: str) -> Response:
    """Get an assigned market. Asks ``Actions.READ``."""
    result, status_code = MarketsApi.get_assigned_market(market_id, authenticated_email())
    return jsonify(result), status_code


@app.route('/markets/<market_id>/assignment', methods=['POST'])
@login_required
def run_assignment(market_id: str) -> Response:
    """Run the solver and store what it produced. Asks ``Actions.ASSIGN``.

    The write half of the GET above. The browser used to do this itself, by PUTting the market
    back with the assignment it had just been handed; ``assignmentObject`` is server-owned now,
    so a PUT stores nothing and this is the only way a solver run is kept.
    """
    result, status_code = PlacementsApi.run_assignment(market_id, authenticated_email())
    return jsonify(result), status_code


@app.route('/markets/<market_id>/vendors', methods=['POST'])
@login_required
def add_vendor(market_id: str) -> Response:
    """Add a vendor who never applied (E36/F03/S01). Asks ``Actions.ADD_VENDOR``, in assignment and
    market days.

    Body: { "name": "...", "email": "...", "answers": { question key: answer } }, the answers to
    the form's own questions the price groups read, each required (E43/F01/S03).
    """
    data = json_object(required=True)
    requesting_user = authenticated_email()
    user = UsersApi.get_user(requesting_user)
    adder = MarketPerson(user_id=user.id if user else None, email=requesting_user)
    result, status_code = AddedVendorsApi.add_vendor(market_id, data, adder)
    return jsonify(result), status_code


@app.route('/markets/<market_id>/placements', methods=['PUT'])
@login_required
def write_placement(market_id: str) -> Response:
    """Place one vendor in one seat on one date. Asks ``Actions.ASSIGN``.

    EDITOR by default, the same bar as every other market write: an EDITOR can already rewrite the
    tiers, sections and table counts the whole assignment is computed from.
    """
    data = json_object(required=True)

    result, status_code = PlacementsApi.write_placement(
        market_id, convert_keys_to_snake_case(data), authenticated_email()
    )
    return jsonify(result), status_code


@app.route('/markets/<market_id>/history', methods=['GET'])
@login_required
def get_history(market_id: str) -> Response:
    """One page of every change on the market, newest first, for Manage market's History.
    Asks ``Actions.READ_HISTORY``.

    ``?before=`` is the cursor the last page answered with; ``?actor=``, ``?group=``, ``?vendor=``,
    ``?since=``, ``?until=`` and ``?day=`` narrow it.
    """
    args = {key: request.args.get(key, "")
            for key in ("before", "actor", "group", "vendor", "since", "until", "day")}
    result, status_code = MarketsApi.get_history(market_id, authenticated_email(), args)
    return jsonify(result), status_code


@app.route('/markets/<market_id>/placements/swap', methods=['POST'])
@login_required
def swap_placements(market_id: str) -> Response:
    """Trade two vendors' seats on one date, atomically. Asks ``Actions.ASSIGN``."""
    data = json_object(required=False)
    emails = data.get("emails")
    if not isinstance(emails, list):
        emails = []
    result, status_code = PlacementsApi.swap_placements(
        market_id,
        str(data.get("date") or ""),
        str(emails[0]) if len(emails) > 0 else "",
        str(emails[1]) if len(emails) > 1 else "",
        authenticated_email(),
    )
    return jsonify(result), status_code


@app.route('/markets/<market_id>/placements', methods=['DELETE'])
@login_required
def remove_placement(market_id: str) -> Response:
    """Free the seat one vendor holds on one date. Asks ``Actions.ASSIGN``.

    The counterpart of the PUT above, and the reason no operation displaces an occupant:
    freeing a seat first is safe, and mirrors what an organizer physically does.
    """
    data = json_object(required=False)
    result, status_code = PlacementsApi.remove_placement(
        market_id,
        str(data.get("email") or ""),
        str(data.get("date") or ""),
        authenticated_email(),
        deduct_owed=data.get("deductOwed") is True,
    )
    return jsonify(result), status_code


@app.route('/markets/<market_id>/assignment-statistics', methods=['GET'])
@login_required
def get_assignment_statistics(market_id: str) -> Response:
    """Get assignment statistics derived on-demand. Asks ``Actions.READ``."""
    result, status_code = MarketsApi.get_assignment_statistics(market_id, authenticated_email())
    return jsonify(result), status_code


@app.route('/markets/<market_id>/assignment-csv', methods=['GET'])
@login_required
def get_assignment_csv(market_id: str) -> Response:
    """Download assignment results as a CSV file. Asks ``Actions.EXPORT_CSV``."""
    result, status_code = MarketsApi.get_assignment_csv(market_id, authenticated_email())
    if status_code == 200:
        from flask import make_response
        response = make_response(result["csv_content"])
        response.headers['Content-Type'] = 'text/csv; charset=utf-8'
        response.headers['Content-Disposition'] = f'attachment; filename="{result["filename"]}"'
        return response
    return jsonify(result), status_code


@app.route('/markets/<market_id>/vendor-export', methods=['POST'])
@login_required
def export_vendors(market_id: str) -> Response:
    """Download the market's vendors as a CSV, filtered and with the columns chosen (E42/F01/S01).
    Body: { "filters": {...}, "columns": ["name", "email", ...], "day": "2026-10-29" }. A read,
    sent as a POST for the filters it carries. Asks ``Actions.EXPORT_CSV``."""
    content, filename = VendorExportApi.export(
        market_id, json_object(required=True), authenticated_email())
    response = make_response(content)
    response.headers['Content-Type'] = 'text/csv; charset=utf-8'
    response.headers['Content-Disposition'] = f'attachment; filename="{filename}"'
    return response


@app.route('/markets/<market_id>/vendor-export/preview', methods=['POST'])
@login_required
def preview_vendor_export(market_id: str) -> Response:
    """What the export would hold: its count, header and first rows, and what the market offers to
    filter and export by. Body as ``export_vendors``. Asks ``Actions.EXPORT_CSV``."""
    result, status_code = VendorExportApi.preview(
        market_id, json_object(required=True), authenticated_email())
    return jsonify(result), status_code


@app.route('/markets/<market_id>/tables', methods=['GET'])
@login_required
def get_market_tables(market_id: str) -> Response:
    """Get table-level assignments derived on-demand. Asks ``Actions.READ``."""
    result, status_code = MarketsApi.get_market_tables(market_id, authenticated_email())
    return jsonify(result), status_code


# attendance

@app.route('/public/markets/<market_slug>/vendor/check-in', methods=['POST'])
def vendor_check_in(market_slug: str) -> Response:
    """A signed-in vendor checks in for a date with the market's door code (ADR 0022). Bearer
    token and ``{date, doorCode}``; every try counted against ``check-in:address``, and nothing
    against the caller, so a venue's shared network never refuses a right code (T318)."""
    return VendorCheckInApi.check_in(market_slug)


@app.route('/public/markets/<market_slug>/vendor/check-in', methods=['DELETE'])
def vendor_undo_check_in(market_slug: str) -> Response:
    """A signed-in vendor takes back their own check-in for a date, ``{date}``, no door code."""
    return VendorCheckInApi.undo_check_in(market_slug)


# applicant login - public, unauthenticated, attacker-facing

@app.route('/public/markets/<market_slug>/applicant-login/request-code', methods=['POST'])
def applicant_login_request_code(market_slug: str) -> Response:
    """Request an email login code for an applicant.

    Fully indistinguishable: same response whether or not the address is known
    to this market. The login challenge is created for every request so its
    existence leaks nothing.
    """
    result, status_code = ApplicantAuthApi.request_login_code(market_slug)
    return result, status_code


@app.route('/public/markets/<market_slug>/applicant-login/verify-code', methods=['POST'])
def applicant_login_verify_code(market_slug: str) -> Response:
    """Verify an email login code for an applicant.

    A wrong try at a live code answers "retry"; every other failure collapses to
    one observable "spent" response, so the caller cannot distinguish "no such
    address", "no code issued", "expired", "already consumed" or "tries used up",
    and neither answer says whether the address applied.
    """
    result, status_code = ApplicantAuthApi.verify_login_code(market_slug)
    return result, status_code


@app.route('/public/markets/<market_slug>/applicant-login/resume', methods=['POST'])
def applicant_login_resume(market_slug: str) -> Response:
    """Sign a remembered vendor straight back in, from the market's remember cookie (ADR 0022).

    A live cookie is answered as a right code is; every other way is one 401 that clears it.
    """
    result, status_code = ApplicantAuthApi.resume_sign_in(market_slug)
    return result, status_code


@app.route('/public/markets/<market_slug>/applicant-login/sign-out', methods=['POST'])
def applicant_login_sign_out(market_slug: str) -> Response:
    """End the vendor's remembered sign-in at this market, on the server and the device. 204."""
    result, status_code = ApplicantAuthApi.sign_out(market_slug)
    return result, status_code


# applicant application endpoints - public, JWT-authenticated


@app.route('/public/markets/<market_slug>/vendor-page', methods=['GET'])
def public_get_vendor_page(market_slug: str) -> Response:
    """Public: what a market's vendor page needs before sign-in (ADR 0022). No authentication."""
    result, status_code = ApplicantsApi.get_vendor_page(market_slug)
    return jsonify(result), status_code


@app.route('/public/markets/<market_slug>/application-form', methods=['GET'])
def public_get_application_form(market_slug: str) -> Response:
    """Public: return the market's application form. No authentication required."""
    result, status_code = ApplicantsApi.get_public_application_form(market_slug)
    return jsonify(result), status_code


@app.route('/public/markets/<market_slug>/applicant/application', methods=['GET'])
def public_get_applicant_application(market_slug: str) -> Response:
    """Return the authenticated applicant's application. Bearer token required."""
    token_payload = ApplicantsApi.authenticate_request(
        request.headers.get('Authorization')
    )
    if not token_payload:
        return jsonify({"error": "Authentication required. Your session may have expired. "
                                 "Please sign in again."}), 401

    result, status_code = ApplicantsApi.get_applicant_application(
        market_slug, token_payload,
    )
    return jsonify(result), status_code


@app.route('/public/markets/<market_slug>/applicant/application', methods=['PUT'])
def public_save_applicant_application(market_slug: str) -> Response:
    """Save or update the authenticated applicant's application. Bearer token required."""
    token_payload = ApplicantsApi.authenticate_request(
        request.headers.get('Authorization')
    )
    if not token_payload:
        return jsonify({"error": "Authentication required. Your session may have expired. "
                                 "Please sign in again."}), 401

    data = json_object(required=True)
    form_data = data.get('formData') or data.get('form_data') or {}
    result, status_code = ApplicantsApi.save_applicant_application(
        market_slug, token_payload, form_data,
    )
    return jsonify(result), status_code


# organizer application monitoring and review endpoints


@app.route('/markets/<market_id>/applications', methods=['GET'])
@login_required
def list_market_applications(market_id: str) -> Response:
    """List all applications for a market. Asks ``Actions.READ``."""
    requesting_user = authenticated_email()

    context = MarketsApi.load_market_context(market_id)
    if context is None:
        return jsonify({"error": "Market not found"}), 404
    if context.market is None:
        return jsonify({"error": "Invalid market data"}), 400

    refused = Actions.refusal(Actions.READ, requesting_user, context.market, context.organization)
    if refused:
        return jsonify({"error": refused}), 403

    result, status_code = ApplicantsApi.list_market_applications(market_id)
    return jsonify(result), status_code


@app.route('/markets/<market_id>/stats', methods=['GET'])
@login_required
def get_market_stats(market_id: str) -> Response:
    """The Stats tab's figures: who applied, what they answered, and the placement and money
    headlines. Asks ``Actions.READ``."""
    requesting_user = authenticated_email()

    context = MarketsApi.load_market_context(market_id)
    if context is None:
        return jsonify({"error": "Market not found"}), 404
    if context.market is None:
        return jsonify({"error": "Invalid market data"}), 400

    refused = Actions.refusal(Actions.READ, requesting_user, context.market, context.organization)
    if refused:
        return jsonify({"error": refused}), 403

    return jsonify(MarketStats.stats_for_market(context.market)), 200


def _reviewer_on(market_id: str):
    """The signed-in reviewer as a ``MarketPerson`` and the market's context, once they may give
    verdicts here, or an error response (E34).

    The one gate of every review write - a verdict, a selection's, a follow-up's owner, a claim on a
    card, and an undo of a verdict or a selection's - asked through ``verdict_refusal``, the same
    rules the market read serves as the verdicts row's answer and ``verdictsSettledReason``: the
    table's verdicts row, while the review is open (E36/F01/S01). A verdict and a selection's then
    ask the change row too, of each application they write (``_change_refused``, E38/F06/S01).
    """
    requesting_user = authenticated_email()
    context = MarketsApi.load_market_context(market_id)
    if context is None or context.market is None:
        return None, None, (jsonify({"error": "Market not found"}), 404)
    refusal = MarketsApi.verdict_refusal(requesting_user, context.market, context.organization)
    if refusal:
        return None, None, (jsonify({"error": refusal}), 403)
    user = UsersApi.get_user(requesting_user)
    return MarketPerson(user_id=user.id if user else None, email=requesting_user), context, None


def _change_refused(context: MarketsApi.MarketContext) -> Optional[str]:
    """Why the signed-in reviewer may not change a verdict already given, or None while they may:
    the table's change row (E38/F06/S01), asked on top of ``_reviewer_on``'s. Asked of each
    application at its write, since only its status says whether the write is a change."""
    return Actions.refusal(
        Actions.CHANGE_VERDICTS, authenticated_email(), context.market, context.organization)


def _named_status(name: Any) -> Optional[ApplicationStatus]:
    """The application status a request names, or None when it names none."""
    return next((status for status in ApplicationStatus if status.value == name), None)


@app.route('/markets/<market_id>/applications/<application_id>/review', methods=['PUT'])
@login_required
def review_application(market_id: str, application_id: str) -> Response:
    """Record a review verdict, or a follow-up, on an application, and its giver (E34/F01/S01).

    Body: { "status": "reviewer_approved", "seen": { "status": "open", "verdictAt": null },
            "ownerEmail": "..." }  - ``seen`` and ``ownerEmail`` optional.
    """
    person, context, refused = _reviewer_on(market_id)
    if refused:
        return refused
    data = json_object(required=True)
    status_raw = data.get('status') or data.get('statusRaw')
    if not status_raw:
        return jsonify({"error": "status is required"}), 400
    new_status = _named_status(status_raw)
    if new_status is None:
        return jsonify({"error": f"Invalid status: {status_raw}"}), 400
    # A follow-up is owned by whoever marked it, or by the person named, who must be one of the
    # people the market read offered them (E34/F02/S01, T15).
    owner = None
    if new_status is ApplicationStatus.NEEDS_FOLLOW_UP and data.get('ownerEmail'):
        owner = MarketsApi.follow_up_owner(
            context.market, context.organization, person, data['ownerEmail'])
    result, status_code = ApplicantsApi.review_application(
        market_id, application_id, new_status, by=person.as_giver(), owner=owner,
        seen=ApplicantsApi.seen_from(data.get('seen')), change_refused=_change_refused(context),
    )
    return jsonify(result), status_code


@app.route('/markets/<market_id>/applications/verdicts', methods=['POST'])
@login_required
def review_selection(market_id: str) -> Response:
    """One verdict for a ticked selection (E34/F04/S02).

    Body: { "status": "reviewer_approved",
            "applications": [{ "id": "...", "seen": { "status": "open", "verdictAt": null } }] }
    Answers { "written": [ids], "skipped": [{ "id", "email", "reason" }] }.
    """
    person, context, refused = _reviewer_on(market_id)
    if refused:
        return refused
    data = json_object(required=False)
    new_status = _named_status(data.get('status'))
    if new_status is None:
        return jsonify({"error": f"Invalid status: {data.get('status')}"}), 400
    selection = data.get('applications')
    if not isinstance(selection, list) or not selection:
        return jsonify({"error": "Tick the applications to decide."}), 400
    # A ticked entry that is not an object names no application, and is skipped as not one here.
    ticked = [item if isinstance(item, dict) else {} for item in selection]
    result, status_code = ApplicantsApi.review_selection(
        market_id,
        [(str(item.get('id') or ''), ApplicantsApi.seen_from(item.get('seen'))) for item in ticked],
        new_status, by=person.as_giver(), change_refused=_change_refused(context))
    return jsonify(result), status_code


def _undo_asked(application_id: str, item: Dict[str, Any]) -> ApplicantsApi.UndoAsked:
    """What one undo asks, from its request: the application, and what the reviewer saw once their
    verdict was written. What it returns to is the server's, kept by the verdict, so a request
    names none. Raises ``BadRequestError`` for a request naming no ``seen``."""
    seen = ApplicantsApi.seen_from(item.get('seen'))
    if seen is None:
        raise BadRequestError("Say what the application was once your verdict was written.")
    return application_id, seen


def _owner_offered(context: MarketsApi.MarketContext,
                   person: MarketPerson) -> ApplicantsApi.OwnerOffered:
    """Whether a follow-up an undo brings back may be owned by an address, asked as the review route
    asks of ``ownerEmail``: its owner may have lost their role since the verdict. The undo refuses
    in its own words, so the route's sentences about handing one never reach it."""
    def offered(email: str) -> bool:
        try:
            MarketsApi.follow_up_owner(context.market, context.organization, person, email)
        except BadRequestError:
            return False
        return True
    return offered


@app.route('/markets/<market_id>/applications/<application_id>/review/undo', methods=['POST'])
@login_required
def undo_review(market_id: str, application_id: str) -> Response:
    """Undo the verdict, or the follow-up, the signed-in reviewer just gave (E38/F10/S01).

    Body: { "seen": { "status": "reviewer_rejected", "verdictAt": "..." } }. It returns the
    application to what the verdict found it as, never to what a request names.
    Their own, within ``UNDO_WINDOW``, while they may give verdicts: never the change row.
    """
    person, context, refused = _reviewer_on(market_id)
    if refused:
        return refused
    asked = _undo_asked(application_id, json_object(required=True))
    result, status_code = ApplicantsApi.undo_verdict(
        market_id, asked, by=person.as_giver(), owner_offered=_owner_offered(context, person))
    return jsonify(result), status_code


@app.route('/markets/<market_id>/applications/verdicts/undo', methods=['POST'])
@login_required
def undo_selection(market_id: str) -> Response:
    """Undo what a selection's verdict wrote (E38/F10/S01).

    Body: { "applications": [{ "id", "seen" }] }, each as the single undo's.
    Answers { "written": [ids], "skipped": [{ "id", "email", "reason" }] }.
    """
    person, context, refused = _reviewer_on(market_id)
    if refused:
        return refused
    data = json_object(required=False)
    selection = data.get('applications')
    if not isinstance(selection, list) or not selection:
        return jsonify({"error": "Name the verdicts to undo."}), 400
    asked = []
    for item in selection:
        item = item if isinstance(item, dict) else {}
        asked.append(_undo_asked(str(item.get('id') or ''), item))
    result, status_code = ApplicantsApi.undo_selection(
        market_id, asked, by=person.as_giver(), owner_offered=_owner_offered(context, person))
    return jsonify(result), status_code


@app.route('/markets/<market_id>/review/next', methods=['POST'])
@login_required
def next_for_review(market_id: str) -> Response:
    """The next card to review, claimed for the reviewer (E34/F03/S02).

    Body: { "after": "<the application moved on from>", "includeFollowUps": false,
            "want": "<an application asked for by name, tried first>", "mineOnly": false }
    A chosen reviewer is handed their own share first, and with ``mineOnly`` nothing else
    (E38/F07/S04); for anyone else ``mineOnly`` is ignored.
    Answers { "application": ... } or { "application": null } when every one left is held by
    someone else, or under ``mineOnly`` when their share has nothing left to hand out, with
    ``dealt``, how many applications the deal before it dealt, so a screen reads its list again.
    """
    person, context, refused = _reviewer_on(market_id)
    if refused:
        return refused
    data = json_object(required=False)
    # Applications a deal the host ended left waiting are dealt first, so a chosen reviewer's
    # share holds them; each deal is recorded under the write it arrived by.
    dealt = ReviewTeam.deal_waiting(context.market, context.organization)
    doc = ApplicationsApi.claim_next_for_review(
        market_id, person, data.get('after'), bool(data.get('includeFollowUps')),
        want=data.get('want'), chosen=Actions.is_chosen(person.email, context.market),
        mine_only=data.get('mineOnly') is True)
    return jsonify({"application": ApplicantsApi.organizer_view(doc) if doc else None,
                    "dealt": dealt}), 200


@app.route('/markets/<market_id>/applications/<application_id>/claim', methods=['PUT', 'DELETE'])
@login_required
def hold_for_review(market_id: str, application_id: str) -> Response:
    """Keep holding the open card (PUT, every minute while it stays open) or let it go (DELETE, on
    leaving the review) (E34/F03/S02). PUT answers { "held": false } once someone else has it."""
    person, _context, refused = _reviewer_on(market_id)
    if refused:
        return refused
    doc = ApplicationsApi.find_application_by_id(application_id)
    if doc is None or doc.get("market_id") != market_id:
        return jsonify({"error": "Application not found for this market."}), 404
    if request.method == 'DELETE':
        ApplicationsApi.release_claim(application_id, person)
        return jsonify({"held": False}), 200
    return jsonify({"held": ApplicationsApi.renew_claim(application_id, person)}), 200


@app.route('/markets/<market_id>/applications/<application_id>/follow-up-owner', methods=['PUT'])
@login_required
def reassign_follow_up(market_id: str, application_id: str) -> Response:
    """Hand a follow-up to someone else with a role on the market (E34/F02/S01).

    Body: { "ownerEmail": "sam@market.test" }
    """
    person, context, refused = _reviewer_on(market_id)
    if refused:
        return refused
    data = json_object(required=False)
    owner = MarketsApi.follow_up_owner(
        context.market, context.organization, person, data.get('ownerEmail'))
    result, status_code = ApplicantsApi.reassign_follow_up(
        market_id, application_id, owner, person.email)
    return jsonify(result), status_code


@app.route('/markets/<market_id>/applications/<application_id>/answers', methods=['PUT'])
@login_required
def update_vendor_info(market_id: str, application_id: str) -> Response:
    """Update a vendor's answers, kept beside their own (E41/F01/S01). Asks
    ``Actions.UPDATE_VENDOR_INFO``, and ``Actions.UPDATE_ASSIGNMENT_OR_PRICE_INFO`` for an answer
    the assignment or a price group reads.

    Body: { "answers": { "business_name": "Ember Ceramics" } }. An answer set back to what the
    vendor wrote takes its update away.
    """
    data = json_object(required=True)
    requesting_user = authenticated_email()
    user = UsersApi.get_user(requesting_user)
    updater = MarketPerson(user_id=user.id if user else None, email=requesting_user)
    result, status_code = VendorInfoApi.update_vendor_info(
        market_id, application_id, data.get("answers"), updater)
    return jsonify(result), status_code


class ImportingMarket(NamedTuple):
    """The stored market an import or a start reads, and the organization its check read."""
    document: Dict[str, Any]
    organization: Optional[Organization]


def _importing_market_document(market_id: str, requesting_user: str):
    """The stored market document, once the asker may import applications or start the market
    from a CSV - the table's one row for both (E39/F01/S01).

    Returns ``(ImportingMarket, error_response, status)``; the document is the raw stored one,
    because that is what the essential-offering derivation and the shared write path both read, and
    the organization is the one the check read, for a write that asks another row of it.

    ``requesting_user`` is the session's identity, so it is always present - every caller passes
    ``authenticated_email()`` from behind ``@login_required``.
    """
    context = MarketsApi.load_market_context(market_id)
    if context is None:
        return None, {"error": "Market not found"}, 404
    if context.market is None:
        return None, {"error": "Invalid market data"}, 400
    refused = Actions.refusal(
        Actions.IMPORT_APPLICATIONS, requesting_user, context.market, context.organization)
    if refused:
        return None, {"error": refused}, 403
    # Every caller prepares or makes a write, and an archived market takes none (bug 30).
    archived = MarketsApi.archived_refusal(context.market)
    if archived:
        return None, {"error": archived}, 403

    market_doc = MarketsApi.markets_collection.find_one(live({"id": market_id}))
    if not market_doc:
        return None, {"error": "Market not found"}, 404
    return ImportingMarket(market_doc, context.organization), None, 200


def _import_context(market_id: str, requesting_user: str):
    """Load the market and ask ``Actions.IMPORT_APPLICATIONS`` and the phase for the import
    endpoints."""
    importing, error, status = _importing_market_document(market_id, requesting_user)
    if error:
        return None, error, status
    market_doc = importing.document

    # Enforced here rather than by hiding the entry point: a hidden button is not a rule, and all
    # three import endpoints are reachable directly.
    refusal = CsvImport.import_refusal(market_doc)
    if refusal:
        return None, {"error": refusal, "phase": market_doc.get("phase")}, 409
    return market_doc, None, 200


@app.route('/csv-proposal/typesafe', methods=['GET'])
@login_required
def csv_proposal_typesafe() -> Response:
    """Whether a CSV proposal may consult hosted TypeSafe, so the upload step can say so."""
    return jsonify({"configured": bool(TypeSafe.configured_key())}), 200


@app.route('/markets/<market_id>/csv-proposal', methods=['POST'])
@login_required
def propose_from_csv(market_id: str) -> Response:
    """What a Google Form's responses CSV proposes this draft becomes. Writes nothing and keeps
    nothing: the file is read and let go. Asks ``Actions.IMPORT_APPLICATIONS``, as the import it
    prepares does."""
    importing, error, status_code = _importing_market_document(
        market_id, authenticated_email())
    if error:
        return jsonify(error), status_code

    data = json_object(required=False)
    if not isinstance(data.get('csvContent'), str):
        return jsonify({"error": "csvContent is required"}), 400

    result, status_code = CsvProposal.propose(importing.document, data['csvContent'])
    return jsonify(result), status_code


@app.route('/markets/<market_id>/csv-proposal/confirm', methods=['POST'])
@login_required
def confirm_csv_proposal(market_id: str) -> Response:
    """Write the reviewed proposal: plan facts, form, ceiling and import mapping, in one update,
    or nothing. The file is sent again and not kept. Asks ``Actions.IMPORT_APPLICATIONS``, as the
    proposal does, and ``Actions.ASSIGN`` too when the plan changes the assignment rules, as the
    plan write does."""
    importing, error, status_code = _importing_market_document(
        market_id, authenticated_email())
    if error:
        return jsonify(error), status_code

    data = json_object(required=True)
    result, status_code = CsvStart.confirm(
        importing.document, data, authenticated_email(), importing.organization)
    return jsonify(result), status_code


@app.route('/markets/<market_id>/applications/import/inspect', methods=['POST'])
@login_required
def inspect_application_import(market_id: str) -> Response:
    """Read a CSV's columns and say what they can be mapped to. Writes nothing. Asks
    ``Actions.IMPORT_APPLICATIONS``."""
    market_doc, error, status_code = _import_context(
        market_id, authenticated_email(),
    )
    if error:
        return jsonify(error), status_code

    data = json_object(required=False)
    if not isinstance(data.get('csvContent'), str):
        return jsonify({"error": "csvContent is required"}), 400

    result, status_code = CsvImport.inspect(market_doc, data['csvContent'])
    return jsonify(result), status_code


@app.route('/markets/<market_id>/applications/import/preview', methods=['POST'])
@login_required
def preview_application_import(market_id: str) -> Response:
    """Report cell values that name nothing this market offers. Writes nothing. Asks
    ``Actions.IMPORT_APPLICATIONS``."""
    market_doc, error, status_code = _import_context(
        market_id, authenticated_email(),
    )
    if error:
        return jsonify(error), status_code

    data = json_object(required=False)
    if not isinstance(data.get('csvContent'), str):
        return jsonify({"error": "csvContent is required"}), 400
    mapping = data.get('mapping')
    if not isinstance(mapping, dict):
        return jsonify({"error": "mapping is required"}), 400
    resolutions = data.get('resolutions')
    if resolutions is not None and not isinstance(resolutions, dict):
        return jsonify({"error": "resolutions must be an object"}), 400

    result, status_code = CsvImport.preview_values(
        market_doc, data['csvContent'], mapping, resolutions,
    )
    return jsonify(result), status_code


@app.route('/markets/<market_id>/applications/import', methods=['POST'])
@login_required
def import_applications(market_id: str) -> Response:
    """Import the mapped CSV rows as applications awaiting review. Asks ``Actions.IMPORT_APPLICATIONS``."""
    market_doc, error, status_code = _import_context(
        market_id, authenticated_email(),
    )
    if error:
        return jsonify(error), status_code

    data = json_object(required=False)
    if not isinstance(data.get('csvContent'), str):
        return jsonify({"error": "csvContent is required"}), 400
    mapping = data.get('mapping')
    if not isinstance(mapping, dict):
        return jsonify({"error": "mapping is required"}), 400

    resolutions = data.get('resolutions')
    if resolutions is not None and not isinstance(resolutions, dict):
        return jsonify({"error": "resolutions must be an object"}), 400

    result, status_code = CsvImport.import_applications(
        MarketsApi.markets_collection, market_doc, data['csvContent'], mapping, resolutions,
        by=authenticated_email(),
    )
    if status_code == 200:
        # One entry for the import, with its counts, however many rows it wrote: a run is one entry.
        History.record(market_id, authenticated_email(), Actions.IMPORT_APPLICATIONS,
                       kind=History.IMPORTED, detail=lambda: CsvImport.import_counts(result))
        # Then each row it left open is dealt to the next reviewer in turn (E38/F07/S03), after the
        # import's rules have judged and a first import has taken the market into Review.
        context = MarketsApi.load_market_context(market_id)
        if context is not None and context.market is not None:
            ReviewTeam.deal_arrivals(
                context.market, authenticated_email(), Actions.IMPORT_APPLICATIONS)
        # After the import's last write: a deletion that began after the import read the market
        # has swept, or will sweep, every row written, or this takes them back as a 404.
        MarketDeletion.kept_only_while_live(MarketsApi.markets_collection, market_id)
    return jsonify(result), status_code


@app.route('/markets/<market_id>/publish-results', methods=['POST'])
@login_required
def publish_market_results(market_id: str) -> Response:
    """Publish review results, making verdicts visible to applicants. Asks ``Actions.PUBLISH_RESULTS``."""
    requesting_user = authenticated_email()

    context = MarketsApi.load_market_context(market_id)
    if context is None:
        return jsonify({"error": "Market not found"}), 404
    if context.market is None:
        return jsonify({"error": "Invalid market data"}), 400

    refused = Actions.refusal(
        Actions.PUBLISH_RESULTS, requesting_user, context.market, context.organization)
    if refused:
        return jsonify({"error": refused}), 403
    refusal = MarketsApi.archived_refusal(context.market)
    if refusal:
        return jsonify({"error": refusal}), 403

    result, status_code = ApplicantsApi.publish_results(market_id, requesting_user)
    return jsonify(result), status_code


@app.route('/markets/<market_id>/applications-stopped', methods=['POST'])
@login_required
def set_applications_stopped(market_id: str) -> Response:
    """Stop taking applications, or take them again (E38/F04/S02). Asks the table's Stop taking
    applications row, Admin by default.

    Body: { "stopped": true | false }
    """
    data = json_object(required=True)
    stopped = data.get("stopped")
    if not isinstance(stopped, bool):
        return jsonify({"error": "stopped must be true or false"}), 400

    context = MarketsApi.load_market_context(market_id)
    if context is None:
        return jsonify({"error": "Market not found"}), 404
    if context.market is None:
        return jsonify({"error": "Invalid market data"}), 400
    requesting_user = authenticated_email()
    refused = Actions.refusal(
        Actions.STOP_APPLICATIONS, requesting_user, context.market, context.organization)
    if refused:
        return jsonify({"error": refused}), 403
    # An archived market refuses it in the archived rule's words, as every row it no longer takes.
    archived = MarketsApi.archived_refusal(context.market)
    if archived:
        return jsonify({"error": archived}), 403

    result, status_code = ApplicantsApi.set_applications_stopped(market_id, stopped, requesting_user)
    return jsonify(convert_keys_to_camel_case(result)), status_code


@app.route('/markets/<market_id>/attendance', methods=['GET'])
@login_required
def get_market_attendance(market_id: str) -> Response:
    """Who is expected on each market date and who has come (E29/F01/S01). Asks ``Actions.READ``.

    ``{dates, roster}``: every vendor the stored assignment places, per date, with when they
    checked in and which organizer did it, if one did.
    """
    requesting_user = authenticated_email()

    context = MarketsApi.load_market_context(market_id)
    if context is None:
        return jsonify({"error": "Market not found"}), 404
    if context.market is None:
        return jsonify({"error": "Invalid market data"}), 400

    refused = Actions.refusal(Actions.READ, requesting_user, context.market, context.organization)
    if refused:
        return jsonify({"error": refused}), 403

    market_doc = AttendanceApi.markets_collection.find_one(live({"id": market_id}))
    if not market_doc:
        return jsonify({"error": "Market not found"}), 404
    return jsonify(AttendanceApi.attendance_roster(market_doc)), 200


def _door_write(market_id: str, write) -> Response:
    """An organizer's check-in or its undo: body ``{vendorEmail, date}``, asking
    ``Actions.CHECK_IN`` (E29/F01/S02)."""
    data = json_object(required=False)
    result, status_code = write(
        market_id,
        str(data.get("vendorEmail") or ""),
        str(data.get("date") or ""),
        authenticated_email(),
    )
    return jsonify(result), status_code


@app.route('/markets/<market_id>/attendance', methods=['POST'])
@login_required
def organizer_check_in(market_id: str) -> Response:
    """An organizer checks a vendor in at the door. Asks ``Actions.CHECK_IN``."""
    return _door_write(market_id, DoorApi.check_in)


@app.route('/markets/<market_id>/attendance', methods=['DELETE'])
@login_required
def organizer_undo_check_in(market_id: str) -> Response:
    """An organizer takes back a check-in. Asks ``Actions.CHECK_IN``."""
    return _door_write(market_id, DoorApi.undo_check_in)


@app.route('/markets/<market_id>/door-code', methods=['GET'])
@login_required
def get_door_code(market_id: str) -> Response:
    """The market's door code, ``{code, madeAt, madeBy, url}`` or ``{code: null}`` (ADR 0022).
    Asks ``Actions.CHECK_IN``: no market read serves it."""
    return jsonify(DoorApi.door_code(market_id, authenticated_email())), 200


@app.route('/markets/<market_id>/door-code', methods=['POST'])
@login_required
def make_door_code(market_id: str) -> Response:
    """A new door code, which ends the old one and every poster of it. Asks
    ``Actions.CHECK_IN``; only in Market Days, and never on an archived market."""
    result, status_code = DoorApi.make_door_code(market_id, authenticated_email())
    return jsonify(result), status_code


# misc

def cleanup_sessions() -> None:
    """Clean up expired session files. Only runs for filesystem sessions."""
    if keeps_sessions_on_disk(app):
        now = time.time()
        for session_file in glob.glob(os.path.join(SESSION_FOLDER, "*")):
            if os.stat(session_file).st_mtime < now - UsersApi.SIGN_IN_LIFETIME.total_seconds():
                os.remove(session_file)

cleanup_sessions()

# No `__main__` block: the back end starts with `flask run` (the Dockerfile, docs/STARTUP.md) or is
# imported by Vercel's Python runtime, so the Werkzeug debugger runs only when asked for by name
# (`flask run --debug`).
