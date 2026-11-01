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
  Items with no order of their own (specs, page objects, sweep states, seed helpers) are sorted by name; items the code orders (actions and the rights of each role, in the `ACTIONS` order of [`back-end/api/market_actions.py`](../../../back-end/api/market_actions.py)) follow the code.
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
