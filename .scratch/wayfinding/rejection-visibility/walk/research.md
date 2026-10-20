# Rejection visibility in Conventioner

Research only; nothing in the repository was changed or run beyond reads.
Branch read: `feat/the-vendor-one-click-away` with its uncommitted changes (E35/F02/S01 search terms).
"Verified" means I read the code path end to end; "Inferred" means I reasoned it from code I read but did not run it.

## 1. The model in one paragraph

A rejection is the stored status `reviewer_rejected` on an application, with `verdict_by` (a person or a rule), `verdict_at`, and for a rule a `verdict_reason` (back-end/datatypes.py:555-568, back-end/datatypes.py:656-666, back-end/datatypes.py:695-698).
It is written only by `update_application_status`, which refuses a verdict with no giver (back-end/api/applications.py:285-333).
People give it through the review endpoints (back-end/app.py:1776-1838); rules give it through `rejection_rules.judge` (back-end/rejection_rules.py:158-186).
The applicant sees it only through `_application_response`, which passes the status through `applicant_visible_status` (back-end/api/applicants.py:71-109).
The organizer sees the raw status, the giver and the reason through `_application_response_organizer` (back-end/api/applicants.py:112-133).

## 2. Applicant side

### 2.1 Which markets have an applicant surface at all (verified)

Every applicant endpoint goes through `applicant_intake_market_by_slug` (back-end/market_documents.py:432-469).
It serves a market only if its phase is in `APPLICANT_SURFACE_PHASES`, which is every phase except draft (back-end/market_documents.py:315), and only if its intake mode is `form` (back-end/market_documents.py:416-429, back-end/market_documents.py:467-468).
So a vendor of a form market can read their application in every phase from `applications_open` through `archived` (the bug 20 fix, .scratch/backlog/E26-the-user-flows-hold/F07-vendors-apply-online/S02-vendors-see-their-application-after-close.md).
A vendor of a CSV market has no surface at all; their market answers as if it did not exist.

### 2.2 When the verdict becomes visible (verified)

`applicant_visible_status` collapses `under_review`, `reviewer_approved` and `reviewer_rejected` to `under_review` until the market's `resultsPublished` flag is true (back-end/api/applicants.py:64-68, back-end/api/applicants.py:90-91).
`needs_follow_up` is always shown as `under_review`, published or not (back-end/api/applicants.py:88-89).
Every other status, `open` included, passes through unchanged (back-end/api/applicants.py:92).
The flag is set by `publish_results`, ADMIN only (back-end/app.py:2083-2104), refused on a CSV market, on a draft, and when already published (back-end/api/applicants.py:544-584).
Nothing ever clears the flag: the only writer is back-end/api/applicants.py:580-583, and the only other readers are back-end/rejection_rules.py:84 and back-end/rejection_rules.py:173.
So publication is a one-way, market-wide switch, not a per-verdict release.

### 2.3 What the applicant sees (verified)

The applicant payload carries id, market id, email, answers, the gated status, type, and timestamps, and never `verdictBy`, `verdictAt` or `verdictReason` (back-end/api/applicants.py:95-109).
The dashboard maps the status to a label: `open` reads "Submitted", `under_review` reads "Under Review", `reviewer_approved` reads "Approved", `reviewer_rejected` reads "Not Accepted" (front-end/src/views/ApplicantDashboard.vue:28-39).
A rejection is drawn in the rejected tint (front-end/src/views/ApplicantDashboard.vue:41-50, front-end/src/views/ApplicantDashboard.vue:149-160).
No reason, no wording beyond the two-word label, and no next step are shown.
"Change your answers" stays offered while the market is open, whatever the status (front-end/src/views/ApplicantDashboard.vue:200-207).

### 2.4 Automatic versus manual rejections (verified)

