---
layer: implementation
kind: convention
describes:
  - front-end/src/components/AppDialog.vue
  - front-end/src/utils/useInertBehind.ts
  - front-end/src/__tests__/useInertBehind.test.ts
  - front-end/e2e/a-dialog-mounted-open-holds-the-page.spec.ts
  - front-end/src/utils/useModalRoot.ts
  - front-end/src/utils/useEscapeToClose.ts
  - front-end/src/utils/useFocusGoesBack.ts
  - front-end/src/__tests__/modalsHoldThePageInert.test.ts
  - front-end/src/__tests__/aDialogGivesFocusBack.test.ts
  - front-end/src/__tests__/theVendorDrawerGivesFocusBack.test.ts
  - front-end/e2e/the-vendor-drawer-gives-focus-back.spec.ts
  - front-end/e2e/dialog-idiom.spec.ts
  - front-end/src/components/SearchPicker.vue
  - front-end/src/__tests__/removingSomeoneAsksFirst.test.ts
  - front-end/e2e/removing-someone-asks-first.spec.ts
  - front-end/src/__tests__/appDialog.test.ts
  - front-end/e2e/the-component-library-dialog.spec.ts
  - front-end/src/__tests__/changingARoleAsksFirst.test.ts
  - front-end/e2e/changing-a-role-asks-first.spec.ts
  - front-end/e2e/the-component-library-summaries.spec.ts
  - front-end/src/components/DoorCodeScreen.vue
  - front-end/src/components/ScrollBox.vue
  - front-end/src/__tests__/scrollBox.test.ts
  - front-end/e2e/the-long-dialogs-scroll-their-body.spec.ts
verified: 2026-11-05
sources:
  - wayfinding/the-order-of-the-work/08
  - wayfinding/the-order-of-the-work/map
  - E14/F02/S02
  - E14/F02/S04
  - E20/F01
  - E20/F01/S01
  - E31/F03/S01
  - E40/F02/S01
  - E20
  - T45
  - E39/F01/S04
  - E38/F08/S03
  - T123
  - T142
  - T148
  - E38/F15/S01
  - T181
  - T200
  - T211
  - T204
  - T217
---

# Dialogs

**[`AppDialog.vue`](../../../front-end/src/components/AppDialog.vue) is what a dialog is in this product**: a native `<form>` in a modal doing one small job.
It owns the scrim, the window, the close control, Escape and backdrop dismissal, holding the page behind inert, focus on open, and the `type="submit"` confirm.
A new dialog is built on it, never hand-rolled; a panel that slides in from a side is [`SidePanel`](../../design-system.md#the-primitive-layer), through the same composables.
Not every modal is a dialog on it.
Two take the shell's parts rather than copying them: the [vendor drawer](../../business/flows/vendor-drawer.md), a panel beside the page, and the door code's full screen ([`DoorCodeScreen.vue`](../../../front-end/src/components/DoorCodeScreen.vue), [attendance and the door](../modules/attendance-and-door.md)), which fills the window at the entrance where a dialog is a small window over the page.
The floorplan's [`SaveFlow.vue`](../../../front-end/src/components/floorplan/SaveFlow.vue) and [`SectionGrouping.vue`](../../../front-end/src/components/floorplan/SectionGrouping.vue) are hand-rolled, with their own scrim and window and, of the shell's parts, only `useModalRoot`, each scrolling in a `ScrollBox` of its own; the app's navigation drawer holds the page inert with `useInertBehind` in [`App.vue`](../../../front-end/src/App.vue).
The door code's screen declares `role="dialog"` and `aria-modal` itself, and makes it true with `useModalRoot`, `useEscapeToClose` and `useFocusGoesBack`, so the page behind is inert, Escape closes it while it is on top, and focus opens on its Close and goes back to "Door code"; its one confirmation, New code, is an `AppDialog`, teleported beside it as a sibling.

## The rules

**The form is the Enter contract.**
Enter in a field runs the same handler as the confirm button, so it inherits that handler's guard, and a disabled submit makes Enter inert with no key handler anywhere.
Do not add `@keydown.enter`: five views each invented their own answer, and one of them, the vendor's sign-in, bypassed its own resend cooldown by doing so.
One exception is a picker's open list ([`SearchPicker.vue`](../../../front-end/src/components/SearchPicker.vue), E38/F08/S03): while its list is open, Enter takes the highlighted choice, or closes the list when none is highlighted, and is kept from the form (with `multiple` the list stays open after a choice, so the next Enter is the list's too), and Escape closes the list and is kept from the dialog; once the list is closed both keys are the dialog's again, so Enter submits through the form's guard and Escape closes.
The list stays through a press past it, until the press ends, so the click lands on the Save below it, which closing it as the focus goes would move away.
The other is a field that only narrows what is shown, as a [`ListFrame.vue`](../../../front-end/src/components/ListFrame.vue)'s find field and the library's export prototype's name or email field, column checklist's find field and Mine tick have, in which Enter does nothing: it narrows the rows as it is typed in or ticked, so Enter there would only save what the person was looking through.

