# 03: Does a result know its rules changed?

Type: grilling
Status: resolved
Blocked by: -

## Question

Editing the assignment rules never changes the stored assignment: new rules take effect only when the assignment is run again (`CONTEXT.md`, **Assignment**; AGENTS.md, "shrinking the plan does not unassign anybody").
On one scrolling page the gap was at least visible.
With Rules and Result on separate pages, an organizer can edit a rule, switch to Result and read an assignment made under the old rules without being told.

- **Should Result say so?** And if it should, what counts as a change: the assignment rules only, or also the plan (tiers, sections, counts, dates) and the application set (an application approved or withdrawn since the run)?
- **Who knows?** The front end cannot tell from the rules alone, because the stored assignment records nothing about the rules it was made under.
  Does the server record what a run was made from (a snapshot, or a fingerprint of it), and serve "this assignment is out of date" as a fact on the market, the way E21 serves the form lock?
- **What the organizer can do about it.** Run again, which replaces everything but the pins; or keep the assignment deliberately and dismiss the notice.
  Does "keep it" need to be remembered?
- **Phases.** Once the market is published (`market_days`), the rules are frozen in practice; does the notice mean anything there?

Out of this ticket: where on the Result page the notice sits, which follows [01](01-what-is-on-each-page.md) and [02](02-how-every-market-screen-is-reached.md).

## Answer

Grilled and decided 2026-09-26.

**Yes: the Result page says when the assignment is out of date, and names what changed.**

- **What counts is anything the solver reads**, in three groups:
  - **the rules**: priority, max assignments per vendor, max half-table proportion;
  - **the plan**: dates, tiers, locations, sections and their counts;
  - **the approved applications**: one approved, or no longer approved, since the run.

  Hand placements do not count: they are edits *to* the result, not inputs that produced it.
- **The server knows, not the browser.** Each run stores a fingerprint of each of the three groups beside the assignment.
  `GET /markets/:id` serves `assignmentOutOfDate`, naming which groups differ from the stored fingerprints, the way it serves `applicationFormLockReason`: a fact derived from the market is served on it (AGENTS.md, **One Market, From the Server**).
  So the notice can say "Your rules and the approved applications changed since this ran" rather than "something changed".
  A market assigned before this ships has no fingerprints; it is served as **not known to be out of date**, never as out of date, because a notice on every existing market would teach organizers to ignore it.
- **No dismiss.** The notice states a fact, quietly, not an error; running again is what clears it.
- **Only in `assignment`**, the one phase in which the organizer can act on it by running again.

Buildable work: [E22/F03 The result knows what it was made from](../../../backlog/E22-the-assignment-tab/F03-the-result-knows-what-it-was-made-from/feature.md).
Where on the Result page the notice sits follows [02](02-how-every-market-screen-is-reached.md).
