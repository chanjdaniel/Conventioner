---
id: E20/F01/S01
title: A dialog shell, proved by the create-market dialog
type: story
status: done
blocked_by: []
pr: []
---

## What to build

A dialog shell that owns what every dialog in this product needs, and the create-market dialog rebuilt on it as the proof.

An organizer creating a market types a name into something that looks like a field, presses Enter to create it, and reads any error where the error belongs.

## The shell

It owns the scrim, the window, the close control, dismissal by Escape and by the backdrop, the existing "hold the page inert" behaviour, and - the part that is missing everywhere today - a **native form whose confirm button submits**.

That last piece is what makes the Enter contract automatic rather than remembered: submission runs the same handler as the button, so it inherits that handler's empty-and-invalid guard, and a disabled submit makes Enter inert with no extra code.

## The create-market dialog on it

It stays a modal and stays minimal - name and organization, nothing more - handing off to the draft page where everything else about a market is decided in order.
A modal rather than a section of that page, because a market must not exist until the organizer commits to one, or every abandoned attempt leaves an empty draft behind.

Three things it gets wrong today, all fixed here:

- **The name field renders as bare text.**
  The input is reset to nothing and the container around it declares a corner radius with no border and no background, under a comment stating the intent - "a field is a border" - that was never implemented. It reads as a suggested title rather than as something to type in.
- **Enter does nothing**, on the first screen of the product.
- **The error is positioned at a coordinate** measured against one arrangement of the dialog, rather than sitting in the layout.

## Acceptance criteria

- [x] A reusable dialog shell exists, owning the scrim, window, close control, Escape and backdrop dismissal, the inert behaviour, and a native form with a submit confirm.
- [x] The create-market dialog is rebuilt on it and asks for name and organization only.
- [x] The name input reaches for the shared control primitive and **does not reset its own styling**, which would defeat the primitive. It reads as an input before anyone clicks it.
- [x] Enter in the name field creates the market, through the same handler the button uses, so it inherits the same guard.
- [x] When the confirm button is disabled, Enter does nothing.
- [x] The error message sits in flow beneath the control it describes, not at an absolute coordinate.
- [x] With exactly one organization, the dialog **names** it rather than offering a choice that is not a choice.
- [x] The zero-organization fallback still works and its existing spec passes unchanged.
- [x] The page stays inert behind the dialog; the existing inert unit test and e2e spec pass.
- [x] `npm run format:check`, `npm run lint:css` and the type check pass.
