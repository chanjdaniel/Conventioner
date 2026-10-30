---
layer: implementation
kind: convention
describes:
  - front-end/src/assets/base.css
  - front-end/src/assets/primitives.css
  - front-end/src/assets/main.css
  - front-end/stylelint.config.js
  - front-end/src/__tests__/spacingScale.test.ts
  - front-end/e2e/contrast-sweep.spec.ts
  - front-end/e2e/accessibility-sweep.spec.ts
  - front-end/e2e/layout-sweep.spec.ts
  - front-end/e2e/focus-sweep.spec.ts
  - front-end/e2e/layout-detectors.spec.ts
  - front-end/e2e/helpers/screens.ts
  - front-end/e2e/helpers/layoutDetectors.ts
verified: 2026-10-30
sources:
  - wayfinding/claims-and-room/map
  - wayfinding/claims-and-room/01
  - wayfinding/claims-and-room/07
  - wayfinding/readable-journey/03
  - wayfinding/readable-journey/06
  - wayfinding/readable-journey/map
  - wayfinding/the-assignment-tab/02
  - wayfinding/the-plan-uses-its-space/01
  - wayfinding/the-market-frame/01
  - wayfinding/the-market-frame/map
  - wayfinding/the-order-of-the-work/map
  - wayfinding/the-plan-uses-its-space/map
  - E16
  - E15/F01/S01
  - E17/F01
  - E22/F04/S01
  - E26/F07
  - E26/F10/S01
  - E09/F01
  - E21/F04
  - E35/F03/S01
  - E21/F04/S01
  - E28/F03/S01
  - E28/F04/S02
  - E15/F01/S02
  - T15
  - T45
  - T73
  - T75
  - T81
  - T79
  - T82
  - E38/F01/S01
---

# Conventioner's design language

This file is the single statement of what Conventioner looks like.
It exists because the product did not have one: 12,211 lines of CSS across 71 scoped `<style>` blocks, each re-deciding radius, spacing, type and colour from scratch.
The evidence is `.lavish/aesthetics-2026-09-20.html`; the decisions were taken on 2026-09-20.

A value not in this file does not belong in a component.
The product had no shared component layer, and that was the root cause of everything aesthetic: at the walk, 17 radius declarations, 24 font sizes, 32 spacing values, and 351 hardcoded hex colours against 704 token uses.
Do not add a 72nd set of local decisions: reach for the tokens and the primitives.
[`front-end/src/assets/base.css`](../front-end/src/assets/base.css) is where these become tokens, [`front-end/src/assets/primitives.css`](../front-end/src/assets/primitives.css) holds the primitives, and the checks in `E16/F01`, among them the Stylelint rules of [`front-end/stylelint.config.js`](../front-end/stylelint.config.js), are what keep them there.

## How this was decided

Two halves, decided differently, and it matters which is which.

- **The card idiom was extracted, not invented.** The screens `E09` through `E13` built had already converged on something coherent - 6px controls, 10px cards, a three-layer shadow, 12px gaps. That is written down below as it was found.
- **The type and spacing scales were authored.** There was nothing to extract: 24 font sizes using essentially every integer from 11px to 20px, and 32 spacing values, means no file ever chose a *step* - they each chose a pixel.

That distinction matters when something looks off: a screen that disagrees with the card idiom is a bug, while one that disagrees with a scale is code not yet migrated.

Consequence, accepted when this was decided: **conforming to the scales changes screens that currently look fine.** Roughly 116 declarations at 13px and 15px were re-homed one at a time, by judgement, because a caption and a dense table cell both sat at 13px and want different answers.
None is left.

## Type

Two families, and only two.

| Role | Family | Notes |
| --- | --- | --- |
| Headings | `Merge One` | Deep descenders; never give it a tight line box. |
| Everything else | `Outfit` | The product's real UI face. |

Both ship as WOFF2 from `front-end/public/fonts/`, converted losslessly from Google Fonts' TTFs with the variable `wght` axis kept; a new face ships as WOFF2 too.

**The family is `Outfit`, not `Outfit Regular`.** The old name put a *weight* in the *family* slot, which is why nobody added the other weights: static Medium, SemiBold and Bold files shipped alongside the variable Outfit, which covers the whole axis, and none of them were ever declared. The variable face (`public/fonts/Outfit-VariableFont_wght.woff2`) is the only Outfit that ships now; the unused statics are gone. 65 declarations asked for 500, 600 or bold and got a browser-synthesised smear of the regular.

