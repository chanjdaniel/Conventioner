---
layer: business
kind: concept
verified: 2026-11-12
---

# Layout

**Layout** is defined in [the glossary](../../../CONTEXT.md#assigning), under Assigning, beside Section, Location, Table and Table type; this node gathers what the graph says about a location's floorplan and the tables placed over it.

## Rules

- [The setup settles on leaving draft](../rules/the-setup-settles-on-leaving-draft.md): what of a layout settles, its seats and the market's table types, and what still changes, where a table stands.
- [An archived market is read-only](../rules/an-archived-market-is-read-only.md): an archived market's layout is read, never changed.
- [What each role may do](../rules/what-each-role-may-do.md): a layout is changed under Change Market Setup and read by anyone on the market.

## Flows

- [Sections](../flows/planning.md#e4-sections): a laid-out location's sections read their counts from its layout.
- [A location's layout](../flows/planning.md#e6-a-locations-layout): upload, scale, tables placed, saved as it goes, read on a phone and exported as a PNG.
- [Edit the plan after Draft](../flows/planning.md#e7-edit-the-plan-after-draft): where a table stands still changes.

## Implementation

- [A location's layout](../../implementation/modules/floorplan-placement.md): the page, the drawing, the editor, the save, the routes and who may use them.
- [The market document](../../implementation/data/market-document.md#a-locations-layout): a layout as stored, in the plan.
- [The layout's E2E](../../implementation/testing/floorplan-e2e.md): the specs, each driving the real gestures.
