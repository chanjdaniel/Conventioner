# Operations

How production runs, and what to do when something about it needs doing.
For how a change reaches production, see [RELEASING.md](RELEASING.md); for building production again from nothing, [VERCEL_DEPLOYMENT.md](VERCEL_DEPLOYMENT.md); for the local stack, [STARTUP.md](STARTUP.md).

Production went live on 2026-10-18 as v1.0.0.

## What runs where

| Piece | Where | Name and address |
| --- | --- | --- |
| Front end (Vue) | Vercel project `makers-market-management-front-end` (`prj_uWBC9BJyAmG3KITC5y23AHtq7eyN`), root `front-end/` | `https://conventioner.io` |
| Back end (Flask) | Vercel project `makers-market-management-back-end` (`prj_KlG2FlrqAxbX7afm7xuYEcBzqPeg`), root `back-end/`, Python 3.12 (`back-end/.python-version`) | `https://api.conventioner.io` |
| Vercel team | `chanjdaniels-projects` (`team_Gbd0cUxeyRWKRqeIhkta9F8Q`), Hobby plan | |
| Database | MongoDB Atlas project `conventioner-prod`, cluster `conventioner-prod` (Flex, AWS us-east-1, MongoDB 8.0), database `conventioner` | `conventioner-prod.ool6hjl.mongodb.net` |
| Email | Resend, sending domain `conventioner.io`, sender `registration@conventioner.io` | verification links, password resets, sign-in codes |
| Captcha | Google reCAPTCHA v3, one property listing `conventioner.io` | organizer sign-up only |
| CSV help | Hosted TypeSafe (optional) | reading a Google Form export's columns |
| CI and deploys | GitHub Actions: `Test` (`test.yml`), `Deploy` (`deploy.yml`), `Release Please` | `github.com/chanjdaniel/Conventioner` |

The domains are DNS records at a third-party registrar pointing at Vercel.

## Health at a glance

```bash
curl https://api.conventioner.io/healthz        # {"status":"ok"}: booted, configured, migrated, database answers
curl -o /dev/null -w '%{http_code}\n' https://conventioner.io/markets   # 200: the front end and its deep links
```

