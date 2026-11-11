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
  - front-end/e2e/contrast-measure.spec.ts
  - front-end/e2e/helpers/contrastSweep.ts
  - front-end/e2e/focus-sweep-detectors.spec.ts
  - front-end/e2e/helpers/focusSweep.ts
  - front-end/e2e/a-links-halo-appears-at-once.spec.ts
  - front-end/src/assets/brand/
  - front-end/src/__tests__/theBrandHasOneFolder.test.ts
  - front-end/scripts/brand-icons.ts
  - front-end/index.html
  - front-end/public/manifest.webmanifest
  - front-end/src/components/icons/
  - front-end/src/__tests__/everyIconIsUsed.test.ts
  - front-end/src/components/FileDropZone.vue
  - front-end/src/components/FilterToggles.vue
  - front-end/src/components/ListFrame.vue
  - front-end/src/components/CodeInput.vue
  - front-end/e2e/the-code-field.spec.ts
  - front-end/src/components/NameList.vue
  - front-end/src/components/OrderedList.vue
  - front-end/src/components/RowGroup.vue
  - front-end/src/components/SidePanel.vue
  - front-end/src/components/BarLedger.vue
  - front-end/src/utils/useFold.ts
  - front-end/e2e/no-in-app-scroll-bar.spec.ts
  - front-end/src/__tests__/everyScrollerIsAScrollBox.test.ts
  - front-end/e2e/a-focused-button-moves-nothing.spec.ts
  - front-end/src/components/ChoiceField.vue
  - front-end/src/components/application/LongQuestion.vue
  - front-end/src/components/PagedList.vue
  - front-end/src/utils/useGroupFolds.ts
  - front-end/src/components/AuthCard.vue
verified: 2026-11-10
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
  - E38/F08/S03
  - E38/F05/S01
  - T123
  - T142
  - T148
  - E38/F15/S01
  - T181
  - T180
  - T212
  - T205
  - T200
  - T211
  - T202
  - T213
  - T221
  - T204
  - T209
  - T217
  - T214
  - T223
  - T224
  - T229
  - T263
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
- **The type and spacing scales were authored.** There was nothing to extract: 24 font sizes using essentially every integer from 11px to 20px, and 32 spacing values, means no file ever chose a _step_ - they each chose a pixel.

That distinction matters when something looks off: a screen that disagrees with the card idiom is a bug, while one that disagrees with a scale is code not yet migrated.

Consequence, accepted when this was decided: **conforming to the scales changes screens that currently look fine.** Roughly 116 declarations at 13px and 15px were re-homed one at a time, by judgement, because a caption and a dense table cell both sat at 13px and want different answers.
None is left.

## Type

Two families, and only two.

| Role            | Family      | Notes                                            |
| --------------- | ----------- | ------------------------------------------------ |
| Headings        | `Merge One` | Deep descenders; never give it a tight line box. |
| Everything else | `Outfit`    | The product's real UI face.                      |

Both ship as WOFF2 from `front-end/public/fonts/`, converted losslessly from Google Fonts' TTFs with the variable `wght` axis kept; a new face ships as WOFF2 too.

**The family is `Outfit`, not `Outfit Regular`.** The old name put a _weight_ in the _family_ slot, which is why nobody added the other weights: static Medium, SemiBold and Bold files shipped alongside the variable Outfit, which covers the whole axis, and none of them were ever declared. The variable face (`public/fonts/Outfit-VariableFont_wght.woff2`) is the only Outfit that ships now; the unused statics are gone. 65 declarations asked for 500, 600 or bold and got a browser-synthesised smear of the regular.

`Inter` is retired. `body` declared it while 354 component rules named a face of their own - 274 Outfit, 80 Merge One - so Inter survived in 2 rules and in the one place nothing overrode it: form controls, which do not inherit `font-family` and fell through to the user agent's Arial instead.

**Form controls do not inherit `font-family`.**
The reset in [`front-end/src/assets/main.css`](../front-end/src/assets/main.css) gives `button`, `input`, `select` and `textarea` `font: inherit`, which lands on Outfit only because `body` names it: the same reset while `body` declared Inter would have made every control Inter and left the Outfit rules around them as they were, so `body` became Outfit first (E15/F01/S01).
`font` is a shorthand and carries `line-height` too, and a control's height is its line box, so the reset pairs it with `line-height: normal`.

Of those 274 Outfit declarations, 273 only restated what `body` now says and are gone; the surviving one opts a chip back out of a heading that sets Merge One around it. `front-end/src` went from 363 `font-family` declarations to 92.

### The scale

Six steps. Adjacent 1px steps are not distinguishable, so they carry no meaning - they only let two screens disagree.

| Step         | Size | Use                                                |
| ------------ | ---- | -------------------------------------------------- |
| `--text-xs`  | 12px | Captions, metadata, table labels, chips            |
| `--text-sm`  | 14px | Body, form fields, buttons, list rows              |
| `--text-md`  | 16px | Lead paragraphs, emphasis within body              |
| `--text-lg`  | 20px | Section headings, card titles                      |
| `--text-xl`  | 26px | Page and screen titles                             |
| `--text-2xl` | 32px | Display figures - the assignment summary's numbers |

Nothing below 12px, which is the readable minimum.
No `font-size` in `front-end/src` is smaller.

### Weight

`400` and `600` only, both as real loaded faces. `500` reads as 400 at these sizes and just doubles the number of things to keep in step; `700` is heavier than this type wants.

**Weight does not inherit here.**
The global reset in `base.css` gives every element `font-weight: 400`, so a span inside a 600 cell is 400 until it says otherwise.
The one exception is bold text: `base.css` gives `strong` and `b` 600 after the reset, so a bare `<strong>` is bold without a rule of its own.

## Spacing

A 4px grid, seven steps, plus one exception.

| Token        | Value |
| ------------ | ----- |
| `--space-1`  | 4px   |
| `--space-2`  | 8px   |
| `--space-3`  | 12px  |
| `--space-4`  | 16px  |
| `--space-6`  | 24px  |
| `--space-8`  | 32px  |
| `--space-12` | 48px  |

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
The floorplan GUI, a beta, is the exception: each value of its own off the scale carries a disable comment with its reason (T221), and bringing one onto the scale is a change to what it draws.

## Layout

Decided by claims-and-room ticket 01, which holds the measurements.

**A screen is a card of one of two widths that grows to its content while the page scrolls.**
No screen caps its own height, and no row carries a minimum height.
The market screen's `height: 80%`, which pinned it to most of the window and hid half of it, was scaffolding from that view's first commit, never a decision, and went with the rest.
`.app-container` used to be `position: absolute; height: 100vh`, which is why no screen could scroll the page and every tall screen grew nested scrollers of its own; do not reintroduce a viewport-height shell.

