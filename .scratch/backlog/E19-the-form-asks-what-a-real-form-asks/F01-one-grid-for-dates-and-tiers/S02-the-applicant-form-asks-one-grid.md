---
id: E19/F01/S02
title: The applicant form asks one grid
type: story
status: done
blocked_by: [E19/F01/S01]
pr: []
---

## What to build

An applicant answers one question instead of two: a row per market date, tier checkboxes on each row, and an explicit **Not available** choice for a day they cannot attend.

Availability is no longer asked separately - it follows from which days carry a tier, the way an organizer's own form has always worked.

The same component serves the real apply page and the organizer's form preview, so both change together.

## What the applicant sees now, and why it is wrong

Today: a checklist of dates, and then - only after ticking - a tier row per ticked date.
Two questions, in an order the applicant must discover, to express one thing.

## Acceptance criteria

- [ ] The applicant answers dates and tiers as one grid, with an explicit "not available" choice per date.
- [ ] Ticking "not available" for a date clears any tiers on that date and excludes it from availability; ticking a tier clears "not available".
- [ ] The **stored** answer is unchanged in shape: per-date tiers in the plan's tier order, with availability stored separately and derived - through the rule `S01` moved, not a second implementation.
- [ ] The separate availability question is removed from the form; nothing asks it twice.
- [ ] **Validation messages are rewritten to describe one question.** The current wording tells an applicant to "choose at least one tier for every date you are available, or remove that date", which describes a form that no longer exists.
- [ ] The organizer's form preview shows the same control as the apply page.
- [ ] A market with one date and one tier still renders sensibly; so does one with twelve dates and four tiers.
- [ ] No migration: an existing stored answer is already in the target shape, and stored applications are not re-validated. Confirm with a market that has applications from before this change.
- [ ] The essential-fields e2e coverage is updated to drive the new control and still asserts the same stored result.
- [ ] Keyboard operation works; a grid that only responds to a mouse is not finished.