**A dialog of several independent actions passes no `confirmLabel`** and hosts its own `<form>`s in its body; Manage organization has three.
Their submits are their own: the shell listens for `submit` only when its body is the form, so an inner form's submit neither is prevented by it nor makes it emit `submit`.
It still gets the scrim, window, close, Escape, backdrop and inert behaviour, without the single-form footer.
**Its own buttons can still be pinned at its foot, through the `actions` slot**: the footer draws with `confirmLabel` or that slot, and with the slot alone the body is no `<form>`, so those buttons submit nothing and an inner form's submit is still its own.

**A dialog is one of three widths, `size="narrow"` (26rem, the default), `"wide"` (38rem) or `"broad"` (60rem), never wider than the window less a 16px gutter at each side**, and never a percentage of the window.
Narrow holds two controls, wide a list, and broad a list beside what it gathers, the export dialog's columns and preview.
A dialog's window is a rounded frame that never scrolls, so no scroll bar can square its corners; what is taller than it scrolls in a [`ScrollBox`](../../../front-end/src/components/ScrollBox.vue) ([the design language](../../design-system.md#the-primitive-layer)) inside it.
**By default that box holds the title and the body (`scroll="window"`)**, with the close staying put over it, on its own white ground, so words scrolling beneath it never run through it.
This default stays for a short dialog, a question with a control or two, by Daniel's choice (T204's choice 21): only the long dialogs move to `scroll="body"`.
So a dialog on a page that fits a phone opens inside a 390px window, on each place [the design language](../../design-system.md#layout) lists as fitting one; only the people and add rows of Manage market and Manage organization needed a phone rule of their own.
The footer's buttons wrap where they are wider than the window, as the placement dialog's Cancel, Free this seat and Move them are on a phone; a row that could not wrap ran out past the window's left edge, where nothing scrolls to it.

**A long dialog scrolls only its body, with `scroll="body"`** (T200): the title and close stay at the top and the error and actions at the bottom, and only the body scrolls, in a `ScrollBox` between them.
When the whole window scrolls, its title and Save leave the view.
The window takes the height its content needs, up to 80% of the window's height, Daniel's "sensible proportion of the view height" (T191 F02).
With nothing pinned at its foot the body runs to the frame, so its shade ends there rather than above a blank band, and its own end holds the window's 24px inset.
A `ScrollBox` draws no bar and shades an edge with more beyond it, `--edge-shade` over `--edge-shade-depth` from `base.css`, 12px by Daniel's choice 20; it measures as the body scrolls and as it or its content is resized.
On a browser that draws classic bars no bar lies over the body, which clipped the export dialog's column order on the right (T191 F03).
The body, the error and the actions are still the one `<form>`, so the Enter contract holds as it is.
**What the dialog has gathered goes in its `tray` slot**, drawn only when given, between the body and the error and actions: in `scroll="body"` it is a `ScrollBox` of its own, pinned, that keeps its height up to 40% of the window (Daniel's choice 20), the body giving way, and scrolls inside itself past that; in `scroll="window"` it is in the flow after the body.
**At 640px wide or less, or 640px tall or less, a `scroll="body"` dialog is as tall as the window less the 24px gutter above and below**, whatever its content needs, so its pinned parts never crowd its body to nothing (Daniel's choice 22); the height clause is for a window split short, where 80% would leave the body nothing.
`dvh` sizes it, since a phone's browser bar would otherwise cover its pinned actions.
An `anchored` dialog keeps its top where it opened, under the same 80% cap; on a phone or in a short window it is as tall as what lies below that top less the gutter.
**A dialog is long when its body can outgrow a laptop window as a market's data grows**: its window scrolled in a sweep, or its body holds a list that grows with the market.
A long dialog says `scroll="body"`: Manage market, Manage organization, Update info, the placement dialog and the assignment history, Delete organization, Fix the form, Open applications, Change reviewers and the whole list of reviewers, Load market, Load Template, both confirmations of a permissions reset, and a role change's.
The export dialog is long too, and scrolls whole until it is rebuilt on `scroll="body"`.
`scroll="window"` stays the default, for every other dialog: a question with a control or two.
The library's `dialog` entry shows each width, the window's scroll beside the body's on 150 people, the tray, a footer with no form, a list with nothing to focus, and every behaviour below in either scroll, and its `export-vendors` entry a broad dialog with its whole tray, the export redesigned ([the component library](../modules/component-library.md)).
A long list goes in that body as a [`ListFrame.vue`](../../../front-end/src/components/ListFrame.vue), whose field keeps its Enter, as above, and which needs nothing else there: the library's `summaries` entry holds the reviewed list so ([`the-component-library-summaries.spec.ts`](../../../front-end/e2e/the-component-library-summaries.spec.ts)).

**A dialog sits centred, unless its body grows as it is used**: `anchored` holds its top where it opened, so a field's error appearing as a key is typed does not move the dialog half a line under the pointer (the amendment's dialog, E38/F02).

**Test ids come from the `testid` prefix**: `<testid>-window`, `-submit-button`, `-cancel-button`, `-background`, `-close-button`, `-error`, and what scrolls: `-scroll` when the title and the body scroll together, `-body`, the `-scrolled` content inside it, and `-tray` under `scroll="body"`, and `-shade-top` and `-shade-bottom` on either's shades (a tray's are `-tray-shade-top` and `-tray-shade-bottom`).

**Closing never means saved, and saving never closes.**
The shell emits `submit` and `close` as separate events and never turns one into the other.
Three closes are correct and are pinned: deleting the thing, the explicit close control, and Escape or the backdrop.
The parent learns about a save through its own event, never through `close`: `OrganizationsView` treating close as its refresh signal is why every membership change used to close the dialog.

**A destructive dialog opens focused on Cancel**, deliberately: one stray Enter would otherwise be the whole irreversible action, and Cancel is a `type="button"`, so Enter there cancels.
Any other dialog focuses its first enabled control that is not destructive: a dialog listing people never opens on the first person's Remove, which one stray Enter would take (Manage organization did, on its first admin's), and a control that takes something away without being drawn destructive, as a [`SearchPicker.vue`](../../../front-end/src/components/SearchPicker.vue) chip's Remove does, carries `data-dialog-not-first` for the same reason.
**A dialog with no such control opens on a box with more to show, else on its window**, so the arrow keys scroll a read-only list: from the window they would scroll nothing.
What can take focus is one list for the dialog and the box ([`focusable.ts`](../../../front-end/src/utils/focusable.ts)), so a body holding only a fold opens on its summary.
That box is the `ScrollBox` with a Tab stop, which only one with nothing inside it to take focus has, so a dialog whose every control is a chip's Remove, with nothing safe to open on, opens on its window, and Tab reaches the first Remove.
The window draws no ring when it takes focus, as Manage market's does while its market loads: `primitives.css` draws nothing around what only a script focuses ([the design language](../../design-system.md#the-primitive-layer)).
Focus skips `:disabled` controls, because `focus()` on a disabled element is a silent no-op; that left the create-market dialog opening with focus on `<body>` while its organization select loaded.
The floorplan's save dialog, section dialog and calibration panels are not on the shell, so each moves focus in itself: `autofocus` works once a page, which left a redraw's length field unfocused, and a window hidden by `visibility` cannot take focus until it is shown, so the save dialog's shows at once and only its opacity fades.
**Closing gives focus back to what opened the dialog**, whichever way it closes, and when it is unmounted while open: closing unmounts the window, which dropped focus to `<body>`, so the next Tab started at the top of the page (T45).
The opener is taken as the dialog opens, before focus moves in, and focused once the page behind is no longer inert.
It is left alone when it has left the page, a deleted row or a navigation, and when the parent has already put focus somewhere itself in the same tick.
So a confirmation whose confirm takes its opener away puts focus somewhere itself: Manage organization's and Manage market's Remove asks first (E38/F15/S01), and confirming takes that Remove away with what it removed (the row, or the line of a market role that added nothing), so focus goes to the list it was in, a `tabindex="-1"` group named by its heading, once the confirmation has closed and the page behind is no longer inert; Cancel and Escape leave the row, and focus goes back to its Remove.
Manage market's role select asks first too (T211), and the shell gives focus back to the select, by Cancel, Escape, the backdrop, a refusal or a confirm, and the view focuses the select on opening, since Safari does not on a click; only when the re-read leaves no select, as it does for someone who changed their own role, does focus go to that same list.
So an opener that goes away with the click hands focus on first: the phase rail's "More…" menu focuses its button as a choice closes it, as its Escape does, and a Publish or Archive confirm then gives focus back there ([`PhaseRail.vue`](../../../front-end/src/components/PhaseRail.vue)).
`AppDialog` holds no focus trap, so a dialog that swaps one view for another moves focus itself: swapping unmounts the focused button.
So does a row that takes the place of the button that opened it: Manage market's "Add user" and Manage organization's "Add admin" and "Add member" focus the row's field as it opens, and their button again as its Cancel closes it.
Load Template focuses its confirm view's Cancel, then the chosen card again on Cancel ([`TemplatePanel.vue`](../../../front-end/src/components/floorplan/TemplatePanel.vue)).
[`useFocusGoesBack`](../../../front-end/src/utils/useFocusGoesBack.ts) holds that, for `AppDialog` and for four modals that are not dialogs on the shell: the [vendor drawer](../../business/flows/vendor-drawer.md) (T123), the door code's full screen, [`SidePanel`](../../design-system.md#the-primitive-layer), the shell proposed for the drawer (T200), and the floorplan's save dialog.
The drawer moved no focus in and gave none back, so after every vendor a keyboard user started again from the top of the page; it now opens on its close, its first control, since what follows it may be a verdict or a note, and gives focus back to what opened it: a row on the Vendors page or in the review's All view, a seat's name, or a name at the door.
Another vendor shown in the open drawer takes focus to its close the same way: a vendor named in its History tab is shown in place on the Vendors page, and the focused name goes with the panel it sat in, which left focus on `<body>` (T162).

