# Map: The plan uses its space

Status: closed 2026-09-26 - the way is clear.

Charted 2026-09-26, from Topic 2 of the [2026-09-26 brain dump](../../brain-dump/2026-09-26.md).

## Destination

The plan screen reads at 1920x1080 without stranded width: every card is sized to what it holds and shares a row when it fits, by one written rule in `docs/design-system.md`.
The brain dump's two ideas (market dates as a calendar beside a list of the chosen dates, tier beside location) are its first two cases, and the rule says what happens when cards stop fitting on a narrower window.
The way is clear when nothing remains to decide before that can be built; the epic [E23 The plan uses its space](../../backlog/E23-the-plan-uses-its-space/epic.md) is the by-product.

## Notes

**Where this came from.**
Two brain-dump ideas about Market Setup: the market dates card leaves most of its width empty, and Tier Setup and Location Setup are each far wider than the little they hold.

**Skills every session should consult.**
`grilling` and `domain-modeling` by default; `prototype` where the ticket says so.
`docs/design-system.md` and AGENTS.md's **The Design Language** are authoritative: two screen widths (`--workspace-max`, `--list-max`), the page scrolls, and a value not in the design system does not belong in a component.

**This map is planning.**
Resolving a ticket produces a decision, not a deliverable.

### Settled while charting

- **One rule, not two rearrangements.** The design system names two screen widths but says nothing about how cards share a row, which is why every plan card has a row to itself.
  A local fix for dates and another for tiers would leave the next card to decide again.
- **Narrow windows are in scope**, because the rule must say what happens when two cards stop fitting side by side.
- **No plain fixes were found** on the live screen at 1920x1080 or 1280x800; everything off about it is the subject of the tickets.

**What the plan is today** ([1920x1080](plan-1920.png), [1280x800](plan-1280.png)).
Six full-width cards, one per row: Market Dates, Tier Setup, Location Setup, Section Setup, How vendors apply, and a one-line Application form card.
Market Dates is a 400px calendar centred in a 1330px card, with the chosen dates as chips centred under it.
Tier Setup and Location Setup each stretch one short name across the whole card, centred; Section Setup is the one card whose columns (name, location, tier, count) use the width.
Their inner gutters also disagree by 6px (Tier's rows start further in than Location's and Section's), which the rule should settle rather than a one-off fix.

## Decisions so far

<!-- one line per resolved ticket -->

- [01: How do plan cards share a row?](issues/01-the-row-rule.md):
  **a two-column grid; a card is half unless it declares itself wide; cards end at their content; one track below 900px; one inner gutter.**
  On the plan, Dates and Section are wide, Tier sits beside Location, and How vendors apply beside Application form. Written into `docs/design-system.md`.
- [02: How do the market dates sit beside their calendar?](issues/02-market-dates-beside-their-calendar.md):
  **the calendar at 360px on the left, the chosen dates on the right grouped one line per month**, with a count, a × per day, and a month that moves the calendar to it.

## Not yet specified

Nothing. Every question on this map is resolved; the way to the destination is clear and the work is in `E23`.

## Out of scope

- **Applying the rule to other screens.** The Assignment tab's Rules page is being redrawn on [the-assignment-tab](../the-assignment-tab/map.md) and may adopt the rule there; this map writes the rule and applies it to the plan.
- **What the plan asks for.** No field is added to or removed from the plan; this is layout only.
