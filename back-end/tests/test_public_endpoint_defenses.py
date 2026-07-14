"""The boot-time contract this app's public surface rests on, and how it refuses.

Six variables carry endpoints that are unauthenticated, write to the database, send mail from this
domain, and answer the organizer's browser with their session attached. So the process refuses to
start without them - and the refusal has to be one refusal, naming all of them. A check that stopped
at the first would hand an operator one variable per redeploy, which turns one loud failure into
six and invites the last to be met by giving up.

Three of them are defenses, and their absence is never reported anywhere. Two are reported everywhere
and diagnosed nowhere: with no mail key, every registration, reset and OTP answers 500 and none of
them names the variable, and with no session backend a serverless deployment goes looking for a disk
it does not have and fails at import, naming nothing either. The sixth, the trusted-hop count, is
reported nowhere at all - it decides which address organizer signup reports to reCAPTCHA, and behind
a proxy an unset one reports the ingress for every caller in the world. All three kinds belong in the
same refusal, for opposite reasons.

Asking the question must not answer it: the check reads configuration, and installing what it found
is a separate call. flask-cors adds an ``after_request`` handler per invocation, so a check that
configured the app as a side effect left one behind every time it was asked - which is why the test
for that asserts against the module's *own* app object, the one a stray side effect would land on.

And the check is a function of the environment, of nothing else. Every one of the six is read when
it is asked for, so a fixture here says what a deployment holds by setting the variables an operator
would set. Two of them used to be captured into module globals at import, which meant these fixtures
had to name the attribute each module happened to remember its key in - a test speaking a private
language, describing a deployment shape no operator can produce.
"""
import pytest

from conftest import skip_without_real_dependencies

skip_without_real_dependencies()

import app as app_module

from dotenv import dotenv_values
from flask import Flask
from werkzeug.middleware.proxy_fix import ProxyFix

from utils.captcha import RECAPTCHA_SECRET_KEY_VAR
from utils.cors import CORS_ALLOWED_ORIGINS_VAR, LOOPBACK_ORIGINS
from utils.deployment import INSECURE_LOCAL_DEV_VAR
from utils.email import RESEND_API_KEY_VAR, assert_mailer_configured
from utils.env_file import BACK_END_DIR
from utils.proxy import TRUSTED_PROXY_HOPS_VAR
from utils.secret_key import SECRET_KEY_VAR
from utils.session_storage import IN_COOKIE, ON_DISK, SESSION_TYPE_VAR

LOCAL_DEV_TEMPLATE = BACK_END_DIR / ".env.example"

A_REAL_SECRET = "SGDdxXn4YCG4M5pDeUjXTt8g0MSTXNKAtePMxo96b3s"

A_REAL_MAIL_KEY = "re_QYt3bK9wLm2ZpR7vX4nHs6Ja"

ALL_VARS = (
    RECAPTCHA_SECRET_KEY_VAR,
    RESEND_API_KEY_VAR,
    SECRET_KEY_VAR,
    CORS_ALLOWED_ORIGINS_VAR,
    SESSION_TYPE_VAR,
    TRUSTED_PROXY_HOPS_VAR,
)


@pytest.fixture
def deployed(monkeypatch):
    """Anything that has not declared itself a local development machine - every deployment."""
    monkeypatch.delenv(INSECURE_LOCAL_DEV_VAR, raising=False)
    for variable in ALL_VARS:
        monkeypatch.delenv(variable, raising=False)


@pytest.fixture
def configured(deployed, monkeypatch):
    """A deployment that has been told everything the check asks for."""
    monkeypatch.setenv(RECAPTCHA_SECRET_KEY_VAR, "prod-secret")
    monkeypatch.setenv(RESEND_API_KEY_VAR, A_REAL_MAIL_KEY)
    monkeypatch.setenv(SECRET_KEY_VAR, A_REAL_SECRET)
    monkeypatch.setenv(CORS_ALLOWED_ORIGINS_VAR, "https://app.example.com")
    monkeypatch.setenv(SESSION_TYPE_VAR, ON_DISK)
    monkeypatch.setenv(TRUSTED_PROXY_HOPS_VAR, "1")


