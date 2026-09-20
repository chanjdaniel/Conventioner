---
id: E15/F01
title: Controls the product never styled
type: feature
status: ready
blocked_by: []
pr: []
---

## Outcome

Every button, field and select renders in the product's own typeface at a real weight, and every column of figures lines up down the page.

## Why now

Form controls do not inherit `font-family`, and only five rules in the whole codebase say `inherit` - so the user agent's Arial is the typeface of most controls in the product, including every control on the first screen an organizer sees.
Separately, the two `@font-face` rules load one weight each, while 65 declarations ask for 500, 600 or bold, so every emphasis in the product is a browser-synthesised smear of the regular.

Neither carries a decision and both are visible on first contact.
The font weights in particular are already in the repository, unused.
