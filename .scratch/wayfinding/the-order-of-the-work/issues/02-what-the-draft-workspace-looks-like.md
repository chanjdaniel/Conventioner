# 02: What does the draft workspace look like once the order is known?

Type: grilling
Status: resolved
Blocked by: 01

## Question

The draft state shows every decision about a market at once, and the plan cards are too small for the controls they hold.

**The cards being too small is recorded in the source, not merely felt.**
The comment above `.plan-row--triple` in `MarketSetupView.vue` documents the previous round of this fight: equal thirds gave Section Setup - which needs 654px for four columns plus a delete control - the same 460px as Location Setup, which needs 278px, and the consequence was the Tier select rendering 65px wide so every tier read `Pr...`, `St...`, `Co...` on the field that sets a vendor's price.
The current `0.78fr / 0.69fr / 1.53fr` split is a negotiated truce, not a solution.

**One card is stranded the other way.**
Market Dates sits alone on `.plan-row--single`, so it has the full panel width, and displays one date per row growing downwards - a tall narrow column of single values in a very wide box.

### What to decide

**Whether the draft state becomes a step-by-step guided workflow, and what each step's control looks like.**

Sub-questions:

- **Is it linear or resumable?**
  An organizer leaves a draft and comes back.
  The workflow must be re-enterable at any step and must not force a walk-through to change one value later.
- **What does it become once the market leaves draft?**
  The plan stays editable in later phases.
  Does the workspace revert to an all-cards view, or does the guided form persist?
  Two layouts for the same data is a maintenance cost that has to be chosen deliberately.
- **How does it relate to the phase rail?**
  The rail already communicates progress *between* phases.
  A second progress indicator *within* draft risks reading as a competing lifecycle.
- **What is the right control for choosing market dates?**
  A calendar with the market's days marked, a horizontal run of date chips, a compact range picker with exceptions, or something else - and does the answer differ for a two-day market and a twelve-day one?
  A guided step gives the control the full width, which changes what is possible here.

### Notes

A guided workflow gives each card the whole width, which **dissolves** the sizing constraint above rather than rebalancing it.
That is the strongest argument for taking this ticket rather than tuning the grid again.

**Precedent to reuse or depart from deliberately:** the floorplan wizard (`front-end/src/components/floorplan/`) is already a multi-step guided workflow in this codebase.
Two unrelated wizard idioms in one product is the `E16` mistake in a new place.

**One fix rides on this ticket.**
`F05` - the Market Dates picker opening on the left of the field - is about today's row control.
If this ticket replaces that control, `F05` is answered by the rewrite; if the ticket sits, `F05` should be fixed on its own.

Findings: `Q4`, `Q1`, `F05` in `.scratch/qc/2026-09-21-manual-qc.md`.

## Answer

**One scrolling page whose sections run in dependency order, each at full width, with the application form gated until the plan offers something.**

Not a step wizard.
The ticket's own constraints rule one out: the surface must be resumable, and it must not force a walk-through to change one value later.
A single ordered page satisfies both - every section is directly reachable, and the order is communicated by position rather than enforced by navigation.

It also **survives into later phases unchanged**, which answers the ticket's "what does it become once the market leaves draft?"
The plan stays editable after `draft`, and this layout stays correct there: the sections simply stop being gated.
There is one layout for this data, not two.

### The order on the page

1. **Market Dates**
2. **Tier Setup**
3. **Location Setup** and **Section Setup**
4. **How vendors apply** - the intake-mode control, from [ticket 09](09-who-can-reach-the-public-application-url.md). It belongs here because it decides what the form is *for*, and it is settable in `draft` only.
5. **Application form** - gated, with the gate stating the reason rather than merely disabling.
6. **Open applications** - the forward transition, which is also the finalize ([ticket 03](03-what-finalized-means.md)).

Assignment Priority and Assignment Options are **not** on this page.
They left for the `assignment` surface in ticket 01.

### The gate on the form section

`FormHasFieldsGuard` already computes exactly this condition - plan-derived asked keys - and `application_write._asks_nothing()` reads the same rule.
The section gate must read that same statement, not count custom fields.
CLAUDE.md is explicit that a layer asking "does this market have a form?" by counting custom fields is the bug that let a market open applications and then refuse every application it received.

The gate says *what is missing*, in the plan's own words: no dates, no tiers, fewer than two sections.
That is the difference between a guided page and a disabled one.

### Market dates: a calendar with the market's days marked

Click a day to add or remove it.

- It uses the width a full-page section gives it, which is what [`Q1`](../../../qc/2026-09-21-manual-qc.md) was about - one date per row growing downwards, stranded in a wide box.
- It reads the same for a two-day market and a twelve-day one, which a stacked list does not.
- **It dissolves `F05` entirely.** There is no native `<input type="date">` and no `showPicker()`, so there is no popup to position and no invisible full-width overlay to work around. `F05` is answered by this rewrite and should not be fixed separately.

**The sharp edge it must respect:** a market date is a calendar day, not an instant.
CLAUDE.md records that `getFormattedDate` formats with pure UTC math and that a market date must never be parsed through `new Date()` with an offset.
`front-end/e2e/date-display-timezone.spec.ts` pins this across Honolulu, LA and Tokyo, and a calendar widget - which does month arithmetic, not just formatting - is the most likely place to reintroduce the bug.
Build it against that spec.

### Consequences

- **The sizing fight is over, not rebalanced.** `.plan-row--triple`'s `0.78fr / 0.69fr / 1.53fr` was a truce between Section Setup needing 654px and Location Setup needing 278px in equal thirds. Full-width sections remove the contention, and the tier select that rendered 65px wide stops being a layout problem.
- **`E17/F02`'s settings-panel gutter (`F04`) still lands**, because it ships before this and MVP serves the current panel today. It is a one-line fix, not wasted work.
- **The floorplan wizard stays the product's one wizard idiom.** This page deliberately is not a second one.
