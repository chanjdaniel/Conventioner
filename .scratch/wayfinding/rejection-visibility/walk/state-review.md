# Market states: what is mutable, settled, or not yet available

Read from `origin/dev` at c34652ba (2026-10-20) with `git show`; nothing was run.
Daniel asked for this before settling when Publish Results becomes available (Round 1, Q2).
Legend: M = can change, L = settled and locked, - = not available yet, R = read-only record.
A `!` marks where today's behaviour conflicts with a Round 1 decision or with Daniel's stated position.
`offers` is left out: it is off the rail and nothing sets the statuses its entry guard waits on (back-end/guards.py:371-403).

## Form path (vendors apply on the market's page)

```
                draft open clos revw ASGN days arch
Setup / plan      M    L    L    L    L    L    L
App form          M    L    L    L    L    L    L
Apply / edit ans  -    M    L    L    L    L    L
Verdicts, f/up    -    M    M    M    M!   L    L
Reject rules      M    M    M    M    L    L    L
Assign rules      M    M    M    M    M    L    L
Assign run        -    -    -    -    M    L    L
Hand place / pin  M!   M!   M!   M!   M!   M!   L
Publish Results   -    M!   M!   M!   M!   M!   L
Applicant status  -    !    !    !    !    !    !
Check-in          -    -    -    -    -    M    R
Move back to      -  draft open clos none none none
```

## CSV path (organizer imports a Google Form's responses)

```
                draft open clos revw ASGN days arch
Setup / plan      M    L    L    L    L    L    L
Questions (form)  M    L    L    L    L    L    L
Import responses  -    M    M    L    L    L    L
Verdicts, f/up    -    M    M    M    M!   L    L
Reject rules      M    M    M    M    L    L    L
Assign rules      M    M    M    M    M    L    L
Assign run        -    -    -    -    M    L    L
Hand place / pin  M!   M!   M!   M!   M!   M!   L
Publish Results   n/a on every phase (no applicant surface)
Check-in          -    -    -    -    -    M    R
Move back to      -  draft  -  open none none none
```

On the CSV path `applications_closed` is stepped through, never stopped in (back-end/guards.py:489-492), and "Begin Review" is one move from `applications_open` to `review`.

## Evidence, row by row

