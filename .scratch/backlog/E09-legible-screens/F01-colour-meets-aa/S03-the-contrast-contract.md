---
id: E09/F01/S03
title: The contrast contract
type: story
status: done
blocked_by: []
pr: [69]
---

## What to build

A unit test in the existing vitest suite that parses `front-end/src/assets/base.css` and asserts:

- every token whose name marks it as **text on light** reaches 4.5:1 against white and against
  `--mm-beige`;
- every token whose name marks it as **text on dark** reaches 4.5:1 against `--mm-black`;
- white text on every token used as a **fill** reaches 4.5:1.

**The token's name is the declaration.** That is the decision
([ticket 03](../../../wayfinding/readable-journey/issues/03-contrast-contract-on-tokens.md)): a
sidecar map or comment convention is a second artifact that can disagree with the CSS, and a lint
rule would have to infer which background each usage sits on, which is the hard problem. Naming
makes it declarative.

**Parse the real CSS.** Do not move the tokens into TypeScript for the test's convenience - the CSS
stays the single source of truth, and a test that reads the shipped file cannot drift from it.

## Acceptance criteria

- [ ] The test fails if any text token is lowered below its threshold.
- [ ] The test fails if a new text-named token is added below threshold.
- [ ] Border and fill tokens are exempt from the text rule, and the test says why in a comment.
- [ ] It runs in the existing `npm run test:unit`, needing no new tooling.

## Notes

This is the pattern the repo already trusts: `_validate_registry()` in `guards.py` refuses a phase
table that disagrees with itself at import, and `test_the_local_development_template_boots_as_it_stands`
runs the shipped env template through the real boot check.
