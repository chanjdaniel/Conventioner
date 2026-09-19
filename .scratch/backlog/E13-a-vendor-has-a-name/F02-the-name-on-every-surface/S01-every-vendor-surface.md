---
id: E13/F02/S01
title: Every vendor surface shows the name
type: story
status: in-progress
blocked_by: []
pr: []
---

## What to build

One helper resolving a vendor's display identity, used by every surface that names one:

- **The vendor list** (`VendorsView`) - rows, and its search box, which currently reads
  "Filter by email..." and must match name and email and say so.
- **The vendor detail panel** header.
- **The Tables view** - the occupant of each table.
- **Assignment Results** - the "Unassigned Vendors" panel, currently bare email addresses.
- **Check-in** - the confirmation a vendor sees after looking themselves up.
- **The assignment CSV export.**

Fall back to the email where no name is stored, rendering as the product does today.

## Acceptance criteria

- [ ] Every surface above shows the name with the email secondary, from one helper.
- [ ] Vendor search matches both, and its placeholder says so.
- [ ] A vendor with no name renders as it does today, with no placeholder text.
- [ ] Two vendors sharing a name remain distinguishable on every surface.
- [ ] `E12/F02/S01`'s vendor date card uses the same helper for its heading.

## Notes

This closes the half of `E08/F02`'s "Still to do" that graduated to ticket 02.
The Cost column stays an em dash - price per tier is out of scope - and `E09/F04/S01` makes it say
why.
