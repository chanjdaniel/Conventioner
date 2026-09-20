# 01: How does an organizer screen size itself?

Type: grilling
Status: resolved
Blocked by: -

## Question

Four screens make up the market workspace and none of them agrees with the others about how big it is.

- **Market Setup** is `.market-setup-body { width: 80%; height: 80% }` - 1536 x 864 at the design target, pinned to the viewport whatever it contains.
- **Tables**, **Vendors** and **Attendance Status** are each `max-width: 1100px`, growing to their content.

The 80% cap is the finding.
At 1920x1080 the plan editor gives its content **548px of the 1100px it has** and hides the other 552 behind an inner scroller, while ~190px above and ~190px below the card stay permanently empty and the outer page cannot scroll at all.
The assignment tab is the same: **537 of 1058**, hiding 521px, which puts Per Tier, Per Table Choice and the whole Placement history below the fold on arrival.
Both tabs nest a *second* scroller inside a panel, hiding a further 38px and 311px.

`git log -S "height: 80%"` dates it to 2025-02-18, *"began work on market setup page"* - the first commit of that view.
It is scaffolding nobody chose, and E10/F02/S01's stated outcome - *"dates, then tiers and sections, then the options, all in view at once"* - is false at the design target because of it.

Two more findings are the same question from other angles:

- **A panel reserves 320px for one row.** `.setting-container { min-height: 320px }` gives Market Dates ~300px of empty space under a single date, inside a card already capped. It is the largest consumer of the 548px the plan gets.
- **Section rows truncate the tier that sets their price.** `plan-row--triple` resolves to three equal 460px columns. Tier Setup needs ~250px and gets 460; Section Setup packs four columns and a delete control into the same 460, so it renders "Sil..." for *Silver* and "Garde..." for *Garden Room*. Measured: tier select 69px wide with ~38px for text, "Bronze" needs 44.4px; location select 94px with ~63px, "Garden Room" needs 87.9px.

### What to decide

**One sizing model for an organizer screen**, which answers all four at once and stops the fifth instance.
Roughly: a card of width *W* that grows to its content while the page scrolls, which is what three of the four screens already do.

The parts that are actually open:

- **What is W?** 1100 visibly shrinks Market Setup; 1536 visibly widens three screens; fluid-with-a-max is a third answer. The plan editor holds three side-by-side panels and the payoff screen holds a 3-up grid, so they may not want the same width as a single-column vendor list - in which case the model is a rule about *how* rather than a single number.
- **Does any panel keep a minimum height?** A one-row Market Dates panel at its natural height looks thin next to a three-row Section Setup. That may be fine, or it may be why the 320px exists.
- **Do the three plan columns stay equal?** Sizing them by need fixes the truncation; whether that is a per-row template or a general rule for the workspace is the decision.

### Notes

The previous map left this in its fog and it never graduated: *"The Tables view and Attendance Status share a shape... Whether anything else in the app shares it, and whether that warrants a structural answer rather than a third instance fix, only sharpens once the Tables fix lands and shows what else uses those class names."*
The Tables fix landed. What else uses the shape is now known: the whole workspace does, and Market Setup is the outlier.

Do not re-litigate the target width of 1920x1080 - settled on the previous map, ticket 06.
The check-in page is out of this ticket's scope: it is not an organizer screen and keeps its phone requirement.

Findings: F2, F3, F4 in `.lavish/qc-2026-09-20.html`.

## Answer

**Two named widths, no height cap, no minimum row height, and plan columns sized by need.**

```
--workspace-max: 1440px   /* Market Setup and its four tabs */
--list-max:      1100px   /* Tables, Vendors, Attendance, Markets, Organizations */
```

A screen is a card of one of those two widths that **grows to its content while the page scrolls**.
`height: 80%` is deleted. `min-height: 320px` is deleted. `.plan-row--triple` stops being equal thirds.

### Why two widths and not one