**A field looks like a field.**
A dialog's text input is the `.field` primitive ([the design language](../../design-system.md#the-primitive-layer)), which owns its height, padding, corners, type and disabled state; nothing resets it (`all: unset` once left the market name as bare text).

**Errors sit in the layout.**
A field's error goes beneath its field, in the body; the `error` prop is for one about the submission as a whole and renders in flow above the actions, never positioned over them.

**The page behind a modal is out of play, not only dimmed.**
`aria-modal="true"` tells assistive technology that everything outside the dialog is out of play, and that has to be true: the vendor drawer once declared it while fourteen controls behind it stayed in the tab order, the rail's "Publish market" among them, so a keyboard user could publish with a vendor's details open.
A control that can be focused and fired presents itself as available far more strongly than a dimmed one, so the page behind is held `inert` ([`useInertBehind`](../../../front-end/src/utils/useInertBehind.ts)).
**A dialog may mount already open, and is held all the same**: the change-placement dialog and the floorplan's choose-a-path overlay are `v-if` dialogs with `:open="true"`, open from setup, before the template ref that names the dialog's root has bound.
`useInertBehind` watched the open state alone, so it walked once with no root to walk from and never again, and Tab walked out of the change-placement dialog onto the market bar behind it (T181).
It watches the dialog's parts with the open state, so the ref binding on mount runs the walk; a re-run releases before it marks, so no element is counted twice, and a branch that a dialog open on top of it holds live stays live (below).

