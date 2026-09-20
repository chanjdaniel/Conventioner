---
id: E16/F05
title: Slice: the auth screens
type: feature
status: blocked
blocked_by: [E16/F04]
pr: []
---

## Outcome

Sign in, Register, Sign-in code, the two password-reset screens and email verification are on the design language.

## Scope

`LoginView`, `PasswordResetRequestView`, `PasswordResetView`, `EmailVerificationView`, `InitView`.

**This slice goes first.** Three of these files have never been covered by any walk, they are the first screens any organizer sees, and they carry the worst case in the report: three typefaces and five control heights on one screen, a 60px submit button where the rest of the product uses 34-38px, 20px input text against 13px labels, and a card wearing both a 1px border and a 5px-spread halo. It is also the smallest slice, which makes it the right place to find out whether the primitives are right.

## Done means

- Every control on these screens comes from a primitive; no local height, padding, radius or shadow.
- Type and spacing on these screens are on the scale in `docs/design-system.md`.
- Stylelint's rules are flipped from warning to **error** for these files (`E16/F02/S02`).
- The contrast sweep covers these screens, including their dialogs and empty states.
- A before/after screenshot pair is attached to the PR, because this is the kind of change a diff does not show.
