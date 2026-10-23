---
layer: implementation
kind: convention
describes:
  - back-end/app.py#check_public_endpoint_defenses
  - back-end/app.py#configure_public_endpoint_defenses
  - back-end/utils/deployment.py
  - back-end/utils/session_storage.py
  - back-end/utils/env_file.py
  - back-end/utils/cors.py
  - back-end/utils/proxy.py
  - back-end/utils/captcha.py
  - back-end/utils/email.py
  - back-end/tests/test_public_endpoint_defenses.py
  - front-end/vite.config.ts#assertCaptchaSiteKey
  - front-end/src/utils/captcha.ts
verified: 2026-10-22
---

# Security invariants

**A security control never keys on a variable whose default is the insecure value.**
That is the root cause of the two holes the boot check closed: `SECRET_KEY` fell back to a committed literal, and the CORS policy was gated on `FLASK_ENV`, whose default (`development`) ran the permissive branch on every deployment.
The secure state is the one a forgetful operator gets; anything less secure has to be asked for, by name.

## The boot check

The back end refuses to boot without six things, all checked by [`check_public_endpoint_defenses()`](../../../back-end/app.py) and named together in one refusal, so an operator does not meet them one redeploy at a time:

| Variable | Read by | Defends |
| --- | --- | --- |
| `SECRET_KEY` | `utils/secret_key.py` | the session cookie: without it any organizer's session can be forged |
| `RECAPTCHA_SECRET_KEY` | [`utils/captcha.py`](../../../back-end/utils/captcha.py) | `POST /register`, the public signup |
| `CORS_ALLOWED_ORIGINS` | [`utils/cors.py`](../../../back-end/utils/cors.py) | which websites may spend the organizer's `SameSite=None` cookie; `*` is refused, and so is an entry that is not an origin |
| `RESEND_API_KEY` | [`utils/email.py`](../../../back-end/utils/email.py) | the mail that carries every verification link, reset link and sign-in code |
| `SESSION_TYPE` | [`utils/session_storage.py`](../../../back-end/utils/session_storage.py) | where the session is kept: `null` (the signed cookie, a serverless host) or `filesystem` (a container or VM), with no default |
| `TRUSTED_PROXY_HOPS` | [`utils/proxy.py`](../../../back-end/utils/proxy.py) | the address reCAPTCHA scores a signup on, and the caller the applicant sign-in limits count |

Three fail silently when unset (the captcha passes everybody, a forgeable session, a credentialed policy for every origin); the mail key and the session store fail loudly but name nothing; the hop count fails more quietly than any, showing only in a reCAPTCHA score.
What each one is, and what an unset one would do, is the deployment's checklist in [RELEASING.md](../../RELEASING.md#pre-deploy-required-production-environment); **keep that table in step with the check**, because a deploy doc that is wrong is worse than one that is missing: it will be trusted.

**The check is a check.**
`check_public_endpoint_defenses()` reads configuration and returns what it found; [`configure_public_endpoint_defenses()`](../../../back-end/app.py) is the only thing that touches the app, installing the key, the CORS policy, the proxy fix and the session store, in that order.
Keep them apart: flask-cors installs an `after_request` handler per call, so a check with side effects stacked one onto the live app every time anything asked it a question.

