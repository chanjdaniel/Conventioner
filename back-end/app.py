# flask run --cert=adhoc > error.log 2>&1
# First, before the imports below build their Mongo clients from it. Nothing reads a *secret* at
# import any more - the three that used to are now read on call, so the boot check answers for the
# environment as it stands rather than for the import order that produced it. See utils.env_file.
from utils.env_file import load_env_file

load_env_file()

import api.users as UsersApi
import api.organizations as OrgsApi
import api.markets as MarketsApi
import api.placements as PlacementsApi
import api.form_amendment as FormAmendmentApi
import csv_import as CsvImport
import api.attendance as AttendanceApi
import api.applications as ApplicationsApi
import api.applicant_auth as ApplicantAuthApi
import api.applicants as ApplicantsApi
import api.permissions as PermissionsApi
from api.floorplans import floorplans_bp
from api.floorplans_placement import floorplans_placement_bp
from api.floorplans_templates import floorplans_templates_bp
from api.floorplans_analysis import floorplans_analysis_bp
from api.floorplans_calibrate import floorplans_calibrate_bp
from api.floorplans_export import floorplans_export_bp
from api.floorplans_save import floorplans_save_bp

from typing import Any, Dict, List, NamedTuple, Optional
from flask import Flask, request, jsonify, Response
from flask_login import LoginManager, login_user, login_required, logout_user, current_user
from flask_bcrypt import Bcrypt
from datetime import timedelta, datetime, timezone
from datatypes import ApplicationStatus, Market, MarketPhase, MarketRole, phase_from_market_document
from assignment.utils import convert_keys_to_camel_case, convert_keys_to_snake_case
from guards import PreconditionResult, VALID_TRANSITIONS, evaluate_transition
from market_documents import (
    MarketKeyMigrationError,
    assert_market_key_migration_recorded,
    market_doc_key,
)
import db_config
from dataclasses import asdict
import json
import os
import glob
import time
import traceback
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
from utils.email import (
    MailerNotConfiguredError,
    assert_mailer_configured,
)
from utils.proxy import (
    TrustedProxyConfigError,
    install_trusted_proxy_fix,
    trusted_proxy_hops,
)
from utils.secret_key import (
    SecretKeyNotConfiguredError,
    signing_secret,
)
from utils.identity import authenticated_email
from utils.session_storage import (
    ON_DISK,
    SESSION_FOLDER,
    SessionStorageNotConfiguredError,
    install_session_storage,
    session_backend,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

SESSION_MAX_AGE = 7200


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
    list; what carries the verification link, the reset link, and the login code - the only ways an
    organizer account is ever reached - is a mail key; what says where that session is kept at all,
    which has no answer that is right for both a container and a serverless function, is
    ``SESSION_TYPE``; and what decides whose address the captcha is actually scored against, when
    something the deployment owns sits in front of Flask, is ``TRUSTED_PROXY_HOPS``.

    Three of the six fail *silently* when unset: the captcha passes everybody, a session cookie
    signed with a key the repository publishes is a session anyone can forge, and a credentialed
    CORS policy with no origin list hands the organizer API to every website an organizer visits.
    The mail key and the session backend are here for the mirror-image reason - unset, the first
    fails *every* registration, reset and OTP with a 500 that names nothing, and the second sends a
    serverless deployment looking for a disk it does not have, failing at import and naming nothing
    either - and a variable whose absence has to be diagnosed one broken deployment at a time
    belongs in the same refusal as the ones whose absence is never diagnosed at all. The hop count
    is the quietest of all: unset behind a proxy, every signup in the world is reported to Google
    as coming from one address, and a reCAPTCHA score is the only place it ever shows. As with the
    market-key migration above, an unknown state is never taken for a safe one: it fails at boot,
    naming the variables, rather than in production, naming nothing.

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
    that forgets cannot.

    Raises:
        PublicEndpointDefenseError: naming every variable that is missing, all at once.
    """
    problems = []
    secret = ""
    origins: List[AllowedOrigin] = []
    sessions = ON_DISK
    hops = 0

    try:
        assert_captcha_configured()
    except CaptchaNotConfiguredError as e:
        problems.append(str(e))

    try:
        assert_mailer_configured()
    except MailerNotConfiguredError as e:
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
            f"are not configured, and not one of them announces itself when unset - each is either "
            f"a defense that quietly stops defending, the mail without which no organizer account "
            f"can be reached at all, the store the session itself is kept in, or the address a "
            f"caller is taken to be at. All of them are named below. See the required production "
            f"environment in docs/RELEASING.md before promoting.",
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
    """Install what the check confirmed: the signing key, the origins it may be spent from, the store
    it is kept in, and the hops a caller's address may be read back through.

    The session store goes on last, because a cookie-only session *is* the signed cookie: the
    interface is built against the app's ``SECRET_KEY``, which the first line here is what puts
    there.
    """
    flask_app.config["SECRET_KEY"] = defenses.signing_secret
    install_cors(flask_app, defenses.origins)
    logger.info(
        "Allowing credentialed browser requests from: %s", describe_origins(defenses.origins),
    )
    install_trusted_proxy_fix(flask_app, defenses.trusted_proxy_hops)
    install_session_storage(flask_app, defenses.session_backend)


app = Flask(__name__)

app.config["SESSION_PERMANENT"] = True
app.config["PERMANENT_SESSION_LIFETIME"] = SESSION_MAX_AGE
app.config["SESSION_COOKIE_NAME"] = "session"
app.config["SESSION_COOKIE_HTTPONLY"] = True
# Not configurable: a SameSite=None cookie is one the browser attaches to cross-site requests, and
# browsers only accept such a cookie when it is also Secure - so an environment variable that could
# turn this off would not "allow plain HTTP", it would ship a session cookie the browser drops, or
# sends in the clear where it does not. Loopback counts as a secure context, so local dev is unaffected.
app.config["SESSION_COOKIE_SECURE"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "None"

configure_public_endpoint_defenses(app, check_public_endpoint_defenses())

app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024  # 50 MB upload limit

bcrypt = Bcrypt(app)
login_manager = LoginManager()
login_manager.init_app(app)
login_manager.session_protection = "strong"

app.register_blueprint(floorplans_bp, url_prefix="/floorplans")
app.register_blueprint(floorplans_placement_bp, url_prefix="/floorplans")
app.register_blueprint(floorplans_templates_bp, url_prefix="/floorplans")
app.register_blueprint(floorplans_analysis_bp, url_prefix="/floorplans")
app.register_blueprint(floorplans_calibrate_bp, url_prefix="/floorplans")
app.register_blueprint(floorplans_export_bp, url_prefix="/floorplans")
app.register_blueprint(floorplans_save_bp, url_prefix="/floorplans")

# users

@login_manager.user_loader
def get_user(email: str) -> Any:
    return UsersApi.get_user(email)



# curl -k -X POST https://127.0.0.1:5000/register-user \
#   -H "Content-Type: application/json" \
#   -d '{"email": "testemail@test.com", "password": "testpassword", "organizations": []}'
@app.route("/register-user", methods=["POST"])
def register_user() -> Response:
    return UsersApi.register_user(bcrypt, request)

@app.route('/login', methods=['POST'])
def login() -> Response:
    return UsersApi.login(bcrypt, login_user, request)

@app.route('/logout', methods=['POST'])
@login_required
def logout() -> Response:
    return UsersApi.logout(logout_user)

@app.route('/check-session', methods=['GET'])
@login_required
def check_session() -> Response:
    return UsersApi.check_session(current_user)

@app.route('/register', methods=['POST'])
def register() -> Response:
    return UsersApi.register_user_with_captcha(bcrypt, request)

@app.route('/verify-email', methods=['POST'])
def verify_email() -> Response:
    return UsersApi.verify_email(request)

@app.route('/resend-verification', methods=['POST'])
def resend_verification() -> Response:
    return UsersApi.resend_verification_email(request)

@app.route('/request-password-reset', methods=['POST'])
def request_password_reset() -> Response:
    return UsersApi.request_password_reset(request)

@app.route('/reset-password', methods=['POST'])
def reset_password() -> Response:
    return UsersApi.reset_password(bcrypt, request)

@app.route('/request-otp', methods=['POST'])
def request_otp() -> Response:
    return UsersApi.request_otp(request)

@app.route('/login-otp', methods=['POST'])
def login_otp() -> Response:
    return UsersApi.login_with_otp(login_user, request)

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
    return UsersApi.delete_user(request, current_user.email)

# organizations

@app.route('/organizations', methods=['GET'])
@login_required
def get_organizations() -> Response:
    """Get all organizations for the current user."""
    try:
        user_email = authenticated_email()
        
        organizations = OrgsApi.get_organizations_for_user(user_email)
        return jsonify({"organizations": organizations}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/organizations', methods=['POST'])
@login_required
def create_organization() -> Response:
    """Create a new organization."""
    try:
        data = request.json
        if not data:
            return jsonify({"error": "No data provided"}), 400
        
        name = data.get('name')
        if not name:
            return jsonify({"error": "Organization name required"}), 400
        
        owner_email = authenticated_email()
        
        org_id = OrgsApi.create_organization(owner_email, name)
        return jsonify({
            "message": "Organization created successfully",
            "organization_id": org_id
        }), 201
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/organizations/<org_id>', methods=['GET'])
@login_required
def get_organization(org_id: str) -> Response:
    """Get an organization by id."""
    try:
        org = OrgsApi.get_organization(org_id)
        if org:
            return jsonify({"organization": org}), 200
        else:
            return jsonify({"error": "Organization not found"}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/organizations/<org_id>', methods=['PUT'])
@login_required
def update_organization(org_id: str) -> Response:
    """Update an organization. Only owner can update."""
    try:
        data = request.json
        if not data:
            return jsonify({"error": "No data provided"}), 400
        
        requesting_user = authenticated_email()
        
        result = OrgsApi.update_organization(org_id, requesting_user, data)
        return jsonify({
            "message": "Organization updated successfully",
            "modified_count": result.modified_count
        }), 200
    except PermissionError as e:
        return jsonify({"error": str(e)}), 403
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/organizations/<org_id>/deletion-preview', methods=['GET'])
@login_required
def organization_deletion_preview(org_id: str) -> Response:
    """What deleting this organization would destroy, and what would refuse it (E20/F04/S01).

    The confirmation dialog's whole content. A COUNT of markets does not let an organizer decide,
    so this names each one: its name, its phase, whether it ran, how many placements it holds and
    the public URL that stops resolving.
    """
    try:
        preview = OrgsApi.organization_deletion_preview(org_id, authenticated_email())
        return jsonify(convert_keys_to_camel_case(preview)), 200
    except PermissionError as e:
        return jsonify({"error": str(e)}), 403
    except ValueError as e:
        return jsonify({"error": str(e)}), 404
    except Exception as e:
        logger.error(f"Error in organization_deletion_preview {org_id}: {e}")
        return jsonify({"error": "Internal server error"}), 500


@app.route('/organizations/<org_id>', methods=['DELETE'])
@login_required
def delete_organization(org_id: str) -> Response:
    """Delete an organization, and the drafts and archived markets it holds. Only owner can delete.

    Refused while it holds a market that is mid-lifecycle, and the refusal NAMES them: "you cannot
    delete this" without saying which market is a refusal an organizer can only answer by guessing.
    """
    try:
        requesting_user = authenticated_email()
        
        result = OrgsApi.delete_organization(org_id, requesting_user)
        if result.deleted_count > 0:
            return jsonify({"message": "Organization deleted successfully"}), 200
        else:
            return jsonify({"error": "Organization not found"}), 404
    except OrgsApi.OrganizationHasLiveMarkets as e:
        return jsonify(convert_keys_to_camel_case({
            "error": "organization_has_live_markets",
            "message": str(e),
            "blocking_markets": e.blocking,
        })), 409
    except PermissionError as e:
        return jsonify({"error": str(e)}), 403
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        logger.error(f"Error in delete_organization {org_id}: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/organizations/<org_id>/admins', methods=['POST'])
@login_required
def add_org_admin(org_id: str) -> Response:
    """Add an admin to an organization. Only owner can add admins."""
    try:
        data = request.json
        if not data:
            return jsonify({"error": "No data provided"}), 400
        
        user_email = data.get('user_email')
        if not user_email:
            return jsonify({"error": "user_email required"}), 400
        
        requesting_user = authenticated_email()
        
        success = OrgsApi.add_org_admin(org_id, user_email, requesting_user)
        if success:
            return jsonify({"message": "Admin added successfully"}), 200
        else:
            return jsonify({"error": "Failed to add admin"}), 400
    except PermissionError as e:
        return jsonify({"error": str(e)}), 403
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/organizations/<org_id>/members', methods=['POST'])
@login_required
def add_org_member(org_id: str) -> Response:
    """Add a member to an organization. Owner or admin can add members."""
    try:
        data = request.json
        if not data:
            return jsonify({"error": "No data provided"}), 400
        
        user_email = data.get('user_email')
        if not user_email:
            return jsonify({"error": "user_email required"}), 400
        
        requesting_user = authenticated_email()
        
        success = OrgsApi.add_org_member(org_id, user_email, requesting_user)
        if success:
            return jsonify({"message": "Member added successfully"}), 200
        else:
            return jsonify({"error": "Failed to add member"}), 400
    except PermissionError as e:
        return jsonify({"error": str(e)}), 403
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/organizations/<org_id>/users/<user_id>', methods=['DELETE'])
@login_required
def remove_org_user(org_id: str, user_id: str) -> Response:
    """Remove a user from an organization."""
    try:
        requesting_user = authenticated_email()
        
        success = OrgsApi.remove_org_user(org_id, user_id, requesting_user)
        if success:
            return jsonify({"message": "User removed successfully"}), 200
        else:
            return jsonify({"error": "Failed to remove user"}), 400
    except PermissionError as e:
        return jsonify({"error": str(e)}), 403
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/organizations/<org_id>/transfer', methods=['POST'])
@login_required
def transfer_org_ownership(org_id: str) -> Response:
    """Transfer organization ownership."""
    try:
        data = request.json
        if not data:
            return jsonify({"error": "No data provided"}), 400
        
        new_owner_email = data.get('new_owner_email')
        if not new_owner_email:
            return jsonify({"error": "new_owner_email required"}), 400
        
        current_owner = authenticated_email()
        
        success = OrgsApi.transfer_org_ownership(org_id, current_owner, new_owner_email)
        if success:
            return jsonify({"message": "Ownership transferred successfully"}), 200
        else:
            return jsonify({"error": "Failed to transfer ownership"}), 400
    except PermissionError as e:
        return jsonify({"error": str(e)}), 403
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# Market role management

@app.route('/markets/<market_id>/roles', methods=['POST'])
@login_required
def add_market_role(market_id: str) -> Response:
    """Add a user role to a market."""
    try:
        data = request.json
        if not data:
            return jsonify({"error": "No data provided"}), 400
        
        user_email = data.get('user_email')
        role_str = data.get('role')
        if not user_email or not role_str:
            return jsonify({"error": "user_email and role required"}), 400
        
        try:
            role = MarketRole(role_str.lower())
        except ValueError:
            return jsonify({"error": f"Invalid role: {role_str}"}), 400
        
        requesting_user = authenticated_email()
        
        success = MarketsApi.add_market_role(market_id, user_email, role, requesting_user)
        if success:
            return jsonify({"message": "Role added successfully"}), 200
        else:
            return jsonify({"error": "Failed to add role"}), 400
    except PermissionError as e:
        return jsonify({"error": str(e)}), 403
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/markets/<market_id>/roles/<user_id>', methods=['DELETE'])
@login_required
def remove_market_role(market_id: str, user_id: str) -> Response:
    """Remove a user role from a market."""
    try:
        requesting_user = authenticated_email()
        
        success = MarketsApi.remove_market_role(market_id, user_id, requesting_user)
        if success:
            return jsonify({"message": "Role removed successfully"}), 200
        else:
            return jsonify({"error": "Failed to remove role"}), 400
    except PermissionError as e:
        return jsonify({"error": str(e)}), 403
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/markets/<market_id>/roles/<user_id>', methods=['PUT'])
@login_required
def update_market_role(market_id: str, user_id: str) -> Response:
    """Update a user's role in a market."""
    try:
        data = request.json
        if not data:
            return jsonify({"error": "No data provided"}), 400
        
        role_str = data.get('role')
        if not role_str:
            return jsonify({"error": "role required"}), 400
        
        try:
            role = MarketRole(role_str.lower())
        except ValueError:
            return jsonify({"error": f"Invalid role: {role_str}"}), 400
        
        requesting_user = authenticated_email()
        
        success = MarketsApi.update_market_role(market_id, user_id, role, requesting_user)
        if success:
            return jsonify({"message": "Role updated successfully"}), 200
        else:
            return jsonify({"error": "Failed to update role"}), 400
    except PermissionError as e:
        return jsonify({"error": str(e)}), 403
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# source data

@app.route('/markets/<market_id>', methods=['GET'])
@login_required
def get_market(market_id: str) -> Response:
    """Get a market by its ID. Uses permission checks."""
    try:
        user_email = authenticated_email()

        # Check that user exists
        user = UsersApi.get_user(user_email)
        if not user:
            return jsonify({"error": "User not found"}), 404

        # Try to find market by name (market_id is actually the name)
        market = MarketsApi.get_market_for_user(user_email, market_id)
        if market:
            return jsonify({"market": market}), 200
        else:
            return jsonify({"error": "Market not found or access denied"}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/markets', methods=['GET'])
@login_required
def get_markets_by_owner_email() -> Response:
    """Get all markets for user (via explicit role or organization)."""
    try:
        user_email = authenticated_email()
        
        user = UsersApi.get_user(user_email)
        if not user:
            return jsonify({"error": "User not found"}), 404
        
        markets = MarketsApi.get_markets_for_user(user_email)
        return jsonify({"markets": markets}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/markets', methods=['POST'])
@login_required
def create_market() -> Response:
    """Create a new market.

    Every market belongs to an organization: the payload must carry an
    `organizationId` that names an existing organization the requesting user
    owns or belongs to (as admin or member). A missing, unknown, or
    non-member organization is rejected with 400.
    """
    try:
        data = request.json
        if not data:
            return jsonify({"error": "No data provided"}), 400
        
        # Validate the market data using Pydantic
        data = convert_keys_to_snake_case(data)
        market = Market(**data)

        owner_email = authenticated_email()

        # Check that owner exists
        owner = UsersApi.get_user(owner_email)
        if not owner:
            return jsonify({"error": "Owner not found"}), 404
        
        # Validate that market has exactly one owner in roles
        roles = market.roles if hasattr(market, 'roles') else {}
        owner_count = sum(1 for role in roles.values() if role == MarketRole.OWNER)
        if owner_count != 1:
            return jsonify({"error": "Market must have exactly one owner in roles dict"}), 400
        
        refusal = MarketsApi.organization_refusal(owner_email, data.get('organization_id'))
        if refusal:
            return jsonify({"error": refusal}), 400
        
        # Create the market
        result, market_id = MarketsApi.create_market(market, owner_email)
        
        return jsonify({
            "message": "Market created successfully",
            "market_id": market_id
        }), 201
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@app.route('/markets/<market_id>/name', methods=['PUT'])
@login_required
def rename_market(market_id: str) -> Response:
    """Rename a market while it is a draft (E21/F03/S04). Body: { "name": "..." }."""
    try:
        data = request.get_json(silent=True) or {}
        MarketsApi.rename_market(market_id, data.get("name", ""), authenticated_email())
        return jsonify({"message": "Market renamed"}), 200
    except MarketsApi.MarketNotFoundError:
        return jsonify({"error": "Market not found"}), 404
    except PermissionError as e:
        return jsonify({"error": str(e)}), 403
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        logger.error(f"Error in rename_market for {market_id}: {str(e)}")
        return jsonify({"error": "Internal server error", "message": str(e)}), 500


@app.route('/markets/<market_id>/plan', methods=['PUT'])
@login_required
def save_plan(market_id: str) -> Response:
    """Write the market plan, and while it is a draft how vendors reach it (E21/F03/S02).

    Body: { "setupObject": {...}, "intakeMode": "csv" | "form" }. Anything else is refused by
    name: the plan's autosave sends what the plan owns, not the whole market.
    """
    try:
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            return jsonify({"error": "A JSON object is required"}), 400
        MarketsApi.save_plan(market_id, data, authenticated_email())
        return jsonify({"message": "Plan saved"}), 200
    except MarketsApi.MarketNotFoundError:
        return jsonify({"error": "Market not found"}), 404
    except PermissionError as e:
        return jsonify({"error": str(e)}), 403
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        logger.error(f"Error in save_plan for {market_id}: {str(e)}")
        return jsonify({"error": "Internal server error", "message": str(e)}), 500


@app.route('/markets/<market_id>/review-highlights', methods=['PUT'])
@login_required
def save_review_highlights(market_id: str) -> Response:
    """Set which answers a reviewer reads first (E19/F03/S01).

    The only writer of the field. A reviewer changes these mid-queue, which is why there is one
    writer and no market-wide write that could carry a stale list back over it.

    Body: { "keys": ["business_name", "essential_available_dates"] }

    Deliberately NOT gated on the application-form lock: an organizer learns which answers they
    needed while reviewing, which is after that lock closes.
    """
    try:
        data = request.get_json(silent=True) or {}
        keys = data.get("keys")
        if keys is None:
            return jsonify({"error": "keys is required"}), 400

        stored = MarketsApi.save_review_highlights(market_id, keys, authenticated_email())
        return jsonify(convert_keys_to_camel_case({"review_highlights": stored})), 200
    except MarketsApi.MarketNotFoundError:
        return jsonify({"error": "Market not found"}), 404
    except PermissionError as e:
        return jsonify({"error": str(e)}), 403
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        logger.error(f"Error in save_review_highlights for {market_id}: {str(e)}")
        return jsonify({"error": "Internal server error", "message": str(e)}), 500


@app.route('/markets/<market_id>/application-form/amendment', methods=['GET'])
@login_required
def application_form_amendment_availability(market_id: str) -> Response:
    """Whether the form can be amended from here, and what the chain would cost (E20/F03/S01).

    The dialog reads this to decide whether to offer itself, so it can say WHY it is unavailable
    rather than opening and then failing - which is the difference between a control that is
    unavailable and one that is broken.
    """
    try:
        context = MarketsApi.load_market_context(market_id)
        if context is None or context.market is None:
            return jsonify({"error": "Market not found"}), 404
        if not PermissionsApi.user_has_permission(
            authenticated_email(), context.market, MarketRole.ADMIN, context.organization
        ):
            return jsonify({"error": "User does not have permission to manage this market"}), 403

        availability = FormAmendmentApi.amendment_availability(context.market)
        pending = context.market.form_amendment
        return jsonify(convert_keys_to_camel_case({
            **availability,
            "pending_return_phase": pending.return_phase if pending else None,
        })), 200
    except Exception as e:
        logger.error(f"Error in application_form_amendment_availability {market_id}: {e}")
        return jsonify({"error": "Internal server error"}), 500


@app.route('/markets/<market_id>/application-form/amendment', methods=['POST'])
@login_required
def amend_application_form(market_id: str) -> Response:
    """Edit the form and return the market to the phase it started in (E20/F03/S01).

    Body: { "applicationForm": { "fields": [...], "unaskedEssentials": [...] } }

    Pre-flight, not rollback: every guard on the return path is checked against the PROPOSED form
    before the market leaves its phase, so a refusal leaves nothing to undo.
    """
    try:
        data = request.get_json(silent=True) or {}
        form_data = data.get("applicationForm") or data.get("application_form")
        if not isinstance(form_data, dict):
            return jsonify({"error": "applicationForm is required"}), 400

        result = FormAmendmentApi.amend_application_form(
            market_id, convert_keys_to_snake_case(form_data), authenticated_email()
        )
        return jsonify(convert_keys_to_camel_case(result)), 200
    except MarketsApi.MarketNotFoundError:
        return jsonify({"error": "Market not found"}), 404
    except PermissionError as e:
        return jsonify({"error": str(e)}), 403
    except FormAmendmentApi.AmendmentUnavailable as e:
        return jsonify({"error": str(e)}), 409
    except FormAmendmentApi.AmendmentRefused as e:
        return jsonify(convert_keys_to_camel_case({
            "error": "preconditions_not_met",
            "message": str(e),
            "blockers": [asdict(b) for b in e.blockers],
        })), 409
    except FormAmendmentApi.AmendmentStalled as e:
        logger.error(f"Form amendment stalled for {market_id}: {e}")
        return jsonify(FormAmendmentApi.stall_payload(e)), 409
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        logger.error(f"Error in amend_application_form {market_id}: {e}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        return jsonify({"error": "Internal server error"}), 500


@app.route('/markets/<market_id>/application-form/amendment/resume', methods=['POST'])
@login_required
def resume_application_form_amendment(market_id: str) -> Response:
    """Finish a chain that stopped partway (E20/F03/S01).

    The offer the stall message makes. Re-plans from where the market actually is, because the
    reason a chain stalls is that the market is no longer where the walk believed.
    """
    try:
        result = FormAmendmentApi.resume_amendment(market_id, authenticated_email())
        return jsonify(convert_keys_to_camel_case(result)), 200
    except MarketsApi.MarketNotFoundError:
        return jsonify({"error": "Market not found"}), 404
    except PermissionError as e:
        return jsonify({"error": str(e)}), 403
    except FormAmendmentApi.AmendmentUnavailable as e:
        return jsonify({"error": str(e)}), 409
    except FormAmendmentApi.AmendmentStalled as e:
        return jsonify(FormAmendmentApi.stall_payload(e)), 409
    except Exception as e:
        logger.error(f"Error in resume_application_form_amendment {market_id}: {e}")
        return jsonify({"error": "Internal server error"}), 500


@app.route('/markets/<market_id>/application-form', methods=['PUT'])
@login_required
def save_application_form(market_id: str) -> Response:
    """Save or update the application form for a market.

    The only writer of the application form on an existing market.
    Only allowed in ``draft`` phase.  Once any application exists for the market
    the form is locked (D9) and further edits are refused.
    """
    try:
        data = request.json
        if not data:
            return jsonify({"error": "No data provided"}), 400

        requesting_user = authenticated_email()

        user = UsersApi.get_user(requesting_user)
        if not user:
            return jsonify({"error": "User not found"}), 404

        data = convert_keys_to_snake_case(data)
        result = MarketsApi.save_application_form(market_id, data, requesting_user)

        return jsonify({
            "message": "Application form saved successfully",
            "application_form": result,
        }), 200

    except MarketsApi.MarketNotFoundError as e:
        return jsonify({"error": str(e)}), 404
    except MarketsApi.ApplicationFormLockedError as e:
        return jsonify({"error": str(e)}), 409
    except PermissionError as e:
        return jsonify({"error": str(e)}), 403
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/markets/<market_id>/application-form', methods=['GET'])
@login_required
def get_application_form(market_id: str) -> Response:
    """Retrieve the application form for a market."""
    try:
        requesting_user = authenticated_email()

        user = UsersApi.get_user(requesting_user)
        if not user:
            return jsonify({"error": "User not found"}), 404

        return jsonify(MarketsApi.get_application_form(market_id, requesting_user)), 200

    except MarketsApi.MarketNotFoundError as e:
        return jsonify({"error": str(e)}), 404
    except PermissionError as e:
        return jsonify({"error": str(e)}), 403
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/markets/<market_id>', methods=['DELETE'])
@login_required
def delete_market(market_id: str) -> Response:
    """Delete a market. Only owner can delete."""
    try:
        requesting_user = authenticated_email()

        result = MarketsApi.delete_market(market_id, requesting_user)
        if result.deleted_count > 0:
            return jsonify({"message": "Market deleted successfully"}), 200
        else:
            return jsonify({"error": "Market not found"}), 404
    except PermissionError as e:
        return jsonify({"error": str(e)}), 403
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/markets/<market_id>/transition', methods=['POST'])
@login_required
def transition_market(market_id: str) -> Response:
    """Advance a market to a new lifecycle phase. Evaluates guards server-side.

    Body: { "toPhase": "applications_open" }

    Returns:
        200 on success with { "phase": "<new_phase>" }
        409 with a camelCase blocker list when preconditions are not met, or
            when the phase changed underneath this request
        400 when the transition is not valid from the current phase
    """
    try:
        data = request.get_json(silent=True)
        if not isinstance(data, dict) or not data:
            return jsonify({"error": "No data provided"}), 400

        data = convert_keys_to_snake_case(data)
        to_phase_raw = data.get("to_phase")
        if not to_phase_raw:
            return jsonify({"error": "to_phase is required"}), 400

        try:
            to_phase = MarketPhase(to_phase_raw)
        except ValueError:
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

        if not PermissionsApi.user_has_permission(
            user_email, market, MarketRole.ADMIN, context.organization
        ):
            return jsonify({
                "error": "User does not have permission to manage this market's phase"
            }), 403

        from_phase = market.phase.value

        if (from_phase, to_phase.value) not in VALID_TRANSITIONS:
            return jsonify({
                "error": (
                    f"Transition from '{from_phase}' to '{to_phase.value}' "
                    "is not available in the current phase."
                ),
            }), 400

        blockers = evaluate_transition(market, to_phase.value, MarketsApi.db)
        if blockers:
            return jsonify(convert_keys_to_camel_case({
                "error": "preconditions_not_met",
                "current_phase": from_phase,
                "target_phase": to_phase.value,
                "blockers": [asdict(b) for b in blockers],
            })), 409

        phase_key = market_doc_key("phase")
        is_draft_key = market_doc_key("is_draft")
        stored_phase = (
            context.document[phase_key] if phase_key in context.document
            else {"$exists": False}
        )
        # One atomic update. A failure between the phase and the stamp would leave a market whose
        # two answers disagree, which is the class of bug migrate_is_draft_consistency exists to
        # repair - and this endpoint is the only writer of either.
        result = MarketsApi.markets_collection.update_one(
            {"id": market_id, phase_key: stored_phase},
            {"$set": {
                phase_key: to_phase.value,
                is_draft_key: to_phase == MarketPhase.DRAFT,
                **MarketsApi.finalization_update(
                    from_phase, to_phase.value, context.document
                ),
            }},
        )

        if result.matched_count == 0:
            latest_doc = MarketsApi.markets_collection.find_one({"id": market_id})
            if latest_doc is None:
                return jsonify({"error": "Market not found"}), 404

            actual_phase = phase_from_market_document(latest_doc).value
            conflict = PreconditionResult(
                id="phase_changed",
                passed=False,
                message=(
                    f"This market moved to the '{actual_phase}' phase while the "
                    f"request was in flight, so it can no longer move to "
                    f"'{to_phase.value}' from '{from_phase}'. "
                    "Reload the market and try again."
                ),
            )
            return jsonify(convert_keys_to_camel_case({
                "error": "phase_changed",
                "current_phase": actual_phase,
                "target_phase": to_phase.value,
                "blockers": [asdict(conflict)],
            })), 409

        # ── Side effects (only after a successful phase write) ────────────
        if from_phase == MarketPhase.OFFERS.value and to_phase == MarketPhase.MARKET_DAYS:
            try:
                swept = ApplicationsApi.sweep_unanswered_offers(market_id)
                logger.info(
                    "Swept %d assignment_sent applications to vendor_refused for market %s",
                    swept,
                    market_id,
                )
            except Exception:
                logger.error(
                    "Phase advanced to market_days for market %s but the "
                    "assignment_sent -> vendor_refused sweep failed",
                    market_id,
                    exc_info=True,
                )

        return jsonify({"phase": to_phase.value}), 200

    except Exception as e:
        logger.error(f"Error in transition_market {market_id}: {str(e)}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        return jsonify({"error": "Internal server error"}), 500


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
    try:
        user_email = authenticated_email()

        if not UsersApi.get_user(user_email):
            return jsonify({"error": "User not found"}), 404

        context = MarketsApi.load_market_context(market_id)
        if context is None or context.market is None:
            return jsonify({"error": "Market not found"}), 404

        if not PermissionsApi.user_has_permission(
            user_email, context.market, MarketRole.VIEWER, context.organization
        ):
            return jsonify({
                "error": "User does not have permission to view this market"
            }), 403

        count = ApplicationsApi.count_applications_with_status(
            market_id, ApplicationStatus.ASSIGNMENT_SENT.value,
        )

        return jsonify({"count": count}), 200

    except Exception as e:
        logger.error(f"Error in pending_offers_count {market_id}: {e}")
        return jsonify({"error": "Internal server error"}), 500


@app.route('/markets/<market_id>/assignment', methods=['GET'])
@login_required
def get_assigned_market(market_id: str) -> Response:
    """Get an assigned market. Requires VIEW permission."""
    try:
        requesting_user = authenticated_email()

        result, status_code = MarketsApi.get_assigned_market(market_id, requesting_user)
        
        return jsonify(result), status_code
    
    except Exception as e:
        # Log the full error with traceback
        logger.error(f"Error in get_assigned_market for {market_id}: {str(e)}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        
        # Return more detailed error information
        return jsonify({
            "error": "Internal server error",
            "message": str(e),
            "endpoint": f"/markets/{market_id}/assignment",
            "timestamp": datetime.now(timezone.utc).isoformat()
        }), 500


@app.route('/markets/<market_id>/assignment', methods=['POST'])
@login_required
def run_assignment(market_id: str) -> Response:
    """Run the solver and store what it produced. Requires EDIT permission.

    The write half of the GET above. The browser used to do this itself, by PUTting the market
    back with the assignment it had just been handed; ``assignmentObject`` is server-owned now,
    so a PUT stores nothing and this is the only way a solver run is kept.
    """
    try:
        result, status_code = PlacementsApi.run_assignment(market_id, authenticated_email())
        return jsonify(result), status_code
    except PlacementsApi.AssignPhaseError as e:
        return jsonify({"error": str(e)}), 409
    except MarketsApi.MarketNotFoundError as e:
        return jsonify({"error": str(e)}), 404
    except PermissionError as e:
        return jsonify({"error": str(e)}), 403
    except Exception as e:
        logger.error(f"Error in run_assignment for {market_id}: {str(e)}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        return jsonify({
            "error": "Internal server error",
            "message": str(e),
            "endpoint": f"/markets/{market_id}/assignment",
            "timestamp": datetime.now(timezone.utc).isoformat()
        }), 500


@app.route('/markets/<market_id>/placements', methods=['PUT'])
@login_required
def write_placement(market_id: str) -> Response:
    """Place one vendor in one seat on one date. Requires EDIT permission.

    The same bar as every other market write: an EDITOR can already rewrite the tiers, sections
    and table counts the whole assignment is computed from.
    """
    try:
        data = request.json
        if not data:
            return jsonify({"error": "No data provided"}), 400

        result, status_code = PlacementsApi.write_placement(
            market_id, convert_keys_to_snake_case(data), authenticated_email()
        )
        return jsonify(result), status_code
    except MarketsApi.MarketNotFoundError as e:
        return jsonify({"error": str(e)}), 404
    except PermissionError as e:
        return jsonify({"error": str(e)}), 403
    except PlacementsApi.SeatTakenError as e:
        return jsonify({"error": str(e)}), 409
    except PlacementsApi.PlacementError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        logger.error(f"Error in write_placement for {market_id}: {str(e)}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        return jsonify({
            "error": "Internal server error",
            "message": str(e),
            "endpoint": f"/markets/{market_id}/placements",
            "timestamp": datetime.now(timezone.utc).isoformat()
        }), 500


@app.route('/markets/<market_id>/placement-history', methods=['GET'])
@login_required
def get_placement_history(market_id: str) -> Response:
    """Who changed a placement, to what, and when. Requires VIEW permission.

    ``?vendor=`` narrows it to the entries about one person, for their detail panel.
    """
    try:
        result, status_code = MarketsApi.get_placement_history(
            market_id, authenticated_email(), request.args.get("vendor"),
        )
        return jsonify(result), status_code
    except Exception as e:
        logger.error(f"Error in get_placement_history for {market_id}: {str(e)}")
        return jsonify({
            "error": "Internal server error",
            "message": str(e),
            "endpoint": f"/markets/{market_id}/placement-history",
            "timestamp": datetime.now(timezone.utc).isoformat()
        }), 500


@app.route('/markets/<market_id>/placements/swap', methods=['POST'])
@login_required
def swap_placements(market_id: str) -> Response:
    """Trade two vendors' seats on one date, atomically. Requires EDIT permission."""
    try:
        data = request.json or {}
        emails = data.get("emails") or []
        result, status_code = PlacementsApi.swap_placements(
            market_id,
            str(data.get("date") or ""),
            str(emails[0]) if len(emails) > 0 else "",
            str(emails[1]) if len(emails) > 1 else "",
            authenticated_email(),
        )
        return jsonify(result), status_code
    except MarketsApi.MarketNotFoundError as e:
        return jsonify({"error": str(e)}), 404
    except PermissionError as e:
        return jsonify({"error": str(e)}), 403
    except PlacementsApi.PlacementError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        logger.error(f"Error in swap_placements for {market_id}: {str(e)}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        return jsonify({
            "error": "Internal server error",
            "message": str(e),
            "endpoint": f"/markets/{market_id}/placements/swap",
            "timestamp": datetime.now(timezone.utc).isoformat()
        }), 500


@app.route('/markets/<market_id>/placements', methods=['DELETE'])
@login_required
def remove_placement(market_id: str) -> Response:
    """Free the seat one vendor holds on one date. Requires EDIT permission.

    The counterpart of the PUT above, and the reason no operation displaces an occupant:
    freeing a seat first is safe, and mirrors what an organizer physically does.
    """
    try:
        data = request.json or {}
        result, status_code = PlacementsApi.remove_placement(
            market_id,
            str(data.get("email") or ""),
            str(data.get("date") or ""),
            authenticated_email(),
        )
        return jsonify(result), status_code
    except MarketsApi.MarketNotFoundError as e:
        return jsonify({"error": str(e)}), 404
    except PermissionError as e:
        return jsonify({"error": str(e)}), 403
    except PlacementsApi.PlacementError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        logger.error(f"Error in remove_placement for {market_id}: {str(e)}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        return jsonify({
            "error": "Internal server error",
            "message": str(e),
            "endpoint": f"/markets/{market_id}/placements",
            "timestamp": datetime.now(timezone.utc).isoformat()
        }), 500


@app.route('/markets/<market_id>/assignment-statistics', methods=['GET'])
@login_required
def get_assignment_statistics(market_id: str) -> Response:
    """Get assignment statistics derived on-demand. Requires VIEW permission."""
    try:
        requesting_user = authenticated_email()

        result, status_code = MarketsApi.get_assignment_statistics(market_id, requesting_user)
        return jsonify(result), status_code

    except Exception as e:
        logger.error(f"Error in get_assignment_statistics for {market_id}: {str(e)}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        return jsonify({
            "error": "Internal server error",
            "message": str(e),
            "endpoint": f"/markets/{market_id}/assignment-statistics",
            "timestamp": datetime.now(timezone.utc).isoformat()
        }), 500


@app.route('/markets/<market_id>/assignment-csv', methods=['GET'])
@login_required
def get_assignment_csv(market_id: str) -> Response:
    """Download assignment results as a CSV file. Requires VIEW permission."""
    try:
        requesting_user = authenticated_email()

        result, status_code = MarketsApi.get_assignment_csv(market_id, requesting_user)
        if status_code == 200:
            from flask import make_response
            response = make_response(result["csv_content"])
            response.headers['Content-Type'] = 'text/csv; charset=utf-8'
            response.headers['Content-Disposition'] = f'attachment; filename="{result["filename"]}"'
            return response
        return jsonify(result), status_code
    except Exception as e:
        logger.error(f"Error in get_assignment_csv for {market_id}: {str(e)}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        return jsonify({
            "error": "Internal server error",
            "message": str(e),
            "endpoint": f"/markets/{market_id}/assignment-csv",
            "timestamp": datetime.now(timezone.utc).isoformat()
        }), 500


