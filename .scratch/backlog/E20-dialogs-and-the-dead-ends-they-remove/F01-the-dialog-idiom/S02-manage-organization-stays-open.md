---
id: E20/F01/S02
title: Manage organization stays open
type: story
status: ready
blocked_by: [E20/F01/S01]
pr: []
---

## What to build

An organizer adds two members to an organization without the dialog vanishing between them.

Adding an admin, adding a member and removing a user each succeed, the dialog refreshes to show the new membership, and it stays open until the organizer closes it.

## Why it closes today, and why that is not a one-line fix

Each of the three actions emits the close event on success, and **the parent treats close as its refresh signal**: closing clears the selection and reloads the organization list.
So closing the dialog is currently the only thing that re-reads the data.

Keeping it open therefore needs two separate things - the dialog refreshing its own view of the organization, and the parent list still learning about the change through an event of its own.

**There is a model in the same file.** Renaming already does this correctly: it updates the dialog's own state on success and does not close.

## Acceptance criteria

- [ ] Adding an admin, adding a member and removing a user all leave the dialog open, showing the updated membership.
- [ ] The organization list behind the dialog still reflects the change, through an event distinct from close.
- [ ] Adding two people in succession requires no reopening.
- [ ] **Three closes stay correct and are verified**: deleting the organization, the explicit close control, and dismissal by Escape or backdrop.
- [ ] The dialog is rebuilt on the shell from `S01`, so its three inputs gain the Enter contract - each submitting through the same handler its button uses.
- [ ] The existing organization page object and specs are updated: they assume the dialog closes after add and remove, and that expectation moves with the behaviour.
- [ ] An add that fails shows its error in flow and still leaves the dialog open with the typed value intact.
