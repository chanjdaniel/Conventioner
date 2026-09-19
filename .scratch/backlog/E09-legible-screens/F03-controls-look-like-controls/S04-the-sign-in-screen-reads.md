---
id: E09/F03/S04
title: The sign-in screen reads
type: story
status: in-progress
blocked_by: []
pr: []
---

## What to build

The first screen anyone sees, and the only one a new organizer meets before they trust the product.

- **Three words for one action on one screen**: the tab says "Login", the heading says "Sign in", the button says "Login" - in a product that says "Sign out" everywhere else.
- **Placeholder-only labels**, including Register's "Password (min 8 characters)", so the rule vanishes exactly when you start typing it.
- **The submit button is a full pill** while every other button in the product is a rounded rectangle, and the fields between them are square.
- **"Forgot password?" is Material blue `#2196F3`**, the only blue in the product, at 3.14:1 on white.
- **"Invalid credentials"** is developer language, right-aligned against a left-aligned form, with no `role="alert"`, and it does not point at the reset link sitting directly below it.
- **Confirm password has no Show toggle** though Password does.
- **Nothing tells a new user they must verify by email** before the account works, and there is no reCAPTCHA attribution.
- **The signed-out header's logo sits at x=8** where the signed-in header puts it at x=53.
- **The drawer's "Sign Out" is a bare `<h3>` in a `<div>`** with `tabIndex -1` - not a button, not a link, not focusable.
  A keyboard user cannot sign out from the drawer.
  Both sign-out controls are also marked up as headings, which puts them in the document outline.

## Acceptance criteria

- [ ] One verb for signing in, matching the one used for signing out.
- [ ] Every field has a persistent label; constraints stay visible while typing.
- [ ] The submit button matches the product's button shape, and the link colour meets AA.
- [ ] The error is left-aligned with the form, carries `role="alert"`, says what to do, and points at password reset.
- [ ] Registration states that a verification email follows.
- [ ] Both sign-out controls are buttons, focusable, and not headings.
