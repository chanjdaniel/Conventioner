"""The key every session cookie in this product is signed with.

A signing secret with a fallback is not a secret. The fallback that used to live here was a literal
committed to this repository, so on any deployment that forgot ``SECRET_KEY`` the key protecting the
product was a string anyone could read off the source: a Flask session cookie naming any organizer
could be minted at will and spent against the organizer API - every market, vendor and application
that organizer can reach - with no password and no login.

So there is no fallback. ``SECRET_KEY`` is required, it is checked at boot alongside the other
public-endpoint defenses, and the refusal names the variable -- the same shape as the reCAPTCHA
secret and the origin list, and for the same reason: a security control keyed on a variable whose
default is the insecure value is not a control.

Removing the fallback is only half of it, because the fallback is still readable - in this
repository's history, and in every deployment currently signing with it. An operator meeting the new
boot refusal has an incentive pointing straight back at it: a fresh key logs out every organizer, and
the old literal does not. Pasting it into ``SECRET_KEY`` would clear the refusal and change nothing
at all, so the values this repository has ever published are refused by name. A published value is
not a secret, whoever typed it in and wherever they typed it.

A short key is refused for the neighbouring reason: it is not a secret either, it is a guess away
from one, and the check exists to say so before the deployment does.

The local-development escape hatch (see ``utils.deployment``) does not restore a fallback either. It
mints a *random* secret for the life of the process, which is the part that matters: a value nobody
can predict cannot be forged against, and a value that changes every boot cannot quietly become the
key a deployment ships with. The cost is that a restart invalidates the sessions that process issued,
which is the correct price for a machine that has declined to configure a key.
"""

import logging
import os
import secrets

from utils.configured_secret import configured_secret, is_published
from utils.deployment import (
    INSECURE_LOCAL_DEV_VAR,
    insecure_local_dev,
    warn_insecure_local_dev,
)

logger = logging.getLogger(__name__)

SECRET_KEY_VAR = "SECRET_KEY"

MINIMUM_SECRET_LENGTH = 32

_ephemeral_secret = None


class SecretKeyNotConfiguredError(RuntimeError):
    """There is no signing secret, so every token this process issued would be forgeable."""


def signing_secret() -> str:
    """The secret this process signs session cookies with.

    Raises:
        SecretKeyNotConfiguredError: when no secret is configured and this is not an opted-in
            local development process, when the configured value is one this repository has
            published, or when it is too short to be a secret.
    """
    value = os.getenv(SECRET_KEY_VAR, "")
    _reject_a_secret_that_is_not_one(value)

    configured = configured_secret(value)
    if configured:
        return configured

    if insecure_local_dev():
        return _ephemeral_dev_secret()

    raise SecretKeyNotConfiguredError(
        f"{SECRET_KEY_VAR} is not set. It signs the Flask session cookie the organizer API "
        f"authenticates every request with, so a process without one has no way to tell a session "
        f"it issued from a session an attacker wrote -- and a session an attacker wrote reads and "
        f"overwrites any organizer's markets, vendors and applications, with no password and no "
        f"login. There is deliberately no default: a fallback secret in a repository is a published "
        f"key. Set {SECRET_KEY_VAR} to a long random string (for example "
        f"`python -c 'import secrets; print(secrets.token_urlsafe(48))'`), or set "
        f"{INSECURE_LOCAL_DEV_VAR}=true if this really is a local development machine."
    )


def _reject_a_secret_that_is_not_one(value: str) -> None:
    """Refuse the values that are already public, and the ones too short to stay private.

    This holds on a development machine too. The escape hatch exists so a process with *no* key can
    still boot, with a random one; it is not a licence to sign with a key the internet already has,
    and a ``.env`` carrying a published literal is exactly the file that gets copied to a deployment.

    A blank value is not refused here: it is what an unset variable and a forgotten one both look
    like, and the caller answers it with the escape hatch or the refusal that names the variable.

    Raises:
        SecretKeyNotConfiguredError: what a published or too-short key amounts to.
    """
    if is_published(value):
        raise SecretKeyNotConfiguredError(
            f"{SECRET_KEY_VAR} is set to a value this repository has published. It appears in the "
            f"source history, the env template or the deploy guide, so it is readable by anyone who "
            f"can read the repo - which makes it a key, not a secret: a session cookie naming any "
            f"organizer can be minted from it and spent against the organizer API with no password "
            f"and no login. That is the exact vulnerability this check exists to close, and setting "
            f"the old value back would close nothing. Generate a real one with "
            f"`python -c 'import secrets; print(secrets.token_urlsafe(48))'`. Rotating the key ends "
            f"every session currently signed with it, so organizers will be asked to log in again "
            f"once; a key everyone already holds is not the alternative."
        )

    configured = configured_secret(value)
    if configured and len(configured) < MINIMUM_SECRET_LENGTH:
        raise SecretKeyNotConfiguredError(
            f"{SECRET_KEY_VAR} is {len(configured)} characters long. A signing key is only worth the "
            f"work it takes to guess: this one signs the session cookie the organizer API "
            f"authenticates every request with, and a short one is brute-forced offline from a "
            f"single cookie, after which sessions for any organizer can be minted at will. At least "
            f"{MINIMUM_SECRET_LENGTH} characters, and random rather than chosen - "
            f"`python -c 'import secrets; print(secrets.token_urlsafe(48))'`."
        )


def _ephemeral_dev_secret() -> str:
    """A random secret for this process only, so an unconfigured dev machine still has a real key.

    Cached, because a key regenerated per call would invalidate the token it signed a moment ago.
    """
    global _ephemeral_secret
    if _ephemeral_secret is None:
        _ephemeral_secret = secrets.token_urlsafe(48)
        warn_insecure_local_dev(f"a configured signing secret ({SECRET_KEY_VAR})")
        logger.warning(
            "Signing with a random secret generated for this process. Sessions will not survive a "
            "restart. Set %s to keep them across restarts.",
            SECRET_KEY_VAR,
        )
    return _ephemeral_secret
