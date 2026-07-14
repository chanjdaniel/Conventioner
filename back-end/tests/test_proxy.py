"""Whose address this deployment believes the caller is at, and what happens when nobody has said.

Organizer signup reports that address to Google as reCAPTCHA's ``remoteip``, and reCAPTCHA v3 scores
on it. Behind a proxy, ``remote_addr`` is the proxy - one address for every caller in the world - so
every signup is scored as though it came from the same client. Trusting ``X-Forwarded-For`` whole is
the opposite failure: the caller writes that header, so it would report whatever address it liked.
Only the hops the deployment owns may be read, and only the deployment knows how many those are.
"""

import pytest

from conftest import skip_without_real_dependencies

skip_without_real_dependencies()

from flask import Flask, request
from werkzeug.middleware.proxy_fix import ProxyFix

from utils.deployment import INSECURE_LOCAL_DEV_VAR
from utils.proxy import (
    TRUSTED_PROXY_HOPS_VAR,
    TrustedProxyConfigError,
    install_trusted_proxy_fix,
    trusted_proxy_hops,
)


def _app_reporting_the_caller() -> Flask:
    app = Flask(__name__)

    @app.route("/whoami")
    def whoami():
        return {"ip": request.remote_addr}

    return app


@pytest.fixture
def local_dev(monkeypatch):
    """A process that has said, explicitly, that it is a local development one."""
    monkeypatch.setenv(INSECURE_LOCAL_DEV_VAR, "true")


@pytest.fixture
def deployed(monkeypatch):
    """Anything that has not said so - which is every deployment, and the default."""
    monkeypatch.delenv(INSECURE_LOCAL_DEV_VAR, raising=False)


class TestTrustedProxyHops:
    def test_an_opted_in_local_dev_machine_defaults_to_trusting_nothing(
        self, monkeypatch, local_dev,
    ):
        monkeypatch.delenv(TRUSTED_PROXY_HOPS_VAR, raising=False)

        assert trusted_proxy_hops() == 0

    def test_a_deployment_refuses_to_guess(self, monkeypatch, deployed):
        """Unset is not zero, it is unknown, and both readings of an unknown value break: guess zero
        behind a proxy and every signup is scored against the ingress; guess one with nothing in
        front and the score is keyed on a header the caller writes."""
        monkeypatch.delenv(TRUSTED_PROXY_HOPS_VAR, raising=False)

        with pytest.raises(TrustedProxyConfigError) as exc:
            trusted_proxy_hops()

        assert TRUSTED_PROXY_HOPS_VAR in str(exc.value)
        assert INSECURE_LOCAL_DEV_VAR in str(exc.value)

    @pytest.mark.parametrize("flask_env", ["development", "production", ""])
    def test_the_refusal_does_not_depend_on_flask_env(self, monkeypatch, deployed, flask_env):
        """FLASK_ENV is gone from this repository, and a check keyed on it is what exempted every
        deployment built from our own image - which was all of them. Setting it changes nothing."""
        monkeypatch.setenv("FLASK_ENV", flask_env)
        monkeypatch.delenv(TRUSTED_PROXY_HOPS_VAR, raising=False)

        with pytest.raises(TrustedProxyConfigError):
            trusted_proxy_hops()

    def test_a_deployment_takes_an_explicit_zero(self, monkeypatch, deployed):
        """An operator who means "Flask is exposed directly" can say so; they just have to say it."""
        monkeypatch.setenv(TRUSTED_PROXY_HOPS_VAR, "0")

        assert trusted_proxy_hops() == 0

    def test_a_count_is_read(self, monkeypatch, deployed):
        monkeypatch.setenv(TRUSTED_PROXY_HOPS_VAR, "2")

        assert trusted_proxy_hops() == 2

    @pytest.mark.parametrize("value", ["yes", "1.5", "-1"])
    def test_a_value_that_is_not_a_hop_count_is_refused(self, monkeypatch, local_dev, value):
        monkeypatch.setenv(TRUSTED_PROXY_HOPS_VAR, value)

        with pytest.raises(TrustedProxyConfigError):
            trusted_proxy_hops()


class TestInstallTrustedProxyFix:
    def test_no_hops_reads_no_forwarded_header(self):
        """With nothing in front of Flask, the peer *is* the caller, and a forwarded header is a
        thing the caller made up. Leaving ProxyFix off the path is what keeps it unread.

        Asserted on the *type* of the installed stack, not on the identity of ``app.wsgi_app``:
        Flask's is a bound method, and a fresh one is handed out on every attribute access, so an
        identity comparison there is true of nothing and would pass whatever this call did.
        """
        app = _app_reporting_the_caller()

        install_trusted_proxy_fix(app, 0)

        assert not isinstance(app.wsgi_app, ProxyFix)

    def test_the_declared_hops_are_the_ones_trusted(self):
        app = _app_reporting_the_caller()

        install_trusted_proxy_fix(app, 1)

        assert isinstance(app.wsgi_app, ProxyFix)
        assert app.wsgi_app.x_for == 1


class TestTheAddressARequestIsCreditedTo:
    """What reCAPTCHA is told, driven through the WSGI stack that decides it."""

    def _remote_addr(self, hops, **headers):
        app = _app_reporting_the_caller()
        install_trusted_proxy_fix(app, hops)
        with app.test_client() as client:
            return client.get(
                "/whoami", headers=headers, environ_base={"REMOTE_ADDR": "10.0.0.1"},
            ).get_json()["ip"]

    def test_with_no_proxy_a_forged_header_is_ignored(self):
        """Any caller can send X-Forwarded-For. Believed with nothing in front of Flask, it is an
        identity the caller mints per request, and the address reCAPTCHA scores is fiction."""
        addr = self._remote_addr(0, **{"X-Forwarded-For": "198.51.100.7"})

        assert addr == "10.0.0.1"

    def test_behind_one_proxy_the_caller_is_the_hop_the_proxy_appended(self):
        addr = self._remote_addr(1, **{"X-Forwarded-For": "203.0.113.5"})

        assert addr == "203.0.113.5"

    def test_a_caller_cannot_forge_the_address_it_is_scored_at(self):
        """The entries to the *left* are whatever the caller chose to send; the trusted proxy appends
        the address it actually saw on the right. One trusted hop reads exactly that one, so a caller
        that pads the header with a thousand fake addresses is still reported as itself."""
        addr = self._remote_addr(1, **{"X-Forwarded-For": "1.2.3.4, 5.6.7.8, 203.0.113.5"})

        assert addr == "203.0.113.5"

    def test_two_trusted_hops_read_past_the_second_one(self):
        addr = self._remote_addr(2, **{"X-Forwarded-For": "203.0.113.5, 172.16.0.9"})

        assert addr == "203.0.113.5"
