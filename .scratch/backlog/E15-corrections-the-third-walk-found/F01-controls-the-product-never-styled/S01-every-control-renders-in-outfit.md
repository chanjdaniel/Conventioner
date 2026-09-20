---
id: E15/F01/S01
title: Every control renders in Outfit
type: story
status: in-progress
blocked_by: []
pr: []
---

## What to build

`<button>`, `<input>`, `<select>` and `<textarea>` do not inherit `font-family` from their ancestors; the user agent sets it.
Only five rules in `front-end/src` say `font-family: inherit`, so most controls in the product render in **Arial** while the text around them renders in Outfit.

Measured on `/login`, which is the first screen any organizer sees: the three mode tabs, both inputs, the Show toggle, the menu button and the close button are all Arial; the submit button is Outfit; the sign-out button is Inter. Three typefaces on one screen. Two of those controls render at `13.3333px`, the browser's own default, which is the tell that they have never been styled at all.

**The obvious one-line fix is wrong.** Adding `font: inherit` on controls alone makes them all render **Inter**, because that is what `body` declares - while the 274 Outfit rules around them stay Outfit. The fix is two steps, in this order:

1. `body` declares Outfit. It is already the product's real UI face: 274 declarations against Inter's 2. Inter is retired from `base.css` along with the stack it carried.
2. Controls take `font: inherit` (the shorthand, so size and weight come along too, not just the family).

Then delete the per-file `font-family: 'Outfit Regular'` declarations that exist only to undo the default. Do not delete the ones on headings - those are Merge One.

See `docs/design-system.md`, "Type".

## Acceptance criteria

- [ ] No element in the product computes a `font-family` of Arial, Times New Roman, or any other user-agent default. A unit or e2e assertion walks `/login`, `/markets`, `/market-setup` and the check-in page and fails on any such computed value.
- [ ] `body` declares Outfit; `Inter` appears nowhere in `front-end/src`.
- [ ] Every control on `/login` reports the same `font-family` as its surrounding text.
- [ ] Per-file `font-family` declarations that only restated the default are gone, so the count of `font-family` declarations drops rather than holding steady.

## Notes

Startable now.
Pairs with `S02`, which loads the weights this story's type will ask for; either can land first, but the product does not look right until both have.
Evidence: `.lavish/aesthetics-2026-09-20.html`, H2.
