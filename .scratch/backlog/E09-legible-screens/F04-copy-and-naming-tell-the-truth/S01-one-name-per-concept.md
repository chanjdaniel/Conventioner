---
id: E09/F04/S01
title: One name per concept
type: story
status: in-progress
blocked_by: []
pr: []
---

## What to build

Sweep the naming inconsistencies found by walking.
`CONTEXT.md` is the arbiter; anything this settles that is not already in it goes in.

- **Table choice** is "A whole table to myself" on the form, "Full Table" on the payoff screen and check-in, and `full` in storage.
  Pick the applicant-facing wording and use it wherever an organizer reads a value back.
  The CSV importer has the same bug in reverse: it compares an imported value against the stored key, so `A whole table to myself` is reported as "did not match your market" and the only correct resolution offered is the identical string.
  Match on the label the applicant saw.
- **"Section Front Row"** prefixes the word "Section" to a section's own name on the payoff screen and the Tables view.
- **"Front Row1"** has no separator between section name and table index, everywhere a table is named.
- **Role badge casing** is "Owner" on Markets, "owner" on Organizations, "Owner" inside the Manage dialog.
- **"Sign out" / "Sign Out"** differ between the dashboard and the drawer.
- **"Markets" / "Manage markets"** differ between the dashboard tile and the drawer link for the same destination.
- **Em dashes appear throughout the UI** - "Vendors — Triage Check Fall 2025", "— Unassigned —", "Front Row1 (Full Table) — Front Row, Gold, Hall" - against this project's house style.
- **The Organizations drawer icon is a speech bubble.**
- **"View Attendance" uses a cog**, which means settings.
- **"Use OTP"** is jargon on a consumer sign-in screen.
- **The vendors table's Cost column** is an em-dash for every vendor because nothing sets a price.
  Say why in the column, rather than leaving it reading as broken; price per tier is out of scope.

## Acceptance criteria

- [ ] Each concept above has one name, used everywhere an organizer or applicant reads it.
- [ ] No em dash in any user-facing string.
- [ ] `CONTEXT.md` carries any term this settles that it did not already hold.
