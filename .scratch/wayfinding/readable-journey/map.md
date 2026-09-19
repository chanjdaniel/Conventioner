# Map: A journey you can read

Charted 2026-09-15, from the findings in `.lavish/qc-2026-09-15.html`.

## Destination

An organizer can walk the whole MVP journey and read every screen it puts in front of them, with no control that lies about what it does.
The way is clear when nothing remains to decide before that can be built; the resulting Epic/Feature backlog in `.scratch/backlog/` is the by-product.

## Notes

**Where this came from.**
A second full Playwright walk of the organizer journey, this time building a market from scratch through the UI rather than driving the 232-row export through it.
The report is `.lavish/qc-2026-09-15.html`; read it before taking any ticket, because every ticket here cites a finding in it by id.
The journey completes end to end - create, plan, import, triage, solve, publish, check in - and the import reconciliation screen and the triage queue are good work.
What this map exists for is the gap between "the journey completes" and "the organizer can read what it tells them".

**Skills every session should consult.**
`grilling` and `domain-modeling` by default; `prototype` where the ticket says so.
`AGENTS.md` is dense and authoritative on this codebase's sharp edges.
`CONTEXT.md` is the glossary and already defines **Publish** as `assignment -> market_days`, which ticket 01 must not re-litigate.

**This map is planning.**
Resolving a ticket produces a decision, not a deliverable.
Buildable work goes to `.scratch/backlog/`, linked from the ticket's `## Answer`.
Five epics so far: `E09-legible-screens/` holds the fixes that carried no decision, charted with
the map; `E10-one-lifecycle-model/` is ticket 01's output, `E11-placements-you-can-change/` is 08's,
`E12-say-why/` is 04's, and `E13-a-vendor-has-a-name/` is 02's.

### Settled while charting

These frame every ticket and are not open for re-litigation without redrawing the destination.

- **WCAG AA is this product's stated standard**, and the whole palette is audited rather than the two tokens that were measured.
  `--mm-grey` renders at 1.66:1 and `--mm-green` at 2.65:1; `--mm-yellow`, the phase pill colours, the badge colours and the `#2196F3` link are unmeasured.
  Raising `--mm-grey` is a visible change to the product's texture on every screen, not a neutral fix, and that is accepted.
- **The pure fixes are backlog, not map tickets**, as on the previous map.
  Roughly twenty items that resolve nothing: a scroll container, a token value, an `overflow-wrap`, a localStorage key.
  Tracked as `.scratch/backlog/E09-legible-screens/` and startable now.
- **E08/F01's outcome overclaimed its stories and has been amended.**
  It read "Every organizer screen is readable and free of spurious scrollbars from 1280x720 upward"; its three stories covered the statistics lists, the `100vw` scrollbar and the Applications tab.
  The Tables view was never a story, and it is this map's worst finding.
  The outcome now names the three screens it covered, so a future agent does not read it as a guarantee.
- **The solver keeps no reason for an unplaced vendor.**
  `unassigned_vendors` is a list of email strings derived from `num_assignments == 0`, and `best_table_for` returns bare `None`.
  Ticket 04 therefore designs new structure rather than surfacing existing structure.
- **E08/F02's "Still to do" is split.**
  The business-name half graduates here as ticket 02; the price-per-tier half stays parked, because billing is out of scope.
  The vendors table's Cost column stays an em-dash, and E09 says so out loud rather than leaving it looking broken.

### Settled while working

- **The organizer screens are designed for 1920x1080, and other widths are no longer a requirement**
  (2026-09-19, while resolving [06](issues/06-where-the-check-in-url-lives.md)).
  This narrows the previous map's "desktop only" and supersedes `E08/F01`'s "from 1280x720 upward"
  as a *forward* commitment - that outcome stays as the record of what was done, but it is not the
  bar new work is held to.
  Acceptance criteria across `E09` and `E10` were retargeted.
  **One carve-out survives: the public check-in page keeps its phone requirement.**
  It is not an organizer screen, `E08/F03` shipped it at 390px deliberately, and it is the one
  surface someone holds in their hand at a door.

