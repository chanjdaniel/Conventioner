# Rules

Part of the [knowledge graph](../../README.md), business layer.
Every file here but this one is a node of kind `rule`, named in kebab-case.

A rule node states one product rule in one or two sentences: what the product does or refuses, and why.
Then `## Why`; `## Who may` when roles matter; `## Where it is kept`, linking the module, data or convention nodes and the code; `## Superseded` when it replaced an earlier decision; and `## Evidence` when measurements back it.
`describes` is optional; `verified` is required.

## Nodes

One line per node, sorted by file name.

- [A seat only for an applicant](a-seat-only-for-an-applicant.md) - a seat goes only to someone with an application; anyone may be pinned, warned, and is held
- [Adding a vendor who never applied](adding-a-vendor-who-never-applied.md) - from the assignment on, added by name and address, approved, seated by hand, never in the run
- [An assignment knows when it is out of date](an-assignment-knows-when-it-is-out-of-date.md) - the result says which of the rules, the plan and the approved applications changed since it ran
- [An incomplete application refuses the run](an-incomplete-application-refuses-the-run.md) - an approved application missing an asked answer stops the assignment, naming the applicants
- [Assign runs only in assignment](assign-runs-only-in-assignment.md) - the run is refused in every other phase, and once results are published
- [Dates fill one at a time, in the plan's order](dates-fill-in-calendar-order.md) - the solver fills each date before the next, in the plan's order; kept on purpose
- [The half-table share](half-table-share.md) - the organizer's share of a section on half tables, 30% when blank, bounding only Either choosers
- [The ceiling on dates per vendor](max-assignments-ceiling.md) - `max_assignments_per_vendor` is the only ceiling, with no hidden default
- [Priority and tie-breaks](priority-and-tie-breaks.md) - the order of turns: fewest dates, the organizer's rules, most constrained, earliest, address
- [Table-share pairing](table-share-pairing.md) - one-way is enough, a person's own request outranks one about them, the first applicant named
- [The assignment rules close with the assignment](the-assignment-rules-close-with-the-assignment.md) - the priority and the options lock once the market can no longer reach assignment
- [Tier filters, section prefers](tier-filters-section-prefers.md) - never a tier a vendor refused, because it sets the price; section is only a preference
- [What an import may leave unasked](what-an-import-may-leave-unasked.md) - an imported row may leave the number of dates unanswered: no personal limit