Measured at 1920x1080 on 2026-09-20 by lifting every cap and asking each panel for its `max-content` width.
The content clusters into two groups and **nothing wants 1536**:

| Screen | Content wants |
| --- | --- |
| Plan, triple row | Tier 324 + Location 278 + **Section 654** + 2 gaps = **1316** |
| Plan, asymmetric row | Priority 381 + **Options 859** + gap = **1270** |
| Assignment statistics | **1129** |
| Tables date groups | 1037 |
| Vendors rows | 1033 |

One width for both puts a 1,035px vendor list in a 1,440px page, which makes the Markets row's own
problem worse - it already caps its name cell at 320px inside an 1840px row and leaves 1,455px empty.
Two widths named by *what they hold* also makes the existing 1100 principled rather than arbitrary,
and pulling Markets and Organizations in from 1840 dissolves most of that finding for free.

### Why 1440 and not 1360

1360 was the first answer, taken from the content alone (1316 + margin). It is wrong, and a decision
on the previous map already said so: [readable-journey ticket 06](../../readable-journey/issues/06-where-the-check-in-url-lives.md)
measured the rail's break as *"between 1366 and 1440"* and picked 1536 partly for it.

Re-measured here on the shipped rail, on a published market, by stepping the card width:

| Card width | Rail height | |
| --- | --- | --- |
| 1100 | 111px | wrapped |
| 1280 | 111px | wrapped |
| 1360 | 120px | wrapped |
| **1440** | **62px** | **one row** |
| 1536 | 62px | one row |

**The break is exactly 1440.** 1440 satisfies the widest content (1316) with 124px of comfort *and*
keeps the rail on one row. It costs 80px over the content-only answer and removes a whole class of
problem from every workspace screen.

### Why no minimum row height

`min-height: 320px` is on `.plan-row`, not `.setting-container` as this ticket recorded - it applies
to every row. It costs **268px of nothing on the emptiest possible market** and 69px on a real one.

Two reasons to delete it beyond the waste:

- **The rule's own comment already states the intended model**: *"Each row sizes to its own content;
  the page scrolls, not the rows."* The 80% cap is what makes that false.
- **The worry it exists for does not apply.** Panels in a row are already equalised by
  `align-items: stretch`, so the floor only sets the minimum of the *tallest* panel. Deleting it
  cannot make a row ragged.

And no floor decision saves the cap either way: **even the emptiest possible plan is 812px tall in a
521px window.**

### Why the columns stop being equal

`repeat(3, minmax(0, 1fr))` gives Section Setup - which needs 654 - the same 460 as Location Setup,
which needs 278. That is the sole cause of the Tier select rendering at 65px, unable to display any
of the three values it offers ("Premium" needs 56px of the 34px it has; "Community" needs 71px).

The codebase has already accepted unequal columns: `.plan-row--asymmetric` is `3fr 2fr`. At 1440 with
two 30px gaps, 1,380 is available and the content fits with room: Tier 340, Location 300, Section 660.

**Consequence: nothing else should fix the tier select.** It is not a widget bug.

### What this does not settle

The rail wraps on the three `--list-max` screens, and that is now a ticket of its own rather than fog:
[07: Why is a published market's rail four times taller?](07-the-rails-second-row.md).
Measured cause: with the check-in chip the rail is 111-120px below 1440; **without it the rail is 27px
at every width from 1100 to 1440.** The chip is the entire cause, and it is on the rail because
readable-journey ticket 06 put it there deliberately.

### Buildable work

`E16/F03` - [The sizing model](../../../backlog/E16-one-design-language/F03-the-sizing-model/feature.md).
The two width tokens are recorded in `docs/design-system.md` under "Layout", which is where the rest
of the design language lives.

This resolution also absorbs, and closes without separate work, four findings from
`.lavish/aesthetics-2026-09-20.html`: **H1** (the tier select), **H10** (column headers styled as
inputs - they are the header row of a grid that is being rebuilt), **H13** (content cut mid-row) and
**O1**/**O2** (four page widths, and the 320px name cell).