Setup / plan: editable in draft only; after that `setup_lock_reason` refuses, and the way back to draft is open only while no application exists (back-end/api/markets.py:352-362, back-end/api/markets.py:386-405).
Application form: editable in draft only and only while no application exists (D9); after leaving draft it is fixed (back-end/api/markets.py:256-292).
A form market's form can be amended from `applications_open` or `applications_closed` by an ADMIN chain that walks to draft and back, but `applications_open -> draft` still needs zero applications (back-end/api/form_amendment.py:41-44, back-end/guards.py:247-284).
Apply / edit answers (form): a save, new or edited, is refused outside `applications_open` (back-end/api/applicants.py:324-330); "Change your answers" is drawn only while the form is open (front-end/src/views/ApplicantDashboard.vue:201).
Import (CSV): allowed in `applications_open` and `applications_closed` only, refused on a form market (back-end/csv_import.py:59, back-end/csv_import.py:62-91).
Verdicts and follow-up: EDITOR, open while the market can still reach `assignment`, so through `assignment` itself, settled from `market_days` on (back-end/api/markets.py:215-237, back-end/app.py:1744-1760); "needs follow-up" is a markable status (back-end/api/applications.py:295-296).
Entering `assignment` requires every application approved or rejected, none open or in follow-up (back-end/guards.py:320-369, back-end/guards.py:671, back-end/guards.py:701).
Automatic rejection rules: open while the market can still reach `review`, so settled on entering `assignment` (back-end/api/markets.py:318-336).
They judge an online application in the same request that saves it (back-end/api/applicants.py:360-363) and every import (back-end/csv_import.py:1659-1674); a rule's rejection reverts to undecided when no rule meets it, unless results are published (back-end/rejection_rules.py:158-186).
Assignment rules (priority, ceiling, half-table share): open while the market can still reach `assignment`, so editable in `assignment` after a run (back-end/api/markets.py:301-315).
A change after a run is reported as `assignmentOutOfDate` and blocks nothing (back-end/api/markets.py:765, back-end/guards.py:675).
Assignment run: `assignment` phase only (back-end/api/placements.py:187-224, back-end/api/placements.py:234-236).
Hand placement, free and swap: EDITOR in every phase but archived, through `_load_market_to_change` (back-end/api/placements.py:294, back-end/api/placements.py:341, back-end/api/placements.py:381).
The write checks only the date, the seat and a collision, and takes any email, even one with no application (back-end/api/placements.py:109-145, back-end/api/placements.py:283-325).
The place dialog offers only approved applicants, grouped "fits" and "overrides", with warnings that never block (back-end/api/markets.py:1329, back-end/api/markets.py:1357-1370, front-end/src/utils/placementChange.ts:143-175).
On read, `overriddenPlacements` reports tier, date and table-choice overrides for approved vendors only (back-end/placement_reasons.py:193-276, back-end/api/markets.py:1199-1209).
A pin for a vendor the solver does not have is kept as an orphan on every re-run (back-end/assignment/assignment.py:279-288, back-end/assignment/assignment.py:1016-1023), but `NoOrphanedPinGuard` judges only the seat, so it does not block going live (back-end/placement_reasons.py:279-310, back-end/guards.py:589-630).
Publish Results: ADMIN, form market only, any phase but draft and archived, once at least one verdict exists, and it can never be undone (back-end/app.py:2083-2104, back-end/api/applicants.py:544-584, front-end/src/components/application/ApplicationMonitor.vue:94-96).
Applicant status: the surface answers in every phase but draft (back-end/market_documents.py:315); before publishing, undecided reads "Submitted" and decided reads "Under Review"; after, the verdict (back-end/api/applicants.py:65-93, front-end/src/views/ApplicantDashboard.vue:28-39); no seat is ever shown on that page.
Check-in: the public page and the organizer's door serve `market_days` only (back-end/market_documents.py:300, back-end/api/door.py:15-21); an archived market that ran serves a read-only record (back-end/api/attendance.py:33-53).
Moves back: `applications_open -> draft` (needs zero applications), `applications_closed -> applications_open`, `review -> applications_closed`; nothing leaves `assignment` or `market_days` backwards; every phase but archived can be archived (back-end/guards.py:433-459, back-end/guards.py:247-284).
Going live (`assignment -> market_days`) requires only a stored assignment and no orphaned seat (back-end/guards.py:285-317, back-end/guards.py:675, back-end/guards.py:703).

## Conflicts with Daniel's decisions

1. Verdicts and follow-up are open in `assignment` (back-end/api/markets.py:235); Q1(a) locks them on entering it, and today there is no move from `assignment` back to `review`, so a wrong verdict could no longer be fixed as a verdict.
2. Publish Results is available from `applications_open` on, from the first verdict (front-end/src/components/application/ApplicationMonitor.vue:96, back-end/api/applicants.py:572-574); Daniel's position is that it waits until every application is reviewed and the allocation is done.
3. Before publishing, "Under Review" versus "Submitted" gives an automatic rejection away (back-end/api/applicants.py:88-93); Q3 says one "Submitted" for everything.
4. Placing someone who is not approved is possible through the API with no warning, impossible through the dialog, and a pin for them is silently orphaned by the next run; Q4 says an editor may do it by hand, deliberately, with a warning.
5. `vendor_refused` reads "Not Accepted" like a rejection (front-end/src/views/ApplicantDashboard.vue:37); Q5 gives it its own words.
6. Assignment rules stay editable after a run and a market can go live on an out-of-date run (back-end/api/markets.py:301-315, back-end/guards.py:675); Daniel's "allocations are done" suggests the run should be current before results go out.
7. A market can go live, check-in on the air, without results ever published, since the two are unrelated (back-end/guards.py:703, back-end/api/applicants.py:544-584).