**A boot requirement defends something the product serves.**
A requirement with nothing behind it teaches operators to work around the check.
`TRUSTED_PROXY_HOPS` is required because `request.remote_addr` is what organizer signup hands Google as reCAPTCHA's `remoteip` (`api/users.py`), and it became load-bearing the moment `RECAPTCHA_SECRET_KEY` did: before, a deployment with no secret took the bypass and no token reached Google.
The applicant sign-in limits count each caller by the same address ([a vendor signs in before applying](../../business/rules/a-vendor-signs-in-before-applying.md#sign-in-is-bounded)), so a wrong hop count would put every applicant behind one caller's limit.
Make a requirement follow its caller, not the module it was first written for.

## The one escape hatch

**`ALLOW_INSECURE_LOCAL_DEV` is the only escape hatch for the six** ([`back-end/utils/deployment.py`](../../../back-end/utils/deployment.py)), and it defaults to off.
Under it a missing value boots: a random signing key for the process's lifetime, loopback origins, sessions on disk, zero hops, no captcha secret and no mail key; each is logged as a defense turned off.
`DISABLE_CAPTCHA` and `DISABLE_EMAIL` are honoured only under the hatch, so a deployment that inherited either from a copied env file is not silently unprotected.
The hatch never excuses a published secret ([ADR 0010](../../adr/0010-no-secret-has-a-fallback.md)).
`docker-compose.yml` and `back-end/.env.example` set it; it must never be set on a deployed environment.

**`FLASK_ENV` does not exist in this repository**: nothing reads it, and nothing sets it.
It is gone from the Dockerfile, `docker-compose.yml` and the env templates, so the invariant is structural: a variable nobody sets is one nobody can key on.
Do not reintroduce it.
The image used to export `development`, so anything keyed on it read the same on a deployment as on a laptop: that is how the CORS hole survived, and how `SESSION_TYPE` came to default to `filesystem` on serverless hosts that have no disk.

**`SESSION_COOKIE_SECURE` is not configurable at all**: a `SameSite=None` cookie is accepted by a browser only when it is Secure, so a switch could only ship a cookie the browser drops.
Loopback counts as a secure context, so local development is unaffected.

**`SESSION_TYPE=null` installs no session store.**
flask-session has no `null` backend and raises on one; Flask's own interface signs the session into the cookie, the only store a serverless function has.
Do not "fix" a `null` deployment by handing it to `Session(app)`.
`filesystem` is served through cachelib's file cache handed to flask-session directly, since flask-session's own `filesystem` interface is deprecated.

## Secrets are read when they are asked for

**Every secret is read from the environment on each call, never captured at import.**
`signing_secret()`, `verifiable_secret()` and `sendable_key()` call `os.getenv` per call, so the boot check is a function of the environment rather than of the import order that produced it, and `resend.api_key` is set on the way into each send (`ready_mailer()`).
Two of them once read their key into a module global, and that cost three bugs: a `.env` loaded afterwards was one nobody saw, `monkeypatch.delenv` on those variables was a silent no-op, and every test had to know which module attribute to patch, so a test that "cleared the secret" cleared nothing.
Do not reintroduce a module-level `os.getenv` for a secret.

**`back-end/.env` is read by [`utils/env_file.py`](../../../back-end/utils/env_file.py), called on `app.py`'s first line**, before the imports below it build their Mongo clients.
Nothing loaded that file until the boot check existed, and a developer who followed [STARTUP.md](../../STARTUP.md) met a refusal naming the variable they had just set.
The real environment wins (`override=False`): the Docker stack bind-mounts `back-end/` into the container, so a stray `.env` must never hand a process an escape hatch or a signing key it did not choose.
**The test suite reads no `.env` at all**: [`back-end/tests/conftest.py`](../../../back-end/tests/conftest.py) points `utils.env_file.ENV_FILE` at a path that does not exist, because a suite whose result depends on an untracked file is green in CI and red on the laptop of anyone whose `.env` still carries what an old template printed.

**Every env template ships blanks, and boots as it stands.**
A placeholder that is truthy is worse than a blank, because a check that asks only whether a variable is set takes it for a configured secret.
[`back-end/.env.example`](../../../back-end/.env.example) sets the hatch with `DISABLE_CAPTCHA` and `DISABLE_EMAIL`, and `test_the_local_development_template_boots_as_it_stands` ([`test_public_endpoint_defenses.py`](../../../back-end/tests/test_public_endpoint_defenses.py)) runs it through the real boot check, so an edit that pins an origin or reinstates a placeholder fails there rather than on a laptop.

## The front end's half

**`VITE_RECAPTCHA_SITE_KEY` is the other half of `RECAPTCHA_SECRET_KEY`, and a build-time requirement.**
A bundle with no site key sends a placeholder token ([`front-end/src/utils/captcha.ts`](../../../front-end/src/utils/captcha.ts)), which a back end with a real secret hands to Google, who never issued it, so every signup answers 400 on a deployment that looks healthy.
So `vite build` refuses a bundle without it ([`assertCaptchaSiteKey`](../../../front-end/vite.config.ts)), with the escape hatch of the same name, `VITE_ALLOW_INSECURE_LOCAL_DEV`, under which the bundle warns and sends the placeholder, which only a back end with `DISABLE_CAPTCHA` accepts.
A keyless bundle built without the hatch throws rather than sending it.
A defense on only one side of the wire is not one.
Vite's `loadEnv` reads `front-end/.env` and never `.env.example`, so `cp .env.example .env` is a step in `front-end/` too; [STARTUP.md](../../STARTUP.md) names both copies.

## How it is enforced

- One test module per requirement (`test_secret_key.py`, `test_cors.py`, `test_captcha.py`, `test_email.py`, `test_session_storage.py`, `test_proxy.py`), and `test_public_endpoint_defenses.py` for the refusal itself: it names every missing variable, `ALLOW_INSECURE_LOCAL_DEV` is the only waiver, and the template boots.
- `test_configured_secret.py` and `test_env_file.py` pin the machinery underneath; [TESTING.md](../../TESTING.md#back-end-tests) lists them.
- What breaks it: a default for any of the six, a check that installs something, a secret read at import, a template that prints a value, or a hatch that excuses a published key.