@app.route('/markets/<market_id>/tables', methods=['GET'])
@login_required
def get_market_tables(market_id: str) -> Response:
    """Get table-level assignments derived on-demand. Requires VIEW permission."""
    try:
        requesting_user = authenticated_email()

        result, status_code = MarketsApi.get_market_tables(market_id, requesting_user)
        return jsonify(result), status_code
    except Exception as e:
        logger.error(f"Error in get_market_tables for {market_id}: {str(e)}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        return jsonify({
            "error": "Internal server error",
            "message": str(e),
            "endpoint": f"/markets/{market_id}/tables",
            "timestamp": datetime.now(timezone.utc).isoformat()
        }), 500


# attendance

@app.route('/public/markets/<market_slug>/vendors/<path:vendor_email>/assignments', methods=['GET'])
def public_get_vendor_assignments(market_slug: str, vendor_email: str) -> Response:
    """Public vendor assignment lookup by slug + email."""
    try:
        result, status_code = AttendanceApi.get_vendor_assignment_summary(market_slug, vendor_email)
        return jsonify(result), status_code
    except Exception as e:
        logger.error(f"Error in public_get_vendor_assignments {market_slug} {vendor_email}: {e}")
        logger.error(traceback.format_exc())
        return jsonify({"error": "Internal server error"}), 500


