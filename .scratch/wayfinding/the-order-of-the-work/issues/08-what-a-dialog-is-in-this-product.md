# 08: What is a dialog in this product?

Type: grilling
Status: resolved
Blocked by: -

## Question

Four of this walk's items are about dialogs, and they are the same question asked four times.

**The create-new-market modal is the least considered screen in the product, and it is the first thing an organizer does.**
Its market name field is stripped twice over: `.text-input-container input` is `all: unset`, removing the browser's border, background, padding and height; and the container around it declares `border-radius: var(--radius-card)` with **no `border` and no `background`**, under a comment reading *"a field is a border (E16/F02)"* - the comment states the intent, the declaration was never written.
So the field renders as bare text and reads as a suggested title rather than as an input.

**The Manage organization modal closes itself on every membership change.**
`handleAddAdmin`, `handleAddMember` and `handleRemoveUser` all succeed and then `emit('manageClose')`.
Adding two people means reopening the modal between them.

**No dialog input submits on Enter.**
`ManageOrgOverlay` (three inputs), `ManageMarketOverlay`, `PlacementDialog` and `CsvImportView` have no Enter handling at all.
Six other places do, and they disagree: `@keydown.enter` in `NewMarketOverlay`, `OrganizationsView` and the three floorplan panels (two with `.prevent`), `@keyup.enter` in `ApplicantLogin` and `SectionGrouping`.
Six views get it free from a native `<form>`.

### What to decide

**What a dialog in this product is - its structure, its controls, its keyboard contract - decided once and applied to all of them.**

- **What does creating a market actually need?**
  Only a name and an organization are required today.
  Should the dialog ask for more so the market starts further along, or stay minimal and hand off to the workspace?
  Ticket 01's answer bears on this.
- **What does it look like with exactly one organization, or none?**
  The select is then a control with no choice in it.
  `new-market-org.spec.ts` already pins a zero-org fallback that must keep working.
- **Where do errors go?**
  `.error-message` is absolutely positioned at `top: 35px; left: 50%` - a value chosen against a layout, not a rule.
- **Is a modal even right for creating a market?**
  A full screen would have room to say what a market is and what happens next.
- **What is the Enter contract?**
  Enter must go *through* the same handler as the button so it inherits the empty/invalid guard, and must be inert where the button is disabled.
  Open: what Enter means in a multi-line textarea, and in a row-based plan card where it might reasonably mean "add another row".
- **Does closing ever mean "saved"?**
  In `ManageOrgOverlay`, `emit('manageClose')` does double duty: the parent (`OrganizationsView.vue:74`) treats close as its refresh signal.
  Whatever replaces it needs the overlay refreshing its own data *and* the parent still learning about the change.

### Notes

**Whatever is decided here becomes the product's dialog idiom.**
`ManageOrgOverlay`, `ManageMarketOverlay`, `PlacementDialog` and the market-archive confirmation are all the same shape as the create-market dialog.

**There is a precedent inside the file that needs fixing.**
`handleRename` in `ManageOrgOverlay` already does the right thing - updates `orgData` locally on success and does not close.
Three closes there are correct and must stay: deleting the organization, the explicit close button, and the Escape/background dismiss.

**Test impact:** `front-end/e2e/pages/OrganizationsPage.ts` and the org specs assume the modal closes after add/remove.

**Two fixes ride on this ticket.**
`F03` (the borderless name field) is inside the dialog this ticket may redesign; fix it on its own if the ticket sits, because a field with no border is a defect either way.
`P1` (Enter submits) is a product-wide policy whose *missing* half is these four dialogs - the six already-working hand-rolled cases should converge on whatever pattern this ticket picks.

**Precedent to compose from, not replace:** `docs/design-system.md` and `front-end/src/assets/primitives.css`.
A redesign that invents new values rather than composing those is what `E16` exists to stop.

Findings: `Q3`, `F03`, `F08`, `P1` in `.scratch/qc/2026-09-21-manual-qc.md`.

## Answer

**A dialog is a native `<form>` in a modal, doing one small thing, which stays open until the organizer closes it.**

### The create-market dialog stays a modal, and stays minimal

Name plus organization, nothing more.
[Ticket 02](02-what-the-draft-workspace-looks-like.md) made `draft` a full-width ordered page where everything else about a market is decided in sequence, so the dialog's job shrinks to **giving the market an identity** and handing off.
Create lands the organizer at the top of that page.

It is a modal rather than a first section of the draft page because a market must not exist until the organizer commits to one.
Creating in place would leave an empty draft behind every abandoned attempt.

### Four rules, which apply to every dialog

**1. The dialog is a `<form>`, and its confirm button is `type="submit"`.**
This is the answer to `P1`.
Six views already get Enter free this way - `LoginView`, both password-reset views, `ApplicationPage`, `AttendanceCheckinView`, `FormPreview` - and a native form makes the two requirements automatic rather than remembered: submission runs the same handler as the button, so it inherits the empty/invalid guard, and a `disabled` submit makes Enter inert with no extra code.
The six hand-rolled cases converge on it: `@keydown.enter` in `NewMarketOverlay`, `OrganizationsView` and the three floorplan panels, `@keyup.enter` in `ApplicantLogin` and `SectionGrouping`.
The four with nothing - `ManageOrgOverlay`, `ManageMarketOverlay`, `PlacementDialog`, `CsvImportView` - gain it by being wrapped.

**Still open, deliberately:** what Enter means in a multi-line textarea (it types a newline; it must not submit) and in a row-based editor where it might reasonably add a row.
Neither is a dialog, so neither is decided here.

**2. Closing never means "saved", and saving never closes.**
`F08`: `handleAddAdmin`, `handleAddMember` and `handleRemoveUser` stop emitting `manageClose`.
The overlay refreshes its own `orgData` on success - `handleRename` in the same file already does exactly this and is the model - and the parent learns about the change through a **separate event**, not through close.
`OrganizationsView.vue:74` currently treats close as its refresh signal, and that coupling is what made every membership change close the modal.

Three closes are correct and stay: deleting the organization, the explicit close button, and the Escape or background dismiss.

**3. A field looks like a field.**
`F03`: the market name input renders as bare text because `.text-input-container input` is `all: unset` and the container declares `border-radius` with no `border` and no `background`, under a comment reading "a field is a border (E16/F02)" that was never implemented.
`.field` in `primitives.css` owns control height, padding, radius, type, focus and disabled state; the dialog reaches for it and drops the `all: unset`, which would defeat the primitive too.
**`F03` is answered here and is no longer held for `E17`.**

**4. Errors sit in the layout, not on top of it.**
`.error-message` is `position: absolute; top: 35px; left: 50%` - a value measured against one arrangement.
An error belongs in flow, beneath the control it is about, so it cannot be orphaned by a change to the dialog above it.

### The organization select, with one org and with none

With exactly one organization it is a control offering no choice, and it should say what it is rather than pretend to ask: the organization is named, not selected.
With none, the existing zero-org fallback stands - `front-end/e2e/new-market-org.spec.ts` pins it and must keep passing.

### Consequences

- **This is the idiom for the other four.** `ManageOrgOverlay`, `ManageMarketOverlay`, `PlacementDialog` and the market-archive confirmation are the same shape and adopt all four rules.
- **Test impact:** `front-end/e2e/pages/OrganizationsPage.ts` and the org specs assume the modal closes after add and remove. Those expectations move with the behaviour.
- **The archive confirmation is the one irreversible action in the product**, and CLAUDE.md records that it once rendered as white text on a white dialog because `--mm-text-red` was referenced and never defined. Whatever this idiom produces, that dialog is the one to verify by opening it.
