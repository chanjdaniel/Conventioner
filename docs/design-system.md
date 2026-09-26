# Conventioner's design language

This file is the single statement of what Conventioner looks like.
It exists because the product did not have one: 12,211 lines of CSS across 71 scoped `<style>` blocks, each re-deciding radius, spacing, type and colour from scratch.
The evidence is `.lavish/aesthetics-2026-09-20.html`; the decisions were taken on 2026-09-20.

A value not in this file does not belong in a component.
`front-end/src/assets/base.css` is where these become tokens, and the checks in `E16/F01` are what keep them there.

## How this was decided

Two halves, decided differently, and it matters which is which.

- **The card idiom was extracted, not invented.** The screens `E09` through `E13` built had already converged on something coherent - 6px controls, 10px cards, a three-layer shadow, 12px gaps. That is written down below as it was found.
- **The type and spacing scales were authored.** There was nothing to extract: 24 font sizes using essentially every integer from 11px to 20px, and 32 spacing values, means no file ever chose a *step* - they each chose a pixel.

Consequence, accepted when this was decided: **conforming to the scales changes screens that currently look fine.** Roughly 116 declarations at 13px and 15px have to be re-homed one at a time, by judgement. A caption and a dense table cell are both 13px today and want different answers.

## Type

Two families, and only two.

| Role | Family | Notes |
| --- | --- | --- |
| Headings | `Merge One` | Deep descenders; never give it a tight line box. |
| Everything else | `Outfit` | The product's real UI face. |

**The family is `Outfit`, not `Outfit Regular`.** The old name put a *weight* in the *family* slot, which is why nobody added the other weights: `public/fonts/Outfit/static/` ships Medium, SemiBold and Bold, and `public/fonts/Outfit-VariableFont_wght.ttf` covers the whole axis, and none of them were ever declared. 65 declarations asked for 500, 600 or bold and got a browser-synthesised smear of the regular.

`Inter` is retired. `body` declared it while 354 component rules named a face of their own - 274 Outfit, 80 Merge One - so Inter survived in 2 rules and in the one place nothing overrode it: form controls, which do not inherit `font-family` and fell through to the user agent's Arial instead.

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

Nothing below 12px. The product currently ships 10px and 8px body text, which is below any readable minimum.

### Weight

`400` and `600` only, both as real loaded faces. `500` reads as 400 at these sizes and just doubles the number of things to keep in step; `700` is heavier than this type wants.

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

The largest migration cost is here: **10px is the second most-used spacing value in the product (87 uses)** and is on no grid. Each one goes to 8 or 12 by judgement.

## Layout

Decided by [claims-and-room ticket 01](../.scratch/wayfinding/claims-and-room/issues/01-how-an-organizer-screen-sizes-itself.md), which holds the measurements.

**A screen is a card of one of two widths that grows to its content while the page scrolls.**
No screen caps its own height, and no row carries a minimum height.

| Token | Value | Screens |
| --- | --- | --- |
| `--workspace-max` | 1440px | Every market page and flow: Market Setup to Attendance, Import, Floorplan |
| `--list-max` | 1100px | Markets, Organizations |

Two widths rather than one because the content clusters into two groups and **nothing wants the 1536 the workspace currently gets**: the plan's widest row needs 1316, the statistics need 1129, and the single-column lists need ~1035. One width for both puts a 1,035px list in a 1,440px page.

**1440 rather than the content-only answer of 1360** because that is the phase rail's measured break - below it the rail wraps to a second row on a published market. `readable-journey` ticket 06 had already put that break "between 1366 and 1440"; it is exactly 1440.

**Every market screen is one width, and `MarketFrame` sets it** (E22/F04/S01, from [the-assignment-tab ticket 02](../.scratch/wayfinding/the-assignment-tab/issues/02-how-every-market-screen-is-reached.md)).
Tables, Vendors and Attendance used to be `--list-max`, so moving between a market's screens made the frame jump 340px, cut the market's name, and wrapped the rail to a second row on the narrow ones.
A screen that stands in the frame sets no width of its own.
The market's name is whole wherever it fits beside the tabs, and ellipsed with its full name on hover only where it does not.

**A screen of cards is a two-track grid** (E23/F01/S01, from [the-plan-uses-its-space ticket 01](../.scratch/wayfinding/the-plan-uses-its-space/issues/01-the-row-rule.md)).
It is `.card-grid` in `primitives.css`; a screen reaches for it rather than laying out its own rows.

- **A card is half width unless it declares itself wide** (`.card-grid__wide`). One declaration per card, so the next card added decides nothing else.
- **A card ends at its own content.** Two cards in a row do not stretch to match, and the next row starts under the taller: blank space inside a card reads as something missing.
- **Below `--card-grid-one-track` (900px) of room it is one track**, in the cards' own order. The break follows the room the grid has, not the window.
- **Cards are `--card-grid-gap` apart, and every card has the same inner gutter**, set by the card, never by what it holds.