def test_the_refusal_names_every_missing_variable(deployed):
    with pytest.raises(app_module.PublicEndpointDefenseError) as exc:
        app_module.check_public_endpoint_defenses()

    message = str(exc.value)
    for variable in ALL_VARS:
        assert variable in message, f"{variable} is missing and the operator is not told so"


def test_the_refusal_points_at_the_deploy_documentation(deployed):
    """The contract is new, and an operator promoting `dev` has to be able to find what it wants."""
    with pytest.raises(app_module.PublicEndpointDefenseError) as exc:
        app_module.check_public_endpoint_defenses()

    assert "docs/RELEASING.md" in str(exc.value)


def test_one_missing_variable_is_still_a_refusal(configured, monkeypatch):
    monkeypatch.delenv(CORS_ALLOWED_ORIGINS_VAR, raising=False)

    with pytest.raises(app_module.PublicEndpointDefenseError) as exc:
        app_module.check_public_endpoint_defenses()

    message = str(exc.value)
    assert CORS_ALLOWED_ORIGINS_VAR in message
    assert RECAPTCHA_SECRET_KEY_VAR not in message
    assert RESEND_API_KEY_VAR not in message
    assert SECRET_KEY_VAR not in message
    assert SESSION_TYPE_VAR not in message
    assert TRUSTED_PROXY_HOPS_VAR not in message


def test_a_deployment_that_cannot_send_mail_does_not_serve(configured, monkeypatch):
    """Every route into an organizer account is a piece of mail: verification, reset, OTP.

    With no key, registration rolls the account back and answers 500, and the operator is left to
    infer the variable from a broken signup. It is named here instead, once, before anybody tries.
    """
    monkeypatch.delenv(RESEND_API_KEY_VAR, raising=False)

    with pytest.raises(app_module.PublicEndpointDefenseError) as exc:
        app_module.check_public_endpoint_defenses()

    assert RESEND_API_KEY_VAR in str(exc.value)


def test_a_deployment_that_never_says_what_is_in_front_of_it_does_not_serve(
    configured, monkeypatch,
):
    """Organizer signup reports the caller's address to Google, and reCAPTCHA v3 scores on it.

    Behind an ingress this app has not been told about, that address is the ingress - the same one
    for every signup in the world - and the only place it ever shows is a reCAPTCHA score. Making
    the secret a boot requirement is what puts every deployment on that path, so the hop count is
    named at boot beside it.
    """
    monkeypatch.delenv(TRUSTED_PROXY_HOPS_VAR, raising=False)

    with pytest.raises(app_module.PublicEndpointDefenseError) as exc:
        app_module.check_public_endpoint_defenses()

    assert TRUSTED_PROXY_HOPS_VAR in str(exc.value)


def test_a_deployment_that_never_says_where_sessions_live_does_not_serve(configured, monkeypatch):
    """The default used to be derived from FLASK_ENV, which is `development` in our own image.

    So a serverless deployment got `filesystem`, went looking for a disk that does not survive a
    request, and raised at import - every request a 500, and nothing anywhere naming the variable.
    There is no default now, and the refusal names it.
    """
    monkeypatch.delenv(SESSION_TYPE_VAR, raising=False)

    with pytest.raises(app_module.PublicEndpointDefenseError) as exc:
        app_module.check_public_endpoint_defenses()

    assert SESSION_TYPE_VAR in str(exc.value)


def test_a_session_backend_this_app_cannot_serve_is_refused(configured, monkeypatch):
    """flask-session raises on a backend it does not know, so the alternative is a crash at import."""
    monkeypatch.setenv(SESSION_TYPE_VAR, "redis")

    with pytest.raises(app_module.PublicEndpointDefenseError) as exc:
        app_module.check_public_endpoint_defenses()

    assert SESSION_TYPE_VAR in str(exc.value)


def test_the_serverless_session_backend_is_accepted(configured, monkeypatch):
    """`null` is what Vercel is told to set, and it has to be a value this app actually takes."""
    monkeypatch.setenv(SESSION_TYPE_VAR, IN_COOKIE)

    assert app_module.check_public_endpoint_defenses().session_backend == IN_COOKIE


