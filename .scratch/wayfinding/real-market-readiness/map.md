# Map: Real-market readiness

Charted 2026-09-14, from the findings in `.lavish/mvp-findings.html`.

## Destination

An organizer can take a real Google Forms export from a real market through to a correct, published assignment, on a deployment that does not leak.
The way is clear when nothing remains to decide before that can be built; the resulting Epic/Feature backlog in `.scratch/backlog/` is the by-product.

## Notes

**Where this came from.** A full Playwright walk of the organizer journey against the 232-row UBC Makers Market Fall 2025 export.
The report is `.lavish/mvp-findings.html`; read it before taking any ticket, because every ticket here cites a finding in it by id.
The journey completes and the solver is sound at real scale (199/232 vendors, 333 assignments, 250/250 tables).
What this map exists for is the gap between "the pipeline works" and "the organizer's actual file goes through it correctly".

**Skills every session should consult.** `grilling` and `domain-modeling` by default; `prototype` where the ticket says so.
`AGENTS.md` is dense and authoritative on this codebase's sharp edges.
`CONTEXT.md` is the glossary, and two tickets here are expected to change it.

**This map is planning.** Resolving a ticket produces a decision, not a deliverable.
Buildable work goes to `.scratch/backlog/`, linked from the ticket's `## Answer`.

### Settled while charting

These frame every ticket and are not open for re-litigation without redrawing the destination.

- **The two authorization holes are fixed out-of-band, not on this map.**
  Any signed-up user can read and write any organization's markets and applicant PII; any unauthenticated caller can delete any verified account.
  Neither carries a decision, so neither is fog.
  Tracked as `.scratch/backlog/E07-authorization-integrity/` and startable now.
- **A real Google Forms export is the acceptance fixture**, anonymised and committed, with the anonymiser committed beside it.
  This narrowly overturns the v0.1.0 map's "no organizer's specifics steer the roadmap": the point is not to serve one organizer, it is that synthetic fixtures hid three blockers.
  Every existing CSV test uses short single-line stems, which is exactly why the grid-detection bug survived.
  Tracked as a feature under `.scratch/backlog/E06-engineering-health/`.
- **Ordering is by severity, not by date.** The Fall 2025 file is a historical example for development use; no live market depends on this work.
- **Release-agnostic.** When to cut a version is a separate call; pinning one here would decide nothing and would let a date pressure the decisions.
- **Desktop only, with one carve-out: check-in must work on a phone.**
  Check-in is laptop-primary in practice, but it is the one surface someone may hold in their hand at a door, and it is the last step of the journey this map protects.
  Nothing else needs to work below laptop widths.
- **The polish findings are backlog, not map tickets.**
  Roughly fifteen items that resolve nothing: dead sidebar navigation, stale hints, missing icons, raw contract values shown to organizers.
  Tracked as `.scratch/backlog/E08-interface-correctness/`.
  The one exception is the red "Archive Market" button that publishes a market, which is a modelling question and has its own ticket.

### Built since charting (2026-09-14)

The by-product backlog this map named has been worked; none of it needed a ticket here.

- **E07 Authorization integrity is done.** Both proven vulnerabilities are closed and pinned by tests, including a structural one: the hole was 33 routes wide, and the next route gets written by copying a neighbour.
- **E08 Interface correctness is done.** Statistics hold at every laptop size (no card clipped at 1280x720 through 2560x1440, against 5 of 5 clipped before), no page scrolls horizontally because it scrolls vertically, the Applications tab renders inside its panel, check-in works one-handed at 390px, and the copy/navigation items are fixed.
- **E01/F04/S01 is done** - the grid-detection blocker was one missing `re.DOTALL`. Verified closed against the real file through the wizard.
- **E06/F04 is done** - the real export is committed as an anonymised fixture with its anonymiser, and `tests/test_data/README.md` pins the six shapes it exists to preserve.

What that leaves for this map is what it was always for: the five decisions below, none of which a test or a patch can settle.

## Decisions so far

<!-- one line per resolved ticket -->

## Not yet specified

- **What else the synthetic fixtures hid.** Three blockers came from real-world data shape, not from logic.
  Whether that warrants a broader audit of where else the suite asserts against data it invented, and what shape such an audit takes, is not sharp enough to ticket until the fixture work lands and shows what it catches.
- **Price per tier.** `AGENTS.md` says tier is a hard filter "because it sets the price", the vendors table has a Cost column, and nothing anywhere lets an organizer enter a price, so the column reads as em-dash for every vendor.
  Whether a price belongs on a tier at all, or whether the column should go, sits between this map and the billing work that is out of scope.
  Revisit once the essential-contract tickets settle what a tier is.

## Out of scope

Ruled beyond this destination. These never graduate; they return only if the destination is redrawn.

- **Billing, plan limits, and invoicing.** Inherited from the v0.1.0 map.
- **Offers, and applicant accept/refuse.** Tracked in `.scratch/backlog/E05-post-mvp-offers/`, including the verified `assignment -> offers` deadlock.
- **Outcome notification emails.** The mailer sends auth mail only.
- **Floorplan GUI.** Still cut. The setup-path modal offers "Floorplan AI - Try Beta" prominently, which is a polish item, not an invitation to build it.
- **Full responsive support below laptop widths**, except the check-in page.
- **Deployment, hosting, and Vercel configuration.** Owned by the user directly.
- **The E06 public-form request stall.** Engineering health, unrelated to this destination.
