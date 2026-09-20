---
id: E14/F02/S04
title: Every modal holds the page inert, not just the vendor drawer
type: story
status: in-progress
blocked_by: []
pr: []
---

## What to build

`E14/F02/S02` found that the vendor detail drawer declared `aria-modal="true"` while fourteen controls behind it stayed in the tab order, and fixed it with `useInertBehind`.
Every other modal in the product has the identical defect.
That story deferred them deliberately rather than widening itself; this is the sibling it named.

A survey of the whole front end finds **nine page-level modal surfaces** across eight files:

| Surface | Root | Shape |
| --- | --- | --- |
| `PhaseRail.vue` publish confirm | `.rail-confirm-overlay` | `v-if`, scrim is the root |
| `PhaseRail.vue` archive confirm | `.rail-confirm-overlay` | `v-if`, scrim is the root |
| `PlacementDialog.vue` | `.placement-scrim` | `v-if`, scrim is the root |
| `NewMarketOverlay.vue` | `.container` | always present, visibility-toggled |
| `ManageMarketOverlay.vue` | `.container` | always present, visibility-toggled |
| `ManageOrgOverlay.vue` | `.container` | always present, visibility-toggled |
| `LoadMarketOverlay.vue` | `.container` | always present, visibility-toggled |
| `OrganizationsView.vue` new-organization | `.overlay` | `v-if`, inline in the view |
| `floorplan/ChoosePathOverlay.vue` | `.overlay-backdrop` | root is the backdrop |
| `floorplan/SectionGrouping.vue` | `.sg-dialog-backdrop` | `position: fixed`, `z-index: 1000` |

## Out of scope

`floorplan/ScaleCalibration.vue`'s `.cal-dialog-overlay` is **not** a page modal.
It is `position: absolute; inset: 0` inside the canvas stage, so it covers a panel rather than the page, and nothing behind it is hidden from the keyboard in the first place.
Marking the page inert around it would take the wizard's own controls away for no reason.

## Acceptance criteria

- [ ] While any page-level modal is open, no control outside it can be reached by keyboard.
- [ ] Closing it hands the page back.
- [ ] Every scrim that dismissed on click still does.
- [ ] A modal added later cannot quietly skip this.

## Notes

`useInertBehind` already handles both shapes this survey found.
Where the component's root element *is* the whole modal - which is eight of the nine - `partsOf` is just that root, because its scrim and panel are both descendants and therefore already on the spine.
The vendor drawer needed two parts only because its scrim and panel are inline siblings in the view rather than wrapped in a root of their own.

It also already counts marks module-wide, which this story is the reason for: the rail's confirm dialogs open over screens that may themselves have a modal open.
