"""The key everything in this product is signed with, and what happens when nobody configured one.

The fallback that used to stand in for it was a literal in this repository, which is to say a
published key: the Flask session cookie every organizer request authenticates with was signed with a
string anyone could read off the source, so anyone could write one. A secret with a default is not a
secret, and these tests hold the line that there is no default.

Deleting the fallback is not the whole of it, though, because the fallback is still readable - in
this repository's history, and in the environment of every deployment that is signing with it right
now. An operator meeting the new boot refusal has an incentive pointing straight back at it: a fresh
key ends every organizer's session, and the old literal does not. So the values this repository has
ever published are refused by name, on a deployment and on a laptop alike, and a key too short to
stay private is refused beside them. A published value is not a secret, whoever typed it in.
"""

import pytest

from conftest import skip_without_real_dependencies

skip_without_real_dependencies()

import utils.secret_key as secret_key_module
from utils.configured_secret import PUBLISHED_VALUES
from utils.deployment import INSECURE_LOCAL_DEV_VAR
from utils.secret_key import (
    MINIMUM_SECRET_LENGTH,
    SECRET_KEY_VAR,
    SecretKeyNotConfiguredError,
    signing_secret,
)

PUBLISHED_FALLBACK = "TEMP_KEY_CHANGE_IN_PRODUCTION"

A_REAL_SECRET = "SGDdxXn4YCG4M5pDeUjXTt8g0MSTXNKAtePMxo96b3s"


@pytest.fixture(autouse=True)
def no_secret_carried_between_tests(monkeypatch):
    """The dev secret is cached for the process, so a test must not inherit the last one's."""
    monkeypatch.setattr(secret_key_module, "_ephemeral_secret", None)


@pytest.fixture
def local_dev(monkeypatch):
    monkeypatch.setenv(INSECURE_LOCAL_DEV_VAR, "true")


@pytest.fixture
def deployed(monkeypatch):
    """Anything that has not opted in -- which is every deployment, and the default."""
    monkeypatch.delenv(INSECURE_LOCAL_DEV_VAR, raising=False)


class TestADeploymentWithoutASecret:
    def test_refuses_to_start(self, monkeypatch, deployed):
        """The boot check (``app.verify_public_endpoint_defenses``) asks for the secret it is about
        to sign with, so the refusal it collects is this one."""
        monkeypatch.delenv(SECRET_KEY_VAR, raising=False)

        with pytest.raises(SecretKeyNotConfiguredError) as exc:
            signing_secret()

        assert SECRET_KEY_VAR in str(exc.value), "the refusal has to name the variable"
        assert INSECURE_LOCAL_DEV_VAR in str(exc.value)

    def test_an_empty_secret_is_no_secret(self, monkeypatch, deployed):
        """A variable that is present and blank is the shape a forgotten one takes in a .env file."""
        monkeypatch.setenv(SECRET_KEY_VAR, "   ")

        with pytest.raises(SecretKeyNotConfiguredError):
            signing_secret()

    @pytest.mark.parametrize("flask_env", ["development", "production", ""])
    def test_the_refusal_does_not_depend_on_flask_env(self, monkeypatch, deployed, flask_env):
        """The image ships FLASK_ENV=development and nothing overrides it, so a check keyed on it
        would exempt every deployment built from that image -- which is all of them."""
        monkeypatch.setenv("FLASK_ENV", flask_env)
        monkeypatch.delenv(SECRET_KEY_VAR, raising=False)

        with pytest.raises(SecretKeyNotConfiguredError):
            signing_secret()

    def test_a_configured_secret_is_the_one_used(self, monkeypatch, deployed):
        monkeypatch.setenv(SECRET_KEY_VAR, A_REAL_SECRET)

        assert signing_secret() == A_REAL_SECRET


