---
id: E34/F02/S01
title: An application can need a follow-up, with an owner
type: story
status: in-progress
blocked_by: []
pr: []
---

## What to build

Skip becomes **Needs follow-up**, a stored status (keyboard shortcut kept).
Marking one makes the reviewer its owner by default, can be reassigned to anyone with a role on the market, and opens the vendor's notes so the reviewer can say what is needed (optional).
A follow-up blocks Begin Assignment as an undecided application does, and the applicant sees "under review".
The one-by-one queue leaves follow-ups out by default and can include them; the bulk view (`F04`) filters for them, and for "Mine".
No email is sent to the owner.

## As built

- `needs_follow_up` is a stored status, marked through the verdict endpoint.
  `verdict_by` is who marked it and `follow_up_owner` (`MarketPerson`) who owns it: the marker, unless an `ownerEmail` with a role on the market is named (`markets.person_on_market`).
  Any other status clears the owner.
- `PUT /markets/:id/applications/:id/follow-up-owner` (EDITOR) hands it on.
- `AllApplicationsReviewedGuard` counts follow-ups apart: "1 application needs a follow-up".
  The applicant always sees "under review", published or not.
  The automatic rejections never judge a follow-up.
- In the review, S opens a dialog (`FollowUpDialog`) asking who follows up (the reviewer by default, from the market's people) and what is needed.
  The box opens on the vendor's note as it stands, and is saved to their notes only when changed, so nothing there is written over unseen.
- Follow-ups leave the queue unless "Include the N follow-ups" is ticked; a follow-up's card names its owner and hands it on.
  A plain Next (N) still moves past a card without recording anything.
- Both review views give verdicts and mark follow-ups through one composable, `utils/verdictActions.ts`.
- The signed-in address is read through one helper, `utils/signedIn.ts`, which Vendors and Attendance now use too.
- "Mine" is the bulk view's (`F04`).

## Acceptance criteria

- [x] Marking an application stores the status, the owner and who marked it.
- [x] The owner can be changed to another person with a role on the market.
- [x] Begin Assignment is refused while any follow-up remains, naming the count.
- [x] The applicant's view shows "under review".
- [x] The queue skips follow-ups unless asked to include them.
