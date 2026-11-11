"""The one switch that lets this process run without what its public endpoints need.

The signup, verification, password-reset and OTP endpoints are unauthenticated, they write to the
database, and they send mail from the product's domain. Eight pieces of configuration are what keep
this app's public surface from being an open relay - or, in four of the cases, from being a locked
door - and ``check_public_endpoint_defenses`` (``app.py``) requires all eight:

- ``RECAPTCHA_SECRET_KEY``, the gate that keeps a script off the public signup endpoint.
- ``SECRET_KEY``, which signs the organizer's session cookie, and so is what makes a session mean
  anything at all.
- ``CORS_ALLOWED_ORIGINS``, the list of browser origins allowed to send that session cookie to the
  organizer API.
- ``RESEND_API_KEY``, which delivers every mail by which an organizer account is reached, and the
  vendor's sign-in code; what it delivers is listed in ``docs/RELEASING.md``.
- ``FRONTEND_URL``, the address every mailed link points at.
- ``FROM_EMAIL``, the address every mail is sent from.
- ``SESSION_TYPE``, which says where that session is kept - and has no answer that is right for both
  a container and a serverless function.
- ``TRUSTED_PROXY_HOPS``, which says how much of a forwarded header this deployment owns, and so
  decides whose address the captcha above is actually scored against.

Three of them fail *silently* when unset: the captcha passes every caller, a session signed with a
published key is a session anyone can forge, and a credentialed CORS policy with no origin list
reflects whatever ``Origin`` the caller sent. Four fail the opposite way and belong here for that
reason - the mail key fails every registration, reset and OTP with a 500 naming nothing, an unset
link address mails every organizer a link to a laptop, an unset sender mails from Resend's shared
address, which delivers to nobody but the Resend account's owner, and the session backend sends a
serverless deployment looking for a disk it does not have, raising at import and naming nothing
either. Each is a variable an operator would otherwise have to find one broken deployment at a
time. The hop count fails more quietly than any of them: nothing breaks, every signup is simply
reported to Google as coming from the ingress, and a reCAPTCHA score is the only place it shows.

So none of them may be optional by default. Gating those checks on ``FLASK_ENV == "production"``
was the shape of the bug rather than the fix: the repo's own image exported ``FLASK_ENV=development``
and nothing overrode it, so a deployment built from that image was exempt from every one of them
and said nothing about it. A security control gated on a variable whose default is the insecure
value is not a control - and neither is a session backend derived from one, which is how a
disk-less host came to be told to look for a disk.

It is inverted here. The checks hold for every process, and it is the *escape hatch* that has to be
asked for: a developer running the stack on a laptop sets ``ALLOW_INSECURE_LOCAL_DEV`` and gets a
warning naming everything it turns off. A deployment that forgets to set the eight variables does
not boot at all, which is the only way an unconfigured deployment can be made impossible rather
than merely discouraged. The same eight are listed in ``docs/RELEASING.md`` and ``.env.example``;
keep those in step with the check, because a deploy checklist that is wrong is worse than one that
is absent - it will be trusted.

The hatch itself is refused on a deployed host, with the three test switches it unlocks
(``LOCAL_SWITCHES``): a variable set while debugging, or a ``back-end/.env`` that reached a
deployment, would otherwise turn every defense off where nothing says so. Whether the host is
deployed is read from variables only the platform sets (``PLATFORM_SIGNALS``), and only ever to
refuse: an operator can forget to set a variable, so no check here is ever *permitted* by one being
absent. ``/healthz`` reports what this module sees, and the Deploy workflow refuses a staged back
end that does not see itself deployed or has the hatch on, so the refusal is proven armed on every
release rather than assumed.

The hatch is not a licence to sign with a *published* key, though: ``utils.secret_key`` refuses the
literals this repository has printed even on an opted-in dev machine. The hatch exists so a process
with no key can boot with a random one, and the ``.env`` holding a published literal is exactly the
file that gets copied onto a deployment.
"""