**The organizer's screens are designed for 1920x1080**, and since T79 the [layout sweep](#what-keeps-this-true) also measures them at 1440x900; no other width is a layout requirement new work is held to (wayfinding/readable-journey/06), though the focus sweep walks every state at a phone's width but those marked `deskOnly` ([what keeps this true](#what-keeps-this-true)).
The vendor page, where vendors check in, is the carve-out: it is not an organizer screen, it is held in a hand at a door, and it works on a phone ([attendance and the door](implementation/modules/attendance-and-door.md#sharp-edges)).
The [account pages](business/flows/accounts.md) are the way to it, so they work on a phone too: sign in with its tabs, both password-reset pages and email verification stand in one [`AuthCard`](../front-end/src/components/AuthCard.vue), 600px wide at most, with a 16px page gutter at each side, and `sign-in-fits-a-phone.spec.ts` fails on any of them that scrolls sideways at 390px (T73).
`the-sign-in-fits-a-small-phone.spec.ts` holds the sign-in's tabs and fields inside their column and their boxes at 320px, at 390px and at a desk (T211).
Some organizer places lift the desktop floor too, by `meta.fitsAPhone`, each with the dialogs, menus and drawers that open over it; listed in the router's order, one place a line:

- `/markets`, where sign-in lands on the way to the door, and the way to the market an organizer runs from it (T142, T148);
- Organizations, the app bar's other place (T148);
- the Applications page, the one page of Market Setup's view that fits, with the vendor drawer and Update info over it, where a late application is decided from a phone ([the review](business/flows/review.md)) (T180);
- the Assignments page, where the vendor drawer's "Change assignment" at the door leads ([placements](implementation/modules/placements.md)) (T142);
- Vendors, with the [vendor drawer](business/flows/vendor-drawer.md), Update info and the payment dialogs, where a vendor is looked up, paid and corrected from the door ([vendors](business/flows/vendors.md)) (T180);
- Payments, where who still owes is read on market day ([payments](business/flows/payments.md)) (T180);
- Attendance, the door on market day ([attendance and the door](implementation/modules/attendance-and-door.md#sharp-edges));
- the Tools tab, where an organizer may connect Discord from a phone (Daniel, T113);
- Stats, where how the day stands is read at the market ([the market's statistics](business/flows/stats.md)) (T180);
- the page Discord sends them back to, an `AuthCard` measured with the account pages;
- a location's layout, read at the venue and edited at a desk ([the layout page](implementation/modules/floorplan-placement.md#the-layout-page)) (T257).

The setup screens keep the floor, since they are built at a desk before the market and the form builder is drawn for a pointer; one a line:

- Market Setup's plan, a page of the same view as the Applications page, which alone lifts the floor (`meta.fitsAPhone` names the page);
- the form builder;
- Settings, the assignment rules;
- the import;
- start-from-CSV.

`/markets` on a phone narrows its gutter to 16px, as the door does, and its finder's fields and phase toggles wrap; a market's card stacks its facts and Manage under its name, which keeps one line and its ellipsis.
Its "Previously opened" line stays one 44px row at every width, the words, the name cut with an ellipsis and a chevron, and drops its phase badge at 640px and below so the name keeps the room; the note that a remembered market has gone and the first-time message are a `.note`, wrapping to the column.
A summary card stacks so whenever it is narrower than its name, its facts and its Manage need side by side (45rem), so a card at 768px stacks too rather than pushing Manage past its edge (T148).
The Assignments page on a phone narrows its gutter to 16px too: its summary's figures stack, one to a 44px row, and its actions wrap under them; the filters stand in the page's flow rather than pinned, each filling its row and two sharing one where both fit; a half table's two seats stand one under the other, each seat's Change a 44px target; and a dialog's buttons wrap rather than run past its window.
Vendors on a phone narrows its gutter to 16px too: the search takes its row with the "Show only" filters, Export and Add a vendor wrapping beneath it, and a vendor's row stacks the name over its chips, which wrap where the Discord state, the badge, "Added" and the date count are wider together than the row.
Its Discord row stacks as [the Vendors flow](business/flows/vendors.md) lays it out: the filter, then its actions, each from the line's start.
The Applications page on a phone narrows its gutter to 16px too: the All view's row is one column, read down, the applicant's name and address, the leading answers, then the status chip and its lines, each the row's width; each row's tick stands in a 44px square beside it, and "Mine" is its label's 44px row; the views switch's and the status filters' buttons are never narrower than the target's minimum, at every width, so 44px wide at least on a phone.
One by one's card is the page's width, its verdict buttons wrapping inside it; "Show N reviewed" opens its list in a dialog, which leaves the card where it is; "Include the N follow-ups", "Show N reviewed", "Choose what leads the card" and each tick in the dialog it opens are 44px targets, and a reviewer's label in the reviewers picker is a 44px row.
Payments on a phone narrows its gutter to 16px too: the search takes its row with the "Show only" filters wrapping beneath it, the market's four figures stand two to a row, and each table lays its rows out as blocks, its row heading (the tier, the date or the vendor) on a line of its own and each value on a line beside its column's heading, since neither table's columns share 343px; the vendors' headings stay above as a row of sort buttons, each a 44px target.
Stats on a phone narrows its gutter to 16px too: its headlines stand one to a line, each a 44px row and each link a 44px target, the money set apart from the placements by a rule above it rather than beside it; the answer groups' switch's buttons are never narrower than the target's minimum, at every width, so 44px wide at least on a phone, and the cards stand one to a row, narrower than their 18rem where the window is, as on a 320px phone.
[Organizations](business/flows/organizations.md) on a phone narrows its gutter to 16px, as `/markets` does, and "New organization" keeps one line, wrapping under the title only when the two cannot share the row; in Manage organization each person's address takes a line of its own with the role and Remove beneath it, and an add row's email field takes the row with Add and Cancel beneath it.

| Token             | Value  | Screens                                                                   |
| ----------------- | ------ | ------------------------------------------------------------------------- |
| `--workspace-max` | 1440px | Every market page and flow: Market Setup to Attendance, Import, Floorplan |
| `--list-max`      | 1100px | Markets, Organizations                                                    |

The applicant's own pages are a reading column, not a screen of cards: `--applicant-max` (640px), the vendor page, its application form included.
The form tab's preview is drawn at the same width, so it is the form as an applicant sees it (E33/F01/S01).

Two widths rather than one because the content clusters into two groups and **nothing wants the 1536 the workspace was given before**: the plan's widest row needs 1316, the statistics need 1129, and the single-column lists need ~1035. One width for both puts a 1,035px list in a 1,440px page.

**1440 rather than the content-only answer of 1360** because that is the phase rail's measured break - below it the rail wraps to a second row on a published market. `readable-journey` ticket 06 had already put that break "between 1366 and 1440"; it is exactly 1440.

**Every market screen is one width, and `MarketFrame` sets it** (E22/F04/S01, from the-assignment-tab ticket 02).
Tables, Vendors and Attendance used to be `--list-max`, so moving between a market's screens made the frame jump 340px, cut the market's name, and wrapped the rail to a second row on the narrow ones.
A screen that stands in the frame sets no width of its own.
The market's name is whole wherever it fits beside the tabs, and ellipsed with its full name on hover only where it does not.
Where the bar is too narrow for the tabs and a readable name beside them (under 59rem, which only the routes that fit a phone reach, below about a 990px window), the name takes its own line and the tabs scroll inside the bar: at 768 the name drew 0px wide and the page scrolled sideways (T142).
The tabs, the spine and the page row each stand in a `ScrollBox` with `axis="x"`, which is no scroller where its own rule says the strip fits, and the tabs' shade says `tone="dark"` (T217).

**A screen of cards is a two-track grid** (E23/F01/S01, from the-plan-uses-its-space ticket 01).
It is `.card-grid` in `primitives.css`; a screen reaches for it rather than laying out its own rows.
It is one written rule rather than a rearrangement per screen: the design language named two widths and said nothing of how cards share a row, which is why every plan card once had a row to itself, and a local fix per card would leave the next card to decide again.

- **A card is half width unless it declares itself wide** (`.card-grid__wide`). One declaration per card, so the next card added decides nothing else.
- **A card ends at its own content.** Two cards in a row do not stretch to match, and the next row starts under the taller: blank space inside a card reads as something missing.
- **Below `--card-grid-one-track` (900px) of room it is one track**, in the cards' own order. The break follows the room the grid has, not the window.
  The plan never reaches it on an organizer's screen: at the app's 1000px floor it has 920px of room and keeps two tracks.
- **Cards are `--card-grid-gap` apart, and every card has the same inner gutter**, set by the card, never by what it holds.
- **A column divider inside a card is one 1px `--mm-border` line**, on the plan's Tier, Location and Section Setup and its Pricing card, and on the Assignment tab's options and rules alike, so the two screens draw their tables the same way.

On the plan, Market Dates, Section Setup and Pricing are wide (Section Setup's columns need 654px, and at half width its tier select truncated; Pricing's columns are the tiers and, once it has price groups, a column beside them for who is in each group, which takes the card's remaining width, so a group's conditions sit beside its prices rather than under them with the card's right half empty; with no group the table is as wide as its prices); Tier Setup sits beside Location Setup, and How vendors apply beside Application form ([planning the market](business/flows/planning.md)).
Two other rules were prototyped and rejected: two columns by purpose truncated the tier select at 1280, and packing cards by content width changed the screen's shape with the window.

**A market screen's frame stays put** (E21/F04, from the-market-frame ticket 01).
`MarketFrame` pins the screen's bar and the whole phase rail directly under [the app bar](implementation/modules/app-bar.md), at `top: var(--banner-h)`, while the page scrolls; whatever the rail grows is pinned with it.
Up to 1023px only the market bar pins; from 1024px the whole frame does.
Up to that break, a phone or a portrait tablet, the rail scrolls away with the page, since the whole block took half a phone's window, and with Payments' toolbar 459px of a 720x900 tablet's ([the market frame](implementation/modules/market-frame.md#sharp-edges), T142, T263).
It is the frame's own break, beside the app's phone break at 640px, which every other phone rule keeps.
`--banner-h` (`44px`, at every window size) is the app bar's height as a token, so nothing measures the bar at run time.
What the frame pins is the one thing that is measured: on a desk it grows with whatever the rail shows, so no token could state it.
`MarketFrame` measures it, the bar alone up to 1023px, and publishes `--market-frame-h` on its card (declared as `0px` in `base.css`, which is what it is outside a frame), and a screen's own sticky column - the proposal ledger's rail - sits at `top: calc(var(--banner-h) + var(--market-frame-h))`.
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
Both addresses share that row with the actions, each shortening alike and never below 18rem: as wide as each whole address they took a row each, with More… beside an empty band at 1920 (T142).
An address breaks at any character, so its ellipsis meets Copy rather than stopping at the slug's last hyphen.
On a rail narrower than both addresses at that floor beside More… (under 45rem and above the phone break, a tablet's door), each address takes a row, with More… beside the second, never alone under them.
On a phone nothing gives way: the spine scrolls sideways, each address is a one-line chip naming its page as the link beside Copy, each chip takes a row with the actions that fit beside it, and each action wraps onto the next row only where it does not fit, and the next step's link is a 44px line of its own ([the phase rail](implementation/modules/phase-rail.md#sharp-edges), T142).

**Columns are sized by need, not by count.**
Three equal tracks (`repeat(3, minmax(0, 1fr))`) made the Tier select 65px wide and unable to display any of the three values it offers, while giving Location Setup 1.7x what it needs.
The assignment tab's `.plan-row--asymmetric` is `3fr 2fr` for the same reason.

**A section that lists what happened unfolds in place; a section that changes something opens a dialog** (T263).
In a window of sections, as Manage market and Manage organization are, a History section's heading opens and closes it where it stands ([`HistorySection.vue`](../front-end/src/components/HistorySection.vue)), since it only reads, while Permissions is a heading, one line and a Show button opening its rows in a dialog of their own ([`MarketPermissions.vue`](../front-end/src/components/MarketPermissions.vue)), since its owner sets them there.
The next such section takes the side of what it does.

## Radius

Extracted from the newer screens. Three values.

| Token              | Value | Use                                   |
| ------------------ | ----- | ------------------------------------- |
| `--radius-control` | 6px   | Buttons, inputs, selects, small chips |
| `--radius-card`    | 10px  | Cards, panels, dialogs                |
| `--radius-pill`    | 999px | Pills and fully-rounded badges        |

"Fully rounded" has one spelling, `--radius-pill`.
It was spelled four ways (`999px`, `100px`, `30px`, `20px`); none is left, the floorplan beta's last `20px` having moved to `--radius-pill`.

## Elevation

One elevation shadow, extracted from the newer screens, where it is already used 77 times on a single screen.

```css
--shadow-card:
  0 0 0 1px rgba(0, 0, 0, 0.07), 0 2px 4px rgba(0, 0, 0, 0.07), 0 6px 14px rgba(0, 0, 0, 0.08);
```

**The legacy halo is retired**: `0 0 4px 5px rgba(0,0,0,.25)` and its inset twin. A shadow with no offset has no light source, and a spread larger than its blur is a ring, not a shadow - which is why the older cards read as outlined in grey fog. The inset variant is what makes the setup fields look pressed and skeuomorphic. That rule is elevation's; the focus halo below is a focus indicator, deliberately a flat ring that hugs the control.

**A scroller's edge shade** is `--edge-shade` fading to nothing over `--edge-shade-depth` (12px, Daniel's choice), drawn by [`ScrollBox`](#the-primitive-layer) at each edge that has more beyond it, so a scroller with no bar still says it scrolls ([dialogs](implementation/conventions/dialogs.md)).
On the dark ground, where a dark shade is lost, it is `--edge-shade-on-dark`, white at 25%.

## Colour

`base.css` remains the owner and its existing comments remain authoritative: **a token whose name says it carries text must reach WCAG AA (4.5:1) on the grounds it appears on**, and `src/__tests__/contrast.test.ts` asserts it.
WCAG AA is the product's stated standard, held over the whole palette rather than the colours someone happened to measure; raising the muted grey changed the texture of every screen, and that was accepted (wayfinding/readable-journey/map).
The product has one theme, light: nothing in `front-end/src` answers `prefers-color-scheme`, so a pair is held on the grounds it is drawn on, white and the beige of a hovered row among them, and a dark theme, when there is one, is a palette of its own to check.

**A refusal reads in red (`--mm-red`), whatever the card.**
A line saying why something was not done, a save the server refused or a check that failed, takes the red the Vendors row's refusal reads in; yellow is a warning, as the Discord card's role above the bot's is, and never a refusal (T263).
`aRefusalReadsRed.test.ts` holds the Discord card's refusals and Market Setup's failed plan save to the Vendors row's red.

### The contrast contract

**A colour token's name is its declaration**: a token named as text (`--mm-text-*`, `--mm-black`, `--color-text`) is ink, held to AA on each ground it is set on, and a token that only paints a line or a fill is exempt.
The roles are told apart by name rather than by a sidecar map, which could disagree with the CSS, or a lint rule, which would have to infer which ground each usage sits on.
So a colour used both ways is two tokens: the old `--mm-grey` (alpha 0.25) is `--mm-border` for lines and `--mm-text-muted` (alpha 0.63, 4.63:1 on white) for secondary text.
The contract says which values are text and holds those to AA; it does not raise every value, and a border keeps its 0.25.

**Ink on light and ink on dark are separate families** (`--mm-text-muted` and `--mm-text-muted-on-dark`), because contrast belongs to a pair: one muted grey cannot serve white and the near-black bar both, and two families make white text on a white page unwritable.
Where the beige card needs a darker ink than white does, that is a token of its own (`--mm-text-muted-on-beige`).
It also serves the Assignments page's muted text inside a table row, which can sit on an empty table's yellow ground (`--mm-yellow` at 0.18 over white, `.table-row--empty`) or a hovered seat's beige: there `--mm-text-muted` reads 4.38 and 4.23, and `--mm-text-muted-on-beige` 5.42 and 5.19, and the import's value fixes' row counts on their red ground, `--mm-chip-destructive`, 4.24 and 5.21, so a change to the yellow, the beige, that ground or the token is measured on those grounds too.

**Fills carry the reciprocal check**: each fill declares the ink it is legible under, white on `--mm-green`, `--mm-red` and `--mm-blue`, `--mm-black` on `--mm-yellow` and `--mm-beige`.
That check is what made the brand green darker rather than leaving each button to a judgement call.

**A button under the pointer and pressed is a fill of its own, never a dimmed one** (T229): each fill takes a step darker on `:hover` and another on `:active`, and the words keep their ink, so they only gain on their ground.
The pairs are `--mm-green-hover` and `--mm-green-pressed` (white on them 5.23 and 5.91:1), `--mm-red-hover` and `--mm-red-pressed` (6.19 and 6.98), `--mm-white-hover` and `--mm-white-pressed` for the secondary button (`--mm-black` 14.38 and 13.30, the row's destructive red 5.03 and 4.65), and `--mm-chip-positive-hover` and `--mm-chip-positive-pressed` for a toggle that is on (`--mm-text-green` 5.06 and 4.79).
They were `opacity` 0.9 and 0.8, which faded the words with the fill: white on green read 3.81 and 3.21:1, white on red pressed 3.86, and the on toggle's green 3.53 pressed.
`contrast.test.ts` holds each to every ink its button sets on it, opaque, and each a step further from rest than the one before, at least 1.04:1 from it, so a hover never matches rest and a press never matches the hover; [`the-component-library-primitives.spec.ts`](../front-end/e2e/the-component-library-primitives.spec.ts) hovers and holds down every live button of the primitives entry and runs the contrast sweep in each state.
A button drawn by a component of its own takes the same fills where it shares the colour, the floorplan beta's green buttons and the Markets and Organizations pages' New buttons among them, and none of them dims.
The other fills such a button is drawn in step once, on hover: `--mm-yellow-hover` for the floorplan's yellow toolbar and the assignment counts' partial pill (`--mm-black` 6.16), `--mm-beige-hover` for the floorplan's beige Cancel buttons and the empty pill (10.49), and `--mm-black-hover`, a step lighter, for the floorplan's black Load (white 12.15).
The deep focus border reads less on a darker fill: 3.17:1 on `--mm-green-hover`, 2.80 on `--mm-green-pressed`, 2.68 on `--mm-red-hover` and 2.37 on `--mm-red-pressed`, against 3.26, 2.74, 2.68 and 2.28 under the opacity it replaced.

**A mark that carries no text is held to the non-text bar, 3:1**: the bar's current-tab dot, `--mm-green` on `--mm-black`, measures 3.39:1, and the test pins it, so a bar retinted darker or a green lightened for a light ground cannot take it under unnoticed.

[`src/__tests__/contrast.test.ts`](../front-end/src/__tests__/contrast.test.ts) parses the real `base.css`, so the file that ships is the file under test, and lists every colour token as ink, fill, chip ground or line; a colour token in none of those lists fails it, so a new colour must declare itself.

### Added

Both are desaturated, which is what lets them sit beside `--mm-green`. Every saturated candidate (the Material reds, the two badge blues) looks borrowed next to it.

| Token       | Value     | White text on it | Replaces                                      |
| ----------- | --------- | ---------------- | --------------------------------------------- |
| `--mm-red`  | `#c0392b` | 5.44:1           | nine hardcoded reds, 77 occurrences           |
| `--mm-blue` | `#1a6f8b` | 5.69:1           | two badge blues; same hue as `--mm-text-link` |

`--mm-red` and `--mm-text-red` were both **referenced but never defined** - see `E16/F01`. `var(--mm-red, #cc0000)` carried 24 usages on its fallback, which is how `#cc0000` became the most-used red in the product without anyone choosing it.

Three of the reds being retired cannot carry white text at all: `#e74c3c` (3.82), `#f44336` (3.68, the Reject button) and `#e53935` (4.23).

### The section palette

**A layout draws each section in one of eight colours** (T257), `--layout-section-1-fill` and `--layout-section-1-edge` to `-8-` in `base.css`: a table is filled with its section's tint and edged in its hue, and its number is `--mm-black` on the tint.

| Colour | Hue        | Fill      | `--mm-black` on it | Edge      | On the floor | On white |
| ------ | ---------- | --------- | ------------------ | --------- | ------------ | -------- |
| 1      | gold       | `#f8e7c2` | 12.73:1            | `#a97a1b` | 3.42:1       | 3.83:1   |
| 2      | blue       | `#dce9ee` | 12.53:1            | `#1a6f8b` | 5.09:1       | 5.69:1   |
| 3      | terracotta | `#f3ddd8` | 11.95:1            | `#b0503f` | 4.62:1       | 5.17:1   |
| 4      | green      | `#dfebe8` | 12.72:1            | `#36826f` | 4.10:1       | 4.59:1   |
| 5      | violet     | `#e6e0f3` | 12.08:1            | `#6b54a8` | 5.43:1       | 6.07:1   |
| 6      | teal       | `#cfeeee` | 12.67:1            | `#0e8a8f` | 3.72:1       | 4.16:1   |
| 7      | rose       | `#f5dde8` | 12.13:1            | `#b0457a` | 4.72:1       | 5.28:1   |
| 8      | olive      | `#e8ebd0` | 12.75:1            | `#6f7a25` | 4.19:1       | 4.68:1   |

Each fill carries `--mm-black` past 7:1, since a number on a table drawn small is small type, and each edge stands past 3:1 against the floor (`--layout-floor`) and against white, the ground of a section's name pill; `contrast.test.ts` holds every pair to those floors and the palette to eight colours.
A section's style stores its colour as the number here, so the order is stored data: a ninth colour goes after these, never between.
A section with no style takes the next colour unused in its layout, in the plan's order, and once all eight are used the palette starts again, so a ninth section takes the first (`sectionColors` in [`layoutGeometry.ts`](../front-end/src/components/layout/layoutGeometry.ts)).
A table in no section is grey, `--layout-no-section-fill` and `-edge` (12.36:1, 4.03 and 4.50), and a no-table zone is hatched in `--layout-zone-fill` and `--layout-zone-hatch` (`--mm-black` 13.30 and 9.05 on them) inside a dashed `--layout-zone-edge` (3.66 and 4.09).

**How a layout is drawn** ([`LayoutMap.vue`](../front-end/src/components/layout/LayoutMap.vue), [the drawing](implementation/modules/floorplan-placement.md#the-drawing)):

- the floor is `--layout-floor`, and on a screen the venue's floorplan lies on it at half strength and in grey, so the sections' colours are the only colours;
- a table is a rectangle at its true size with a 40 mm corner, its edge 1.5px, its number in Outfit 600 at 14px (`--text-sm`) where the table has the room, smaller to fit, and left out below 6px; the number turns with the table and never reads upside down;
- a section's name is `--text-xs` at 600 in a white pill 22px tall, edged 1.5px in the section's edge, 6px from its tables;
- a no-table zone is hatched at 45°, 10px apart, inside a 1.5px dashed edge with a 4px corner, its label at 14px where it fits;
- a selected table is outlined 2.5px in `--mm-black`, 3px outside its edge, and an alignment guide is 1px of `--mm-blue`, dashed;
- every one of those pixel sizes holds at any zoom, and a table's millimetres are what zoom: 100% is 1px to 25 mm, at which a 6 ft table is 73 by 30px.

### The brand green is `--mm-green` (`#36826f`)

The wordmark painted `#00DC82` while every primary button painted `#36826f`. `#00DC82` gives white text 1.8:1, so it can never be a button or a link - a brand colour the product would be forbidden from using on any control. The logo's mark is `--mm-green`; its wordmark is black ([brand files and icons](#brand-files-and-icons)).

### Two grounds, not one

`--mm-green` measures 4.59:1 on white and **4.43:1 on the off-white `#FBFBFA`**, and it is the current-phase label on every market screen.
A token is only AA on the grounds it was measured against, so the phase rail's ground is white (E16/F01/S03).

So a chip carries its own ground: the `--mm-chip-*` tokens are opaque, the tint already laid over white, and `contrast.test.ts` asserts each with its ink.
Translucent tints took on the beige review card beneath them and fell below AA there (E26/F10/S01).

## Brand files and icons

The brand has one folder, [`front-end/src/assets/brand/`](../front-end/src/assets/brand/):

| File                                 | What it is for                                                                               |
| ------------------------------------ | -------------------------------------------------------------------------------------------- |
| `conventioner-logo.svg`              | The full logo, mark and wordmark; [the app bar](implementation/modules/app-bar.md) draws it. |
| `conventioner-mark.svg`              | The mark alone, in its colour, for wherever the logo does not fit.                           |
| `conventioner-mark-currentcolor.svg` | The mark in `currentColor`, for a dark ground or a coloured control.                         |
| `conventioner-wordmark.svg`          | The wordmark alone.                                                                          |

The mark is `#36826F`, which is `--mm-green`, and the wordmark is black.
An `<img>` does not inherit colour, so the `currentColor` copy only takes the colour around it when it is inlined.
The mark and the wordmark are the logo's own two paths, unchanged, and [`theBrandHasOneFolder.test.ts`](../front-end/src/__tests__/theBrandHasOneFolder.test.ts) fails when either drifts from the logo.

The favicon set in [`front-end/public/`](../front-end/public/) is generated from the mark, and [`front-end/index.html`](../front-end/index.html) links it:

| File                           | Size       | Ground                 | For                                                                                                                       |
| ------------------------------ | ---------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `favicon.svg`                  | vector     | transparent            | Every browser that takes an SVG favicon; a byte-for-byte copy of the mark.                                                |
| `favicon.ico`                  | 16, 32, 48 | transparent            | A browser that does not.                                                                                                  |
| `apple-touch-icon.png`         | 180        | white, the mark at 140 | iOS, which fills transparency with black.                                                                                 |
| `icon-192.png`, `icon-512.png` | 192, 512   | transparent            | The manifest's `any` icons.                                                                                               |
| `icon-maskable-512.png`        | 512        | white, the mark at 384 | The manifest's `maskable` icon: a launcher crops it to its own shape, and the mark stays inside the central 409px circle. |

When the mark changes, run `npm run brand-icons` in `front-end/` and commit what it writes.
[`scripts/brand-icons.ts`](../front-end/scripts/brand-icons.ts) renders with the Chromium `@playwright/test` installs and writes the ICO itself, so it adds no dependency, and neither CI nor the build runs it.
`index.html`'s ICO link says `sizes="32x32"` on purpose: without it Chrome may choose the ICO over the SVG, and `sizes="any"` makes it download both.
[`manifest.webmanifest`](../front-end/public/manifest.webmanifest) is written by hand, and its `display` asks for `browser`, since an organizer copies a market's link from the address bar.
What an icon on a home screen then opens is the phone's to decide: on iOS 26 the "Open as Web App" toggle in the Add to Home Screen dialog decides it, and no phone has tried this yet.
[`the-brand-reaches-the-browser.spec.ts`](../front-end/e2e/the-brand-reaches-the-browser.spec.ts) fetches every icon as a browser would and holds its content type, since a missing file falls through to `index.html` with a 200.

An icon lives in [`front-end/src/components/icons/`](../front-end/src/components/icons/) as `Icon<Name>.vue`, a local SVG drawing in `currentColor` ([ADR 0015](adr/0015-the-app-owns-its-components.md)).
An icon is added when a screen uses it, and [`everyIconIsUsed.test.ts`](../front-end/src/__tests__/everyIconIsUsed.test.ts) fails, naming the icon, for one that no source file outside the tests, the icons folder and the dev-only component library in `src/dev/` imports.

## The primitive layer

Tokens alone cannot fix what is actually wrong. A `--radius-control` does not stop a file writing `height: 45px`, and the concentrated damage is exactly there: five control heights on the login screen, ten on Market Setup, four disabled treatments, sixty button-ish class names, two designs for the same `Manage` button.

Three primitives own height, padding, radius, type and the disabled state, and `primitives.css` holds the one focus border every button draws and the one focus halo every other control wears. They live in `front-end/src/assets/primitives.css`, and `src/__tests__/primitives.test.ts` is the reference a migration checks against.
Every primitive and reusable component is drawn in its variants and states on the [component library](implementation/modules/component-library.md)'s page, `/dev/components` in a development build, which is where one is looked at and critiqued; the test, not the page, holds the contract.
Reach for a primitive rather than deciding again.
They and `AppDialog` are the app's components: it installs no component library, and a widget too hard to own starts from a headless one styled with these tokens ([ADR 0015](adr/0015-the-app-owns-its-components.md)).
The searchable picker is the app's own, and the ADR records why that combobox did not take a headless one.
Two smaller controls had no owner either, each re-decided per file, and are primitives of their own: `.add-row`, the button that adds a row to a plan card (it was an icon with a click handler, unreachable from a keyboard), and `.drag-handle`, the control that reorders a row (E17/F01).
A link on a line of its own is `.link-alone`, a target `--target-min` tall in the link ink, underlined under the pointer: "Forgot password?" under sign-in and "Back to sign in" under the password and verification pages, which each carried a copy of the rule as their own `.link` (T181).
A control that changes the form and goes nowhere is a button, even in that look: "Use a different email" under the code sign-in is a `.link-alone` button with its own ground, border and padding taken off (T263).
A link inside a sentence is not one, since it sits on the sentence's line.
A choice among many, found by typing, is [`SearchPicker.vue`](../front-end/src/components/SearchPicker.vue) (E38/F08/S03): a field over a grouped list that it narrows as it is typed in, worked by the arrow keys, Enter and Escape, its list opening in the flow under the field so a dialog's scroller cannot clip it; it narrows a group and never hides one, a named group with nothing matching saying so and one with no name drawing nothing, unless the caller gives `hidesEmptiedGroups`, as `ChoiceField` does, and then a group the words emptied is not drawn and words that find nothing say so once, in a line under the listbox and outside it, since a listbox holds options and groups only; the caller says what the words find.
In a short scroller that list can lie past the foot, so opening it and typing bring the list and the field into view, the field first where both do not fit, unless the caller gives `listOver`.
Chips above them may then lie past the top.
Reopened on a choice, it selects that choice's label, so typing replaces it and searches afresh rather than running on from the label; left untouched, the choice stays.
A picker with no choices at all never opens its list, so the note beside it says why there is nothing to choose; in a picker with choices, "Nobody matches" (the caller's `noneWord` in place of "Nobody", where the choices are not people) shows once the words find none.
Given a `cap`, it draws at most that many matches, counted across the groups in order, over a line "N more, type to narrow" that stands under what scrolls and that the keys skip; a group the cap alone leaves out is not drawn, and one choice held while the matches pass the cap is drawn first, as several are, and is the active row, so Enter keeps it (T263).
Without a `cap` it draws every match.
The list is a frame holding a `ScrollBox` and that line, so the bottom shade lies above the line and never over it; the arrow keys bring the active row into view clear of a shade, by its `scroll-margin-block`, and a row under the pointer is not moved, or the pointer would be left on the next row in the shade's depth.
Every row is a `--target-min` target at least, its one line centred in it and its tick on that line, on a phone's 44px too for every picker (`--row-inset`); a row that wraps grows down from there.
Given `multiple` it holds several choices as `.chip--neutral` chips above the field, each as tall as its remove button's target, its words the option's `chip` where they differ from its label, Backspace in the empty field taking the last; a chosen row the list draws is ticked, the list and the words stay after a choice, and choosing a row again removes it.
An option's `address` says its label and chip hold an address, drawn by `EmailAddress.vue`, so a row or chip narrower than it breaks it only before its "@" or a dot; `personOption` sets it, and "Assigned to" sets it on its reviewers, so every chooser of a market's team has it; the placement dialog's vendor pickers do not set it.
With a `cap` the matches pass, every chosen match is drawn first, so every choice opens ticked at the top and the rest fill what is left of the `cap`; who leads is settled as the list opens and as the words change, so no row moves under the pointer.
Given `acceptsTyped`, trimmed words that are no option's label, capitals aside, are offered as `Use "<words>"`, which leads the list outside the `cap`, so the keys reach it first; choosing it makes the words the value, shown by the field or a chip, and the list opens for words even with no options.
Reopened on such a value no row is active, so Enter keeps it, and words that differ from an option only in capitals take that option, so "stickers" never stands beside "Stickers": it is the active row, drawn first if the `cap` would leave it out; among several, words a typed chip holds in other capitals are that chip, so they make no second one.
Words left when the field is left, or when Enter goes on to the form, are kept with `acceptsTyped`, as the option they name or as typed (`wordsAreValue` has written them already as typed, so only an option they name in other capitals is written then), and otherwise cleared.
A press of the main button past its open list leaves the field only as the press ends, since changing the list as the focus goes would move what lies below it from under the pointer and lose the click; a free-text field's words are written before that click, which may read them.
Reached with a choice in it, by any path, the field has that choice selected, so what is typed next searches by itself rather than running on from the label.
Given `holdsChoice`, one choice holds until another is taken, as a filter or a card that writes on a choice needs: typing emits nothing, and on leaving the field or on Escape the field names the choice again; without it the first word lets the choice go, as a dialog that acts on Save needs.
Given `wordsAreValue` with `acceptsTyped` on one choice, as a screen that writes as it is typed needs, every keystroke emits the trimmed words as the value, so no empty value comes between a filled one and the words replacing it; the field keeps the words as typed until it is left, then names the value, an option's label or the trimmed words, and Escape closes the list and keeps the words.
Given `disabled`, its field and chips take nothing and its list closes, as while the choice is being saved; `describedBy` names words beside it that describe its field, such as a hint.
The placement dialog's pickers are its first use, with no `cap`; Choose reviewers is the first of several, in [`ReviewerPicker.vue`](../front-end/src/components/market/ReviewerPicker.vue); "Who will follow up" and the review card's "Followed up by" choose one person, the card with `holdsChoice`.
The All view's "Assigned to" and the market history's "Who" hold their choice too, as filters.
Given `listOver`, its list lies over what follows and moves nothing, as those two need: in the flow, "Assigned to" would push the rows down beside a wide empty band, and "Who" would push the filters below it down beside an empty half of its row.
"Who" gives its list the width of both its columns, so a phone reads an address on one line; in a dialog, what passes the scroller's edge takes a scroll.
Given `hideLabel`, its label is `.visually-hidden`, for a row that says what the field is; given `invalid`, its field is `aria-invalid="true"` and ringed in `--mm-red`, as Pricing rings a field, and the words saying why are the caller's, through `describedBy`.
An option whose value is `''` is a real row under `holdsChoice`, chosen while the value is `''`, as "Ignore this column" needs.
Given `leads`, those options are drawn first whatever the words, outside the `cap` and its count and ahead of `Use "<words>"`, as a way out that must stay in reach needs ("Ignore this value"), and the line saying the words find nothing still shows under them; opened with no words and nothing held the keys start on the first, while words start them on what the words find, a lead only where the words find it too, so Enter never sets a value aside for words that meant something else (T263).
An option that is `disabled` may not be taken, as a target another column holds: drawn in `--mm-text-muted` with `aria-disabled="true"`, its `detail` saying why, passed by the keys and as the first active row, taken by neither a click, Enter nor words naming it; words still find it and the cap still counts it, so nobody wonders where it went.
Given `clearsOnChoice`, on one choice, each choice is added elsewhere, as a ranked list's next answer: after emitting, the field empties, the list closes and the focus stays, ready for the next word, and the value stays `''`.
Given `fieldId`, its field has that id, for a link elsewhere on the screen to name.
Its exposed `show()` takes the focus and opens the list, for a link elsewhere on the screen, and answers whether the list is open; its `showChoice()` has the field name the choice that holds again, for a screen whose server refused the one just taken, leaving words being typed.
A choice from a set that can grow is [`ChoiceField.vue`](../front-end/src/components/ChoiceField.vue) (T223): a native select at 12 choices or fewer, the same to its screen as the `SearchPicker` it mounts past that, so no screen writes the threshold, the cap or the two markups.
**The threshold is one number**: its `COMBOBOX_PAST` is `ListFrame`'s `LIST_FIND_FROM`, 12, the length past which a list has its find field too, and a screen drawing its own small form compares against that export, with `COMBOBOX_CAP` and `labelHolds` for the `SearchPicker` it mounts past that, as `ChoiceConditions` does: a choice of several has no `ChoiceField`.
It counts the whole set, `wholeCount` where the screen gives it, else the options drawn, so a set that shrinks as it is used never turns into the other control under the caret; the import's value fixes give it the question's answers, leaving "Ignore this value" out of the count, and pass that choice as `leads`, the select's first row after "Choose…" and the picker's `leads`, so neither the cap nor the words hide it; `leads` count toward no threshold (T263).
At 12 or fewer the select carries the `testid` and the `name`, a group with a label is an `optgroup`, and `placeholder` is its empty row.
Past 12 the picker's root carries the `testid`, it draws 50 of what the words find, its words find by the label unless the screen gives `finds`, and its list lies over what follows, at least 22rem wide, or the window's width less twice `--space-8` where that is narrower, with its right edge on the field's, so a long answer reads on a line or two in a narrow column.
A card's body scrolls nothing and clips nothing ([`ElementSettingContainer.vue`](../front-end/src/components/elements/ElementSettingContainer.vue)), so such a list passes a card's foot whole.
A host that clips or scrolls, as the frame of Pricing's table does, gives `listInFlow`, so the list pushes what follows down rather than being cut off; `ChoiceConditions` does, on either card.
An option that is `disabled` is an `option` that is `disabled` in the select, its `detail` on its line, since a select's row has one, and in the field a row as above.
It never keeps typed words, so a fix can only name what the question offers; a free-text field is `SearchPicker` itself.
`writes` is the picker's `holdsChoice`, for a choice acted on as it is taken; `noneRow` is for a choice that may go back to none, as the Discord card's: while one holds, its words are the field's first row, whose value is `''`, as the select's empty row is, counting toward no threshold, and the picker's first lead, so it stands above the choice held and is drawn whatever the words (T263); `adds` says each choice is added elsewhere, as a rule's "Add an answer" and "Add from your file" do: the value stays `''`, the select goes back to its empty row and the field is the picker's `clearsOnChoice`, and the screen gives `wholeCount`, since such a set shrinks as it is used; its `open()` opens the list from elsewhere on the screen, and answers false where nothing opened, on a browser with no `HTMLSelectElement.showPicker` or one that refused it; its `showHeld()` shows what `modelValue` holds again, for a screen whose server refused the choice just taken; and `fieldId` is the control's id, the select's or the field's, for a link elsewhere on the screen to name.
The applicant's form compares a question's options against the same number ([`LongQuestion.vue`](../front-end/src/components/application/LongQuestion.vue), T223): past 12 a `select` is a `SearchPicker` capped at 50 and a `multi_select` the same with `multiple`, in the page's flow, and at 12 or fewer each stays the select or the checkboxes it was.
The question's words stay where every question has them, hidden from a reader and tied to no control, a press on them putting the caret in the field, and the field takes those words as its name, required mark and all, so the question is heard once.
It is never `holdsChoice`, as a form acts on Save: the first word lets a choice go, and words not chosen clear on leaving the field.
A locked question is `disabled`, a question in error is `invalid` and described by its error, and a stored answer no option offers is a chip among several; on one choice the field is empty, and the form's required check counts it as no answer, at either size.
`FormPreview` mounts the same component disabled, so the organizer sees what an applicant will get ([applying online](business/flows/applying-online.md#h3a-a-new-vendor-applies)).
The emailed six-digit sign-in code has one field, [`CodeInput.vue`](../front-end/src/components/CodeInput.vue), which both sign-ins use: the vendor page's code step and the organizer's "Sign-in code" step (T191 F21).
It is a `.field` 48px tall at `--text-xl`, the one field read at a glance, with tabular figures, and the one field whose text is centred: its `letter-spacing` and `text-indent` take one custom property, `--code-spacing`, since a browser adds the spacing after the last digit too and a centred run without the matching indent sat half a space left of centre.
Its placeholder, `000000`, clears on focus, so the empty field's caret, drawn at the box's centre, is never drawn inside the digit group; the label over it names it, as every label does.
[`the-code-field.spec.ts`](../front-end/e2e/the-code-field.spec.ts) holds both sign-ins' field inside its card with its digits centred within 1px, at 1280, 390 and 320 wide.
A row of pressed buttons that filters a list or switches a view is [`FilterToggles.vue`](../front-end/src/components/FilterToggles.vue) (T200): compact secondary `.btn`s in a named `role="group"`, one choice by default or several with `multiple`, each named by the words it shows, its label then an optional count.
The row wraps and a long label wraps inside its toggle, so it never scrolls sideways, and on a phone a toggle is at least 44px each way.
One rule holds in every row, Daniel's choice on 2026-11-04: pressing the chosen toggle again lets it go, and nothing pressed means all, so a row needs no All toggle, and Markets' phase filter has none.
With one choice, letting go empties the value, unless the row names in `rest` an option to return to: its default, or the All toggle a row still draws, which stays pressed when it is pressed again.
Several emit in the options' order.
Export vendors' Status and Discord filters mount it, with `multiple`; the library's `filter-toggles` entry lists the eight rows it would replace.

A list that can grow with a market is [`ListFrame.vue`](../front-end/src/components/ListFrame.vue) (T200), generic over the row: a find field once the whole list passes `findFrom` rows (12), the screen's own filters beside it, a count line, the first `pageSize` rows (50) and "Show N more".
The screen narrows `items` by its filters and brings `finds`, `itemKey` and the `row` slot; the frame does the finding and the paging on what is already read.
A screen whose rows are its own gives the `rows` slot instead, its `ul` or `table` over the rows on screen, each row carrying `data-list-row` and `tabindex="-1"`, which is how "Show N more" hands the focus on in either slot.
`aboveRows` stands between the tools and the count line in every state, for what acts on the rows, and `drawn` says the rows on screen at mount and whenever they change, none while `state` draws none, with how many the cap leaves off, for a screen that acts on exactly those.
A screen with filters gives `wholeCount`, so a narrow filter never takes the field away and the count line names the whole, "Showing 50 of 110 (359 in all)" or "110 of 359 applications", and `filterKey`, its filters as one string.
On a page, `findKey` puts the words in the route's query, written with `router.replace`; a dialog gives none, since they would outlive it, and a screen that sets the words itself holds them with `v-model:words`.
The shown count goes back to one page only when the words or `filterKey` change, so a read again or a verdict that changes the rows holds the place.
`state` draws loading and failed (`ReadFailed`, unless the `failed` slot replaces it), the `empty` slot says why there are no `items`, and the count line says when the words find nothing.
A screen whose own field stands elsewhere gives no `finds`: the frame draws no field, `items` are final, so `filterKey` must carry the screen's words too, and the count line shows only while the cap leaves rows off, "Showing 50 of 120", since the screen's own line counts the rest.
The screen's own count line takes the frame count line's size, `--text-sm`, since past 50 the two stand one over the other, as Markets' "N markets" stands over the frame's "Showing 50 of N" (T223).
A list read whole by asking gives `showAll`, its `pageSize` the first page: the button reads "Show all N" and draws every row the words find, handing the focus to the first new one, then "Show fewer", which goes back to one page, keeps the focus and brings itself into view, as `useFold` does; the count line shows only with the field or while rows are cut, since a list that short is read at a glance, often under a heading that counts it.
Manage market's "Users with access", Manage organization's Admins and Members, Applications All, One by one's reviewed applications and Organizations are its screens, and the Discord role report's dialog, which gives `finds` only past 12 vendors, so a short report draws no count line.
Vendors and Payments, whose searches stay pinned in `MarketFrame`, and [Markets](business/flows/finding-a-market.md#c2-the-markets-list), whose finder stands above its cards and draws its search only past 12 markets or while it holds words, are on it with no `finds`.
The import's four lists of rows and each question's answers on the proposal are on it with `showAll` and a first page of 20.
The library's `list-frame` entry shows it on Applications All, the people with access, the import's refused rows and a search standing elsewhere.
Inside a `scroll="body"` dialog it needs nothing of its own, since the dialog's body scrolls it; the library's `summaries` entry shows it there, with no `findKey`, so the words go with the dialog.
Enter in its field does nothing, so in a dialog's form it never saves what the person was only looking through.

**A list is `ListFrame` when its rows are already read whole, and [`PagedList.vue`](../front-end/src/components/PagedList.vue) when the server pages them** (T224), since a list the server pages knows no total and cannot find among rows it has not read.
`PagedList` holds any rows, its default slot, and knows nothing of what they are: the screen gives `hasMore`, `loading` and `error`, and reads the next page on `more`.
`box="own"`, the default, stands them in a [`ScrollBox`](#the-primitive-layer) at most `min(28rem, 45dvh)` tall, with a hairline border, and names it `label` while it scrolls; a scroll past its end carries on to what is around it, where a `ScrollBox` alone would stop it.
`box="parent"` has no scroller, for rows in the flow of a dialog's body or the drawer's, so no scroller stands inside another with nothing beside it.
It asks as an `aria-hidden` sentinel over the last 12rem of the rows comes into view through every scroller around it, so it asks before the reader reaches the end and a keyboard reaches it too, and it observes the sentinel again whenever the rows change, so a page too short to fill the box leads on to the next.
At the end of the rows it says "Loading…" in a `role="status"` line, or `ReadFailed` on `error`, whose "Try again" also emits `more` and moves focus to the first control of what landed; a failed page brings that line into view only for a reader already at the end of the rows.
Manage market's History, the organization's History, the vendor drawer's History tab and the Assignment history dialog are its screens, read through [`useHistoryPages`](../front-end/src/utils/useHistoryPages.ts).
The permission changes stand in it too, showing rows their screen read whole 25 at a time, since the box is what keeps a long record from pushing the rest of the dialog away.
The library's `list-frame` entry shows it in each box mode, with a page that fails.

People named above the work rather than listed are [`NameList.vue`](../front-end/src/components/NameList.vue) (T200): one paragraph, so it reads as a sentence, "12 reviewers: Ana, Ben, Cai and 9 more", naming `named` (3), and its text button, "and 9 more", which a `.visually-hidden` noun names on its own, emits `more` for the screen to open the whole list.
With `named` or fewer names it says them all and draws no button, so a screen keeps its own way to that list.
Its `name` slot draws a name the screen's way and its `end` slot ends the sentence after the button.
The Reviewers panel on the Applications tab is its screen ([`ReviewersPanel.vue`](../front-end/src/components/market/ReviewersPanel.vue)), which the library's `summaries` entry also draws.

A long list a screen keeps grouped folds by group, in [`RowGroup.vue`](../front-end/src/components/RowGroup.vue) (T200): a heading, the first `fold` (20) rows of `items`, and "Show all 31 in North Wing", which unfolds the rest in place and becomes "Show fewer"; at `fold` rows or fewer it draws no button.
Its `heading` slot draws more beside the name, as a section's location and tier, and the `heading` prop still names the group on the button.
A page that must keep its groups' folds past a re-read, or unfold them together, holds them with [`useGroupFolds`](../front-end/src/utils/useGroupFolds.ts) and each group's `v-model:unfolded` (T223): one "Show all 59 tables" above the groups, drawn only while one on the page passes the fold, which keeps the focus and stays where it stood, says "Show fewer" once all of them are unfolded however they came to be, and leaves a group a filter has hidden as it was.
[`BarLedger.vue`](../front-end/src/components/BarLedger.vue) folds the same way with `fold`: the rows by count, the first `fold`, then "N more answers"; without it the rows are drawn in the order they came, all of them.
Both take the fold from [`useFold`](../front-end/src/utils/useFold.ts): unfolding by a group's own button hands the focus to the first new row, and folding keeps it on the button and brings the button back into view.
The Assignments page's sections are `RowGroup`s; `BarLedger`'s fold is on no screen yet, and the library's `folds` entry shows both.
A question's options on the form builder take the same fold in [`FormFieldEditor.vue`](../front-end/src/components/application/FormFieldEditor.vue), past 20, and "Add option" unfolds them, so a new row is never behind it.

A list someone puts in order is [`OrderedList.vue`](../front-end/src/components/OrderedList.vue) (T200), generic over the item: each row has the `.drag-handle` and its own move up and move down buttons, named by `itemLabel`, so the keyboard can do what the mouse can, the first's up and the last's down disabled.
A move keeps the focus on the moved row's button, or on its other button once that one is disabled.
A row takes its container's width, its words wrapping and its buttons never shrinking, so nothing is clipped on the right inside a dialog's scrolling body or tray; its words are the `row` slot's when given.
Export vendors' cart mounts it, and the library's `export-vendors` entry shows it alone.

**No in-app scroller draws a bar, on any browser** (T217): one rule in `base.css` hides it on everything under `body`, and a box that scrolls is a [`ScrollBox`](../front-end/src/components/ScrollBox.vue), whose shades say there is more.
Two things keep their bars: the page, since `html` is outside the rule and its bar says how long the page is, along with its `scrollbar-gutter`; and a `textarea`, a field with no room for a shade.
A component writes no `scrollbar-width` or `::-webkit-scrollbar` of its own.
A rule with `overflow: auto` or `scroll` that never scrolls is deleted rather than wrapped, since it only makes a scroll container that stops a sticky child sticking.
[`everyScrollerIsAScrollBox.test.ts`](../front-end/src/__tests__/everyScrollerIsAScrollBox.test.ts) fails on `overflow: auto` or `scroll`, or any rule on a bar, in a `.vue` or `.css` file outside `ScrollBox` and `base.css`; the layout sweep's gating [`scroller-without-a-shade`](#what-keeps-this-true) fails on what really scrolls in a browser and is not a `ScrollBox`, which sees what that test cannot, a scroller made by a binding or a script; [`no-in-app-scroll-bar.spec.ts`](../front-end/e2e/no-in-app-scroll-bar.spec.ts) launches a browser that draws classic bars, which headless Chromium otherwise hides, opens two dialogs, the vendor drawer and a picker's list, and finds no room given to a bar under `body`, with the page's own still drawn.

A box that scrolls is [`ScrollBox.vue`](../front-end/src/components/ScrollBox.vue) (T217): `axis` (`y`, `x` or `both`), `tone` (`light`, or `dark` on a dark ground), `testid` (`shadeTestid` for the shades' prefix of its own, as a dialog keeps), and `label`, which names the scroller as a region while it scrolls or is a stop, for a table a keyboard scrolls sideways.
While it overflows with nothing inside it to take focus it carries `tabindex="0"`, since Safari gives a scroller no Tab stop of its own and the bar is gone; otherwise it carries none, since a focusable child already takes the keys.
A text entry (a field, a select, a text area) keeps the arrows, Page Down and Space for itself, which a strip of fields can, as Tab brings each field's column into view, but a find field over rows nothing else focuses cannot: so a box that may hold one says `fieldsLeaveTheStop`, and keeps its stop beside a text entry, one Shift+Tab before the field; a dialog's scrollers say it (T223).
A stop holding focus stays one until focus leaves it, so a control arriving inside it cannot drop that focus to `<body>`, as a browser that gives a scroller no stop of its own may.
`focusable` keeps that stop whatever it holds, for a panel that puts focus on its body as it opens.
`listbox` makes the scroller a combobox's listbox, named by its field and never a Tab stop: the field keeps the focus and keys it by `aria-activedescendant`, and its `tabindex="-1"` stops Chromium making a stop of the scroller by itself, which took a Tab press into a list that closes as its field is left and dropped focus to `<body>`.
It draws a shade at each edge that has more beyond it, only then, and none in print, where nothing clips, the root's own class included, and a sideways table takes the page's width; a class passed to it lands on its root, which is what a screen sizes and borders, and padding goes in the slot's content, so a shade lies at the box's edge and a control's focus halo has room inside.
It exposes its `scroller` element for the few screens that move it themselves.
Sideways, its content is as wide as the box or as what cannot give way, so a table whose cells can wrap fits before it scrolls.
A strip that scrolls only under its own media or container rule sets `--scroll-box-overflow: visible` on the root where it does not scroll, since there a scroller only clips a child's outer halo, and `inherit` under the rule that lets it, to take the value in `base.css` back.
Only `axis="x"` reads that property, and it inherits, so a sideways `ScrollBox` nested in such a root takes it too.
Every dialog scrolls in one ([dialogs](implementation/conventions/dialogs.md)), a long dialog only its body at most 80% of the window's height at a desk, and a short one whole; the library's `components` entry shows each axis and tone.
A panel that slides in from a side is [`SidePanel.vue`](../front-end/src/components/SidePanel.vue) (T200), a proposal for the vendor drawer: `side` (right or left), `width` (narrow, 20rem, or wide, 30rem, each leaving a gutter of scrim), its title and close pinned and only its body scrolling, a `focusable` `ScrollBox` that takes focus as the panel opens.
It is modal as a dialog is, through the same composables: Escape and the scrim emit `close`, focus moves in to its body, so the keys scroll the panel and never the page behind, and goes back, and the page is inert.
A dialog opened from it is mounted beside it, lies over it and takes Escape first.
No screen mounts it yet: the library's `proposals` entry shows it on a fixture application, with `.chip--small` and `.data-table`.

A screen takes a file on [`FileDropZone.vue`](../front-end/src/components/FileDropZone.vue), its one way to (T205): a dashed zone on the beige ground that a click anywhere opens the file chooser from, its main line naming the hidden input and a hint under it saying what files it takes.
It tints green under the pointer and while a file is over it, and its words take no pointer events, so crossing them does not fire `dragleave` and flicker the tint off.
Busy, while its caller reads or uploads a file, it takes no file and mutes its main line, never dimming it with opacity; a chosen file clears the input, so the same file chosen again is read again.
It judges no file: it hands the one chosen or dropped to its caller, which checks it and says any error.
The import and the start from a Google Form take their CSV on it, and a location's layout its floorplan image or PDF.

|               | Variants                                                                                | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.btn`        | `--primary`, `--secondary`, `--destructive`, `--compact`                                | One standard height (36px) and one compact (28px), and no third, both 44px on a phone. 36px was already the most-used height in the product; 34, 38 and 40 were the same button drawn by four people. `--secondary` with `--destructive` is a row's destructive action, below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `.field`      | `--select`, `--textarea`                                                                | Left-aligned always - 18 of 27 controls on Market Setup were centred - but for the sign-in code's field above. `--select` carries `min-width: 0`: a select fills its column and never pushes past it, in Firefox as in Chromium. A column that must fit a select's options sizes its own track. `--select` also draws the one chevron, 13px from the right edge as its text is from the left, with room so a long option ends in an ellipsis before it, muted when disabled: two files, `public/icons/select-chevron.svg` and `select-chevron-disabled.svg`, never a `data:` URI, which the Content-Security-Policy's `img-src 'self' blob:` would refuse once it enforces. Under forced colours it keeps the browser's own arrow. A select's own class may size or place it and never sets `padding`, `background` or `appearance`. `every-select-draws-one-chevron.spec.ts` holds the look on the library's primitives entry and on the screens whose selects once drew their own, and `everySelectWearsThePrimitive.test.ts` holds, from the source, that every `<select>` wears it and that no class of its own draws it, nor any rule of its file that reaches it by `select` or `.field--select`. |
| `.chip`       | `--neutral`, `--positive`, `--attention`, `--informational`, `--destructive`; `--small` | One shape, one size, sentence case. Tint with coloured ink rather than a solid fill: a list of six solid pills competes with the content it labels. The tint is an opaque `--mm-chip-*` ground, so a chip reads the same on beige as on white. A status is a chip; the action beside it is a button. `--small` is a proposal (T200), a size step rather than a tone: the type is already the scale's floor, so it takes the padding in and takes `--radius-control`, and no screen wears it yet.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `.data-table` | `--one-line`                                                                            | A proposal (T200) for the six tables that each draw their own, and only Export vendors' preview wears it yet: a muted header, a rule between rows and the cells' padding, in a `<table>` whose columns are the screen's own. In a `ScrollBox` with `axis="x"`, a `label` naming the region and `.data-table-scroll` on its root, it scrolls sideways alone and never moves the page: the root keeps the border, the radius and the corners, and the box is a Tab stop while the table scrolls. A cell wraps; `--one-line` keeps each on one line, for a table read across, and on paper lets them wrap to the page, with each word whole and sizing its column, so a table whose longest words outgrow the paper runs off it. An address drawn by `EmailAddress` stays in its pieces there too.                                                                                                                                                                                                                                                                                                                                                                                                         |
| `.link-alone` | none                                                                                    | A link on a line of its own is a target: a line box `--target-min` tall, 44px on a phone, with no padding, so it still sits on its text.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

**A button or a menu item names its action in sentence case**, as a chip names its status (T181): the phase rail's moves ("Open applications", "Begin assignment", "Publish market"), its More… menu ("Reopen for editing", "Archive market"), "Publish results", and the titles and buttons of the confirmations they open.
A proper name keeps its capitals: "Connect Discord", "Back to Market Setup", where Market Setup is the tab's name.
A few older buttons still read in Title Case, to be changed rather than copied: the Form tab's "Save Form" and the floorplan beta's buttons.

**A row's destructive action is quiet; the confirmation's is filled** (E38/F15/S01).
`.btn--secondary.btn--destructive` is the destructive intent at the secondary weight: red ink (`--mm-red`, 5.44:1 on white) on the secondary button's white and border, at 400, not a fourth intent.
A list of people with a filled red Remove on every row shouted the one action nobody came for; each such Remove now asks first, and the confirmation's own button is the filled `--destructive` one: Manage organization's and Manage market's people ([removing a person](business/flows/organizations.md#b3-remove-a-person), [managing who has access](business/flows/ending-and-managing-a-market.md#l3-manage-who-has-access)).
It keeps the `btn--destructive` class, so [a dialog](implementation/conventions/dialogs.md) still never opens on it.

**On a phone every target is 44px**, the size a thumb wants (T82).
The heights are tokens in `base.css`: `--control-height` (36px) for `.btn`, `.field` and `.add-row`, `--control-height-compact` (28px) for `.btn--compact`, and `--target-min` (24px, WCAG 2.5.8's floor), the least any other target may be: a tab, a link on its own line, a Show toggle, a Copy button, a choice's label, a disclosure's `summary` (the Notes toggle, "N more answers").
At `width <= 640px`, the app's phone break, all three are 44px, the app bar's own height, so a control that takes its height from a token is a thumb's size there with nothing of its own; a bespoke control takes `min-height: var(--target-min)` (and `min-width` where it is narrow) rather than a phone rule of its own.
Three exceptions take their minimum in a phone rule, since on a desk a 24px box would move the rows: `.answer-link--alone`, an answer that is only a link, its height, since on a desk the same link sits in a review card's line; the All view's row tick (`.all-tick`), its width, since on a desk a 24px square would push every row 11px right; and One by one's "Choose what leads the card" (`.choose-highlights-open`), its height, since on a desk it would push the card's verdicts 9px down.
A desk keeps its denser 36px and 28px.

**One disabled state**, and it does not rely on text contrast: the control keeps a readable foreground and loses its affordance, so it reads as unavailable rather than as unreadable. The product had four, one of which put white on `--mm-border` at 1.74:1.
A control drawn by a component of its own rather than a `.btn` takes the same values, `--mm-text-muted-on-beige` on `--mm-beige` inside a `--mm-border` line, and never opacity, which dims the words with the affordance: the floorplan wizard's Next, Save and Auto-Place and the application form's order arrows sat at 1.87 to 2.72:1 (T162).
A locked answer in Update info is drawn in the same state, whatever its control: a field, a tick list, the essential questions' choice rows and their ranking, each beige with muted ink, its chosen row marked by a `--mm-border` line rather than the applicant's mint; the Form preview, which shows what a vendor sees, keeps the applicant's look ([essential fields](implementation/modules/essential-fields.md)).
Such a control drawn with no line of its own carries a transparent 1px one at rest, as `.btn` does, so the line appears when it is disabled and nothing moves: Publish results drawn with `border: none` was a beige patch beside the bar's Publish market, which had a line.
The contrast sweep fails a shown disabled control drawn as a box, with a fill, that draws no line; a control drawn as words with no fill ("Resend code in 30s" on the vendor's sign-in) has no box to line, and a control in a disabled `<fieldset>` is out of it, since a settled plan is read as it stands, its calendar and fields as written.

**A field shows no focus at all**, by Daniel's decision on the 2026-10-29 walk (E38/F01/S01): no outline, ring, glow, or border or fill change on any `input`, `textarea` or `select`, by click or by Tab, and a text field shows its caret.
A browser treats a focused text field as `:focus-visible` whether it was clicked or tabbed into, so no rule could keep a ring for the keyboard alone, and Daniel chose this knowing a keyboard user loses it too; an accessibility pass does not put it back.
`primitives.css` sets `outline: none` on every focused field, so the browser's own outline does not appear either, and no component draws a ring around a field's box (`:focus-within`).

**A green border on every button**, Daniel's word on 2026-11-04 ("for focus for the buttons green border instead of the thick green ring"), over the soft halo the 2026-10-29 walk gave them: `--focus-border`, `--mm-green`, `--focus-border-width` (2px) wide, in `base.css`.
`primitives.css` draws it on `:focus-visible` on every `button`, `.btn`, `[role='button']`, `.add-row`, `.drag-handle` and `.step-button`, so a menu's item, a button drawn as a tab and a link drawn as a `.btn` draw it too.
It is an outline on the inside of the edge rather than a `border`, so it takes no room whatever the button's own border is, a text button's none included: focus moves nothing, it lies over the button's own border and leaves a resting shadow alone, no box that clips can cut it off, and it stays in forced colours, which drop a shadow.
A button the green would not show on, on a fill it is under 3:1 with or over a green border of its own, sets `--focus-border` to `--focus-border-on-fill` in the rule that draws it, a deep green: 3.62:1 on `--mm-green`, 3.05 on `--mm-red`; so the primary and destructive buttons, each screen's own green button, a pressed toggle and the Vendors page's open row.
On a dark ground, the vendor drawer's and the save dialog's close, it is the plain green, 3.39:1 on `--mm-black`.
A text button, with no fill, no border and no padding, would have it lie over its words, so it sets `--focus-border-offset` to the border's width in its own rule, and the border runs 2px clear around its words: a vendor's name, a seat's Change, a history entry's toggle, Payments' sorts, the first of a form's steps, which starts at its header's edge.
A text button whose border would cross what lies around it takes room inside its edge instead, given back so the words stay put: Show on sign-in and the password reset, inside its field, by that much of the field's own padding, so its box stays inside the field's padding and the input keeps its width.
A market card draws it for its name, whose own box is only the name, and lifts under the pointer alone, since focus moves nothing.
A button that is a shape of an SVG drawing, as a table of [a layout's map](#the-section-palette) is, draws the border itself (T257): a browser reads an outline's width there in the drawing's own units, a fraction of a pixel on a map in millimetres, so the table draws a shape over its own edge, turned with it, 2px on the screen at any zoom and never past the edge, in the deep green, since the edge it lies over is a section's colour, which the plain green shows on only by chance.

**A soft halo on every other control**, Daniel's choice on the same walk (E38/F01/S01): `--focus-halo`, a white 2px gap then a translucent green glow, in `base.css`.
`primitives.css` gives it to every link, `summary` and `[tabindex='0']` on `:focus-visible`, with no outline, so the browser's own ring is drawn nowhere.
Any other keyboard stop takes it from a zero-specificity rule beneath those.
A file input is drawn invisible inside the drop zone that stands for it, so the zone wears the halo while its input has keyboard focus (`:has(input:focus-visible)`): the zone marking its one control, not a ring around a field's box, and the focus sweep reads a file input as such a control.
A link's halo appears at once, corners and all: the global `a` rule in `main.css` eases `color` alone, where easing every property drew the halo square and rounded it over 0.4s (T181).
[`a-links-halo-appears-at-once.spec.ts`](../front-end/e2e/a-links-halo-appears-at-once.spec.ts) reaches each sign-in page's `.link-alone` by Tab at 390px and 1440px and reads its halo whole in the frame after focus.
The border and the halo hug what they mark: each takes `--radius-control` on any control that sets no radius of its own, through a `:where` rule that a control's own radius outranks, so a text link, a text button and a disclosure's `summary` wear it rounded rather than as a hard rectangle (T140); and a text control is as wide as its words, so what it wears is not the width of the row it sits in ("N more answers", a month's name in the dates card).
A tab whose underline is a bottom border curls that underline only while it is focused, as the vendor drawer's tabs do.
What a script focuses and Tab never reaches (`tabindex="-1"`), such as AppDialog's window when no control in it is ready, is not a control and draws nothing, the browser's ring included; a control among them, such as a menu's items, still shows its focus.
A box that clips what lies past its edge cuts a halo off, so a control that fills such a box wears `--focus-halo-inset`, the same halo drawn inside its edge: a [`ScrollBox`](#the-primitive-layer) when it is a stop, with `--radius-control`, since it clips what lies past its own edge and a dialog's window what lies past that.
Every control carries a `scroll-margin` of `--space-2`, so focus that scrolls it into view leaves its halo room inside the scroller, as a `ScrollBox` would otherwise cut off its last control's.
A link on a dark ground (the market bar's tabs) takes `--focus-halo-on-dark`, white at 35%, drawn inside the tab where the bar is narrower than the tabs and they scroll sideways on its lower edge (`--focus-halo-on-dark-inset`), since the scroller would clip it; and a component rule that gives a control a resting `box-shadow` outranks the shared rule, so it says `var(--focus-halo), <its shadow>` itself.
Measured, the green glow is 1.58:1 against white and 1.50:1 against beige, below the 3:1 WCAG asks of a focus indicator by Daniel's choice of look, since 3:1 takes about 77% green on white and 87% on beige, no longer a soft halo; and the dark halo is 3.17:1 on `--mm-black`, raised from the prototype's 28% (2.53:1), which looked the same.

**A selected row is the on toggle's look**, so selection and focus never read alike (T123).
A toggle that is on (`.btn[aria-pressed='true']` in `primitives.css`) is the one selected state the language had: a `--mm-chip-positive` ground inside a `--mm-green` border.
**A tap shows on the control, never as the browser's box** (T142): `base.css` turns off the tap highlight, which flashed a square light-blue box over a tapped control whatever its shape, and a `.btn` shows its press itself, its pressed fill under `:active`, a step past its hover's ([a fill of its own](#the-contrast-contract)).
The [Vendors page](business/flows/vendors.md)'s open vendor takes the same pair (`.vendor-row--open` in [`VendorsView.vue`](../front-end/src/views/VendorsView.vue)), where it drew a 2px black outline; its row keeps its own ink, and a focused row keeps its white ground and draws the green border.
The tint is a chip's own ground, so inside a selected row a chip keeps its ink on white, and its muted lines, the address under a name and the date count, take `--mm-text-muted-on-beige`, since `--mm-text-muted` is 4.27:1 on the tint; `contrast.test.ts` holds the row's text, its muted lines and its 3.75:1 border to the tint.

They were built in `E16/F04`, deliberately **after** `E16/F03` rewrote Market Setup, so they had a real consumer rather than a layout about to be replaced. **Nothing migrated onto them in that feature**: `E16/F05`-`F08` move one surface at a time.

## What keeps this true

A convention nothing enforces is how the product got here. Six checks, the first three in `E16/F01` and `E16/F02`:

1. **Stylelint** bans raw hex, a raw `font-size` in `px`, `rem` or `em` (the door code's print rule sets its sizes in `pt`), raw `border-radius` and a raw `box-shadow` outside `base.css` and the primitive files.
   It holds every `margin*`, `padding*`, `gap`, `row-gap` and `column-gap` to the spacing scale with `declaration-property-value-allowed-list`, by the values the [Spacing](#spacing) section lists, and [`spacingScale.test.ts`](../front-end/src/__tests__/spacingScale.test.ts) runs the real config over what it allows and refuses.
   `npm run lint:css` is the design-language gate, and **every rule is an error in every file**, with `--max-warnings 0` on the script as well: a warning CI let pass reached `dev`, and then landed on whichever later change touched the file (T221).
   Only the floorplan GUI's own values, it being a beta whose nearest token would change what it draws, and a value that is not spacing carry a `stylelint-disable`, with its reason on that declaration ([Spacing](#spacing)).
   The script refuses a disable with no reason, and one left with nothing to disable, as `reportDescriptionlessDisables` and `reportNeedlessDisables` in the config say.
2. **A custom-property resolution check**, `src/__tests__/everyTokenResolves.test.ts`, fails the build when any `var(--x)` references a property nothing defines. This is the one that matters: `var(--mm-text-red)` is not a raw value, it is a well-formed reference to nothing, and it rendered the market-archive confirmation button as white text on a white dialog with no border for as long as it existed. Stylelint cannot see that.
   **Never write `var(--mm-x, #fallback)`**, and the same test refuses one: a fallback on a defined token is a second definition waiting to drift, and on an undefined one it hides the bug.
3. **A rendered-usage contrast sweep**, [`e2e/contrast-sweep.spec.ts`](../front-end/e2e/contrast-sweep.spec.ts), walks each screen and fails on any text node below its AA threshold. The token test stays as well - it fails in milliseconds with a precise message when `base.css` changes, where the sweep would only say "something on the Applications screen went dark".
   It measures text as it is drawn: the colour's own alpha times every opacity up the chain, laid over the ground, since a line dimmed with `opacity: 0.8` drew the Vendors page's 4.59:1 green counts at 3.2:1 and passed while the sweep read colours alone (T162).
   On each screen it also fails a disabled control drawn as a box that draws no line ([one disabled state](#the-primitive-layer)).
   The measures are in [`e2e/helpers/contrastSweep.ts`](../front-end/e2e/helpers/contrastSweep.ts), and [`e2e/contrast-measure.spec.ts`](../front-end/e2e/contrast-measure.spec.ts) shows them fixture pages, each defect they are meant to catch and its quiet twin.
   `contrast.test.ts` asserts tokens, not usages, and that gap has been occupied: a token exempt from the contract because it never carries text (`--mm-border`) was used as a button fill under white text at 1.74:1.
4. **An accessibility sweep**, [`e2e/accessibility-sweep.spec.ts`](../front-end/e2e/accessibility-sweep.spec.ts), runs axe (`@axe-core/playwright`) over the same states and fails on any WCAG 2.0, 2.1 or 2.2 A or AA violation it can see, naming each one's rule, impact and target.
   Its configuration is the `expectAccessible` fixture in `e2e/fixtures.ts`, which also holds the app to exactly one `main` landmark; axe's `color-contrast` rule is off there, since the contrast sweep owns contrast and one defect should fail one check.
   It landed with what it found fixed (T75): an empty `<html lang>`, no `main` landmark, a market row that was a `role="button"` around its own Manage button, a calendar marked as an ARIA grid with no rows, an unnamed close button on the navigation drawer, and buttons whose `aria-label` replaced the words on them ([every control is named](implementation/conventions/every-control-is-named.md#the-rules)).
   An automated check finds some WCAG failures, not all of them: a pass is a floor, not a verdict.
5. **A layout sweep**, [`e2e/layout-sweep.spec.ts`](../front-end/e2e/layout-sweep.spec.ts), measures every state at each size it ships at (1920x1080 and 1440x900 for an organizer's screen; 1920x1080 and 390x844 for a public page; all three for a screen that fits a phone, the `FITS_A_PHONE` list in [`e2e/helpers/screens.ts`](../front-end/e2e/helpers/screens.ts)) with the detectors in [`e2e/helpers/layoutDetectors.ts`](../front-end/e2e/helpers/layoutDetectors.ts) (T79, from T67's trial).
   It fails on the kinds that raised nothing false over the whole app: the page or an element past the window, a child outside its parent, text clipped by its box, text or controls drawn over each other in one layer, text squeezed into a column (three or more lines of ten characters or fewer), type off the type scale, a scroller without a shade, and a tap target under 44px on a phone, a disclosure's `summary` among them, a control's visible label counting toward its target and a link inside a run of text exempt, unless it is drawn as a block of its own (T142).
   Each failure names the state, the size, the element and the measurement.
   It also fails when the market bar stands at a different x or width on one market screen than on the others of its size, which no screen can see alone (bug 12), and when it found the bar on fewer than two market screens of one size, so a renamed test id cannot leave that check passing on nothing.
   On a phone it fails when a market screen pins more than its window's top 150px, naming the screen and the measurement: `pinnedBottom` scrolls the page by a window's height, or to its end, and takes the lowest bottom of the app bar and whatever is `sticky` or `fixed` at its `top`, a dialog, a drawer, a scrim or the app bar's open sheet aside, and the door pinned 409px of 844 until only [the market frame](implementation/modules/market-frame.md#sharp-edges)'s bar pinned there (T142).
   The sweep landed gating a phone target at WCAG 2.5.8's 24px, with about 75 phone controls under 44px (36px buttons and fields, 28px day buttons on phone attendance), and T82 raised them to 44px through the tokens above and the gate with them.
   The noisy kinds (spacing off the scale, uneven gaps, edges 1 to 4px apart, empty bands, truncated names, nested scrollers, small targets on a desktop) are real drift mixed with what is by design, so each test attaches them as a `layout report` and never fails on them; the spacing scale is Stylelint's to hold.
   `scroller-without-a-shade` gates (T217): it names what really scrolls, other than the page and a text control, that draws a bar, is not a `ScrollBox`'s own scroller, or is a `ScrollBox` down that also scrolls sideways with no shade to say so, which sees what the source guard cannot, a scroller made by a binding or a script.
   [`e2e/layout-detectors.spec.ts`](../front-end/e2e/layout-detectors.spec.ts) proves each gating detector fires on a fixture of its defect, and that none fires on a page that only looks broken: a stuck bar over scrolled content, screen-reader-only text, an ellipsis with its title, a closed `<details>`, a menu over the page.
   It proves a link in a sentence is exempt as a target and one drawn on a line of its own is not.
   It proves an overlap is measured on the part of each box that shows past its clipping ancestors, so a control scrolled half out of a dialog's body overlaps nothing past that body's edge.
   It proves a text scrolled past its box keeps its own edge for the edge check, so it slips against nothing once it is scrolled.
   It proves `scroller-without-a-shade` fires on each defect, a bar, a scroller outside a `ScrollBox` and a `ScrollBox` down that scrolls sideways, and on a bare scroller nested inside one, that it is quiet on a `ScrollBox`, the page and a text field, and that it gates.
   It proves `pinnedBottom` counts a pinned header and a block pinned under it, and not a block that scrolls away, one that sticks only sideways, or an open drawer or dialog.
   It holds the sweep's phone break to `base.css`'s by rendering sign-in on each side of it: at the widest width the sweep calls a phone, the sign-in button is 44px tall and `--target-min` 44px, and a pixel wider they are 36px and 24px.
   It landed with what it and the newly walked states found fixed: the form's step list hung 8px outside its header, a long web address in an answer ran 108px past a phone, the sign-in and reset fields and their Show buttons were 20px and 15px tall inside their 36px boxes, the standalone back links and the rail's addresses were 18px and 19px tall, and on states the other sweeps had never opened, role badges and "Results Published" on translucent tints, the import's hint on beige, the verification error in raw `red`, an unmarked link in a note, and the start page's coloured words on black.
6. **A focus sweep**, [`e2e/focus-sweep.spec.ts`](../front-end/e2e/focus-sweep.spec.ts), presses Tab through every state (E38/F01/S01), with [`e2e/helpers/focusSweep.ts`](../front-end/e2e/helpers/focusSweep.ts)'s judge, Tab walk and menu walk.
   A field it lands on must look as it did unfocused, it and the two boxes around it.
   A button must draw the green border and no halo, inside its edge and not over its words, or 2px clear around them on a text button with no fill or border and inside the window, at the size it had at rest, in the deep green where the plain green is under 3:1 with the fill beneath it or the button has a green border of its own; a box up to four levels around it may draw the border for it.
   A button that is an SVG shape must instead show a shape of its own marked `data-focus-border`, its stroke 2px with `vector-effect: non-scaling-stroke` and in the deep green, at the size the button had at rest.
   Any other control must draw no outline and the halo for its ground: white at 35% where the first ancestor with a fill is dark, the green halo elsewhere.
   A file input is a control, not a field, since nothing is typed into it and the drop zone around it wears its halo.
   It moves the pointer to the window's corner before it reads how the fields look unfocused, since a focus that scrolls a dialog's body can bring the box around the focused field under a pointer left there, and that box's hover fill read as a look focus drew (T180).
   Both must have rounded corners, no box that clips what lies past its edge may cut either off, and a text control with no fill or border may be no more than 24px wider than its words and its padding, room for a disclosure's marker.
   A box clips only what is placed inside it, so the clip check climbs the chain of containing blocks: a positioned box holds what is placed absolutely, and a box with a `transform`, `translate`, `rotate`, `scale`, `perspective`, `filter` or `backdrop-filter`, a `will-change` naming one of them, a `contain` of `layout`, `paint`, `strict` or `content`, or a `container-type` of `size` or `inline-size` holds what is placed fixed or absolutely.
   A menu's items are no Tab stop, so in every state it opens each menu with Enter on its button (`aria-haspopup="menu"`) and judges each item it reaches with the arrow keys; Enter, and each arrow key that moves to the next item, must land focus on a `[role='menuitem']` of the menu it opened, or the sweep names the menu, its button and where focus is, so a menu that keeps focus on its button cannot pass.
   [`e2e/focus-sweep-detectors.spec.ts`](../front-end/e2e/focus-sweep-detectors.spec.ts) proves them on fixtures: a halo at the edge of a box that holds it through each of `transform`, `filter`, `will-change: transform` and `contain: paint`, placed absolutely and fixed, is caught, as is one in a static box around a transformed box that holds it, and one in a static box is not; a menu whose arrows leave focus on its button is caught, and a working one passes; and a drop zone that shows no focus for its file input is caught, and one that wears the halo passes; and a button that wears the halo, draws its border outside its edge or over its words, draws the plain green on a green fill or its own green border, draws the deep green where the plain shows, or is resized by focus is caught, as is a text button whose border is cut off by a box or runs off the window, and a button, a text button clear of its words or a card around one drawing it rightly passes; and a drawn button, an SVG shape, with no border shape of its own, with one in the drawing's units or in the plain green, or with one reaching past its edge is caught, and one drawing the deep green over its edge passes.
   [`e2e/a-focused-button-moves-nothing.spec.ts`](../front-end/e2e/a-focused-button-moves-nothing.spec.ts) reads each button and the boxes around it focused and at rest, on the library's primitives and on Markets, at a desk and on a phone.
   `focus-sweep-detectors.spec.ts` also proves that `alsoAt` adds its size to a copy of a screen's sizes, so a sweep's added size never reaches the sizes another sweep walks, which screens share.
   It walks each state at a phone's width too, as well as at its first size: an organizer's screens ship at a desk, but a desk zoomed to 400% is that narrow, and there a table too wide for its box scrolls and becomes a keyboard stop of its own; a state that cannot be walked that narrow is marked `deskOnly`.
   Each dialog window a state shows is focused as a keyboard user's would be and must draw no outline, a window behind another dialog on top aside, since it is inert (T148), and a test opens Manage market from the keyboard, where the window takes focus while the market loads (T140).
   Its phone walk found a dialog's buttons running out past the window's left edge where they were wider than it, and the actions row now wraps.
   It landed with what it found fixed: the seat buttons' and the drawer tabs' own rings, and the buttons whose own `box-shadow`, `none` included, outranked the halo they then wore: the start page's, New market, New organization, the vendor rows, and the floorplan's Save & Continue and Sections buttons.
   It needed the floorplan wizard walked at each step with a plan uploaded, which the other sweeps then walked too, and they found the beta's step labels below AA on their beige, its progress bar with no name and an invalid value, its empty table types in a 40% grey, and its Export PNG button named something other than its words; all are fixed.

The sweeps are only worth the states they walk. The invisible archive button was missed by a twenty-screen pass because nobody opened that dialog, and T67's layout trial missed a market row's squeezed dates until it opened a market first; **dialogs, menus, drawers, hover states, disabled controls, empty states and remembered state have to be walked deliberately.**
All four sweeps walk one list, `SCREENS` in [`e2e/helpers/screens.ts`](../front-end/e2e/helpers/screens.ts), through `walkTheScreens()`, and each passes only its own check, so a state added for one is walked by all.
The list holds these states, one a line, each beside the state it is most like, so a new state is one line there, not at the list's end ([two features never share a line](implementation/conventions/two-features-never-share-a-line.md#the-design-language)):

- the router's routes
- the dialogs, menus and drawers
- `/markets` with a market remembered, one gone with others left and with none, and with no market yet
- every phase
- the phase rail at 390 in every phase the seed holds, both intake paths among them
- `/markets` and the Assignments page with their dialogs at 390
- Vendors and Payments with their dialogs and drawers at 390, Payments priced and unpriced
- the vendor drawer at the door on each of its tabs at 390
- an Editor's Update info with its essential questions locked
- settled rules
- a location's layout past draft, at its upload step and calibrating
- a location's layout drawn as its map, with 20 tables
- the signed-out pages

They are walked over a stress seed ([`e2e/helpers/seedTheScreens.ts`](../front-end/e2e/helpers/seedTheScreens.ts)) of long names, 40 applications in every review state, a review divided between two reviewers and 36 vendors over four dates and three sections, since a layout that holds on three short names breaks on a real market.
Contrast and axe measure each state at its first size, focus at its first size and a phone's width, and the layout sweep at every size.

## Evidence

The contrast contract rests on an audit that measured every colour on the grounds the product paints on (wayfinding/readable-journey/03): four text colours failed, `--mm-yellow` at 2.15:1, `--mm-grey` at 1.67, `--mm-green` at 2.65 and the hard-coded `#2196F3` link at 3.12, with `--vt-c-text-light-2` a near miss at 4.06; `--mm-grey` was text at 18 sites and a border or fill at 57, which is what made splitting it cheap.

## Superseded

- White text on `--mm-yellow` was to reach AA like every other fill (wayfinding/readable-journey/03); yellow is a black-text fill, and the contract asserts white is never put on it (E09/F01).
- `--list-max` was to hold a market's Tables, Vendors and Attendance (wayfinding/claims-and-room/01); every market screen is the workspace width, set by the frame (E22/F04/S01).
- A row's panels were to stay even by stretching to the tallest (`align-items: stretch`), which is why no minimum row height was needed (wayfinding/claims-and-room/01); a card ends at its own content in the card grid (E23/F01/S01).
- Every primitive was to show a 2px `--mm-black` focus ring at 2px of offset, fields included (E16/F04); a field shows no focus and a control the soft halo (E38/F01/S01).
- Every control, buttons among them, was to wear the soft halo (E38/F01/S01); by Daniel's word on 2026-11-04 a button draws a green border, and links and the other stops keep the halo.
- A `.btn` was to show hover and press by `opacity`, 0.9 and 0.8 (E16/F04, T142); it darkens its fill a step for each, since the opacity faded its words below AA (T229).
