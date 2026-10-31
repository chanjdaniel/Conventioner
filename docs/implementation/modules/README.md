# Modules

Part of the [knowledge graph](../../README.md), implementation layer.
Every file here but this one is a node of kind `module`, named in kebab-case.

A module node says what one module or cohesive set of files does, its interface, and its sharp edges as short bold-led paragraphs.
It ends with `## Why`, linking up to the rules and concepts it implements.
`describes` and `verified` are required.

## Nodes

One line per node, sorted by file name.

- [The assignment solver](assignment-solver.md) - `assign_market` over the approved applications, the one seam `vendor_input.py`, vendor-driven placement
- [Attendance and the door](attendance-and-door.md) - the roster off the stored assignment, the two doors that check a vendor in, the phone-sized door among the organizer market screens
- [The CSV import](csv-import.md) - a Google Form's responses as applications: the CSV path's in Draft and Review, one row per applicant, one mapping format
- [The CSV proposal and start](csv-proposal-and-start.md) - a draft started from its Google Form's responses: a proposal that writes nothing, a confirm that writes all or nothing
- [The Discord connection](discord.md) - a market connected to a server through Discord's approval screen: one bot, REST only, the card editable until archived, who is in the server, optional values
- [Essential fields](essential-fields.md) - the questions every form asks: asked, required, the offering and its freeze, the reserved prefix
- [Floorplan placement](floorplan-placement.md) - the beta's Auto-Place: geometry, not AI; the room is the floor plan; no `pyckingsolver` in production; Konva colours
- [The form amendment](form-amendment.md) - fixing the form from inside the first import through the one form writer, in draft; the phase walk is gone
- [The guards and the phase move](guards.md) - `guards.py`: every precondition, the validated registry, the one stage's two ways in, the one phase writer
- [What an assignment was made from](made-from.md) - `madeFrom` fingerprints: the one place they are computed, written only by a run
- [The market's actions](market-actions.md) - `market_actions.py`: the table of who may do what, one row per action, every check asking a row, each route's row
- [Market deletion, and the deletion trail](market-deletion.md) - every record a market keeps goes with it by either door; the trail written before anything is destroyed
- [The market frame](market-frame.md) - `MarketFrame` and `MarketBar`: the bar and tabs, the sticky top, the arrival states, the one width
- [The market guide](market-guide.md) - `marketGuide.ts`, the one table of what each screen says per phase and path
- [The market store](market-store.md) - `stores/market.ts`, `refresh()`, `useOpenMarket` and the `lastMarketId` pointer
- [The phase rail](phase-rail.md) - the lifecycle band: no before the click, the derived spine, the menu, where a move lands
- [The phase record](phase-record.md) - `phaseHistory`: every phase a market entered, `phases_reached()`, and what an older market can prove
- [Placements](placements.md) - the one writer of `assignmentObject`: four EDITOR doors, pins, the held seat, orphans, what a read shows
- [Vendor notes](vendor-notes.md) - `vendor_notes.py`: the organizer's note, the sheet's line and the handled mark, in a collection no applicant endpoint reads
