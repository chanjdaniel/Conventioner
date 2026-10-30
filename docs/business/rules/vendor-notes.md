---
layer: business
kind: rule
describes:
  - back-end/essential_fields.py#REQUEST_KEY
  - back-end/api/markets.py#get_vendor_notes
  - back-end/api/markets.py#save_vendor_note
  - back-end/api/markets.py#mark_vendor_request_handled
verified: 2026-10-29
sources:
  - wayfinding/what-to-show-and-when/03
  - wayfinding/what-to-show-and-when/map
  - E31/F04
---

# Vendor notes

What a vendor needs beyond their table, and what the organizer knows and did about a vendor, are two kinds of note kept apart: the vendor's own request, and the organizer's note.
Neither is one field with two authors, and the vendor never sees the organizer's.

**Serves:** [Reviewing applications as a team](../intents/reviewing-applications-as-a-team.md) and [The door on market day](../intents/the-door-on-market-day.md).

## The two kinds

- **The vendor's request** is a built-in question on the application, "Anything else you need from us?" (`REQUEST_KEY` in [`back-end/essential_fields.py`](../../../back-end/essential_fields.py)).
  It is asked by default, never required, and the organizer can switch it off as they can the other essential questions the plan asks ([the form tab](../flows/form-tab.md)).
  On the Google Form path it is an import target, so a Google Form's own "anything else" column maps onto it.
  It is the vendor's answer: they see it, the organizer reads it and never edits it.
- **The organizer's note** is one editable text per vendor, shared by everyone who works on the market, carrying who last edited it and when.
  Writing again replaces it; a blank note is no note.
- **A sheet's own column**, the notes an organizer kept beside the responses in their spreadsheet, can be mapped on import to a third, read-only line, "From your sheet".
  Each import replaces every vendor's line, a vendor the file no longer has a line for loses theirs, and it never touches the note written in the product.
  It is never a verdict: a review decided in the sheet does not come in as approvals.
- **A request can be marked handled**, so the door can tell "needs a chair" from "already got one" without reading every note; the mark can be taken back, since a wrong tick at a busy door must be undoable.

## Where they show

The review card, the vendor drawer (opened from Vendors, Assignments, Attendance and the review's All view) and the door's roster show both kinds, each under its own label: "Request" (or "Request handled"), "Your note" and "From your sheet".
A compact marker says when anything is there, and the roster draws the notes only under a vendor who has some, with the request as outstanding or handled.
The organizer's note is written wherever it is shown ([reviewing applications](../flows/review.md), [the vendor drawer](../flows/vendor-drawer.md), [the door on market day](../flows/market-day-door.md)).

## Why

"Extra chair arranged" is one current fact, so the organizer's side is one text and not a dated log, which would make the reader hunt for the latest line.
The two kinds are kept apart because their authors and readers differ: the vendor writes and reads their request; only the market's people read the note.
The sheet's line is its own, so a re-import neither clobbers the note written in the product nor ignores what the sheet says.

## Who may

Every role on the market reads both kinds; an EDITOR and up writes the note and marks a request handled, the bar every market write has, which a door volunteer with EDITOR meets ([what each role may do](what-each-role-may-do.md)).
An archived market refuses both writes ([an archived market is read-only](an-archived-market-is-read-only.md)).
The vendor, who has no role, never reads the organizer's side.

## Where it is kept

- [Vendor notes](../../implementation/modules/vendor-notes.md) is the module: the `vendor_notes` collection that holds the organizer's side, and why it is a collection of its own.
- The three endpoints are `get_vendor_notes`, `save_vendor_note` and `mark_vendor_request_handled` in [`back-end/api/markets.py`](../../../back-end/api/markets.py); the read joins each vendor's request in from their application, so every page reads both kinds from one place.
- Each change of an organizer's note or of a handled mark is recorded in [the market's history](../../implementation/data/history.md) (`note`, `request_handled`); the history is read only by the market's readers, so a vendor never reads a note there either.
