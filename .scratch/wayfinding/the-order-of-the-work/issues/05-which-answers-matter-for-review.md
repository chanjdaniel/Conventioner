# 05: Which answers matter for review, who says so, and how does the review card use that?

Type: grilling
Status: resolved
Blocked by: 04

## Question

The review card dumps every answer an application carries into one flat `<dl>`.

**The product already believes some answers matter more than others - it just infers it.**
`reviewAnswers()` (`front-end/src/utils/reviewQueue.ts:17`) orders **custom fields first, then essential answers**, and the comment above it states the reasoning: the organizer's own questions "are what distinguish applicants from each other - what the vendor sells, their portfolio - while the essential answers mostly repeat, because they are drawn from the same small offering."

That inference is wrong in both directions.
A custom "How did you hear about us?" is noise on a triage card.
An essential availability answer can be the whole decision.

`FormField` has no field for this: `back-end/datatypes.py:527` is `key`, `label`, `type`, `required`, `options`, `help_text`, `order`.

### What to decide

**How a form marks which of its fields a reviewer needs, and what the review card does with that mark.**

- **Is it a boolean or an ordering?**
  A flag says which fields lead the card.
  A rank says what a reviewer reads first, second, third - which may matter more, since the complaint behind this is a flat dump.
- **Can essential answers be marked too, or only custom fields?**
  They are not `FormField`s - they are derived from the plan by `essential_fields.py` - so marking them needs a different mechanism than a property on a field.
  If only custom fields can be marked, the heuristic survives for half the card.
- **What happens to the unmarked fields?**
  Hidden, collapsed behind a disclosure, or still listed below the marked ones.
  A reviewer sometimes needs the rest; losing access outright is worse than the current dump.
- **Does `required` already mean some of this?**
  A required field is one the organizer insisted on, which is not the same as review-relevant - but the overlap needs stating, or the builder ends up with two checkboxes an organizer cannot tell apart.

### Notes

**The freeze is the sharp edge, and it decides where the data lives.**
The application form locks once the first applicant submits (`application_form_lock_reason()`, D9).
**When an organizer learns which fields they actually needed for review is while reviewing** - which is after the lock.
If review-relevance is stored on `applicationForm`, it becomes unchangeable at the exact moment it becomes knowable.
That argues for holding it somewhere the lock does not reach, or for carving an explicit exception.
Settle this before designing any UI.

**Three overlapping notions of "which answers matter" now exist**: `required`, `SOLVER_RELEVANT_KEYS` ("the answers a change to which invalidates a review"), and this new one.
That is a vocabulary problem before it is a UI problem.
Name them apart or unify them deliberately; `domain-modeling` and `CONTEXT.md` are the tools.

Blocked by ticket 04 because that ticket may add a key to the essential set and decide how the builder presents per-question settings at all.

Findings: `Q6` in `.scratch/qc/2026-09-21-manual-qc.md`.

## Answer

**Review highlights live on the market, beside `applicationForm` and never inside it. Marked answers lead the card; the rest collapse behind a disclosure.**

### Why not on the form

The freeze decides this.
`application_form_lock_reason()` freezes the form at the first application, and **an organizer learns which answers they actually needed while reviewing** - which is after that moment.
A `reviewRelevant` flag on `FormField` would become unchangeable exactly when it becomes knowable, and would need an exception carved into a lock whose whole value is that it has none.

Two further things fall out of keeping it off the form:

- **It can name essential answers.**
  Essential questions are not `FormField`s - they are derived from the plan - so a property on a field could only ever mark half the card.
  A list of *answer keys* marks both kinds uniformly, and the walk's complaint was specifically that an essential availability answer can be the whole decision.
- **It needs no contract regeneration and no migration.**
  An absent list means "nothing marked", which renders as today's card.

### The shape

A list of answer keys on the market, server-owned like `applicationForm` and `assignmentObject`.
Authored in the **form builder**, which is where the walk asked for it and where an organizer is already thinking about their questions - and **adjustable from the review queue**, which is where they find out they were wrong.
One store, two places that write it.

A flag, not a rank.
Most markets will want two or three answers at the top and will not care about the order of the rest; ranking is more to author for a distinction they are not making.

### The card

Marked answers render first.
Everything else collapses behind **Show all N answers**, closed by default.

This is the strongest focus and the shortest card, and it has a real cost that the build must answer for: **at card forty, a click to reach an unmarked answer is a tax.**
Three things follow:

- The disclosure's state should persist across cards within a review session, so a reviewer who opens it once is not reopening it forty times.
- The count belongs in the label (`Show all 9 answers`), so a reviewer knows what is hidden without opening it.
- If a market has marked nothing, the card must render as it does today - everything visible, no disclosure. An empty list is not a reason to hide the whole application.

### What it replaces

`reviewAnswers()` (`front-end/src/utils/reviewQueue.ts:17`) currently orders custom fields first, then essential, and its comment reasons that the organizer's own questions "are what distinguish applicants from each other".
That heuristic was standing in for exactly this mark.
**It goes**, replaced by the stated list - with the ordering within each group unchanged so nothing else moves at the same time.

### The vocabulary problem, named

There are now three overlapping notions of which answers matter, and they must be kept apart in the glossary rather than allowed to blur:

- **`required`** - the applicant cannot submit without it.
- **`SOLVER_RELEVANT_KEYS`** - a change to it invalidates a completed review.
- **review highlights** - a reviewer reads it first.

They are independent: a required answer may be noise on a triage card, and a highlighted answer may be optional.
`CONTEXT.md` should carry all three, or the form builder ends up with controls an organizer cannot tell apart.
