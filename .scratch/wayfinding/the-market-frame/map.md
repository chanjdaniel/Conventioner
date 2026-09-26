# Map: The market frame

Status: closed 2026-09-26 - the way is clear.

Charted 2026-09-26, from Topic 1 of the [2026-09-26 brain dump](../../brain-dump/2026-09-26.md).

## Destination

Every market screen sits in one frame that stays put and tells the truth.
The market's header and phase rail stay visible at any scroll position, the tabs are readable in every state, each surface starts at the top and fills the height, and everything the frame and its surfaces show follows the market the moment it changes, not when a tab is reopened.
The market is only ever held as the server last reported it: no screen keeps a copy of its own, and nothing about a market is stored in the browser (amended 2026-09-26 while grilling [03](issues/03-one-market-every-surface-reads.md)).
The way is clear when nothing remains to decide before that can be built; the epic [E21 The market frame](../../backlog/E21-the-market-frame/epic.md) is the by-product.

## Notes

**Where this came from.**
Four brain-dump ideas: the header scrolls out of sight, the tab hover makes its label invisible, the Applications tab sits centred on a short window, and the form builder ignores an open/close/reopen until you change tabs and come back.

**Skills every session should consult.**
`grilling` and `domain-modeling` by default; `prototype` where the ticket says so.
`AGENTS.md` is authoritative on the sharp edges this map touches, above all **The Design Language** ("the PAGE scrolls", no viewport-height shell) and **The Phase Rail**.

**This map is planning.**
Resolving a ticket produces a decision, not a deliverable.
Buildable work goes to `E21`, linked from the ticket's `## Answer`.

### Settled while charting

These frame every ticket and are not open for re-litigation without redrawing the destination.

- **What is pinned is three layers: the app banner, the market's black header bar (name and tabs), and the phase rail** (stage, forward action, the More menu).
  The banner is already sticky (`E17/F04/S01`); the other two stack beneath it.
  At 1920x1080 that is roughly 150px of permanent chrome, which is accepted.
- **The frame is every screen that carries the phase rail**: Market Setup's four tabs, Tables, Attendance and Vendors.
  Pinning it on one market screen and letting it scroll away on the next is the inconsistency this map exists to remove.
- **"Follows the market" means changes made in this browser tab**: a phase transition from the rail, an assignment run, a plan edit, a placement, an import or a review verdict.
  Another browser tab, or another organizer, is out of scope (below).
- **The two plain fixes carry no decision and went straight to the backlog**, as on `readable-journey`: [E21/F01](../../backlog/E21-the-market-frame/F01-two-plain-fixes/feature.md).
  - The hover colour is `--mm-border` (25% near-black) on `--mm-black`.
  - The centring is `justify-content: safe center` on the whole market view, so any surface shorter than the viewport floats to the middle.

**Found while charting, and the reason ticket 02 exists.**
The form-builder finding is not one stale value but two:

- The form tab reads its lock from the server once, when it mounts, and nothing re-reads it after a transition.
- The Applications tab's "add a question / the form is frozen" advisory reads `formEditable`, which **only the form tab publishes**. On a visit that never opens the form tab it says "frozen" whatever the truth.

There is also a third copy of the market in `localStorage`, written by several components.

## Decisions so far

<!-- one line per resolved ticket -->

- [02: Which surfaces go stale, and on what?](issues/02-which-surfaces-go-stale.md):
  **three surfaces, one cause: the form tab fetches the form for itself, and two siblings borrow what it publishes.**
  The form builder's lock is fetched once on mount, so it is wrong in both directions after a transition, reproduced end to end.
  The Assignment tab's priority rules cannot target the market's own questions unless the form tab was opened first on that visit, reproduced too, and worse than the reported bug because it hides a solver input.
  The Applications advisory borrows `formEditable` the same way but cannot show wrong today.
  Everything else derives from the market in hand or reloads when it changes.

- [03: What is the one market every surface reads?](issues/03-one-market-every-surface-reads.md):
  **one Pinia store holds the market exactly as the server last reported it, every market screen is `/markets/:marketId/...`, every write is followed by a re-fetch, and unsaved work lives in the editor.**
  The scope grew on purpose: nothing about a market is stored in the browser any more (only a `lastMarketId` pointer for the dashboard), and a test forbids it.
  The form lock rides on `GET /markets/:id`; nothing borrows a fact from a sibling tab; the store re-fetches on arrival and on returning to the browser tab.
  The plan's autosave sends only the plan, not the whole market.
  Grilling also found that a market PUT will move a market to no organization or to a made-up one (200 both), which went straight to the backlog.

- [04: What becomes of the whole-market PUT?](issues/04-what-becomes-of-the-whole-market-put.md):
  **deleted.**
  A market's organization is fixed at creation (Manage Market's "add/remove organization" was a disguised move); a rename is its own write and only while the market is a draft, because the name is the public address.
  Grilling found a rename can take another market's name and creation only compares exact names, so two markets can share a public slug; slugs become unique, enforced by a unique index.

- [01: How does the frame stay put?](issues/01-how-the-frame-stays-put.md):
  **variant A: the bar and the full rail pin under the banner as one block, growth included.**
  Condensing on scroll hid "where the market is"; floating the blockers covered what they asked the organizer to fix.
  Every surface starts at the top and fills the height, the page is the only scroller (Tables, Attendance and Vendors lose their internal scrollers), the banner gets a fixed-height token, and one frame component serves every market screen.
  Prototype on the local branch `prototype/market-frame`.

## Not yet specified

Nothing. Every question on this map is resolved; the way to the destination is clear and the work is in `E21`.

## Out of scope

- **Live push and concurrent editing.**
  Another organizer's change appearing without a reload, and two people editing one market at once.
  Returning to a browser tab re-fetches ([03](issues/03-one-market-every-surface-reads.md)), which covers "I changed it in another tab and came back"; anything live needs the server to push, which is a different kind of work.
- **Renaming "Assignment results" to "Assignment" and splitting it into two pages.**
  It changes the tab bar, but it is the brain dump's Topic 3 and gets its own map.
- **The plan screen's layout** (dates as calendar and list, tier beside location): Topic 2.
- **Whether Tables, Attendance and Vendors carry the market's tabs.** Navigation between a market's screens, which [01](issues/01-how-the-frame-stays-put.md) handed to Topic 3's map along with the Assignment tab split.