@app.route('/public/markets/<market_slug>/check-in', methods=['GET'])
def public_checkin_page(market_slug: str) -> Response:
    """What the check-in page can say before a vendor types anything: which market this is."""
    try:
        result, status_code = AttendanceApi.get_checkin_page(market_slug)
        return jsonify(result), status_code
    except Exception as e:
        logger.error(f"Error in public_checkin_page {market_slug}: {e}")
        logger.error(traceback.format_exc())
        return jsonify({"error": "Internal server error"}), 500


@app.route('/public/markets/<market_slug>/attendance/checkin', methods=['DELETE'])
def public_attendance_undo(market_slug: str) -> Response:
    """Undo a check-in made on the wrong day, by slug + vendor email + date."""
    try:
        data = request.json or {}
        vendor_email = data.get('vendorEmail') or data.get('vendor_email') or ''
        date = data.get('date') or ''

        market_doc = AttendanceApi.get_published_market_by_slug(market_slug)
        if not market_doc:
            return jsonify({"error": "Market not found"}), 404

        result, status_code = AttendanceApi.undo_attendance(
            market_doc.get("id", ""), vendor_email, date,
        )
        return jsonify(result), status_code
    except Exception as e:
        logger.error(f"Error in public_attendance_undo {market_slug}: {e}")
        logger.error(traceback.format_exc())
        return jsonify({"error": "Internal server error"}), 500


