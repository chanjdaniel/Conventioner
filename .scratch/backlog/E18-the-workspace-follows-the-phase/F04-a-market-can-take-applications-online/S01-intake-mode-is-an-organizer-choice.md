---
id: E18/F04/S01
title: Intake mode is an organizer choice
type: story
status: done
blocked_by: []
pr: []
---

## What to build

An organizer chooses how vendors reach their market - by importing a spreadsheet, or through a form on the market's public page - while the market is a draft.
After draft it is frozen.

This is the first time the applicant surface can be switched on.
It is built already: the apply page, the applicant login and the applicant dashboard all exist and the apply page already answers correctly in every phase.
Nothing in this story builds an applicant screen; it builds the switch.

## The rule that does not change

**Absence still means CSV.**
The default does not move, so the applicant surface keeps failing closed and no migration or backfill is needed.
Wrongly hiding an application surface is visible and gets complained about; wrongly exposing one is silent until a stranger applies.

## Where it lives

In the plan, as one of the draft page's ordered sections, because it decides what the form is *for*.
If the draft page has not landed yet it goes in the plan as it stands today; the draft page composes the same sections, so it is not moved twice.

## Acceptance criteria

- [ ] An organizer can set intake mode on a draft market, and the choice is stated in plain language - how vendors apply, not a mode name.
- [ ] The control is unavailable once the market leaves draft, and the back end refuses the change from the stored phase rather than trusting the absent control. A hidden control is not a rule.
- [ ] A market with no intake mode stored continues to behave exactly as a CSV market; no migration runs.
- [ ] A market set to form intake serves its applicant endpoints; a CSV market's applicant endpoints keep answering exactly as a market that does not exist.
- [ ] **No "this market does not accept online applications" message is added anywhere.** The existing spec asserting that a gated market and an absent market render identically must still pass - a distinct message would confirm to any stranger guessing slugs that the market is real.
- [ ] The two applicant-login endpoints keep their uniform response and do not gain a 404 of their own, which would be an oracle saying "this slug is a CSV market".
- [ ] The project's agent notes are amended where they record that no UI control for this ships deliberately. Everything else in that section stands.
- [ ] Verified end-to-end: a form-intake market's public apply page is reachable and accepts a submission; a CSV market's is not.
