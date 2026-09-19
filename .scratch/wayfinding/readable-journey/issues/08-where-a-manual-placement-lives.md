# 08: Where does a manual placement live, and what happens when the solver runs again?

Type: grilling
Status: resolved
Blocked by: -

## Question

[01](01-one-lifecycle-model.md) froze Assign past the `assignment` phase, on the basis that an
organizer who needs to change a placement on a running market does it by hand.
**Hand-editing does not exist.**
No endpoint writes a single vendor's placement - the only writer of `assignmentObject` is a
whole-market PUT - and there is no affordance anywhere in the UI.

So the freeze in 01 has an escape valve that is not built, and until it is, an organizer whose
vendors drop out on the morning of the market has no move but to archive a running market.

**The permission half is already settled and is not open here:** admins may edit a placement without
restriction, in any phase.

What remains:

- **Where does an edit live?**
  The Tables view is where an organizer is already looking at who sits where, and it has the
  table-by-table shape an edit needs.
  The vendor detail panel is where they look at one vendor across dates.
  Check-in is where they will be standing when the need arises.
- **What does it write?**
  `assignmentObject.vendorAssignments` is what check-in reads at the door, so an edit that does not
  land there changes nothing that matters on the day.
- **What happens when the solver runs again?**
  Inside `assignment` the solver is re-runnable (01), and a re-run recomputes the assignment
  wholesale, so **a re-run silently discards every manual edit made before it**.
  Nothing warns today because nothing edits today.
  Warn, merge, pin the hand-placed vendors, or overwrite - this is the real modelling question and
  it is why this is a ticket rather than backlog.
- **Is a swap one edit or two?**
  Moving a vendor to an occupied table displaces someone.
  Whether the product models "move" or only "assign to an empty table" decides how much of this
  there is.
- **Does an edit need a trail?**
  A placement that differs from what the solver produced is a fact someone will later ask about.

## Notes

Deferred deliberately at charting time - the decision is sharp but was not worth taking in the same
session as 01, which was already the widest ticket on the map.

## Answer

**A pin is a hand-placed row the solver must work around, and the Tables view is where it is made.**

The framing changed while resolving this.
A manual edit is not only a market-day repair: "sometimes we need to guarantee a certain vendor gets
a certain spot" makes it a **pre-assignment planning tool**, so the solver has to honour it as a
hard constraint rather than merely lose to it.

### One object, not two

A pin **is** a `VendorAssignmentResult` row, flagged as hand-placed.
Pinning before any solver run just means writing a row early; the solver then treats flagged rows as
fixed and places everyone else around them.

The alternative - a separate set of `(vendor, date, table, side)` constraints, with
`vendorAssignments` staying pure solver output - buys a clean separation and pays for it with two
records that can disagree.
The failure mode of disagreement is a vendor pinned to one table and placed at another, which is the
exact bug this feature exists to prevent.

**Consequence accepted: a pin is always to an exact seat.**
There is no way to express "Ana must be in Front Row somewhere".
The looser form would need the two-object model, and is not worth it.

### The solver works around pins

Not warn-and-overwrite.
Pinned rows survive a re-run, and the solver places everyone else around them.

Two failures to distinguish:

- **Two vendors pinned to the same seat on the same date is refused at pin time.**
  It is not a preference the solver can weigh, it is a contradiction, and the moment to refuse is
  when the second pin is made and the organizer can see both.
- **A pin that breaks a filter stands, and is marked.**
  Pinned to a Gold table when the vendor answered Silver-only is a legitimate override - a sponsor,
  a late deal, an accessibility need - and admins edit without restriction.
  The placement is marked as **overriding the vendor's stated preference**, because tier sets the
  price and someone will be charged for a table they did not choose.
  That marking is the same reporting surface as
  [04](04-when-a-vendor-cannot-be-placed.md): "why is this vendor here" and "why is this vendor
  nowhere" are one question asked twice.

### A pin outlives the plan that held it

Deleting the section a pinned seat belongs to, or dropping a section's table count below it,
**orphans the pin rather than deleting it**, and the orphan surfaces as a blocker before the next
assignment.

