"""Which address this deployment may believe the caller's is.

``request.remote_addr`` is the immediate peer, which is the caller only when nothing sits in front of
Flask. Behind a reverse proxy, a load balancer, or a serverless ingress it is the *proxy* - the same
address for every caller in the world.

One thing on this branch reads it: organizer signup hands it to Google as reCAPTCHA's ``remoteip``
(``api/users.py`` -> ``utils.captcha.verify_recaptcha``). reCAPTCHA v3 scores rather than passes or
fails, and the address is one of the signals it scores on, so a deployment that reports its own
ingress as the client reports the same client for every signup in the world, and scores it against
``MIN_SCORE`` accordingly. That was survivable while the secret was optional, because a deployment
without one took the dev-bypass path and no token was ever sent to Google. The secret is a boot
requirement now, which is what puts every deployment on this path and makes this variable
load-bearing: the captcha is genuinely enforced for the first time, so the address it is enforced
against has to be the caller's.

The fix is not to trust ``X-Forwarded-For``: any caller can write that header, so trusting it whole
lets a caller name any address it likes. Only the hops the deployment actually owns may be trusted,
and only the deployment knows how many those are, so it has to say: ``TRUSTED_PROXY_HOPS`` is the
number of proxies of its own that a request passes through, and ProxyFix reads exactly that many
entries from the right-hand end of the header - the end the trusted proxies appended, which is the
part a client cannot forge.

Unset is not "zero", it is "unknown", and an unknown value silently produces one of the two failures
above. So it fails closed, at boot, naming the variable: 0 is a legitimate value and an operator who
means it can say so. The only process exempt from saying so is one that has explicitly declared
itself a local development one - see ``utils.deployment`` for why that, and not ``FLASK_ENV``, is the
escape hatch.

The rate limits that will also key on this address are not on this branch; they land with the
applicant endpoints they bound. This variable is here because the captcha is here.
"""

import os

from flask import Flask
from werkzeug.middleware.proxy_fix import ProxyFix

from utils.deployment import (
    INSECURE_LOCAL_DEV_VAR,
    insecure_local_dev,
    warn_insecure_local_dev,
)

TRUSTED_PROXY_HOPS_VAR = "TRUSTED_PROXY_HOPS"


class TrustedProxyConfigError(RuntimeError):
    """The deployment has not said how many proxies of its own a request passes through."""


def trusted_proxy_hops() -> int:
    """How many proxies in front of this app are the deployment's own, and therefore trustworthy.

    Raises:
        TrustedProxyConfigError: when the value is missing on anything but an opted-in local
            development process, or when it is set to something that is not a hop count.
    """
    raw = os.getenv(TRUSTED_PROXY_HOPS_VAR, "").strip()

    if not raw:
        if not insecure_local_dev():
            raise TrustedProxyConfigError(
                f"{TRUSTED_PROXY_HOPS_VAR} is not set. It is the number of proxies of this "
                f"deployment's own that a request passes through before it reaches Flask (a reverse "
                f"proxy, a load balancer, or a serverless ingress each count as one). Without it, "
                f"the address this app takes for the caller's is the proxy's - the same address for "
                f"every caller in the world - and that address is what organizer signup reports to "
                f"reCAPTCHA, which scores on it. Set it to 0 only if Flask is exposed directly, or "
                f"set {INSECURE_LOCAL_DEV_VAR}=true if this really is a local development machine."
            )
        warn_insecure_local_dev(f"the trusted-proxy hop count ({TRUSTED_PROXY_HOPS_VAR})")
        return 0

    try:
        hops = int(raw)
    except ValueError as exc:
        raise TrustedProxyConfigError(
            f"{TRUSTED_PROXY_HOPS_VAR} must be a whole number of proxies, not {raw!r}."
        ) from exc

    if hops < 0:
        raise TrustedProxyConfigError(
            f"{TRUSTED_PROXY_HOPS_VAR} must be zero or more, not {hops}."
        )

    return hops


def install_trusted_proxy_fix(app: Flask, hops: int) -> None:
    """Make ``request.remote_addr`` the caller's address on a deployment with ``hops`` proxies.

    Takes the hop count rather than reading it, for the same reason ``install_cors`` takes the origin
    list: asking whether this deployment is configured must not configure it.

    With no trusted hops the peer address is the caller's already, and nothing is wrapped: leaving
    ProxyFix out of that path is what keeps a forwarded header from being read where there is no
    proxy entitled to have set one.
    """
    if not hops:
        return

    app.wsgi_app = ProxyFix(
        app.wsgi_app, x_for=hops, x_proto=hops, x_host=0, x_port=0, x_prefix=0,
    )
