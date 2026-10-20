---
id: E36/F03/S01
title: Add a vendor
type: story
status: ready
blocked_by: [E36/F02/S01, E36/F02/S02]
pr: []
---

## What to build

In assignment and market days, an editor can "Add a vendor": a name and an email, answers optional (decision 7).
It records an application marked as added by that organizer, which shows in the vendor drawer and the Vendors page like any other, saying who added it and when.
The added vendor is then seated by hand through the place dialog, with a warning for anything their missing answers leave unknown.
They are never an input to the run: their answers may be missing, and the run refuses every assignment over an approved application missing a required answer.
On a form market they can sign in on the market's page and see their application like any applicant; on a CSV market there is no applicant page, as today.
An address that already has an application in the market is refused, naming the existing one.

## Acceptance criteria

- [ ] "Add a vendor" is offered to an editor in assignment and market days only, and refused by the server in every other phase.
- [ ] The added application records who added it and when, and is shown so in the drawer.
- [ ] An added vendor can be placed through the dialog, and a run neither seats nor refuses over them.
- [ ] Adding an address that already applied is refused.
- [ ] On a form market the added vendor can sign in and sees their application.
- [ ] One E2E spec adds a vendor on market day, seats them, and checks them in at the door.
