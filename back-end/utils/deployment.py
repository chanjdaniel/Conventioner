"""The one switch that lets this process run without what its public endpoints need.

The signup, verification, password-reset and OTP endpoints are unauthenticated, they write to the
database, and they send mail from the product's domain. Six pieces of configuration are what keep
this app's public surface from being an open relay - or, in two of the cases, from being a locked
door - and ``check_public_endpoint_defenses`` (``app.py``) requires all six:

- ``RECAPTCHA_SECRET_KEY``, the gate that keeps a script off the public signup endpoint.
- ``SECRET_KEY``, which signs the organizer's session cookie, and so is what makes a session mean
  anything at all.
- ``CORS_ALLOWED_ORIGINS``, the list of browser origins allowed to send that session cookie to the
  organizer API.
- ``RESEND_API_KEY``, which delivers the verification link, the password-reset link, and the OTP -
  every route by which an organizer account is reached.
- ``SESSION_TYPE``, which says where that session is kept - and has no answer that is right for both
  a container and a serverless function.
- ``TRUSTED_PROXY_HOPS``, which says how much of a forwarded header this deployment owns, and so
  decides whose address the captcha above is actually scored against.

Three of them fail *silently* when unset: the captcha passes every caller, a session signed with a
published key is a session anyone can forge, and a credentialed CORS policy with no origin list
reflects whatever ``Origin`` the caller sent. Two fail the opposite way and belong here for that
reason - the mail key fails every registration, reset and OTP with a 500 naming nothing, and the
session backend sends a serverless deployment looking for a disk it does not have, raising at import
and naming nothing either. Both are variables an operator would otherwise have to find one broken
deployment at a time. The hop count fails more quietly than any of them: nothing breaks, every
signup is simply reported to Google as coming from the ingress, and a reCAPTCHA score is the only
place it shows.

So none of them may be optional by default. Gating those checks on ``FLASK_ENV == "production"``
was the shape of the bug rather than the fix: the repo's own image exported ``FLASK_ENV=development``
and nothing overrode it, so a deployment built from that image was exempt from every one of them
and said nothing about it. A security control gated on a variable whose default is the insecure
value is not a control - and neither is a session backend derived from one, which is how a
disk-less host came to be told to look for a disk.

It is inverted here. The checks hold for every process, and it is the *escape hatch* that has to be
asked for: a developer running the stack on a laptop sets ``ALLOW_INSECURE_LOCAL_DEV`` and gets a
warning naming everything it turns off. A deployment that forgets to set the six variables does
not boot at all, which is the only way an unconfigured deployment can be made impossible rather
than merely discouraged. The same six are listed in ``docs/RELEASING.md`` and ``.env.example``;
keep those in step with the check, because a deploy checklist that is wrong is worse than one that
is absent - it will be trusted.

The hatch is not a licence to sign with a *published* key, though: ``utils.secret_key`` refuses the
literals this repository has printed even on an opted-in dev machine. The hatch exists so a process
with no key can boot with a random one, and the ``.env`` holding a published literal is exactly the
file that gets copied onto a deployment.
"""

import logging
import os

logger = logging.getLogger(__name__)

INSECURE_LOCAL_DEV_VAR = "ALLOW_INSECURE_LOCAL_DEV"

_TRUTHY = ("true", "1")


def insecure_local_dev() -> bool:
    """Whether this process has been told, explicitly, that it is a local development one."""
    return os.getenv(INSECURE_LOCAL_DEV_VAR, "").strip().lower() in _TRUTHY


def warn_insecure_local_dev(defense: str) -> None:
    """Name the defense that is off and the variable that turned it off, every time it is skipped."""
    logger.warning(
        "%s is off because %s is set. That is a local-development escape hatch: the public signup, "
        "verification, password-reset and OTP endpoints are unauthenticated, they write to the "
        "database, and they send mail from this domain. Never set %s on a deployed environment.",
        defense, INSECURE_LOCAL_DEV_VAR, INSECURE_LOCAL_DEV_VAR,
    )