import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)

INSECURE_LOCAL_DEV_VAR = "ALLOW_INSECURE_LOCAL_DEV"

#: Every local-development or test switch the back end reads. A deployed host refuses each, and a
#: test fails when the source reads a ``DISABLE_*`` or ``*_FAKE`` variable not listed here.
LOCAL_SWITCHES = (INSECURE_LOCAL_DEV_VAR, "DISABLE_CAPTCHA", "DISABLE_EMAIL", "DISCORD_FAKE")

#: Variables the platform sets on a deployed host and an operator never does. Vercel exposes
#: ``VERCEL`` and ``VERCEL_ENV`` to the runtime only while the project's "Enable access to System
#: Environment Variables" setting is ticked; ``AWS_LAMBDA_FUNCTION_NAME`` is a second signal, though
#: whether Vercel's Python runtime sets it is unproven. The Deploy workflow's check of ``/healthz``
#: settles whether any is present.
PLATFORM_SIGNALS = ("VERCEL", "VERCEL_ENV", "VERCEL_REGION", "AWS_LAMBDA_FUNCTION_NAME")

_TRUTHY = ("true", "1")


def switch_on(name: str) -> bool:
    """Whether the switch ``name`` is on: ``true`` or ``1``, trimmed and in any case.

    The one reading of every switch in ``LOCAL_SWITCHES``, so the refusal below and the code each
    switch changes can never disagree about whether it is on.
    """
    return os.getenv(name, "").strip().lower() in _TRUTHY


def insecure_local_dev() -> bool:
    """Whether this process has been told, explicitly, that it is a local development one."""
    return switch_on(INSECURE_LOCAL_DEV_VAR)


def deployed_host() -> Optional[str]:
    """The first platform variable that says this process runs on a deployed host, or ``None``."""
    for signal in PLATFORM_SIGNALS:
        if os.getenv(signal, "").strip():
            return signal
    return None


class LocalSwitchOnDeployedHostError(RuntimeError):
    """A local-development or test switch is on where the platform says this is deployed."""


def _listed(names: list) -> str:
    """``a``, ``a and b``, ``a, b and c``."""
    if len(names) == 1:
        return names[0]
    return f"{', '.join(names[:-1])} and {names[-1]}"


def assert_no_local_switch_on_deployed_host() -> None:
    """Refuse every switch in ``LOCAL_SWITCHES`` on a host the platform says is deployed.

    Raises:
        LocalSwitchOnDeployedHostError: naming each switch that is on, in ``LOCAL_SWITCHES`` order,
            and the platform variable that said the host is deployed.
    """
    signal = deployed_host()
    if signal is None:
        return
    on = [switch for switch in LOCAL_SWITCHES if switch_on(switch)]
    if not on:
        return
    raise LocalSwitchOnDeployedHostError(
        f"This process runs on a deployed host ({signal} is set, and only the platform sets it), "
        f"and {_listed(on)} {'is' if len(on) == 1 else 'are'} on. Each is a local-development or "
        f"test switch: {INSECURE_LOCAL_DEV_VAR} turns off the defenses this check requires, "
        f"DISABLE_CAPTCHA lets every caller sign up, DISABLE_EMAIL sends no mail and reports it "
        f"sent, and DISCORD_FAKE answers for Discord from the database. Remove them from the "
        f"deployment's environment (Vercel, the back-end project, Settings, Environment Variables), "
        f"and make sure no back-end/.env file is deployed, then deploy again."
    )


def warn_insecure_local_dev(defense: str) -> None:
    """Name the defense that is off and the variable that turned it off, every time it is skipped."""
    logger.warning(
        "%s is off because %s is set. That is a local-development escape hatch: the public signup, "
        "verification, password-reset and OTP endpoints are unauthenticated, they write to the "
        "database, and they send mail from this domain. Never set %s on a deployed environment.",
        defense, INSECURE_LOCAL_DEV_VAR, INSECURE_LOCAL_DEV_VAR,
    )
