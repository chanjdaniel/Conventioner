---
layer: implementation
kind: runbook
describes:
  - .github/workflows/deploy.yml
  - .github/workflows/release-please.yml
  - release-please-config.json
  - back-end/app.py#check_public_endpoint_defenses
  - front-end/vite.config.ts#assertCaptchaSiteKey
  - back-end/app.py#healthz
  - front-end/vite.config.ts#buildCommit
  - scripts/deploy_proof.py
  - front-end/vite.config.ts#assertApiHost
  - front-end/vite.config.ts#assertNoLocalHatchOnVercel
  - .github/workflows/promote.yml
  - scripts/promote_check.py
  - scripts/github_runs.py
verified: 2026-11-14
sources:
  - T74
  - T254
  - T251
  - T263
  - T270
  - T273
  - T317
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

**Both branches are protected**: a PR into either needs the `backend`, `frontend-unit`, `frontend-lint-and-types`, `docker-build`, `e2e` and `real-data-and-workflows` checks to pass (`e2e` passes only when every shard does).
A PR into `dev` also needs `knowledge-graph`, `CodeQL` and `agent-review`, nine in all; `main` asks only the six ([CI and the gate](implementation/testing/ci-and-the-gate.md#ci)).
Branches need not be up to date before merging, because a promotion is only ever made from a commit whose own `dev` run passed.
`dev`'s is a branch protection rule that binds admins too (`enforce_admins`): nothing merges into `dev`, the merge of `main` back into it included, without all nine checks, short of changing the protection itself; force pushes to it are blocked.
`main`'s are two rulesets ([ADR 0027](adr/0027-main-moves-only-through-promote.md)).
"main is promoted or merged" takes a change only through a pull request, except from the Promote workflow's GitHub App, the only actor that may push to `main` ([how a promotion proves itself](#how-a-promotion-proves-itself)).
"main is tested" requires the six checks, keeps `main`'s history linear, and blocks force pushes and deletion; the App is held to it too, so the commit it pushes must already have passed the six, as a commit whose `dev` run passed has.
An admin may bypass both through a pull request only: it is how the Release PR, which gets no CI, is merged (below).
No one pushes to `main` directly, an admin included, so an emergency push means editing a ruleset first.

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

| Type                                                                        | Semver Bump       | Example                                        |
| --------------------------------------------------------------------------- | ----------------- | ---------------------------------------------- |
| `fix:`                                                                      | PATCH             | `fix(api): handle null market items`           |
| `feat:`                                                                     | MINOR             | `feat(ui): add drag-and-drop floorplan editor` |
| `feat!:` / `fix!:` (BREAKING CHANGE in body)                                | MAJOR             | `feat!: drop support for legacy schema`        |
| `docs:`, `style:`, `refactor:`, `perf:`, `test:`, `chore:`, `ci:`, `build:` | NONE (no release) | `chore(deps): bump axios to 1.13`              |

## Release Process (Automated)

Release management is handled by [release-please](https://github.com/googleapis/release-please) (GitHub Action `googleapis/release-please-action`, v5) via `.github/workflows/release-please.yml`.
That workflow grants no permissions at its top level; its one job gets `contents: write` (the release commit and its tag), `pull-requests: write` (the Release PR) and `issues: write` (the Release PR's labels), and uses the job's own token, the action's default.
It sets no concurrency limit, so a release run is never cancelled part-way; `main` moves only by hand, so its runs do not pile up.

The release, deploy and promote workflows reference each action by its full commit SHA with the version in a comment beside it (`@<sha> # v7.0.1`), so a moved tag cannot change what they run; Dependabot's `github-actions` updater bumps the SHA and the comment together.
No checkout in them keeps git credentials (`persist-credentials: false`).

### How a Release Happens

1. **Feature work lands on `dev`** through normal PRs with conventional commit messages.
2. **Daniel starts Promote with the sha** of a `dev` commit whose `dev` CI run passed ([`.github/workflows/promote.yml`](../.github/workflows/promote.yml)): Actions tab, Promote, Run workflow from `dev`, giving the commit's full 40-character sha, or `gh workflow run promote.yml --ref dev -f commit=<sha>`.
   Promote that commit by its sha, not "whatever `dev` is now": anything merged since has not passed CI as part of that commit.
   The workflow refuses unless the commit's Test run on a push to `dev` passed, the commit is on `dev`, and `main` is its ancestor, then fast-forwards `main` to it as the Promote App ([how a promotion proves itself](#how-a-promotion-proves-itself)); the run's summary says what `main` is now and what comes next.
   This is the **only** way a `dev` commit reaches `main`: `main`'s rulesets refuse a push from anyone but the App, an admin's included.
   A fast-forward puts exactly the commit CI tested on `dev` onto `main`; a merge or rebase would make a new commit nobody tested.
   The App's push starts the Test and release-please workflows on `main`, which a push with a workflow run's own token would not.
3. **Daniel deploys `main` by hand, once the Test workflow has passed on it**, with the Deploy workflow ([`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)): Actions tab, Deploy, Run workflow on `main`, or `gh workflow run deploy.yml --ref main`.
   Nothing else deploys: no push, merge or PR, to any branch, creates or cancels a Vercel deployment, because each project's `vercel.json` switches Vercel's Git integration off for every branch (`git.deploymentEnabled: false`).
   Even a deployment the Ignored Build Step cancelled counted against the Hobby plan's daily deployment quota, which is why Git builds are off rather than cancelled.
   `scripts/tests/test_deploys_by_hand.py` fails if either `vercel.json` loses that setting.
   The workflow first refuses a commit whose Test run on `main` has not passed.
   It then builds the back end (`makers-market-management-back-end`, `api.conventioner.io`) and the front end (`makers-market-management-front-end`, `conventioner.io`) as production deployments that take no domain, and checks each on its own address.
   Only when both have proven themselves does it promote the back end, wait for `api.conventioner.io` to serve the new commit, promote the front end and wait for `conventioner.io`, checking each domain's [security headers](implementation/conventions/security-invariants.md#security-headers) and the front end's deep link once it serves the commit; [how a deploy proves itself](#how-a-deploy-proves-itself) has the details.
   It deploys whatever `main` points at when it starts, and a run started from any other branch deploys nothing.
   It needs the `VERCEL_TOKEN` secret in the `production` environment and the `VERCEL_ORG_ID`, `VERCEL_BACKEND_PROJECT_ID` and `VERCEL_FRONTEND_PROJECT_ID` variables; without them the run refuses at "Refuse to run half-configured", before it installs or deploys anything.
   The token is in the `env` of the steps that run the Vercel CLI only: the two "Stage" steps, the two "The staged ... is this commit" proofs and the two "Promote" steps; the refusal sees only whether it is set, and the Test check and the two domain waits never hold it.
   The workflow's own GitHub token can read the repository and its workflow runs, nothing more (`permissions: contents: read, actions: read`).
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
   Green there includes `agent-review`, which only the agent team's review sets ([CI and the gate](implementation/testing/ci-and-the-gate.md#ci)), and `--admin` cannot pass `dev`'s protection, so the PR waits for that review.
   The release commit exists only on `main`; until `dev` has it, the next promotion is not a fast-forward, and Promote refuses it, saying to merge `main` back into `dev` first ([how a promotion proves itself](#how-a-promotion-proves-itself)).

### How a promotion proves itself

Every check the Promote workflow makes before it moves `main` lives in [`scripts/promote_check.py`](../scripts/promote_check.py), which reads GitHub and writes nothing, so it can be run anywhere without promoting: `GITHUB_TOKEN="$(gh auth token)" GITHUB_REPOSITORY=chanjdaniel/Conventioner python3 scripts/promote_check.py --commit <sha>`.
It reads the Test runs through [`scripts/github_runs.py`](../scripts/github_runs.py), the same code Deploy's Test check uses, so "the newest run decides" means one thing in both.
[`scripts/tests/test_promote_check.py`](../scripts/tests/test_promote_check.py) runs it against a stub server, pins the workflow's steps, and runs the workflow's own shell with a fake `gh`.

The workflow runs only from `dev`, in the `promote` environment, whose deployment branches are `dev` alone, so a run from a branch with an edited copy of the workflow never reaches the App's key.
One promotion runs at a time, and none is cancelled part-way.
A check-only run (`-f check-only=true`, or the box in the Actions tab) makes every check and mints the App's token but moves nothing, which proves the App's setup before a real promotion.

1. **"Refuse to run half-configured"** refuses when the `promote` environment lacks the `PROMOTE_APP_CLIENT_ID` variable or the `PROMOTE_APP_PRIVATE_KEY` secret, one `::error::` line for each; it sees only whether the key is set, never the key.
2. **"The commit may be promoted"** runs the check with the run's own read-only token.
   It takes only a full 40-character sha, upper case read as lower, so a short or ambiguous one never resolves to the wrong commit; anything else is a usage error before GitHub is read.
   Then, in order, each refusal is one `::error::` line, `<short>` being the commit's first 12 characters:
   - The Test workflow's newest run, by run number, on a push to `dev` at the commit decides.
     None: "No Test run on a push to dev at `<short>`. Promote only a commit on dev whose Test run has passed."
     Still running: "Test is still running on dev at `<short>` (`<url>`). Run Promote again once it has passed."
     Any conclusion but success: "Test `<conclusion>` on dev at `<short>` (`<url>`). Promote only a commit whose Test run has passed."
   - The commit is on `dev`: GitHub's compare of `dev...<sha>` says `behind` or `identical`, so a pull request's head or a typo never reaches `main`.
     Otherwise: "`<short>` is not on dev. Promote only a commit on dev."
   - `main` is its ancestor: the compare of `main...<sha>` says `ahead`, so the move is a fast-forward.
     Already there: "main is already at `<short>`; nothing to promote."
     Older than `main`: "`<short>` is older than main (`<main short>`); nothing to promote."
     `main` has commits the commit lacks, most often the release commit not yet merged back into `dev`: "main (`<main short>`) has commits `<short>` lacks, so main cannot be fast-forwarded to it. If it is the release commit, merge main back into dev first (docs/RELEASING.md, step 6), then promote a dev commit that has it."

   Any error reading GitHub refuses at once, with no retry: "Could not read `<what>` from GitHub (`<status or error type>`), so nothing was promoted."
   On a pass it prints one line: "`<short>` may be promoted: Test passed on dev (`<url>`), and main (`<main short>`) is `<n>` commits behind it."

3. **The App's token** is minted by `actions/create-github-app-token` from the variable and the secret: an installation token that lasts an hour and may write this repository's contents and nothing else, revoked when the job ends.
4. **"Fast-forward main"**, skipped on a check-only run, is the only step that holds the App's token.
   It moves `main` to the commit with `force=false`, so GitHub refuses anything but a fast-forward: a `main` that moved since the check is refused, never rewritten ("main moved since the check, so nothing was promoted. Run Promote again.").
   Any other refusal is named with GitHub's own message ("GitHub refused to move main (`<message>`), so nothing was promoted.").
   It then reads `main` back and fails unless it is the commit; a move GitHub took although its answer was lost counts as made.
5. **"Say what happened"** writes the run's summary, whatever happened: `main` is now the commit, the Test workflow runs on it, and once that passes Deploy is `gh workflow run deploy.yml --ref main`; checked only, with `main` unmoved; refused, with `main` unmoved; or, when the move failed, what `main` was read back as.

### How a deploy proves itself

Every check the Deploy workflow makes after it builds lives in [`scripts/deploy_proof.py`](../scripts/deploy_proof.py), header lists included; [`scripts/tests/test_deploy_proof.py`](../scripts/tests/test_deploy_proof.py) runs it against a stub server as the workflow's dry run, and pins the workflow's step order.

1. **"Test passed on main at this commit"** reads the Test workflow's runs on a push to `main` at the commit being deployed, and the newest one decides.
   It refuses, before anything is built, when that run is still running, did not pass, or there is none, with a link to the run when there is one; every check `main` requires is a job of the Test workflow, so a Test run that passed has passed them all.
   It fails closed, with no retry, when GitHub cannot be read.
2. **"Stage the back end" and "Stage the front end"** run `vercel deploy --prod --skip-domain`: a production deployment, built with production's variables, that takes no domain until it is promoted, and is promoted as it was built.
   A plain `vercel deploy` would make a Preview deployment, built with Preview's variables, and promoting one rebuilds it, so the build checked would not be the build shipped.
   Each build is stamped with the commit it was built from, in `BUILD_COMMIT`: the back end's at run time (`--env`), where `/healthz` reports it as `commit`, and the front end's at build time (`--build-env`), where its Vite build writes `/version.json`, `{"commit":"<sha>"}`.
   A build made without it, a local or CI one, reports `null`.
3. **"The staged back end is this commit" and "The staged front end is this commit"** read each deployment's own `*.vercel.app` address.
   The address must report exactly this commit, else the run refuses at once; a back end still starting, answering 503 or `unavailable`, is retried every 10 seconds for up to 120.
   Then the back end's answer must say `"localDev": false` and `"deployed": true`, exactly, and carry `x-content-type-options` and `referrer-policy`, and the front end must serve its app at `/markets` with its five security headers, the policy among them as `content-security-policy`, which a report-only header does not stand for.
   The two values prove the [deployed-host refusal](#a-deployed-host-refuses-local-switches) armed: the build has its hatch off, and sees the platform variable that makes its boot refuse one.
   They read the address through the pinned Vercel CLI's `vercel curl`, which sends Vercel's Protection Bypass for Automation for the deployment's project, so the check works whether or not Deployment Protection is on.
   When a project has no automation bypass secret, `vercel curl` creates one on the first run, a setting the workflow adds by itself; it is in the project's Settings, Deployment Protection.
4. **"Promote the back end"** gives the staged back end `api.conventioner.io` (`vercel promote`), and **"api.conventioner.io serves this commit"** waits, every 5 seconds for up to 300, until the domain reports the new commit, then checks its `localDev`, `deployed` and headers as on the staged address.
5. **"Promote the front end"** and **"conventioner.io serves this commit"** do the same for the front end, whose checks are the deep link and the five headers.

Neither project is promoted until both builds have proven themselves, so a broken front-end build leaves production as it was; and the front end is promoted only once `api.conventioner.io` serves the new commit, so the back end is never older than the front end.
A failed run's summary, "Say what production serves", says what each domain serves now, claiming only what the run proved: nothing promoted, only the back end, or both; a promote step that failed says its domain may serve this commit or the build before it, since Vercel can take a promotion and the CLI still fail once its wait times out.
It ends with the two `curl` commands that settle what each domain serves.

### When a deploy refuses or times out

The failed step's log says why, in one `::error::` line; the run's summary says what production serves now.

- **"Test passed on main at this commit"**: Test is still running (wait and run Deploy again), failed (fix it on `dev` and promote again), or never ran on that commit (deploy only a commit on `main`). Nothing was built.
- **"Stage the back end" or "Stage the front end" fails**: the Vercel build failed, or `VERCEL_TOKEN` expired; read the step's log, then the deployment's build log in Vercel. Nothing was promoted.
- **A staged build reports another commit, or `null`**: the build did not get `BUILD_COMMIT`.
  The log of "The staged back end is this commit" or "The staged front end is this commit" names what it reported.
  Nothing was promoted.
- **A staged back end never serves**: it refused to boot or its database did not answer; read the deployment's log in Vercel, as for [a back end that refuses to boot](OPERATIONS.md#when-the-back-end-refuses-to-boot). Nothing was promoted.
- **A staged back end "runs with ALLOW_INSECURE_LOCAL_DEV on"**: the back-end project's environment sets the hatch, on a host the boot did not see as deployed, or it would have refused. Remove it in Vercel (the back-end project, Settings, Environment Variables), make sure no `back-end/.env` is deployed, and run Deploy again. Nothing was promoted.
- **A staged back end "does not see that it is deployed"**: none of the platform variables reached its runtime, so its refusal of local switches is not armed. Tick "Enable access to System Environment Variables" in the back-end project's Environment Variables settings on Vercel, then run Deploy again. Nothing was promoted.
- **A staged address answers 401 or 403**: the Protection Bypass for Automation did not apply; check it in the project's Settings, Deployment Protection, and run again. Nothing was promoted.
- **"Promote the back end" or "Promote the front end" fails**: the promotion may or may not have taken. Look with `curl https://api.conventioner.io/healthz` and `curl https://conventioner.io/version.json`, then run Deploy again, or `vercel promote` the staged deployment the run printed by hand.
- **A domain times out still on the old commit**: run `vercel inspect <domain>` to see which deployment it points at, `vercel promote` the staged deployment the run printed, and look again with `curl` (below).
  When it was `api.conventioner.io`'s wait, the front end was never promoted: once the back end serves the commit, run Deploy again, or `vercel promote` the staged front end and look at `conventioner.io` the same way.
- **A check fails after promotion** (`localDev`, `deployed`, a header, or the deep link): the build is live without it; [roll back](#rolling-back) each promoted project, then fix it on `dev`.

### After every deploy

Check, in this order:

1. `curl https://api.conventioner.io/healthz` answers `"status": "ok"`, `"deployed": true` and `"localDev": false` with the released commit as `commit` (the back end booted, which proves its configuration and migration markers, and its database answers), and `curl https://conventioner.io/version.json` names the same commit.
2. `https://conventioner.io/markets` opens when loaded directly, not only when navigated to (the SPA fallback in `front-end/vercel.json`).
3. Sign in as an organizer.

### Hotfixes

`dev` is the hotfix lane, because promotion is a fast-forward: a fix merged to `dev` and promoted ships exactly what CI tested, and nothing else, **as long as nothing else is waiting on `dev`**.

- **When nothing unreleased waits on `dev`:** merge the `fix:` PR to `dev`, [promote it](#how-a-promotion-proves-itself) as soon as its `dev` push is green, and run the Deploy workflow once its `main` run is green.
- **When `dev` holds unreleased work:** branch `hotfix/<slug>` from `main`, PR it to `main`, run the Deploy workflow once it is merged and green, and merge `main` back into `dev` so the next promotion is still a fast-forward; that PR into `dev` needs the agent team's review to set `agent-review` ([CI and the gate](implementation/testing/ci-and-the-gate.md#ci)).
- **Weigh a migration in a hotfix.**
  A migration is forward-only, so it makes the release behind it impossible to roll back to.

### Rolling back

Vercel keeps every production deployment.
Roll back by promoting the previous one, in the dashboard (Deployments, then "Instant Rollback") or with `vercel rollback <deployment-url>`, **for each project separately**: the front end and the back end deploy independently.
A rollback does not move `main`, so revert the bad commit on `dev` and promote it before the next deploy brings it back.
**An Instant Rollback stops Vercel giving new production builds the domain** until a deployment is promoted again (`vercel promote <deployment>`, or Promote in the dashboard).
That is how `api.conventioner.io` served an April build until 2026-10-18 while every later deploy went live nowhere.
The Deploy workflow promotes explicitly, so its next run puts a project out of the rolled-back state by itself; a by-hand `vercel promote` is needed only when no deploy follows.
A rollback cannot undo a migration, which is forward-only.
**After a roll forward over a rollback past the release that keeps an organization's people as one map** ([ADR 0025](adr/0025-an-organizations-people-are-one-map.md)), run `migrate_organization_people.py --reconcile`, `--dry-run` first, as soon as that release is promoted again.
The release before writes only an organization's three lists, so each map it left goes stale, and the map's release reads the map over the lists: until the reconcile has run, a person removed during the rollback keeps their roles through the organization, one added has none, and an organization whose ownership was transferred reads as its old owner's.
The map's release also judges and writes every change on the stale map in that time, and the reconcile keeps what such a write left in the lists: an old owner can still transfer the organization's ownership, leaving its owner while rolled back with no place in it, and someone removed while rolled back can still remove a member.
So run the reconcile before any organizer changes an organization's people, the first thing done after the roll forward.

### Bootstrapping Note

The release-please workflow becomes active once it reaches `main` (via the first `dev` → `main` promotion after this config is merged to `dev`).
`v0.1.0` shipped on 2026-09-13 and `v1.0.0` on 2026-10-18 (the first version a real market ran on); `.release-please-manifest.json` tracks the current version.

The first release was bootstrapped with `"release-as": "0.1.0"`, which has since been removed.
`release-as` is a forced version: it overrides the conventional-commit calculation on **every** run until it is cleared, so it is a one-time bootstrap and never a way to pick a version.
Each version is now derived from the accumulated commits (`feat:` → minor, `fix:` → patch, breaking change → major).

## Pre-Deploy: Required Production Environment

The back end **refuses to start** unless all eight of these are set, and it fails at import, so a deployment that is missing one serves nothing at all.
The check is `check_public_endpoint_defenses()` in [`back-end/app.py`](../back-end/app.py); keep this table in step with it, because a deploy checklist that is wrong is worse than none: it will be trusted.
Why each is required, and the rules around them, are the [security invariants](implementation/conventions/security-invariants.md).
Set them in the hosting environment **before** starting the Deploy workflow.
The startup log names every variable that is missing, all of them at once.

Two consequences of that are worth knowing before you deploy, because both are easier to meet head-on than to be ambushed by:

1. **The app does not degrade without these - it does not boot.**
   The check runs at import, which on a serverless host (Vercel) means on _every cold start_.
   A deploy started before the variables are set takes the deployment down rather than serving a weakened version of it.
   That is deliberate: each of these fails silently or unhelpfully when unset, and a deployment that half-works with its defenses off is the thing this check exists to prevent.
2. **The first deploy necessarily signs with a new `SECRET_KEY`, which ends every organizer session that exists today.**
   There is no fallback key any more, and the old committed one is refused by name, so the key cannot be the one production is signing with right now.
   Organizers are asked to log in again, once.
   That is the price of the key not being public, and reaching for the old value to avoid it is reaching for the vulnerability.

Three of them are defenses, and each fails _silently_ when unset - it stops defending and says nothing.
Four are required for the opposite reason: unset, the mail key breaks every route into an organizer account one 500 at a time, the link address mails every organizer a link to a laptop, the sender mails from an address that delivers to nobody, and the session backend sends a serverless deployment looking for a disk it does not have - and none of those failures names the variable behind it.
The eighth, the trusted-hop count, is quieter than any of them: nothing visibly breaks, and the only place an unset one shows is a reCAPTCHA score.

| Variable               | What it is                                                                                                                                                                                                                                                                                                                   | What an unset value would do                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SECRET_KEY`           | A long random string, at least 32 characters. Signs the Flask session cookie. Generate with `python -c 'import secrets; print(secrets.token_urlsafe(48))'`.                                                                                                                                                                  | The session cookie would be signed with a key published in this repository, so anyone could forge a session for any organizer and read and write their markets, vendors and applications - no password, no login.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `RECAPTCHA_SECRET_KEY` | The reCAPTCHA v3 secret ([admin console](https://www.google.com/recaptcha/admin)). Gates the public organizer signup endpoint (`POST /register`).                                                                                                                                                                            | The captcha would pass every caller, leaving an unauthenticated endpoint that writes a user document and sends mail from our domain with nothing in front of it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `CORS_ALLOWED_ORIGINS` | The comma-separated list of browser origins allowed to make credentialed requests to the API, each written exactly as a browser sends it - `https://app.example.com`, no trailing slash, no path. Usually just the front end's own origin.                                                                                   | The API answers cross-site requests with `Access-Control-Allow-Credentials: true`, and the organizer's session cookie is `SameSite=None`, so with no origin list every website an organizer visits could read and write the organizer API - markets, vendors, applications - as them. `*` is refused for the same reason. The same list decides which origins a browser's write is taken from: a write from any other origin answers 403 `Request origin not allowed`.                                                                                                                                                                                                      |
| `RESEND_API_KEY`       | The Resend API key ([dashboard](https://resend.com/api-keys)). Delivers every mail this product sends: the email-verification link, the mail telling an account's owner that someone signed up with its address, the password-reset link, the organizer's sign-in code and the vendor's sign-in code.                        | No organizer could get an account at all: registration rolls the new user back and answers 500 when the verification mail cannot be sent, an unverified account cannot log in, and password reset and OTP answer 500. The deployment would look healthy and onboard nobody.                                                                                                                                                                                                                                                                                                                                                                                                 |
| `FRONTEND_URL`         | The origin organizers sign in at, `https://conventioner.io` in production: an `https://` address with no path (one trailing `/` is dropped). Every link this product mails is it plus a path - the verification link, the reset link, the vendor's page, the door's link - and Discord's redirect after connecting a server. | Every mailed link would point at `http://127.0.0.1:5173`, a laptop's address, so no organizer could verify an account or reset a password, and no vendor could open their page from a mail.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `FROM_EMAIL`           | The address every mail is sent from, `registration@conventioner.io` in production: an address on the domain verified in Resend. A display-name form, `Conventioner <registration@conventioner.io>`, is taken.                                                                                                                | Mail would go from Resend's shared `onboarding@resend.dev`, which delivers only to the Resend account's own address, so no organizer or vendor would receive any; that address is refused when set, too.                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `SESSION_TYPE`         | Where the organizer's session is kept: `null` on a serverless host (Vercel), which keeps it in the signed cookie, or `filesystem` on a container or VM, which keeps it on local disk.                                                                                                                                        | Neither value is right for both hosts, so there is no default to fall back on. A serverless deployment that got `filesystem` would go looking for a disk that does not outlive a request: it raises at import, every request answers 500, and nothing in the log names this variable. It used to be derived from `FLASK_ENV`, which our own image pins to `development` - so the derivation answered `filesystem` on precisely the deployments that have no filesystem.                                                                                                                                                                                                     |
| `TRUSTED_PROXY_HOPS`   | How many proxies of **this deployment's own** a request passes through before it reaches Flask - a reverse proxy, a load balancer, or a serverless ingress each count as one. Vercel is `1`. `0` means Flask is exposed directly, and is a legitimate answer an operator has to give deliberately.                           | This is the address organizer signup reports to Google as reCAPTCHA's `remoteip`, and reCAPTCHA v3 _scores_ on it rather than passing or failing. Unset behind an ingress, that address is the ingress's - the same client, reported for every signup in the world - so real organizers are scored against `MIN_SCORE` on a signal that describes none of them. Setting it too high is the mirror failure: `X-Forwarded-For` is written by the caller, so trusting a hop the deployment does not own lets a caller name any address it likes. Only this variable makes the captcha - which this release enforces for the first time - score the person actually signing up. |

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
It must never be set on a deployed environment, and a deployed host refuses it.

### A deployed host refuses local switches

A back end that sees it is on a deployed host **refuses to start** with `ALLOW_INSECURE_LOCAL_DEV`, `DISABLE_CAPTCHA`, `DISABLE_EMAIL` or `DISCORD_FAKE` on (`true` or `1`), naming each and the variable that said the host is deployed, with every other problem the boot check found.
It sees a deployed host by a variable only the platform sets, the first of `VERCEL`, `VERCEL_ENV`, `VERCEL_REGION` and `AWS_LAMBDA_FUNCTION_NAME` that is set (`deployed_host` in [`back-end/utils/deployment.py`](../back-end/utils/deployment.py)), and uses it only to refuse, never to permit.
So a variable set while debugging, or a `back-end/.env` that reached a deployment, cannot turn off the defenses above.
Vercel exposes `VERCEL` and `VERCEL_ENV` to the runtime only while the back-end project's "Enable access to System Environment Variables" setting is ticked.
`/healthz` answers `deployed` (whether it sees one of those variables) and `localDev` (whether the hatch is on), and the Deploy workflow refuses a back end that does not answer `true` and `false`, staged or on its domain ([how a deploy proves itself](#how-a-deploy-proves-itself)), so the refusal is proven armed on every release.

`TRUSTED_PROXY_HOPS` decides which address the back end takes for the caller's, and two things read that address.
Organizer signup passes it to reCAPTCHA as the `remoteip` hint, which only started mattering when `RECAPTCHA_SECRET_KEY` became a boot requirement: before, a deployment without a secret took the dev-bypass path and no token ever reached Google.
The applicant's and the organizer's sign-in rate limits (`back-end/sign_in_limits.py`) count each caller by it, so a wrong hop count would put every applicant, and every organizer, behind one caller's limit.

### The front end has two requirements: the back end's address, and the other half of the reCAPTCHA pair

| Variable                  | Where it is set                                                                                                                                                                                                                                                                          | What an unset value would do                                                                                                                                                                                                                                                                               |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_FLASK_HOST`         | The **front end's build environment** (Vercel: the front-end project's environment variables). The back end's address, `https://api.conventioner.io` in production.                                                                                                                      | Every API request would go to the front end's own origin, whose rewrite answers every path with `index.html` and 200, so nothing works on a deployment that looks healthy.                                                                                                                                 |
| `VITE_RECAPTCHA_SITE_KEY` | The **front end's build environment** (Vercel: the front-end project's environment variables). The site key of the _same_ reCAPTCHA property as the back end's `RECAPTCHA_SECRET_KEY` - the two are a matched pair, and a key from another property fails exactly as an absent one does. | The bundle would carry no site key, so it has no captcha to solve and sends a placeholder token instead. The back end verifies that token against Google, Google never issued it, and `POST /register` answers 400 - every organizer signup, on a deployment that looks healthy and logs nothing about it. |

Making `RECAPTCHA_SECRET_KEY` a boot requirement is what makes this one load-bearing.
Before, a back end with no secret took its dev-bypass path and waved the placeholder token through, so a front end with no site key worked.
It cannot now: the back end refuses to boot without a real secret, and a real secret rejects a token Google did not issue.

Both are **build-time** variables, not runtime ones - Vite bakes them into the bundle - so setting one after the fact does nothing until the front end is rebuilt.
`vite build` refuses to produce a bundle without either (`assertCaptchaSiteKey` and `assertApiHost` in [`front-end/vite.config.ts`](../front-end/vite.config.ts)), for the same reason the back end refuses to boot without its half: the alternative is a deployment that ships, looks fine, and cannot register a single organizer, or cannot reach its back end at all.
The one exemption is `VITE_ALLOW_INSECURE_LOCAL_DEV=true`, which `front-end/.env.example` and `docker-compose.yml` set and which warns on every build it lets through.
It must never be set on a deployed build, and a Vercel build refuses it outright (`assertNoLocalHatchOnVercel`): when Vercel's own `VERCEL` is set in the build's environment and the hatch is `true`, `vite build` fails, whatever else is set.
Vercel sets `VERCEL` in a build only while the front-end project's "Enable access to System Environment Variables" setting is ticked (vercel.com/docs/environment-variables/system-environment-variables, read 2026-11-10), so the refusal is armed only with that box ticked.

### Optional: hosted TypeSafe

| Variable           | What it is                                                                                                                                                                                                                                                                                                                                                                                 | What an unset value does                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `TYPESAFE_API_KEY` | A TypeSafe API key ([console](https://console.typesafe.ai)). When an organizer starts a market from their Google Form's responses CSV, the proposal asks TypeSafe's Jev model two questions the rules leave: whether a trailing optional column is a question or a column the organizer's team added, and what ceiling on days per vendor a heading states in words the rules cannot read. | Nothing breaks: the rules alone decide, and those rows are left for the organizer to check. |

It is not a boot requirement, and a blank or placeholder value counts as unset (`back-end/utils/configured_secret.py`).
What a request sends is one column and never a row, and never an answer: the column's heading, how many rows answered it, how many answers are distinct, and a shape computed on the server, such as "prose, around 80 characters" ([ADR 0007](adr/0007-what-may-be-sent-to-hosted-typesafe.md)).
A ceiling question sends one heading's text.
A heading that holds an email, link, handle or phone number is not sent.
The upload step tells the organizer this in one line, shown only when the key is set.
A failure, a rate limit or a wait past 5 seconds leaves the rules' answer, marked "Couldn't reach TypeSafe".

### Optional: Discord

| Variable                                     | What it is                                                                                                                                                                                                      | What an unset value does                                                                                                                                       |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | The Conventioner application's OAuth2 client id and secret, from the Discord Developer Portal. Connecting a market exchanges the code Discord's approval screen sends back for the server the bot was added to. | With any of the three unset, Discord is off: the Discord card on the market's Tools tab says "Discord is not set up on this Conventioner." and offers nothing. |
| `DISCORD_BOT_TOKEN`                          | The application's bot token (Bot, Reset Token). Every call the bot makes on a connected server is made with it.                                                                                                 | As above.                                                                                                                                                      |

None is a boot requirement, and a blank or placeholder value counts as unset (`back-end/discord_client.py`, [the Discord connection](implementation/modules/discord.md)).
`DISCORD_FAKE`, which answers for Discord from a local stack's own database, is a test switch: a deployment never sets it, and one that inherits it ignores it, since it is honoured only under `ALLOW_INSECURE_LOCAL_DEV`.
The application needs its OAuth2 redirect set to `FRONTEND_URL` + `/discord/connected` (`https://conventioner.io/discord/connected` in production), "Requires OAuth2 Code Grant" switched on, and the Server Members Intent switched on.

## Pre-Deploy: Database Migrations

Migrations are never run automatically - rewriting stored documents is a deliberate operator action.

**A database created by `init_database.py` needs none of them**: it is born in the current shape and records the boot markers.
Production was started that way on 2026-10-18, so the list below matters only for a database older than its code.
Every script in `back-end/migrations/` is idempotent; the ones not described here (`migrate_roles`, `migrate_publishing_to_market_days`, `migrate_submitted_at_to_iso`, `migrate_tier_preference_per_date`, `migrate_table_code_separator`, `migrate_table_share_answer`, `migrate_to_uuid`, `add_email_verification`) each say in their own docstring what they repair and when; `cleanup_unverified_users` repairs nothing: it deletes every unverified account, and is a script never to run against production ([OPERATIONS.md](OPERATIONS.md#scripts-never-to-run-against-production)).

Before a deploy reaches an older production database, run the pending migrations in `back-end/migrations/` against the production database (each is idempotent, and `--dry-run` previews the changes):

```bash
python migrations/migrate_phase.py                    # backfills `phase` on existing markets
python migrations/migrate_market_keys.py              # rewrites market documents into canonical form (camelCase keys + stored slug, builds the UNIQUE slug index; stops and names markets that share a public address)
python migrations/migrate_is_draft_consistency.py     # makes `isDraft` agree with `phase` on markets that have one
python migrations/create_applications_collection.py   # creates the applications collection and its indexes
python migrations/migrate_user_emails.py              # stores every account address lowercased; stops and names (by id) accounts that share one
python migrations/check_vendor_day_duplicates.py      # reads only: names (by market, date and record id) any vendor's day held by two records
python migrations/migrate_placement_history.py        # AFTER the deploy, whenever: moves the placement history into the market's history
python migrations/migrate_to_one_stage.py             # AFTER the deploy, whenever: moves the three old stage phases into `applications`
python migrations/migrate_layouts.py                  # AFTER the deploy, whenever: ids on every section and location, the beta's floorplans and their images removed
python migrations/migrate_organization_people.py      # AFTER the deploy, whenever, `--dry-run` first: folds each organization's three lists of people into its `people` map
python migrations/migrate_organization_people.py --reconcile  # ONLY after a roll forward over a rollback past the map's release, `--dry-run` first: rebuilds each map from its lists
```

`migrate_placement_history.py` runs **after** its deploy, not before (E40/F01/S01): it moves every `placement_history` entry into `history` with its fields unchanged and drops the old collection, and a run before the deploy leaves behind whatever the old build writes meanwhile.
Nothing waits on it: the release reads `placement_history` beside `history`, so the older placements still show in the Assignment history and a vendor's History tab from the deploy on, and the release can be rolled back until the script has run ([the market's history](implementation/data/history.md#the-move-from-placement_history)).
It is idempotent, so an early run does no harm, but only a run after moves everything; a later release removes the fallback once every database is moved.

`migrate_to_one_stage.py` runs **after** the deploy that ships the one stage ([ADR 0016](adr/0016-one-stage-for-applications-and-review.md)), whenever the operator likes, never before it: the build before reads `applications` as an unknown phase, which degrades to archived.
That build reads the three old names as this script would leave them (`LEGACY_STAGE_PHASES` in `back-end/datatypes.py`), writing nothing back, so nothing waits on the script and the deploy can be rolled back until it has run; a later release drops those aliases once it has run on every database.
It moves every market in `applications_open`, `applications_closed` or `review` into `applications`, keeps a market whose vendors apply on its page and that stood in `applications_closed` or `review` (reached only through `applications_closed`) not taking applications (`applicationsStopped`, never over a stop the organizer set or cleared since the deploy), returns a Google Form market that imported nothing to draft to wait for its first import (the dry run names each), and renames those phases in every market's phase history.
Production held 2 markets when it was written: 1 in an old phase (a market whose vendors apply on its page, in `review`, which comes out not taking applications) and 1 in `market_days`, whose phase history alone is renamed.
Run `--dry-run` first and read it, then run it without, from `back-end/` with the production address passed inline and never in `.env`, as the script's Usage says.
It is idempotent: a second run says "Nothing to change".

`migrate_layouts.py` runs **after** the deploy that makes a floorplan a location's layout (T257), whenever the operator likes; a database `init_database.py` started needs it too, since production holds floorplans the beta saved.
That build reads an unmigrated market without failing: a section or location with no id reads with the id the script would store (`fill_plan_ids` in `back-end/datatypes.py`), and a floorplan the beta saved reads as one of no location and is ignored, so nothing refuses to boot and nothing waits on the script.
A rollback past that build is not clean, whether the script has run or not: the build before keeps no id, no table type and no layout's location or tables, so its first plan write on a market strips them, and once rolled forward that market's layouts read as the beta's and are gone.
After the deploy, a Market Setup tab still open on the bundle before sends its plan without ids; on a market with a layout, its write is refused with "This page was opened before an update" when a row it sends would read with an id the market does not hold (a location a newer page added, or one it renamed), so it never drops a layout, and the organizer reloads.
It gives every section and location without one that id, removes every floorplan with no `locationId` (every one the beta saved; none is kept), and deletes every file in the `floorplan_images` GridFS bucket that no floorplan names, read again from every market just before it deletes, but one uploaded after the run began; a run that met a market changed under it deletes no file and leaves the sweep to the next run.
It prints each market it changes and the counts ([the market document](implementation/data/market-document.md#the-boot-refusal-and-the-migration)).
Run `--dry-run` first and read it, then run it without, from `back-end/` with the production address passed inline and never in `.env`, as the script's Usage says; take a `mongodump` first (below), since the images it deletes are gone.
It is idempotent: a second run changes nothing, and a run that found a market changed under it says so and records no `layouts_v1` marker, so run it again.

`migrate_organization_people.py` runs **after** the deploy that ships an organization's `people` map ([ADR 0025](adr/0025-an-organizations-people-are-one-map.md)), whenever the operator likes, never before it: the build before changes only the three lists, so a map written earlier goes stale under its writes, and the build after reads the map over the lists.
That build reads an organization stored before the map by folding its three lists, the owner winning, and the first change to its people folds it in, so nothing waits on the script and the boot does not check for it.
It writes `people` on every organization that has none, in one write held on the lists as read, and keeps `owner`, `admins` and `members` as the map's mirror, so the release before still reads the same people after a rollback.
It leaves alone, and lists, an organization with no owner, one holding an id that cannot be a key of the map, and one that changed during the run (run it again for that one).
Run `--dry-run` first: it writes nothing and prints each organization it would fold, whether it does not parse on the release before (its owner also an admin or a member) and whether it lists an admin also as a member, then the counts; [OPERATIONS.md](OPERATIONS.md#starting-a-database-and-migrations) says what of it goes into the team's records.
Then run it without, from `back-end/` with the production address passed inline and never in `.env`, as the script's Usage says.
It is idempotent: a second run folds nothing.

`migrate_organization_people.py --reconcile` runs only after a roll forward over a rollback past that release ([Rolling back](#rolling-back)), never otherwise, since on the map's release the map is the truth and its own writes keep the lists in step.
It folds as above, and on every folded organization whose map and lists disagree it rebuilds the map from the lists (each person still in it keeping their position, those new to it after them), in one write held on the map and the three lists as read, setting the lists as the new map's mirror.
Its `--dry-run` prints each organization it would rebuild and whose place would change; it too is idempotent, and lists one that changed during the run.

`migrate_user_emails.py` **must** be run before the code that holds one account per address (E32/F03/S04).
The back end builds a UNIQUE index on the stored, lowercased address at boot (`api.users.ensure_user_indexes`) and refuses to boot while any address is stored with capitals, naming this script, or while two accounts share an address, naming them by id.
Register used to check for an address and then insert it, so a double click could make two accounts; which one an organizer keeps is theirs to decide, so the migration names a clash and writes nothing.

`check_vendor_day_duplicates.py` **must** be run, and exit 0, before promoting the release carrying T270, the first whose boot can refuse on a vendor's day held by two records.
That release builds a UNIQUE index on `(market_id, vendor_email, date)` at boot on `attendance` (`api.attendance.ensure_attendance_indexes`) and on `amounts_owed` (`payments.ensure_payment_indexes`), and refuses to boot while any vendor's day in either has two records, which two check-ins, or an amount set as the seat was freed, at the same moment could store before.
The script reads every collection in `unique_indexes.VENDOR_DAY_INDEXES`, each of which its owner builds such an index on at boot.
The script writes nothing: it prints each such vendor's day by market id, date and record id, never by address, and exits 1 when there is any; resolving one is [OPERATIONS.md's](OPERATIONS.md#when-the-back-end-refuses-to-boot).
Daniel runs it through an ops session, with the production address passed inline: `MONGODB_URI='<URI>' .venv/bin/python migrations/check_vendor_day_duplicates.py`.
The merge does not wait on it; the promotion does.

`create_applications_collection.py` creates the applications collection and builds both its indexes: `market_id` (the lookup the D9 lock counts on) and the unique compound index on `(market_id, applicant_email, application_type)` that enforces one applicant per market.
The uniqueness is the database's, not the application code's - the write that creates an application is an atomic upsert (`find_or_create_application` in `api/applications.py`), and the unique index is what makes it safe under concurrency.
A database that already holds duplicates cannot take the index; the migration detects them and names the conflicting documents rather than failing with a cryptic key-build error.
See `api.applications.ensure_application_indexes`.

`migrate_is_draft_consistency.py` **must** be run with the code that makes `phase` the single source of truth, and it is the migration whose omission is visible to vendors.
A market the old build published carries `phase: "draft"` + `isDraft: false` (publishing was a `PUT` of `isDraft: false`; nothing advanced the phase), and every read now derives the market's state from `phase`.
`draft` is a recognized phase, so it is taken at face value: until the migration advances those markets to `archived`, an already-live market reverts to looking unpublished - its public check-in URL returns `404`, and its organizer is routed back into the setup wizard.
The migration repairs that disagreement in favour of `isDraft`, because on those documents `isDraft` was the only publish signal that ever existed.
Run it after `migrate_phase.py`: the two are disjoint by construction (one touches only documents _with_ a `phase`, the other only those without), but that ordering means a database migrated in one pass ends up fully consistent.

`migrate_market_keys.py` **must** be run before the code that reads market documents by the canonical key only and the code that queries the stored slug.
An unmigrated market is invisible to every such read: vendors are told the market does not exist at check-in, applicants get a 404 at the public market URL, and organization members get an empty market list.
The migration records every one of its marker documents (`market_document_keys`, `market_slugs` and `market_slugs_unique`) in the `schema_migrations` collection, builds the unique `market_slug` index (stopping to name any stored markets that already share a public address), and the back end refuses to boot unless it can read every marker; the fatal log names every missing one and the script to run.
The check fails closed on anything short of confirmed markers - an unknown migration state is not a migrated one - so a deploy that skipped the migration fails loudly at startup rather than quietly serving half the data.

## Files

| File                                                                              | Purpose                                                                                                                                                                   |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`release-please-config.json`](../release-please-config.json)                     | Configures release-please: release type `simple` (driven by conventional commits alone, no language's package file parsed), tags `vX.Y.Z`                                 |
| [`.release-please-manifest.json`](../.release-please-manifest.json)               | Tracks the current version per package, auto-updated by release-please                                                                                                    |
| [`.github/workflows/release-please.yml`](../.github/workflows/release-please.yml) | GitHub Actions workflow that runs release-please on pushes to `main`                                                                                                      |
| [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)                 | GitHub Actions workflow, started by hand, that deploys `main`                                                                                                             |
| [`scripts/deploy_proof.py`](../scripts/deploy_proof.py)                           | Every check the Deploy workflow makes: the Test run on `main`, and each build's commit, headers and deep link ([how a deploy proves itself](#how-a-deploy-proves-itself)) |
| [`.github/workflows/promote.yml`](../.github/workflows/promote.yml)               | GitHub Actions workflow, started by hand from `dev` with a commit's sha, that fast-forwards `main` to it as the Promote App                                               |
| [`scripts/promote_check.py`](../scripts/promote_check.py)                         | Every check the Promote workflow makes before it moves `main`, read-only ([how a promotion proves itself](#how-a-promotion-proves-itself))                                |
| [`scripts/github_runs.py`](../scripts/github_runs.py)                             | The reading of the Test workflow's runs, and the one authenticated GitHub read, that Deploy's and Promote's checks share                                                  |
| `CHANGELOG.md`                                                                    | Auto-generated changelog, written by release-please and never by hand                                                                                                     |
