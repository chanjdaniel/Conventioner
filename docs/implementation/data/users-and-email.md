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
  - back-end/app.py#verify_user_indexes
  - back-end/migrations/migrate_user_emails.py
  - back-end/tests/test_the_remember_cookie.py
  - back-end/tests/test_the_organizer_sign_in_is_bounded.py
verified: 2026-11-10
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
---

# Users, and the one spelling of an address

One document per organizer account in the `users` collection, and the rule every collection follows for a person's address.
[`back-end/api/users.py`](../../../back-end/api/users.py) writes and reads accounts; the model is `User` in [`back-end/datatypes.py`](../../../back-end/datatypes.py).
Vendors have no account: an applicant signs in with a code sent to their address, held per market in `applicant_login_challenges`.

The glossary concept: [Organization and roles](../../business/concepts/organization-and-roles.md).

## The fields that matter

| Field | What it is |
| --- | --- |
| `id` | a UUID, the primary key, and what every role and membership names |
| `email` | the sign-in, stored lowercased and trimmed, unique |
| `password` | a bcrypt hash |
| `organizations` | the ids of the organizations the person is in ([the organization document](organization-document.md)); empty at registration, whatever the body sends, and written only by a membership change |
| `email_verified` | false until the emailed link is followed; an unverified account cannot sign in |
| `verification_token`, `verification_token_expires` | the email-verification link, valid an hour |
| `password_reset_token`, `password_reset_token_expires` | the password-reset link, valid an hour |
| `otp`, `otp_expires`, `otp_attempts` | a sign-in code, valid five minutes; its tries are counted in the update that reads it, and the fifth wrong one discards the code and keeps `otp_expires`, which holds back the next code until an hour after it |
| `login_id` | the account a session or remember-me cookie names, in its sign-in id: a random value, made at the first sign-in and replaced by a password reset |

## The session names the account by its login id