@app.route('/public/markets/<market_slug>/attendance/checkin', methods=['POST'])
def public_attendance_checkin(market_slug: str) -> Response:
    """Public attendance check-in by slug + vendor email + date."""
    try:
        data = request.json or {}
        vendor_email = data.get('vendorEmail') or data.get('vendor_email') or ''
        date = data.get('date') or ''

        market_doc = AttendanceApi.get_published_market_by_slug(market_slug)
        if not market_doc:
            return jsonify({"error": "Market not found"}), 404

        result, status_code = AttendanceApi.record_attendance(
            market_doc.get("id", ""), vendor_email, date,
        )
        return jsonify(result), status_code
    except Exception as e:
        logger.error(f"Error in public_attendance_checkin {market_slug}: {e}")
        logger.error(traceback.format_exc())
        return jsonify({"error": "Internal server error"}), 500


# applicant login - public, unauthenticated, attacker-facing

@app.route('/public/markets/<market_slug>/applicant-login/request-code', methods=['POST'])
def applicant_login_request_code(market_slug: str) -> Response:
    """Request an email login code for an applicant.

    Fully indistinguishable: same response whether or not the address is known
    to this market. The login challenge is created for every request so its
    existence leaks nothing.
    """
    try:
        result, status_code = ApplicantAuthApi.request_login_code(market_slug)
        return result, status_code
    except Exception as e:
        logger.error("Error in applicant_login_request_code %s: %s", market_slug, e)
        logger.error(traceback.format_exc())
        return jsonify({"error": "Internal server error"}), 500


