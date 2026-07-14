"""What counts as a configured secret - the one question all three boot checks now ask.

Each of them used to ask its own, and each asked the weakest one available: is the variable truthy?
Two values answer yes without being a secret, and both are what a half-copied template looks like: a
blank, and a placeholder this repository has printed. The second is the dangerous one, because it is
truthy - so the check passes, and the deployment fails later and elsewhere, naming none of it.

``test_every_secret_asks_this_module`` is what keeps that true: three callers each re-implementing
the same three lines is three chances for one of them to drift back to `if value:`.
"""

import inspect

import pytest

import utils.captcha as captcha_mod
import utils.email as email_mod
import utils.secret_key as secret_key_mod
from utils.configured_secret import (
    PUBLISHED_VALUES,
    configured_secret,
    is_published,
)

A_GENERATED_KEY = "SGDdxXn4YCG4M5pDeUjXTt8g0MSTXNKAtePMxo96b3s"


class TestAValueThisRepositoryHasPrinted:
    @pytest.mark.parametrize("published", sorted(PUBLISHED_VALUES))
    def test_is_not_a_secret(self, published):
        assert is_published(published)

    def test_the_case_it_is_typed_in_does_not_launder_it(self):
        assert is_published("TEMP_KEY_CHANGE_IN_PRODUCTION")

    def test_neither_does_the_whitespace_around_it(self):
        assert is_published("  your-resend-api-key\n")

    @pytest.mark.parametrize("placeholder", [
        "re_xxxxxxxxxxxx",
        "sk_XXXXXXXXXXXX",
        "your-api-key",
        "your_secret_here",
        "<generate: python -c 'import secrets; print(secrets.token_urlsafe(48))'>",
    ])
    def test_one_nobody_has_listed_yet_is_caught_by_its_shape(self, placeholder):
        """The literal list cannot be complete: the placeholder somebody writes into a template
        tomorrow is not in it yet. A run of x's and a `your-` prefix are what every one of them in
        this repository's history has looked like."""
        assert is_published(placeholder)


class TestARealSecret:
    def test_is_not_mistaken_for_a_placeholder(self):
        assert not is_published(A_GENERATED_KEY)
        assert not is_published("re_QYt3bK9wLm2ZpR7vX4nHs6Ja")

    def test_survives_the_read(self):
        assert configured_secret(A_GENERATED_KEY) == A_GENERATED_KEY

    def test_the_whitespace_a_env_file_carries_is_stripped(self):
        assert configured_secret(f"  {A_GENERATED_KEY}  ") == A_GENERATED_KEY


class TestAValueThatHoldsNoSecret:
    def test_an_unset_variable_holds_none(self):
        assert configured_secret("") == ""
        assert configured_secret(None) == ""

    def test_a_blank_one_holds_none(self):
        """The shape a forgotten variable takes in a .env file, and truthy to anything reading the
        raw value."""
        assert configured_secret("   ") == ""
        assert not is_published("   "), "blank is unset, not published - the refusals differ"

    def test_a_published_one_holds_none(self):
        """A secret only the deployment holds is the whole of what a secret is. This one is in the
        repo, so every reader has it - which makes it exactly as useful as an empty string."""
        assert configured_secret("re_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx") == ""


class TestEverySecretAsksThisModule:
    """The documentation calls this module the single answer to "does this value hold a secret?".

    It was not: each of the three read its own variable, stripped it itself, and asked
    ``is_published`` separately - three copies of one rule, and the next one to be written would have
    been a fourth. They call it now, and these pin that they still do, because a caller that drifts
    back to `if value:` is how a placeholder gets taken for a secret again.
    """

    @pytest.mark.parametrize("reads_the_secret", [
        secret_key_mod.signing_secret,
        captcha_mod.verifiable_secret,
        email_mod.sendable_key,
    ])
    def test_it_is_the_one_that_decides(self, reads_the_secret):
        assert "configured_secret" in inspect.getsource(reads_the_secret)

    @pytest.mark.parametrize("variable, reads_the_secret", [
        (secret_key_mod.SECRET_KEY_VAR, secret_key_mod.signing_secret),
        (captcha_mod.RECAPTCHA_SECRET_KEY_VAR, captcha_mod.verifiable_secret),
        (email_mod.RESEND_API_KEY_VAR, email_mod.sendable_key),
    ])
    def test_each_one_reads_its_variable_when_it_is_asked(
        self, monkeypatch, variable, reads_the_secret,
    ):
        """Not once at import, which is the same rule seen from the other side.

        Two of the three used to capture their key into a module global on the way up. That made the
        boot check a function of import order rather than of the environment: a ``.env`` loaded after
        them was a ``.env`` nobody saw, and a test that cleared the variable cleared nothing - it had
        to know which module attribute to patch instead, and passed for a reason unrelated to what it
        claimed. Setting the variable is now the only thing any of them needs to hear.
        """
        monkeypatch.setenv(variable, f"  {A_GENERATED_KEY}  ")

        assert reads_the_secret() == A_GENERATED_KEY
