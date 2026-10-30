---
layer: implementation
kind: convention
describes:
  - front-end/src/components/AppDialog.vue
  - front-end/src/utils/useInertBehind.ts
  - front-end/src/utils/useModalRoot.ts
  - front-end/src/utils/useEscapeToClose.ts
  - front-end/src/utils/useFocusGoesBack.ts
  - front-end/src/__tests__/modalsHoldThePageInert.test.ts
  - front-end/src/__tests__/aDialogGivesFocusBack.test.ts
  - front-end/src/__tests__/theVendorDrawerGivesFocusBack.test.ts
  - front-end/e2e/the-vendor-drawer-gives-focus-back.spec.ts
  - front-end/e2e/dialog-idiom.spec.ts
  - front-end/src/components/SearchPicker.vue
verified: 2026-10-30
sources:
  - wayfinding/the-order-of-the-work/08
  - wayfinding/the-order-of-the-work/map
  - E14/F02/S02
  - E14/F02/S04
  - E20/F01
  - E20/F01/S01
  - E31/F03/S01
  - E20
  - T45
  - E39/F01/S04
  - E38/F08/S03
  - T123
---

# Dialogs

**[`AppDialog.vue`](../../../front-end/src/components/AppDialog.vue) is what a dialog is in this product**: a native `<form>` in a modal doing one small job.
It owns the scrim, the window, the close control, Escape and backdrop dismissal, holding the page behind inert, focus on open, and the `type="submit"` confirm.
A new dialog is built on it, never hand-rolled.

## The rules

**The form is the Enter contract.**
Enter in a field runs the same handler as the confirm button, so it inherits that handler's guard, and a disabled submit makes Enter inert with no key handler anywhere.
Do not add `@keydown.enter`: five views each invented their own answer, and one of them (`ApplicantLogin`) bypassed its own resend cooldown by doing so.
The one exception is a picker's open list ([`SearchPicker.vue`](../../../front-end/src/components/SearchPicker.vue), E38/F08/S03): while its list is open, Enter takes the highlighted choice and is kept from the form, and Escape closes the list and is kept from the dialog; once the list is closed both keys are the dialog's again, so Enter submits through the form's guard and Escape closes.

**A dialog of several independent actions passes no `confirmLabel`** and hosts its own `<form>`s in its body; Manage organization has three.
It still gets the scrim, window, close, Escape, backdrop and inert behaviour, without the single-form footer.

**A dialog sits centred, unless its body grows as it is used**: `anchored` holds its top where it opened, so a field's error appearing as a key is typed does not move the dialog half a line under the pointer (the amendment's dialog, E38/F02).

**Test ids come from the `testid` prefix**: `<testid>-window`, `-submit-button`, `-cancel-button`, `-background`, `-close-button`, `-error`.

**Closing never means saved, and saving never closes.**
The shell emits `submit` and `close` as separate events and never turns one into the other.
Three closes are correct and are pinned: deleting the thing, the explicit close control, and Escape or the backdrop.
The parent learns about a save through its own event, never through `close`: `OrganizationsView` treating close as its refresh signal is why every membership change used to close the dialog.

**A destructive dialog opens focused on Cancel**, deliberately: one stray Enter would otherwise be the whole irreversible action, and Cancel is a `type="button"`, so Enter there cancels.
Any other dialog focuses its first enabled control, else its window.
Focus skips `:disabled` controls, because `focus()` on a disabled element is a silent no-op; that left the create-market dialog opening with focus on `<body>` while its organization select loaded.
**Closing gives focus back to what opened the dialog**, whichever way it closes, and when it is unmounted while open: closing unmounts the window, which dropped focus to `<body>`, so the next Tab started at the top of the page (T45).
The opener is taken as the dialog opens, before focus moves in, and focused once the page behind is no longer inert.
It is left alone when it has left the page, a deleted row or a navigation, and when the parent has already put focus somewhere itself in the same tick.
So an opener that goes away with the click hands focus on first: the phase rail's "More…" menu focuses its button as a choice closes it, as its Escape does, and a Publish or Archive confirm then gives focus back there ([`PhaseRail.vue`](../../../front-end/src/components/PhaseRail.vue)).
`AppDialog` holds no focus trap, so a dialog that swaps one view for another moves focus itself: swapping unmounts the focused button.
Load Template focuses its confirm view's Cancel, then the chosen card again on Cancel ([`TemplatePanel.vue`](../../../front-end/src/components/floorplan/TemplatePanel.vue)).
[`useFocusGoesBack`](../../../front-end/src/utils/useFocusGoesBack.ts) holds that, for `AppDialog` and for the [vendor drawer](../../business/flows/vendor-drawer.md), a modal that is not a dialog on the shell (T123).
The drawer moved no focus in and gave none back, so after every vendor a keyboard user started again from the top of the page; it now opens on its close, its first control, since what follows it may be a verdict or a note, and gives focus back to what opened it: a row on the Vendors page or in the review's All view, a seat's name, or a name at the door.

**A field looks like a field.**
A dialog's text input is the `.field` primitive ([the design language](../../design-system.md#the-primitive-layer)), which owns its height, padding, corners, type and disabled state; nothing resets it (`all: unset` once left the market name as bare text).