**A dialog opened from a dialog is a sibling of it**, so [`useInertBehind`](../../../front-end/src/utils/useInertBehind.ts) marked it out of play: it rendered, read correctly, was visible and enabled, and could not be clicked.
A dialog now takes `inert` off its own branch on open and puts the marks back on close; the marks are counted per element, so the dialog beneath still releases correctly, and so is the hold, so a walk of the dialog beneath while the one on top is open leaves the one on top live (T181).
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

- [`appDialog.test.ts`](../../../front-end/src/__tests__/appDialog.test.ts) pins the markup of a dialog that asks for none of `size`, `scroll` or `tray`, which changed once, on purpose, when its window became a frame around a `ScrollBox` (T217), and drives each width, the body scroll (the title, close, error and actions outside the scroller, one form, Escape, the scrim, Cancel, focus in and back, a destructive dialog opening on Cancel, the page held inert), the shades coming and going in either scroll, the tray, the footer with and without a form, and where a dialog with nothing to focus opens; [`the-component-library-dialog.spec.ts`](../../../front-end/e2e/the-component-library-dialog.spec.ts) opens each of the library's dialogs at a desk and on a phone and measures what a browser lays out: each width, the title and actions in view as the body scrolls to its end, nothing past the body's right edge at 390 and 1280, the window's corners, the tray's cap, the height at 1440x900, 1280x720, 390x844 and 1280x600, the arrow keys scrolling a list with nothing to focus, and, with `ignoreDefaultArgs: ['--hide-scrollbars']`, no bar in either scroll.
- [`scrollBox.test.ts`](../../../front-end/src/__tests__/scrollBox.test.ts) drives the scroller at its seam: its shades coming and going as it scrolls and resizes, each axis, each tone, and the Tab stop only while it overflows with nothing focusable inside; [`the-component-library-components.spec.ts`](../../../front-end/e2e/the-component-library-components.spec.ts) reads what a browser draws of each, print among them.
- [`the-long-dialogs-scroll-their-body.spec.ts`](../../../front-end/e2e/the-long-dialogs-scroll-their-body.spec.ts) opens Manage market, Manage organization and Update info on the stress seed, at 1440 and 390 on a browser drawing classic bars, wheels each body to its end and finds the title, close and buttons unmoved, the corners round, no bar and nothing past the body's right edge; in a short window it finds a body with nothing pinned beneath it running to the frame, opens each Add row, finds its field focused and scrolled into view and submits it by Enter; it holds an anchored dialog's top and its cap on a body that outgrows it; and it finds a `-body` and no `-scroll` on the placement dialog, the assignment history, Delete organization and Open applications, as the specs that open Fix the form, Load market, Load Template and the permissions reset do there.
- [`aDialogGivesFocusBack.test.ts`](../../../front-end/src/__tests__/aDialogGivesFocusBack.test.ts) closes a dialog by each of its paths, and by unmounting it while open, and finds focus back on its opener; and not when the opener has left the page, or the parent moved focus itself.
- [`theVendorDrawerGivesFocusBack.test.ts`](../../../front-end/src/__tests__/theVendorDrawerGivesFocusBack.test.ts) does the same for the vendor drawer, closed by its close, the scrim, Escape and the screen, and finds focus on its close when another vendor is shown in it, then back on its first opener when that drawer closes; [`the-vendor-drawer-gives-focus-back.spec.ts`](../../../front-end/e2e/the-vendor-drawer-gives-focus-back.spec.ts) opens it by the keyboard from the Vendors page's row, a seat's name on the Assignments page and a name at the door, and finds focus back on each.
- [`modalsHoldThePageInert.test.ts`](../../../front-end/src/__tests__/modalsHoldThePageInert.test.ts) finds every component whose own CSS paints a full-viewport cover and fails if one does not call `useInertBehind` or [`useModalRoot`](../../../front-end/src/utils/useModalRoot.ts).
  It keeps a floor of cover-painting files that falls on purpose as dialogs adopt the shell, since a dialog on `AppDialog` stops painting its own cover.
  `AppDialog` itself is pinned by name, because without that every dialog built on it would leave the rule's sight at once.
  It cannot see a cover painted from outside the component, by a shared stylesheet or a component library, and need not: the app installs no component library ([ADR 0015](../../adr/0015-the-app-owns-its-components.md)), since the floorplan's Edit Table Type, Save Template and Load Template dialogs, which were a library's and drew with no window and no scrim, moved onto `AppDialog` (T45).
