---
layer: business
kind: intent
verified: 2026-10-22
sources:
  - E36/F04
  - E36/F05
---

# Results go out once, and settle the allocation

On a market whose vendors apply on its own page, results are published once, as the step after a current assignment, and publishing settles that assignment: it is not run again afterwards, and the market goes live only once results are out.
Until then every applicant reads "Submitted", whatever the review has decided; afterwards each reads only whether they have a table, from the seats as they stand, and never a verdict or a reason.

## Why

What an applicant has read cannot be untold, so nothing reaches them until the allocation it describes is done.
When results could be published from the first verdict, every later verdict reached applicants the moment it was given, and a market could go live on an out-of-date assignment, or without its results ever going out.
A verdict word can be contradicted by a seat placed by hand or a vendor added on the day; the seat cannot, so an applicant reads the seat.
And an applicant who learned that a rule had rejected them the moment they submitted would learn it before any person had looked.

## Rules

- [Publish Results waits for the allocation](../rules/publish-results-waits-for-the-allocation.md): published in assignment, once a current run is stored, which it then settles.
- [An applicant never reads a verdict early](../rules/an-applicant-never-reads-a-verdict-early.md): "Submitted" until then, a table or none after.
- [Assign runs only in assignment](../rules/assign-runs-only-in-assignment.md): the run is refused once results are published.
- [The assignment rules close with the assignment](../rules/the-assignment-rules-close-with-the-assignment.md): so do the rules.
- [An assignment knows when it is out of date](../rules/an-assignment-knows-when-it-is-out-of-date.md): what makes a run current enough to publish.

## Flows

- [The assignment and its result](../flows/assignment-and-result.md): publishing results, after the run.
- [Applying online](../flows/applying-online.md): what a vendor reads of their outcome.
- [Publishing, and the door on market day](../flows/market-day-door.md): the market going live once results are out.