A rule's rejection is stored exactly like a person's, with `verdict_by.kind = "rule"` and the reason (back-end/rejection_rules.py:181-185).
After publication the applicant cannot tell the two apart, and the reason is never in their response; this matches the decision "The reason is shown to the organizer, never to the applicant" (.scratch/backlog/E33-the-form-tab-in-steps/F03-automatic-rejections/S02-the-rules-reject-with-a-reason.md).
It is pinned by back-end/tests/test_the_rules_reject.py:208-229, which asserts the stored status is rejected, the body says `under_review`, and the answer text is absent.

### 2.5 Email or other notification (verified)

There is none.
The mailer sends verification, password reset, organizer OTP and applicant sign-in codes only (back-end/utils/email.py:136, back-end/utils/email.py:224, back-end/utils/email.py:312, back-end/api/applicant_auth.py:160).
Publishing writes the flag and nothing else (back-end/api/applicants.py:580-584).
The hint beside the button says it "Tells every decided applicant their verdict on their application page" (front-end/src/components/application/ApplicationMonitor.vue:494), which is accurate: a vendor learns only by signing in.
Outcome emails are ruled out of scope on several maps (.scratch/wayfinding/v0-1-0/map.md:75, .scratch/wayfinding/real-market-readiness/map.md:96).

## 3. Organizer side

### 3.1 Who sees rejections (verified)

`GET /markets/:id/applications` needs only VIEWER and returns every application with its raw status, giver, time and reason (back-end/app.py:1718-1741, back-end/api/applicants.py:372-397).
Per CLAUDE.md, organization membership gives Viewer on its markets, so every member of the organization can see every rejection, who gave it and the rule's reason.
Role changes what you can do, not what you can see: verdict controls are drawn only while `verdictLockReason` is null (front-end/src/components/application/ApplicationMonitor.vue:186, front-end/src/components/application/ApplicationsAll.vue:149), the server gate being EDITOR on a market that can still reach `assignment` (back-end/api/markets.py:221-237, back-end/app.py:1744-1760).
Publish Results is drawn only for ADMIN on a form market (front-end/src/components/application/ApplicationMonitor.vue:93, front-end/src/components/application/ApplicationMonitor.vue:188, front-end/src/components/application/ApplicationMonitor.vue:471).

### 3.2 Where they show (verified)

One by one: the queue walks only `open`, `under_review` and, if asked, `needs_follow_up` (front-end/src/utils/reviewQueue.ts:84, front-end/src/utils/reviewQueue.ts:96-99), so a rejection, a rule's included, never comes up on a card.
It appears in the "reviewed" list with its chip, giver line and "Approve instead" (front-end/src/components/application/ApplicationMonitor.vue:77-82, front-end/src/components/application/ApplicationMonitor.vue:811-814), and in the tally "N approved, N rejected" (front-end/src/components/application/ApplicationMonitor.vue:104-111, front-end/src/components/application/ApplicationMonitor.vue:536-540).
All view: filters are Any status, To review, Needs follow-up, Approved, Rejected (front-end/src/utils/reviewQueue.ts:117-123); "Rejected" holds manual and automatic rejections alike, and no filter separates them (front-end/src/utils/reviewQueue.ts:136-148).
Rows and the open drawer show the chip and the giver line (front-end/src/components/application/ApplicationsAll.vue:380-386, front-end/src/components/application/ApplicationsAll.vue:411-413).
The giver line reads "Rejected by alex@market.test, Oct 19, 2026 at 5:04 PM" or "Rejected automatically: Answered “...” to “...”" (front-end/src/utils/verdicts.ts:58-74).
The organizer's word is "Rejected" (front-end/src/utils/verdicts.ts:9).
Vendor drawer (Vendors, Result, Attendance): it shows only the giver line, no status chip (front-end/src/components/VendorDrawer.vue:161-163, front-end/src/utils/vendorDetails.ts:216).
The drawer loads every application, decided or not (front-end/src/utils/vendorDetails.ts:100-107).

### 3.3 Who gave it (verified)