A back end that fails its boot checks answers every request with a 500 and `FUNCTION_INVOCATION_FAILED`; its log says which check refused (see [Incidents](#incidents)).

## Configuration and secrets

Everything below is set per environment in the Vercel project (Settings, Environment Variables, **Production**) unless noted.
Values are never committed, and the app refuses to boot on a blank, a placeholder, or any value this repository has ever printed (see [RELEASING.md](RELEASING.md#pre-deploy-required-production-environment) for what each one defends).

| Variable | Project | Value or source |
| --- | --- | --- |
| `MONGODB_URI` | back end | Atlas, Connect, Drivers, with the database user's password |
| `SECRET_KEY` | back end | generated: `python -c 'import secrets; print(secrets.token_urlsafe(48))'` |
| `SESSION_TYPE` | back end | `null` (the session lives in the signed cookie) |
| `CORS_ALLOWED_ORIGINS` | back end | `https://conventioner.io` |
| `TRUSTED_PROXY_HOPS` | back end | `1` |
| `FRONTEND_URL` | back end | `https://conventioner.io` (the links in outgoing mail) |
| `FROM_EMAIL` | back end | `registration@conventioner.io` |
| `RESEND_API_KEY` | back end | Resend dashboard, API keys |
| `RECAPTCHA_SECRET_KEY` | back end | reCAPTCHA admin console, the property's secret |
| `TYPESAFE_API_KEY` | back end | TypeSafe console (optional; unset means the rules alone) |
| `VITE_FLASK_HOST` | front end, **build time** | `https://api.conventioner.io` |
| `VITE_RECAPTCHA_SITE_KEY` | front end, **build time** | the same reCAPTCHA property's site key |
| `VERCEL_TOKEN` | GitHub, environment `production`, secret | vercel.com/account/tokens, scoped to the team |
| `VERCEL_ORG_ID`, `VERCEL_BACKEND_PROJECT_ID`, `VERCEL_FRONTEND_PROJECT_ID` | GitHub, repository variables | the ids in the table above |

**Changing a variable does nothing until the next deploy**, and a `VITE_` one is baked into the front-end bundle when it is built.
After changing one, redeploy without a code change: GitHub, Actions, **Deploy**, Run workflow, from `main`.

Rotating `SECRET_KEY` signs every organizer out once; that is expected.
Rotating the database password means updating `MONGODB_URI` and redeploying, in that order, or the back end cannot boot.
When `VERCEL_TOKEN` expires, the Deploy workflow fails at "Deploy the back end" with an authentication error; create a new token and set the secret again.

## Accounts and access

There is no site-wide administrator.
What a person may do is decided per organization and per market:

| Role | Where it comes from | What it allows |
| --- | --- | --- |
| Organization owner, admin, member | Manage organization (Organizations page) | being in the organization, and **Viewer** on every market it holds - nothing more |
| Market owner | creating the market | everything, including roles and deletion |
| Market admin | Manage market | phase moves, verdicts, importing, publishing, plus everything an editor does |
| Market editor | Manage market | the plan, the form, placements, and checking vendors in at the door |
| Market viewer | Manage market, or organization membership | reading |

**Organization membership alone gives Viewer on its markets, even to the organization's owner and admins.**
Anyone who must change a market, including a volunteer at the door, needs a role on that market: Markets, the market's card, **Manage**, "Users with access", **Add user**, their email and a role.
The person must already have an account.

### Making an account

The normal way is the product's own sign-up at `https://conventioner.io/login`, Register: it checks the captcha and emails a verification link from `registration@conventioner.io`, and the account cannot sign in until the link is clicked.

When sign-up is the problem (the email does not arrive, the captcha refuses), or an account is wanted before its owner can click a link, make it by hand from `back-end/`:

```bash
MONGODB_URI='<production URI>' .venv/bin/python create_account.py create someone@example.com   # asks for the password
MONGODB_URI='<production URI>' .venv/bin/python create_account.py verify someone@example.com   # an account stuck unverified
```

It lowercases the address (login matches the stored address exactly), makes the account in the shape sign-up makes, and never takes the password as an argument.
Then give the person access in the product as above.
A forgotten password is reset by its owner from the sign-in page ("Forgot password?"); there is no operator path, and none is needed.
`create_test_user.py` is the test fixtures' script: it prints the password it was given, so do not use it for real accounts.

## The production database

### Connecting

Run one-off scripts from `back-end/` with the URI **on the command line**, as above.
**Never put the production `MONGODB_URI` in `back-end/.env`**: the local Docker stack mounts that directory and the app reads that file, so the local stack would quietly run against production.
For a shell, `mongosh '<production URI>'` and `use conventioner`; prefer reading.

The app connects as the Atlas database user `conventioner-app`.
Network access is open to `0.0.0.0/0`, because Vercel's functions have no fixed addresses, so that user's password is the whole of the database's protection.
That user currently has the `atlasAdmin` role, which is more than the app needs: a least-privilege user (`readWrite` on `conventioner`, which also covers the collections and indexes `init_database.py` creates) would limit what a leaked URI could do.
Recommended: create one, move `MONGODB_URI` to it, redeploy, and keep the admin user for operators only.

### Backups and restoring

Atlas snapshots the Flex cluster **once a day and keeps the last 8**; restore one from the cluster's Backup page in Atlas.
A Flex cluster **cannot take a snapshot on demand**, so before anything risky by hand (a migration, a bulk fix) take your own:

```bash
mongodump --uri '<production URI>' --db conventioner --out ~/conventioner-backups/$(date +%F-%H%M)
mongorestore --uri '<production URI>' --nsInclude 'conventioner.*' --drop ~/conventioner-backups/<folder>   # restores it, replacing what is there
```

A dump holds every vendor's name, email and answers: keep it on your own machine, never in this repository, a shared drive or a CI artifact (the repository is public).

### Starting a database, and migrations

A new database is started once with `MONGODB_URI='<URI>' .venv/bin/python init_database.py`: it creates the collections and indexes and records the markers the back end refuses to boot without.
Production was started that way on 2026-10-18, so no script in `back-end/migrations/` was needed then; [RELEASING.md](RELEASING.md#pre-deploy-database-migrations) says when one is.
The first that is: the release carrying E32 refuses to boot until every account address is stored lowercased, so run `MONGODB_URI='<URI>' .venv/bin/python migrations/migrate_user_emails.py --dry-run`, then without `--dry-run`, before promoting it.
If it names accounts that share an address (by id; it prints no address), keep one of each and run it again.

### Scripts never to run against production

- `reset_database.py` empties every collection. It refuses whenever `MONGODB_URI` is set, so it cannot reach production by accident.
- `migrations/cleanup_unverified_users.py` deletes every unverified account (use `--dry-run` first, or `--email` for one).
- `create_test_user.py` makes a fixture account and prints its password.

## Deploying, releasing, and branch rules

In short (the detail is [RELEASING.md](RELEASING.md)):

- Changes reach `dev` by PR; `dev` and `main` both require the `backend`, `frontend-unit`, `frontend-lint-and-types`, `docker-build` and `e2e` checks.
- Promote a commit whose `dev` CI is green: `git fetch origin && git push origin <sha>:main`.
  The Test workflow runs on `main`, then the Deploy workflow deploys the back end, checks `/healthz`, deploys the front end, and checks a deep link.
  Watch it under Actions; a failed run says how to roll back in its summary.
- After release-please's Release PR is merged, merge `main` back into `dev` (a PR from `main` to `dev`), or the next promotion is not a fast-forward.
- During a market window, `dev` takes fixes only, and no hotfix carries a migration.

## Watching it run

| What | Where |
| --- | --- |
| Is it up | `curl https://api.conventioner.io/healthz` |
| Back-end errors and logs | Vercel, the back-end project, Logs; or `vercel logs --deployment <id>` (Vercel CLI, logged in to the team) |
| Which build a domain serves | `vercel inspect https://api.conventioner.io` (and `https://conventioner.io`) |
| Deploys and their checks | GitHub, Actions, Deploy |
| Email delivery | Resend dashboard, Emails (each send, bounce and complaint) |
| Database load and connections | Atlas, the cluster's Metrics |

Vercel's Hobby plan keeps runtime logs for about an hour, so read them while the problem is happening.

## Incidents

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| Every API call answers 500 `FUNCTION_INVOCATION_FAILED` | The back end refused to boot | Read the back end's log: it names every missing or refused variable, or an unreachable database, or a missing migration marker. Fix the variable or the database, then redeploy (Deploy, Run workflow). |
| A deploy succeeded but the domain still serves an old build | The project is in Vercel's rolled-back state, which stops new production builds receiving the domain | `vercel promote <deployment>` (or Promote in the dashboard) for the build that should be live. This kept `api.conventioner.io` on an April build until 2026-10-18. |
| A deploy broke something | | Roll back each affected project in Vercel (Deployments, Instant Rollback), then revert on `dev`, promote the revert, and promote the fixed build so later deploys reach the domain again. See [RELEASING.md](RELEASING.md#rolling-back). |
| Organizers cannot sign up (400) | The captcha site key and secret are from different properties, or `conventioner.io` is not on the property's domain list | Check both keys in the reCAPTCHA console; a changed site key needs a front-end rebuild. Meanwhile, make the account by hand. |
| No verification, reset or sign-in email arrives | Resend refused or the domain lost verification | Resend dashboard, Emails and Domains. Meanwhile, `create_account.py verify` the account. |
| The browser reports a CORS error | The page's origin is not `CORS_ALLOWED_ORIGINS` | It must be exactly `https://conventioner.io`, no trailing slash; a new front-end domain must be added. |
| The Deploy workflow fails at "Refuse to run half-configured" or "Deploy the back end" | A GitHub variable is missing, or `VERCEL_TOKEN` expired | Set it again (see [Configuration](#configuration-and-secrets)) and re-run. |
| Vendors cannot find themselves at check-in | The market is not published (`market_days`), or they use another address | The check-in page serves only a published market, by the address they applied with; an editor can check them in from Attendance. |
