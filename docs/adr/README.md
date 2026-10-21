# Architecture decisions

Part of the [knowledge graph](../README.md), implementation layer.
Every file here but this one is a node of kind `adr`, named `NNNN-kebab-title.md`.

An ADR records one architecture decision that clears a three-part bar: it is hard to reverse, it is surprising without its context, and it settled a real trade-off.
It says the context, the decision and its consequences, and links the modules and rules it constrains.
`verified` and `status` are required: `proposed`, `accepted`, or `superseded by NNNN`; a superseded ADR stays, linked from its successor.
A decision that fails the bar is a section of a module node or a rule node instead.

Numbers are taken in order and never reused.
A reserved number whose decision failed the bar is listed as "not written: became" the node that holds it.

## Decisions

- [0001: Essential fields are exactly what the solver reads](0001-essential-fields-are-the-solver-contract.md) - the essential questions are defined by the solver's inputs
- 0002: reserved
- 0003: reserved
- 0004: reserved
- 0005: reserved
- 0006: reserved
- 0007: reserved
- [0008: Each write names what it changes](0008-each-write-names-what-it-changes.md) - there is no whole-market write; every write has its own endpoint
- [0009: The back end is the only source of truth about a market](0009-the-back-end-is-the-only-source-of-truth.md) - the browser holds one copy, re-read after every write
- 0010: reserved
- 0011: reserved
- 0012: reserved
- 0013: reserved
- 0014: reserved