Stored beside the status in one update (back-end/api/applications.py:305-317), served as `verdictBy`/`verdictAt`/`verdictReason` to the organizer only (back-end/api/applicants.py:126-129).
A concurrent change is refused with a sentence naming who did what, including "An automatic rejection rejected this application since you opened it" (back-end/api/applicants.py:439-451).
Applications decided before E34 have no giver and show no line (front-end/src/utils/verdicts.ts:61-62, front-end/src/utils/verdicts.ts:71).

## 4. Downstream: does a rejected vendor leak anywhere?

The solver reads `reviewer_approved` main applications only (back-end/assignment/vendor_input.py:179-201), so a run never seats a rejected applicant (verified).
The Vendors list narrows to the run's vendors (front-end/src/views/VendorsView.vue:52-61), the fix for bug 10 (verified).
Table-share pairing treats a rejected applicant as not taking part (back-end/api/applicants.py:409-414) (verified).
The assignment CSV, the tables grid, the attendance roster and check-in all read the STORED `assignmentObject.vendorAssignments`, with no status check: back-end/api/markets.py:1283-1293, back-end/api/markets.py:586, back-end/api/attendance.py:175-215, back-end/api/attendance.py:134-151 (verified).
They are safe exactly as long as the stored assignment holds only approved vendors; section 6.1 shows two ways it does not.
`vendorNames` and the new `vendorSearch` are built from every application, rejected ones included (back-end/api/applications.py:179-198, back-end/api/applications.py:216-236, back-end/api/markets.py:1344-1351); they go only to VIEWER+ organizers and are keyed by address, so this is not an exposure, only unused payload (verified).

## 5. CSV-intake versus form-intake

A CSV market has no applicant surface (back-end/market_documents.py:467-468), refuses Publish Results (back-end/api/applicants.py:564-570), and hides the button (front-end/src/components/application/ApplicationMonitor.vue:93) (verified).
Its rejections exist only for the organizer; telling the vendor is entirely outside the product.
Rules judge every import (back-end/csv_import.py:1659-1674); on a CSV market `resultsPublished` is always false, so a rule's rejection always returns to undecided when its rule stops matching (back-end/rejection_rules.py:172-175) (verified).
A re-import with changed answers sends an APPROVED application back to review but leaves a MANUALLY REJECTED one rejected (back-end/csv_import.py:1415-1433, back-end/csv_import.py:1638-1642) (verified).
An online applicant's edit changes no status at all, approved or rejected (back-end/application_write.py:140-141), so the two intake paths treat "answers changed after a verdict" differently (verified).
New imported rows are created `open` (back-end/csv_import.py:1617-1623), and the proposal leaves a sheet's own "Status" column out, so decisions already made in the sheet cannot be brought in (.scratch/wayfinding/november-2026-dry-run/issues/05-whose-verdicts.md, recorded there as a finding, not verified further in code).

## 6. Gaps, inconsistencies and likely bugs, ranked

### 6.1 A rejected vendor can stay seated, published, and checked in (likely bug, high)

Verified pieces: verdicts stay open in the `assignment` phase (back-end/api/markets.py:235, back-end/guards.py:474, pinned by back-end/tests/test_a_verdict_says_who.py:142-148).
Verified: publishing (`assignment -> market_days`) requires only a non-empty stored assignment and no orphaned seat (back-end/guards.py:285-317, back-end/guards.py:672, back-end/guards.py:698).
Verified: a rejection after a run only raises an advisory line, "The approved applications changed since this assignment ran" (front-end/src/utils/assignmentOutOfDate.ts:19-34), which blocks nothing.
Inferred consequence: approve, assign, reject the vendor, publish; the rejected vendor keeps their seat on the grid, in the CSV, on the attendance roster, and can check in at the door, while their own page says "Not Accepted" if results are published.
Second route, verified pieces: `write_placement` accepts any email without checking it belongs to an approved application (back-end/api/placements.py:283-325, back-end/api/placements.py:109-145).
Verified: a pin whose vendor is not among the approved is kept as an orphan and stays in the stored rows on every re-run (back-end/assignment/assignment.py:276-288, back-end/assignment/assignment.py:1016-1023).
Verified: `NoOrphanedPinGuard` judges only the seat, deliberately not the vendor (back-end/placement_reasons.py:278-310, docstring at back-end/placement_reasons.py:289-291).
So a pin on a rejected vendor, or a pin made before rejecting them, survives Assign and publishing.
The Vendors list hides that vendor (front-end/src/views/VendorsView.vue:60) while Result and Attendance show them, so the pages disagree about who is in the market.
Not covered by any test I found; a reproduction would be an E2E that rejects a placed or pinned vendor in `assignment` and then publishes.