On the plan, Market Dates and Section Setup are wide (Section Setup's columns need 654px, and at half width its tier select truncated); Tier Setup sits beside Location Setup, and How vendors apply beside Application form.
Two other rules were prototyped and rejected: two columns by purpose truncated the tier select at 1280, and packing cards by content width changed the screen's shape with the window.

**A market screen's frame stays put** (E21/F04, from [the-market-frame ticket 01](../.scratch/wayfinding/the-market-frame/issues/01-how-the-frame-stays-put.md)).
`MarketFrame` pins the screen's bar and the whole phase rail directly under the app banner, at `top: var(--banner-h)`, while the page scrolls; whatever the rail grows is pinned with it.
`--banner-h` (`clamp(30px, 5vh, 100px)`) is the banner's height as a token, so nothing measures the banner at run time.
A frame screen never scrolls inside its card: a sticky element inside an `overflow` ancestor stops sticking.

**Columns are sized by need, not by count.** `repeat(3, minmax(0, 1fr))` is what makes the Tier select 65px wide and unable to display any of the three values it offers, while giving Location Setup 1.7x what it needs. The codebase already accepts this: `.plan-row--asymmetric` is `3fr 2fr`.

## Radius

Extracted from the newer screens. Three values.

| Token | Value | Use |
| --- | --- | --- |
| `--radius-control` | 6px | Buttons, inputs, selects, small chips |
| `--radius-card` | 10px | Cards, panels, dialogs |
| `--radius-pill` | 999px | Pills and fully-rounded badges |

"Fully rounded" is currently spelled four ways (`999px`, `100px`, `30px`, `20px`). One spelling.

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

`--mm-green` measures 4.59:1 on white and **4.43:1 on the phase rail's `#FBFBFA`**, where it is the current-phase label on every market screen. A token is only AA on the grounds it was measured against. Either the ground becomes white or the label takes a darker value.

## The primitive layer

Tokens alone cannot fix what is actually wrong. A `--radius-control` does not stop a file writing `height: 45px`, and the concentrated damage is exactly there: five control heights on the login screen, ten on Market Setup, four disabled treatments, two designs for the same `Manage` button.

Three primitives own height, padding, radius, type, focus and the disabled state. They live in `front-end/src/assets/primitives.css`, and `src/__tests__/primitives.test.ts` is the reference a migration checks against.

| | Variants | Notes |
| --- | --- | --- |
| `.btn` | `--primary`, `--secondary`, `--destructive`, `--compact` | One standard height (36px) and one compact (28px), and no third. 36px was already the most-used height in the product; 34, 38 and 40 were the same button drawn by four people. |
| `.field` | `--select`, `--textarea` | Left-aligned always - 18 of 27 controls on Market Setup were centred. `--select` carries `min-width: min-content`, which is what stops a grid track squeezing a select below its own longest option. |
| `.chip` | `--neutral`, `--positive`, `--attention`, `--informational`, `--destructive` | One shape, one size, sentence case. Tint with coloured ink rather than a solid fill: a list of six solid pills competes with the content it labels. |

**One disabled state**, and it does not rely on text contrast: the control keeps a readable foreground and loses its affordance, so it reads as unavailable rather than as unreadable. The product had four, one of which put white on `--mm-border` at 1.74:1.

**A focus ring on every primitive**, in `--mm-black` rather than the brand green - it has to be visible against the control's own fill too, and a green ring on the green primary button is invisible. The product has 65 keyboard-reachable controls and had no consistent focus treatment at all.

They were built in `E16/F04`, deliberately **after** `E16/F03` rewrote Market Setup, so they had a real consumer rather than a layout about to be replaced. **Nothing migrated onto them in that feature**: `E16/F05`-`F08` move one surface at a time.

## What keeps this true

A convention nothing enforces is how the product got here. Three checks, in `E16/F01` and `E16/F02`:

1. **Stylelint** bans raw hex, raw `font-size` and raw `border-radius` outside `base.css` and the primitive files.
2. **A custom-property resolution check** fails the build when any `var(--x)` references a property nothing defines. This is the one that matters: `var(--mm-text-red)` is not a raw value, it is a well-formed reference to nothing, and it rendered the market-archive confirmation button as white text on a white dialog with no border for as long as it existed. Stylelint cannot see that.
3. **A rendered-usage contrast sweep** in the Playwright suite walks each screen and fails on any text node below its AA threshold. The token test stays as well - it fails in milliseconds with a precise message when `base.css` changes, where the sweep would only say "something on the Applications screen went dark".

The sweep is only worth the states it walks. The invisible archive button was missed by a twenty-screen pass because nobody opened that dialog; **dialogs, menus and empty states have to be walked deliberately.**
