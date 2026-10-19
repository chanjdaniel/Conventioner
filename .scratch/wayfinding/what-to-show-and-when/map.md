# Map: What to show, and when

Status: closed

Charted and closed 2026-10-18, from the [2026-10-18 brain dump](../../brain-dump/2026-10-18.md).

## Destination

At every phase of a market, the organizer can see what to do now and what comes next, without having to know the product.
What a screen shows depends on the market's phase and on how vendors reach it: applying on the market's own page (`intakeMode: form`), or applying on the organizer's Google Form and arriving by CSV import (`intakeMode: csv`).
Each of the two paths reads as its own sequence, not one shared sequence with the other path's steps left in.
The way is clear when nothing remains to decide before that can be built; an epic in `.scratch/backlog/` is the by-product.

## Notes

**Where this came from.**
The organizer finds that many features work but the UI does not say what to do and when.
The phases and their tracking are right and are not up for change; what is shown in each is.

**Skills every session should consult.**
`grilling` and `domain-modeling` by default.
`AGENTS.md` is authoritative on the sharp edges this map touches: **Intake Mode**, **The Phase Rail**, **One Market, From the Server**, **Essential Form Fields**, **Application Form Lock** and **Placements, Pins and the Trail**.

**What already locks, and when** (as of `dev @ f1f8bc40`).

- The **name** and the **intake mode** change only in `draft`.
- The **application form** changes only in `draft` and only while no application exists.
- The **form's offering** (dates, sections, table types) follows the plan until the first applicant save, then is snapshotted onto the form and no longer follows it.
- The **assignment rules** (priority, ceiling, half-table share) close once the market can no longer reach `assignment`, so in `offers`, `market_days` and `archived`.
- **Everything else in the plan** - dates, sections, tiers, table counts, the floorplan - saves in every phase but `archived`.
  Nothing stops a date being removed after vendors chose it, or a section emptied after they were placed in it.

**The phases** (`back-end/guards.py`): `draft` -> `applications_open` <-> `applications_closed` <-> `review` -> `assignment` -> (`offers`) -> `market_days` -> `archived`, with `applications_open` -> `draft` while no application exists.
A CSV market walks the same phases; its import runs in `applications_open` and `applications_closed` (`IMPORT_PHASES`).

### Settled while charting

Round 1 of the grilling, 2026-10-18.
These frame every ticket and are not open for re-litigation without redrawing the destination.

- **What the map covers.** The mission, and anything that changes what a screen shows or allows, the setup freeze included.
  Plain fixes go straight to the backlog; a future feature big enough gets a map of its own.
- **The market setup freezes at one point: leaving draft.**
  Not in stages by what depends on each part; one point the organizer can learn.
- **The two paths may differ in which tabs and pages exist, not only in what they say.**
  A phase or tab label that means something else on the CSV path says what it means there, and a page with no job on a path is not offered as if it had one.
- **A screen says what to do now in two ways.**
  One next-step statement per phase and path, decided in one place (as `currentPage` is), naming the one action and why.
  And tabs do not disappear: a tab out of its phase is read-only, with a line saying when it matters.

Round 2, 2026-10-18:

- **The freeze covers everything on Market Setup**: intake mode, dates, locations, sections and their table counts, tiers, the floorplan.
  The room is therefore final before applications open.
  The assignment rules are not setup: they keep their own lock (`assignment_rules_lock_reason`).
- **Nothing gets past the freeze** but the existing way back to draft, open only while no application exists (so on the CSV path, until the first import).
  A venue that changes after that is a future feature, built when a real market needs it.
- **The next-step statement lives in the phase rail**, on every market screen, beside the forward step it leads to, and links to the page where the step is done.
- **Each path has a fixed set of tabs for the market's whole life.**
  Attendance shows from draft, read-only ("Opens when the market is published"), rather than appearing at publish.
- **Vendor notes are two separate kinds**: the vendor's own request (written when applying, read-only to the organizer) and the organizer's notes about the vendor.
  They are distinct things, not one notes field with two authors.
  Worked out in this map ([03](issues/03-vendor-notes.md)); it moves to its own map only if it grows past one ticket.

**This map is planning.**
Resolving a ticket produces a decision, not a deliverable.
Buildable work goes to `.scratch/backlog/`, linked from the ticket's `## Answer`.

## Decisions so far

<!-- one line per resolved ticket -->

- [01: What an organizer sees today](issues/01-what-an-organizer-sees-today.md):
  **the screens offer what the market cannot do yet, or no longer can, and refuse only after the click; the CSV path wears the form path's words.**
  Both paths walked through every phase in [walk/walk.md](walk/walk.md); its broken list is plain fixes for the backlog.
- [02: The next step and the live tabs, per phase and path](issues/02-the-next-step-per-phase-and-path.md):
  **one table per path: the rail's statement, its one forward step (disabled with the first blocker when it would be refused), and each tab's state with its line.**
  Leaving draft requires a complete setup, its dates not yet passed; creating a market asks its path; review is rolling; import is the CSV path's and Publish Results the form path's; nothing shows as assigned until a run is stored; the CSV path says "Start/Done Collecting" and calls its form "Questions"; Archive is the forward step after the last date.
- [03: Vendor notes](issues/03-vendor-notes.md):
  **two kinds: the vendor's request (a built-in optional question, a CSV import target, markable handled) and the organizer's note (one shared editable text, EDITOR writes, the vendor never sees it).**
  A sheet's organizer column imports as a read-only "From your sheet" line.
  Both show on review, Vendors and the door roster.

## Tickets

- [01: What an organizer sees today](issues/01-what-an-organizer-sees-today.md) - research, resolved.
- [02: The next step and the live tabs, per phase and path](issues/02-the-next-step-per-phase-and-path.md) - grilling, resolved.
- [03: Vendor notes](issues/03-vendor-notes.md) - grilling, resolved.

## Not yet specified

Nothing: the way is clear.
The work is [E31 What to show, and when](../../backlog/E31-what-to-show-and-when/epic.md), and the walk's plain fixes are [E30 What the walk found](../../backlog/E30-what-the-walk-found/epic.md).

## Out of scope

- The phases themselves and how they are tracked.
- Amending the setup after the freeze (a venue that changes); a future feature.
- The walk's plain fixes (its "Visibly broken or wrong" list and the CSV import's two misstatements): their own small epic of `fix:` PRs that can ship during the market window, [E30](../../backlog/E30-what-the-walk-found/epic.md).
