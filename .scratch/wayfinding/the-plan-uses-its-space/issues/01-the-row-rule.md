# 01: How do plan cards share a row?

Type: prototype
Status: resolved
Blocked by: -

## Question

What is the one rule that decides how plan cards share a row, and what does it do when they stop fitting?

The prototype must answer by showing, on the real Market Setup route with real markets at 1920x1080 and at 1280x800:

- **Candidates for the rule.** At least: a grid where each card declares a minimum width and cards fill a row until the next would not fit; fixed pairings written per screen (dates alone, tier beside location, section alone); and a two-column layout that stacks below a breakpoint.
  Which one needs the fewest decisions from the next card someone adds?
- **Tier beside Location**, the brain dump's case, and what their rows look like once each is half as wide (the names are centred across the whole card today).
- **Uneven heights.** Two cards side by side with three tiers and nine locations: does the shorter one stretch, or end, and does the next row start under the taller?
- **The narrow case.** Where, and how, a shared row becomes two rows.
- **One inner gutter.** Tier's rows start 6px further in than Location's and Section's today; the rule should leave one value for every card.

The answer is written into `docs/design-system.md` as the rule, not only applied to the plan.
Start from the [1920x1080](../plan-1920.png) and [1280x800](../plan-1280.png) screenshots.

## Answer

Prototyped and decided 2026-09-26.
The prototype is primary source on the local branch `prototype/plan-row-rule` (commit `be1d8163`): three rules on the real Market Setup route, switched by `?variant=A|B|C` with `none` for today, shown on seeded "Proto Plan Busy" (20 dates, 3 tiers, 9 locations, 6 sections) and "Proto Plan Small" markets at 1920x1080 and 1280x800.

| | Rule | What it showed |
| --- | --- | --- |
| A | Two-column grid; a card is half unless it declares itself wide | The same shape at every width: Tier beside Location, Intake beside Form, Dates and Section full. |
| B | Two columns by purpose: the market (dates, intake, form) and the venue (tiers, locations, sections) | At 1280 the tier selects in Section Setup truncated to "Commun…", the very bug `MarketPlanTab`'s history records; and a hole under the shorter column. |
| C | Each card declares a content width; a row packs what fits | Densest at 1920 (Dates, Tier and Location on one row), but the screen changes shape with the window: at 1280 Location leaves Tier to sit beside Section. |

**Rule A, with cards ending at their own content.**

- **The rule**, written into `docs/design-system.md`: *a screen of cards is a two-track grid; a card is half unless it declares itself wide; a card ends at its own content; below 900px of room it is one track; every card has the same inner gutter.*
  One declaration per card, so the next card added decides nothing else, and the screen keeps its shape at every width.
- **On the plan**: Market Dates and Section Setup are wide; Tier beside Location; How vendors apply beside Application form.
- **Uneven heights end at content**, not stretched: blank space inside a card reads as something missing, and a ragged row bottom reads fine. The prototype's stretched Tier card (blank under three tiers, beside nine locations) is what decided it.
- **One inner gutter.** Tier's rows sit 6px further in than Location's and Section's today; the rule leaves one value.

Buildable work: [E23/F01 Plan cards share a row](../../../backlog/E23-the-plan-uses-its-space/F01-plan-cards-share-a-row/feature.md).
The dates card's own layout is [02](02-market-dates-beside-their-calendar.md)'s, inside the full width the rule gives it.
