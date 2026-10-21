---
layer: business
kind: intent
verified: 2026-10-22
sources:
  - E29
  - E26/F06
---

# The door on market day

On each day of the market, the organizer at the door sees every vendor expected that day, by name and table, who has arrived and who has not, and checks a vendor in themselves; a vendor looks up their own table by the address they applied with, and checks in.
The door reads the seats as they stand, so a vendor moved, freed or added that morning is sent where they were put.
Once the market is archived it is the record of what happened: nothing in it changes, a market that ran keeps its check-in page as a record marked ended, and no market in the middle of its life is deleted with its organization.

## Why

With a room full of vendors, a list of who has checked in cannot answer the question the door actually asks, which is who is missing.
The door is a laptop and sometimes a phone, run by volunteers the organizer gives a role, and every check-in made for a vendor records who made it.
A market's seats change on the day itself, so the door must follow the seats, not a copy of the run.
And after the market, its plan, verdicts, seats and check-ins are the only account of what happened, so they must not shift under anyone reading them, and its public check-in address must not vanish while it is still the record.

## Rules

- [Adding a vendor who never applied](../rules/adding-a-vendor-who-never-applied.md): a vendor arriving unannounced is added, then seated by hand.
- [A vendor is called by their chosen name](../rules/a-vendor-is-called-by-their-chosen-name.md): the door names each vendor as they chose, with their address.
- [Vendor notes](../rules/vendor-notes.md): what a vendor asked for beyond a table, shown at the door.
- [An archived market is read-only](../rules/an-archived-market-is-read-only.md): nobody changes a finished market's record.
- [An archived market that ran stays a record](../rules/an-archived-market-that-ran-stays-a-record.md): its check-in page stays up, marked ended, taking no check-in.
- [When an organization may be deleted](../rules/when-an-organization-may-be-deleted.md): refused while it holds a market mid-lifecycle, and recorded first.

## Flows

- [Publishing, and the door on market day](../flows/market-day-door.md): the vendor's check-in page and the organizer's Attendance.
- [The vendor drawer](../flows/vendor-drawer.md): one vendor's notes and seats, opened from Attendance.
- [Ending and managing a market](../flows/ending-and-managing-a-market.md): archiving, and what an archived market keeps.
