---
layer: implementation
kind: module
describes:
  - back-end/vendor_notes.py
  - back-end/app.py#get_vendor_notes
  - back-end/app.py#save_vendor_note
  - back-end/app.py#mark_vendor_request_handled
  - front-end/src/utils/vendorNotes.ts
  - front-end/src/components/VendorNotes.vue
verified: 2026-10-29
sources:
  - wayfinding/what-to-show-and-when/03
  - E31/F04
  - E31/F04/S03
---

# Vendor notes

[`back-end/vendor_notes.py`](../../../back-end/vendor_notes.py) is the single owner of the `vendor_notes` collection: the organizer's side of [vendor notes](../../business/rules/vendor-notes.md).
One document per vendor per market holds the organizer's note (`note`, `note_edited_by`, `note_edited_at`), the "From your sheet" line (`from_sheet`), and the mark that the vendor's request was handled (`request_handled_at`, `request_handled_by`).
The vendor's request itself is not here: it is their answer on the application, `essential_request` ([essential fields](essential-fields.md)).

## Its interface

| Function | What it does |
| --- | --- |
| `write_note(market_id, vendor_email, text, by)` | replaces the organizer's note, stamping who and when, and returns the note as it was and as it is |
| `mark_request_handled(market_id, vendor_email, handled, by)` | sets the mark, or clears it, and returns whether it was set |
| `replace_sheet_notes(market_id, by_vendor)` | the import's write: every vendor's "From your sheet" line replaced, and a vendor the file no longer has a line for loses theirs |
| `notes_for_market(market_id)` | every vendor's entry on one market, by lowercased address, camelCased for the wire |
| `delete_for_market(market_id)` | the market's notes, taken with the market ([market deletion](market-deletion.md)) |

Three routes in [`back-end/app.py`](../../../back-end/app.py) serve it: `GET /markets/:id/vendor-notes` (VIEWER), `PUT /markets/:id/vendor-notes/:email` with `{note}` and `PUT .../request-handled` with `{handled}` (both EDITOR, through the change loader, so an archived market refuses them).
The read joins each vendor's request in from their application, so the screens get both kinds by address, each under its own key.

On the front end, [`front-end/src/utils/vendorNotes.ts`](../../../front-end/src/utils/vendorNotes.ts) reads a market's notes once per page and re-reads after every write, never patching, as every market write does; [`front-end/src/components/VendorNotes.vue`](../../../front-end/src/components/VendorNotes.vue) is the one disclosure every page draws, its summary marked when anything is inside.

## Sharp edges

**The vendor never sees any of it, so it is a collection of its own.**
Applicant endpoints return the application, and a field on it would leak by being forgotten in a strip; a collection no applicant endpoint reads cannot (`test_no_applicant_endpoint_reads_the_notes`).

**Stored as `applications` and `attendance` are**: snake_case, the market's `market_id`, and the vendor's address lowercased, keyed by the two together ([lookup indexes](../data/lookup-indexes.md)); every reader and writer goes through this module.

**The import's line never touches the note.**
`csv_import.py` maps an organizer's own column to the `sheet_note` target, "From your sheet (your own notes)", and after the rows are written calls `replace_sheet_notes` with each imported vendor's latest line ([the CSV import](csv-import.md)).

**A page that cannot read the notes still does its job.**
Notes are beside a page's work, never its subject, so a failed read shows the page without them.

`back-end/tests/test_vendor_notes.py` pins the writes, the roles, the archive and the deletion; `front-end/e2e/vendor-notes.spec.ts` walks a request and a note from Vendors to the door, where it is handled.

**A note that changes, and a handled mark that changes, record into [the market's history](../data/history.md)** (`note`, `request_handled`) with the value each replaced, which `write_note` and `mark_request_handled` return; an import's sheet lines record nothing of their own, as part of the import's one entry.

## Why

- [Vendor notes](../../business/rules/vendor-notes.md): two kinds kept apart, the organizer's never shown to the vendor.

The glossary concept it serves: [Application](../../business/concepts/application.md).