- [`useInertBehind.test.ts`](../../../front-end/src/__tests__/useInertBehind.test.ts) holds the walk: the page's other branches marked and the modal not, the marks given back on close and on unmount, an element already `inert` left as it was found, the counted marks of two modals open at once, a dialog on top kept live while the one beneath walks again, and a modal mounted already open with its root bound by template ref, the choose-a-path overlay among them; [`a-dialog-mounted-open-holds-the-page.spec.ts`](../../../front-end/e2e/a-dialog-mounted-open-holds-the-page.spec.ts) opens the change-placement dialog on the screens seed's big market at 390 and 1440, finds the market frame and the rail inert, Tab walking only the dialog's controls, and Escape giving the page and focus on the seat's Change back.
- [`removingSomeoneAsksFirst.test.ts`](../../../front-end/src/__tests__/removingSomeoneAsksFirst.test.ts) and [`removing-someone-asks-first.spec.ts`](../../../front-end/e2e/removing-someone-asks-first.spec.ts) open each Remove's confirmation, find it named by its question and opened on Cancel, close it by Cancel and by Escape (only it, not the dialog beneath) with focus back on the Remove and nothing removed, and confirm it, with focus on the list.
- [`changingARoleAsksFirst.test.ts`](../../../front-end/src/__tests__/changingARoleAsksFirst.test.ts) and [`changing-a-role-asks-first.spec.ts`](../../../front-end/e2e/changing-a-role-asks-first.spec.ts) choose a role, find the confirmation named by its question with nothing sent, close it by Cancel, Escape and the backdrop (only it, not the dialog beneath) with the select back on the role held and focused, confirm it with one write and focus on the select, or on the list when the select has gone, and find a refusal said beneath the row, with the list re-read.
- [`dialog-idiom.spec.ts`](../../../front-end/e2e/dialog-idiom.spec.ts) drives, in a browser, Enter in every dialog, focus on open and focus given back on close (the create-market dialog, a dialog opened from a dialog, and Edit Table Type), Manage organization staying open through saves and closing by its close control, the backdrop and Escape, its controls at the product's height with each add row's own Cancel and opening on no Remove, a dialog opened from a dialog, Escape there closing only the one on top, the floorplan's Edit Table Type dialog (its window and scrim, Enter from any field, and a unit change that saves the same millimetres), and its template dialogs (Save Template's Enter through its guard, its three closes, and staying open through a save in flight; Load Template's list, its confirm view, Cancel back to the list, and Replace, with focus following each view).

## What breaks it

- A hand-rolled overlay with its own scrim, or a key handler for Enter.
- A parent that refreshes on `close`, or a dialog that closes itself as the sign that it saved.
- A component that paints a full-viewport cover without holding the page inert.
