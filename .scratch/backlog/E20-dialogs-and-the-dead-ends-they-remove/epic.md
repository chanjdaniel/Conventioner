---
id: E20
title: Dialogs, and the dead ends they remove
type: epic
status: ready
blocked_by: []
pr: []
---

## Outcome

Every dialog in the product is the same thing: a form that does one small job, submits on Enter, and stays open until the organizer closes it.
Two dead ends that dialog can now remove are removed - an import that stops because the form asked the wrong question, and an organization deletion that silently orphans markets.

## Why now

Four of the fourth walk's findings were about dialogs, and they were the same problem four times: a name field that renders as bare text because it was stripped and never re-dressed, three membership actions that close the modal on success, and four dialogs where Enter does nothing while six others each solved it differently.

The import wizard has the worst dead end in the product attached to the best writing in it.
When the mapping reveals the form asked the wrong thing, the wizard prints four manual steps and two phase transitions, and the organizer loses their upload on the way.

Deleting an organization has exactly one precondition - that the caller owns it - and then sets every one of its markets to belong to no organization, which is a state the product refuses to create through any other door.

Charted in [the-order-of-the-work](../../wayfinding/the-order-of-the-work/map.md).
Read tickets [08](../../wayfinding/the-order-of-the-work/issues/08-what-a-dialog-is-in-this-product.md), [07](../../wayfinding/the-order-of-the-work/issues/07-editing-the-form-from-the-import-wizard.md), [06](../../wayfinding/the-order-of-the-work/issues/06-what-shape-is-the-import-flow.md) and [10](../../wayfinding/the-order-of-the-work/issues/10-when-may-an-organization-be-deleted.md) before taking any story.

## Order inside this epic

**`F01` comes first.** Both `F03` and `F04` build a dialog, and the idiom is what they build it from.
Slicing them before it means writing two dialogs twice.

## What is already settled, and must not be re-litigated

- **A dialog is a native form element with a submit button.**
  Six views already get Enter free that way, and it makes the two requirements automatic rather than remembered: submission runs the same handler as the button so it inherits that handler's guard, and a disabled submit makes Enter inert with no extra code.
- **Closing never means saved, and saving never closes.**
  Three closes stay correct: deleting the thing, the explicit close button, and the Escape or background dismiss.
- **The create-market dialog stays a modal and stays minimal** - name and organization only, handing off to the draft page where everything else is decided in order.
  A modal rather than a first section of that page, because a market must not exist until the organizer commits to one, or every abandoned attempt leaves an empty draft behind.
- **The import flow stays a full-width page.**
  Making it a modal would reverse a decision the source records as the winner of a three-variant prototype.
  The white space was never a disagreement with that: the view simply never joined the project's sizing model.
- **The import wizard runs in two phases, not one**, and the phase before review has no edge back to draft - that restriction stands and no new edge is added.
- **Organization deletion is refused while a mid-lifecycle market exists, and orphaning stops existing.**
  The update that sets a market to belong to no organization is deleted outright, not kept as a fallback: a fallback would preserve the exact state this removes.

## The risk this epic carries, recorded rather than argued

A market that has been archived is **still publicly served** and holds the placement record of a market that actually ran.
`F04` deletes archived markets along with their organization, which takes a live check-in URL off the air and destroys that record, with no undo.

This was raised during charting and the decision was reaffirmed on 2026-09-22.
It is written here so it reads as a choice and not an oversight.
Two things follow that `F04` owes to it: the confirmation names what it destroys **per market** - the name, the phase, whether it ran, how many placements it holds, and the public URL that will stop resolving - and the deletion leaves a trail, because nothing records it today.

## Features

Sliced 2026-09-22 with `/to-tickets`.
Six stories.

- **[`F01` - The dialog idiom](F01-the-dialog-idiom/feature.md)** - the shell and its exemplar, the dialog that stops closing on you, and the rest adopting both. Three stories.
- **[`F02` - The import page sizes itself](F02-the-import-page-sizes-itself/feature.md)** - one story, independent of everything else here.
- **[`F03` - Fixing the form without leaving the import](F03-fixing-the-form-without-leaving-the-import/feature.md)** - one story, the largest in the epic.
- **[`F04` - Deleting an organization is safe](F04-deleting-an-organization-is-safe/feature.md)** - one story.

## The frontier, and the shape of the work

**Two stories are startable now:** `F01/S01` (the shell) and `F02/S01` (the import page's width).

**`F01/S01` is both the prefactor and a real slice.**
There is partial shared scaffolding today - the page is held inert behind a modal through a shared helper - but no shared dialog component: each of the five overlays hand-rolls its own scrim, window and close control, and **not one of them contains a form element**.
Extracting the shell and proving it on the create-market dialog delivers that dialog's three defects in the same pass, so it is not a no-op story.

**Everything else in this epic builds a dialog**, which is why `F01/S01` gates four of the six.

```
F01/S01 ──┬──> F01/S02   manage organization stays open
(shell +  ├──> F01/S03   the rest adopt the idiom
 exemplar)├──> F03/S01   fixing the form from the import
          └──> F04/S01   deleting an organization is safe

F02/S01   the import page sizes itself   (independent)
```

**Two stories require a screenshot in the PR**, for the same reason.
`F01/S03` and `F04/S01` each touch a dialog carrying an irreversible action, and the archive confirmation has been invisible before - a colour token referenced in seven rules and defined nowhere rendered its button as white text on a white dialog.
A sweep that does not open the dialog does not see it.

## Relationship to E18

`F02/S01` corrects a stale comment claiming the import wizard runs in one phase; it runs in two, and `F03/S01` depends on that being understood.
Neither epic gates the other.
