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

A survey of the whole front end finds **thirteen page-level modal surfaces** across twelve files.

| Surface | Root | Shape |
| --- | --- | --- |
| `App.vue` navigation drawer | `.nav-background` + `ElementNavigation` | scrim and panel are separate siblings |
| `PhaseRail.vue` publish confirm | `.rail-confirm-overlay` | `v-if`, root wraps the modal |
| `PhaseRail.vue` archive confirm | `.rail-confirm-overlay` | `v-if`, root wraps the modal |
| `PlacementDialog.vue` | `.placement-scrim` | `v-if`, root wraps the modal |
| `VendorsModal.vue` | `.vendors-modal-root` | teleported to `body` |
| `NewMarketOverlay.vue` | `.container` | always present, visibility-toggled |
| `ManageMarketOverlay.vue` | `.container` | always present, visibility-toggled |
| `ManageOrgOverlay.vue` | `.container` | always present, visibility-toggled |
| `LoadMarketOverlay.vue` | `.container` | always present, visibility-toggled |
| `OrganizationsView.vue` new organization | `.overlay` | `v-if`, inline in the view |
| `floorplan/ChoosePathOverlay.vue` | `.overlay-backdrop` | root is the backdrop |
| `floorplan/SaveFlow.vue` | `.save-dialog-root` | teleported to `body` |
| `floorplan/SectionGrouping.vue` | `.sg-dialog-backdrop` | teleported to `body` |

## Out of scope

`floorplan/ScaleCalibration.vue`'s `.cal-dialog-overlay` is **not** a page modal.
It is `position: absolute; inset: 0` inside the canvas stage, so it covers a panel rather than the page, and nothing behind it is hidden from the keyboard in the first place.
Marking the page inert around it would take the wizard's own controls away for no reason.

## Acceptance criteria

- [x] While any page-level modal is open, no control outside it can be reached by keyboard.
- [x] Closing it hands the page back.
      The always-present containers are the ones where this could fail, and they are the ones the
      browser test drives.
- [x] Every scrim that dismissed on click still does.
- [x] A modal added later cannot quietly skip this.
      Enforced from the shape of the CSS, not from a list someone has to remember to update.

## Notes

`useInertBehind` already handles both shapes this survey found.
Where the component's root element *is* the whole modal - which is eight of the nine - `partsOf` is just that root, because its scrim and panel are both descendants and therefore already on the spine.
The vendor drawer needed two parts only because its scrim and panel are inline siblings in the view rather than wrapped in a root of their own.

It also already counts marks module-wide, which this story is the reason for: the rail's confirm dialogs open over screens that may themselves have a modal open.

## The hand survey was wrong, and that is the point

The table above started as ten surfaces found by hand, from the classes the overlays use and from
which of them call `useEscapeToClose`.
It missed three: `VendorsModal`, `floorplan/SaveFlow`, and the app's own navigation drawer.

They were found by the rule that now enforces the criterion, so the rule earned its place before it
was written down: **a component that paints a full-viewport cover is a modal, and a modal calls
`useInertBehind`.**
`src/__tests__/modalsHoldThePageInert.test.ts` reads the CSS for that shape - `position: fixed` with
either `inset: 0` or the `top/left/width/height` spelling this codebase also uses - and fails naming
any component that has one without a call.

That test checks for a *call*, not a mention.
An earlier version matched the bare identifier and so counted a component as wired on the strength
of its import line alone; deleting a call and watching the test stay green is what exposed it.

## What the browser tests add

The source rule proves everyone is wired. It cannot prove the wiring is right, so
`front-end/e2e/modal-inert.spec.ts` drives one modal per *shape*, since the shape is what differs
and the wiring within a shape is the same three lines:

- the always-present container, where a mis-wired open state leaves the page inert **forever**
  rather than never;
- the drawer whose scrim and panel are separate siblings, where naming only the scrim would mark
  the panel itself and leave the keyboard trapped in nothing.

The third shape, a `v-if` root wrapping the whole modal, is the vendor drawer's and is covered by
`vendors.spec.ts`.
Both new tests were confirmed to fail with their wiring removed.

## One thing found on the way

Nothing had ever clicked `NewMarketOverlay`'s scrim in a test.
Its dialog is centred inside it, so Playwright's default centre-click lands on the dialog; the test
clicks a corner.
That is the overlay's own geometry and predates this story, but scrim dismissal is the third
criterion here, so it is proven rather than assumed.
