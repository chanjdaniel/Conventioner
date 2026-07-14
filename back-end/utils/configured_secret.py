"""What counts as a configured secret, for every secret this app refuses to boot without.

A secret is a value only the deployment holds. Two shapes of value are not that, and both arrive by
the same route - an operator who copied a template and did not finish filling it in:

* A **blank** one. ``FOO=`` and ``FOO="   "`` are the shape a forgotten variable takes in a ``.env``
  file, and a check that reads the raw value takes the second for a configured secret.
* A **published placeholder**. Every value in ``PUBLISHED_VALUES`` has been printed in this
  repository - in an env template, in the deploy guide, or (for the signing key) as a committed
  fallback - so each is readable by anyone who can read the repo, which is the one thing a secret
  may not be.

The placeholder is the worse of the two, because it is *truthy*: a check that asks only whether the
variable is set passes, and the failure lands later and elsewhere - reCAPTCHA verifying every signup
against a key Google never issued, Resend rejecting ``re_xxxxx`` while the new account rolls back
behind a 500, and, for the signing key, no failure at all and every session forgeable. A check that
can be satisfied with garbage is not a check. Neither shape counts as configured here, so the
failure lands at boot with the variable named instead.

The shape rules are there because the literal list cannot be complete: the placeholder somebody
writes into a template tomorrow is one nobody has added here yet. A run of x's and a ``your-`` prefix
are what every placeholder in this repository's history looks like, and a generated key looks like
neither - four x's in a row is a one-in-a-million accident in a random 32-character key, and the
refusal tells its holder to generate another.
"""

import re

# Every value this repository has printed where a secret goes: the signing-key fallback that used to
# live in ``utils.secret_key``, and the placeholders carried by the env templates, the front-end
# template and docs/VERCEL_DEPLOYMENT.md. Each is one `git log` away from anybody. Add to this set
# rather than letting a doc or a template print a usable-looking key.
PUBLISHED_VALUES = frozenset({
    "temp_key_change_in_production",
    "your-secret-key-here-change-in-production",
    "your-strong-secret-key-here",
    "your-secret-key-here",
    "re_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "your-resend-api-key",
    "6lcxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "your-recaptcha-secret-key",
})

_PLACEHOLDER_SHAPES = (
    re.compile(r"xxxx", re.IGNORECASE),
    re.compile(r"^your[-_ ]", re.IGNORECASE),
    re.compile(r"^<.*>$"),
)


def is_published(value: str) -> bool:
    """Whether ``value`` is one this repository has printed where a secret goes.

    Case does not launder it, and neither does a placeholder nobody has listed yet: a value shaped
    like the ones this repo has published is treated as published.
    """
    candidate = (value or "").strip()
    if not candidate:
        return False
    if candidate.lower() in PUBLISHED_VALUES:
        return True
    return any(shape.search(candidate) for shape in _PLACEHOLDER_SHAPES)


def configured_secret(value: str) -> str:
    """The secret ``value`` holds, or ``""`` when it holds none.

    Takes the value rather than the variable name, because that is what the three callers have. Each
    reads its own variable from the environment when it is asked - ``secret_key.signing_secret``,
    ``captcha.verifiable_secret`` and ``email.sendable_key``, none of them at import - and hands the
    value here. All three ask this one question, so the stripping happens once and no caller can
    disagree with the boot check about what a configured deployment looks like.

    A blank value and a published one both answer ``""``, because neither is a secret. Which of the
    two it was is ``is_published``'s to say, so a refusal can name what it actually met rather than
    telling an operator who filled the variable in that they left it empty.
    """
    candidate = (value or "").strip()
    if is_published(candidate):
        return ""
    return candidate