`Inter` is retired. `body` declared it while 354 component rules named a face of their own - 274 Outfit, 80 Merge One - so Inter survived in 2 rules and in the one place nothing overrode it: form controls, which do not inherit `font-family` and fell through to the user agent's Arial instead.

**Form controls do not inherit `font-family`.**
The reset in [`front-end/src/assets/main.css`](../front-end/src/assets/main.css) gives `button`, `input`, `select` and `textarea` `font: inherit`, which lands on Outfit only because `body` names it: the same reset while `body` declared Inter would have made every control Inter and left the Outfit rules around them as they were, so `body` became Outfit first (E15/F01/S01).
`font` is a shorthand and carries `line-height` too, and a control's height is its line box, so the reset pairs it with `line-height: normal`.

Of those 274 Outfit declarations, 273 only restated what `body` now says and are gone; the surviving one opts a chip back out of a heading that sets Merge One around it. `front-end/src` went from 363 `font-family` declarations to 92.

### The scale

Six steps. Adjacent 1px steps are not distinguishable, so they carry no meaning - they only let two screens disagree.

| Step | Size | Use |
| --- | --- | --- |
| `--text-xs` | 12px | Captions, metadata, table labels, chips |
| `--text-sm` | 14px | Body, form fields, buttons, list rows |
| `--text-md` | 16px | Lead paragraphs, emphasis within body |
| `--text-lg` | 20px | Section headings, card titles |
| `--text-xl` | 26px | Page and screen titles |
| `--text-2xl` | 32px | Display figures - the assignment summary's numbers |

Nothing below 12px, which is the readable minimum.
No `font-size` in `front-end/src` is smaller.

### Weight

`400` and `600` only, both as real loaded faces. `500` reads as 400 at these sizes and just doubles the number of things to keep in step; `700` is heavier than this type wants.

**Weight does not inherit here.**
The global reset in `base.css` gives every element `font-weight: 400`, so a span inside a 600 cell is 400 until it says otherwise.

## Spacing

A 4px grid, seven steps, plus one exception.

| Token | Value |
| --- | --- |
| `--space-1` | 4px |
| `--space-2` | 8px |
| `--space-3` | 12px |
| `--space-4` | 16px |
| `--space-6` | 24px |
| `--space-8` | 32px |
| `--space-12` | 48px |

**The one exception is a 2px hairline**, for gaps between an icon and its label or between two lines of the same field. It is not a step and nothing should be laid out on it.

The largest migration cost was here: **10px was the second most-used spacing value in the product (87 uses)** and is on no grid, so each one went to 8 or 12 by judgement.
The migration was called done while `src` still declared raw 10px, 6px and 5px well over a hundred times, because nothing refused one; since T81 Stylelint does (below).
A badge or pill pads `--space-hairline` by `--space-2`, as the chip primitive does, and a notice pads `--space-2` by `--space-3`.
A raw pixel that is not spacing, such as a tab's `-1px` margin over a border, carries a `stylelint-disable-next-line` that says so.

**What a margin, a padding or a gap may be**, as [`stylelint.config.js`](../front-end/stylelint.config.js) builds it (T81, tightened in T82):

- `0`, a `--space-*` token, `--space-hairline`, `--card-grid-gap` or `--banner-h`, each value set apart by whitespace.
- In `calc()`, a negated token (`calc(-1 * var(--space-2))`) or a sum of tokens (`calc(var(--space-12) + var(--space-12))`), and nothing else: a bare number makes a raw size, `calc(var(--space-1) * 1.5)` is 6px.
- A phone's safe area, `env(safe-area-inset-*)`, on its own, in a sum (`calc(var(--space-4) + env(safe-area-inset-bottom))`), or as the larger of it and a token (`max(var(--space-4), env(safe-area-inset-left))`); `max()`, `min()` and `clamp()` take only these values.
- `auto` on a margin only, where it centres; on a padding or a gap it is invalid.
- A percentage on a padding only, which keeps a box's proportions as it scales.
- A CSS-wide keyword (`inherit`, `initial`, `unset`, `revert`, `revert-layer`) as the whole value.

