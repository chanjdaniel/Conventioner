---
id: E35/F03/S03
title: The placement history opens from a button
type: story
status: done
blocked_by: []
pr: [#112]
---

## What to build

The market's placement history (who changed which seat, to what, and when) leaves the bottom of the Result page, where nobody finds it below every table of every date.
It opens instead in a dialog, from a **Placement history** button in the results' action row beside Statistics and Download CSV.
The button is there whenever the Result page is, including before any run (a hand placement made before the first run is history too) and for a viewer who cannot change anything (reading the trail changes nothing).

Every entry that names a vendor names them by name **and** email, so two vendors who share a name can be told apart.
That is the product's own rule for naming a vendor (name primary, email secondary, never the name instead of the email): today the trail shows the name alone, because it uses the one-line form meant for surfaces with no room for two.
A vendor with no name still reads as their email alone, never as the email twice.
A swap names both vendors this way.

The trail is one component on two surfaces, so the vendor drawer's history (its History tab once `E35/F01/S01` lands) shows the email too, with no work of its own.

## Shape

- The dialog is the product's dialog shell with no confirm action: a read-only list with a close control, Escape and backdrop dismissal.
- A long trail scrolls inside the dialog; the page behind it does not move.
- The trail is read when the dialog opens, so it is current after a placement made a moment ago on the same page, with no reload.
- The email is drawn in the muted secondary style beside the name, not run into the sentence as plain text, so the line still reads as a sentence.

## As built

- `PlacementHistoryDialog.vue` is the trail in an `AppDialog` with no confirm, mounting `PlacementHistory` as it opens, so each opening reads the trail afresh.
- `ResultSummary` has the **Placement history** button in its action row after a run, and on its own row under "Nothing assigned yet" before one.
- `historyParts` (`utils/placementHistory.ts`) words an entry as parts, a vendor being a part of its own drawn as the name with the email beside it in the muted style; `historySummary` reads "Name (email)" from the same parts.
- The dialog joins the every-control-is-named walk on a published market, opened on its run's entry.

## Acceptance criteria

- [x] The Result page no longer draws the placement history below the tables.
- [x] A **Placement history** button sits in the results' action row, before and after a run, for an editor and for a viewer.
- [x] The button opens the history in a dialog; Escape, the backdrop and the close control each close it.
- [x] Placing a vendor by hand and then opening the dialog shows that placement, with no reload.
- [x] A placed, freed or swapped entry shows each vendor's name and email; a vendor with no name shows the email once.
- [x] The vendor drawer's history shows the email the same way.
- [x] The dialog joins the every-control-is-named walk, opened with entries in it.
- [x] An E2E spec places a vendor, opens the dialog from the button and finds the entry with the vendor's email in it.
