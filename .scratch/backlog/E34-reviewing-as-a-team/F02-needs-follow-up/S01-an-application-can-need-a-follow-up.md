---
id: E34/F02/S01
title: An application can need a follow-up, with an owner
type: story
status: ready
blocked_by: []
pr: []
---

## What to build

Skip becomes **Needs follow-up**, a stored status (keyboard shortcut kept).
Marking one makes the reviewer its owner by default, can be reassigned to anyone with a role on the market, and opens the vendor's notes so the reviewer can say what is needed (optional).
A follow-up blocks Begin Assignment as an undecided application does, and the applicant sees "under review".
The one-by-one queue leaves follow-ups out by default and can include them; the bulk view (`F04`) filters for them, and for "Mine".
No email is sent to the owner.

## Acceptance criteria

- [ ] Marking an application stores the status, the owner and who marked it.
- [ ] The owner can be changed to another person with a role on the market.
- [ ] Begin Assignment is refused while any follow-up remains, naming the count.
- [ ] The applicant's view shows "under review".
- [ ] The queue skips follow-ups unless asked to include them.
