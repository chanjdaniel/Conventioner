# Data

Part of the [knowledge graph](../../README.md), implementation layer.
Every file here but this one is a node of kind `data`, named in kebab-case.

A data node describes one stored shape: the collection, the spelling of its keys, each field that matters, its indexes and migrations, and the single module that owns it.
`describes` and `verified` are required.

## Nodes

One line per node, sorted by file name.

- [The application document](application-document.md) - an application's answers and review state, stored snake_case, one per applicant per market
- [Lookup indexes](lookup-indexes.md) - every field a document is looked up by, indexed at boot from one list, and the unique indexes owned elsewhere
- [The market document](market-document.md) - the canonical camelCase form, the stored slug, `phase` and `isDraft`, the boot refusal and the schema contract
- [The organization document, and roles](organization-document.md) - organizations, a market's roles map, and what membership gives
- [The placement history](placement-history.md) - who changed a placement, to what, and when
- [Users, and the one spelling of an address](users-and-email.md) - organizer accounts, and one address as one account
