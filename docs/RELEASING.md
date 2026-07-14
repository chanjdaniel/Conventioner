# Release Process

## Branch Model

This project uses a **dev → main promotion flow**:

- **`dev`** is the default/integration branch.
  All feature branches and bugfix PRs target `dev`.
  CI (`.github/workflows/test.yml`) runs on every push and PR to `dev`.
- **`main`** is the deploy-only branch.
  It auto-deploys and is reached **only** by promoting `dev` → `main` as a deliberate, versioned release.
  Never commit or open PRs directly against `main`.

```
feature/* ──PR──▶ dev ──promotion──▶ main (versioned release + deploy)
```

## Conventional Commits

All commits MUST follow [Conventional Commits](https://www.conventionalcommits.org/) to enable automatic versioning.
The commit message format is:

```
<type>(<scope>): <description>

[optional body]
```

**Types and their semver effect:**

| Type       | Semver Bump | Example                              |
|------------|-------------|--------------------------------------|
| `fix:`     | PATCH       | `fix(api): handle null market items` |
| `feat:`    | MINOR       | `feat(ui): add drag-and-drop floorplan editor` |
| `feat!:` / `fix!:` (BREAKING CHANGE in body) | MAJOR | `feat!: drop support for legacy schema` |
| `docs:`, `style:`, `refactor:`, `perf:`, `test:`, `chore:`, `ci:`, `build:` | NONE (no release) | `chore(deps): bump axios to 1.13` |

## Release Process (Automated)

Release management is handled by [release-please](https://github.com/googleapis/release-please) (GitHub Action `googleapis/release-please-action@v5`) via `.github/workflows/release-please.yml`.

### How a Release Happens

1. **Feature work lands on `dev`** through normal PRs with conventional commit messages.
2. **A maintainer promotes `dev` → `main`** (e.g., `git checkout main && git merge dev && git push`).
   This is the **only** way code reaches `main`.
3. **release-please detects the new commits on `main`** and automatically opens (or updates) a **Release PR** targeting `main`.
   This PR contains:
   - A version bump in `.release-please-manifest.json`
   - An updated `CHANGELOG.md` with all changes since the last release
4. **A maintainer reviews and merges the Release PR.**
   On merge, release-please automatically:
   - Creates a **git tag** (e.g., `v0.1.0`)
   - Creates a **GitHub Release** with the changelog content
   - The deploy pipeline picks up the tag and deploys

### Bootstrapping Note

The release-please workflow becomes active once it reaches `main` (via the first `dev` → `main` promotion after this config is merged to `dev`).
The manifest is seeded at `0.0.0`, and the first release is pinned to `v0.1.0` via `"release-as": "0.1.0"` in `release-please-config.json`.

`release-as` is a forced version: it overrides the conventional-commit calculation on **every** run until it is removed, so it must be cleared after the first release ships.
Once `v0.1.0` is tagged, remove the `release-as` field from `release-please-config.json`; from then on release-please derives each version from the accumulated commits (`feat:` → minor, `fix:` → patch, breaking change → major).

## Pre-Deploy: Required Production Environment

The back end **refuses to start** unless all six of these are set, and it fails at import, so a deployment that is missing one serves nothing at all.
Set them in the hosting environment **before** promoting `dev` → `main`.
The startup log names every variable that is missing, all of them at once.

Two consequences of that are worth knowing before you promote, because both are easier to meet head-on than to be ambushed by:

1. **The app does not degrade without these - it does not boot.**
   The check runs at import, which on a serverless host (Vercel) means on *every cold start*.
   A promotion that lands before the variables are set takes the deployment down rather than serving a weakened version of it.
   That is deliberate: each of these fails silently or unhelpfully when unset, and a deployment that half-works with its defenses off is the thing this check exists to prevent.
2. **The first deploy necessarily signs with a new `SECRET_KEY`, which ends every organizer session that exists today.**
   There is no fallback key any more, and the old committed one is refused by name, so the key cannot be the one production is signing with right now.
   Organizers are asked to log in again, once.
   That is the price of the key not being public, and reaching for the old value to avoid it is reaching for the vulnerability.

Three of them are defenses, and each fails *silently* when unset - it stops defending and says nothing.
Two are required for the opposite reason: unset, the mail key breaks every route into an organizer account one 500 at a time, and the session backend sends a serverless deployment looking for a disk it does not have - and neither of those failures names the variable behind it.
The sixth, the trusted-hop count, is quieter than any of them: nothing visibly breaks, and the only place an unset one shows is a reCAPTCHA score.

| Variable | What it is | What an unset value would do |
|----------|------------|------------------------------|
| `SECRET_KEY` | A long random string, at least 32 characters. Signs the Flask session cookie. Generate with `python -c 'import secrets; print(secrets.token_urlsafe(48))'`. | The session cookie would be signed with a key published in this repository, so anyone could forge a session for any organizer and read and write their markets, vendors and applications - no password, no login. |
| `RECAPTCHA_SECRET_KEY` | The reCAPTCHA v3 secret ([admin console](https://www.google.com/recaptcha/admin)). Gates the public organizer signup endpoint (`POST /register`). | The captcha would pass every caller, leaving an unauthenticated endpoint that writes a user document and sends mail from our domain with nothing in front of it. |
| `CORS_ALLOWED_ORIGINS` | The comma-separated list of browser origins allowed to make credentialed requests to the API, each written exactly as a browser sends it - `https://app.example.com`, no trailing slash, no path. Usually just the front end's own origin. | The API answers cross-site requests with `Access-Control-Allow-Credentials: true`, and the organizer's session cookie is `SameSite=None`, so with no origin list every website an organizer visits could read and write the organizer API - markets, vendors, applications - as them. `*` is refused for the same reason. |
| `RESEND_API_KEY` | The Resend API key ([dashboard](https://resend.com/api-keys)). Delivers the email-verification link, the password-reset link, and the OTP login code. | No organizer could get an account at all: registration rolls the new user back and answers 500 when the verification mail cannot be sent, an unverified account cannot log in, and password reset and OTP answer 500. The deployment would look healthy and onboard nobody. |
| `SESSION_TYPE` | Where the organizer's session is kept: `null` on a serverless host (Vercel), which keeps it in the signed cookie, or `filesystem` on a container or VM, which keeps it on local disk. | Neither value is right for both hosts, so there is no default to fall back on. A serverless deployment that got `filesystem` would go looking for a disk that does not outlive a request: it raises at import, every request answers 500, and nothing in the log names this variable. It used to be derived from `FLASK_ENV`, which our own image pins to `development` - so the derivation answered `filesystem` on precisely the deployments that have no filesystem. |
| `TRUSTED_PROXY_HOPS` | How many proxies of **this deployment's own** a request passes through before it reaches Flask - a reverse proxy, a load balancer, or a serverless ingress each count as one. Vercel is `1`. `0` means Flask is exposed directly, and is a legitimate answer an operator has to give deliberately. | This is the address organizer signup reports to Google as reCAPTCHA's `remoteip`, and reCAPTCHA v3 *scores* on it rather than passing or failing. Unset behind an ingress, that address is the ingress's - the same client, reported for every signup in the world - so real organizers are scored against `MIN_SCORE` on a signal that describes none of them. Setting it too high is the mirror failure: `X-Forwarded-For` is written by the caller, so trusting a hop the deployment does not own lets a caller name any address it likes. Only this variable makes the captcha - which this release enforces for the first time - score the person actually signing up. |

There is deliberately **no default** for any of them.
A default that quietly becomes the production value is the failure each of these checks exists to prevent - the signing key was such a default, and it was a literal committed to this repository.

For the same reason, **every value this repository has printed where a secret goes is refused by name** - by all three of `SECRET_KEY`, `RECAPTCHA_SECRET_KEY` and `RESEND_API_KEY`, and on a laptop as on a deployment (`back-end/utils/configured_secret.py`).
That covers the old `TEMP_KEY_CHANGE_IN_PRODUCTION` fallback, the `re_xxxxx` and `6Lcxxxxx` placeholders the env templates and this guide once carried, and anything shaped like them (a run of x's, a `your-` prefix).
They are all one `git log` away from anybody, so setting one back would clear the boot refusal and leave the vulnerability exactly where it was.

A placeholder is refused rather than accepted because it is **truthy**, which is the whole problem: a check that asks only whether a variable is set passes on `re_xxxxx`, and the deployment then fails at request time instead - reCAPTCHA verifying signups against a key Google never issued, Resend rejecting every verification mail behind a 500.
A check that can be satisfied with garbage is not a check.
A blank value is refused for the same reason and reported differently, because `FOO=` is what a forgotten variable looks like, not a filled-in one.

Note that **setting `SECRET_KEY` for the first time, or rotating it, ends every session signed with the old key**: organizers are asked to log in again, once.
That is the price of the key not being public, and it is not a reason to reach for the old one.

The one exemption is `ALLOW_INSECURE_LOCAL_DEV=true`, which `docker-compose.yml` and `back-end/.env.example` set and which logs every defense it turns off.
It must never be set on a deployed environment.

`TRUSTED_PROXY_HOPS` is here for the captcha, and for nothing else yet.
The one thing on this branch that reads the caller's address is the `remoteip` hint organizer signup passes to reCAPTCHA, and that hint only started mattering when `RECAPTCHA_SECRET_KEY` became a boot requirement: before, a deployment without a secret took the dev-bypass path and no token ever reached Google.
The per-IP rate limits that will also key on this address are not on this branch - they land with the applicant endpoints they bound - so do not read this variable as configuring a limiter that does not exist yet.

### The front end has one requirement too, and it is the other half of the reCAPTCHA pair

| Variable | Where it is set | What an unset value would do |
|----------|-----------------|------------------------------|
| `VITE_RECAPTCHA_SITE_KEY` | The **front end's build environment** (Vercel: the front-end project's environment variables). The site key of the *same* reCAPTCHA property as the back end's `RECAPTCHA_SECRET_KEY` - the two are a matched pair, and a key from another property fails exactly as an absent one does. | The bundle would carry no site key, so it has no captcha to solve and sends a placeholder token instead. The back end verifies that token against Google, Google never issued it, and `POST /register` answers 400 - every organizer signup, on a deployment that looks healthy and logs nothing about it. |

Making `RECAPTCHA_SECRET_KEY` a boot requirement is what makes this one load-bearing.
Before, a back end with no secret took its dev-bypass path and waved the placeholder token through, so a front end with no site key worked.
It cannot now: the back end refuses to boot without a real secret, and a real secret rejects a token Google did not issue.

It is a **build-time** variable, not a runtime one - Vite bakes it into the bundle - so setting it after the fact does nothing until the front end is rebuilt.
`vite build` refuses to produce a bundle without it (`front-end/vite.config.ts`), for the same reason the back end refuses to boot without its half: the alternative is a deployment that ships, looks fine, and cannot register a single organizer.
The one exemption is `VITE_ALLOW_INSECURE_LOCAL_DEV=true`, which `front-end/.env.example` and `docker-compose.yml` set and which warns on every build it lets through.
It must never be set on a deployed build.

## Pre-Deploy: Database Migrations

Migrations are never run automatically - rewriting stored documents is a deliberate operator action.
Before a promotion reaches production, run the pending migrations in `back-end/migrations/` against the production database (each is idempotent, and `--dry-run` previews the changes):

```bash
python migrations/migrate_phase.py                    # backfills `phase` on existing markets
python migrations/migrate_market_keys.py              # rewrites market documents into canonical form (camelCase keys + stored slug, builds slug index)
python migrations/migrate_is_draft_consistency.py     # makes `isDraft` agree with `phase` on markets that have one
python migrations/create_applications_collection.py   # creates the applications collection and its `market_id` index
```

`create_applications_collection.py` creates the applications collection and indexes it on `market_id`, which is the lookup the D9 application-form lock counts on.
It is not a uniqueness constraint and nothing on this branch depends on one: the collection has no public writer yet, so the only documents in it are the ones an operator or a test put there.

`migrate_is_draft_consistency.py` **must** be run with the code that makes `phase` the single source of truth, and it is the migration whose omission is visible to vendors.
A market the old build published carries `phase: "draft"` + `isDraft: false` (publishing was a `PUT` of `isDraft: false`; nothing advanced the phase), and every read now derives the market's state from `phase`.
`draft` is a recognized phase, so it is taken at face value: until the migration advances those markets to `archived`, an already-live market reverts to looking unpublished - its public check-in URL returns `404`, and its organizer is routed back into the setup wizard.
The migration repairs that disagreement in favour of `isDraft`, because on those documents `isDraft` was the only publish signal that ever existed.
Run it after `migrate_phase.py`: the two are disjoint by construction (one touches only documents *with* a `phase`, the other only those without), but that ordering means a database migrated in one pass ends up fully consistent.

`migrate_market_keys.py` **must** be run before the code that reads market documents by the canonical key only and the code that queries the stored slug.
An unmigrated market is invisible to every such read: vendors are told the market does not exist at check-in, applicants get a 404 at the public market URL, and organization members get an empty market list.
The migration records both of its marker documents (`market_document_keys` and `market_slugs`) in the `schema_migrations` collection, builds the `market_slug` index, and the back end refuses to boot unless it can read both markers; the fatal log names every missing one and the script to run.
The check fails closed on anything short of confirmed markers - an unknown migration state is not a migrated one - so a deploy that skipped the migration fails loudly at startup rather than quietly serving half the data.

## Files

| File | Purpose |
|------|---------|
| `release-please-config.json` | Configures release-please behavior (release type, tag format); holds the one-time `release-as: 0.1.0` bootstrap that must be removed after the first release |
| `.release-please-manifest.json` | Tracks current version per package (auto-updated by release-please); seeded at the `0.0.0` baseline, with the first release pinned to `v0.1.0` via `release-as` |
| `.github/workflows/release-please.yml` | GitHub Actions workflow that runs release-please on pushes to `main` |
| `CHANGELOG.md` | Auto-generated changelog (created on first release) |
