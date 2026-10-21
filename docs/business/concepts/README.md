# Concepts

Part of the [knowledge graph](../../README.md), business layer.
Every file here but this one is a node of kind `concept`, named in kebab-case.

A concept node is the hub for one glossary term in [`CONTEXT.md`](../../../CONTEXT.md): it opens with a link to the term's entry there, and the definition stays in the glossary, never restated.
Below that it lists, under `## Rules`, `## Flows` and `## Implementation`, the nodes about the term.
`describes` is forbidden, so a concept never drift-warns; `verified` is required.

## Nodes

One line per node, sorted by file name.
