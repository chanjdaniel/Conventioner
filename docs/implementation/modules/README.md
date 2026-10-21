# Modules

Part of the [knowledge graph](../../README.md), implementation layer.
Every file here but this one is a node of kind `module`, named in kebab-case.

A module node says what one module or cohesive set of files does, its interface, and its sharp edges as short bold-led paragraphs.
It ends with `## Why`, linking up to the rules and concepts it implements.
`describes` and `verified` are required.

## Nodes

One line per node, sorted by file name.

- [Attendance and the door](attendance-and-door.md) - the roster off the stored assignment, the two doors that check a vendor in, the one phone-sized screen
- [The market frame](market-frame.md) - `MarketFrame` and `MarketBar`: the bar and tabs, the sticky top, the arrival states, the one width
- [The market guide](market-guide.md) - `marketGuide.ts`, the one table of what each screen says per phase and path
- [The market store](market-store.md) - `stores/market.ts`, `refresh()`, `useOpenMarket` and the `lastMarketId` pointer
- [The phase rail](phase-rail.md) - the lifecycle band: no before the click, the derived spine, the menu, where a move lands
