---
layer: business
kind: flow
verified: 2026-11-01
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
---

# Accounts

**Who:** an organizer, or someone about to become one; vendors have no account (they sign in per market with a code, [H3](applying-online.md#h3-vendors-apply-online)).
**Where they start:** `/login`, which has three tabs: Sign in, Register and Sign-in code.
The pages that get an organizer in fit a phone, since the door on market day sits behind sign-in, and so does the dashboard sign-in lands on ([C1](finding-a-market.md#c1-the-dashboard), T148; [the design language](../../design-system.md#layout); `sign-in-fits-a-phone.spec.ts`).
**Serves:** [A request can only do what its session may](../intents/a-request-can-only-do-what-its-session-may.md).

An account is one email address: an address differing only in case or spacing is the same account ([users, and the one spelling of an address](../../implementation/data/users-and-email.md#one-address-is-one-account)).

## A1. Register and verify an organizer account

**Status:** Works; a signed-out person sees the confirmation at step 4 since bug 22 was fixed (`auth.spec.ts`, `account-links.spec.ts`), and since E32/F03/S04 a double click or a race makes one account and one email (`a-signup-is-sent-once.spec.ts`).
Steps 1 to 3 walked live as far as reCAPTCHA allows (the slot-1 stack has real keys and refuses automated browsers).
**Task:** "Create an account for yourself."

1. Go to `/login` and choose the Register tab.
2. Enter email, password (at least 8 characters) and the same password again; choose "Create account".
3. Expect a success message saying a verification link was emailed and that sign-in is impossible until it is followed.
4. Open the emailed link, which lands on `/verify-email`; expect confirmation.
5. Sign in (A2).

Branches: mismatched passwords ("Passwords do not match"), short password, an email already registered, an expired or reused link.
Depends on: reCAPTCHA (bypassed locally), Resend.
Covered by: `auth.spec.ts` ("Register new user"), `account-links.spec.ts`, `a-signup-is-sent-once.spec.ts`, `sign-in-fits-a-phone.spec.ts`.

## A1a. Resend the verification email

**Status:** Works (code; `POST /resend-verification`).
From the verification page, ask for another link.
A sign-in refused because the address is not verified yet offers "Send the link again" too (A2), which says "If that address needs verifying, a new link is on its way." whatever the address (E38/F14/S02).

## A2. Sign in and sign out

**Status:** Works (walked live).
**Task:** "Sign in, then sign out."

1. At `/login`, Sign in tab, enter email and password, choose "Sign in".
   "Remember me" under the password is unticked: the sign-in then ends when the browser closes, and at the latest 12 hours after it; ticked, it lasts 30 days from signing in, however the browser is used.
   Either way it lasts only as long as the browser's address and the browser stay the same: a phone that moves from the venue's wifi to cellular is signed out, an E47 follow-up ([the cookies](../../implementation/conventions/security-invariants.md#the-cookies)).
2. Expect the dashboard (`/dashboard`), or the page the address carried in `next` (E38/F11/S01).
3. Choose "Sign out" on the dashboard or in the navigation menu ([C4](finding-a-market.md#c4-the-navigation-menu)); expect `/login`.

Branches: wrong password, unverified account, "Show" password toggle, visiting an organizer URL while signed out (redirects to `/login`, which returns there after signing in), visiting `/login` while signed in (redirects to that `next`, else the dashboard).
A market link opened while signed out returns there after sign-in, by password or by code, rather than to the dashboard.
A session that ends mid-work lands on sign-in saying "Your session has ended. Sign in again.", and signing in returns to the page it was on.
A browser closed and reopened is signed out unless "Remember me" was ticked.

Each form says one line at a time, the newer replacing the older, and says what to do next (E38/F14/S02):

- A wrong password and an address with no account say the same, "That email and password do not match.", with "Forgot password?" in it (A4).
- A right password on an account not yet verified says "Verify your email address first: we sent you a link when you registered.", with "Send the link again" (A1a).

Covered by: `auth.spec.ts`, `smoke.spec.ts`, `sign-in-fits-a-phone.spec.ts`, `a-failure-says-what-to-do.spec.ts`, `remember-me.spec.ts`, `the-sign-in-says-what-to-do-next.spec.ts`.

## A3. Sign in with an emailed code

**Status:** Works as far as it can be walked without a mailer (walked live).

1. At `/login`, choose the "Sign-in code" tab, enter email, choose "Send code".
2. Enter the code from the email, tick "Remember me" or leave it, and choose "Sign in"; the choice is the Sign in tab's, kept between the two (A2).
3. "Use a different email" returns to step 1.

Branches: a wrong code ("That code is not right."), which replaces the line saying the code was sent, and which a code for an address with no account answers too, up to the fifth try; too many wrong codes; an account not yet verified, which says to verify first and offers "Send the link again", as A2 does.
Covered by: `auth.spec.ts` ("shows error for invalid OTP code") and `the-sign-in-says-what-to-do-next.spec.ts`, which stub the send and walk only a wrong code; `a-failure-says-what-to-do.spec.ts` and `remember-me.spec.ts`, which stub the send and set the code where the server keeps it, then sign in with it; `sign-in-fits-a-phone.spec.ts`.

## A4. Reset a forgotten password

**Status:** Works; a signed-out person reaches the form at step 2 since bug 22 was fixed (`auth.spec.ts`, `account-links.spec.ts`).

1. At `/login`, choose "Forgot password?"; enter email on `/reset-password-request`.
2. Follow the emailed link to `/reset-password`, set a new password; every browser signed in to the account, remembered or not, is signed out.
3. Sign in with the new password.

Covered by: `auth.spec.ts` ("Password reset"), `account-links.spec.ts`, `sign-in-fits-a-phone.spec.ts`.

## A5. Delete my account

**Status:** No screen (`POST /delete-user` exists; nothing in the front end calls it).

Its specs and gaps are in [walking the flows](../../implementation/testing/walking-the-flows.md#coverage-map).
