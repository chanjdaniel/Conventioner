---
layer: implementation
kind: convention
describes:
  - scripts/merge_node.py
  - .gitattributes
verified: 2026-11-01
sources:
  - T174
---

# Two features never share a line

**A doc or a code spot that every feature grows is laid out so that one feature's rows are lines of their own, apart from every other feature's rows.**
Several feature lanes run at once on one `dev`, each adds its rows to the same few shared docs, and each merge to `dev` sends the open lanes into a base merge.
When two lanes' rows share a line, that merge conflicts though nothing disagrees, and the lane pays a resolution, a rereview and sometimes another gate run.

## The rule

- **An enumeration that features grow is a Markdown list, one item to a line.**
  Never a sentence ("A, B and C") and never a table cell, because each new item rewrites the one line.
- **The order is stated, once, in the line above the list.**
  Items with no order of their own (specs, page objects) are sorted by name; items the code orders (actions and the rights of each role, in the `ACTIONS` order of [`back-end/api/market_actions.py`](../../../back-end/api/market_actions.py)) follow the code; a list whose doc names another order (the seed helpers, each beside the helper it builds on) follows that order.
  A sorted list puts two new items in different places unless their names sort side by side; a list in the code's order conflicts exactly when the code itself would.
- **A table whose rows features edit becomes one block per row**, each block apart from the next by a blank line, because git conflicts on edits to adjacent lines and a table's rows are adjacent.
  A block opens with the row's name as a heading or a bold lead, then its facts, with any enumeration inside it a list in turn.
  A table whose rows are short, one fact each, and rarely edited stays a table.
- **A list another node already keeps item by item is not kept twice**, so a new item is one edit in one file.
- **Splitting a doc changes its layout, not its meaning**: a cell's clauses become list items with the same words, the joining "and" and commas go, and nothing is added, dropped or reinterpreted.
  Every link and anchor other nodes point at keeps working; a heading added is a new anchor, and an existing heading keeps its text.

## Why

Git merges two changes to one file cleanly only when an unchanged line stands between them.
It conflicts when two branches change the same line, change adjacent lines, or insert at the same place.
So two features each appending their own item to one sentence, one table cell or one list's last line conflict, and two features each editing a table row next to the other's conflict too.

Measured from 2026-10-24 to 2026-11-01: 187 merges of `origin/dev` into a feature branch landed on `dev`'s history, and 77 of them conflicted.
64 of those 77 conflicted on a shared doc or code spot of this kind, and 30 conflicted on nothing else.
The hottest was the "Who may" table of [what each role may do](../../business/rules/what-each-role-may-do.md): 15 conflict hunks in its four role cells, each one line listing everything that role may do.

A node's frontmatter already merges: [`.gitattributes`](../../../.gitattributes) gives every Markdown file under `docs/` the `kg-node` merge driver, [`scripts/merge_node.py`](../../../scripts/merge_node.py), which merges `describes` and `sources` as sets and takes the later `verified` ([merging nodes](../../README.md#merging-nodes)).
The driver leaves the body to git's own text merge, so the body is what this rule lays out.

## How it is kept, and what breaks it

Each split doc says its order in one line above its list, linking here, so a builder learns the rule where they edit; a reviewer reads a new enumeration against it.
Two features still conflict when they insert at the same place: two items whose names sort side by side, or two actions added at the end of the same group, where the code conflicts too.

## Where a new feature's row goes

### What each role may do

[What each role may do](../../business/rules/what-each-role-may-do.md#who-may), "Who may": one subsection per role, Viewer, Editor, Admin and Owner, each a list of that role's rights, one right a line, in the order of the `ACTIONS` rows.
A new action's right is one new line in the list of its default role, in its row's place.

### The market store

[The market store](../modules/market-store.md#where-a-screens-permission-comes-from), "Where a screen's permission comes from": one block per screen, its name a bold lead line, then a list, one control and the row it asks a line.
A new control is one line under its screen; a new screen is a new block beside the nearest screen of its page.

### E2E seeds

[E2E seeds](../testing/e2e-seeds.md#the-seed-helpers), "The seed helpers": one block per helper, its name a bold lead line, then a list of what it leaves and its notes, any enumeration in them (`seedTheScreens()`'s stress markets, the states `seedApplicantMarket()` leaves) a list in turn, one item a line.
A new helper is a new block beside the helper it builds on; a new item in its lists, a note or a stress market, is one line beside the item it is most like, not at the list's end, where every lane would add its own.

### Testing Conventioner

[Testing Conventioner](../../TESTING.md#e2e-foundation), "E2E Foundation": the page objects in `front-end/e2e/pages/` are a list, one class a line, sorted by class name.
A new page object is one line in its sorted place.

### The market document

[The market document](../data/market-document.md#the-discord-connection-is-discord), "The Discord connection is `discord`": the `discord` row of "The fields that matter" is one short line pointing to its own block below the table, whose subfields are a list, one a line, grouped by what wrote them, in the order `DiscordConnection` declares them, and whose writing routes and what each change forgets are lists in the same order.
A new subfield is one line in its place in each list it belongs in; the table's row stays as it is.

### The market's history

[The market's history](../data/history.md#what-each-write-records), "What each write records" and "What an organization records": one block per action, its id a bold lead line, in the order of the actions table's rows and then the history's own `apply` (the organization's in the order of their constants in `history.py`), then a list, one kind a line, each with its vendors, subject and detail as a list in turn.
A new kind is one item at the end of its action's block; a new action is a new block in its row's place.
An entry written under several actions, `dealt`, is one block, where its row stood.

### The history's kinds

[`back-end/history.py`](../../../back-end/history.py)'s kind constants: one block per group of the actions table, in its order, then the organization's and the applicant's own, each block opening with a one-line comment naming its group, blocks apart by a blank line.
A new kind is one constant at the end of the group of the action that records it.

### The history's words

[`front-end/src/utils/historyReaders/`](../../../front-end/src/utils/historyReaders/): one file per area, by the actions table's groups (`setup`, `applications`, `lifecycle`, `vendors`, `assignment`, `payments`, `door`, `discord`, `people`), then `organization` for the organization's own verbs and `applying` for `apply`, beside `shared.ts`, for what two areas use and the generic field rows, and `index.ts`, which merges them.
Each area file names the `action/kind` keys it reads in its header, one a line, and exports its readers as a table keyed by them; the stored values it names or words for `fieldValue` are its own tables beside them.
A new kind's words are one reader in the file of its action's group, unless its words are another area's (`update-vendor-info/discord_match_declined` is Discord's, `assign/owed_taken_back` Payments'), one line in that file's header, and one line in each sorted key list of `historyReaders.test.ts` it has words for; `index.ts` refuses a key two areas both define.
A new placement kind is one line in each of three places: the `PlacementHistoryKind` type and `PLACEMENT_KINDS` of [`placementHistory.ts`](../../../front-end/src/utils/placementHistory.ts), from which `assignment.ts` builds its `assign/<kind>` readers with no other change, and `SENTENCES` of `historyReaders.test.ts`.
A new area is a new file, and one line in each of the sorted lists of areas, the imports and `AREAS` of `index.ts` and of `historyReaders.test.ts`.