@app.route('/public/markets/<market_slug>/applicant-login/verify-code', methods=['POST'])
def applicant_login_verify_code(market_slug: str) -> Response:
    """Verify an email login code for an applicant.

    Fully indistinguishable: every failure branch collapses to one observable
    response. The caller cannot distinguish "no such address", "no code issued",
    "expired", "already consumed", or "wrong code".
    """
    try:
        result, status_code = ApplicantAuthApi.verify_login_code(market_slug)
        return result, status_code
    except Exception as e:
        logger.error("Error in applicant_login_verify_code %s: %s", market_slug, e)
        logger.error(traceback.format_exc())
        return jsonify({"error": "Internal server error"}), 500


# applicant application endpoints - public, JWT-authenticated


@app.route('/public/markets/<market_slug>/application-form', methods=['GET'])
def public_get_application_form(market_slug: str) -> Response:
    """Public: return the market's application form. No authentication required."""
    try:
        result, status_code = ApplicantsApi.get_public_application_form(market_slug)
        return jsonify(result), status_code
    except Exception as e:
        logger.error(f"Error in public_get_application_form {market_slug}: {e}")
        logger.error(traceback.format_exc())
        return jsonify({"error": "Internal server error"}), 500


@app.route('/public/markets/<market_slug>/applicant/application', methods=['GET'])
def public_get_applicant_application(market_slug: str) -> Response:
    """Return the authenticated applicant's application. Bearer token required."""
    try:
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
    except Exception as e:
        logger.error(f"Error in public_get_applicant_application {market_slug}: {e}")
        logger.error(traceback.format_exc())
        return jsonify({"error": "Internal server error"}), 500


