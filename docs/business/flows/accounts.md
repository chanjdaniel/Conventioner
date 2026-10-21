---
layer: business
kind: flow
verified: 2026-10-21
sources:
  - E26/F01/S01
  - E32/F03/S04
  - bug/22
  - bug/44
---

# Accounts

**Who:** an organizer, or someone about to become one; vendors have no account (they sign in per market with a code, [H3](applying-online.md#h3-vendors-apply-online)).
**Where they start:** `/login`, which has three tabs: Sign in, Register and Sign-in code.
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
Covered by: `auth.spec.ts` ("Register new user"), `account-links.spec.ts`, `a-signup-is-sent-once.spec.ts`.

## A1a. Resend the verification email

**Status:** Works (code; `POST /resend-verification`).
From the verification page, ask for another link.

## A2. Sign in and sign out

**Status:** Works (walked live).
**Task:** "Sign in, then sign out."

1. At `/login`, Sign in tab, enter email and password, choose "Sign in".
2. Expect the dashboard (`/dashboard`).
3. Choose "Sign out" on the dashboard or in the navigation menu ([C4](finding-a-market.md#c4-the-navigation-menu)); expect `/login`.

Branches: wrong password, unverified account, "Show" password toggle, visiting an organizer URL while signed out (redirects to `/login`), visiting `/login` while signed in (redirects to the dashboard).
A market link opened while signed out lands on the dashboard after sign-in, not on the market.
Covered by: `auth.spec.ts`, `smoke.spec.ts`.

## A3. Sign in with an emailed code

**Status:** Works as far as it can be walked without a mailer (walked live).

1. At `/login`, choose the "Sign-in code" tab, enter email, choose "Send code".
2. Enter the code from the email and choose "Sign in".
3. "Use a different email" returns to step 1.

Branches: a wrong code ("That code is not right"), too many wrong codes.
Covered by: `auth.spec.ts` ("shows error for invalid OTP code"), which stubs the send and walks only a wrong code.

## A4. Reset a forgotten password

**Status:** Works; a signed-out person reaches the form at step 2 since bug 22 was fixed (`auth.spec.ts`, `account-links.spec.ts`).

1. At `/login`, choose "Forgot password?"; enter email on `/reset-password-request`.
2. Follow the emailed link to `/reset-password`, set a new password.
3. Sign in with the new password.

Covered by: `auth.spec.ts` ("Password reset"), `account-links.spec.ts`.

## A5. Delete my account

**Status:** No screen (`POST /delete-user` exists; nothing in the front end calls it).

Its specs and gaps are in [walking the flows](../../implementation/testing/walking-the-flows.md#coverage-map).
