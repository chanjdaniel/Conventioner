---
layer: implementation
kind: convention
describes:
  - front-end/src/components/AppDialog.vue
  - front-end/src/utils/useInertBehind.ts
  - front-end/src/utils/useModalRoot.ts
  - front-end/src/__tests__/modalsHoldThePageInert.test.ts
  - front-end/e2e/dialog-idiom.spec.ts
verified: 2026-10-22
sources:
  - wayfinding/the-order-of-the-work/08
  - wayfinding/the-order-of-the-work/map
  - E14/F02/S02
  - E14/F02/S04
  - E20/F01
  - E20/F01/S01
  - E31/F03/S01
---

# Dialogs

**[`AppDialog.vue`](../../../front-end/src/components/AppDialog.vue) is what a dialog is in this product**: a native `<form>` in a modal doing one small job.
It owns the scrim, the window, the close control, Escape and backdrop dismissal, holding the page behind inert, focus on open, and the `type="submit"` confirm.
A new dialog is built on it, never hand-rolled.

## The rules

**The form is the Enter contract.**
Enter in a field runs the same handler as the confirm button, so it inherits that handler's guard, and a disabled submit makes Enter inert with no key handler anywhere.
Do not add `@keydown.enter`: five views each invented their own answer, and one of them (`ApplicantLogin`) bypassed its own resend cooldown by doing so.

**A dialog of several independent actions passes no `confirmLabel`** and hosts its own `<form>`s in its body; Manage organization has three.
It still gets the scrim, window, close, Escape, backdrop and inert behaviour, without the single-form footer.

**Test ids come from the `testid` prefix**: `<testid>-window`, `-submit-button`, `-cancel-button`, `-background`, `-close-button`, `-error`.

**Closing never means saved, and saving never closes.**
The shell emits `submit` and `close` as separate events and never turns one into the other.
Three closes are correct and are pinned: deleting the thing, the explicit close control, and Escape or the backdrop.
The parent learns about a save through its own event, never through `close`: `OrganizationsView` treating close as its refresh signal is why every membership change used to close the dialog.

**A destructive dialog opens focused on Cancel**, deliberately: one stray Enter would otherwise be the whole irreversible action, and Cancel is a `type="button"`, so Enter there cancels.
Any other dialog focuses its first enabled control, else its window.
Focus skips `:disabled` controls, because `focus()` on a disabled element is a silent no-op; that left the create-market dialog opening with focus on `<body>` while its organization select loaded.

**A field looks like a field.**
A dialog's text input is the `.field` primitive ([the design language](../../design-system.md#the-primitive-layer)), which owns its height, padding, corners, type, focus and disabled state; nothing resets it (`all: unset` once left the market name as bare text).

**Errors sit in the layout.**
A field's error goes beneath its field, in the body; the `error` prop is for one about the submission as a whole and renders in flow above the actions, never positioned over them.

**A dialog opened from a dialog is a sibling of it**, so [`useInertBehind`](../../../front-end/src/utils/useInertBehind.ts) marked it out of play: it rendered, read correctly, was visible and enabled, and could not be clicked.
A dialog now takes `inert` off its own branch on open and puts the marks back on close; the marks are counted per element, so the dialog beneath still releases correctly.
Asserting this needs a control the page holds: the view container is an ancestor of the dialogs and is never marked, so an assertion on it passes whatever the marks say.

## The create-market dialog

Creating a market is a dialog, not the first section of Market Setup, because a market must not exist until the organizer commits to one: creating in place would leave an empty draft behind every abandoned attempt.
It asks only what a market cannot exist without, its organization, its name and how vendors will apply, and lands on the page where everything else is decided.
With exactly one organization it names it rather than offering a select with one answer; with none it says how to make one (`new-market-org.spec.ts`).

**What Enter does outside a dialog is not decided**: a multi-line text field types a newline and must not submit, and a row editor might reasonably add a row; neither is a dialog.

## Superseded

- The create-market dialog was to ask the name and organization alone (wayfinding/the-order-of-the-work/08); it also asks how vendors will apply, with nothing chosen, since that decides which page it lands on (E31/F03/S01).

## How it is enforced

- [`modalsHoldThePageInert.test.ts`](../../../front-end/src/__tests__/modalsHoldThePageInert.test.ts) finds every component whose own CSS paints a full-viewport cover and fails if one does not call `useInertBehind` or [`useModalRoot`](../../../front-end/src/utils/useModalRoot.ts).
  It keeps a floor of cover-painting files that falls on purpose as dialogs adopt the shell, since a dialog on `AppDialog` stops painting its own cover.
  `AppDialog` itself is pinned by name, because without that every dialog built on it would leave the rule's sight at once.
  PrimeVue's modal `Dialog` is listed by name too: its mask is painted from the library's stylesheet, and its own focus trap covers it.
- [`dialog-idiom.spec.ts`](../../../front-end/e2e/dialog-idiom.spec.ts) drives, in a browser, Enter in every dialog, focus on open, Manage organization staying open through saves and closing by its close control, the backdrop and Escape, and a dialog opened from a dialog.

## What breaks it

- A hand-rolled overlay with its own scrim, or a key handler for Enter.
- A parent that refreshes on `close`, or a dialog that closes itself as the sign that it saved.
- A component that paints a full-viewport cover without holding the page inert.
