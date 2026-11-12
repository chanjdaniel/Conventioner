---
layer: implementation
kind: runbook
describes:
  - back-end/market_documents.py#assert_market_key_migration_recorded
  - back-end/migrations/migrate_market_keys.py
  - back-end/api/users.py#ensure_user_indexes
  - back-end/migrations/migrate_user_emails.py
  - back-end/api/applications.py#ensure_application_indexes
  - back-end/migrations/create_applications_collection.py
  - back-end/migrations/migrate_placement_history.py
  - back-end/api/applicant_auth.py#ensure_applicant_login_indexes
  - back-end/migrations/migrate_organization_people.py
  - back-end/api/attendance.py#ensure_attendance_indexes
  - back-end/payments.py#ensure_payment_indexes
  - back-end/migrations/check_vendor_day_duplicates.py
verified: 2026-11-11
sources:
  - E32/F03/S03
  - T15
  - T24
  - T74
  - decision/2026-10-20
  - E40/F01/S01
  - T254
  - T263
  - T255
  - T270
---

# Operations

How production runs, and what to do when something about it needs doing.
For how a change reaches production, see [RELEASING.md](RELEASING.md); for building production again from nothing, [VERCEL_DEPLOYMENT.md](VERCEL_DEPLOYMENT.md); for the local stack, [STARTUP.md](STARTUP.md).

Production went live on 2026-10-18 as v1.0.0.

## What runs where

| Piece            | Where                                                                                                                                               | Name and address                                                                                                                                       |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Front end (Vue)  | Vercel project `makers-market-management-front-end` (`prj_uWBC9BJyAmG3KITC5y23AHtq7eyN`), root `front-end/`                                         | `https://conventioner.io`                                                                                                                              |
| Back end (Flask) | Vercel project `makers-market-management-back-end` (`prj_KlG2FlrqAxbX7afm7xuYEcBzqPeg`), root `back-end/`, Python 3.12 (`back-end/.python-version`) | `https://api.conventioner.io`                                                                                                                          |
| Vercel team      | `chanjdaniels-projects` (`team_Gbd0cUxeyRWKRqeIhkta9F8Q`), Hobby plan                                                                               |                                                                                                                                                        |
| Database         | MongoDB Atlas project `conventioner-prod`, cluster `conventioner-prod` (Flex, AWS us-east-1, MongoDB 8.0), database `conventioner`                  | `<cluster>.<id>.mongodb.net`; the real host is in the back end's `MONGODB_URI` (its Vercel environment) and in 1Password                               |
| Email            | Resend, sending domain `conventioner.io`, sender `registration@conventioner.io`                                                                     | verification links, password resets, sign-in codes                                                                                                     |
| Captcha          | Google reCAPTCHA v3, one property listing `conventioner.io`                                                                                         | organizer sign-up only                                                                                                                                 |
| CSV help         | Hosted TypeSafe (optional)                                                                                                                          | reading a Google Form export's columns                                                                                                                 |
| Discord          | Discord Developer Portal, the Conventioner application (optional)                                                                                   | connecting a market to an organizer's server, where a later run gives its vendors a role ([the Discord connection](implementation/modules/discord.md)) |
| CI and deploys   | GitHub Actions: `Test` (`test.yml`), `Deploy` (`deploy.yml`), `Release Please`                                                                      | `github.com/chanjdaniel/Conventioner`                                                                                                                  |

The domains are DNS records at a third-party registrar pointing at Vercel.

## Health at a glance

```bash
curl https://api.conventioner.io/healthz        # {"commit":"<sha>","deployed":true,"localDev":false,"status":"ok"}: booted, configured, migrated, database answers
curl https://conventioner.io/version.json       # {"commit":"<sha>"}: the commit the front end was built from
curl -o /dev/null -w '%{http_code}\n' https://conventioner.io/markets   # 200: the front end and its deep links
```

