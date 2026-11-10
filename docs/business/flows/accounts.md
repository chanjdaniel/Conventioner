---
layer: business
kind: flow
verified: 2026-11-10
sources:
  - E26/F01/S01
  - E32/F03/S04
  - bug/22
  - bug/44
  - T73
  - T148
  - E38/F11/S01
  - T161
  - E38/F14/S01
  - T169
  - E38/F14/S02
  - T176
  - T181
  - T209
  - T211
  - T251
  - E47/F02/S01
  - T263
---

# Accounts

**Who:** an organizer, or someone about to become one; vendors have no account (they sign in per market with a code, [H3](applying-online.md#h3-vendors-apply-online)).
**Where they start:** `/login`, which has three tabs: Sign in, Register and Sign-in code.
The pages that get an organizer in fit a phone, since the door on market day sits behind sign-in, and so does the Markets list sign-in lands on ([C1](finding-a-market.md#c1-signing-in-lands-on-markets), T148; [the design language](../../design-system.md#layout); `sign-in-fits-a-phone.spec.ts`).
**Serves:** [A request can only do what its session may](../intents/a-request-can-only-do-what-its-session-may.md).

An account is one email address: an address differing only in case or spacing is the same account ([users, and the one spelling of an address](../../implementation/data/users-and-email.md#one-address-is-one-account)).

## A1. Register and verify an organizer account

**Status:** Works; a signed-out person sees the confirmation at step 4 since bug 22 was fixed (`auth.spec.ts`, `account-links.spec.ts`), and since E32/F03/S04 a double click makes one account and one email, and two sign-ups racing for one address make one account (`a-signup-is-sent-once.spec.ts`).
Steps 1 to 3 walked live as far as reCAPTCHA allows (the slot-1 stack has real keys and refuses automated browsers).
**Task:** "Create an account for yourself."

1. Go to `/login` and choose the Register tab.
2. Enter email, password (at least 8 characters) and the same password again; choose "Create account".
3. Expect a success message saying a verification link was emailed and that sign-in is impossible until it is followed.
4. Open the emailed link, which lands on `/verify-email`; expect confirmation and "Redirecting to sign in…"; three seconds later the page goes to sign in.
5. Sign in (A2).

Branches: mismatched passwords ("Passwords do not match"), short password, a password too long, an email already registered, an expired or reused link, asking too often.

- An email already registered says what a new one says at step 3, after the same checks, and makes no account: the account's owner is emailed "You already have a Conventioner account", with a link to sign in and one to reset the password, and nothing about the account changes ([a sign-up answers alike](../../implementation/data/users-and-email.md#a-sign-up-answers-alike)).

- A password longer than 72 bytes, which may be fewer than 72 characters since an accented letter or an emoji takes more than one, says "That password is too long. Use 72 characters or fewer; an accented letter or an emoji counts as more than one." and makes no account ([a password longer than 72 bytes](../../implementation/data/users-and-email.md#the-sign-in-is-bounded)).

- Past five sign-ups for one address in 15 minutes, or thirty from one caller, the next says "You have asked several times. Try again in N minutes.", the same for every address, before the reCAPTCHA check ([the sign-in is bounded](../../implementation/data/users-and-email.md#the-sign-in-is-bounded)).

Depends on: reCAPTCHA (bypassed locally), Resend.
Covered by:
- `a-signup-is-sent-once.spec.ts`
- `account-links.spec.ts`
- `auth.spec.ts` ("Register new user")
- `sign-in-fits-a-phone.spec.ts`
- `the-sign-in-fits-a-small-phone.spec.ts`

## A1a. Resend the verification email

**Status:** Works (`POST /resend-verification`; walked live, T181).

1. Open a link that fails (expired, used, or cut short); `/verify-email` says why.
2. Type the address in the page's Email field and choose "Send the link again".
3. Expect "If that address needs verifying, a new link is on its way.", whatever the address, and the page to stay where it is: only a link that worked goes on to sign in.
   The form goes, and focus moves to "Back to sign in", the one control left.

The page asks for the address on the page itself, in a labelled field.
"Send the link again" with nothing typed says "Type your email address." under the field and sends nothing; a double click sends one link.
A server's fault or no answer says so, and keeps the form and the address to try again.
Past five links asked for one address in 15 minutes, or thirty from one caller, the next says "You have asked several times. Try again in N minutes." in place of a link on its way, the same for every address, and keeps the form and the address.
"Back to sign in" under it is a link to `/login`.

A sign-in refused because the address is not verified yet offers "Send the link again" too (A2), which says the same sentences (E38/F14/S02); past the limit it offers the link no more.
Covered by:
- `the-sign-in-says-what-to-do-next.spec.ts`
- `the-verification-page-asks-on-the-page.spec.ts`

## A2. Sign in and sign out

**Status:** Works (walked live).
**Task:** "Sign in, then sign out."

1. At `/login`, Sign in tab, enter email and password, choose "Sign in".
   "Remember me" under the password is unticked: the sign-in then ends when the browser closes, and at the latest 12 hours after it; ticked, it lasts 30 days from signing in, however the browser is used.
   Either way it lasts only as long as the browser's address and the browser stay the same: a phone that moves from the venue's wifi to cellular is signed out, an E47 follow-up ([the cookies](../../implementation/conventions/security-invariants.md#the-cookies)).
2. Expect the Markets list (`/markets`), or the page the address carried in `next` (E38/F11/S01).
3. Choose "Sign out" in the app bar ([C4](finding-a-market.md#c4-the-navigation-menu)); expect `/login`.

Branches: wrong password, unverified account, too many tries, "Show" password toggle, visiting an organizer URL while signed out (redirects to `/login`, which returns there after signing in), visiting `/login` while signed in (redirects to that `next`, else the Markets list).
A market link opened while signed out returns there after sign-in, by password or by code, rather than to the Markets list.
A session that ends mid-work lands on sign-in saying "Your session has ended. Sign in again.", and signing in returns to the page it was on.
A browser closed and reopened is signed out unless "Remember me" was ticked.

Each form says one line at a time, the newer replacing the older, and says what to do next (E38/F14/S02):

- A wrong password and an address with no account say the same, "That email and password do not match.", with "Forgot password?" in it (A4); so does a password longer than 72 bytes.
- Past ten tries at one address in 15 minutes, or fifty from one caller, the next says "Too many sign-in attempts. Try again in N minutes, or reset your password.", with "Forgot password?" in it, the same for every address.
  A right password takes its own try back, so only wrong ones count, and a few mistyped passwords cost nothing ([the sign-in is bounded](../../implementation/data/users-and-email.md#the-sign-in-is-bounded)).
- A right password on an account not yet verified says "Verify your email address first: we sent you a link when you registered.", with "Send the link again" (A1a).

Covered by:
- `a-failure-says-what-to-do.spec.ts`
- `auth.spec.ts`
- `remember-me.spec.ts`
- `sign-in-fits-a-phone.spec.ts`
- `smoke.spec.ts`
- `the-sign-in-fits-a-small-phone.spec.ts`
- `the-sign-in-says-what-to-do-next.spec.ts`
- `the-way-in-lines-up.spec.ts` ("every row of the sheet is one shape, Sign out included")

## A3. Sign in with an emailed code

**Status:** Works as far as it can be walked without a mailer (walked live).

1. At `/login`, choose the "Sign-in code" tab, enter email, choose "Send code".
2. Enter the code from the email, tick "Remember me" or leave it, and choose "Sign in"; the choice is the Sign in tab's, kept between the two (A2).
3. "Use a different email" returns to step 1.

Branches: a wrong code ("That code is not right."), which replaces the line saying the code was sent, and which a code for an address with no account answers too, at every try; a right code that has expired; too many tries; asking for another code too soon; an account not yet verified, which says to verify first and offers "Send the link again", as A2 does.

- The fifth wrong code discards the code and says "That code is not right." as the others do, so the right code after it is refused alike.
- A right code that has expired says "That code has expired. You can ask for a new code in N minutes.": a new code can be asked for an hour after the last one expired, whether it expired or five wrong tries discarded it, and once that wait is over it says "Ask for a new one." instead.
- Asking for another code before then says "You can ask for a new code in N minutes.".
- Past five codes asked for one address in 15 minutes, or thirty from one caller, the next says "You have asked several times. Try again in N minutes.", the same for every address.
- Past ten tries at one address in 15 minutes, or sixty from one caller, the next says "Too many sign-in attempts. Try again in N minutes, or reset your password.", the same for every address; a right code takes its own try back, as a right password does ([the sign-in is bounded](../../implementation/data/users-and-email.md#the-sign-in-is-bounded)).

Covered by:
- `a-failure-says-what-to-do.spec.ts`, which stubs the send and sets the code where the server keeps it, then signs in with it
- `auth.spec.ts` ("shows error for invalid OTP code"), which stubs the send and walks only a wrong code
- `remember-me.spec.ts`, which stubs the send and sets the code where the server keeps it, then signs in with it
- `sign-in-fits-a-phone.spec.ts`
- `the-sign-in-fits-a-small-phone.spec.ts`
- `the-sign-in-says-what-to-do-next.spec.ts`, which stubs the send and walks only a wrong code

## A4. Reset a forgotten password

**Status:** Works; a signed-out person reaches the form at step 2 since bug 22 was fixed (`auth.spec.ts`, `account-links.spec.ts`).

1. At `/login`, choose "Forgot password?"; enter email on `/reset-password-request`.
2. Follow the emailed link to `/reset-password`, set a new password; every browser signed in to the account, remembered or not, is signed out.
3. Sign in with the new password.

Branches: asking for another link before an hour has passed since the last one expired ("Please wait before requesting another password reset"), asking too often, a new password too short or too long.

- A new password longer than 72 bytes says "That password is too long. Use 72 characters or fewer; an accented letter or an emoji counts as more than one.", as at sign-up (A1), and leaves the password and the link as they were.

- Past five links asked for one address in 15 minutes, or thirty from one caller, the next says "You have asked several times. Try again in N minutes.", the same for every address ([the sign-in is bounded](../../implementation/data/users-and-email.md#the-sign-in-is-bounded)).

Covered by:
- `account-links.spec.ts`
- `auth.spec.ts` ("Password reset")
- `sign-in-fits-a-phone.spec.ts`
- `the-sign-in-says-what-to-do-next.spec.ts` ("past its limit, asking for a reset link says how long to wait")
- `the-way-in-lines-up.spec.ts` ("asking for a reset reads like signing in")

## A4a. Change a password while signed in

**Status:** Works as far as it can be walked without a mailer: `account-links.spec.ts` walks it to the new password in one browser, reading the link's token from where the server keeps it (T209).
**Task:** "Change your password."

1. Choose "Change password" in [the bar's account menu, or its sheet on a phone](finding-a-market.md#c4-the-navigation-menu); it opens `/reset-password-request` with the address filled in.
2. Choose "Send reset link"; the address stays editable, and "Back to Markets" leaves without sending anything.
3. Follow the emailed link and set a new password, as in A4; every browser signed in to the account is signed out, this one with it.
   A link for another account signs this browser out too, whoever it was signed in as.
4. Expect the password's confirmation, then sign-in with nothing said of a session ending; sign in with the new password.

A link that is refused, as expired or already used, changes nothing, and the person stays signed in.
How the bar and the two password pages do this is in [the app bar](../../implementation/modules/app-bar.md#change-password).
Covered by:
- `account-links.spec.ts`
- `the-app-bar.spec.ts` ("Change password, at a desk" and "on a phone")

## A5. Delete my account

**Status:** No screen (`POST /delete-user` exists; nothing in the front end calls it).

Its gaps worth a spec are in [walking the flows](../../implementation/testing/walking-the-flows.md#coverage-map).
