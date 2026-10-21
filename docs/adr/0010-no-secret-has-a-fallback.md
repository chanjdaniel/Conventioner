---
layer: implementation
kind: adr
describes:
  - back-end/utils/secret_key.py
  - back-end/utils/configured_secret.py
verified: 2026-10-21
status: accepted
---

# No secret has a fallback

## Context

`SECRET_KEY` used to fall back to a literal committed to this repository.
On any deployment that forgot the variable, the key signing every organizer's session cookie was a string anyone could read off the source, so a cookie naming any organizer could be minted and spent against the organizer API with no password and no login.
Deleting the literal was only half of it: the value stays readable in the history, and in every deployment that was signing with it.
An operator who meets a boot refusal has an incentive pointing straight back at it, because a fresh key signs every organizer out once and the old literal does not.

The other two secrets had the neighbouring problem.
The env templates and the deploy guide printed placeholders where `RECAPTCHA_SECRET_KEY` and `RESEND_API_KEY` go (`re_xxxxx`, `6Lcxxxxx`, `your-...`), and a check that asks only whether a variable is set passes on one.
The failure then lands at request time instead of at boot: reCAPTCHA verifying every signup against a key Google never issued, Resend rejecting every verification mail behind a 500.

## Decision

No secret in this repository has a fallback, not even "for dev".
A committed fallback is a published key.

[`back-end/utils/configured_secret.py`](../../back-end/utils/configured_secret.py) is the single answer to "does this variable hold a secret?", and all three secrets ask it: `signing_secret()` ([`back-end/utils/secret_key.py`](../../back-end/utils/secret_key.py)), `verifiable_secret()` (`utils/captcha.py`) and `sendable_key()` (`utils/email.py`).
`configured_secret()` strips the value, and a blank value or a published one is not a secret.
`is_published()` refuses every value this repository has printed where a secret goes (`PUBLISHED_VALUES`, case does not launder one) and anything shaped like one: a run of four x's, a `your-` prefix, a value in angle brackets.

A published value is refused by name, on a laptop as on a deployment.
`ALLOW_INSECURE_LOCAL_DEV` does not excuse one, for any of the three: the hatch exists so a process with **no** key can boot, and a `.env` holding a published literal is exactly the file that gets copied onto a deployment.
With the hatch and no `SECRET_KEY`, the process signs with a random key minted for its own lifetime, never a fixed one.
A `SECRET_KEY` shorter than 32 characters is refused too (`MINIMUM_SECRET_LENGTH`): it is a guess away from a secret, brute-forced offline from one cookie.

## Consequences

- Setting `SECRET_KEY` for the first time, or rotating it, ends every session signed with the old key: organizers log in again, once.
  That is the price of the key not being public, and never a reason to reach for the old value.
- A refusal says which it met: a blank value is reported as unset, a published one as published, because `FOO=` is what a forgotten variable looks like and a filled-in placeholder is not.
- A new placeholder belongs in `PUBLISHED_VALUES`; better, no doc or template prints a usable-looking key.
  Every env template ships blanks, with `DISABLE_CAPTCHA` and `DISABLE_EMAIL` on, so there is nothing to copy.
- Four x's in a row is a one-in-a-million accident in a random 32-character key; its holder is told to generate another.
- A local process that restarts with the hatch and no key signs its sessions out, since its random key changes each boot.
- An optional key reads through the same answer: `TYPESAFE_API_KEY` treats a blank or a placeholder as unset ([ADR 0007](0007-what-may-be-sent-to-hosted-typesafe.md)).

The boot check that asks these questions, and the rest of the rules around it, are the [security invariants](../implementation/conventions/security-invariants.md); the deployment's side is [RELEASING.md](../RELEASING.md#pre-deploy-required-production-environment).

## Considered and rejected

- **A fallback key for local development only**: whatever selects "local" has a default, and a security control keyed on a variable whose default is the insecure value is no control; `FLASK_ENV` was exactly that.
- **Accepting any non-empty value**: it passes the placeholders the templates printed, and moves the failure from boot, where it names the variable, to a request, where it names nothing.
- **Letting the hatch excuse a published key, as it excuses a missing one**: the hatch would then be the way a published key reaches a deployment.
