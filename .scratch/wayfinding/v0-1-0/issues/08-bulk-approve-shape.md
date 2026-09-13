# 08: What shape does bulk-approve take in the application monitor?

Type: prototype
Status: open
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
