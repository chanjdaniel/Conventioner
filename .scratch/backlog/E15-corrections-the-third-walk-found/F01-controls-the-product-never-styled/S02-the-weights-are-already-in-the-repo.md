---
id: E15/F01/S02
title: The weights are already in the repo
type: story
status: ready
blocked_by: []
pr: []
---

## What to build

`front-end/src/assets/main.css` declares exactly two `@font-face` rules, one weight each, neither carrying a `font-weight` descriptor:

```css
@font-face { font-family: 'Merge One';      src: url('/fonts/MergeOne-Regular.ttf'); }
@font-face { font-family: 'Outfit Regular'; src: url('/fonts/Outfit/static/Outfit-Regular.ttf'); }
```

At runtime `document.fonts` confirms one face per family, both `weight: normal`.
The source asks for a heavier weight **65 times**: `500` x27, `600` x24, `bold` x14, plus `100` x2.
With no matching face the browser synthesises the weight by smearing the regular outline, which is why emphasis across the product reads as muddy rather than crisp.

`front-end/public/fonts/Outfit/static/` already ships Medium, SemiBold and Bold, and `public/fonts/Outfit-VariableFont_wght.ttf` covers the whole axis. Nothing needs downloading or licensing.

Two parts:

- **Rename the family to `Outfit`.** The current name puts a *weight* in the *family* slot, which is why nobody added the other weights. This touches every `font-family` declaration naming `'Outfit Regular'`, so do it with `S01`'s deletions rather than twice.
- **Declare the weights the product asks for**, with `font-weight` descriptors - either the variable font across `100 900`, or static Regular and SemiBold. Then collapse the requested weights onto the two the design language names: `400` and `600`. `500` is indistinguishable from `400` at these sizes, and `700` is heavier than this type wants.

See `docs/design-system.md`, "Type / Weight".

## Acceptance criteria

- [ ] `document.fonts` reports a real face for every weight the product requests; no weight is synthesised.
- [ ] Only `400` and `600` are requested. The `100` declarations are gone - nothing lighter than regular is loaded and browsers do not synthesise thin, so those two render as regular today and say something they do not mean.
- [ ] The family is `Outfit`. `'Outfit Regular'` appears nowhere.
- [ ] A test pins the loaded faces, so removing a `@font-face` cannot silently reintroduce synthesis.

## Notes

Startable now. Pairs with `S01`.
Evidence: `.lavish/aesthetics-2026-09-20.html`, H16.
