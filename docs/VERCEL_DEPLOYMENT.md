---
layer: implementation
kind: runbook
describes:
  - back-end/vercel.json
  - front-end/vercel.json
verified: 2026-10-25
---

# Building Production on Vercel

How production is put together, in the order it has to be done, for rebuilding it from nothing or moving it.
Day-to-day running (accounts, the database, logs, incidents) is [OPERATIONS.md](OPERATIONS.md); shipping a change is [RELEASING.md](RELEASING.md).

Production today: the front end at `https://conventioner.io` and the back end at `https://api.conventioner.io`, two Vercel projects in the team `chanjdaniels-projects`, on a MongoDB Atlas Flex cluster. [OPERATIONS.md](OPERATIONS.md#what-runs-where) has every name and id.

## 1. The database (MongoDB Atlas)

MongoDB Atlas is not in Vercel's Marketplace; it is set up in Atlas directly.

1. Create a project and a cluster. Production is a **Flex** cluster (daily snapshots, the last 8 kept) on AWS us-east-1, beside Vercel's default function region (`iad1`); a free M0 has no backups.
2. **Database Access**: a database user with a generated password. The app needs only `readWrite` on the database `conventioner`.
3. **Network Access**: `0.0.0.0/0`. Vercel's functions have no fixed addresses, so the user's password is the protection.
4. **Connect, Drivers, Python**: copy the `mongodb+srv://` string and put the password in it. The database name in it does not matter; the app always uses `conventioner`.
5. Start the database once, from `back-end/`, with the URI on the command line (never in `back-end/.env`):
   ```bash
   MONGODB_URI='<URI>' .venv/bin/python init_database.py
   ```
   It creates the collections and indexes and records the markers the back end refuses to boot without; it ends with "Successfully initialized".

## 2. Email and captcha

- **Resend**: add and verify the sending domain (`conventioner.io`, DNS records at the registrar), create an API key, and choose the sender (`registration@conventioner.io`). Resend's shared `onboarding@resend.dev` sender only delivers to the Resend account's own address, so it cannot verify anyone else.
- **reCAPTCHA v3**: one property, with the front end's domain on its list. Its **site key** goes to the front end and its **secret** to the back end; keys from two properties fail exactly as missing ones do.
- **TypeSafe** (optional): an API key from its console.

## 3. The two Vercel projects

Both import this repository from GitHub, each with its own root directory:

| | Front end | Back end |
| --- | --- | --- |
| Root directory | `front-end` | `back-end` |
| Framework preset | Vite (build `npm run build`, output `dist`) | Python (install `pip install -r requirements.txt`) |
| Runtime | Node 24.x (build only), from `front-end/package.json`'s `engines` | Python 3.12, from `back-end/.python-version` |
| Config in the repo | [`front-end/vercel.json`](../front-end/vercel.json): every path that is not a file serves `index.html`, so deep links work | [`back-end/vercel.json`](../back-end/vercel.json) |
| Custom domain | `conventioner.io` | `api.conventioner.io` |

Both `vercel.json` files set `git.deploymentEnabled: false`: Vercel's Git integration builds no branch, so no push, merge or PR creates a deployment, preview or production, and production moves only when the Deploy workflow is started by hand (see [RELEASING.md](RELEASING.md#how-a-release-happens)).
Each project's Ignored Build Step used to cancel the builds of other branches instead, but a cancelled build still counts against the Hobby plan's daily deployment quota; with Git builds off, that setting is never reached and can be left empty.
If Vercel still creates deployments from Git, disconnect the project's Git repository (Settings, Git) rather than turning the setting back on.

`back-end/requirements.txt` must install on Vercel's build image, Amazon Linux 2023 (glibc 2.34): a package that ships only newer wheels fails the whole build.
That is why the floorplan solver `pyckingsolver` lives in `requirements-floorplan-solver.txt`, installed by Docker, CI and local setups but not by Vercel; production's Auto-Place uses its grid fallback.
`requirements.txt` is a lock with hashes, compiled from `requirements.in` by `scripts/lock-backend-requirements.sh`, so every build installs the same packages ([Python dependencies are locked](TECH_STACK.md#python-dependencies-are-locked)).

## 4. Environment variables

Set on each project's **Production** environment (Settings, Environment Variables); [OPERATIONS.md](OPERATIONS.md#configuration-and-secrets) lists every one with its value or source.
The back end needs `MONGODB_URI`, `SECRET_KEY`, `SESSION_TYPE=null`, `CORS_ALLOWED_ORIGINS`, `TRUSTED_PROXY_HOPS=1`, `FRONTEND_URL`, `FROM_EMAIL`, `RESEND_API_KEY` and `RECAPTCHA_SECRET_KEY` (and optionally `TYPESAFE_API_KEY`); the front end needs `VITE_FLASK_HOST` and `VITE_RECAPTCHA_SITE_KEY` at build time.
Nothing reads `FLASK_ENV`, `USE_HTTPS`, `MONGODB_DB` or the separate `MONGODB_HOST`/`MONGODB_USER`/`MONGODB_PASSWORD` variables in production; do not set them.

All six of `SECRET_KEY`, `SESSION_TYPE`, `RECAPTCHA_SECRET_KEY`, `CORS_ALLOWED_ORIGINS`, `RESEND_API_KEY` and `TRUSTED_PROXY_HOPS` are **boot-time requirements**: the function refuses to start without them, so a deployment that is missing one serves nothing at all.
See [RELEASING.md](./RELEASING.md#pre-deploy-required-production-environment) for what each one defends and what an unset value would do.

`TRUSTED_PROXY_HOPS=1` is the right answer on Vercel: a request reaches the function through Vercel's own ingress, so the peer address Flask sees is the ingress, not the caller.
That address is what organizer signup reports to Google as reCAPTCHA's `remoteip`, and reCAPTCHA v3 scores on it - so a function that has not been told about the hop in front of it reports the same client for every signup in the world.
Do not raise it above the number of proxies you actually own: `X-Forwarded-For` is written by the caller, and a hop you do not own is a hop the caller fills in.

The three secrets above are written as `<...>` on purpose, and pasting one of those brackets in verbatim is refused: **every value this repository has printed where a secret goes is rejected by name**, along with anything shaped like a placeholder (a run of x's, a `your-` prefix).
This guide used to print `RESEND_API_KEY=your-resend-api-key` and `RECAPTCHA_SECRET_KEY=6Lcxxxxx...` as if they were fill-in values, and a placeholder is *truthy* - so a deployment that copied one passed the boot check with a secret that cannot do its job, and the failure landed later, as a 500 that named nothing.

`SECRET_KEY` must be **generated**, not typed: it refuses the old `TEMP_KEY_CHANGE_IN_PRODUCTION` fallback and every placeholder this repo has published, because each is readable by anyone who can read it.
It also refuses anything under 32 characters.
Setting it for the first time, or rotating it, ends every session signed with the old key - organizers log in again, once.

`SESSION_TYPE=null` is not optional on Vercel, and it is now a boot requirement rather than a default: a serverless function has no filesystem that outlives a request, so the on-disk session store raises at import there.
`null` installs no server-side store at all - Flask signs the session into the cookie, which is the only place a serverless function can keep one.
Nothing keys on `FLASK_ENV` any more - it defaulted to `development` in our own image, so every check that read it was exempting the deployments it existed for, and the old `SESSION_TYPE` default was derived from exactly that. Set the variables above by name instead.

### The front end's site key

This is set on the **front end's** Vercel project, not this one, and it is the other half of the back end's `RECAPTCHA_SECRET_KEY`: the two must come from the same reCAPTCHA property.
Vite bakes it into the bundle at build time, so setting it later does nothing until the front end is rebuilt.

A front end deployed without it ships a bundle that has no captcha to solve and sends a placeholder token.
The back end no longer waves that through - it has a real secret now, and Google never issued that token - so `POST /register` answers 400 and **no organizer can sign up**, on a deployment that otherwise looks healthy.
`vite build` refuses to produce such a bundle for exactly that reason; the refusal names the variable.

## 5. Deploying

1. In GitHub, create the environment `production` and in it the secret `VERCEL_TOKEN` (a Vercel token scoped to the team); add the repository variables `VERCEL_ORG_ID`, `VERCEL_BACKEND_PROJECT_ID` and `VERCEL_FRONTEND_PROJECT_ID`.
2. Run the **Deploy** workflow from `main` (Actions, Deploy, Run workflow, or `gh workflow run deploy.yml --ref main`); it is the only way production moves (see [RELEASING.md](RELEASING.md#how-a-release-happens)).
   It deploys the back end, waits for `/healthz`, then deploys the front end and checks a deep link.
3. If a domain still serves an older build afterwards, the project is in Vercel's rolled-back state: promote the new deployment once (`vercel promote <deployment>`), and later deploys reach the domain again.

## Troubleshooting a back end that will not boot

- **Import Errors**: Ensure every dependency is in `requirements.in`, then re-run `scripts/lock-backend-requirements.sh`
- **MongoDB Connection Issues**: Check your MongoDB Atlas network access settings
- **Session Issues**: Verify `SESSION_TYPE=null` is set for Vercel. There is no default - the function refuses to boot without it - and `filesystem` is a store a serverless function does not keep between requests.
- **CORS Issues**: Ensure `CORS_ALLOWED_ORIGINS` lists your frontend's origin exactly as the browser sends it (`https://conventioner.io` - scheme and host, no trailing slash, no path). A preview deployment served from a different domain is a different origin and has to be listed too. `FRONTEND_URL` is only used for the links in outgoing mail and has no say in CORS.
- **"Refusing to start: N of the things this app's public surface rests on are not configured"**: one or more of `SECRET_KEY`, `SESSION_TYPE`, `RECAPTCHA_SECRET_KEY`, `CORS_ALLOWED_ORIGINS`, `RESEND_API_KEY`, `TRUSTED_PROXY_HOPS` is unset. The log names every one of them, and each names what it defends, delivers or stores. Set them and redeploy; do not work around it by setting `ALLOW_INSECURE_LOCAL_DEV`, which turns all of that off. See [RELEASING.md](./RELEASING.md#pre-deploy-required-production-environment).
- **"`SECRET_KEY` is set to a value this repository has published"**: the key you set is one of the placeholders or fallbacks that appear in this repo (or its history), so it is readable by anyone who can read the repo. Generate a real one with `python -c 'import secrets; print(secrets.token_urlsafe(48))'`. This ends every session signed with the old key, so organizers log in again once - that is the cost of the key not being public.
- **"`RECAPTCHA_SECRET_KEY` / `RESEND_API_KEY` is set to a placeholder this repository has printed"**: the value you set is one of the example strings from an env template or an older version of this guide (`6Lcxxxxx...`, `re_xxxxx...`, `your-...`), not a secret an issuer ever gave you. Google and Resend both reject it, so the captcha would fail every signup and no verification mail would ever be delivered - a check that passed on a value nothing works with is the failure this refusal exists to move to boot time. Set the real key from the linked console, or, if this is a local machine, clear the variable and set `ALLOW_INSECURE_LOCAL_DEV=true` with `DISABLE_CAPTCHA=true` / `DISABLE_EMAIL=true`.
- **"The market-document migration has not been applied to this database"**: the function is refusing to boot because it cannot confirm the migration (see step 5 above). Run `migrations/migrate_market_keys.py` against the Atlas database and redeploy. The same error appears when the marker simply cannot be read - an unknown migration state is treated as unmigrated - so check network access too.
