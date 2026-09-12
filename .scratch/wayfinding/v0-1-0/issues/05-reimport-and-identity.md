# 05: Re-import and applicant identity semantics

Type: grilling
Status: resolved
Blocked by: none

## Question

Organizers will import the same Google Form more than once - the form keeps collecting after the first import, a bad mapping needs redoing, a vendor emails a correction.
Decide what a second import does.

### The constraint that shapes everything here

**Identity is a unique index on `(market_id, applicant_email, application_type)`**: one main application per person per market, with a waitlist application allowed alongside.
`ensure_application_indexes` is explicit that the index *is* the guarantee, not a decoration on one the code keeps anyway.

**`find_or_create_application` can never update.** It is a conditional upsert using `$setOnInsert` (`applications.py:114`), so the document body is written **only on insert**.
A re-import reusing that path would silently no-op for every applicant who already exists and hand back their old document unchanged.
Re-import needs deliberate update semantics; it cannot ride the create path.

Available writes: `update_application_form_data` (form_data, submitted_at, updated_at, by id) and `update_application_status` (by id).

## Answer

### Merge rule

**Upsert on `(market_id, applicant_email)`**, matching the unique index exactly.

Append is not available - the index forbids a second main application for the same address, so it would throw rather than duplicate.
Replace-wholesale would destroy review state and rotate application ids that the review UI, and any future offer reference, depend on.

### Review state when answers change

**Revert to `open` only when a solver-relevant answer changed. Keep the status otherwise. Show the count in the preview before committing.**

A corrected Instagram handle must not undo a review.
A changed availability or tier must, because the organizer approved a vendor whose constraints no longer hold, and the solver would otherwise place someone against data nobody accepted.

Rejected:

- Keeping the approval unconditionally, which lets edited answers slip past review entirely.
- Reverting unconditionally, which can silently un-approve fifty vendors mid-review and make the organizer redo all of it.
- A "changed since review" flag that preserves the status: honest, but it needs a flag state and a UI to act on it, for a case the preview already surfaces.

The preview line - "3 approved applications will return to review because their answers changed" - is what keeps either direction from being a surprise.

### Applications absent from the new file

**Left alone, with the count reported in the preview.**

Absence almost always means the organizer exported a filtered or partial range, not that the applicant withdrew, and inferring withdrawal from a missing row would destroy review state on a guess.
`CANCELLED` exists for a real withdrawal, but that is a deliberate act, not something to infer.

### Phases that permit import

**`applications_open` and `applications_closed` only. Blocked from `review` onward.**

Mutating the applicant set under an in-progress review is the hazard.
The state machine already supplies the escape hatch: `review -> applications_closed` is an existing edge, so an organizer with a straggler reopens, imports, and moves forward again.
That is deliberate and visible rather than a silent mutation, and it needs no new edges.

### No `source` field

An application does not record that it arrived by import.

Intake mode is frozen after `draft` and permits exactly one mode, so a `source` field would always equal the market's intake mode - a second copy of a fact already stored, which is the duplication `AGENTS.md` repeatedly warns against.
The time to add it is when hybrid intake arrives, which is the third intake-mode value ticket 06 deliberately left room for.