A legitimate value it refuses widens the patterns in `stylelint.config.js`, with an example in `spacingScale.test.ts`, rather than a disable comment.

## Layout

Decided by claims-and-room ticket 01, which holds the measurements.

**A screen is a card of one of two widths that grows to its content while the page scrolls.**
No screen caps its own height, and no row carries a minimum height.
The market screen's `height: 80%`, which pinned it to most of the window and hid half of it, was scaffolding from that view's first commit, never a decision, and went with the rest.
`.app-container` used to be `position: absolute; height: 100vh`, which is why no screen could scroll the page and every tall screen grew nested scrollers of its own; do not reintroduce a viewport-height shell.

**The organizer's screens are designed for 1920x1080**, and since T79 the [layout sweep](#what-keeps-this-true) also measures them at 1440x900; no other width is a requirement new work is held to (wayfinding/readable-journey/06).
The public check-in page is the carve-out: it is not an organizer screen, it is held in a hand at a door, and it works on a phone ([attendance and the door](implementation/modules/attendance-and-door.md#sharp-edges)).
The [account pages](business/flows/accounts.md) are the way to it, so they work on a phone too: sign in with its tabs, both password-reset pages and email verification stand in one `AuthCard`, 600px wide at most, with a 16px page gutter at each side, and `sign-in-fits-a-phone.spec.ts` fails on any of them that scrolls sideways at 390px (T73).

| Token | Value | Screens |
| --- | --- | --- |
| `--workspace-max` | 1440px | Every market page and flow: Market Setup to Attendance, Import, Floorplan |
| `--list-max` | 1100px | Markets, Organizations |

The applicant's own pages are a reading column, not a screen of cards: `--applicant-max` (640px), the apply page and the applicant's dashboard.
The form tab's preview is drawn at the same width, so it is the form as an applicant sees it (E33/F01/S01).

Two widths rather than one because the content clusters into two groups and **nothing wants the 1536 the workspace was given before**: the plan's widest row needs 1316, the statistics need 1129, and the single-column lists need ~1035. One width for both puts a 1,035px list in a 1,440px page.

**1440 rather than the content-only answer of 1360** because that is the phase rail's measured break - below it the rail wraps to a second row on a published market. `readable-journey` ticket 06 had already put that break "between 1366 and 1440"; it is exactly 1440.

**Every market screen is one width, and `MarketFrame` sets it** (E22/F04/S01, from the-assignment-tab ticket 02).
Tables, Vendors and Attendance used to be `--list-max`, so moving between a market's screens made the frame jump 340px, cut the market's name, and wrapped the rail to a second row on the narrow ones.
A screen that stands in the frame sets no width of its own.
The market's name is whole wherever it fits beside the tabs, and ellipsed with its full name on hover only where it does not.

**A screen of cards is a two-track grid** (E23/F01/S01, from the-plan-uses-its-space ticket 01).
It is `.card-grid` in `primitives.css`; a screen reaches for it rather than laying out its own rows.
It is one written rule rather than a rearrangement per screen: the design language named two widths and said nothing of how cards share a row, which is why every plan card once had a row to itself, and a local fix per card would leave the next card to decide again.

- **A card is half width unless it declares itself wide** (`.card-grid__wide`). One declaration per card, so the next card added decides nothing else.
- **A card ends at its own content.** Two cards in a row do not stretch to match, and the next row starts under the taller: blank space inside a card reads as something missing.
- **Below `--card-grid-one-track` (900px) of room it is one track**, in the cards' own order. The break follows the room the grid has, not the window.
  The plan never reaches it on an organizer's screen: at the app's 1000px floor it has 920px of room and keeps two tracks.
- **Cards are `--card-grid-gap` apart, and every card has the same inner gutter**, set by the card, never by what it holds.
- **A column divider inside a card is one 1px `--mm-border` line**, on the plan's Tier, Location and Section Setup and its Pricing card, and on the Assignment tab's options and rules alike, so the two screens draw their tables the same way.

On the plan, Market Dates, Section Setup and Pricing are wide (Section Setup's columns need 654px, and at half width its tier select truncated; Pricing's columns are the tiers); Tier Setup sits beside Location Setup, and How vendors apply beside Application form ([planning the market](business/flows/planning.md)).
Two other rules were prototyped and rejected: two columns by purpose truncated the tier select at 1280, and packing cards by content width changed the screen's shape with the window.

**A market screen's frame stays put** (E21/F04, from the-market-frame ticket 01).
`MarketFrame` pins the screen's bar and the whole phase rail directly under the app banner, at `top: var(--banner-h)`, while the page scrolls; whatever the rail grows is pinned with it.
`--banner-h` (`clamp(30px, 5vh, 100px)`) is the banner's height as a token, so nothing measures the banner at run time; it is the clamp the banner already came to rather than one pixel height, which would have changed the banner's size at every other window height.
The frame's own pinned block is the one thing that is measured: it grows with whatever the rail shows, so no token could state it.
`MarketFrame` measures it and publishes `--market-frame-h` on its card (declared as `0px` in `base.css`, which is what it is outside a frame), and a screen's own sticky column - the proposal ledger's rail - sits at `top: calc(var(--banner-h) + var(--market-frame-h))`.
A frame screen never scrolls inside its card: a sticky element inside an `overflow` ancestor stops sticking.

**The frame places itself** (E26/F10/S01).
The page gutter, the card's width and corners, and what is shown until the market arrives belong to `MarketFrame`, never to the screen inside it.
Each screen used to pad itself, so one market's frame sat at x 0, 16 or 32 depending on the page, and the page behind it was white on some and beige on others; it is white.
The root keeps the scrollbar's room (`scrollbar-gutter: stable`), so a page taller than the window is not 15px narrower than one that is not.
**Inside the card, every page insets its content `--space-6`**, the rail's own inset, so the rail, the frame's read-only note and the page's first card start on one line.
Market Setup's four tabs each padded themselves 40px, so there the frame's note sat 16px left of the cards it explained (T15).

**The rail is one row at the workspace width.**
Its public address is the one part that gives way: it shortens, and the link, its hover text and Copy keep it whole.
Where the row cannot hold the addresses and the actions beside the spine, they take the second row together, never one button alone (claims-and-room ticket 07).

**Columns are sized by need, not by count.**
Three equal tracks (`repeat(3, minmax(0, 1fr))`) made the Tier select 65px wide and unable to display any of the three values it offers, while giving Location Setup 1.7x what it needs.
The assignment tab's `.plan-row--asymmetric` is `3fr 2fr` for the same reason.

## Radius

Extracted from the newer screens. Three values.

| Token | Value | Use |
| --- | --- | --- |
| `--radius-control` | 6px | Buttons, inputs, selects, small chips |
| `--radius-card` | 10px | Cards, panels, dialogs |
| `--radius-pill` | 999px | Pills and fully-rounded badges |

"Fully rounded" has one spelling, `--radius-pill`.
It was spelled four ways (`999px`, `100px`, `30px`, `20px`); one `20px` is left, in the floorplan beta.

## Elevation

One shadow, extracted from the newer screens, where it is already used 77 times on a single screen.

```css
--shadow-card:
  0 0 0 1px rgba(0, 0, 0, 0.07),
  0 2px 4px rgba(0, 0, 0, 0.07),
  0 6px 14px rgba(0, 0, 0, 0.08);
```

**The legacy halo is retired**: `0 0 4px 5px rgba(0,0,0,.25)` and its inset twin. A shadow with no offset has no light source, and a spread larger than its blur is a ring, not a shadow - which is why the older cards read as outlined in grey fog. The inset variant is what makes the setup fields look pressed and skeuomorphic.

## Colour

`base.css` remains the owner and its existing comments remain authoritative: **a token whose name says it carries text must reach WCAG AA (4.5:1) on the grounds it appears on**, and `src/__tests__/contrast.test.ts` asserts it.
WCAG AA is the product's stated standard, held over the whole palette rather than the colours someone happened to measure; raising the muted grey changed the texture of every screen, and that was accepted (wayfinding/readable-journey/map).
The product has one theme, light: nothing in `front-end/src` answers `prefers-color-scheme`, so a pair is held on the grounds it is drawn on, white and the beige of a hovered row among them, and a dark theme, when there is one, is a palette of its own to check.

### The contrast contract

**A colour token's name is its declaration**: a token named as text (`--mm-text-*`, `--mm-black`, `--color-text`) is ink, held to AA on each ground it is set on, and a token that only paints a line or a fill is exempt.
The roles are told apart by name rather than by a sidecar map, which could disagree with the CSS, or a lint rule, which would have to infer which ground each usage sits on.
So a colour used both ways is two tokens: the old `--mm-grey` (alpha 0.25) is `--mm-border` for lines and `--mm-text-muted` (alpha 0.63, 4.63:1 on white) for secondary text.
The contract says which values are text and holds those to AA; it does not raise every value, and a border keeps its 0.25.

**Ink on light and ink on dark are separate families** (`--mm-text-muted` and `--mm-text-muted-on-dark`), because contrast belongs to a pair: one muted grey cannot serve white and the near-black bar both, and two families make white text on a white page unwritable.
Where the beige card needs a darker ink than white does, that is a token of its own (`--mm-text-muted-on-beige`).
It also serves Result's muted text inside a table row, which can sit on an empty table's yellow ground (`--mm-yellow` at 0.18 over white, `.table-row--empty`) or a hovered seat's beige: there `--mm-text-muted` reads 4.38 and 4.23, and `--mm-text-muted-on-beige` 5.42 and 5.19, so a change to the yellow, the beige or the token is measured on those grounds too.

**Fills carry the reciprocal check**: each fill declares the ink it is legible under, white on `--mm-green`, `--mm-red` and `--mm-blue`, `--mm-black` on `--mm-yellow` and `--mm-beige`.
That check is what made the brand green darker rather than leaving each button to a judgement call.

**A mark that carries no text is held to the non-text bar, 3:1**: the bar's current-tab dot, `--mm-green` on `--mm-black`, measures 3.39:1, and the test pins it, so a bar retinted darker or a green lightened for a light ground cannot take it under unnoticed.

[`src/__tests__/contrast.test.ts`](../front-end/src/__tests__/contrast.test.ts) parses the real `base.css`, so the file that ships is the file under test, and lists every colour token as ink, fill, chip ground or line; a colour token in none of those lists fails it, so a new colour must declare itself.

### Added

Both are desaturated, which is what lets them sit beside `--mm-green`. Every saturated candidate (the Material reds, the two badge blues) looks borrowed next to it.

| Token | Value | White text on it | Replaces |
| --- | --- | --- | --- |
| `--mm-red` | `#c0392b` | 5.44:1 | nine hardcoded reds, 77 occurrences |
| `--mm-blue` | `#1a6f8b` | 5.69:1 | two badge blues; same hue as `--mm-text-link` |

`--mm-red` and `--mm-text-red` were both **referenced but never defined** - see `E16/F01`. `var(--mm-red, #cc0000)` carried 24 usages on its fallback, which is how `#cc0000` became the most-used red in the product without anyone choosing it.

Three of the reds being retired cannot carry white text at all: `#e74c3c` (3.82), `#f44336` (3.68, the Reject button) and `#e53935` (4.23).

### The brand green is `--mm-green` (`#36826f`)

The wordmark painted `#00DC82` while every primary button painted `#36826f`. `#00DC82` gives white text 1.7:1, so it can never be a button or a link - a brand colour the product would be forbidden from using on any control. The logo is restyled to `--mm-green`.

### Two grounds, not one

`--mm-green` measures 4.59:1 on white and **4.43:1 on the off-white `#FBFBFA`**, and it is the current-phase label on every market screen.
A token is only AA on the grounds it was measured against, so the phase rail's ground is white (E16/F01/S03).

So a chip carries its own ground: the `--mm-chip-*` tokens are opaque, the tint already laid over white, and `contrast.test.ts` asserts each with its ink.
Translucent tints took on the beige review card beneath them and fell below AA there (E26/F10/S01).

## The primitive layer

Tokens alone cannot fix what is actually wrong. A `--radius-control` does not stop a file writing `height: 45px`, and the concentrated damage is exactly there: five control heights on the login screen, ten on Market Setup, four disabled treatments, sixty button-ish class names, two designs for the same `Manage` button.

Three primitives own height, padding, radius, type, focus and the disabled state. They live in `front-end/src/assets/primitives.css`, and `src/__tests__/primitives.test.ts` is the reference a migration checks against.
Reach for a primitive rather than deciding again.
They and `AppDialog` are the app's components: it installs no component library, and a widget too hard to own starts from a headless one styled with these tokens ([ADR 0015](adr/0015-the-app-owns-its-components.md)).
Two smaller controls had no owner either, each re-decided per file, and are primitives of their own: `.add-row`, the button that adds a row to a plan card (it was an icon with a click handler, unreachable from a keyboard), and `.drag-handle`, the control that reorders a row (E17/F01).

| | Variants | Notes |
| --- | --- | --- |
| `.btn` | `--primary`, `--secondary`, `--destructive`, `--compact` | One standard height (36px) and one compact (28px), and no third, both 44px on a phone. 36px was already the most-used height in the product; 34, 38 and 40 were the same button drawn by four people. |
| `.field` | `--select`, `--textarea` | Left-aligned always - 18 of 27 controls on Market Setup were centred. `--select` carries `min-width: 0`: a select fills its column and never pushes past it, in Firefox as in Chromium. A column that must fit a select's options sizes its own track. |
| `.chip` | `--neutral`, `--positive`, `--attention`, `--informational`, `--destructive` | One shape, one size, sentence case. Tint with coloured ink rather than a solid fill: a list of six solid pills competes with the content it labels. The tint is an opaque `--mm-chip-*` ground, so a chip reads the same on beige as on white. A status is a chip; the action beside it is a button. |

**On a phone every target is 44px**, the size a thumb wants (T82).
The heights are tokens in `base.css`: `--control-height` (36px) for `.btn`, `.field` and `.add-row`, `--control-height-compact` (28px) for `.btn--compact`, and `--target-min` (24px, WCAG 2.5.8's floor), the least any other target may be: a tab, a link on its own line, a Show toggle, a Copy button, a choice's label.
At `width <= 640px`, the market frame's phone break, all three are 44px and the banner is at least that tall, so a control that takes its height from a token is a thumb's size there with nothing of its own; a bespoke control takes `min-height: var(--target-min)` (and `min-width` where it is narrow) rather than a phone rule of its own.
The one exception is `.answer-link--alone`, an answer that is only a link: it takes that minimum in a phone rule, since on a desk the same link sits in a review card's line and a 24px box would move the rows.
A desk keeps its denser 36px and 28px.

**One disabled state**, and it does not rely on text contrast: the control keeps a readable foreground and loses its affordance, so it reads as unavailable rather than as unreadable. The product had four, one of which put white on `--mm-border` at 1.74:1.

**A field shows no focus at all**, by Daniel's decision on the 2026-10-29 walk (E38/F01/S01): no outline, ring, glow, or border or fill change on any `input`, `textarea` or `select`, by click or by Tab, and a text field shows its caret.
A browser treats a focused text field as `:focus-visible` whether it was clicked or tabbed into, so no rule could keep a ring for the keyboard alone, and Daniel chose this knowing a keyboard user loses it too; an accessibility pass does not put it back.
`primitives.css` sets `outline: none` on every focused field, so the browser's own outline does not appear either, and no component draws a ring around a field's box (`:focus-within`).

**A soft halo on every control**, Daniel's choice on the same walk (E38/F01/S01): `--focus-halo`, a white 2px gap then a translucent green glow, in `base.css`.
`primitives.css` gives it to the primitives and to every link, button, `summary`, `[role='button']` and `[tabindex='0']` on `:focus-visible`, with no outline, so the browser's own ring is drawn nowhere.
The white gap is what keeps it visible on the green primary button, where a green glow would meet the fill.
A control on a dark ground (the market bar's tabs, the vendor drawer's close) takes `--focus-halo-on-dark`, white at 35%, drawn inside the tab on a phone (`--focus-halo-on-dark-inset`), where the tabs scroll sideways on the bar's lower edge and the scroller would clip it; a component rule that gives a control a resting `box-shadow` outranks the shared rule, so it says `var(--focus-halo), <its shadow>` itself; and a market card wears the halo for its name, whose own box clips it.
Measured, the green glow is 1.58:1 against white and 1.50:1 against beige, below the 3:1 WCAG asks of a focus indicator by Daniel's choice of look, since 3:1 takes about 77% green on white and 87% on beige, no longer a soft halo; the white gap is 4.59:1 against the green button's fill; and the dark halo is 3.17:1 on `--mm-black`, raised from the prototype's 28% (2.53:1), which looked the same.

They were built in `E16/F04`, deliberately **after** `E16/F03` rewrote Market Setup, so they had a real consumer rather than a layout about to be replaced. **Nothing migrated onto them in that feature**: `E16/F05`-`F08` move one surface at a time.

## What keeps this true

A convention nothing enforces is how the product got here. Six checks, the first three in `E16/F01` and `E16/F02`:

1. **Stylelint** bans raw hex, raw `font-size`, raw `border-radius` and a raw `box-shadow` outside `base.css` and the primitive files.
   It holds every `margin*`, `padding*`, `gap`, `row-gap` and `column-gap` to the spacing scale with `declaration-property-value-allowed-list`, by the values the [Spacing](#spacing) section lists, and [`spacingScale.test.ts`](../front-end/src/__tests__/spacingScale.test.ts) runs the real config over what it allows and refuses.
   `npm run lint:css` is the design-language gate, and it is **warnings globally, errors per migrated file** (`MIGRATED` in `stylelint.config.js`): a rule that fails the build on a pre-existing backlog gets switched off, so a slice adds its files to that list when it lands.
   Everything MVP serves is on the list, the applicant views included since vendors apply online (E26/F07); the 264 remaining warnings are the floorplan GUI, a beta, 148 of them spacing.
2. **A custom-property resolution check**, `src/__tests__/everyTokenResolves.test.ts`, fails the build when any `var(--x)` references a property nothing defines. This is the one that matters: `var(--mm-text-red)` is not a raw value, it is a well-formed reference to nothing, and it rendered the market-archive confirmation button as white text on a white dialog with no border for as long as it existed. Stylelint cannot see that.
   **Never write `var(--mm-x, #fallback)`**, and the same test refuses one: a fallback on a defined token is a second definition waiting to drift, and on an undefined one it hides the bug.
3. **A rendered-usage contrast sweep**, [`e2e/contrast-sweep.spec.ts`](../front-end/e2e/contrast-sweep.spec.ts), walks each screen and fails on any text node below its AA threshold. The token test stays as well - it fails in milliseconds with a precise message when `base.css` changes, where the sweep would only say "something on the Applications screen went dark".
   `contrast.test.ts` asserts tokens, not usages, and that gap has been occupied: a token exempt from the contract because it never carries text (`--mm-border`) was used as a button fill under white text at 1.74:1.
4. **An accessibility sweep**, [`e2e/accessibility-sweep.spec.ts`](../front-end/e2e/accessibility-sweep.spec.ts), runs axe (`@axe-core/playwright`) over the same states and fails on any WCAG 2.0, 2.1 or 2.2 A or AA violation it can see, naming each one's rule, impact and target.
   Its configuration is the `expectAccessible` fixture in `e2e/fixtures.ts`, which also holds the app to exactly one `main` landmark; axe's `color-contrast` rule is off there, since the contrast sweep owns contrast and one defect should fail one check.
   It landed with what it found fixed (T75): an empty `<html lang>`, no `main` landmark, a market row that was a `role="button"` around its own Manage button, a calendar marked as an ARIA grid with no rows, an unnamed close button on the navigation drawer, and buttons whose `aria-label` replaced the words on them ([every control is named](implementation/conventions/every-control-is-named.md#the-rules)).
   An automated check finds some WCAG failures, not all of them: a pass is a floor, not a verdict.
5. **A layout sweep**, [`e2e/layout-sweep.spec.ts`](../front-end/e2e/layout-sweep.spec.ts), measures every state at each size it ships at (1920x1080 and 1440x900 for an organizer's screen; 1920x1080 and 390x844 for a public page; all three for a route with `meta.fitsAPhone`) with the detectors in [`e2e/helpers/layoutDetectors.ts`](../front-end/e2e/helpers/layoutDetectors.ts) (T79, from T67's trial).
   It fails on the kinds that raised nothing false over the whole app: the page or an element past the window, a child outside its parent, text clipped by its box, text or controls drawn over each other in one layer, text squeezed into a column (three or more lines of ten characters or fewer), type off the type scale, and a tap target under 44px on a phone, a control's visible label counting toward its target.
   Each failure names the state, the size, the element and the measurement.
   It also fails when the market bar stands at a different x or width on one market screen than on the others of its size, which no screen can see alone (bug 12), and when it found the bar on fewer than two market screens of one size, so a renamed test id cannot leave that check passing on nothing.
   The sweep landed gating a phone target at WCAG 2.5.8's 24px, with about 75 phone controls under 44px (36px buttons and fields, 28px day buttons on phone attendance), and T82 raised them to 44px through the tokens above and the gate with them.
   The noisy kinds (spacing off the scale, uneven gaps, edges 1 to 4px apart, empty bands, truncated names, nested scrollers, small targets on a desktop) are real drift mixed with what is by design, so each test attaches them as a `layout report` and never fails on them; the spacing scale is Stylelint's to hold.
   [`e2e/layout-detectors.spec.ts`](../front-end/e2e/layout-detectors.spec.ts) proves each gating detector fires on a fixture of its defect, and that none fires on a page that only looks broken: a stuck bar over scrolled content, screen-reader-only text, an ellipsis with its title, a closed `<details>`, a menu over the page.
   It landed with what it and the newly walked states found fixed: the form's step list hung 8px outside its header, a long web address in an answer ran 108px past a phone, the sign-in and reset fields and their Show buttons were 20px and 15px tall inside their 36px boxes, the standalone back links and the rail's addresses were 18px and 19px tall, and on states the other sweeps had never opened, role badges and "Results Published" on translucent tints, the import's hint on beige, the verification error in raw `red`, an unmarked link in a note, and the start page's coloured words on black.
6. **A focus sweep**, [`e2e/focus-sweep.spec.ts`](../front-end/e2e/focus-sweep.spec.ts), presses Tab through every state (E38/F01/S01).
   A field it lands on must look as it did unfocused, it and the two boxes around it, and a control must draw no outline and the halo for its ground: white at 35% where the first ancestor with a fill is dark, the green halo elsewhere.
   It landed with what it found fixed: the seat buttons' and the drawer tabs' own rings, and the buttons whose own `box-shadow`, `none` included, outranked the halo: the dashboard's and the start page's, New market, New organization, the vendor rows, and the floorplan's Save & Continue and Sections buttons.
   It needed the floorplan wizard walked at each step with a plan uploaded, which the other sweeps then walked too, and they found the beta's step labels below AA on their beige, its progress bar with no name and an invalid value, its empty table types in a 40% grey, and its Export PNG button named something other than its words; all are fixed.

The sweeps are only worth the states they walk. The invisible archive button was missed by a twenty-screen pass because nobody opened that dialog, and T67's layout trial missed the dashboard's squeezed dates until it opened a market before the dashboard; **dialogs, menus, drawers, hover states, disabled controls, empty states and remembered state have to be walked deliberately.**
All four sweeps walk one list, `SCREENS` in [`e2e/helpers/screens.ts`](../front-end/e2e/helpers/screens.ts), through `walkTheScreens()`, and each passes only its own check, so a state added for one is walked by all.
The list holds the router's routes, the dialogs, menus and drawers, the dashboard with a market remembered, every phase, settled rules, the floorplan wizard's steps with a plan uploaded and the signed-out pages, over a stress seed ([`e2e/helpers/seedTheScreens.ts`](../front-end/e2e/helpers/seedTheScreens.ts)) of long names, 40 applications in every review state and 36 vendors over four dates and three sections, since a layout that holds on three short names breaks on a real market.
Contrast and axe measure each state at its first size; the layout sweep at every size.

## Evidence

The contrast contract rests on an audit that measured every colour on the grounds the product paints on (wayfinding/readable-journey/03): four text colours failed, `--mm-yellow` at 2.15:1, `--mm-grey` at 1.67, `--mm-green` at 2.65 and the hard-coded `#2196F3` link at 3.12, with `--vt-c-text-light-2` a near miss at 4.06; `--mm-grey` was text at 18 sites and a border or fill at 57, which is what made splitting it cheap.

## Superseded

- White text on `--mm-yellow` was to reach AA like every other fill (wayfinding/readable-journey/03); yellow is a black-text fill, and the contract asserts white is never put on it (E09/F01).
- `--list-max` was to hold a market's Tables, Vendors and Attendance (wayfinding/claims-and-room/01); every market screen is the workspace width, set by the frame (E22/F04/S01).
- A row's panels were to stay even by stretching to the tallest (`align-items: stretch`), which is why no minimum row height was needed (wayfinding/claims-and-room/01); a card ends at its own content in the card grid (E23/F01/S01).
- Every primitive was to show a 2px `--mm-black` focus ring at 2px of offset, fields included (E16/F04); a field shows no focus and a control the soft halo (E38/F01/S01).