Silent deletion loses a deliberate guarantee without telling anyone.
Refusing the plan edit makes pins a lock on the floor plan, and an organizer rearranging their room
should not be blocked by a decision they can revisit.
Deferring the reckoning to the assignment is deferring it to the moment they were going to look
anyway - and the mechanism exists: `assignment` has an entry invariant and blockers render
generically through `BlockerPanel`.

### Two operations, and no third

**Place into an empty seat**, and **swap two vendors atomically**.

A "move" that displaces whoever is already there is how a vendor is silently unassigned on market
day, so it does not exist.
Freeing a seat first is safe and mirrors what an organizer physically does.
A swap earns being atomic because two vendors trading is common enough that three separate
operations invites a half-finished state.

A table holds two seats - `table_choice` is `Full Table`, `Half Table (Left)` or
`Half Table (Right)`, and `MarketTableRow.assignment` is a list - so every placement names a side,
and moving a half-table vendor into a full table **changes their `table_choice` away from what they
asked for**.
Allowed, and said out loud rather than quietly rewritten.

### The Tables view is the surface; the vendor panel is the door

The trigger is always a person, but the question every edit asks is "where can they go", and the
Tables view is the only screen that can show a free seat.
The vendor detail panel gets "change placement", which opens the Tables view filtered to that
vendor's date.

That **makes the Tables view's unreachable filters reachable**: `dateFilter`, `sectionFilter`,
`tierFilter` and `choiceFilter` are computed from `route.query` and nothing in the product ever sets
one, so `E09/F02/S01` and this stop being two unrelated pieces of work on the same view.

### A placement has a single writer

A dedicated endpoint, and **`assignment_object` joins the server-owned fields on market update**.

`update_market()` already re-applies `phase`, `is_draft`, `intake_mode`, `application_form`,
`results_published` and `import_mapping` from the stored market, each for the documented reason that
a stale client copy must not revert what another writer just saved.
`assignment_object` has exactly that exposure today and nobody has noticed because nothing else
writes it - **any market PUT can overwrite an assignment wholesale**, with no manual edits involved
at all.

**Cost, accepted:** `seedPublishedMarketWithAssignments()` works by `GET /markets/{id}/assignment`
then PUTting the whole market back, and `AGENTS.md` documents that as the way to seed.
It breaks, and moves to the new endpoint.
Closing a live overwrite hazard beats the convenience of a seed helper.

### Who may do it

**`MarketRole.EDITOR`**, the same bar as every other market write.

An EDITOR can already rewrite the tiers, sections and table counts the whole assignment is computed
from, so withholding "move one vendor between two seats" protects nothing.
E07 closed a 33-route hole caused by routes not matching their neighbours; a new write that gates
differently from every neighbour is how the next one starts.

Note there are two role systems - `OrganizationRole` (owner/admin/member) and `MarketRole`
(owner/admin/editor/viewer) - and this is the market one.

### The history

**Placements only**, read per-vendor and per-market, kept with the market.

Widening to every organizer action turns a feature into a platform concern, and review verdicts
already have their own record in the application's status.
A narrow trail that gets read beats a general one that gets ignored.

**A solver run is one entry**, naming the organizer who pressed it and what it touched - "47
placements written, 3 pins preserved".
Omitting runs would leave the trail lying by omission, since a placement that changed between two
hand-edits would have no explanation.
One entry per placement would drown the hand edits under machine rows, and the hand edits are the
entries anyone actually reads.

**Flagged deliberately:** recording *who* attaches an organizer's identity to a market that may be
exported, shared, or handed to a successor organizer.
That is a small privacy surface and it is intended, not incidental.

### What this unblocks

`E10/F03/S02` - freezing `Assign` past the `assignment` phase - was held behind this ticket because
a frozen solver with no way to hand-fix a placement strands an organizer on market day.
It is now held behind the *build*, not the decision.

Buildable work: `.scratch/backlog/E11-placements-you-can-change/`.