### Corrected while charting

- **"Bulk approve is missing" is not a finding.**
  The report's H6 cited E04's old scope; [real-market-readiness ticket 04](../real-market-readiness/issues/04-what-a-reviewer-needs-to-decide.md) deliberately overturned it - one application at a time, no bulk action at all, so no application is ever approved without having been looked at.
  It is recorded under **Out of scope** below so it stops resurfacing a third time.
- **Setup column headers align.**
  E08/F02's second pass recorded that the misalignment "did not reproduce" and asked for a re-check.
  Measured again at 1440px: the headings sit exactly over their fields.
  The jitter that does exist is in the **list rows** on Markets and Organizations, a different component, and is E09 work.

## Decisions so far

<!-- one line per resolved ticket -->

- [01: What is the one model of a market's lifecycle the organizer sees?](issues/01-one-lifecycle-model.md):
  **the phase is the model and the wizard loses every lifecycle control it has.**
  A horizontal rail below the market header carries the lifecycle spine plus the forward action, and
  freezes at the last stage a market reached when it leaves the spine; back and destructive edges go
  to a secondary menu.
  The plan editor becomes one page, which deletes `setupPageIdx` rather than patching it.
  `Assign` is an operation inside the `assignment` phase, repeatable there and **frozen past it** -
  which must not ship before [08](issues/08-where-a-manual-placement-lives.md) does, or a market-day
  drop-out leaves archiving as the only move.
  `Done` disappears and Assignment Results becomes a fourth tab.
  `Publish Results` is correctly named but has no reader on a CSV market, so it is conditioned on
  intake mode.
  Confirmation is derived from `VALID_TRANSITIONS` rather than hard-coded, which is the set the
  product already confirms - only the publish dialog's copy was wrong, and it should name the public
  check-in page going live rather than offers MVP does not have.

- [08: Where does a manual placement live, and what happens when the solver runs again?](issues/08-where-a-manual-placement-lives.md):
  **a pin is a hand-placed placement row the solver must work around**, made on the Tables view with
  the vendor panel as its door - which makes that view's unreachable filters reachable.
  One object, not two, so a pin is always to an exact seat.
  Two vendors pinned to one seat is refused at pin time; a pin that breaks a tier filter stands and
  is marked as overriding the vendor's answer, because tier sets the price.
  A plan edit orphans a pin rather than deleting it, and the orphan blocks the next assignment.
  Two operations only - place into an empty seat, and swap atomically - because a displacing move is
  how a vendor is silently unassigned on market day.
  A dedicated endpoint at `MarketRole.EDITOR`, and `assignment_object` joins the server-owned fields
  so a stale market PUT can no longer overwrite an assignment; the seed helpers move with it.
  History covers placements only, one entry per solver run.

- [04: What does the product say when a vendor cannot be placed?](issues/04-when-a-vendor-cannot-be-placed.md):
  **four reasons per (vendor, date), computed on read, and no solver code changes.**
  The ticket's premise was wrong: `is_valid_vendor`'s five clauses reduce to three that can apply to
  an unplaced vendor, table choice is not a rejection path at all, and all of them are derivable
  afterwards from the application, the assignment and the plan.
  Computing rather than recording is also *more* correct - a recorded reason goes stale the moment a
  manual placement lands, and computing yields a fourth value a recording cannot: **free, and they
  could be placed**.
  Partially placed vendors are covered, not only `num_assignments == 0`.
  A tier with no section has no tables on any date, which is a plan property: it warns in the editor
  always and **blocks `-> assignment` when an approved applicant asked for it**, so the case that
  produced the finding never reaches the solver.
  It surfaces on the vendor's per-date cards as one component with three states - placed, placed
  against their answer ([08](issues/08-where-a-manual-placement-lives.md)'s pin override), not
  placed and why - so the override marking is not a separate feature. Build the card once.

- [06: Where does an organizer get the check-in URL?](issues/06-where-the-check-in-url-lives.md):
  **variant A, the labelled spine, with the check-in URL as a chip on the same row** - and the
  target width moved to 1920x1080, which is what makes A viable.
  Measured with a 69-character URL: clean at 1920 with 31px between labels and the spine at natural
  width; **the break is between 1366 and 1440**, where the spine becomes the flexible element and
  the labels paint over each other.
  A needs one change regardless of width: its frozen rail reads as *stopped*, not *archived*, so
  the terminal state must be **stated in words** rather than only struck through.
  Method note for anyone re-testing: container overflow is not a collision detector here - the step
  boxes shrink below their labels - so test **adjacent label bounding-box overlap**.

- [02: Which answer names a vendor on screen?](issues/02-which-answer-names-a-vendor.md):
  **`essential_full_name` - one field, required, asked unconditionally, person only.**
  Not a custom field, which the codebase's own examples encouraged, and not first + last: both name
  columns in the Fall 2025 export are *whole* names, so a required first-name field would receive
  `Ana Rivera` for 232 rows, and splitting on whitespace guesses wrong on every `van der Berg`.
  It widens what "essential" means - the rule was "what the solver reads directly", with no
  exception, and the name is essential because identity is. `CONTEXT.md` is updated, and
  `REQUIRED_ESSENTIAL_KEYS` stops being derived from `SOLVER_RELEVANT_KEYS`.
  **No migration**: `_solver_vendor` names the keys it needs rather than looping over everything
  asked, so a missing name is invisible to the solver and stored applications keep assigning.
  **`FormHasFieldsGuard` must count only plan-derived questions**, or a name asked unconditionally
  means it can never fail and a market with no dates can open applications.
  On screen: name primary, email secondary, never one instead of the other; no name falls back to
  the email and looks exactly like today.

- [03: Do the design tokens carry a contrast contract?](issues/03-contrast-contract-on-tokens.md):
  **the token's name is the declaration, and a unit test enforces it.**
  The audit found **four** failing text colours, not the two measured at charting: `--mm-yellow`
  at **2.15** is the worst in the product and had only been flagged as unmeasured, and
  `--vt-c-text-light-2` at **4.06** is a near-miss nobody would catch by eye.
  `--mm-grey` splits by role - `--mm-border` keeps 0.25 for its 57 border sites, `--mm-text-muted`
  takes alpha 0.63 for its 18 text sites - so the separation the ticket thought undecidable is free,
  because it has to happen anyway.
  **On-light and on-dark are separate families**, which makes the white-on-white phase label
  unwritable rather than merely fixed.
  A vitest test parses the real `base.css`; not a lint rule, which would have to infer each usage's
  background, and not a sidecar map, which can disagree with the CSS.
  Correction propagated: the report's "65 places" matched `border-color:` and `background-color:`
  too; the true text count is 18.

- [05: Can the importer match against the offering before it splits?](issues/05-match-before-splitting.md):
  **no - detect the ambiguity and say so.**
  The finding was mostly self-inflicted: the importer only splits when a **single** column is mapped
  to a target, and a **grid** (one column per option, option in the header) is never split.
  **The real Fall 2025 export uses the grid**, so the organizer's own file never hits it; the
  fixture that produced the finding was mine.
  The previous map warned that synthetic fixtures hide blockers - this is the mirror image, where
  one invented a blocker.
  The case is still producible by a checkbox question whose labels contain commas, and Google's
  export is then ambiguous to *any* reader, so it can only be detected, never parsed: greedy
  matching guesses, and `Gold` inside `Gold Plus` breaks it silently.
  Warn at the mapping step, do not block - the reconciliation screen already refuses to advance on
  unmatched values.
  Surviving untouched: the reconciliation dropdown offers ISO dates nowhere else in the product
  (`E09/F04/S02`), and table choice compares against the stored key (`E09/F04/S01`).

- [07: What does a market's row say at a glance?](issues/07-what-a-market-row-says.md):
  **name, market dates, phase badge, organization** - dropping Created, which is the weakest thing
  on the row, and Your role, which is permission detail on a navigation list.
  Nothing costs a query: the list endpoint already returns the whole market document decorated with
  the stamped phase.
  **The row itself opens the market** and `Manage` becomes secondary, so two same-sized buttons stop
  competing with nothing to distinguish them.
  Found while resolving it: **`Open` navigates every published market to a 404.**
  `pathAfterLoadingMarket()` sends a `market_days` market to `/<slug>`, which the intake-mode gate
  answers as nonexistent for a CSV market - and every MVP market is CSV. Open now goes to the
  market's own screens for every phase, with no conditional.

## Reaching the destination

**The way is clear.**
All eight tickets are resolved; nothing remains to decide before the journey can be built.

What the map produced is five epics in `.scratch/backlog/`:

| Epic | From | Shape |
| --- | --- | --- |
| `E09-legible-screens` | charted with the map | ~20 fixes that carried no decision |
| `E10-one-lifecycle-model` | 01, 06 | the phase rail, the one-page plan editor, Assign in its phase |
| `E11-placements-you-can-change` | 08 | pins the solver honours, and a placement history |
| `E12-say-why` | 04 | why a vendor is not placed, computed on read |
| `E13-a-vendor-has-a-name` | 02 | `essential_full_name`, and the name on every surface |

Three things the resolutions changed about each other, worth carrying forward:

- **Build the vendor date card once.** 08 needed somewhere to mark a pin that overrides a vendor's
  stated tier; 04 needed somewhere to say why a vendor is unplaced. They are the same component
  with three states, and both stories now say so.
- **`E10/F03/S02` is blocked on `E11`, not on a decision.** Freezing `Assign` past the `assignment`
  phase strands a market-day drop-out unless hand-editing exists first.
- **Two findings shrank under tracing, and one grew.** The importer's comma-split was mostly a
  synthetic-fixture artifact (05), and `--mm-grey`'s text usage was 18 sites rather than 65 (03).
  Against that, the contrast audit found **four** failing text colours instead of two, and 07 turned
  up a live 404 on every published market's primary action.

**One lesson for the next map.** The previous map warned that synthetic fixtures hide blockers.
This one met the mirror image: a synthetic fixture *invented* one, and two of my own measurements
were wrong before they were right. Where a finding rests on a fixture written for the occasion, or
on a measurement rather than an observation, the ticket should say so - three of these eight needed
that correction.

## Not yet specified

- **Whether the clipping is a pattern or two instances.**
  The Tables view and Attendance Status share a shape: a card sized to the viewport with `overflow: hidden` and no inner scroller.
  The Applications tab had the same shape and was fixed as a single story in E08/F01.
  Whether anything else in the app shares it, and whether that warrants a structural answer rather than a third instance fix, only sharpens once the Tables fix lands and shows what else uses those class names.

## Out of scope

Ruled beyond this destination.
These never graduate; they return only if the destination is redrawn.

- **The market id in the URL.**
  Four organizer routes take no parameters and read `localStorage.market`, so deep links break, two tabs interfere, and `/market-setup` renders an editable wizard attached to no market.
  Guarding the no-market case removes the lie, which is what this destination asks for.
  Routing by market id is a refactor justified by deep links and shareable URLs, none of which is something the organizer is told falsely, so it is a separate effort.
- **Bulk approve.**
  Decided against on the previous map, on purpose.
  See "Corrected while charting" above.
- **Price per tier.**
  Inherited fog from the previous map, now ruled out rather than carried: `AGENTS.md` says tier is a hard filter "because it sets the price", nothing lets an organizer enter a price, and whether a price belongs on a tier is a billing question.
- **Billing, plan limits, and invoicing.** Inherited.
- **Offers, and applicant accept/refuse.** Inherited; tracked in `.scratch/backlog/E05-post-mvp-offers/`.
- **Outcome notification emails.** Inherited; the mailer sends auth mail only.
- **Floorplan GUI.** Inherited; still cut.
- **Full responsive support below laptop widths**, except the check-in page. Inherited.
- **Deployment, hosting, and Vercel configuration.** Inherited; owned by the user directly.
