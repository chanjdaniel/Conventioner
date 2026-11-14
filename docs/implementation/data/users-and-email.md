---
layer: implementation
kind: data
describes:
  - back-end/utils/email_address.py
  - back-end/datatypes.py#User
  - back-end/api/users.py#ensure_user_indexes
  - back-end/api/users.py#AuthUser
  - back-end/api/users.py#register_user_with_captcha
  - back-end/api/users.py#login
  - back-end/api/users.py#login_with_otp
  - back-end/api/users.py#request_otp
  - back-end/api/users.py#request_password_reset
  - back-end/api/users.py#resend_verification_email
  - back-end/api/users.py#_Bounds
  - back-end/api/users.py#_password_matches
  - back-end/api/users.py#get_user_by_login_id
  - back-end/api/users.py#signed_in_account
  - back-end/api/users.py#get_users_by_ids
  - back-end/api/users.py#_sign_in
  - back-end/api/users.py#reset_password
  - back-end/api/users.py#delete_user
  - back-end/app.py#verify_user_indexes
  - back-end/utils/email.py#send_account_exists_email
  - back-end/migrations/migrate_user_emails.py
  - back-end/tests/test_the_remember_cookie.py
  - back-end/tests/test_the_organizer_sign_in_is_bounded.py
  - back-end/tests/test_one_account_per_address.py
  - back-end/tests/test_a_failed_mail_leaves_no_wait_armed.py
  - back-end/tests/test_delete_user_authorization.py
  - back-end/account_secrets.py
  - back-end/api/users.py#verify_email
  - back-end/api/users.py#legacy_remembered_account
  - back-end/api/users.py#end_this_browsers_sign_ins
  - back-end/api/users.py#logout
  - back-end/organizer_sessions.py
  - back-end/app.py#verify_organizer_session_indexes
  - back-end/app.py#a_legacy_remembered_account
  - back-end/app.py#forget_the_legacy_remember_cookie
  - back-end/create_account.py#verify_account
  - back-end/tests/test_the_sign_in_secret_machine.py
  - back-end/tests/test_the_old_sign_in_fields_are_read_for_one_release.py
  - back-end/tests/test_a_stored_account_holds_no_secret_in_clear.py
  - back-end/tests/test_one_writer_of_the_sign_in_secrets.py
  - back-end/tests/test_the_verification_link_answers.py
  - back-end/tests/real_mongo/test_the_sign_in_secret_races.py
  - back-end/tests/test_the_organizer_sessions_are_indexed.py
  - back-end/tests/real_mongo/test_organizer_sessions_on_the_server.py
verified: 2026-11-14
sources:
  - E32/F03/S04
  - T85
  - E38/F14/S01
  - T169
  - E38/F14/S02
  - T176
  - T204
  - T251
  - E47/F02/S01
  - T263
  - T273
  - T283
  - T311
  - T315
---

# Users, and the one spelling of an address

One document per organizer account in the `users` collection, and the rule every collection follows for a person's address.
[`back-end/api/users.py`](../../../back-end/api/users.py) writes and reads accounts; the model is `User` in [`back-end/datatypes.py`](../../../back-end/datatypes.py).
Vendors have no account: an applicant signs in with a code sent to their address, held per market in `applicant_login_challenges`.

The glossary concept: [Organization and roles](../../business/concepts/organization-and-roles.md).

## The fields that matter