def test_the_serverless_session_backend_installs_no_server_side_store(configured, monkeypatch):
    """flask-session has no `null` backend - handing it one raises. Flask's own interface signs the
    session into the cookie, which is the only store a serverless function has, so `null` is the
    deployment that installs nothing."""
    monkeypatch.setenv(SESSION_TYPE_VAR, IN_COOKIE)
    app = Flask(__name__)
    default_interface = app.session_interface

    app_module.configure_public_endpoint_defenses(
        app, app_module.check_public_endpoint_defenses(),
    )

    assert app.session_interface is default_interface
    assert "SESSION_FILE_DIR" not in app.config


def test_a_local_development_machine_still_boots_without_a_mail_key(monkeypatch):
    """The escape hatch covers the mail key too: e2e runs with DISABLE_EMAIL and no Resend account."""
    monkeypatch.setenv(INSECURE_LOCAL_DEV_VAR, "true")
    monkeypatch.delenv(RESEND_API_KEY_VAR, raising=False)

    assert_mailer_configured()


def test_a_configured_deployment_boots_and_reports_what_it_found(configured):
    defenses = app_module.check_public_endpoint_defenses()

    assert defenses.signing_secret == A_REAL_SECRET
    assert defenses.origins == ["https://app.example.com"]
    assert defenses.session_backend == ON_DISK
    assert defenses.trusted_proxy_hops == 1


def test_asking_whether_a_deployment_is_configured_does_not_configure_it(configured):
    """The check is a check. It used to install ProxyFix and a flask-cors handler on the module's
    own app object as a side effect, so every caller - the test suite included - stacked another
    handler onto the running app and left the last caller's origin list behind it.

    The app asserted on is therefore ``app_module.app``: the module global a side effect would reach
    for. A throwaway ``Flask(__name__)`` here would pass no matter what the check did to it.
    """
    live = app_module.app
    before = (
        live.wsgi_app,
        live.config["SECRET_KEY"],
        len(live.after_request_funcs.get(None, [])),
        live.session_interface,
    )

    app_module.check_public_endpoint_defenses()
    app_module.check_public_endpoint_defenses()

    assert (
        live.wsgi_app,
        live.config["SECRET_KEY"],
        len(live.after_request_funcs.get(None, [])),
        live.session_interface,
    ) == before


def test_the_local_development_template_boots_as_it_stands(deployed, monkeypatch):
    """`cp .env.example .env` is what STARTUP.md tells a developer to do, and app.py now loads that
    file - so what the template holds is what the boot check reads. It has to pass.

    A blank where a secret goes plus the escape hatch is the shape that boots; a *placeholder* where a
    secret goes is the shape that passes a check keyed on truthiness and then fails at request time,
    which is the whole reason the published values are refused by name. This test is the one thing
    standing between an edit to that template and a developer who cannot start the back end.
    """
    template = dotenv_values(LOCAL_DEV_TEMPLATE)
    for name, value in template.items():
        monkeypatch.setenv(name, value or "")

    defenses = app_module.check_public_endpoint_defenses()

    assert defenses.signing_secret, "an unconfigured dev machine still signs with a real key"
    assert defenses.origins == [LOOPBACK_ORIGINS], (
        "a pinned origin overrides the hatch's loopback pattern, so the browser is refused the "
        "moment Vite lands on another port"
    )
    assert defenses.session_backend == ON_DISK
    assert defenses.trusted_proxy_hops == 0, "nothing sits in front of a laptop"


def test_configuring_is_what_installs_the_policy(configured):
    """The mutation lives in the call named for it, and installs the handler exactly once."""
    app = Flask(__name__)
    defenses = app_module.check_public_endpoint_defenses()

    app_module.configure_public_endpoint_defenses(app, defenses)

    assert len(app.after_request_funcs.get(None, [])) == 1
    assert app.config["SECRET_KEY"] == A_REAL_SECRET
    assert app.config["SESSION_TYPE"] == ON_DISK
    assert isinstance(app.wsgi_app, ProxyFix), (
        "the declared proxy hop is what makes remote_addr the caller's, which is the address "
        "organizer signup reports to reCAPTCHA"
    )