### 6.2 "Submitted" versus "Under Review" leaks an automatic rejection before publication (bug, high)

Verified: nothing ever stores `under_review` (it appears only in reads; back-end/api/applications.py:279, back-end/guards.py:334, back-end/api/applicants.py:65-91).
So before publication an undecided application reads "Submitted" and every touched one, approved, rejected or followed up, reads "Under Review" (back-end/api/applicants.py:88-92, front-end/src/views/ApplicantDashboard.vue:29-32).
Verified: a rule judges an online application in the same request that saves it, and the response is built from the re-read (back-end/api/applicants.py:359-366); the form then lands on the dashboard (front-end/src/views/ApplicationPage.vue:104-115).
So a vendor who submits and immediately reads "Under Review" instead of "Submitted" has been rejected automatically, since no person could have acted in between.
While applications are open they can "Change your answers" (front-end/src/views/ApplicantDashboard.vue:200-207), be re-judged on save, and watch the label flip back to "Submitted" (back-end/rejection_rules.py:172-175), which turns the dashboard into an oracle for the market's disqualifying answers.
The test back-end/tests/test_the_rules_reject.py:208-229 asserts the body says `under_review` and calls that "told only that it is under review"; it does not compare with the `open` a passing applicant gets (back-end/tests/test_applicant_publication_gate.py:107).
This contradicts the module's own promise that the applicant "cannot distinguish a provisional acceptance from a provisional rejection" (back-end/api/applicants.py:80-82): manual verdicts are indistinguishable, but "decided" is distinguishable from "undecided", and at submission time that means "rejected".
Fix direction (inferred): collapse `open` too, so every pre-publication status reads the same.

### 6.3 Publishing mid-collection makes every later verdict instant and unreviewable (gap, medium-high)

Verified: Publish Results is offered from the first verdict in any non-draft phase (front-end/src/components/application/ApplicationMonitor.vue:96, front-end/src/components/application/ApplicationMonitor.vue:471-495, back-end/api/applicants.py:572-574), and the guide places it on the Applications tab while applications are open (.scratch/wayfinding/what-to-show-and-when/issues/02-the-next-step-per-phase-and-path.md:42, .scratch/wayfinding/what-to-show-and-when/issues/02-the-next-step-per-phase-and-path.md:66).
Verified: the flag never resets (section 2.2), including across `applications_closed -> applications_open`.
Inferred consequences: after an early publish, a new applicant hit by a rule reads "Not Accepted" the moment they submit; a rule added later (rules stay editable until `assignment`, back-end/api/markets.py:324-336) rejects undecided applicants in front of them at once (back-end/api/markets.py:1874-1876); a reviewer flipping Approved to Rejected, or back, is shown live (back-end/api/applicants.py:454-487).
The rule-side protection "once published, a rule's rejection stands" (back-end/rejection_rules.py:173, matching S02 "As built") guards only the un-rejecting direction.
This is known gap 6 (docs/MVP_KNOWN_GAPS.md:87-91), which asks for a confirmation saying how many will see "Not Accepted" and "whether a later change reaches them"; the code still has no confirmation and no wording about later changes.
The walk's open question "what Publish Results does, to whom, and whether it is needed before assignment" (.scratch/wayfinding/what-to-show-and-when/walk/walk.md:99) is still unanswered in code.