| Field                                                  | What it is                                                                                                                                                                                                                              |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                                   | a UUID, the primary key, and what every role and membership names                                                                                                                                                                       |
| `email`                                                | the sign-in, stored lowercased and trimmed, unique                                                                                                                                                                                      |
| `password`                                             | a bcrypt hash                                                                                                                                                                                                                           |
| `organizations`                                        | the ids of the organizations the person is in ([the organization document](organization-document.md)); empty at registration, whatever the body sends, and written only by a membership change                                          |
| `email_verified`                                       | false until the emailed verification link, or a reset link, is followed, or an operator verifies the account; an unverified account cannot sign in                                                                                      |
| `verification_token`, `verification_token_expires`     | the verification link as it was kept before `secrets`, in clear: read for one release, upgraded to `secrets.verify` the first time the account is read, and written by nothing ([the old fields](#the-old-fields-read-for-one-release)) |
| `password_reset_token`, `password_reset_token_expires` | the reset link as it was kept before `secrets`, in clear: read for one release, upgraded to `secrets.reset` the first time the account is read, and written by nothing ([the old fields](#the-old-fields-read-for-one-release))         |
| `secrets`                                              | the account's sign-in secrets, one record by kind, each kept hashed: the sign-in code is `secrets.code`, the reset link `secrets.reset`, the verification link `secrets.verify` ([the sign-in secrets](#the-sign-in-secrets))           |
| `otp`, `otp_expires`, `otp_attempts`                   | the sign-in code as it was kept before `secrets`, in clear: read for one release, upgraded to `secrets.code` the first time the account is read, and written by nothing ([the old fields](#the-old-fields-read-for-one-release))        |
| `login_id`                                             | the account a sign-in is kept under: a random value, made at the first sign-in, replaced by a reset or Sign out everywhere, so every earlier sign-in loads no one ([a sign-in is kept on the server](#a-sign-in-is-kept-on-the-server)) |

## A sign-in is kept on the server

**Every sign-in, by password or by code, is one document in `organizer_sessions`**, which [`back-end/organizer_sessions.py`](../../../back-end/organizer_sessions.py) alone reads and writes ([ADR 0029](../../adr/0029-an-organizers-sign-in-is-kept-on-the-server.md)).
`start` makes a random secret (`secrets.token_urlsafe(32)`) and stores its SHA-256 as the document's `_id`, beside `user_id`, the account's `login_id`, `remembered`, `created_at` and `expires_at`, `created_at` plus `SIGN_IN_LIFETIME` (12 hours) or, with "Remember me", `REMEMBERED_SIGN_IN_LIFETIME` (30 days); the secret is never stored.
The secret is the sign-in's id (`AuthUser.get_id`): the session carries it and, with "Remember me", so does the remember cookie `__Host-organizer_remember`, signed by Flask-Login's digest ([the cookies](../conventions/security-invariants.md#the-cookies)).
Each signed-in request reads it through the app's user loader, `signed_in_account`, which recalls the document (`recall`: found by the hash, and only while `expires_at` is ahead, read without a write, so use never extends it), then loads the account by the document's login id (`get_user_by_login_id`), refusing one whose id is not the document's `user_id`; `authenticated_email()` then reads the loaded account's address, and permissions are decided by the account's id.
Each signed-in request so costs one read more than the account's, the document by `_id`.

**What ends a sign-in:**

- Sign out (`logout`) ends this browser's sign-in on the server, then clears both cookies, so a copy of the browser's cookies taken before loads no one.
- A sign-in first ends the sign-in the browser held, whoever's it was: the one its session names and the one its remember cookie names (`end_this_browsers_sign_ins`), so a browser remembered for someone else, or a sign-in without "Remember me" after one with it, leaves no earlier sign-in on the server.
- **A password reset replaces the login id**, in the same write as the new password ([the reset link used](#the-sign-in-secrets)), so every sign-in issued before the reset loads no one at once; `end_all` then removes the account's documents. An organizer who resets a password because a device was lost or shared is signed out on it, and signing in again works at once.
- **Sign out everywhere replaces the login id** (`POST /logout-everywhere`, `logout_everywhere`), in one write filtered on the account's id, so every sign-in issued before loads no one at once, a legacy one included; `end_all` then removes the account's documents and `logout_user` clears both cookies in this browser ([the app bar](../modules/app-bar.md#sign-out-everywhere)).
  A failed write is the error handler's 500 and ends nothing; signing in again works at once.
- Deleting the account ends every one of its sign-ins (`end_all`, [deleting an account](#deleting-an-account)).
- A TTL index on `expires_at` removes a document once it has ended, and an index on `user_id` serves `end_all`; both are built by `ensure_organizer_session_indexes`, and the boot refuses to start without them (`verify_organizer_session_indexes` in [`app.py`](../../../back-end/app.py), [lookup indexes](lookup-indexes.md)).

A login id that matches no account loads no one, with no fallback to loading by address: a fallback would keep every sign-in issued before the reset, or before login ids, signing in.

**For one release a sign-in made before sign-ins were kept on the server still signs in**, so the deploy signs nobody out.
Its id is `<login id>.<s|r>.<seconds since the epoch>`, the kind saying whether "Remember me" was ticked and the time when the account signed in, in the session or in the old `remember_token` cookie; a secret holds no `.`, so the two shapes cannot be confused (`is_legacy_sign_in`).
The user loader reads it as before, refusing one as old as its kind's length and an id of any other shape, the bare login id that came before it among them.
Flask-Login asks `a_legacy_remembered_account` in `app.py` once the session has loaded no one and the browser holds no new remember cookie: it reads a legacy id from `remember_token` (`legacy_remembered_account`) and restores it into the session, which is held to the browser as the new cookie's restore is.
A legacy sign-in has no document, so a replaced login id is what ends it: a reset or Sign out everywhere does.
Every answer that signs in or out deletes a `remember_token` the browser sent (`forget_the_legacy_remember_cookie`, after Flask-Login's `user_logged_in` and `user_logged_out`), so it cannot bring a sign-in back; a refused sign-in leaves it.

**Both sign-ins, the password and the code, give an account its login id at its first sign-in** (`_sign_in`): it is written only where none is stored, then read back, so two first sign-ins at once agree on one and neither signs the other out.
A read-back that finds none is the server's fault, logged and answered 500, never a refused sign-in.

Both read the body's `remember` with `flag_field`, so only JSON `true` is "Remember me" ([a request value is a string](../conventions/a-request-value-is-a-string.md#the-one-spelling)).
The tests are [`back-end/tests/test_the_remember_cookie.py`](../../../back-end/tests/test_the_remember_cookie.py), with the boot's indexes in [`test_the_organizer_sessions_are_indexed.py`](../../../back-end/tests/test_the_organizer_sessions_are_indexed.py) and the sign-ins on a real server in [`real_mongo/test_organizer_sessions_on_the_server.py`](../../../back-end/tests/real_mongo/test_organizer_sessions_on_the_server.py).
A route test that signs in by writing the session with an address points the user loader at its own fake account with conftest's `sessions_load_through_get_user`.

**A refused sign-in says what to do next, in three named sentences in `users.py`** (E38/F14/S02, [the sign-in's messages](../../business/flows/accounts.md#a2-sign-in-and-sign-out)).
`SIGN_IN_DOES_NOT_MATCH` answers a wrong password and an address with no account alike, the same status and body, and the password is checked either way: against one stand-in hash, made once at the app's cost factor, when the address has no account (`_password_matches`).
A password longer than bcrypt reads answers it too, checked against nothing ([the sign-in is bounded](#the-sign-in-is-bounded)).
`SIGN_IN_VERIFY_FIRST` answers a right password, a right code or a code asked for on an account not yet verified.
`SIGN_IN_WRONG_CODE` answers a wrong code and a code for an address with no account alike at every try, an account's fifth wrong code included, which discards its code without saying so ([a code's tries](#a-codes-tries-are-counted-in-one-update)); the sign-in limits count both alike.
[`back-end/tests/test_the_sign_in_answers.py`](../../../back-end/tests/test_the_sign_in_answers.py) holds each, and that none says "log in".

## A sign-up answers alike

**A sign-up answers the same whether or not its address has an account** (`register_user_with_captcha`).
Its checks run in one order, all before any account is looked up: the caller's bound, an address and a password, a captcha token, the address's bound ([the sign-in is bounded](#the-sign-in-is-bounded)), the captcha, the address's format, then the password's rules (at least 8 characters, at most 72 bytes).
So a taken address with a password too short is refused as a new one is, in the same words.
The password is hashed next, whether or not the address is taken, so both take about the same time; a taken address's hash is dropped.
Both then answer 201 "User registered successfully. Please check your email to verify your account." (`SIGNED_UP`).

- A new address is stored holding its verification link already `sending` (`account_secrets.issue_with_a_new_account`), then sent it; the provider's acceptance makes the link live, and a failed send takes the account back out and answers 500 with `SIGN_UP_SEND_FAILED` and `"error": "email_send_failed"`.
- An address with an account is sent one email in its place, and nothing on the account changes (`send_account_exists_email` in [`back-end/utils/email.py`](../../../back-end/utils/email.py)).
  Its subject is "You already have a Conventioner account"; it says someone, maybe its owner, tried to create an account with the address, links the sign-in page (`/login`) and the page that asks for a reset link (`/reset-password-request`), and says nothing about the account has changed.
  Its links carry no token, and a failed send answers the same 500.
- A sign-up that a concurrent one beat to the address, refused by the unique index at the insert ([one address is one account](#one-address-is-one-account)), takes the taken address's path.

The sign-up's per-address bound caps how many of these emails one address is sent: five in 15 minutes.
[`back-end/tests/test_one_account_per_address.py`](../../../back-end/tests/test_one_account_per_address.py) holds each.

## The sign-in is bounded

**The organizer's password and code sign-ins, and the requests that mail an organizer a code or a link, are counted as the applicant's sign-in is**, in the one list of limits, `LIMITS` in [`back-end/sign_in_limits.py`](../../../back-end/sign_in_limits.py): per address and per caller, in fixed 15-minute windows, in `sign_in_attempts`, whose counters name nobody ([sign-in is bounded](../../business/rules/a-vendor-signs-in-before-applying.md#sign-in-is-bounded)).

| Limit                                | Name                             | Tries in 15 minutes                          |
| ------------------------------------ | -------------------------------- | -------------------------------------------- |
| `PASSWORD_PER_ADDRESS`               | `password:address`               | 10 for one address                           |
| `PASSWORD_PER_CALLER`                | `password:caller`                | 50 from one caller                           |
| `ORGANIZER_CODE_PER_ADDRESS`         | `organizer-code:address`         | 10 for one address                           |
| `ORGANIZER_CODE_PER_CALLER`          | `organizer-code:caller`          | 60 from one caller                           |
| `ORGANIZER_CODE_REQUEST_PER_ADDRESS` | `organizer-code-request:address` | 5 `/request-otp` for one address             |
| `ORGANIZER_CODE_REQUEST_PER_CALLER`  | `organizer-code-request:caller`  | 30 `/request-otp` from one caller            |
| `RESET_LINK_PER_ADDRESS`             | `reset-link:address`             | 5 `/request-password-reset` for one address  |
| `RESET_LINK_PER_CALLER`              | `reset-link:caller`              | 30 `/request-password-reset` from one caller |
| `VERIFICATION_LINK_PER_ADDRESS`      | `verification-link:address`      | 5 `/resend-verification` for one address     |
| `VERIFICATION_LINK_PER_CALLER`       | `verification-link:caller`       | 30 `/resend-verification` from one caller    |
| `SIGN_UP_PER_ADDRESS`                | `sign-up:address`                | 5 `/register` for one address                |
| `SIGN_UP_PER_CALLER`                 | `sign-up:caller`                 | 30 `/register` from one caller               |

Each request has its own pair, so one request's use holds back no other.

**Every bounded route keeps one order** (`_Bounds` in `users.py`).
The caller (`sign_in_limits.caller()`, the address `ProxyFix` settled by `TRUSTED_PROXY_HOPS`) is counted before the body is read, so a request that names no address still counts against its caller.
The address, normalized, is counted next, before any account is looked up, password checked, code compared or captcha checked.
So a refused request reads no account and sends no mail, a refused sign-up spends no captcha check, and a refusal is the same for an address with an account and without, and whether the password or the code was right.

**A right password or code takes its try back** (`take_back_attempt`), from both counts, in the window it was counted in, whether it signs in or answers `SIGN_IN_VERIFY_FIRST`.
Only wrong tries pile up, so an organizer who signs in all day is never held back, and the E2E suite's hundreds of fixture sign-ins from one caller cost nothing.

**Past a limit `/login` and `/login-otp` answer 429** with `SIGN_IN_TOO_MANY`, "Too many sign-in attempts. Try again in {wait}, or reset your password.", under `message` on `/login` and `msg` on `/login-otp`, and the seconds left of the window in `Retry-After`.
`{wait}` is those seconds in whole minutes, rounded up (`wait_in_words`).
The password form puts "Forgot password?" beside it, as it does beside `SIGN_IN_DOES_NOT_MATCH` (`refusedSignIn` in `front-end/src/utils/signInNotice.ts`); the code form shows it alone.

**The mail requests take nothing back**: every `/request-otp`, `/request-password-reset`, `/resend-verification` and `/register` counts.
Past a limit each answers 429 with `ASKED_TOO_OFTEN`, "You have asked several times. Try again in {wait}.", under `msg`, with `Retry-After`.
Below the limits each answers as it did, `/request-otp`'s and `/request-password-reset`'s per-account waits among them.
The sign-in page and the verification page say the 429's sentence after "Send the link again" in place of "If that address needs verifying, a new link is on its way.", with nothing beside it (`resentLink`); the reset page and the sign-up form show it as they show any 429's `msg`.

### A code's tries are counted in one update

**`/login-otp` counts a try on the code in the same write that finds it** (`account_secrets.try_code`): one `find_one_and_update` on `{email, secrets.code.state: "live", secrets.code.tries: {$lt: 5}}` adding one to `secrets.code.tries`, with no plain read of the account before it but the one-release read of [the old fields](#the-old-fields-read-for-one-release).
So no more than five tries ever reach one code, even when they arrive at once; a try that finds nothing to match (no account, no live code, or its five tries counted) answers `SIGN_IN_WRONG_CODE`.
The try is checked against the stored hash in constant time (`code_matches`).

- The fifth wrong code discards the code (`state: "discarded"`), by a write conditional on its hash and `live`, and keeps its `next_allowed_at`, so `/request-otp` keeps its wait; it answers 401 `SIGN_IN_WRONG_CODE`, as every wrong code does.
- A right code that has expired answers 400 "That code has expired. You can ask for a new code in {wait}.", and is left as it is.
- A right code on an account not yet verified answers `SIGN_IN_VERIFY_FIRST` and is left live.
- A right code otherwise is used (`state: "used"`, `next_allowed_at` cleared) by a write conditional on its hash and `live`; of two right tries only the one whose write changed the account signs in, and the other answers `SIGN_IN_WRONG_CODE`.

`{wait}` in the expired code's sentence and in `/request-otp`'s refusal, "You can ask for a new code in {wait}.", is what is left of the code's `next_allowed_at`, an hour after it expired (`CODE_WAIT`); once it is over, the expired code's sentence ends "Ask for a new one." instead, and `/request-otp` sends a code.
`/request-password-reset` keeps one link at a time the same way, by the reset link's `next_allowed_at`: until an hour after the last mailed link expired (`RESET_WAIT`), unless that link was used, which clears it, it answers 429 `NEXT_RESET_LATER`, "You can ask for another reset link in {wait}.", under `msg`, with no `Retry-After`.

**A password longer than 72 bytes** in UTF-8 (`PASSWORD_MAX_BYTES`), which bcrypt refuses to hash or check, matches no account: `_password_matches` answers false without a bcrypt check, so `/login` answers `SIGN_IN_DOES_NOT_MATCH`, never the server's fault.
`/register` and `/reset-password` refuse one before hashing, after the 8-character minimum, with 400 `PASSWORD_TOO_LONG` under `msg`, "That password is too long. Use 72 characters or fewer; an accented letter or an emoji counts as more than one.", and store nothing; the register form and the reset page show it as the server says it.

[`back-end/tests/test_the_organizer_sign_in_is_bounded.py`](../../../back-end/tests/test_the_organizer_sign_in_is_bounded.py) holds each; [`back-end/tests/test_sign_in_limits.py`](../../../back-end/tests/test_sign_in_limits.py) holds the counters.

### A failed send leaves no wait armed

**`/request-otp`, `/request-password-reset` and `/resend-verification` store their code or link before they mail it**, since the mail names it, and when the send fails they answer 500 with their own sentence as before, leaving the account free to ask again at once, with no code or reset wait armed by a mail that never went.

**A secret the provider refused is unset** (`account_secrets.refused`): no wait, no live secret, and no write that restores an earlier one.
The write is conditional on the issued hash and `sending`, so a secret a newer request or a change meanwhile left is left as it is.
So a verification link mailed before a resend that could not be mailed no longer verifies, since the resend replaced it when it issued its own: no link is left live, and the next resend mails one at once.

The counts are not taken back: a failed send still counts against the caller and the address, so a sixth request in a quarter hour answers `ASKED_TOO_OFTEN` whether or not any mail went, and a failing provider cannot be asked without bound.
The vendor's code is not unset: its challenge arms no wait, and its failed send is answered as a sent one ([where it is kept](../../business/rules/a-vendor-signs-in-before-applying.md#where-it-is-kept)).
[`back-end/tests/test_a_failed_mail_leaves_no_wait_armed.py`](../../../back-end/tests/test_a_failed_mail_leaves_no_wait_armed.py) holds each, and the reset link's wait.

## The sign-in secrets

**An account's sign-in secrets are one machine, and [`back-end/account_secrets.py`](../../../back-end/account_secrets.py) is the only code that reads or writes them** ([ADR 0028](../../adr/0028-an-accounts-sign-in-secrets-are-one-machine.md)).
Each kind is one record under `secrets`, `{hash, expires_at, next_allowed_at, tries, state}`:

- `hash` is what is kept of the secret, never the secret: a code is kept salted, `"<salt>:<sha256(salt:code)>"`, as the vendor's code is, and a link as its hex SHA-256, unsalted, by which the account it names is found (`hash_link`; a link is 192 random bits, so its hash reveals nothing of it); so a copy of the database holds no code or link that signs in.
- `expires_at` and `next_allowed_at` are BSON datetimes in UTC; `next_allowed_at` is null when no wait holds back the next secret of the kind.
- `tries` counts the tries that reached a code.
- `state` is `sending` (issued, its mail not yet answered), `live`, `used` or `discarded`; an absent record is the state "none".

The kinds, `KINDS` in the module:

| Kind     | Mailed as                                           | Life      | `next_allowed_at` once mailed        | Tries            |
| -------- | --------------------------------------------------- | --------- | ------------------------------------ | ---------------- |
| `code`   | 6 digits (`generate_otp`)                           | 5 minutes | `expires_at` + 1 hour (`CODE_WAIT`)  | 5 (`CODE_TRIES`) |
| `reset`  | `token_urlsafe(24)` (`generate_reset_token`)        | 1 hour    | `expires_at` + 1 hour (`RESET_WAIT`) | not counted      |
| `verify` | `token_urlsafe(24)` (`generate_verification_token`) | 1 hour    | the moment it was mailed: no wait    | not counted      |

Every change is one write conditional on the state it moves from, and nothing else writes the field; each function takes the users collection from `api/users.py`, and reads the time from the module's `now()`.

| From \ event       | issue                                                                    | provider accepted           | provider refused | right try (code) / link used    | wrong try (code)                             | password reset |
| ------------------ | ------------------------------------------------------------------------ | --------------------------- | ---------------- | ------------------------------- | -------------------------------------------- | -------------- |
| none               | sending                                                                  | -                           | -                | refused                         | refused                                      | -              |
| sending, unexpired | refused                                                                  | live, `next_allowed_at` set | none (unset)     | refused                         | refused                                      | none           |
| sending, expired   | sending (a new one)                                                      | no write                    | no write         | refused                         | refused                                      | none           |
| live, unexpired    | refused while `next_allowed_at` is ahead (code, reset); sending (verify) | -                           | -                | used, `next_allowed_at` cleared | `tries` + 1; the fifth: discarded, wait kept | none           |
| live, expired      | refused while `next_allowed_at` is ahead, else sending                   | -                           | -                | refused, answered expired       | `tries` + 1, as above                        | none           |
| used               | sending                                                                  | -                           | -                | refused                         | refused                                      | none           |
| discarded          | sending once `next_allowed_at` has passed                                | -                           | -                | refused                         | refused                                      | none           |

The "password reset" column is what a reset by the link does to the account's other secrets, the code and the verification link; for the reset link itself it is the "link used" column.
A verification link has no wait, so its `next_allowed_at` is never ahead: a new one may be asked for while the last is live, and replaces it.

- **Issue** (`issue`) is one `update_one` whose filter is the account by `id`, `email_verified: true` for a code and not true for a verification link, `next_allowed_at` null or not after now, and no unexpired `sending` record; it sets the record `sending`, with no wait, and unsets the kind's old fields.
  The secret is made before that write, so of two requests at once one mails it and the other matches nothing and is answered the wait, read once more from the account: what is left of `next_allowed_at`, or, for a secret being mailed, of its expiry and the kind's wait.
  A reset link is issued to an address never verified too, since following it proves the mailbox.
  `/resend-verification` refused because another request's link is being mailed mails none and answers 200 "Verification email sent", since one link is on its way.
- **Provider accepted** (`accepted`) and **refused** (`refused`) are conditional on the issued hash, `sending` and its expiry not passed, so a later change is left alone.
- An expiry writes nothing: a `sending` record past its life is read as none, a `live` one as expired.
- **The reset link used** (`/reset-password`): `find_link` reads the account by the link's hash and `live` only to tell "Reset token has expired" from "Invalid reset token"; then `use_reset_link` is one `find_one_and_update` whose filter is the hash, `live` and `expires_at` after now, the same filter that found it.
  In that one write it sets the new password, a new `login_id`, `email_verified: true`, the link `used` and its `next_allowed_at` null, and unsets the code, the verification link and every old field the module reads.
  So a code or a verification link live at the reset ends with it, leaving no code wait, the address's owner can sign in once they have reset, and every sign-in issued before ends with the login id; of two uses at once one resets and the other, matching nothing, answers "Invalid reset token".
- **The verification link used** (`/verify-email`): `find_link` tells "Verification token has expired" from "Invalid verification token" the same way; then `use_verification_link` is one `find_one_and_update` on the hash, `live` and `expires_at` after now, setting `email_verified: true`, the link `used` and its `next_allowed_at` null.
  A link used meanwhile matches nothing and answers "Invalid verification token"; a live link on an address already verified is used and answers "Email already verified".
- **An operator verifies an account** ([`create_account.py`](../../../back-end/create_account.py) `verify`, through `verify_by_hand`): one `update_one` by the address that sets `email_verified: true` and unsets the verification link and its old fields, as following the link would.

[`back-end/tests/test_the_sign_in_secret_machine.py`](../../../back-end/tests/test_the_sign_in_secret_machine.py) holds every cell of the table, by kind; [`back-end/tests/real_mongo/test_the_sign_in_secret_races.py`](../../../back-end/tests/real_mongo/test_the_sign_in_secret_races.py) runs five code requests at once, five right codes at once, and five uses of one reset link or of one verification link at once, on a real server; [`back-end/tests/test_a_stored_account_holds_no_secret_in_clear.py`](../../../back-end/tests/test_a_stored_account_holds_no_secret_in_clear.py) reads every stored account whole after a sign-up, a verification resend, a reset request and a code request, and after each secret is used, and finds no mailed secret; [`back-end/tests/test_the_sign_in_secrets_hold_one_state.py`](../../../back-end/tests/test_the_sign_in_secrets_hold_one_state.py) drives the routes for the states a reset settles; [`back-end/tests/test_the_reset_link_answers.py`](../../../back-end/tests/test_the_reset_link_answers.py) pins every answer of `/request-password-reset` and `/reset-password`; [`back-end/tests/test_the_verification_link_answers.py`](../../../back-end/tests/test_the_verification_link_answers.py) pins every answer of `/register`, `/resend-verification` and `/verify-email` but a taken address and the bounds; and [`back-end/tests/test_one_writer_of_the_sign_in_secrets.py`](../../../back-end/tests/test_one_writer_of_the_sign_in_secrets.py) scans the back end for any other module naming `secrets` or an old field.
An E2E spec plants a code it knows with `plantSignInCode`, and a reset or verification link with `plantAccountLink`, in [`front-end/e2e/helpers/accountSecrets.ts`](../../../front-end/e2e/helpers/accountSecrets.ts), as the mail would have carried it; a spec that asks for a new link tells it from the last by the stored hash (`storedAccountLinkHash`).

### The old fields, read for one release

Before `secrets`, an account kept its code in clear in `otp`, `otp_expires` (an ISO string) and `otp_attempts`, its reset link in `password_reset_token` and `password_reset_token_expires`, and its verification link in `verification_token` and `verification_token_expires`; for one release the module still reads them, so a code or link mailed before the deploy keeps working until it would have expired.
The first time the module reads an account holding any of them (`_upgrade`), it turns them into the records in one write, filtered on the values it read and on each record being absent, and unsets them:

- a stored `otp` becomes a live code, its tries from `otp_attempts`, its life from `otp_expires` and its wait an hour after that;
- a cleared `otp` with its `otp_expires` kept, as five wrong tries left it, becomes a discarded code keeping that wait;
- a stored `password_reset_token` becomes a live reset link, its life from `password_reset_token_expires` and its wait an hour after that, and a cleared one with its expiry kept a discarded link keeping that wait;
- a stored `verification_token` becomes a live verification link, its life from `verification_token_expires`, with no wait;
- cleared fields, or an expiry that does not read, become no record: a verification token with no expiry, which the old route answered as expired, now answers as a link that is not there.

A link opened is found, for the release, by `password_reset_token` or `verification_token` equal to it too (`find_link`), and that account is upgraded before the link is read by its hash.

No writer writes them: a sign-up and `create_account.py` store none, and only the old migration that first added them, `migrations/add_email_verification.py`, names them, setting each an account lacks to null (`otp_attempts` to 0), which reads as no record.
[`back-end/tests/test_the_old_sign_in_fields_are_read_for_one_release.py`](../../../back-end/tests/test_the_old_sign_in_fields_are_read_for_one_release.py) holds each shape.
The follow-up `T311-followup: retire the old sign-in fields and cookie` deletes `_upgrade`, its tests, the fields on `User` and the two old token fields' lookup indexes, and the reading of the legacy sign-in id and the `remember_token` cookie (`is_legacy_sign_in`, `_legacy_account` and `_LIFETIMES`, `legacy_remembered_account`, `a_legacy_remembered_account` and `forget_the_legacy_remember_cookie`), no sooner than 30 days after this release reaches production, with a script, which Daniel runs, that unsets the fields.

## Lookups

`login_id`, `secrets.reset.hash`, `secrets.verify.hash` and the two old token fields are [lookup indexes](lookup-indexes.md), so loading the account on each request, and following a link, is one indexed read; the links' four are `account_secrets.LOOKUP_FIELDS`.
So is `id`: `get_user_by_id` reads one account by it, and `get_users_by_ids` reads many in one `find` with `$in`, answering the accounts found by id, an id with no account left out.
A read that names many people uses the batch, never one `get_user_by_id` each: the market read names every account its lists can name in one call ([one market, from the server](../conventions/one-market-from-the-server.md#the-rules)), so a market of 150 people costs the database one read of them, and the organizations read names, in one call, every person of every organization the reader is in ([the organization document](organization-document.md#the-organization)).
Accounts are made by sign-up, by `back-end/create_account.py` for an operator, and by `create_test_user.py` for the test fixtures.

## One address is one account

**Every address is stored and compared in one form:** `normalized_email()` in [`back-end/utils/email_address.py`](../../../back-end/utils/email_address.py), trimmed and lowercased, empty for none.
Every writer and lookup of an address goes through it: an organizer's account (register, sign-in, a code, a reset, the operator script), an applicant's sign-in and application, a vendor's check-in, the organizer's notes, the table-share answer and the placement trail.
Two spellings of one address used to be two accounts, and an account registered with a capital letter could sign in only spelled exactly so.

**The database is the referee**: `ensure_user_indexes()` builds the unique index `user_email` on `users.email`, and [`app.py`](../../../back-end/app.py) refuses to start without it (`verify_user_indexes`).
Register checks for the address and then inserts, two steps a double click fell between; a losing insert now meets the index and is answered as a taken address is ([a sign-up answers alike](#a-sign-up-answers-alike)).
The index is unique over the stored form, so before building it the check refuses any account whose address is not stored lowercased, naming the accounts by id and [`migrations/migrate_user_emails.py`](../../../back-end/migrations/migrate_user_emails.py), which rewrites them.
When two accounts would share an address, the migration writes nothing and names them by id: which account is kept is the organizer's call, not a migration's.
Duplicates that stop the index build are named the same way.
Refusals and the migration print ids, never addresses, because they reach an operator's terminal and the host's logs.
Once the unique index stands, the boot check reads nothing more, since a boot on a serverless host is every cold start.
A plain index on `email`, which the lookup indexes once built, is replaced by the unique one; `ensure_user_indexes` is the email index's one owner.
The fix for each refusal is in [Operations](../../OPERATIONS.md#when-the-back-end-refuses-to-boot).

## Deleting an account

A person deletes only their own account, and not while they own an organization or a market, so every organization and every market keeps an owner whose account exists: they transfer the organization's ownership, and transfer the market's ownership (`hand_on_market`, [the market's actions](../modules/market-actions.md#transfer-ownership-hand-on-market)) or delete it, first.
`delete_user` reads the organizations whose people name them `owner` and the markets whose `roles.<id>` is `"owner"` (projecting `id` and `name`, served by the `roles.$**` [lookup index](lookup-indexes.md)), and while either finds one it answers 409 and deletes nothing.
The body's `msg` is one sentence for each, space-joined: "Transfer ownership of <organization names> before deleting this account." and "Transfer or delete <market names> before deleting this account." (`OWNS_MARKETS`), the names comma-joined; `ownedOrganizations` and `ownedMarkets` list the names, each present only when it is not empty.
A role below Owner on a market is not ownership, and the deletion goes ahead ([what each role may do](../../business/rules/what-each-role-may-do.md#a-chosen-reviewer-and-where-a-role-comes-from)).
[`test_delete_user_authorization.py`](../../../back-end/tests/test_delete_user_authorization.py) pins that only the session's own account is deleted, each refusal alone and both together, and an Admin, Editor or Viewer of a market deleted.
Deleting it takes their place in every organization's people, the map and its `admins` and `members` mirror alike ([the organization's people](../modules/organization-people.md)); a role entry naming them on a market stays in that market's `roles`.
It ends every sign-in of the account too (`organizer_sessions.end_all`), so no record of one is left.

What an organizer does with their account, from registering to resetting a password, is [the accounts flows](../../business/flows/accounts.md).
