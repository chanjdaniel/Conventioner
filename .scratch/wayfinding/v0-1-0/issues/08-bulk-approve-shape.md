# 08: What shape does bulk-approve take in the application monitor?

Type: prototype
Status: resolved
Blocked by:

## Question

Charting settled that imported CSV rows land at status `open` and are reviewed in the existing
`ApplicationMonitor`, "with a bulk-approve action".
The *what* is decided; the shape is not, and the shape is what makes or breaks the MVP journey:
a 120-row import is 120 clicks today, because `ApplicationMonitor.vue` offers only a per-row
Approve and Reject.

Decide, by building a throwaway prototype to react to:

- **Selection.** Select-all, per-row checkboxes, or apply-to-current-filter with no selection model
  at all. The monitor already filters by status; whether the bulk action rides that filter or a
  separate selection is the core question.
- **Which actions are bulk.** Approve only, or reject too. Rejection is the destructive direction
  and an applicant never learns of it in MVP (outcome emails are out of scope), so the asymmetry
  may be right.
- **Confirmation.** Bulk-approve feeds the solver directly - approved applications are its only
  input - so an accidental approve-all silently changes who gets a table. Whether that earns a
  confirm step, an undo, or neither.
- **Scale.** What the action does to a status the row cannot legally leave, and whether the result
  reports per-row outcomes or a single count.

The answer must say what the organizer sees and does, not how it is implemented.
Buildable work goes to `.scratch/backlog/E04-v0-1-0-release/`.

## Answer

**Superseded, not answered.** Closed 2026-09-14 while charting
[Map: Real-market readiness](../../real-market-readiness/map.md).

A Playwright walk of the journey against a real 232-row export showed this ticket asks a narrower
question than the evidence supports. Click count is not the queue's worst problem: the card shows
`email, status, date, Approve, Reject` and nothing else, so the organizer is asked to approve or
reject 232 people with nothing to decide on. There is also no count, search, filter, sort or paging,
and every click re-fetches all 232 rows.

The selection/confirmation/scale questions above are carried forward intact into
[04: What must a reviewer see to decide on an application?](../../real-market-readiness/issues/04-what-a-reviewer-needs-to-decide.md),
which adds "what is on a row" as the question they hang off.

Evidence: `.lavish/mvp-findings.html`, finding W2.
