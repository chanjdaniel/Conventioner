import os
import sys
import types

import pytest

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from utils.captcha import (
    RECAPTCHA_SECRET_KEY_VAR,
    CaptchaNotConfiguredError,
    assert_captcha_configured,
    verify_recaptcha,
)
from utils.deployment import INSECURE_LOCAL_DEV_VAR


@pytest.fixture(autouse=True)
def no_secret(monkeypatch):
    """A process holding no reCAPTCHA secret, unless the test says otherwise.

    The environment, because that is what the module reads - on every call, not once at import. It
    used to capture the key into a module global, which is why these tests used to patch the
    attribute and clearing the *variable* said nothing at all: the ones that did passed only because
    the shell running them happened to hold no key, and in a shell exporting a real one they would
    have gone to Google instead of testing the bypass. Autouse, so a real key in a developer's shell
    cannot decide what this file tests.
    """
    monkeypatch.delenv(RECAPTCHA_SECRET_KEY_VAR, raising=False)


@pytest.fixture
def local_dev(monkeypatch):
    """A process that has said, explicitly, that it is a local development one."""
    monkeypatch.setenv(INSECURE_LOCAL_DEV_VAR, "true")


@pytest.fixture
def deployed(monkeypatch):
    """Anything that has not said so -- which is every deployment, and the default."""
    monkeypatch.delenv(INSECURE_LOCAL_DEV_VAR, raising=False)


class TestCaptchaBypass:
    def test_bypass_when_disable_captcha_enabled(self, monkeypatch, local_dev, no_secret):
        monkeypatch.setenv("DISABLE_CAPTCHA", "true")

        success, score = verify_recaptcha("dummy-token")

        assert success is True
        assert score == 1.0

    def test_bypass_when_disable_captcha_is_1(self, monkeypatch, local_dev, no_secret):
        monkeypatch.setenv("DISABLE_CAPTCHA", "1")

        success, score = verify_recaptcha("dummy-token")

        assert success is True
        assert score == 1.0

    def test_disable_captcha_is_ignored_by_anything_that_is_not_local_dev(
        self, monkeypatch, deployed,
    ):
        """A deployment that inherited DISABLE_CAPTCHA from a copied .env must not have a live
        bypass on it. The escape hatch is the only thing that can open one, and it is opt-in."""
        monkeypatch.setenv("DISABLE_CAPTCHA", "true")

        class FakeResponse:
            def json(self):
                return {"success": False, "score": 0.1}

        def fake_post(url, data, timeout):
            return FakeResponse()

        monkeypatch.setattr("utils.captcha.requests.post", fake_post)

        monkeypatch.setenv(RECAPTCHA_SECRET_KEY_VAR, "prod-secret-key")

        success, score = verify_recaptcha("dummy-token")

        assert success is False
        assert score == 0.1

    def test_dev_bypass_when_no_secret_key(self, monkeypatch, local_dev, no_secret):
        monkeypatch.delenv("DISABLE_CAPTCHA", raising=False)

        success, score = verify_recaptcha("dummy-token")

        assert success is True
        assert score == 1.0

    def test_enforced_when_secret_key_set_and_no_bypass(self, monkeypatch, local_dev):
        monkeypatch.delenv("DISABLE_CAPTCHA", raising=False)

        class FakeResponse:
            def json(self):
                return {"success": False, "score": 0.1}

        def fake_post(url, data, timeout):
            return FakeResponse()

        monkeypatch.setattr("utils.captcha.requests.post", fake_post)

        monkeypatch.setenv(RECAPTCHA_SECRET_KEY_VAR, "test-secret-key")

        success, score = verify_recaptcha("bad-token")

        assert success is False
        assert score == 0.1

    def test_enforced_rejects_empty_token_with_secret_key(self, monkeypatch, local_dev):
        monkeypatch.delenv("DISABLE_CAPTCHA", raising=False)

        monkeypatch.setenv(RECAPTCHA_SECRET_KEY_VAR, "test-secret-key")

        success, score = verify_recaptcha("", ip_address=None)

        assert success is False
        assert score == 0.0