**Errors sit in the layout.**
A field's error goes beneath its field, in the body; the `error` prop is for one about the submission as a whole and renders in flow above the actions, never positioned over them.

**The page behind a modal is out of play, not only dimmed.**
`aria-modal="true"` tells assistive technology that everything outside the dialog is out of play, and that has to be true: the vendor drawer once declared it while fourteen controls behind it stayed in the tab order, the rail's "Publish Market" among them, so a keyboard user could publish with a vendor's details open.
A control that can be focused and fired presents itself as available far more strongly than a dimmed one, so the page behind is held `inert` ([`useInertBehind`](../../../front-end/src/utils/useInertBehind.ts)).

**A dialog opened from a dialog is a sibling of it**, so [`useInertBehind`](../../../front-end/src/utils/useInertBehind.ts) marked it out of play: it rendered, read correctly, was visible and enabled, and could not be clicked.
A dialog now takes `inert` off its own branch on open and puts the marks back on close; the marks are counted per element, so the dialog beneath still releases correctly.
**Escape closes only the dialog on top**: every open dialog took the key, so one press closed a confirmation and the dialog beneath it together and left focus on `<body>` (T114).
[`useEscapeToClose`](../../../front-end/src/utils/useEscapeToClose.ts) keeps the open overlays in the order they opened and hands Escape to the last.
A component inside a dialog that opens a dialog of its own teleports it to the body, so it is that sibling rather than a window inside a window: Manage market's permission confirmations do ([setting who may do what](../../business/flows/ending-and-managing-a-market.md#l3a-set-who-may-do-what)).
Asserting this needs a control the page holds: the view container is an ancestor of the dialogs and is never marked, so an assertion on it passes whatever the marks say.

## The create-market dialog

Creating a market is a dialog, not the first section of Market Setup, because a market must not exist until the organizer commits to one: creating in place would leave an empty draft behind every abandoned attempt.
It asks only what a market cannot exist without, its organization, its name and how vendors will apply, and lands on the page where everything else is decided.
With exactly one organization it names it rather than offering a select with one answer; with none it says how to make one (`new-market-org.spec.ts`).

**What Enter does outside a dialog is not decided**: a multi-line text field types a newline and must not submit, and a row editor might reasonably add a row; neither is a dialog.

## Superseded

- The create-market dialog was to ask the name and organization alone (wayfinding/the-order-of-the-work/08); it also asks how vendors will apply, with nothing chosen, since that decides which page it lands on (E31/F03/S01).

## How it is enforced

- [`aDialogGivesFocusBack.test.ts`](../../../front-end/src/__tests__/aDialogGivesFocusBack.test.ts) closes a dialog by each of its paths, and by unmounting it while open, and finds focus back on its opener; and not when the opener has left the page, or the parent moved focus itself.
- [`theVendorDrawerGivesFocusBack.test.ts`](../../../front-end/src/__tests__/theVendorDrawerGivesFocusBack.test.ts) does the same for the vendor drawer, closed by its close, the scrim, Escape and the screen, and finds focus left where it is when another vendor is shown in it; [`the-vendor-drawer-gives-focus-back.spec.ts`](../../../front-end/e2e/the-vendor-drawer-gives-focus-back.spec.ts) opens it by the keyboard from the Vendors page's row, a seat's name on the Assignments page and a name at the door, and finds focus back on each.
- [`modalsHoldThePageInert.test.ts`](../../../front-end/src/__tests__/modalsHoldThePageInert.test.ts) finds every component whose own CSS paints a full-viewport cover and fails if one does not call `useInertBehind` or [`useModalRoot`](../../../front-end/src/utils/useModalRoot.ts).
  It keeps a floor of cover-painting files that falls on purpose as dialogs adopt the shell, since a dialog on `AppDialog` stops painting its own cover.
  `AppDialog` itself is pinned by name, because without that every dialog built on it would leave the rule's sight at once.
  It cannot see a cover painted from outside the component, by a shared stylesheet or a component library, and need not: the app installs no component library ([ADR 0015](../../adr/0015-the-app-owns-its-components.md)), since the floorplan's Edit Table Type, Save Template and Load Template dialogs, which were a library's and drew with no window and no scrim, moved onto `AppDialog` (T45).
- [`dialog-idiom.spec.ts`](../../../front-end/e2e/dialog-idiom.spec.ts) drives, in a browser, Enter in every dialog, focus on open and focus given back on close (the create-market dialog, a dialog opened from a dialog, and Edit Table Type), Manage organization staying open through saves and closing by its close control, the backdrop and Escape, a dialog opened from a dialog, Escape there closing only the one on top, the floorplan's Edit Table Type dialog (its window and scrim, Enter from any field, and a unit change that saves the same millimetres), and its template dialogs (Save Template's Enter through its guard, its three closes, and staying open through a save in flight; Load Template's list, its confirm view, Cancel back to the list, and Replace, with focus following each view).

## What breaks it

- A hand-rolled overlay with its own scrim, or a key handler for Enter.
- A parent that refreshes on `close`, or a dialog that closes itself as the sign that it saved.
- A component that paints a full-viewport cover without holding the page inert.
