---
layer: implementation
kind: runbook
describes:
  - .github/workflows/deploy.yml
  - .github/workflows/release-please.yml
  - release-please-config.json
  - back-end/app.py#check_public_endpoint_defenses
  - front-end/vite.config.ts#assertCaptchaSiteKey
verified: 2026-10-28
sources:
  - T74
---

# Release Process

## Branch Model

This project uses a **dev → main promotion flow**:

- **`dev`** is the default/integration branch.
  All feature branches and bugfix PRs target `dev`.
  CI (`.github/workflows/test.yml`) runs on every push and PR to `dev`.
- **`main`** is the deploy-only branch.
  It is deployed only by hand, through the Deploy workflow, and is reached **only** by promoting `dev` → `main` as a deliberate, versioned release.
  Never commit or open PRs directly against `main` (the release-please Release PR and a `hotfix/` PR are the exceptions, [below](#hotfixes)).

**Both branches are protected** (since 2026-10-18): a PR into either needs the `backend`, `frontend-unit`, `frontend-lint-and-types`, `docker-build`, `e2e` and `zizmor` checks to pass (`e2e` passes only when all four shards do), and a push to `main` is accepted only for a commit that has passed them.
A PR into `dev` also needs `knowledge-graph`, `real-data`, `CodeQL` and `agent-review`, ten in all; `main` asks only the six ([CI and the gate](implementation/testing/ci-and-the-gate.md#ci)).
Branches need not be up to date before merging, because a promotion is only ever made from a commit whose own `dev` run passed.
`main` keeps a linear history; force pushes are blocked on both.
Admins can override `main`'s protection, deliberately: it is how the Release PR is merged (below), and the way out in an emergency.
`dev`'s binds admins too (`enforce_admins`): nothing merges into `dev`, the merge of `main` back into it included, without all ten checks, short of changing the protection itself.

```
feature/* ──PR──▶ dev ──promotion──▶ main (versioned release) ──by hand──▶ deploy
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

Release management is handled by [release-please](https://github.com/googleapis/release-please) (GitHub Action `googleapis/release-please-action`, v5) via `.github/workflows/release-please.yml`.
That workflow grants no permissions at its top level; its one job gets `contents: write` (the release commit and its tag), `pull-requests: write` (the Release PR) and `issues: write` (the Release PR's labels), and uses the job's own token, the action's default.

The release and deploy workflows reference each action by its full commit SHA with the version in a comment beside it (`@<sha> # v7.0.1`), so a moved tag cannot change what they run; Dependabot's `github-actions` updater bumps the SHA and the comment together.
No checkout in them keeps git credentials (`persist-credentials: false`).

### How a Release Happens

1. **Feature work lands on `dev`** through normal PRs with conventional commit messages.
2. **A maintainer promotes `dev` → `main`** as a fast-forward of a commit whose `dev` CI run passed: `git fetch origin && git push origin <sha>:main`.
   Push that commit by its sha, not "whatever `dev` is now": anything merged since has not passed CI as part of that commit.
   This is the **only** way code reaches `main`.
   A fast-forward puts exactly the commit CI tested on `dev` onto `main`; a merge or rebase would make a new commit nobody tested.
3. **Daniel deploys `main` by hand, once the Test workflow has passed on it**, with the Deploy workflow ([`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)): Actions tab, Deploy, Run workflow on `main`, or `gh workflow run deploy.yml --ref main`.
   Nothing else deploys: no push, merge or PR, to any branch, creates or cancels a Vercel deployment, because each project's `vercel.json` switches Vercel's Git integration off for every branch (`git.deploymentEnabled: false`).
   Even a deployment the Ignored Build Step cancelled counted against the Hobby plan's daily deployment quota, which is why Git builds are off rather than cancelled.
   `scripts/tests/test_deploys_by_hand.py` fails if either `vercel.json` loses that setting.
   The workflow deploys the back end (`makers-market-management-back-end`, `api.conventioner.io`) first, then checks `/healthz` and its security headers, then deploys the front end (`makers-market-management-front-end`, `conventioner.io`) and checks a deep link and its [security headers](implementation/conventions/security-invariants.md#security-headers).
   It deploys whatever `main` points at when it starts, and a run started from any other branch deploys nothing.
   It needs the `VERCEL_TOKEN` secret in the `production` environment and the `VERCEL_ORG_ID`, `VERCEL_BACKEND_PROJECT_ID` and `VERCEL_FRONTEND_PROJECT_ID` variables; without them the run refuses at "Refuse to run half-configured", before it installs or deploys anything.
   The token is in the `env` of "Deploy the back end" and "Deploy the front end" only; the refusal sees only whether it is set, and no other step holds it.
   The workflow's own GitHub token can only read the repository (`permissions: contents: read`).
   The same run redeploys a commit after an environment variable changes.
4. **release-please detects the new commits on `main`** and automatically opens (or updates) a **Release PR** targeting `main`.
   This PR contains:
   - A version bump in `.release-please-manifest.json`
   - An updated `CHANGELOG.md` with all changes since the last release
5. **A maintainer reviews and merges the Release PR**, squashed, as an admin: `gh pr merge <n> --squash --admin`.
   release-please opens it with GitHub's built-in token, and GitHub runs no workflows for that token, so the PR never gets the checks branch protection asks for; it changes only the manifest and the changelog.
   On merge, release-please automatically:
   - Creates a **git tag** (e.g., `v1.0.0`)
   - Creates a **GitHub Release** with the changelog content

   Merging it changes only the changelog and the manifest, so it needs no deploy.
6. **Merge `main` back into `dev`**: open a PR from `main` to `dev` and merge it once green.
   The release commit exists only on `main`; until `dev` has it, the next promotion is not a fast-forward and is refused.

### After every deploy

Check, in this order:

1. `curl https://api.conventioner.io/healthz` answers `{"status":"ok"}` (the back end booted, which proves its configuration and migration markers, and its database answers).
2. `https://conventioner.io/markets` opens when loaded directly, not only when navigated to (the SPA fallback in `front-end/vercel.json`).
3. Sign in as an organizer.

### Hotfixes

`dev` is the hotfix lane, because promotion is a fast-forward: a fix merged to `dev` and promoted ships exactly what CI tested, and nothing else, **as long as nothing else is waiting on `dev`**.

- **When nothing unreleased waits on `dev`:** merge the `fix:` PR to `dev`, promote it as soon as its `dev` push is green, and run the Deploy workflow once its `main` run is green.
- **When `dev` holds unreleased work:** branch `hotfix/<slug>` from `main`, PR it to `main`, run the Deploy workflow once it is merged and green, and merge `main` back into `dev` so the next promotion is still a fast-forward.
- **Weigh a migration in a hotfix.**
  A migration is forward-only, so it makes the release behind it impossible to roll back to.

### Rolling back

Vercel keeps every production deployment.
Roll back by promoting the previous one, in the dashboard (Deployments, then "Instant Rollback") or with `vercel rollback <deployment-url>`, **for each project separately**: the front end and the back end deploy independently.
A rollback does not move `main`, so revert the bad commit on `dev` and promote it before the next deploy brings it back.
**An Instant Rollback stops Vercel giving new production builds the domain** until a deployment is promoted again (`vercel promote <deployment>`, or Promote in the dashboard).
That is how `api.conventioner.io` served an April build until 2026-10-18 while every later deploy went live nowhere; promote the fixed build once it is out, or the next deploy will not reach the domain either.
A rollback cannot undo a migration, which is forward-only.

### Bootstrapping Note

The release-please workflow becomes active once it reaches `main` (via the first `dev` → `main` promotion after this config is merged to `dev`).
`v0.1.0` shipped on 2026-09-13 and `v1.0.0` on 2026-10-18 (the first version a real market ran on); `.release-please-manifest.json` tracks the current version.

The first release was bootstrapped with `"release-as": "0.1.0"`, which has since been removed.
`release-as` is a forced version: it overrides the conventional-commit calculation on **every** run until it is cleared, so it is a one-time bootstrap and never a way to pick a version.
Each version is now derived from the accumulated commits (`feat:` → minor, `fix:` → patch, breaking change → major).

## Pre-Deploy: Required Production Environment

The back end **refuses to start** unless all six of these are set, and it fails at import, so a deployment that is missing one serves nothing at all.
The check is `check_public_endpoint_defenses()` in [`back-end/app.py`](../back-end/app.py); keep this table in step with it, because a deploy checklist that is wrong is worse than none: it will be trusted.
Why each is required, and the rules around them, are the [security invariants](implementation/conventions/security-invariants.md).
Set them in the hosting environment **before** starting the Deploy workflow.
The startup log names every variable that is missing, all of them at once.

Two consequences of that are worth knowing before you deploy, because both are easier to meet head-on than to be ambushed by:

1. **The app does not degrade without these - it does not boot.**
   The check runs at import, which on a serverless host (Vercel) means on *every cold start*.
   A deploy started before the variables are set takes the deployment down rather than serving a weakened version of it.
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
| `CORS_ALLOWED_ORIGINS` | The comma-separated list of browser origins allowed to make credentialed requests to the API, each written exactly as a browser sends it - `https://app.example.com`, no trailing slash, no path. Usually just the front end's own origin. | The API answers cross-site requests with `Access-Control-Allow-Credentials: true`, and the organizer's session cookie is `SameSite=None`, so with no origin list every website an organizer visits could read and write the organizer API - markets, vendors, applications - as them. `*` is refused for the same reason. The same list decides which origins a browser's write is taken from: a write from any other origin answers 403 `Request origin not allowed`. |
| `RESEND_API_KEY` | The Resend API key ([dashboard](https://resend.com/api-keys)). Delivers the email-verification link, the password-reset link, and the OTP login code. | No organizer could get an account at all: registration rolls the new user back and answers 500 when the verification mail cannot be sent, an unverified account cannot log in, and password reset and OTP answer 500. The deployment would look healthy and onboard nobody. |
| `SESSION_TYPE` | Where the organizer's session is kept: `null` on a serverless host (Vercel), which keeps it in the signed cookie, or `filesystem` on a container or VM, which keeps it on local disk. | Neither value is right for both hosts, so there is no default to fall back on. A serverless deployment that got `filesystem` would go looking for a disk that does not outlive a request: it raises at import, every request answers 500, and nothing in the log names this variable. It used to be derived from `FLASK_ENV`, which our own image pins to `development` - so the derivation answered `filesystem` on precisely the deployments that have no filesystem. |
| `TRUSTED_PROXY_HOPS` | How many proxies of **this deployment's own** a request passes through before it reaches Flask - a reverse proxy, a load balancer, or a serverless ingress each count as one. Vercel is `1`. `0` means Flask is exposed directly, and is a legitimate answer an operator has to give deliberately. | This is the address organizer signup reports to Google as reCAPTCHA's `remoteip`, and reCAPTCHA v3 *scores* on it rather than passing or failing. Unset behind an ingress, that address is the ingress's - the same client, reported for every signup in the world - so real organizers are scored against `MIN_SCORE` on a signal that describes none of them. Setting it too high is the mirror failure: `X-Forwarded-For` is written by the caller, so trusting a hop the deployment does not own lets a caller name any address it likes. Only this variable makes the captcha - which this release enforces for the first time - score the person actually signing up. |

There is deliberately **no default** for any of them.
A default that quietly becomes the production value is the failure each of these checks exists to prevent - the signing key was such a default, and it was a literal committed to this repository.

For the same reason, **every value this repository has printed where a secret goes is refused by name** - by all three of `SECRET_KEY`, `RECAPTCHA_SECRET_KEY` and `RESEND_API_KEY`, and on a laptop as on a deployment (`back-end/utils/configured_secret.py`).
That covers the old `TEMP_KEY_CHANGE_IN_PRODUCTION` fallback, the `re_xxxxx` and `6Lcxxxxx` placeholders the env templates and this guide once carried, and anything shaped like them (a run of x's, a `your-` prefix).
They are all one `git log` away from anybody, so setting one back would clear the boot refusal and leave the vulnerability exactly where it was.
`ALLOW_INSECURE_LOCAL_DEV` does not excuse a published value of any of the three ([ADR 0010](adr/0010-no-secret-has-a-fallback.md)).

A placeholder is refused rather than accepted because it is **truthy**, which is the whole problem: a check that asks only whether a variable is set passes on `re_xxxxx`, and the deployment then fails at request time instead - reCAPTCHA verifying signups against a key Google never issued, Resend rejecting every verification mail behind a 500.
A check that can be satisfied with garbage is not a check.
A blank value is refused for the same reason and reported differently, because `FOO=` is what a forgotten variable looks like, not a filled-in one.

Note that **setting `SECRET_KEY` for the first time, or rotating it, ends every session signed with the old key**: organizers are asked to log in again, once.
That is the price of the key not being public, and it is not a reason to reach for the old one.

The one exemption is `ALLOW_INSECURE_LOCAL_DEV=true`, which `docker-compose.yml` and `back-end/.env.example` set and which logs every defense it turns off.
It must never be set on a deployed environment.

`TRUSTED_PROXY_HOPS` decides which address the back end takes for the caller's, and two things read that address.
Organizer signup passes it to reCAPTCHA as the `remoteip` hint, which only started mattering when `RECAPTCHA_SECRET_KEY` became a boot requirement: before, a deployment without a secret took the dev-bypass path and no token ever reached Google.
The applicant sign-in rate limits (`back-end/sign_in_limits.py`) count each caller by it, so a wrong hop count would put every applicant behind one caller's limit.

### The front end has one requirement too, and it is the other half of the reCAPTCHA pair

| Variable | Where it is set | What an unset value would do |
|----------|-----------------|------------------------------|
| `VITE_RECAPTCHA_SITE_KEY` | The **front end's build environment** (Vercel: the front-end project's environment variables). The site key of the *same* reCAPTCHA property as the back end's `RECAPTCHA_SECRET_KEY` - the two are a matched pair, and a key from another property fails exactly as an absent one does. | The bundle would carry no site key, so it has no captcha to solve and sends a placeholder token instead. The back end verifies that token against Google, Google never issued it, and `POST /register` answers 400 - every organizer signup, on a deployment that looks healthy and logs nothing about it. |

Making `RECAPTCHA_SECRET_KEY` a boot requirement is what makes this one load-bearing.
Before, a back end with no secret took its dev-bypass path and waved the placeholder token through, so a front end with no site key worked.
It cannot now: the back end refuses to boot without a real secret, and a real secret rejects a token Google did not issue.

It is a **build-time** variable, not a runtime one - Vite bakes it into the bundle - so setting it after the fact does nothing until the front end is rebuilt.
`vite build` refuses to produce a bundle without it (`assertCaptchaSiteKey` in [`front-end/vite.config.ts`](../front-end/vite.config.ts)), for the same reason the back end refuses to boot without its half: the alternative is a deployment that ships, looks fine, and cannot register a single organizer.
The one exemption is `VITE_ALLOW_INSECURE_LOCAL_DEV=true`, which `front-end/.env.example` and `docker-compose.yml` set and which warns on every build it lets through.
It must never be set on a deployed build.

### Optional: hosted TypeSafe

| Variable | What it is | What an unset value does |
|----------|------------|--------------------------|
| `TYPESAFE_API_KEY` | A TypeSafe API key ([console](https://console.typesafe.ai)). When an organizer starts a market from their Google Form's responses CSV, the proposal asks TypeSafe's Jev model two questions the rules leave: whether a trailing optional column is a question or a column the organizer's team added, and what ceiling on days per vendor a heading states in words the rules cannot read. | Nothing breaks: the rules alone decide, and those rows are left for the organizer to check. |

It is not a boot requirement, and a blank or placeholder value counts as unset (`back-end/utils/configured_secret.py`).
What a request sends is one column and never a row, and never an answer: the column's heading, how many rows answered it, how many answers are distinct, and a shape computed on the server, such as "prose, around 80 characters" ([ADR 0007](adr/0007-what-may-be-sent-to-hosted-typesafe.md)).
A ceiling question sends one heading's text.
A heading that holds an email, link, handle or phone number is not sent.
The upload step tells the organizer this in one line, shown only when the key is set.
A failure, a rate limit or a wait past 5 seconds leaves the rules' answer, marked "Couldn't reach TypeSafe".

### Optional: Discord

| Variable | What it is | What an unset value does |
|----------|------------|--------------------------|
| `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | The Conventioner application's OAuth2 client id and secret, from the Discord Developer Portal. Connecting a market exchanges the code Discord's approval screen sends back for the server the bot was added to. | With any of the three unset, Discord is off: the Discord card on Market Setup says "Discord is not set up on this Conventioner." and offers nothing. |
| `DISCORD_BOT_TOKEN` | The application's bot token (Bot, Reset Token). Every call the bot makes on a connected server is made with it. | As above. |

None is a boot requirement, and a blank or placeholder value counts as unset (`back-end/discord_client.py`, [the Discord connection](implementation/modules/discord.md)).
The application needs its OAuth2 redirect set to `FRONTEND_URL` + `/discord/connected` (`https://conventioner.io/discord/connected` in production), and the Server Members Intent switched on.

## Pre-Deploy: Database Migrations

Migrations are never run automatically - rewriting stored documents is a deliberate operator action.

**A database created by `init_database.py` needs none of them**: it is born in the current shape and records the boot markers.
Production was started that way on 2026-10-18, so the list below matters only for a database older than its code.
Every script in `back-end/migrations/` is idempotent; the ones not described here (`migrate_roles`, `migrate_publishing_to_market_days`, `migrate_submitted_at_to_iso`, `migrate_tier_preference_per_date`, `migrate_table_code_separator`, `migrate_table_share_answer`) each say in their own docstring what they repair and when.

Before a deploy reaches an older production database, run the pending migrations in `back-end/migrations/` against the production database (each is idempotent, and `--dry-run` previews the changes):

```bash
python migrations/migrate_phase.py                    # backfills `phase` on existing markets
python migrations/migrate_market_keys.py              # rewrites market documents into canonical form (camelCase keys + stored slug, builds the UNIQUE slug index; stops and names markets that share a public address)
python migrations/migrate_is_draft_consistency.py     # makes `isDraft` agree with `phase` on markets that have one
python migrations/create_applications_collection.py   # creates the applications collection and its indexes
python migrations/migrate_user_emails.py              # stores every account address lowercased; stops and names (by id) accounts that share one
python migrations/migrate_placement_history.py        # AFTER the deploy, whenever: moves the placement history into the market's history
```

`migrate_placement_history.py` is the one that runs **after** its deploy, not before (E40/F01/S01): it moves every `placement_history` entry into `history` with its fields unchanged and drops the old collection, and a run before the deploy leaves behind whatever the old build writes meanwhile.
Nothing waits on it: the release reads `placement_history` beside `history`, so the drawer's History tab answers as before from the deploy on, and the release can be rolled back until the script has run ([the market's history](implementation/data/history.md#the-move-from-placement_history)).
It is idempotent, so an early run does no harm, but only a run after moves everything; a later release removes the fallback once every database is moved.

`migrate_user_emails.py` **must** be run before the code that holds one account per address (E32/F03/S04).
The back end builds a UNIQUE index on the stored, lowercased address at boot (`api.users.ensure_user_indexes`) and refuses to boot while any address is stored with capitals, naming this script, or while two accounts share an address, naming them by id.
Register used to check for an address and then insert it, so a double click could make two accounts; which one an organizer keeps is theirs to decide, so the migration names a clash and writes nothing.

`create_applications_collection.py` creates the applications collection and builds both its indexes: `market_id` (the lookup the D9 lock counts on) and the unique compound index on `(market_id, applicant_email, application_type)` that enforces one applicant per market.
The uniqueness is the database's, not the application code's - the write that creates an application is an atomic upsert (`find_or_create_application` in `api/applications.py`), and the unique index is what makes it safe under concurrency.
A database that already holds duplicates cannot take the index; the migration detects them and names the conflicting documents rather than failing with a cryptic key-build error.
See `api.applications.ensure_application_indexes`.

`migrate_is_draft_consistency.py` **must** be run with the code that makes `phase` the single source of truth, and it is the migration whose omission is visible to vendors.
A market the old build published carries `phase: "draft"` + `isDraft: false` (publishing was a `PUT` of `isDraft: false`; nothing advanced the phase), and every read now derives the market's state from `phase`.
`draft` is a recognized phase, so it is taken at face value: until the migration advances those markets to `archived`, an already-live market reverts to looking unpublished - its public check-in URL returns `404`, and its organizer is routed back into the setup wizard.
The migration repairs that disagreement in favour of `isDraft`, because on those documents `isDraft` was the only publish signal that ever existed.
Run it after `migrate_phase.py`: the two are disjoint by construction (one touches only documents *with* a `phase`, the other only those without), but that ordering means a database migrated in one pass ends up fully consistent.

`migrate_market_keys.py` **must** be run before the code that reads market documents by the canonical key only and the code that queries the stored slug.
An unmigrated market is invisible to every such read: vendors are told the market does not exist at check-in, applicants get a 404 at the public market URL, and organization members get an empty market list.
The migration records every one of its marker documents (`market_document_keys`, `market_slugs` and `market_slugs_unique`) in the `schema_migrations` collection, builds the unique `market_slug` index (stopping to name any stored markets that already share a public address), and the back end refuses to boot unless it can read every marker; the fatal log names every missing one and the script to run.
The check fails closed on anything short of confirmed markers - an unknown migration state is not a migrated one - so a deploy that skipped the migration fails loudly at startup rather than quietly serving half the data.

## Files

| File | Purpose |
|------|---------|
| [`release-please-config.json`](../release-please-config.json) | Configures release-please: release type `simple` (driven by conventional commits alone, no language's package file parsed), tags `vX.Y.Z` |
| [`.release-please-manifest.json`](../.release-please-manifest.json) | Tracks the current version per package, auto-updated by release-please |
| [`.github/workflows/release-please.yml`](../.github/workflows/release-please.yml) | GitHub Actions workflow that runs release-please on pushes to `main` |
| [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) | GitHub Actions workflow, started by hand, that deploys `main` |
| `CHANGELOG.md` | Auto-generated changelog, written by release-please and never by hand |
