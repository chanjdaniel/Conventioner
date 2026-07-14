"""
reCAPTCHA v3 verification utility.

The bypasses below exist so a developer can run the stack without Google credentials, and every one
of them is scoped to a process that has explicitly said it is a local development one. A captcha
that disappears when it is not configured is not a control: the endpoint that carries it - organizer
signup - is public, unauthenticated, and it writes a user document and sends mail from this domain,
so a deployment with no secret would serve it wide open and say nothing about it. Anything that is
not an opted-in local dev process therefore refuses -- at boot, through
``assert_captcha_configured``, so the refusal names the variable rather than arriving as a mystery
400 on a caller's screen, and again here, so no caller reaches a verification this process cannot
actually perform.

The escape hatch is ``ALLOW_INSECURE_LOCAL_DEV`` and nothing else. It is deliberately *not*
``FLASK_ENV``: see ``utils.deployment``.

The secret is read from the environment on every call, never captured into a module global at
import. A module that reads its key once, on the way up, is a module whose answer depends on when it
happened to be imported: it made the boot check a function of import order rather than of the
environment, it silently ignored anything ``load_dotenv`` put there afterwards, and it left the
tests patching a module attribute - so a test that cleared the *variable* was testing nothing at all,
and passed only because the shell running it happened to hold no key. ``utils.secret_key`` reads on
call; so does this, and so does ``utils.email``.
"""

import os
import requests
from typing import Tuple, Optional

from utils.configured_secret import configured_secret, is_published
from utils.deployment import (
    INSECURE_LOCAL_DEV_VAR,
    insecure_local_dev,
    warn_insecure_local_dev,
)

RECAPTCHA_SECRET_KEY_VAR = "RECAPTCHA_SECRET_KEY"
RECAPTCHA_VERIFY_URL = "https://www.google.com/recaptcha/api/siteverify"
MIN_SCORE = 0.5  # Minimum score threshold for reCAPTCHA v3


class CaptchaNotConfiguredError(RuntimeError):
    """There is no reCAPTCHA secret, so the captcha gate would be a no-op."""


def configured_value() -> str:
    """What ``RECAPTCHA_SECRET_KEY`` holds right now, whatever it holds."""
    return os.getenv(RECAPTCHA_SECRET_KEY_VAR, "")


def verifiable_secret() -> str:
    """The secret a token can actually be checked against, or ``""`` when there is not one.

    A blank value is not a secret, and neither is a placeholder this repository has published: a
    token verified against ``6Lcxxxx...`` is verified against a key Google never issued, which fails
    every signup while looking - to a check that asks only whether the variable is set - exactly like
    a configured deployment. Boot and request time both ask this one question, so the check cannot
    pass on a value the request path then chokes on.
    """
    return configured_secret(configured_value())


def assert_captcha_configured() -> None:
    """Refuse to serve the captcha-gated public endpoints without a secret to verify against.

    Raises:
        CaptchaNotConfiguredError: when no secret is configured and this is not an opted-in
            local development process, or when the configured value is a placeholder this
            repository has published - which holds everywhere, escape hatch or not, the same way
            it does for the signing key.
    """
    if is_published(configured_value()):
        raise CaptchaNotConfiguredError(
            f"{RECAPTCHA_SECRET_KEY_VAR} is set to a placeholder this repository has printed, not "
            f"to a secret. Google never issued it, so every signup token would be verified against "
            f"a key that cannot verify anything: the gate this variable exists to hold up fails "
            f"every caller, and it does so at request time, in a 400 that names none of this. A "
            f"truthy placeholder is worse than a blank, because a check that asks only whether the "
            f"variable is set takes it for a configured secret. Set a real secret "
            f"(https://www.google.com/recaptcha/admin), or clear the variable and set "
            f"{INSECURE_LOCAL_DEV_VAR}=true (with DISABLE_CAPTCHA=true) if this is a local "
            f"development machine."
        )
    if verifiable_secret():
        return
    if insecure_local_dev():
        warn_insecure_local_dev("reCAPTCHA verification")
        return
    raise CaptchaNotConfiguredError(
        f"{RECAPTCHA_SECRET_KEY_VAR} is not set. The public signup endpoint is gated on reCAPTCHA, "
        f"and without a secret there is nothing to verify a token against, so the gate would "
        f"silently pass every caller -- including the scripts it exists to keep off an endpoint "
        f"that writes to the database and sends mail from this domain. "
        f"Set {RECAPTCHA_SECRET_KEY_VAR} (https://www.google.com/recaptcha/admin), or set "
        f"{INSECURE_LOCAL_DEV_VAR}=true if this really is a local development machine."
    )


def verify_recaptcha(token: str, ip_address: Optional[str] = None) -> Tuple[bool, float]:
    """Verify reCAPTCHA v3 token.

    Args:
        token: reCAPTCHA token from frontend
        ip_address: Optional IP address of the user

    Returns:
        Tuple of (success: bool, score: float)
        - success: True if verification passed and score >= MIN_SCORE
        - score: reCAPTCHA score (0.0 to 1.0)
    """
    # Explicit test-mode bypass: DISABLE_CAPTCHA env var skips verification. Honored only by a
    # process that has opted in to being a local development one, so it cannot be a live bypass on
    # a deployment that merely forgot to unset it.
    if insecure_local_dev() and os.getenv("DISABLE_CAPTCHA", "").lower() in ("true", "1"):
        warn_insecure_local_dev("reCAPTCHA verification (DISABLE_CAPTCHA)")
        return True, 1.0

    secret = verifiable_secret()
    if not secret:
        if not insecure_local_dev():
            # Unreachable through app.py, which refuses to boot in this state. Reached only by an
            # entrypoint that skipped that check, and an unverifiable token is not a verified one.
            print(f"Error: {RECAPTCHA_SECRET_KEY_VAR} is not a usable secret, refusing the request")
            return False, 0.0
        warn_insecure_local_dev("reCAPTCHA verification (no secret configured)")
        return True, 1.0

    if not token:
        return False, 0.0

    try:
        data = {
            "secret": secret,
            "response": token,
        }
        
        if ip_address:
            data["remoteip"] = ip_address
        
        response = requests.post(RECAPTCHA_VERIFY_URL, data=data, timeout=5)
        result = response.json()
        
        success = result.get("success", False)
        score = result.get("score", 0.0)
        
        # Check if score meets minimum threshold
        if success and score >= MIN_SCORE:
            return True, score
        else:
            print(f"reCAPTCHA verification failed: success={success}, score={score}")
            return False, score
            
    except Exception as e:
        print(f"Error verifying reCAPTCHA: {e}")
        return False, 0.0
