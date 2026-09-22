---
id: E20/F03/S01
title: Fixing the form without leaving the import
type: story
status: ready
blocked_by: [E20/F01/S01]
pr: []
---

## What to build

When the column mapping reveals the form asked the wrong thing, the organizer opens a dialog, fixes the form, and carries on - with their upload and their mapping intact.

Today the wizard prints instructions instead: *"Reopen the market for editing, turn it off in the form builder, then open applications and import again."*
Four manual steps, two phase transitions, and the file is gone.

## The chain, and why it differs by phase

Editing a form is legal only while the market is a draft, and the wizard runs in **two** phases, not one.

- From **applications open**, the chain is two hops: down to draft, write the form, back.
- From **applications closed**, it is four, because there is no edge from that phase back to draft and **none is being added** - the transition table deliberately allows only the open phase to return, on the grounds that a market which has closed applications has moved past the point where its form is a draft of anything.

The dialog returns the market to **the phase it started in**, whichever that was.

## Pre-flight, not rollback

**Nothing moves until the whole chain is known to succeed.**

The organizer opens the dialog and edits with the phase unchanged.
On confirm, the edited form is checked against every guard on the return path - that the form still asks something, and that no application exists - server-side as the authority, mirrored client-side so a refusal is immediate.
Only then does the market leave its phase.

This removes the failure the dead end would otherwise have traded for: a form edited empty, a refused return, and a market stranded in draft mid-import with no hint that a phase moved.
There is nothing to roll back because nothing moved.

## Acceptance criteria

- [ ] A dialog opened from the mapping step edits the application form and returns the market to the phase it started in - verified from **both** import phases.
- [ ] No new phase transition is added to the transition table.
- [ ] Every guard on the return path is checked **before** the market leaves its phase; a form edited so that it asks nothing is refused with an explanation and the market does not move.
- [ ] A chain that stops partway - transport failure, or a concurrent change - **says where it stopped and offers to finish**. It never fails silently and never leaves the organizer to discover the phase from the rail.
- [ ] The wizard's uploaded file, resolved mapping and cursor position all survive the dialog. Without this the story trades a four-step round trip for a two-step one.
- [ ] **Both of the rail's dead ends are covered**, not just one: the question the form never asked, and the unmapped column. The source itself calls them the same shape.
- [ ] The dialog is unavailable once an application exists, and **says why** rather than failing - at that point the form is frozen for good and the way back is blocked.
- [ ] The dialog states that a form-intake market's public application page is unavailable while the chain runs. The exposure is bounded - the chain is only possible when nobody has applied - but it must be said, not discovered.
- [ ] If `E18/F03/S01` has landed, an amend re-dates the form's publication. That is correct, and the dialog says so: the amend is invisible in the workflow but not in the record.
- [ ] The dialog is built on the shell from `E20/F01/S01`.
- [ ] Verified end-to-end from both import phases, including the refusal path.

## Keep the voice

This importer's advisory has been recorded elsewhere in this project as the best writing in the product.
The dead end goes; the tone is the model for what the dialog says when it refuses.