@app.route('/public/markets/<market_slug>/applicant/application', methods=['PUT'])
def public_save_applicant_application(market_slug: str) -> Response:
    """Save or update the authenticated applicant's application. Bearer token required."""
    try:
        token_payload = ApplicantsApi.authenticate_request(
            request.headers.get('Authorization')
        )
        if not token_payload:
            return jsonify({"error": "Authentication required. Your session may have expired. "
                                     "Please sign in again."}), 401

        data = request.json or {}
        form_data = data.get('formData') or data.get('form_data') or {}
        result, status_code = ApplicantsApi.save_applicant_application(
            market_slug, token_payload, form_data,
        )
        return jsonify(result), status_code
    except Exception as e:
        logger.error(f"Error in public_save_applicant_application {market_slug}: {e}")
        logger.error(traceback.format_exc())
        return jsonify({"error": "Internal server error"}), 500


# organizer application monitoring and review endpoints


@app.route('/markets/<market_id>/applications', methods=['GET'])
@login_required
def list_market_applications(market_id: str) -> Response:
    """List all applications for a market. Requires VIEWER+ permission."""
    try:
        requesting_user = authenticated_email()

        context = MarketsApi.load_market_context(market_id)
        if context is None:
            return jsonify({"error": "Market not found"}), 404
        if context.market is None:
            return jsonify({"error": "Invalid market data"}), 400

        if not PermissionsApi.user_has_permission(
            requesting_user, context.market, MarketRole.VIEWER, context.organization
        ):
            return jsonify({"error": "User does not have permission to view this market"}), 403

        result, status_code = ApplicantsApi.list_market_applications(market_id)
        return jsonify(result), status_code
    except Exception as e:
        logger.error(f"Error in list_market_applications {market_id}: {e}")
        logger.error(traceback.format_exc())
        return jsonify({"error": "Internal server error"}), 500