class TestASecretThisRepositoryHasAlreadyPublished:
    """Removing the fallback achieves nothing if the operator can paste the fallback back in.

    And the incentive points exactly there: the deployment is *currently signing* with that literal,
    a new key logs every organizer out, and the old one is a `git log` away. Setting it back would
    clear the boot refusal and leave the vulnerability precisely where it was.
    """

    @pytest.mark.parametrize("published", sorted(PUBLISHED_VALUES))
    def test_every_value_this_repo_ever_shipped_is_refused(
        self, monkeypatch, deployed, published,
    ):
        """Every value this repo has printed where *any* secret goes, not only the signing key's own
        placeholders: they are all equally readable, and the variable one was printed under is no
        part of what makes it public."""
        monkeypatch.setenv(SECRET_KEY_VAR, published)

        with pytest.raises(SecretKeyNotConfiguredError) as exc:
            signing_secret()

        assert "published" in str(exc.value)

    def test_a_placeholder_nobody_has_listed_yet_is_refused_by_its_shape(
        self, monkeypatch, deployed,
    ):
        """The literal list cannot be complete - the placeholder somebody writes into a template
        tomorrow is not in it. A run of x's is what every one of them has looked like."""
        monkeypatch.setenv(SECRET_KEY_VAR, "sk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx")

        with pytest.raises(SecretKeyNotConfiguredError) as exc:
            signing_secret()

        assert "published" in str(exc.value)

    def test_the_removed_fallback_is_one_of_them(self, monkeypatch, deployed):
        """The literal this PR deletes from the source. It is still in the history, so it is still
        a key anybody can read - which is all a signing secret has to be to be worthless."""
        monkeypatch.setenv(SECRET_KEY_VAR, PUBLISHED_FALLBACK)

        with pytest.raises(SecretKeyNotConfiguredError):
            signing_secret()

    def test_the_case_it_is_typed_in_does_not_launder_it(self, monkeypatch, deployed):
        monkeypatch.setenv(SECRET_KEY_VAR, PUBLISHED_FALLBACK.lower())

        with pytest.raises(SecretKeyNotConfiguredError):
            signing_secret()

    def test_a_local_dev_machine_is_refused_it_too(self, monkeypatch, local_dev):
        """The escape hatch lets a process boot with *no* key, signing with a random one. It is not
        a licence to sign with a key the internet holds - and the `.env` carrying that literal is
        exactly the file that gets copied onto a deployment."""
        monkeypatch.setenv(SECRET_KEY_VAR, PUBLISHED_FALLBACK)

        with pytest.raises(SecretKeyNotConfiguredError):
            signing_secret()


class TestASecretTooShortToStayOne:
    def test_a_short_key_is_refused(self, monkeypatch, deployed):
        """It signs the cookie the organizer API authenticates every request with, and it is
        brute-forced offline from a single one of those cookies."""
        monkeypatch.setenv(SECRET_KEY_VAR, "a" * (MINIMUM_SECRET_LENGTH - 1))

        with pytest.raises(SecretKeyNotConfiguredError) as exc:
            signing_secret()

        assert str(MINIMUM_SECRET_LENGTH) in str(exc.value)

    def test_the_generated_key_the_refusal_recommends_is_accepted(self, monkeypatch, deployed):
        """`secrets.token_urlsafe(48)` is what every refusal and every doc tells an operator to run,
        so the length floor must not refuse what it asks for."""
        import secrets

        generated = secrets.token_urlsafe(48)
        monkeypatch.setenv(SECRET_KEY_VAR, generated)

        assert signing_secret() == generated


class TestAnOptedInLocalDevMachine:
    """It boots without a secret. It does not boot with a *published* one."""

    def test_gets_a_secret_that_is_not_in_this_repository(self, monkeypatch, local_dev):
        monkeypatch.delenv(SECRET_KEY_VAR, raising=False)

        secret = signing_secret()

        assert secret
        assert secret != PUBLISHED_FALLBACK, "a committed fallback is a key anyone can read"

    def test_the_secret_is_unpredictable(self, monkeypatch, local_dev):
        """Random per process is what keeps the escape hatch from being a fallback again: a value
        nobody can guess cannot be forged against, and one that changes every boot cannot quietly
        become the key a deployment ships with."""
        monkeypatch.delenv(SECRET_KEY_VAR, raising=False)
        first = signing_secret()

        monkeypatch.setattr(secret_key_module, "_ephemeral_secret", None)
        second = signing_secret()

        assert first != second
        assert len(first) >= 32

    def test_the_secret_is_stable_within_the_process(self, monkeypatch, local_dev):
        """Re-rolled per call, it would refuse the token it signed a moment earlier."""
        monkeypatch.delenv(SECRET_KEY_VAR, raising=False)

        assert signing_secret() == signing_secret()

    def test_it_says_so_every_time(self, monkeypatch, local_dev, caplog):
        monkeypatch.delenv(SECRET_KEY_VAR, raising=False)

        with caplog.at_level("WARNING"):
            signing_secret()

        assert INSECURE_LOCAL_DEV_VAR in caplog.text
        assert SECRET_KEY_VAR in caplog.text
