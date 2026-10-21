# Conventions

Part of the [knowledge graph](../../README.md), implementation layer.
Every file here but this one is a node of kind `convention`, named in kebab-case.

A convention node states a rule for all code that no one module owns: the rule, why, how it is enforced (a test, a lint, a check), and what breaks it.
`describes` and `verified` are required.
The design language is the convention node [`design-system.md`](../../design-system.md), where it stands.

## Nodes

One line per node, sorted by file name.

- [Dialogs](dialogs.md) - `AppDialog`: a native form in a modal, Enter, focus, closing, and a dialog opened from a dialog
- [Every control is named](every-control-is-named.md) - a name for every control, the named-controls walk, focus rings, answers as links
- [Every market page has an address](every-market-page-has-an-address.md) - `/markets/:marketId/...`, `marketPath()`, the landing, the redirects
- [One market, from the server](one-market-from-the-server.md) - one store, a re-read after every write, nothing in the browser, facts served on the market
- [Security invariants](security-invariants.md) - no control keyed on an insecure default: the six boot requirements, the one escape hatch, secrets read when asked