The session and the remember-me cookie name the account by its `login_id`, not its address, inside a sign-in id (`AuthUser.get_id`): `<login id>.<s|r>.<seconds since the epoch>`, the kind saying whether "Remember me" was ticked and the time when the account signed in.
Each signed-in request reads it through the app's user loader, `signed_in_account`, which refuses a sign-in as old as its kind's length ([the cookies](../conventions/security-invariants.md#the-cookies)) and an id of any other shape, then loads the account by its login id (`get_user_by_login_id`); `authenticated_email()` then reads the loaded account's address, and permissions are decided by the account's id.
**A password reset replaces the login id**, in the same write as the new password, so every session and remember-me cookie issued before the reset loads no one and that browser is signed out; signing in again works at once.
An organizer who resets a password because a device was lost or shared is signed out on it.
A login id that matches no account loads no one, with no fallback to loading by address: a fallback would keep every remember-me cookie issued before the reset, or before login ids, signing in.
So every organizer must sign in once more after the release that brings login ids, since their sessions had named the account by its address, and once more after the release that brings sign-in ids, since theirs had named the bare login id.

**Both sign-ins, the password and the code, give an account its login id at its first sign-in** (`_sign_in`): it is written only where none is stored, then read back, so two first sign-ins at once agree on one and neither signs the other out.
A read-back that finds none is the server's fault, logged and answered 500, never a refused sign-in.

Both read the body's `remember` with `flag_field`, so only JSON `true` is "Remember me" ([a request value is a string](../conventions/a-request-value-is-a-string.md#the-one-spelling)).
The tests are [`back-end/tests/test_the_remember_cookie.py`](../../../back-end/tests/test_the_remember_cookie.py).
A route test that signs in by writing the session with an address points the user loader at its own fake account with conftest's `sessions_load_through_get_user`.

**A refused sign-in says what to do next, in three named sentences in `users.py`** (E38/F14/S02, [the sign-in's messages](../../business/flows/accounts.md#a2-sign-in-and-sign-out)).
`SIGN_IN_DOES_NOT_MATCH` answers a wrong password and an address with no account alike, the same status and body, and the password is checked either way: against one stand-in hash, made once at the app's cost factor, when the address has no account (`_password_matches`).
A password longer than bcrypt reads answers it too, checked against nothing ([the sign-in is bounded](#the-sign-in-is-bounded)).
`SIGN_IN_VERIFY_FIRST` answers a right password, a right code or a code asked for on an account not yet verified.
`SIGN_IN_WRONG_CODE` answers a wrong code and a code for an address with no account alike for each of the first four tries.
An account's fifth wrong code discards its code and answers 429 "Too many wrong codes. You can ask for a new code in {wait}." ([a code's tries](#a-codes-tries-are-counted-in-one-update)), which an address with no account, having no code, never answers; the sign-in limits count both alike, and answering the fifth alike too is E47/F01/S01's.
[`back-end/tests/test_the_sign_in_answers.py`](../../../back-end/tests/test_the_sign_in_answers.py) holds each, and that none says "log in".

## The sign-in is bounded

**The organizer's password and code sign-ins, and the requests that mail an organizer a code or a link, are counted as the applicant's sign-in is**, in the one list of limits, `LIMITS` in [`back-end/sign_in_limits.py`](../../../back-end/sign_in_limits.py): per address and per caller, in fixed 15-minute windows, in `sign_in_attempts`, whose counters name nobody ([sign-in is bounded](../../business/rules/a-vendor-signs-in-before-applying.md#sign-in-is-bounded)).

| Limit | Name | Tries in 15 minutes |
| --- | --- | --- |
| `PASSWORD_PER_ADDRESS` | `password:address` | 10 for one address |
| `PASSWORD_PER_CALLER` | `password:caller` | 50 from one caller |
| `ORGANIZER_CODE_PER_ADDRESS` | `organizer-code:address` | 10 for one address |
| `ORGANIZER_CODE_PER_CALLER` | `organizer-code:caller` | 60 from one caller |
| `ORGANIZER_CODE_REQUEST_PER_ADDRESS` | `organizer-code-request:address` | 5 `/request-otp` for one address |
| `ORGANIZER_CODE_REQUEST_PER_CALLER` | `organizer-code-request:caller` | 30 `/request-otp` from one caller |
| `RESET_LINK_PER_ADDRESS` | `reset-link:address` | 5 `/request-password-reset` for one address |
| `RESET_LINK_PER_CALLER` | `reset-link:caller` | 30 `/request-password-reset` from one caller |
| `VERIFICATION_LINK_PER_ADDRESS` | `verification-link:address` | 5 `/resend-verification` for one address |
| `VERIFICATION_LINK_PER_CALLER` | `verification-link:caller` | 30 `/resend-verification` from one caller |
| `SIGN_UP_PER_ADDRESS` | `sign-up:address` | 5 `/register` for one address |
| `SIGN_UP_PER_CALLER` | `sign-up:caller` | 30 `/register` from one caller |

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

**`/login-otp` counts a try on the code in the same update that reads it**: one `find_one_and_update` on `{email, otp: {$ne: None}, otp_attempts: {$lt: 5}}` adding one to `otp_attempts`, with no plain read of the account before it.
So no more than five tries ever reach one code, even when they arrive at once; a try that finds nothing to match (no account, no code, or its five tries counted) answers `SIGN_IN_WRONG_CODE`.
The code is compared with `secrets.compare_digest`.

- The fifth wrong code discards the code, by an update conditional on the stored code, and keeps `otp_expires`, so `/request-otp` keeps its wait; it answers 429 "Too many wrong codes. You can ask for a new code in {wait}.".
- A right code that has expired answers 400 "That code has expired. You can ask for a new code in {wait}.", and is left as it is.
- A right code on an account not yet verified answers `SIGN_IN_VERIFY_FIRST` and is left as it is.
- A right code otherwise is consumed by an update conditional on the stored code; of two right tries only the one whose update changed the account signs in, and the other answers `SIGN_IN_WRONG_CODE`.

`{wait}` in these and in `/request-otp`'s refusal, "You can ask for a new code in {wait}.", is what is left of the account's wait, which ends an hour after its code's `otp_expires` (`_code_wait`); once it is over, the code sentences end "Ask for a new one." instead, and `/request-otp` sends a code.

**A password longer than 72 bytes** in UTF-8 (`PASSWORD_MAX_BYTES`), which bcrypt refuses to hash or check, matches no account: `_password_matches` answers false without a bcrypt check, so `/login` answers `SIGN_IN_DOES_NOT_MATCH`, never the server's fault.
`/register` and `/reset-password` refuse one before hashing, after the 8-character minimum, with 400 `PASSWORD_TOO_LONG` under `msg`, "That password is too long. Use 72 characters or fewer; an accented letter or an emoji counts as more than one.", and store nothing; the register form and the reset page show it as the server says it.

[`back-end/tests/test_the_organizer_sign_in_is_bounded.py`](../../../back-end/tests/test_the_organizer_sign_in_is_bounded.py) holds each; [`back-end/tests/test_sign_in_limits.py`](../../../back-end/tests/test_sign_in_limits.py) holds the counters.

## Lookups

`login_id` and the two token fields are [lookup indexes](lookup-indexes.md), so loading the account on each request, and following a link, is one indexed read.
So is `id`: `get_user_by_id` reads one account by it, and `get_users_by_ids` reads many in one `find` with `$in`, answering the accounts found by id, an id with no account left out.
A read that names many people uses the batch, never one `get_user_by_id` each: the market read names every account its lists can name in one call ([one market, from the server](../conventions/one-market-from-the-server.md#the-rules)), so a market of 150 people costs the database one read of them, and the organizations read names, in one call, every person of every organization the reader is in ([the organization document](organization-document.md#the-organization)).
Accounts are made by sign-up, by `back-end/create_account.py` for an operator, and by `create_test_user.py` for the test fixtures.

## One address is one account

**Every address is stored and compared in one form:** `normalized_email()` in [`back-end/utils/email_address.py`](../../../back-end/utils/email_address.py), trimmed and lowercased, empty for none.
Every writer and lookup of an address goes through it: an organizer's account (register, sign-in, a code, a reset, the operator script), an applicant's sign-in and application, a vendor's check-in, the organizer's notes, the table-share answer and the placement trail.
Two spellings of one address used to be two accounts, and an account registered with a capital letter could sign in only spelled exactly so.

**The database is the referee**: `ensure_user_indexes()` builds the unique index `user_email` on `users.email`, and [`app.py`](../../../back-end/app.py) refuses to start without it (`verify_user_indexes`).
Register checks for the address and then inserts, two steps a double click fell between; a losing insert now meets the index and is answered as "User already exists".
The index is unique over the stored form, so before building it the check refuses any account whose address is not stored lowercased, naming the accounts by id and [`migrations/migrate_user_emails.py`](../../../back-end/migrations/migrate_user_emails.py), which rewrites them.
When two accounts would share an address, the migration writes nothing and names them by id: which account is kept is the organizer's call, not a migration's.
Duplicates that stop the index build are named the same way.
Refusals and the migration print ids, never addresses, because they reach an operator's terminal and the host's logs.
Once the unique index stands, the boot check reads nothing more, since a boot on a serverless host is every cold start.
A plain index on `email`, which the lookup indexes once built, is replaced by the unique one; `ensure_user_indexes` is the email index's one owner.
The fix for each refusal is in [Operations](../../OPERATIONS.md#when-the-back-end-refuses-to-boot).

## Deleting an account

A person deletes only their own account, and not while they own an organization: they transfer it first.
Deleting it pulls them from every organization's `admins` and `members`; a role entry naming them on a market stays in that market's `roles`.

What an organizer does with their account, from registering to resetting a password, is [the accounts flows](../../business/flows/accounts.md).
