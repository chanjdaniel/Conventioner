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
  - back-end/utils/request_origin.py
  - back-end/utils/security_headers.py
  - back-end/utils/proxy.py
  - back-end/utils/captcha.py
  - back-end/utils/email.py
  - back-end/tests/test_public_endpoint_defenses.py
  - back-end/tests/test_the_remember_cookie.py
  - back-end/tests/test_the_request_origin_check.py
  - back-end/tests/test_security_headers.py
  - front-end/vite.config.ts#assertCaptchaSiteKey
  - front-end/vite.config.ts#deployedHeaders
  - front-end/vercel.json
  - front-end/src/__tests__/securityHeaders.test.ts
  - front-end/src/utils/captcha.ts
  - docker-compose.yml
  - scripts/real_data_check.py
  - scripts/real_data_terms.txt
  - .githooks/
verified: 2026-10-30
sources:
  - T74
  - T109
  - T84
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
| `CORS_ALLOWED_ORIGINS` | [`utils/cors.py`](../../../back-end/utils/cors.py) | which websites may spend the organizer's `SameSite=None` cookie, and which origins a browser's write is taken from ([where a write comes from](#where-a-write-comes-from)); `*` is refused, and so is an entry that is not an origin |
| `RESEND_API_KEY` | [`utils/email.py`](../../../back-end/utils/email.py) | the mail that carries every verification link, reset link and sign-in code |
| `SESSION_TYPE` | [`utils/session_storage.py`](../../../back-end/utils/session_storage.py) | where the session is kept: `null` (the signed cookie, a serverless host) or `filesystem` (a container or VM), with no default |
| `TRUSTED_PROXY_HOPS` | [`utils/proxy.py`](../../../back-end/utils/proxy.py) | the address reCAPTCHA scores a signup on, and the caller the applicant sign-in limits count |

Three fail silently when unset (the captcha passes everybody, a forgeable session, a credentialed policy for every origin); the mail key and the session store fail loudly but name nothing; the hop count fails more quietly than any, showing only in a reCAPTCHA score.
What each one is, and what an unset one would do, is the deployment's checklist in [RELEASING.md](../../RELEASING.md#pre-deploy-required-production-environment); **keep that table in step with the check**, because a deploy doc that is wrong is worse than one that is missing: it will be trusted.

**The check is a check.**
`check_public_endpoint_defenses()` reads configuration and returns what it found; [`configure_public_endpoint_defenses()`](../../../back-end/app.py) is the only thing that touches the app, installing the key, the CORS policy, the request-origin check, the proxy fix and the session store, in that order.
Keep them apart: flask-cors installs an `after_request` handler per call, so a check with side effects stacked one onto the live app every time anything asked it a question.

**A boot requirement defends something the product serves.**
A requirement with nothing behind it teaches operators to work around the check.
`TRUSTED_PROXY_HOPS` is required because `request.remote_addr` is what organizer signup hands Google as reCAPTCHA's `remoteip` (`api/users.py`), and it became load-bearing the moment `RECAPTCHA_SECRET_KEY` did: before, a deployment with no secret took the bypass and no token reached Google.
The applicant sign-in limits count each caller by the same address ([a vendor signs in before applying](../../business/rules/a-vendor-signs-in-before-applying.md#sign-in-is-bounded)), so a wrong hop count would put every applicant behind one caller's limit.
Make a requirement follow its caller, not the module it was first written for.
The converse holds too: a value that turns on a feature and defends nothing is optional, read through `configured_secret` when asked for, and never a boot requirement: `TYPESAFE_API_KEY`, and the three Discord values, without which the Discord card says Discord is not set up ([the Discord connection](../modules/discord.md)).

## The one escape hatch

**`ALLOW_INSECURE_LOCAL_DEV` is the only escape hatch for the six** ([`back-end/utils/deployment.py`](../../../back-end/utils/deployment.py)), and it defaults to off.
Under it a missing value boots: a random signing key for the process's lifetime, loopback origins, sessions on disk, zero hops, no captcha secret and no mail key; each is logged as a defense turned off.
`DISABLE_CAPTCHA` and `DISABLE_EMAIL` are honoured only under the hatch, so a deployment that inherited either from a copied env file is not silently unprotected.
The hatch never excuses a published secret ([ADR 0010](../../adr/0010-no-secret-has-a-fallback.md)).
`docker-compose.yml` and `back-end/.env.example` set it; it must never be set on a deployed environment.

**A stack under the hatch listens on `127.0.0.1` only.**
Such a stack has fixed database credentials, mongo-express's `admin` / `admin`, no captcha and a random signing key, so it must not be on the local network: [`docker-compose.yml`](../../../docker-compose.yml) publishes every port on loopback, and so does the worktree overlay for every agent and `nm-test.sh` stack ([the treehouse runbook](../../../scripts/README-treehouse.md)).
Reaching the primary stack from another device takes an override file of one's own ([STARTUP.md](../../STARTUP.md#quick-start-with-docker-recommended)); never widen the committed files.

**`FLASK_ENV` does not exist in this repository**: nothing reads it, and nothing sets it.
It is gone from the Dockerfile, `docker-compose.yml` and the env templates, so the invariant is structural: a variable nobody sets is one nobody can key on.
Do not reintroduce it.
The image used to export `development`, so anything keyed on it read the same on a deployment as on a laptop: that is how the CORS hole survived, and how `SESSION_TYPE` came to default to `filesystem` on serverless hosts that have no disk.

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

## Real data never leaves the PC

**A real export never becomes test data in any form**: the Google Form corpus is generated by [`synthetic_form_exports.py`](../../../back-end/tests/fixtures/synthetic_form_exports.py), whose people, addresses and links are invented and pass the check, and it changes only through the generator ([the corpus README](../../../back-end/tests/test_data/README.md)).
Conventioner's repository is public, so a branch is published the moment it is pushed: a check on GitHub can stop a merge, never the exposure, and taking applicants' details back out once took a rewrite of the whole history.
So the check runs on the PC, before anything leaves it, and CI is only the backstop.

| Where | What it reads |
| --- | --- |
| [`.githooks/pre-commit`](../../../.githooks/pre-commit) | the staged lines, so an ignored export added with `git add -f`, or its rows pasted next to a tracked file, is refused |
| [`.githooks/pre-push`](../../../.githooks/pre-push) | each commit the push sends that no remote-tracking branch already has, its lines and its message: the second net, for a commit made with the hooks skipped |
| the gate's [`nm-test.sh`](../../../scripts/nm-test.sh) | each commit since `origin/dev`, then every file of the tree at `HEAD`, before any suite, since the gate pushes the branch |
| CI's `real-data` job | the pull request's commits, then every file of the merge it checks out, plus gitleaks for secrets; a branch-protection setting can make it block a merge, and it is not the protection |

**The gate's own commits are CI's to check.**
Its document, lint and CI-fix steps commit after its test step has run `nm-test.sh`, and the gate pushes them from its own repository under `~/.no-mistakes/`, where `core.hooksPath` is not set, so neither the hooks nor `nm-test.sh` read them: CI's `real-data` job on the pull request is the only check they get.

All four run one checker, [`scripts/real_data_check.py`](../../../scripts/real_data_check.py).
It fails an added line holding an email address outside the fixture domains (`example.com`, `example.org`, `example.net` and their subdomains, `*.test`, `*.example`, `*.invalid`, `*.localhost`, and the services' own in its `FIXTURE_DOMAINS`: the project's, Resend's test sender, the placeholder MongoDB host and commit trailers'), or a North American phone number written with separators outside the fictional 555-0100 to 555-0199.
It also fails a MongoDB Atlas host whose cluster id is not a placeholder, since that id names the production database: only an `example` id (`cluster0.example.mongodb.net`) or the template's `cluster.mongodb.net` passes, and a document writes the host as `<cluster>.<id>.mongodb.net`, the real one kept in the deployment's environment and 1Password.
No registrable domain is a fixture domain, however unlikely an inbox there seems: `email.com` is free webmail and `ember.ca` is somebody's, so the tests that once used them use `example.com` and `.test` names.
Where `.scratch/examples/` holds real exports (the checkout's own, or the primary checkout's when run from a worktree), it also fails an exact email, phone number or applicant's name from them, however the line punctuates or cases it.
A name counts when it stands in a person's-name column of a row that gives an email, has two to five words, and fewer than three applicants gave it: a name three applicants share identifies nobody.
The exports are read into memory at each run: nothing derived from them is written or printed, and a finding names the file and line with at most a masked hint (`j***@g***.com`, `***-***-**19`), never the value.
The gate and CI have no exports, so there it judges shapes only; the exact values are the hooks' work, on the machine that has them.

**No line copies a real form's questions.**
Where `.scratch/examples/` holds real exports, the checker also holds each export's header row in memory: every run of eight consecutive words of a header cell, and every link and social handle a header cell holds.
It fails a line or a commit message holding eight of a question's words in their order, however it cases, spaces or punctuates them (words are taken as the real names are, below), or one of those links or handles: the finding reads `words copied from a real export's questions in .scratch/examples/`, never the words.
A link counts by its host and path, whatever its scheme, `www.`, query or trailing slash; a handle counts written with its `@` or as a link's path (`instagram.com/handle`), not as a bare word.
A link's words are no part of a question's, and seven words of a question pass, as does a long answer in a row: the exact-value rules judge the rows.
The files where the real market may be named, below, may quote its forms too, since the records of real runs report on them.
Like the exact values, this is the hooks' work, and any run's from a checkout on the machine that has the exports: the gate's checkout and CI have none.

**No line names the real market's organization, venue or groups.**
The checker fails a line or a commit message holding a name listed in [`scripts/real_data_terms.txt`](../../../scripts/real_data_terms.txt): the real organization's abbreviation, its market's name, its student society and clubs, its venue's rooms and sections, its social handle, and the distinctive parts of the document links its forms named.
The list is committed, so the gate and CI apply it as the hooks do.
It holds each name's SHA-256, taken of the name's words, as Unicode NFKC lower-cased runs of letters joined by single spaces, and every run of one to six such words of a line is hashed and looked up: a name matches however a line cases, spaces or punctuates it (a handle's dots, a slug's hyphens, a possessive), and never inside a longer word.
Hashing keeps the list from reading as a directory of the real names; it hides nothing from anyone who guesses a short one.
A finding names the file and line, never the name.
The real market may be named only in the root `README.md` (which says whom the product first serves), `CHANGELOG.md`, [`docs/records/`](../../records/README.md) (the records of real usage runs) and the list itself, which may also quote the real forms' questions; a commit message never may.
A generic word of a listed name is not listed alone, so a project id or a time zone that shares one passes.
`python3 scripts/real_data_check.py add-term` lists the names it reads from standard input, one per line, and prints only how many names the list holds; it lists none when a line is empty, already listed or longer than six words.
Run it and type the name at it, never on a command line or in a file, so listing a name never publishes it.
On a commit, a push or a range, only added lines count, and a merge answers only for the lines new to every parent.
`python3 scripts/real_data_check.py tree [REV]` judges every line of every file a revision's tree holds (`HEAD` by default) with every rule, the exemptions above applied, so a name listed after a file was committed is found wherever it still stands; the gate and CI run it after the commits, and a file staged but not committed is the hooks' to judge.
A spreadsheet is read for its text whatever git makes of it, since that is what an export is: an `.xlsx`, `.xlsm` or `.ods` for its cells and shared strings, a `.csv` or `.tsv` in UTF-8, UTF-16 or Windows-1252 with its delimiter found from its first record (a comma, or the semicolon a European-locale Excel saves), and each of these inside a `.zip`, which is what Google Forms' "Download responses" saves.
The exports are read the same way, a zipped one included.
A spreadsheet or archive it cannot read (`.xls`, `.xlsb`, `.numbers`, `.et`, `.sxc`, a `.gz`, `.7z`, `.rar`, `.tar` and the like, or a broken workbook or zip) is refused outright, except under `back-end/tests/test_data/` and `back-end/tests/fixtures/`.
It reads no other binary file, and not `package-lock.json`.
When `.scratch/examples/` holds a file it read nothing from, it says so on stderr, by count and kind only (`read nothing from 2 files in .scratch/examples/ (.gz, .pdf)`), since a file's name may be an applicant's: no value of such a file is checked until it is saved in a format the check reads.

**The hooks are installed by `core.hooksPath`**, which [`scripts/treehouse-setup.sh`](../../../scripts/treehouse-setup.sh) sets for every treehouse worktree as its first step, before any that can fail (`th-lease.sh` hands out a slot whose pre-warm failed), and a clone sets once with `git config core.hooksPath .githooks` ([STARTUP.md](../../STARTUP.md#the-git-hooks)).
The setting is the repository's, shared by all its worktrees: a worktree on a branch older than the hooks has no [`.githooks/`](../../../.githooks/) and runs no hook at all.
Each committed hook also runs the hook of its name in the git directory's `hooks/`, so a hook installed there is not skipped.
**Never skip the hooks to get past a finding** (`--no-verify`): replace the value with a fixture one, from the vocabulary in [test data](../testing/test-data.md).
A test that needs a real-looking value composes it (`"user@" + "gmail.com"`) instead of writing it out, or the hooks refuse the test file itself.

## The cookies

**Both cookies a sign-in sets, the session and the remember-me cookie, are `Secure`, `SameSite=None` and `HttpOnly`, and none of it is configurable.**
The app and the API are on different hosts, so the browser must attach the cookies to the app's requests to the API, which takes `SameSite=None`; a browser accepts a `SameSite=None` cookie only when it is Secure, so a switch could only ship a cookie the browser drops, or sends in the clear where it does not.
Loopback counts as a secure context, so local development is unaffected.
The settings sit together in [`app.py`](../../../back-end/app.py) under one comment; `HttpOnly` is Flask-Login's default for the remember-me cookie and is asserted rather than set.
Both name the account by its login id, which a password reset replaces, so a reset ends every session and remember-me cookie issued before it: [users and email](../data/users-and-email.md#the-session-names-the-account-by-its-login-id).

## Where a write comes from

**A state-changing request whose browser says it came from an origin outside the CORS list is refused**, 403 with `{"error": "Request origin not allowed"}`, before its route runs (so before `@login_required`).
CORS decides which origins may read a response; it does not stop a request from being sent, and a plain form post goes without a preflight while carrying the `SameSite=None` session cookie, so a write that needs no JSON body would otherwise rest on CORS alone.
The decision is OWASP's Fetch Metadata check with its `Origin` fallback, in [`utils/request_origin.py`](../../../back-end/utils/request_origin.py):

- `GET`, `HEAD` and `OPTIONS` pass whatever their headers, so a CORS preflight is untouched.
- `Sec-Fetch-Site: same-origin` or `none` passes.
- Otherwise a request with an `Origin` passes only when that origin is in the list; `Origin: null` is in no list.
- `Sec-Fetch-Site` with no `Origin` is refused: every browser that sends Fetch Metadata sends `Origin` on a write.
- Neither header passes: a script, the E2E API helper, the seed scripts and a health check send neither, and there is nothing to check.

**The check reads CORS's list, through CORS's matcher**: `origin_is_allowed()` sits beside `allowed_origins()` in [`utils/cors.py`](../../../back-end/utils/cors.py) and reads a string entry as equal to the origin, case aside, as flask-cors compares one, and a pattern entry as a match of the whole origin, at least as strict as flask-cors's match from the start; so there is one list of the app's origins, and an origin the check takes is one CORS takes too.
`configure_public_endpoint_defenses()` installs it right after CORS, as a `before_request` on the app, so a route added later is covered without doing anything.
Production's app calls its API on a sibling host, which the browser calls `same-site`, with an origin in the list; local development and the E2E stack reach the API through Vite's `/api` proxy, which the browser calls `same-origin`.
A 403 with these words on a deployment means the page's origin is not in `CORS_ALLOWED_ORIGINS` ([OPERATIONS.md](../../OPERATIONS.md#incidents)).

## Each request

**A value read from a request body reaches a query only as a string**: the rule, its one helper and its test are [a request value is a string](a-request-value-is-a-string.md).
The checks above make the process boot safe; that one makes safe each lookup a request then asks of it.

**An exception never reaches a client**: a refusal is answered in copy our code wrote, and any other failure is logged and answered a bare `{"error": "Internal server error"}`; the types, the two handlers and their tests are [an exception never reaches a client](an-exception-never-reaches-a-client.md).

**The front end has no DOM or HTML sink today** (no `v-html`, no `innerHTML`), and its lint refuses `v-html` anywhere ([every control is named](every-control-is-named.md#how-it-is-enforced)).
If one is ever introduced, lifting that rule is the decision, and the chosen tools are DOMPurify for `v-html` and Trusted Types (`require-trusted-types-for 'script'`) for the page.

## Security headers

**Every page the front end serves carries the standard security headers and a Content-Security-Policy**, declared once, for every path, in [`front-end/vercel.json`](../../../front-end/vercel.json)'s `headers`; Vercel adds no policy of its own.
They are `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY` (with the policy's `frame-ancestors 'none'`, the page is framed nowhere) and `Strict-Transport-Security: max-age=63072000; includeSubDomains`.
The policy limits what script can run in the tab, the applicant's session included.

**The policy names every source the app loads from, and lets no inline code or eval run.**
`default-src 'self'`, with `object-src 'none'`, `base-uri 'self'`, `form-action 'self'` and `frame-ancestors 'none'`; scripts from the app and reCAPTCHA, styles and fonts from the app, images from the app and `blob:` (a floorplan's image is fetched and drawn from an object URL), connections to the app, `https://api.conventioner.io` and reCAPTCHA, and frames only reCAPTCHA's, its hosts as [Google's allowlist](https://developers.google.com/recaptcha/docs/faq) names them.
There is no `'unsafe-inline'` and no `'unsafe-eval'`: the built `index.html` has no inline script, Vue sets a bound style through the CSSOM (which the policy does not govern), and a build that calls `eval` or `Function` fails CI's [eval check](../testing/ci-and-the-gate.md#no-string-evaluated-as-script).
A new origin the app loads from (an analytics script, an image host) goes into its directive in the same PR.

**It is report-only until it has run in production with no reports**, as `Content-Security-Policy-Report-Only`; promoting it is renaming that one header key to `Content-Security-Policy`.
It has no reporting endpoint, so a report shows only in a browser's console; walk a production build under it with `npm run build-only && npm run preview`, since `vite preview` serves `vercel.json`'s headers ([`deployedHeaders`](../../../front-end/vite.config.ts)), and the dev server, whose styles are injected inline, is not a build the policy describes.
[`securityHeaders.test.ts`](../../../front-end/src/__tests__/securityHeaders.test.ts) pins the headers and the policy's shape, and that `vite preview` serves them on the root and a deep link; the Deploy workflow checks that `conventioner.io` sends every one after each front-end deploy.

**Every API answer carries `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`**, added by one `after_request`, [`install_security_headers()`](../../../back-end/utils/security_headers.py), so a route added later, an error answer and a CORS preflight carry them without doing anything.
The API answers JSON, a CSV export and floorplan images, never a page, so it sends no policy of its own.
It is installed after the [error answers](an-exception-never-reaches-a-client.md), outside `configure_public_endpoint_defenses()`, because it depends on no configuration; it only adds headers, so it leaves the order of the defenses above, flask-cors's `after_request` among them, as it was.
[`test_security_headers.py`](../../../back-end/tests/test_security_headers.py) reads both on a JSON answer, a 401, a 404 and a preflight that CORS still answers; the Deploy workflow checks `api.conventioner.io/healthz` for both after each back-end deploy.

## How it is enforced

- One test module per requirement (`test_secret_key.py`, `test_cors.py`, `test_captcha.py`, `test_email.py`, `test_session_storage.py`, `test_proxy.py`), and `test_public_endpoint_defenses.py` for the refusal itself: it names every missing variable, `ALLOW_INSECURE_LOCAL_DEV` is the only waiver, and the template boots.
- [`test_the_remember_cookie.py`](../../../back-end/tests/test_the_remember_cookie.py) signs in through `/login` and reads both cookies' `Set-Cookie` settings.
- [`test_the_request_origin_check.py`](../../../back-end/tests/test_the_request_origin_check.py) tables the decision for a production-shaped list and the loopback pattern, and sends publish-results, sign-out and a floorplan upload from another site (refused, nothing done) and from the app (done).
- `test_configured_secret.py` and `test_env_file.py` pin the machinery underneath; [TESTING.md](../../TESTING.md#back-end-tests) lists them.
- `scripts/tests/test_real_data_check.py` runs the checker, the hooks in a scratch repository with its bare remote, the setup step and CI's command on fake exports only: a `gmail.com` address, a real-shaped phone and an Atlas host fail, a fixture one passes, an exact value of a fake export fails, as do eight words of its header's question in order, a link or a handle from it, in a line, a message, a cell and the tree, while seven words, an answer and the exempt files pass, a workbook or OpenDocument sheet is read and an unreadable spreadsheet refused, the synthetic corpus passes, a refusal sends a fixture to the generator, and no value is printed in full; `tree` fails a planted row in a committed CSV, workbook or zip and a name listed after its file was committed, and passes a clean tree and the exempt files; CI's tree step fails real data already on the base branch; `test_nm_test.py` fails a gate run on a finding in the branch's commits or in the tree, before anything else.
- What breaks it: a default for any of the six, a check that installs something, a secret read at import, a template that prints a value, or a hatch that excuses a published key.
