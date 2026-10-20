# 02: Who sees a rejection, and when

Type: grilling
Status: resolved
Blocked by: 01

## Question

Given [01](01-how-rejections-are-shown-today.md): when does a verdict settle, can someone who is not approved hold a seat, when can results be published, and what does an applicant read before and after?

Daniel's position going in: approval status is locked once the transition and the assignment are done; results are not publishable until everything is reviewed and allocated; additions are made by hand during market days; a waitlist works like a reapplication.

Grilled over Discord on 2026-10-20 in two rounds, with a review of every phase between them ([`walk/state-review.md`](../walk/state-review.md)).
Daniel confirmed the shared understanding the same day.

## Answer

### Verdicts

1. **Verdicts lock on entering `assignment`.**
   That includes "needs follow-up", which is a verdict too.
   Entering `assignment` already needs every application approved or rejected.
2. **There is no way back to review.**
   From `assignment` on, a verdict is the review's record and stays as it is.
   A mistake is fixed with seats: a rejected vendor placed by hand (warned), or an approved vendor's seat freed.
   So verdicts lock on the same rule as the automatic rejections: they are open while the market can still reach `review`.

### Seating someone who is not approved

3. **An editor may place or pin a vendor who is not approved, by hand.**
   The review and the automatic rules govern the run, never the organizer's hand.
   It follows the override-warning pattern: warned before the change, never blocked.
4. **The place dialog offers every applicant.**
   Rejected ones are their own "Not approved" group; picking one warns who rejected them (or the rule's reason), alongside the usual tier, date and table-size warnings.
   It is stored as a pin, so a re-run seats them first rather than orphaning them, and the seat is marked "not approved" wherever overrides show.
5. **Every applicant is visible on the Vendors page**, with a "Rejected only" filter beside "Unassigned only".
   "Unassigned" keeps meaning approved with no seat, so a rejected applicant is never counted as unassigned (the bug 10 miscount stays fixed).
6. **A seat goes only to someone with an application in the market.**
   The API no longer accepts an address the market has no record of.

### Adding a vendor who never applied

7. **"Add a vendor"** takes a name and an email, answers optional, in `assignment` and `market_days`, and records an application marked as added by that organizer.
   They are seated by hand through the same dialog and are never an input to the run: their answers may be missing, and a missing answer refuses every run.
   On a form market they can sign in and see their page like any applicant.

### Publishing results (form markets)

8. **Publish Results stays its own button**, not part of going live.
9. **It is available in `assignment` once a run is stored and up to date**, and opens a confirmation saying how many applicants will read each outcome.
10. **Publishing ends re-runs.**
    Seats change only by hand after it, and the assignment rules lock with it.
11. **A form market cannot go live until its results are published.**
    A CSV market has no applicant surface and no Publish Results, and going live does not need it.

### What an applicant reads

12. **Before publishing: "Submitted"**, whatever happened to the application, a rule's rejection included.
13. **After publishing, one of two outcomes:** "You have a table", with the table and date for each date, or "You did not get assigned".
    Rejected, approved without a seat and declined all read the same, and no reason is ever shown to an applicant.
    It is worked out from the stored seats on every read, so a hand change after publishing shows at once.
    This replaced an earlier answer in the same session ("Not accepted", with "You declined" for a vendor who turned an offer down): nothing can produce a decline today, and there are just two outcomes.

### Out of scope

14. Waitlist applications, recorded as future work.

Buildable work: [`E36`](../../../backlog/E36-rejections-settle-with-the-review/epic.md).
