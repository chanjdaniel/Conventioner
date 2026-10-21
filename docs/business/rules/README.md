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
- [Assign runs only in assignment](assign-runs-only-in-assignment.md) - the run is refused in every other phase, and once results are published
- [Dates fill one at a time, in the plan's order](dates-fill-in-calendar-order.md) - the solver fills each date before the next, in the plan's order; kept on purpose
- [The assignment rules close with the assignment](the-assignment-rules-close-with-the-assignment.md) - the priority and the options lock once the market can no longer reach assignment
