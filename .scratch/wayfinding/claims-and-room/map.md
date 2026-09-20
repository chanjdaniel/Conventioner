# Map: Claims we can support, and room to show them

Charted 2026-09-20, from the findings in `.lavish/qc-2026-09-20.html`.

## Destination

Every claim an organizer screen makes is one the product can actually support, and the workspace shows what it holds.
The way is clear when nothing remains to decide before that can be built; the resulting backlog in `.scratch/backlog/` is the by-product.

## Notes

**Where this came from.**
A Playwright walk over every organizer flow the five merged epics touch - `E09` through `E13`, all on `dev @ 45f15e00` - at 1920x1080, on a clean database, with one market built through the UI: two dates, three tiers (one deliberately with no tables), three sections across two locations, six applicants with conflicting availability, tier, table-choice and sharing answers.
The report is `.lavish/qc-2026-09-20.html`; read it before taking any ticket, because every ticket here cites a finding in it by id.

**What the walk actually found.**
The features hold up.
Pins, swap, the pre-change warnings, the override marking, the placement trail, E12's reasons and tier guard, the names on every surface, the rail's spine and menu, the publish dialog, the check-in URL - 24 acceptance criteria verified by driving them.
What it found instead is a class of problem the epics introduced: **the product now asserts things it cannot know.**
The dashboard asserts you have no market (it knows only that this browser has not opened one).
The archived rail asserts the check-in page never went live (it knows only that no evidence of publishing survives).
The rail asserts a phase (it is reading a stale cache).
The importer asserts a control exists (it does not).
That is the first half of the destination; the second half is the workspace, which is pinned to 80% of the viewport and hides half of itself.

**Skills every session should consult.**
`grilling` and `domain-modeling` by default.
`AGENTS.md` is dense and authoritative on this codebase's sharp edges and now carries sections on the phase rail and on placements, pins and the trail.
`CONTEXT.md` is the glossary; ticket [04](issues/04-who-is-in-the-vendors-list.md) turns on its definition of **Vendor** and may amend it.

**This map is planning.**
Resolving a ticket produces a decision, not a deliverable.
Buildable work goes to `.scratch/backlog/`, linked from the ticket's `## Answer`.

### Settled while charting

These frame every ticket and are not open for re-litigation without redrawing the destination.

- **Five findings carry a decision; nine do not.**
  The nine are [E14: Second-walk corrections](../../backlog/E14-second-walk-corrections/epic.md), charted with this map and startable now.
  Two of them - the duplicated year and the check-in scrollbar - are one-liners that should not wait behind any decision.
- **The sizing findings are one decision, not five fixes.**
  F2 (the 80% cap), F3 (a 320px minimum for one row), F4 (equal thirds truncating the tier that sets the price) and the 1100-vs-1536 inconsistency across the four market screens are the same question wearing four hats.
  The previous map left almost exactly this patch in its fog - *"whether that warrants a structural answer rather than a third instance fix"* - and it never graduated.
  This walk is its third and fourth instances, so it graduates here as ticket [01](issues/01-how-an-organizer-screen-sizes-itself.md).
- **`height: 80%` was never a decision.**
  `git log -S` dates it to 2025-02-18, *"began work on market setup page"* - the first commit of that view.
  It is original scaffolding that survived, not a considered choice, and ticket 01 should feel free to delete it.
- **F10 was promoted after being mis-sorted.**
  It was first listed among the fixes; it has real options (mark, group, sort down, filter with a reveal) and belongs with F9 as one question about the same moment in the same dialog.
  Ticket [05](issues/05-before-you-override-an-answer.md).
- **The check-in page is not an organizer screen.**
  The previous map carved it out explicitly - it keeps its phone requirement, because it is the one surface someone holds in their hand at a door.
  So F12's scrollbar is a plain fix in `E14`, not part of ticket 01.
- **The importer's advisory is the best writing in the product**, and it is attached to the worst dead end in it.
  Keep it as the model for what an explanation should do when ticket [03](issues/03-when-the-form-never-asked.md) decides what it should say.

## Decisions so far

<!-- one line per resolved ticket -->

_None yet; charted 2026-09-20._

## Not yet specified

- **How the rail behaves at whatever width ticket [01](issues/01-how-an-organizer-screen-sizes-itself.md) picks.**
  Today it wraps to two rows on the three 1100px screens as soon as a market is published, because the check-in chip joins the row.
  Pick 1536 and the wrap disappears; pick 1100 and it is permanent and should be designed for rather than tolerated.
  Not ticketable until the width is chosen.

## Out of scope

Ruled beyond this destination.
These never graduate; they return only if the destination is redrawn.

- **`GET /markets/:id/assignment` recomputing while every other read serves the stored assignment.**
  Deliberate asymmetry, recorded here so it stops reading as a missed seam: that endpoint is the *preview* - "what would Assign give me" - and the whole point of `assignment_to_show()` is that nothing else recomputes.
- **Billing, plan limits, and invoicing.** Inherited.
- **Price per tier.** Inherited; a billing question.
- **Offers, and applicant accept/refuse.** Inherited; `.scratch/backlog/E05-post-mvp-offers/`.
- **Outcome notification emails.** Inherited; the mailer sends auth mail only.
- **Floorplan GUI.** Inherited; still cut.
- **Bulk approve.** Inherited, decided against twice.
- **Full responsive support below laptop widths**, except the check-in page. Inherited.
- **Deployment, hosting, and Vercel configuration.** Inherited; owned by the user directly.

Note that **routing organizer screens by market id**, which the previous map ruled out of scope, is *not* ruled out here.
It returns as a candidate answer inside ticket [02](issues/02-source-of-truth-for-the-market-on-screen.md) rather than as a closed door, because F7 is a case of the organizer being told something false, which is what that ruling turned on.
