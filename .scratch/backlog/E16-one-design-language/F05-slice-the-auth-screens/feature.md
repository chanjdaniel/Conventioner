---
id: E16/F05
title: Slice: the auth screens
type: feature
status: in-progress
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

## Done

All five files carry zero stylelint warnings, and the rules are **errors** for them now
(`.stylelintrc.json` `overrides`) - which is what turns the backlog into a shrinking number rather
than one everybody stops reading. Product-wide: 1140 warnings -> 1082.

What changed, beyond swapping literals for tokens:

- **The submit buttons became `.btn btn--primary`,** full-width. They were 60px tall with 20px text
  and, on the reset screens, a 30px-radius pill - the auth screens' own dialect. Full-width is what
  gives a page's primary action presence without inventing a fourth button height.
- **The composite field wears `.field`'s metrics rather than the class**, because `.login-input`
  holds the input *and* the Show toggle. 60px and a 3px border became 36px and 1px.
- **`blue` and `green` were not tokens.** The focus state was `border-color: blue`; it is now the
  primitives' own ring, which is visible against the page as well as the field.

Verified by screenshot at 1400x1000, not only by the linter: the login and reset screens now read
as the same product, which was the point of taking this slice first.