A back end that fails its boot checks answers every request with a 500 and `FUNCTION_INVOCATION_FAILED`; its log says which check refused (see [Incidents](#incidents)).

## Configuration and secrets

Everything below is set per environment in the Vercel project (Settings, Environment Variables, **Production**) unless noted.
Values are never committed, and the app refuses to boot on a blank, a placeholder, or any value this repository has ever printed (see [RELEASING.md](RELEASING.md#pre-deploy-required-production-environment) for what each one defends).

| Variable                                                                   | Project                                  | Value or source                                                                                                                                              |
| -------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `MONGODB_URI`                                                              | back end                                 | Atlas, Connect, Drivers, with the database user's password                                                                                                   |
| `SECRET_KEY`                                                               | back end                                 | generated: `python -c 'import secrets; print(secrets.token_urlsafe(48))'`                                                                                    |
| `SESSION_TYPE`                                                             | back end                                 | `null` (the session lives in the signed cookie)                                                                                                              |
| `CORS_ALLOWED_ORIGINS`                                                     | back end                                 | `https://conventioner.io`                                                                                                                                    |
| `TRUSTED_PROXY_HOPS`                                                       | back end                                 | `1`                                                                                                                                                          |
| `FRONTEND_URL`                                                             | back end                                 | `https://conventioner.io` (the address organizers sign in at: the links in outgoing mail, and Discord's OAuth2 redirect, this + `/discord/connected`)        |
| `FROM_EMAIL`                                                               | back end                                 | `registration@conventioner.io`                                                                                                                               |
| `RESEND_API_KEY`                                                           | back end                                 | Resend dashboard, API keys                                                                                                                                   |
| `RECAPTCHA_SECRET_KEY`                                                     | back end                                 | reCAPTCHA admin console, the property's secret                                                                                                               |
| `TYPESAFE_API_KEY`                                                         | back end                                 | TypeSafe console (optional; unset means the rules alone)                                                                                                     |
| `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN`          | back end                                 | Discord Developer Portal, the Conventioner application: OAuth2's client id and secret, Bot's token (optional, all three or none; unset means Discord is off) |
| `VITE_FLASK_HOST`                                                          | front end, **build time**                | `https://api.conventioner.io`                                                                                                                                |
| `VITE_RECAPTCHA_SITE_KEY`                                                  | front end, **build time**                | the same reCAPTCHA property's site key                                                                                                                       |
| `VERCEL_TOKEN`                                                             | GitHub, environment `production`, secret | vercel.com/account/tokens, scoped to the team                                                                                                                |
| `VERCEL_ORG_ID`, `VERCEL_BACKEND_PROJECT_ID`, `VERCEL_FRONTEND_PROJECT_ID` | GitHub, repository variables             | the ids in the table above                                                                                                                                   |

In the back-end project's Environment Variables settings, **"Enable access to System Environment Variables" stays ticked**: it is how the back end's runtime sees `VERCEL` and `VERCEL_ENV`, and so knows it is deployed and refuses the local-development switches ([RELEASING.md](RELEASING.md#a-deployed-host-refuses-local-switches)).
The Deploy workflow refuses a back end that does not see it, before anything is promoted.

**Changing a variable does nothing until the next deploy**, and a `VITE_` one is baked into the front-end bundle when it is built.
After changing one, redeploy without a code change: GitHub, Actions, **Deploy**, Run workflow, from `main`.

Rotating `SECRET_KEY` signs every organizer out once; that is expected.
Rotating the database password means updating `MONGODB_URI` and redeploying, in that order, or the back end cannot boot.
When `VERCEL_TOKEN` expires, the Deploy workflow fails at "Stage the back end" with an authentication error; create a new token and set the secret again.

## Accounts and access

There is no site-wide administrator.
What a person may do is decided per organization and per market:

| Role                      | Where it comes from                                          | What it allows                                                                                         |
| ------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Organization owner, admin | Manage organization (Organizations page)                     | **Admin** on every market the organization holds - never the market's owner                            |
| Organization member       | Manage organization (Organizations page)                     | **Viewer** on every market the organization holds                                                      |
| Market owner              | creating the market, or being handed it by the owner         | everything, including roles, handing the market on and deletion                                        |
| Market admin              | Manage market, or being the organization's owner or an admin | phase moves, importing, publishing results, adding editors and viewers, plus everything an editor does |
| Market editor             | Manage market                                                | the plan, the form, verdicts on applications, placements, and checking vendors in at the door          |
| Market viewer             | Manage market, or organization membership                    | reading                                                                                                |

**An organization's owner and admins run every market it holds, and its members read them.**
A role given on a market is held beside the organization's, and the higher one counts; only the market's owner deletes it.
Anyone outside the organization who must change a market, including a volunteer at the door, needs a role on that market: Markets, the market's card, **Manage**, "Users with access", **Add user**, their email and a role.
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

### The test markets

Checking something in production - that an applicant's sign-in code arrives, that a Google Form market's sign-in reads as no market - needs markets that are nobody's real one.
`seed_test_markets.py` makes them in "Conventioner Test Organization", owned by your own account (make it first, as above), through the product's own writes: it creates and moves each market the way the endpoints do ([the guards and the phase move](implementation/modules/guards.md)).
Check against those, never against a real organizer's market.
Run it from `back-end/` in a checkout of what production runs (`main`), so it writes what that build reads; it arrives there with the E32 release, whose migration must have run first (below).

```bash
MONGODB_URI='<production URI>' .venv/bin/python seed_test_markets.py --owner you@example.com
```

With neither `MONGODB_URI` nor `MONGODB_HOST` set, or with them naming the primary checkout's local MongoDB, it refuses before it writes anything ([the scripts never to run against production](#scripts-never-to-run-against-production)).

- "Conventioner Test - Online Applications" takes applications on its page.
  "Conventioner Test - Google Form" imports its vendors.
  Both are left open, with dates a year out and no applicant.
- It prints each market's phase and path, which is under `https://conventioner.io`.
  Running it again changes nothing that exists, and finishes a market a failed run left in draft.
  It refuses, naming it, a test organization owned by another account or a market address held outside it.
- `front-end/e2e/seed-test-markets.spec.ts` runs it twice from an empty start in the back-end container, visits both markets as a stranger, and applies to the online one as a vendor.
- Apply or import with made-up details only, and an address you own for a sign-in code.
  To start over, delete the market in the product and run it again.

## The production database

### Connecting

Run one-off scripts from `back-end/` with the URI **on the command line**, as above.
**Never put the production `MONGODB_URI` in `back-end/.env`**: the local Docker stack mounts that directory and the app reads that file, so the local stack would quietly run against production.
For a shell, `mongosh '<production URI>'` and `use conventioner`; prefer reading.

The app connects as the Atlas database user `conventioner-app`.
Network access is open to `0.0.0.0/0`, because Vercel's functions have no fixed addresses, so that user's password is the whole of the database's protection.
That user currently has the `atlasAdmin` role, which is more than the app needs: a least-privilege user (`readWrite` on `conventioner`, which also covers the collections and indexes `init_database.py` creates) would limit what a leaked URI could do.
Recommended: create one, move `MONGODB_URI` to it, redeploy, and keep the admin user for operators only.

The client's timeouts and pool size are set in code and win over the same option in `MONGODB_URI`, so changing them means changing [`db_config.py`](../back-end/db_config.py), not the URI ([the database client's bounds](implementation/data/market-document.md#the-database-clients-bounds)).

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
The release carrying E40/F01/S01 moves the placement history into the market's history: once it is deployed, whenever is convenient, run `MONGODB_URI='<URI>' .venv/bin/python migrations/migrate_placement_history.py --dry-run` ([`migrate_placement_history.py`](../back-end/migrations/migrate_placement_history.py)), which counts the entries it would move, then without `--dry-run`.
Until it runs, that release reads the old `placement_history` collection beside the new one, so the older placements still show in the Assignment history and a vendor's History tab, and nothing refuses to boot; a later release removes that fallback ([the market's history](implementation/data/history.md#the-move-from-placement_history)).
The release that makes a floorplan a location's layout (T257) removes every floorplan the floorplan beta saved, with its image: once it is deployed, take a `mongodump`, then run `MONGODB_URI='<URI>' .venv/bin/python migrations/migrate_layouts.py --dry-run` ([`migrate_layouts.py`](../back-end/migrations/migrate_layouts.py)), which names each market it would change and counts the floorplans and images it would remove, then without `--dry-run`.
Until it runs, that release reads each market as the script would leave it and ignores the beta's floorplans, so nothing refuses to boot ([RELEASING.md](RELEASING.md#pre-deploy-database-migrations)).
The release carrying T283 keeps an organization's people in one map: once it is deployed, run `MONGODB_URI='<URI>' .venv/bin/python migrations/migrate_organization_people.py --dry-run` ([`migrate_organization_people.py`](../back-end/migrations/migrate_organization_people.py)), then without `--dry-run`.
The dry run is the read-only count of how many organizations do not parse on the release before (an owner also an admin or a member), and it writes nothing.
It prints each organization's id and name; only its counts go into the team's records, never a name or an id.

### When the back end refuses to boot

The back end checks the database as it starts and refuses to serve one it cannot trust: the migration markers ([`market_documents.py`](../back-end/market_documents.py)) and these unique indexes, in the order the boot builds them:

- one application per applicant, `market_applicant_type_unique` ([`api/applications.py`](../back-end/api/applications.py));
- one sign-in code per applicant, `market_email_unique` ([`api/applicant_auth.py`](../back-end/api/applicant_auth.py));
- one account per address, `user_email` ([`api/users.py`](../back-end/api/users.py));
- one attendance record per vendor's day, `attendance_vendor_day_unique` ([`api/attendance.py`](../back-end/api/attendance.py), through [`unique_indexes.py`](../back-end/unique_indexes.py));
- one owed record per vendor's day, `amounts_owed_vendor_day_unique` ([`payments.py`](../back-end/payments.py), through [`unique_indexes.py`](../back-end/unique_indexes.py));
- one payment per press of Record, `payments_request_key_unique` ([`payments.py`](../back-end/payments.py), through [`unique_indexes.py`](../back-end/unique_indexes.py)).

Every request then answers 500 `FUNCTION_INVOCATION_FAILED`, and the log says which check refused and what to run (Vercel, the back-end project, Logs).
Each refusal below names its fix; take a `mongodump` first (above) when the fix writes.
On a local stack the same refusals appear in `docker compose logs backend`, and the commands run as `docker compose run --rm backend python <script>` - `run`, not `exec`, because the back-end container is crash-looping and there is nothing to attach to ([STARTUP.md](STARTUP.md#troubleshooting)).

**"The market-document migration has not been applied to this database: no '...' marker"**.
The database lacks one of the markers [`migrations/migrate_market_keys.py`](../back-end/migrations/migrate_market_keys.py) records in `schema_migrations` (`market_document_keys`, `market_slugs`, `market_slugs_unique`), so its markets may be stored under legacy keys or without their slug, and would be invisible rather than broken ([the market document](implementation/data/market-document.md#the-boot-refusal-and-the-migration)).
A database older than a marker lacks it, so a local stack meets this on the first pull that adds one.
The migration is the whole fix, and one run records every marker:

```bash
MONGODB_URI='<URI>' .venv/bin/python migrations/migrate_market_keys.py --dry-run   # what it would rewrite, and any shared address
MONGODB_URI='<URI>' .venv/bin/python migrations/migrate_market_keys.py
```

Then redeploy (Deploy, Run workflow), or restart the local back end.

**The migration stops: "These markets share a public address"**, listing `/<slug>: '<name>' (id <id>), ...`.
A public address belongs to one market, and which market keeps it is the organizer's call, so the migration writes no marker until it is settled.
Rename all but one market in each group, then run the migration again: it recomputes each slug from the name.
The back end is down, so rename in the database: `mongosh '<URI>'`, `use conventioner`, `db.markets.updateOne({id: '<id>'}, {$set: {name: '<new name>'}})`.

**"Could not read the market-document migration markers"**.
The database did not answer: the check fails closed rather than assume the migration ran.
Make the database reachable (the `MONGODB_URI`, the database user's password, Atlas's status), then redeploy.

**"N account(s) have an address not stored lowercased (ids: ...)"**.
`users.email` is unique over the lowercased address, and an account written before every writer lowercased it blocks that index ([users and email](implementation/data/users-and-email.md#one-address-is-one-account)).
Run [`migrations/migrate_user_emails.py`](../back-end/migrations/migrate_user_emails.py), `--dry-run` first, as under [Starting a database, and migrations](#starting-a-database-and-migrations).
When it names accounts that would share an address, it writes nothing: decide with their owners which account stays, delete the others (`db.users.deleteOne({id: '<id>'})`, after any organization they own is transferred), and run it again.

**"Could not build the unique index 'user_email' on users.email ... Accounts sharing an address: ..."**.
Two accounts already hold one address; keep one per address as above, then redeploy.

**"The unique index market_applicant_type_unique ... could not be built ... Applications sharing an identity: ..."**.
Some applicant holds two applications of one type at one market, which the index exists to forbid ([the application document](implementation/data/application-document.md#indexes)).
The refusal names each such group by application id, and names Mongo's error by its type and code only, since Mongo's own words quote the address.
`MONGODB_URI='<URI>' .venv/bin/python migrations/create_applications_collection.py --dry-run` ([`create_applications_collection.py`](../back-end/migrations/create_applications_collection.py)) lists each such applicant with their application ids; it prints their addresses, so keep its output off anything shared.
Which document is the applicant's is the organizer's call: merge each pair by hand in `mongosh`, then redeploy.

**"The unique index attendance_vendor_day_unique on attendance ... could not be built ... Records sharing one vendor's day, by market_id, date and record id: ..."**.
Two check-ins of one vendor's day stored two records, which two at the same moment could before the index existed ([attendance and the door](implementation/modules/attendance-and-door.md#one-vendors-day-is-one-record-by-the-database)).
The refusal names each group by market id, date and record id, never the vendor's address, and Mongo's error by its type and code only.
`MONGODB_URI='<URI>' .venv/bin/python migrations/check_vendor_day_duplicates.py` ([`check_vendor_day_duplicates.py`](../back-end/migrations/check_vendor_day_duplicates.py)) lists the same groups and writes nothing; from an ops session without the checkout, `db.attendance.aggregate([{$group: {_id: {m: "$market_id", v: "$vendor_email", d: "$date"}, n: {$sum: 1}, ids: {$push: "$_id"}}}, {$match: {n: {$gt: 1}}}, {$project: {"_id.v": 0}}])` in `mongosh` does.
Take a `mongodump` first, then in each group keep the record with the earliest `checked_in_at` and delete the others by `_id` (`db.attendance.deleteOne({_id: ObjectId('<id>')})`).
The history already holds each arrival, with who made it and how; the kept record then names the first check-in's organizer or door code, not a later one's.
Then redeploy, or restart the local back end.
When it says "none found", the build failed on something other than duplicates: code 85 or 86 is an index of that name with other options or keys, to drop (`db.attendance.dropIndex('attendance_vendor_day_unique')`) before redeploying.

**"The unique index amounts_owed_vendor_day_unique on amounts_owed ... could not be built ... Records sharing one vendor's day, by market_id, date and record id: ..."**.
Two writes of what a vendor owes for one day stored two records, which an amount set at the same moment as a free could before the index existed ([payments](implementation/data/payments.md#one-vendors-day-is-one-owed-record-by-the-database)).
The refusal names each group as the attendance one does, and `check_vendor_day_duplicates.py` lists the same groups; the `mongosh` line above, run on `db.amounts_owed`, does too.
Each record may hold a freed line (`freed`) and an amount set by hand (`set_by_hand`), and the day's one record should hold the latest of each.
Take a `mongodump` first, then in each group keep one record, holding the `freed` with the latest `freed.at` and the `set_by_hand` with the latest `set_by_hand.at` among the group's (`db.amounts_owed.updateOne({_id: ObjectId('<kept id>')}, {$set: {freed: <latest freed>, set_by_hand: <latest set_by_hand>}})`), and delete the others by `_id` (`db.amounts_owed.deleteOne({_id: ObjectId('<id>')})`).
Then redeploy, or restart the local back end, and read the vendor's Payment tab for that day.
"None found" reads as for attendance, the index to drop being `db.amounts_owed.dropIndex('amounts_owed_vendor_day_unique')`.

**"The unique index payments_request_key_unique on payments ... could not be built ... Records sharing one request key, by market_id and record id: ..."**.
This is not duplicates: the request key is the press of Record payment an entry was recorded by ([payments](implementation/data/payments.md#a-payment-is-recorded-once-per-press)), and the refusal groups only the entries the index covers, those with a key, which no entry recorded before the index has, so it reads "none found".
Read the database's answer in the refusal, its type and code: code 85 or 86 is an index of that name with other options or keys, to drop (`db.payments.dropIndex('payments_request_key_unique')`) before redeploying; anything else is the database's own trouble (reachability, the user's rights, Atlas's status).
The index only stops an entry recorded twice by one press, so dropping it loses nothing, and the next boot builds it again.

**"The indexes on applicant_login_challenges, sign_in_attempts and vendor_remembered_sign_ins could not be built"**.
The log names Mongo's error by its type and code only, never its words, since a duplicate key error quotes a vendor's address: code 11000 is duplicate challenges, and 85 or 86 an index of the same name with other options or keys.
These are applicants' sign-in codes, used once and expiring within ten minutes, and the sign-in rate-limit counters, which last fifteen, so nothing lasting is lost by clearing them: drop a conflicting index of the same name (`db.applicant_login_challenges.dropIndex('<name>')`, `db.sign_in_attempts.dropIndex('<name>')`), or remove duplicate challenges (`db.applicant_login_challenges.deleteMany({})`), then redeploy.
The third holds vendors' remembered sign-ins ("Remember me" on the vendor page); its one index is the TTL index `remembered_sign_in_ttl`, so drop a conflicting index of that name (`db.vendor_remembered_sign_ins.dropIndex('<name>')`) and keep the documents, whose loss only makes each remembered vendor enter a code once more.

**"Refusing to start: ... are not as a deployment needs them"**, naming variables.
A configuration refusal, not a database one: set each variable it names ([RELEASING.md](RELEASING.md#pre-deploy-required-production-environment)), remove each local-development switch it names ([a deployed host refuses local switches](RELEASING.md#a-deployed-host-refuses-local-switches)), and redeploy.

### Scripts never to run against production

- `reset_database.py` empties every collection. It refuses whenever `MONGODB_URI` is set, so it cannot reach production by accident.
- `migrations/cleanup_unverified_users.py` deletes every unverified account (use `--dry-run` first, or `--email` for one).
- `create_test_user.py` makes a fixture account and prints its password (its `--bulk` form makes many and prints none).

`reset_database.py`, `create_test_user.py` and `seed_test_markets.py` refuse, too, a database the environment does not name (neither `MONGODB_HOST` nor `MONGODB_URI` set), which would be `127.0.0.1:27017`, and that same target named outright: a loopback or unspecified host (`127.0.0.1`, `localhost`, `::1`, `0.0.0.0`, `::`) on port 27017, or with no port, is on a developer's machine the primary checkout's stack's MongoDB, and a `MONGODB_HOST` left over from running the back end on the host names it as easily as a meant one.
Every stack's back-end container sets `MONGODB_HOST=mongodb`, so `scripts/th-compose.sh exec backend python /app/<script>` (or `docker compose exec` for the primary stack) passes; a slot's MongoDB on the host is port `27017 + slot * 10`; and `ALLOW_PRIMARY_STACK=true` opts in to the primary stack's MongoDB from the host.

## Deploying, releasing, and branch rules

In short (the detail is [RELEASING.md](RELEASING.md)):

- Changes reach `dev` by PR; `dev` requires ten checks, `CodeQL` among them, and `main` six ([CI and the gate](implementation/testing/ci-and-the-gate.md#ci)).
- Promote a commit whose `dev` CI is green: `git fetch origin && git push origin <sha>:main`.
  The Test workflow runs on `main`; once it is green, start the Deploy workflow by hand (Actions, Deploy, Run workflow, from `main`, or `gh workflow run deploy.yml --ref main`), which refuses a commit whose Test run has not passed, builds both projects without giving them a domain and proves each serves this commit, then promotes the back end, waits until `api.conventioner.io` serves the commit, promotes the front end and waits for `conventioner.io` ([how a deploy proves itself](RELEASING.md#how-a-deploy-proves-itself)).
  Nothing deploys by itself: no push, merge or PR reaches Vercel.
  Watch it under Actions; a failed run's summary says what production serves now and what to do.
- After release-please's Release PR is merged, merge `main` back into `dev` (a PR from `main` to `dev`), or the next promotion is not a fast-forward.
- A hotfix goes through `dev` when nothing unreleased is waiting there, and otherwise through a `hotfix/` branch from `main` ([RELEASING.md](RELEASING.md#hotfixes)).

## Watching it run

| What                          | Where                                                                                                                                                                                                                        |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Is it up                      | `curl https://api.conventioner.io/healthz`                                                                                                                                                                                   |
| Back-end errors and logs      | Vercel, the back-end project, Logs; or `vercel logs --deployment <id>` (Vercel CLI, logged in to the team)                                                                                                                   |
| Which build a domain serves   | `curl https://api.conventioner.io/healthz` and `curl https://conventioner.io/version.json` (the commit each was built from); `vercel inspect https://api.conventioner.io` (and `https://conventioner.io`) for the deployment |
| Deploys and their checks      | GitHub, Actions, Deploy                                                                                                                                                                                                      |
| Email delivery                | Resend dashboard, Emails (each send, bounce and complaint)                                                                                                                                                                   |
| Database load and connections | Atlas, the cluster's Metrics                                                                                                                                                                                                 |

Vercel's Hobby plan keeps runtime logs for about an hour, so read them while the problem is happening.

Deploy run 42487768583 (2026-11-08) went red at a front-end check that read the old build 0.44 seconds after the alias, before the workflow waited for each domain to serve the new commit ([how a deploy proves itself](RELEASING.md#how-a-deploy-proves-itself)).
It deployed all the same: on 2026-11-10 both projects' Production deployments were read, and each domain served that run's build of `18ad1d84` (v1.1.0's code), the newest, with no rollback.

### The production check

The team heartbeat ([agent-team](agents/issue-tracker.md#where-things-live)'s `team-uptime`, with the checks in [the team home](agents/issue-tracker.md#where-things-live)'s `projects.toml`) reads production every 5 minutes, so nobody has to:

| Check          | Fetches                               | Good when                                                           |
| -------------- | ------------------------------------- | ------------------------------------------------------------------- |
| `api-health`   | `https://api.conventioner.io/healthz` | it answers 2xx within 10 seconds, its body holding `"status":"ok"`  |
| `markets-page` | `https://conventioner.io/markets`     | it answers 2xx within 10 seconds, its body holding `<div id="app">` |

- A check that fails two runs in a row posts "Production down" in the team's Discord, channel #coordinator, then "Production still down" every 4 hours while it stays down, and "Production back" once it answers again.
- A redirect counts as a failure, so each check names the final address.
- It runs on whichever of Daniel's machines holds the team's lease, so nothing checks while none is on.
  When that machine cannot reach the internet, it counts no result and the heartbeat raises its own alert after an hour.
- `markets-page` proves Vercel serves the app's shell for a deep link, not that the app's scripts load or work.
- Every `api-health` read is a back-end invocation, about 8,640 a month.
  On Hobby, with its 4 hours of Active CPU a month, read the back-end project's Usage before shortening the interval or adding a check on the API.

### What notifies Daniel

Turned on 2026-11-10:

| Service                            | What                                                                                                     | How                                                   |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Vercel                             | Deployment failures, and Domains: configuration and renewals                                             | push and email; Hobby has no usage-limit notification |
| GitHub                             | failed workflow runs only                                                                                | email, and GitHub Mobile push                         |
| Atlas, project `conventioner-prod` | Data Size above 4 GB (the Flex cluster's cap is 5 GB), and connections above 80% of the configured limit | email                                                 |
| Atlas, the organization            | "Credit card is about to expire"                                                                         | email                                                 |

## Incidents

| Symptom                                                                                          | Likely cause                                                                                                                                                                                                                  | What to do                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Every API call answers 500 `FUNCTION_INVOCATION_FAILED`                                          | The back end refused to boot                                                                                                                                                                                                  | Read the back end's log: it names every missing or refused variable, or an unreachable database, or a missing migration marker. Fix the variable or the database, then redeploy (Deploy, Run workflow).                                                                                                                                                                                                                                                                                                |
| #coordinator says "Production down" for `api-health`                                             | The back end refused to boot, or its database does not answer                                                                                                                                                                 | `curl -i https://api.conventioner.io/healthz`: a 500 `FUNCTION_INVOCATION_FAILED` is a refused boot (the first row); a 503 whose `status` is `unavailable` is the database, so read Atlas's status and the cluster's Metrics and connections; anything else the post names (no answer, a redirect, a TLS or DNS error) is the domain or Vercel, so read the back-end project's Domains and Deployments in Vercel, and Vercel's status page. Read the back end's Logs within the hour Hobby keeps them. |
| #coordinator says "Production down" for `markets-page`                                           | The front end's domain or its current build                                                                                                                                                                                   | `curl -i https://conventioner.io/markets`; then the front-end project's Deployments and Domains in Vercel.                                                                                                                                                                                                                                                                                                                                                                                             |
| Deploy fails at "Test passed on main at this commit"                                             | Test is still running on that commit, failed, or never ran on `main`                                                                                                                                                          | Nothing was built. Wait for Test, or fix it on `dev` and promote again, then run Deploy again ([when a deploy refuses or times out](RELEASING.md#when-a-deploy-refuses-or-times-out)).                                                                                                                                                                                                                                                                                                                 |
| Deploy fails at "api.conventioner.io serves this commit" or "conventioner.io serves this commit" | The domain still serves the build before, or does not answer, after the promotion; or it serves the commit and a check failed ("sends no ...", "serves no app at /markets")                                                   | Still the build before: the error names the commit it still serves; `vercel inspect <domain>` shows the deployment it points at; `vercel promote` the staged one, and look again with `curl`. A check failed: the build is live without it, so roll back each promoted project ([when a deploy refuses or times out](RELEASING.md#when-a-deploy-refuses-or-times-out)).                                                                                                                                |
| A deploy broke something                                                                         |                                                                                                                                                                                                                               | Roll back each affected project in Vercel (Deployments, Instant Rollback), then revert on `dev` and promote the revert; the next Deploy run promotes its build by itself. See [RELEASING.md](RELEASING.md#rolling-back).                                                                                                                                                                                                                                                                               |
| Organizers cannot sign up (400)                                                                  | The captcha site key and secret are from different properties, or `conventioner.io` is not on the property's domain list                                                                                                      | Check both keys in the reCAPTCHA console; a changed site key needs a front-end rebuild. Meanwhile, make the account by hand.                                                                                                                                                                                                                                                                                                                                                                           |
| No verification, reset or sign-in email arrives                                                  | Resend refused or the domain lost verification                                                                                                                                                                                | Resend dashboard, Emails and Domains. Meanwhile, `create_account.py verify` the account.                                                                                                                                                                                                                                                                                                                                                                                                               |
| The browser reports a CORS error                                                                 | The page's origin is not in `CORS_ALLOWED_ORIGINS`                                                                                                                                                                            | It must be exactly `https://conventioner.io`, no trailing slash; a new front-end domain must be added.                                                                                                                                                                                                                                                                                                                                                                                                 |
| A write answers 403 `Request origin not allowed`                                                 | The page's origin is not in `CORS_ALLOWED_ORIGINS`, which also decides which origins a browser's write is taken from ([where a write comes from](implementation/conventions/security-invariants.md#where-a-write-comes-from)) | The same fix as the CORS error: list the page's origin exactly. This refusal names only a write; CORS still blocks that page's reads, so one listed origin fixes both.                                                                                                                                                                                                                                                                                                                                 |
| The Deploy workflow fails at "Refuse to run half-configured" or "Stage the back end"             | A GitHub variable is missing, or `VERCEL_TOKEN` expired                                                                                                                                                                       | Set it again (see [Configuration](#configuration-and-secrets)) and re-run.                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Vendors cannot check in                                                                          | The market is not published (`market_days`), they signed in with another address, or the poster is of an old door code                                                                                                        | A vendor checks in on their vendor page, signed in with the address they applied with (a Google Form market: the one its form response gave), with the live door code; an editor can check them in from Attendance.                                                                                                                                                                                                                                                                                    |
