"""The boot-time contract this app's public surface rests on, and how it refuses.

A handful of variables, listed under the required production environment in
``docs/RELEASING.md``, carry endpoints that are unauthenticated, write to the database, send mail
from this domain, and answer the organizer's browser with their session attached. So the process
refuses to start without them - and the refusal has to be one refusal, naming all of them. A check
that stopped at the first would hand an operator one variable per redeploy, which turns one loud
failure into several and invites the last to be met by giving up.

Some of them are defenses, and their absence is never reported anywhere. Others are reported
everywhere and diagnosed nowhere: with no mail key, every registration, reset and OTP answers 500
and none of them names the variable; with no mail addresses, mail links to a laptop from a sender
that delivers to nobody; and with no session backend a serverless deployment goes looking for a disk
it does not have and fails at import, naming nothing either. The trusted-hop count is reported
nowhere at all - it decides which address organizer signup reports to reCAPTCHA, and behind a proxy
an unset one reports the ingress for every caller in the world. All three kinds belong in the same
refusal, for opposite reasons.

Asking the question must not answer it: the check reads configuration, and installing what it found
is a separate call. flask-cors adds an ``after_request`` handler per invocation, so a check that
configured the app as a side effect left one behind every time it was asked - which is why the test
for that asserts against the module's *own* app object, the one a stray side effect would land on.

And the check is a function of the environment, of nothing else. Every one of them is read when it
is asked for, so a fixture here says what a deployment holds by setting the variables an operator
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
from utils.deployment import INSECURE_LOCAL_DEV_VAR, LOCAL_SWITCHES, PLATFORM_SIGNALS
from utils.email import (
    DEFAULT_FROM_EMAIL,
    DEFAULT_FRONTEND_URL,
    FROM_EMAIL_VAR,
    FRONTEND_URL_VAR,
    RESEND_API_KEY_VAR,
    assert_mailer_configured,
    from_email,
    frontend_url,
)
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
    FRONTEND_URL_VAR,
    FROM_EMAIL_VAR,
)


@pytest.fixture
def deployed(monkeypatch):
    """Anything that has not declared itself a local development machine - every deployment.

    No platform signal is set, so the deployed-host refusal below is not what any test of a missing
    variable meets; the tests of that refusal set one themselves.
    """
    monkeypatch.delenv(INSECURE_LOCAL_DEV_VAR, raising=False)
    for variable in (*ALL_VARS, *PLATFORM_SIGNALS, *LOCAL_SWITCHES):
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
    monkeypatch.setenv(FRONTEND_URL_VAR, "https://conventioner.io")
    monkeypatch.setenv(FROM_EMAIL_VAR, "registration@conventioner.io")


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
    assert FRONTEND_URL_VAR not in message
    assert FROM_EMAIL_VAR not in message


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
    # On disk, as declared: cachelib's file cache is flask-session's store for it.
    assert type(app.session_interface).__name__ == "CacheLibSessionInterface"
    assert isinstance(app.wsgi_app, ProxyFix), (
        "the declared proxy hop is what makes remote_addr the caller's, which is the address "
        "organizer signup reports to reCAPTCHA"
    )


# A local-development or test switch on a deployed host


@pytest.fixture
def local_machine(deployed, monkeypatch):
    """A laptop, a worktree stack or CI: the hatch on, and no platform has said this is deployed."""
    monkeypatch.setenv(INSECURE_LOCAL_DEV_VAR, "true")


def _refusal() -> str:
    with pytest.raises(app_module.PublicEndpointDefenseError) as exc:
        app_module.check_public_endpoint_defenses()
    return str(exc.value)


def _deployed_host_sentence(signal: str, switches: str, verb: str) -> str:
    return (
        f"This process runs on a deployed host ({signal} is set, and only the platform sets it), "
        f"and {switches} {verb} on. Each is a local-development or test switch: "
        f"ALLOW_INSECURE_LOCAL_DEV turns off the defenses this check requires, DISABLE_CAPTCHA lets "
        f"every caller sign up, DISABLE_EMAIL sends no mail and reports it sent, and DISCORD_FAKE "
        f"answers for Discord from the database. Remove them from the deployment's environment "
        f"(Vercel, the back-end project, Settings, Environment Variables), and make sure no "
        f"back-end/.env file is deployed, then deploy again."
    )


@pytest.mark.parametrize("signal", ["VERCEL", "VERCEL_ENV", "VERCEL_REGION", "AWS_LAMBDA_FUNCTION_NAME"])
@pytest.mark.parametrize("switch", ["ALLOW_INSECURE_LOCAL_DEV", "DISABLE_CAPTCHA", "DISABLE_EMAIL", "DISCORD_FAKE"])
def test_a_deployed_host_refuses_each_local_switch(configured, monkeypatch, signal, switch):
    """A variable set while debugging, or a `back-end/.env` that reached a deployment, is refused.

    Each of the four is honoured only under the hatch, and the hatch turns every defense off, so a
    deployment carrying one passes `/healthz` and then takes sign-ups with no captcha or sends no
    mail while reporting it sent. The platform's own variables say the host is deployed.
    """
    monkeypatch.setenv(signal, "production" if signal == "VERCEL_ENV" else "1")
    monkeypatch.setenv(switch, "true")

    message = _refusal()

    assert _deployed_host_sentence(signal, switch, "is") in message


def test_a_deployed_host_with_the_hatch_on_is_refused_though_every_check_passes_by_it(
    local_machine, monkeypatch,
):
    """The shape the review found: the hatch passes every other check, so nothing else is named."""
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.setenv("DISABLE_EMAIL", "true")
    monkeypatch.setenv("DISABLE_CAPTCHA", "1")

    message = _refusal()

    assert _deployed_host_sentence(
        "VERCEL", "ALLOW_INSECURE_LOCAL_DEV, DISABLE_CAPTCHA and DISABLE_EMAIL", "are",
    ) in message
    assert message.startswith("Refusing to start: 1 of the things")


def test_two_switches_are_named_together(configured, monkeypatch):
    monkeypatch.setenv("VERCEL_REGION", "iad1")
    monkeypatch.setenv("DISCORD_FAKE", " TRUE ")
    monkeypatch.setenv("DISABLE_EMAIL", "1")

    assert _deployed_host_sentence("VERCEL_REGION", "DISABLE_EMAIL and DISCORD_FAKE", "are") in _refusal()


def test_the_first_platform_signal_is_the_one_named(configured, monkeypatch):
    monkeypatch.setenv("AWS_LAMBDA_FUNCTION_NAME", "conventioner-api")
    monkeypatch.setenv("VERCEL_ENV", "production")
    monkeypatch.setenv("DISABLE_CAPTCHA", "true")

    assert "(VERCEL_ENV is set, and only the platform sets it)" in _refusal()


@pytest.mark.parametrize("off", ["false", "", "  ", "0", "no"])
def test_a_switch_that_is_off_is_not_refused(configured, monkeypatch, off):
    monkeypatch.setenv("VERCEL", "1")
    for switch in LOCAL_SWITCHES:
        monkeypatch.setenv(switch, off)

    assert app_module.check_public_endpoint_defenses().signing_secret == A_REAL_SECRET


@pytest.mark.parametrize("blank", ["", "   "])
def test_a_blank_platform_variable_says_nothing(local_machine, monkeypatch, blank):
    monkeypatch.setenv("VERCEL", blank)
    monkeypatch.setenv("DISABLE_EMAIL", "true")

    assert app_module.check_public_endpoint_defenses().signing_secret


def test_with_no_platform_signal_the_hatch_boots_as_today(local_machine, monkeypatch):
    for switch in LOCAL_SWITCHES:
        monkeypatch.setenv(switch, "true")

    defenses = app_module.check_public_endpoint_defenses()

    assert defenses.signing_secret
    assert defenses.origins == [LOOPBACK_ORIGINS]


def test_the_deployed_host_problem_is_listed_with_every_other_at_once(configured, monkeypatch):
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.setenv("DISABLE_CAPTCHA", "true")
    monkeypatch.delenv(CORS_ALLOWED_ORIGINS_VAR)
    monkeypatch.delenv(FRONTEND_URL_VAR)

    message = _refusal()

    assert message.startswith(
        "Refusing to start: 3 of the things this app's public surface rests on are not as a "
        "deployment needs them, and not one of them announces itself - each is a defense that "
        "quietly stops defending, the mail without which no organizer account can be reached, the "
        "store the session is kept in, the address a caller is taken to be at, or a "
        "local-development switch left on where the platform says this is deployed. All of them "
        "are named below. See the required production environment in docs/RELEASING.md before "
        "promoting.\n\n"
    )
    parts = message.split("\n\n")
    assert parts[1].startswith("This process runs on a deployed host"), "the deployed host is named first"
    assert any(CORS_ALLOWED_ORIGINS_VAR in part for part in parts[2:])
    assert any(part.startswith(f"{FRONTEND_URL_VAR} is not set") for part in parts[2:])


def _environment_names_the_source_reads():
    """Every string literal in the back end's own source that names a test switch.

    Read as literals rather than as `os.getenv` arguments, so a name held in a constant first
    (`FAKE_VAR = "DISCORD_FAKE"`) is found too.
    """
    import ast
    import re

    switch = re.compile(r"^(DISABLE_[A-Z0-9_]+|[A-Z0-9_]+_FAKE)$")
    found = {}
    for path in sorted(BACK_END_DIR.rglob("*.py")):
        relative = path.relative_to(BACK_END_DIR)
        if relative.parts[0] in ("tests", "venv", ".venv") or "site-packages" in relative.parts:
            continue
        for node in ast.walk(ast.parse(path.read_text(), str(path))):
            if isinstance(node, ast.Constant) and isinstance(node.value, str) and switch.match(node.value):
                found.setdefault(node.value, str(relative))
    return found


def test_every_test_switch_the_source_reads_is_refused_on_a_deployed_host():
    """A new `DISABLE_*` or `*_FAKE` switch must join LOCAL_SWITCHES, or it can reach production."""
    found = _environment_names_the_source_reads()

    assert {"DISABLE_CAPTCHA", "DISABLE_EMAIL", "DISCORD_FAKE"} <= set(found), (
        "the guard reads no source at all"
    )
    unrefused = {name: where for name, where in found.items() if name not in LOCAL_SWITCHES}
    assert not unrefused, f"read by the back end and not refused on a deployed host: {unrefused}"


# The two mail variables


@pytest.mark.parametrize("blank", [None, "", "   "], ids=["absent", "empty", "spaces"])
def test_a_deployment_with_no_frontend_url_is_refused(configured, monkeypatch, blank):
    if blank is None:
        monkeypatch.delenv(FRONTEND_URL_VAR)
    else:
        monkeypatch.setenv(FRONTEND_URL_VAR, blank)

    assert (
        "FRONTEND_URL is not set. It is where every link this product mails points - the "
        "verification link, the reset link, the vendor's page, the door's link - and Discord's "
        "redirect after connecting a server. Unset, each points at http://127.0.0.1:5173. Set it to "
        "the address organizers sign in at (https://conventioner.io in production), or set "
        "ALLOW_INSECURE_LOCAL_DEV=true if this really is a local development machine."
    ) in _refusal()


@pytest.mark.parametrize("value", [
    "http://conventioner.io",
    "conventioner.io",
    "https://",
    "https:///markets",
    "https://conventioner.io/app",
    "https://conventioner.io//",
    "https://conventioner.io/?next=1",
    "https://conventioner.io/#top",
    "ftp://conventioner.io",
])
def test_a_frontend_url_that_is_not_an_https_origin_is_refused(configured, monkeypatch, value):
    monkeypatch.setenv(FRONTEND_URL_VAR, value)

    assert (
        f"FRONTEND_URL is {value!r}, which is not an https:// address with no path. Every mailed "
        f"link is this address plus a path, so it must be the origin organizers sign in at, such as "
        f"https://conventioner.io."
    ) in _refusal()


@pytest.mark.parametrize("value", ["https://conventioner.io", "https://conventioner.io/", "https://app.example.com:8443"])
def test_an_https_origin_is_taken(configured, monkeypatch, value):
    monkeypatch.setenv(FRONTEND_URL_VAR, value)

    assert app_module.check_public_endpoint_defenses().signing_secret == A_REAL_SECRET


@pytest.mark.parametrize("value", [None, "", "  "], ids=["absent", "empty", "spaces"])
def test_a_deployment_with_no_sender_is_refused(configured, monkeypatch, value):
    if value is None:
        monkeypatch.delenv(FROM_EMAIL_VAR)
    else:
        monkeypatch.setenv(FROM_EMAIL_VAR, value)

    assert (
        "FROM_EMAIL is not set. It is the address every mail this product sends is from. Unset, "
        "mail goes from Resend's shared onboarding@resend.dev, which delivers only to the Resend "
        "account's own address. Set it to an address on the domain verified in Resend "
        "(registration@conventioner.io in production), or set ALLOW_INSECURE_LOCAL_DEV=true if this "
        "really is a local development machine."
    ) in _refusal()


@pytest.mark.parametrize("value", ["registration", "Conventioner"])
def test_a_sender_that_is_not_an_address_is_refused_as_set(configured, monkeypatch, value):
    """An operator who set it is told what it holds, never sent looking for a missing variable."""
    monkeypatch.setenv(FROM_EMAIL_VAR, f" {value} ")

    refusal = _refusal()
    assert (
        f"FROM_EMAIL is {value!r}, which is not an address. It is the address every mail this "
        "product sends is from. Set it to an address on the domain verified in Resend "
        "(registration@conventioner.io in production)."
    ) in refusal
    assert "FROM_EMAIL is not set" not in refusal


@pytest.mark.parametrize("value", ["onboarding@resend.dev", "Conventioner <Onboarding@Resend.dev>"])
def test_resends_shared_sender_is_refused(configured, monkeypatch, value):
    monkeypatch.setenv(FROM_EMAIL_VAR, value)

    assert (
        "FROM_EMAIL is Resend's shared onboarding@resend.dev, which delivers only to the Resend "
        "account's own address, so no organizer or vendor would receive a mail. Set it to an "
        "address on the domain verified in Resend."
    ) in _refusal()


def test_a_display_name_sender_is_taken(configured, monkeypatch):
    monkeypatch.setenv(FROM_EMAIL_VAR, "Conventioner <registration@conventioner.io>")

    app_module.check_public_endpoint_defenses()

    assert from_email() == "Conventioner <registration@conventioner.io>"


def test_under_the_hatch_an_unset_mail_variable_keeps_its_default_and_says_so(
    local_machine, monkeypatch, caplog,
):
    caplog.set_level("WARNING", logger="utils.deployment")

    app_module.check_public_endpoint_defenses()

    assert (frontend_url(), from_email()) == (DEFAULT_FRONTEND_URL, DEFAULT_FROM_EMAIL)
    warned = " ".join(record.getMessage() for record in caplog.records)
    assert FRONTEND_URL_VAR in warned
    assert FROM_EMAIL_VAR in warned


def test_under_the_hatch_a_set_mail_variable_is_used_as_given(local_machine, monkeypatch):
    monkeypatch.setenv(FRONTEND_URL_VAR, "http://127.0.0.1:5174")
    monkeypatch.setenv(FROM_EMAIL_VAR, "onboarding@resend.dev")

    app_module.check_public_endpoint_defenses()

    assert (frontend_url(), from_email()) == ("http://127.0.0.1:5174", "onboarding@resend.dev")
