# 03: Do the design tokens carry a contrast contract?

Type: grilling
Status: resolved
Blocked by: -

## Question

WCAG AA is now this product's stated standard, and the palette audit is `E09` work.
This ticket is about whether anything stops the next token from failing.

Two tokens were measured against the live build and both fail:

- `--mm-grey: rgba(39,35,35,.25)` composites to roughly `#C9C9C9` on white: **1.66:1**, against AA's 4.5:1 for body text and 3:1 even for large text.
  It is used as a `color:` value in 18 places, and as a border or background in 57.
  (Corrected 2026-09-19 while resolving this; the original count of 65 matched `border-color:` and
  `background-color:` too.)
- `--mm-green: #49b096` behind white button labels and as 18px text on white: **2.65:1**.
  That is every primary button in the product, including the one a vendor taps at a market entrance.

And one is not a token at all: the phase strip's "Current Phase:" label is `rgba(255,255,255,.7)` on a transparent panel over a white page.
It is rendered, positioned, 93x22px, and invisible.

**The difficulty is that `--mm-grey` is legitimately correct as a border at 0.25 and illegitimate as text.**
A test over the token file cannot tell those apart unless the file says which surface each token is for.
So the decision is not "should there be a test" but "what would a token have to declare for a test to be possible", and whether that declaration is worth the weight.

The options, roughly:

1. Nothing. Audit once, fix, move on, accept that the third walk finds the yellow one.
2. A documented token table in the repo: each token, its computed contrast against the surfaces it is used on, and the rule.
3. A test over the token file that fails when a token used as text drops below 4.5:1 - which requires (2)'s declaration to exist first.
4. A lint rule over the stylesheets, which needs no declaration but has to understand usage.

This repo already has the habit of a check that refuses at load: `_validate_registry()` in `guards.py` refuses a phase table that disagrees with itself at import, and `test_the_local_development_template_boots_as_it_stands` runs the shipped env template through the real boot check.
Whether a palette deserves the same treatment is the question.

Report findings: **S1**, **S2**, **S3**.

## Answer

**The token's name is the declaration, and a unit test enforces it.**

### The audit, which this ticket needed before it could decide anything

Measured against the surfaces the product actually paints on:

| Token | on white | on beige | white on it | used as text | used as fill/border |
| --- | --- | --- | --- | --- | --- |
| `--mm-black` `#272323` | 15.54 | 12.49 | 15.54 | 151 | 13 |
| `--mm-green` `#49b096` | **2.65** | **2.13** | **2.65** | 18 | 61 |
| `--mm-yellow` `#e4a629` | **2.15** | **1.72** | **2.15** | 4 | 15 |
| `--mm-beige` `#e9e6e1` | 1.24 | 1.00 | 1.24 | 0 | 35 |
| `--mm-grey` `rgba(39,35,35,.25)` | **1.67** | **1.34** | **1.67** | 18 | 57 |
| `#2196F3` (link, hardcoded) | **3.12** | 2.51 | - | - | - |
| `--vt-c-text-light-2` `rgba(60,60,60,.66)` | **4.06** | 3.26 | - | - | - |

**Four text colours fail, not the two that were measured when this was charted.**
`--mm-yellow` at **2.15** is the worst in the product and had been flagged only as "unmeasured".
`--vt-c-text-light-2` at **4.06** is a near-miss nobody would catch by eye.

**Correction carried in from the report:** `--mm-grey` was described as used as `color:` in 65
places. That count matched `border-color:` and `background-color:` too.
The real split is **18 text uses against 57 border and background uses** - it is overwhelmingly a
border colour that 18 sites borrow as text, which is what makes the fix below cheap.

### The name is the declaration

The ticket's premise was that a test cannot distinguish `--mm-grey` correct-at-0.25-as-a-border from
`--mm-grey` wrong-as-text, because nothing records a token's role.
The usage data says the roles are separable, and the separation is free because it has to happen
anyway:

- `--mm-grey` splits into **`--mm-border`** (0.25, unchanged, 57 sites) and **`--mm-text-muted`**
  (**alpha 0.63**, composites to `#777474`, ratio **4.63**, 18 sites).
- A token whose name says it is text must pass. A border token is exempt.

A sidecar map or comment convention was the alternative, and it adds a second artifact that can
disagree with the CSS. The name cannot disagree with itself.

### Two families, because contrast is a property of a pair

Text in this product sits on three grounds - white, `--mm-beige`, and the near-black header - and
white text sits on two fills.

**On-light and on-dark are separate token families.**
Requiring one muted grey to work on both grounds is impossible without compromising both, and
pretending otherwise is exactly how `PhaseControlPanel` came to paint `rgba(255,255,255,.7)` on a
white page. Two families makes that bug unwritable.

Fills carry the reciprocal check: **white text on `--mm-green` and on `--mm-yellow` must pass**, and
today neither does. That is what forces a darker green variant rather than leaving it to a
judgement call per button.

### A unit test, not a lint rule

Parsing `base.css` and asserting the matrix, in the vitest suite that already exists.

A lint rule would have to infer which background each usage sits on, which is the hard problem; the
naming convention makes that declarative instead, so the test needs only the token values and the
rule. Roughly thirty lines.

It is the pattern this repo already trusts: `_validate_registry()` refuses a phase table that
disagrees with itself at import, and `test_the_local_development_template_boots_as_it_stands` runs
the shipped env template through the real boot check.

**Parse the CSS rather than moving tokens into TypeScript.**
The CSS stays the single source of truth, and a test that reads the real file cannot drift from what
ships.

### Scope note

`--mm-grey` at 0.25 is *correct* as a border and is not changed.
This is not "raise every value"; it is "say which values are text, and hold those to AA".

Buildable work: `.scratch/backlog/E09-legible-screens/F01-colour-meets-aa/`.
