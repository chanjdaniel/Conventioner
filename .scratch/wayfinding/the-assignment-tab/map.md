# Map: The assignment tab

Status: closed 2026-09-26 - the way is clear.

Charted 2026-09-26, from Topic 3 of the [2026-09-26 brain dump](../../brain-dump/2026-09-26.md).

## Destination

A market's assignment work reads as one place.
Setting the rules and running them is one page; reading and changing the assignment they produced is another.
Every market screen, Tables, Attendance and Vendors included, is reached the same way.
The way is clear when nothing remains to decide before that can be built; the epic [E22 The assignment tab](../../backlog/E22-the-assignment-tab/epic.md) is the by-product.

## Notes

**Where this came from.**
One brain-dump idea (rename "Assignment results" to "Assignment" and split it into two pages), plus the question [the-market-frame](../the-market-frame/map.md) handed over: whether Tables, Attendance and Vendors carry the market's tabs.
They are one map because the split decides where "the result" lives, and today the only place a result can be changed is the Tables screen.

**Skills every session should consult.**
`grilling` and `domain-modeling` by default; `prototype` where the ticket says so.
`AGENTS.md` is authoritative on the sharp edges this map touches: **Placements, Pins and the Trail**, **One Market, From the Server**, **The Phase Rail** and **The Design Language**.

**This map is planning.**
Resolving a ticket produces a decision, not a deliverable.
Buildable work goes to `E22`, linked from the ticket's `## Answer`.

### Settled while charting

These frame every ticket and are not open for re-litigation without redrawing the destination.

- **The words.** The tab is **Assignment**; `CONTEXT.md` defines Assignment as the solver's output, so "Assignment results" named one thing twice.
  **Assignment rules** entered the glossary while charting: the priority and the two assignment options, the organizer's inputs to the solver.
  The page names were settled in [01](issues/01-what-is-on-each-page.md).
- **Every page is a URL**, as every market screen is since E21: a bookmark, a refresh or a link lands on the same page.
- **The renames are mechanical and went straight to the backlog**: the tab's label and the names in code and tests that follow it, [E22/F01](../../backlog/E22-the-assignment-tab/F01-plain-fixes/feature.md).
- **One plain bug went with them**, found on the live tab at 1920x1080: the Assignment Options card clips its second option by 30px inside a nested scroller, which AGENTS.md forbids on a frame screen.

**What the tab is today** ([screenshot at 1920x1080](assignment-tab-1920.png), a market in `assignment` with a stored assignment).
One scrolling page: Assignment Priority beside Assignment Options, Assign under them, then the whole result - a Summary, quick links to Vendors / Tables / Attendance, per date / section / tier / table choice counts, unassigned tables and vendors, the placement history, and Download CSV.
Changing a placement (move, free, swap) happens on the Tables screen, which carries the phase rail but not the tabs.
Things the new pages should not carry over: the result column is inset 54px from the rules column above it, a wide empty band separates Assign from the Summary, "View Attendance" wraps where its siblings do not, and Download CSV sits alone at the bottom-left.

## Decisions so far

<!-- one line per resolved ticket -->

- [01: What is on each page?](issues/01-what-is-on-each-page.md):
  **two pages, Assignment (set the rules, run them) and Result (the assignment, read and changed in one place).**
  The Tables screen moves into Result; a run lands on Result; "Run again" says what it keeps, with no dialog, since every hand placement is already a pin.
  The rules are read-only after `assignment`, and the plan write refuses them there too.
- [03: Does a result know its rules changed?](issues/03-does-a-result-know-its-rules-changed.md):
  **yes, and it names what changed.** Each run stores a fingerprint of the rules, the plan and the approved applications; the market is served with `assignmentOutOfDate`; shown only in `assignment`, with no dismiss.
- [02: How is every market screen reached?](issues/02-how-every-market-screen-is-reached.md):
  **four tabs, and Attendance once published; the Assignment tab's pages are Assignment, Result and Vendors.**
  Every page has its own address, a tab opens the page for the market's phase, every market screen is one width, and the Result page is a summary strip over the tables grid with statistics in an inline panel.

## Not yet specified

Nothing. Every question on this map is resolved; the way to the destination is clear and the work is in `E22`.

## Out of scope

- **The plan screen's layout** (dates as calendar and list, tier beside location): Topic 2, its own map [the-plan-uses-its-space](../the-plan-uses-its-space/map.md).
- **What the solver does.** Priority semantics, the assignment options and placement rules are unchanged; this map moves where they are set and read, not what they mean.