@app.route('/markets/<market_id>/applications/<application_id>/review', methods=['PUT'])
@login_required
def review_application(market_id: str, application_id: str) -> Response:
    """Record a review verdict (approved/rejected) on an application. Requires ADMIN+."""
    try:
        requesting_user = authenticated_email()

        context = MarketsApi.load_market_context(market_id)
        if context is None:
            return jsonify({"error": "Market not found"}), 404
        if context.market is None:
            return jsonify({"error": "Invalid market data"}), 400

        if not PermissionsApi.user_has_permission(
            requesting_user, context.market, MarketRole.ADMIN, context.organization
        ):
            return jsonify({"error": "User does not have permission to review applications"}), 403

        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            return jsonify({"error": "No data provided"}), 400

        status_raw = data.get('status') or data.get('statusRaw')
        if not status_raw:
            return jsonify({"error": "status is required"}), 400

        try:
            new_status = ApplicationStatus(status_raw)
        except ValueError:
            return jsonify({"error": f"Invalid status: {status_raw}"}), 400

        result, status_code = ApplicantsApi.review_application(
            market_id, application_id, new_status,
        )
        return jsonify(result), status_code
    except Exception as e:
        logger.error(f"Error in review_application {market_id}/{application_id}: {e}")
        logger.error(traceback.format_exc())
        return jsonify({"error": "Internal server error"}), 500


