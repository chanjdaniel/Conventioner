# Concepts

Part of the [knowledge graph](../../README.md), business layer.
Every file here but this one is a node of kind `concept`, named in kebab-case.

A concept node is the hub for one glossary term in [`CONTEXT.md`](../../../CONTEXT.md): it opens with a link to the term's entry there, and the definition stays in the glossary, never restated.
Below that it lists, under `## Rules`, `## Flows` and `## Implementation`, the nodes about the term.
`describes` is forbidden, so a concept never drift-warns; `verified` is required.

## Nodes

One line per node, sorted by file name.

- [Application](application.md) - the applicant's submission: how one is made, what fixes it, the verdicts, and the solver reading it
- [Assignment](assignment.md) - the solver's output: the run, its rules, its result, and what changes it afterwards
- [Essential question](essential-question.md) - the questions every form asks: asked, required, the offering, and the solver reading them
- [Intake mode](intake-mode.md) - imported or applying online: the two paths, the gated surface, and the fail-closed default
- [Market](market.md) - one event: its plan, its addresses, the one copy a screen holds, its end and its deletion
- [Organization and roles](organization-and-roles.md) - Organization and Organizer: an organization's people, a market's roles, and who may do what
- [Phase](phase.md) - a market's lifecycle: the moves, the guards, the rail, and what each phase opens and closes
- [Placement and pin](placement-and-pin.md) - Placed as and Table: a seat at a table, the pin that holds one, and the tables themselves
- [Review highlight](review-highlight.md) - what a reviewer reads first: marked on the form tab, led with on the review card, stored on the market
- [Table sharing](table-sharing.md) - two vendors at one table: the pairing, the half-table share, the partner question
