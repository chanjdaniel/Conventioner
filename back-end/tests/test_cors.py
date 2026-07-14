"""Which websites may spend an organizer's session cookie, and what happens when nobody has said.

The session cookie is ``SameSite=None``, so the browser attaches it to cross-site XHR, and the API
answers with ``Access-Control-Allow-Credentials: true``. The origin list is therefore the whole of
the control: with no list, flask-cors reflects the caller's own ``Origin`` back at it, and every
website an organizer visits can read and write the organizer API as them.
"""

import re

import pytest

from conftest import skip_without_real_dependencies

skip_without_real_dependencies()

from flask import Flask

from utils.cors import (
    CORS_ALLOWED_ORIGINS_VAR,
    CorsConfigError,
    allowed_origins,
    install_cors,
)
from utils.deployment import INSECURE_LOCAL_DEV_VAR

EVIL = "https://evil.example.com"


@pytest.fixture
def local_dev(monkeypatch):
    """A process that has said, explicitly, that it is a local development one."""
    monkeypatch.setenv(INSECURE_LOCAL_DEV_VAR, "true")
    monkeypatch.delenv(CORS_ALLOWED_ORIGINS_VAR, raising=False)


@pytest.fixture
def deployed(monkeypatch):
    """Anything that has not said so - which is every deployment, and the default."""
    monkeypatch.delenv(INSECURE_LOCAL_DEV_VAR, raising=False)
    monkeypatch.delenv(CORS_ALLOWED_ORIGINS_VAR, raising=False)


def _allow_origin_for(origin, monkeypatch, **env):
    """The Access-Control-Allow-Origin a request from `origin` is answered with, through flask-cors."""
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    app = Flask(__name__)

    @app.route("/markets")
    def markets():
        return {"markets": []}

    install_cors(app, allowed_origins())
    with app.test_client() as client:
        response = client.get("/markets", headers={"Origin": origin})
        return response.headers.get("Access-Control-Allow-Origin")


class TestTheOriginList:
    def test_a_deployment_refuses_to_guess(self, deployed):
        """Unset is not "allow everyone", it is "nobody has said" - and the reflect-any-origin
        reading of that is the organizer API handed to every website an organizer visits."""
        with pytest.raises(CorsConfigError) as exc:
            allowed_origins()

        assert CORS_ALLOWED_ORIGINS_VAR in str(exc.value)
        assert INSECURE_LOCAL_DEV_VAR in str(exc.value)

    @pytest.mark.parametrize("flask_env", ["development", "production", ""])
    def test_the_refusal_does_not_depend_on_flask_env(self, monkeypatch, deployed, flask_env):
        """This check used to be `FLASK_ENV != "production"`, and the image ships
        FLASK_ENV=development with nothing overriding it - so every deployment built from our own
        image ran the reflect-any-origin branch."""
        monkeypatch.setenv("FLASK_ENV", flask_env)

        with pytest.raises(CorsConfigError):
            allowed_origins()

    def test_the_configured_origins_are_the_ones_allowed(self, monkeypatch, deployed):
        monkeypatch.setenv(
            CORS_ALLOWED_ORIGINS_VAR, "https://app.example.com, https://admin.example.com",
        )

        assert allowed_origins() == ["https://app.example.com", "https://admin.example.com"]

    def test_a_credentialed_wildcard_is_refused_even_when_asked_for(self, monkeypatch, deployed):
        """A wildcard here is not a permissive policy, it is the absence of one, so an operator
        cannot configure their way into it either."""
        monkeypatch.setenv(CORS_ALLOWED_ORIGINS_VAR, "https://app.example.com, *")

        with pytest.raises(CorsConfigError) as exc:
            allowed_origins()

        assert CORS_ALLOWED_ORIGINS_VAR in str(exc.value)

    @pytest.mark.parametrize(
        "value", ["https://app.example.com/", "app.example.com", "https://app.example.com/apply"],
    )
    def test_an_entry_that_is_not_an_origin_is_refused(self, monkeypatch, deployed, value):
        """A browser sends `scheme://host[:port]`, so an entry in any other shape silently matches
        nothing - the origin it was meant to allow is refused, at the browser, with no server log."""
        monkeypatch.setenv(CORS_ALLOWED_ORIGINS_VAR, value)

        with pytest.raises(CorsConfigError):
            allowed_origins()

    def test_an_opted_in_local_dev_machine_falls_back_to_loopback_only(self, local_dev):
        """The dev stack's port moves per worktree, so the fallback is a pattern - but it is still
        an origin list, and an attacker's page is not served from the developer's loopback."""
        origins = allowed_origins()

        assert [isinstance(origin, re.Pattern) for origin in origins] == [True]
        assert origins[0].match("http://localhost:5174")
        assert not origins[0].match(EVIL)

    def test_a_local_dev_machine_still_takes_a_configured_list(self, monkeypatch, local_dev):
        monkeypatch.setenv(CORS_ALLOWED_ORIGINS_VAR, "https://app.example.com")

        assert allowed_origins() == ["https://app.example.com"]


class TestTheHeaderTheBrowserIsAnsweredWith:
    """Driven through flask-cors, because what the policy *is* only matters as what it answers."""

    def test_a_configured_origin_is_allowed(self, monkeypatch, deployed):
        allowed = _allow_origin_for(
            "https://app.example.com",
            monkeypatch,
            **{CORS_ALLOWED_ORIGINS_VAR: "https://app.example.com"},
        )

        assert allowed == "https://app.example.com"

    def test_any_other_origin_is_not(self, monkeypatch, deployed):
        allowed = _allow_origin_for(
            EVIL, monkeypatch, **{CORS_ALLOWED_ORIGINS_VAR: "https://app.example.com"},
        )

        assert allowed is None

    def test_a_dev_machine_answers_loopback_and_nothing_else(self, monkeypatch, local_dev):
        assert _allow_origin_for("http://localhost:5174", monkeypatch) == "http://localhost:5174"
        assert _allow_origin_for(EVIL, monkeypatch) is None
