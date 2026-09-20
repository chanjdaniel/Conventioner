---
id: E14/F02/S04
title: Every modal holds the page inert, not just the vendor drawer
type: story
status: done
blocked_by: []
pr: [75]
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
      Enforced from the shape of the CSS, not from a list someone has to remember to update - plus a
      pinned inventory for the one shape that shape cannot see.

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

## The criterion was false when first ticked

Review found three live page modals the rule could not see: PrimeVue `<Dialog :modal="true">` in
`floorplan/TemplatePanel.vue` (twice) and `floorplan/TableTypePanel.vue`.
Their full-viewport mask is painted by the library's stylesheet, never by the component's scoped
`<style>`, so both the hand survey and the test walked straight past them.

Whether they actually had the defect was checked rather than assumed: `primevue/dialog` applies
`[_directive_focustrap, { disabled: !modal }]`, so the trap is enabled on exactly that prop and
those three are fine as they stand.
But "cannot quietly skip this" was untrue for the shape, so the test now recognises a library modal
by its markup and pins the inventory.
A fourth fails it, and whoever adds it has to answer the question rather than inherit the answer.

## An adjacent defect, the same one inverted

`.nav-bar` closed by sliding to `left: -300px`.
Off screen is not out of the tab order, so on every authenticated page a keyboard user could tab
into a navigation menu nobody can see.
It carries `visibility` now, and the browser test fails without it.

## What the reviews changed about the shape of the fix

The same four-line docblock was byte-identical in twelve files, restating what `useInertBehind`'s
own docblock says.
That is duplicated knowledge rather than duplicated code, and it is the kind that drifts.
`useModalRoot` collapses the nine single-root sites to one line each; the two modals whose scrim and
panel are separate siblings still call `useInertBehind` directly, because they have to name both.

`useEscapeToClose` was deliberately NOT merged into it.
Only eight of the thirteen call it, and three need multi-part roots, so a combined `useModal` would
be a generality the code does not ask for.

Two soundness fixes:

- `navDrawer.value?.$el as HTMLElement` checked nothing, because Vue types `$el` as `any`.
  A root that ever became a fragment would hand back a comment node, which would join the spine and
  leave the real drawer a sibling of it - marked inert by its own modal.
  `ElementNavigation` exposes its root now, and `useInertBehind` filters on `instanceof HTMLElement`.
- `PhaseRail` used one call over both confirmations and asserted in a comment that they are never
  both open.
  It is one call each now, which is what counting the marks was for.

## What the guard cannot see

Written down so the next reader does not over-trust it:

- `.vue` files, and only their own `<style>`.
  A cover painted from a shared stylesheet is invisible; a library's is handled by the pinned
  inventory above.
- Innermost CSS blocks only, so a rule containing a nested block would hide the declarations around
  it. This repo uses no CSS nesting yet.
- Wiring is counted per file, not per modal.
  `PhaseRail` holds two and would pass on one call; it has two, but nothing here would notice if it
  did not.