### 6.4 Wording differs across surfaces (inconsistency, low-medium)

The organizer reads "Rejected" (front-end/src/utils/verdicts.ts:9); the applicant reads "Not Accepted" (front-end/src/views/ApplicantDashboard.vue:32).
The applicant also reads "Not Accepted" for `vendor_refused` (front-end/src/views/ApplicantDashboard.vue:37), which the organizer reads as "Refused" (front-end/src/utils/verdicts.ts:15), so the applicant's word conflates two different outcomes.
The dashboard map lacks `needs_follow_up` (front-end/src/views/ApplicantDashboard.vue:28-39); harmless today because the server never sends it (back-end/api/applicants.py:88-89).
The S02 story text quotes "answered “Half a table, shared”" in lower case, the code and tests say "Answered" (back-end/rejection_rules.py:145, front-end/e2e/automatic-rejections.spec.ts:171); doc drift only.

### 6.5 The drawer can hide that a vendor is rejected (gap, low-medium)

The vendor drawer shows a verdict only through the giver line (front-end/src/components/VendorDrawer.vue:161-163), which is null for a verdict with no recorded giver (front-end/src/utils/verdicts.ts:61-62).
So a vendor rejected before E34, or any application whose giver is missing, opens from a seat or the door with no sign of being rejected; combined with 6.1 that is the screen an organizer would check.

### 6.6 Rejections are not separable by source (gap, low)

The All view's "Rejected" filter merges manual and automatic rejections (front-end/src/utils/reviewQueue.ts:117-123); with the real market's rules rejecting many applicants, checking only the rule's work means reading every giver line.
The one-by-one queue never shows a rule's rejection as a card (front-end/src/utils/reviewQueue.ts:84), so a reviewer only meets them by opening the reviewed list; S02's "A reviewer sees the reason on the card" is met only for the reviewed list and the All view, not the queue.

### 6.7 Answers changed after a rejection (inconsistency, low)

A CSV re-import re-opens an approved application whose solver-relevant answers changed, but never a rejected one (back-end/csv_import.py:1427-1428); an online edit re-opens neither (back-end/application_write.py:140-141).
A manually rejected applicant who corrects a disqualifying answer stays rejected with nobody told, while a rule-rejected one is re-judged; this is consistent with "a person's verdict is never touched" (S02) but nothing says it to the reviewer.

## 7. Backlog decisions versus code

- "Verdicts hidden until the organizer publishes" (captain ruling 2026-07-13, back-end/api/applicants.py:7-19): implemented, but leaky at the open/under_review boundary (6.2).
- "The reason is shown to the organizer, never to the applicant" (E33/F03/S02): matches (section 2.4).
- "Once results are published, a rule's rejection stands" (E33/F03/S02): matches (back-end/rejection_rules.py:173).
- Rules "freeze when the market enters Assignment" (E33/F03/S01): matches (back-end/api/markets.py:324-336; there is no edge back from `assignment` to `review`, back-end/guards.py:433-459).
- "Every verdict says who", shown on the card and the vendor drawer (E34/F01/S01): matches, with the drawer gap in 6.5.
- "Publish Results is the form path's" (E10/F04/S03, E31/F03/S04): matches on both server and page.
- Vendors see their verdict after close (E26/F07/S02): matches; the only E2E on an applicant's verdict asserts "Approved" (front-end/e2e/vendors-see-their-application-after-close.spec.ts:60); none asserts "Not Accepted" or the pre-publication label of an auto-rejected applicant.
- Known gap 6, a confirmation on Publish Results: still open (6.3).
- Outcome emails: out of scope by decision (section 2.5).
- No backlog item or decision addresses a vendor rejected after the assignment ran, or a pin on a non-approved vendor (6.1); the pin docstring explicitly defers "a pin for someone who has withdrawn" as "a different problem" with no ticket I could find.