def _import_context(market_id: str, requesting_user: str):
    """Load the market and check ADMIN for both import endpoints.

    Returns ``(market_doc, error_response, status)``; the market document is the raw stored one,
    because that is what the essential-offering derivation and the shared write path both read.

    ``requesting_user`` is the session's identity, so it is always present - every caller passes
    ``authenticated_email()`` from behind ``@login_required``.
    """
    context = MarketsApi.load_market_context(market_id)
    if context is None:
        return None, {"error": "Market not found"}, 404
    if context.market is None:
        return None, {"error": "Invalid market data"}, 400
    if not PermissionsApi.user_has_permission(
        requesting_user, context.market, MarketRole.ADMIN, context.organization
    ):
        return None, {"error": "User does not have permission to import applications"}, 403

    market_doc = MarketsApi.markets_collection.find_one({"id": market_id})
    if not market_doc:
        return None, {"error": "Market not found"}, 404

    # Enforced here rather than by hiding the entry point: a hidden button is not a rule, and all
    # three import endpoints are reachable directly.
    refusal = CsvImport.import_phase_refusal(market_doc)
    if refusal:
        return None, {"error": refusal, "phase": market_doc.get("phase")}, 409
    return market_doc, None, 200


@app.route('/markets/<market_id>/applications/import/inspect', methods=['POST'])
@login_required
def inspect_application_import(market_id: str) -> Response:
    """Read a CSV's columns and say what they can be mapped to. Writes nothing. Requires ADMIN+."""
    try:
        market_doc, error, status_code = _import_context(
            market_id, authenticated_email(),
        )
        if error:
            return jsonify(error), status_code

        data = request.get_json(silent=True)
        if not isinstance(data, dict) or not isinstance(data.get('csvContent'), str):
            return jsonify({"error": "csvContent is required"}), 400

        result, status_code = CsvImport.inspect(market_doc, data['csvContent'])
        return jsonify(result), status_code
    except Exception as e:
        logger.error(f"Error in inspect_application_import {market_id}: {e}")
        logger.error(traceback.format_exc())
        return jsonify({"error": "Internal server error"}), 500


@app.route('/markets/<market_id>/applications/import/preview', methods=['POST'])
@login_required
def preview_application_import(market_id: str) -> Response:
    """Report cell values that name nothing this market offers. Writes nothing. Requires ADMIN+."""
    try:
        market_doc, error, status_code = _import_context(
            market_id, authenticated_email(),
        )
        if error:
            return jsonify(error), status_code

        data = request.get_json(silent=True)
        if not isinstance(data, dict) or not isinstance(data.get('csvContent'), str):
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
    except Exception as e:
        logger.error(f"Error in preview_application_import {market_id}: {e}")
        logger.error(traceback.format_exc())
        return jsonify({"error": "Internal server error"}), 500


@app.route('/markets/<market_id>/applications/import', methods=['POST'])
@login_required
def import_applications(market_id: str) -> Response:
    """Import the mapped CSV rows as applications awaiting review. Requires ADMIN+."""
    try:
        market_doc, error, status_code = _import_context(
            market_id, authenticated_email(),
        )
        if error:
            return jsonify(error), status_code

        data = request.get_json(silent=True)
        if not isinstance(data, dict) or not isinstance(data.get('csvContent'), str):
            return jsonify({"error": "csvContent is required"}), 400
        mapping = data.get('mapping')
        if not isinstance(mapping, dict):
            return jsonify({"error": "mapping is required"}), 400

        resolutions = data.get('resolutions')
        if resolutions is not None and not isinstance(resolutions, dict):
            return jsonify({"error": "resolutions must be an object"}), 400

        result, status_code = CsvImport.import_applications(
            MarketsApi.markets_collection, market_doc, data['csvContent'], mapping, resolutions,
        )
        return jsonify(result), status_code
    except Exception as e:
        logger.error(f"Error in import_applications {market_id}: {e}")
        logger.error(traceback.format_exc())
        return jsonify({"error": "Internal server error"}), 500


@app.route('/markets/<market_id>/publish-results', methods=['POST'])
@login_required
def publish_market_results(market_id: str) -> Response:
    """Publish review results, making verdicts visible to applicants. Requires ADMIN+."""
    try:
        requesting_user = authenticated_email()

        context = MarketsApi.load_market_context(market_id)
        if context is None:
            return jsonify({"error": "Market not found"}), 404
        if context.market is None:
            return jsonify({"error": "Invalid market data"}), 400

        if not PermissionsApi.user_has_permission(
            requesting_user, context.market, MarketRole.ADMIN, context.organization
        ):
            return jsonify({"error": "User does not have permission to publish results"}), 403

        result, status_code = ApplicantsApi.publish_results(market_id)
        return jsonify(result), status_code
    except Exception as e:
        logger.error(f"Error in publish_market_results {market_id}: {e}")
        logger.error(traceback.format_exc())
        return jsonify({"error": "Internal server error"}), 500


@app.route('/markets/<market_id>/attendance', methods=['GET'])
@login_required
def get_market_attendance(market_id: str) -> Response:
    """Owner-facing attendance status for a market. Requires VIEWER permission."""
    try:
        requesting_user = authenticated_email()

        context = MarketsApi.load_market_context(market_id)
        if context is None:
            return jsonify({"error": "Market not found"}), 404
        if context.market is None:
            return jsonify({"error": "Invalid market data"}), 400

        if not PermissionsApi.user_has_permission(
            requesting_user, context.market, MarketRole.VIEWER, context.organization
        ):
            return jsonify({"error": "User does not have permission to view this market"}), 403

        result, status_code = AttendanceApi.get_attendance_for_market(market_id)
        return jsonify({"attendance": result}), status_code
    except Exception as e:
        logger.error(f"Error in get_market_attendance {market_id}: {e}")
        logger.error(traceback.format_exc())
        return jsonify({"error": "Internal server error"}), 500


# misc

def cleanup_sessions() -> None:
    """Clean up expired session files. Only runs for filesystem sessions."""
    if app.config["SESSION_TYPE"] == ON_DISK:
        now = time.time()
        for session_file in glob.glob(os.path.join(SESSION_FOLDER, "*")):
            if os.stat(session_file).st_mtime < now - SESSION_MAX_AGE:
                os.remove(session_file)

cleanup_sessions()

# Vercel automatically detects Flask apps, but we can export the app instance
# The app instance will be used by Vercel's Python runtime

if __name__ == '__main__':
    app.run(debug=True)