class TestAnUnconfiguredCaptchaFailsClosed:
    """A captcha that disappears when it is not configured is not a control.

    The endpoints it gates are public and unauthenticated, and they write to the database and send
    mail from the product's domain. An unset secret used to mean "pass everybody, and say so only to
    stdout", so a deployment could ship with the gate silently off.

    The check used to be gated on ``FLASK_ENV == "production"``, which is how it came to be dead
    code: the repo's own Dockerfile exported ``FLASK_ENV=development``, so every deployment built from
    that image was exempt from the very check that existed for it. Nothing here reads ``FLASK_ENV``
    any more. The refusal is the default, and the exemption is what has to be asked for.
    """

    def test_boot_refuses_when_the_secret_is_missing(self, deployed):
        with pytest.raises(CaptchaNotConfiguredError) as exc:
            assert_captcha_configured()

        assert RECAPTCHA_SECRET_KEY_VAR in str(exc.value)
        assert INSECURE_LOCAL_DEV_VAR in str(exc.value)

    @pytest.mark.parametrize("flask_env", ["development", "production", ""])
    def test_the_refusal_does_not_depend_on_flask_env(self, monkeypatch, deployed, flask_env):
        """The bug this replaces in one line: the image ships FLASK_ENV=development, so a gate keyed
        on it protected only the deployments that did not need protecting."""
        monkeypatch.setenv("FLASK_ENV", flask_env)

        with pytest.raises(CaptchaNotConfiguredError):
            assert_captcha_configured()

    def test_boot_is_allowed_once_the_secret_is_set(self, monkeypatch, deployed):
        monkeypatch.setenv(RECAPTCHA_SECRET_KEY_VAR, "prod-secret-key")

        assert_captcha_configured()

    def test_an_opted_in_local_dev_machine_still_boots_without_a_secret(self, local_dev):
        assert_captcha_configured()

    def test_an_unverifiable_token_is_not_a_verified_one(self, monkeypatch, deployed):
        """Belt and braces for an entrypoint that skipped the boot check: with no secret there is
        nothing to verify a token against, and that refuses rather than waves through.
        """
        monkeypatch.setenv("DISABLE_CAPTCHA", "true")

        success, score = verify_recaptcha("any-token")

        assert success is False
        assert score == 0.0

    def test_a_blank_secret_is_no_secret(self, monkeypatch, deployed):
        """`RECAPTCHA_SECRET_KEY=" "` is the shape a half-edited .env line takes. Read raw, it is
        truthy, so the boot check passed and the 500 it exists to pre-empt arrived at request time
        instead."""
        monkeypatch.setenv(RECAPTCHA_SECRET_KEY_VAR, "   ")

        with pytest.raises(CaptchaNotConfiguredError):
            assert_captcha_configured()


class TestAPlaceholderIsNotASecret:
    """A check that can be satisfied with garbage is not a check.

    The env template used to ship `RECAPTCHA_SECRET_KEY=6Lcxxxxx...`, which is *truthy*: a copied
    template passed the boot check with a secret Google never issued, and every signup token was then
    verified against a key that cannot verify anything - a 400 at request time, naming none of this.
    A truthy placeholder is worse than a blank, so it is refused by name, and the templates ship
    blanks.
    """

    PUBLISHED_PLACEHOLDER = "6Lcxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

    def test_boot_refuses_the_placeholder_this_repo_published(self, monkeypatch, deployed):
        monkeypatch.setenv(RECAPTCHA_SECRET_KEY_VAR, self.PUBLISHED_PLACEHOLDER)

        with pytest.raises(CaptchaNotConfiguredError) as exc:
            assert_captcha_configured()

        assert RECAPTCHA_SECRET_KEY_VAR in str(exc.value)
        assert "placeholder" in str(exc.value)

    def test_a_local_dev_machine_is_refused_it_too(self, monkeypatch, local_dev):
        """The escape hatch lets a process boot with *no* secret. It is not a licence to boot with
        one that cannot verify anything - and the `.env` carrying that placeholder is exactly the
        file that gets copied onto a deployment."""
        monkeypatch.setenv(RECAPTCHA_SECRET_KEY_VAR, self.PUBLISHED_PLACEHOLDER)

        with pytest.raises(CaptchaNotConfiguredError):
            assert_captcha_configured()

    def test_no_token_is_ever_verified_against_it(self, monkeypatch, deployed):
        """Boot already refused, so this is the entrypoint that skipped the check. The request path
        has to agree with the boot check about what a usable secret is, or the two disagree about
        whether this deployment is configured."""
        posted = []

        def fake_post(url, data, timeout):
            posted.append(data)
            raise AssertionError("a placeholder secret must never be sent to Google")

        monkeypatch.setattr("utils.captcha.requests.post", fake_post)
        monkeypatch.setenv(RECAPTCHA_SECRET_KEY_VAR, self.PUBLISHED_PLACEHOLDER)

        success, score = verify_recaptcha("any-token")

        assert success is False
        assert score == 0.0
        assert posted == []
