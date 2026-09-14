# 01: Where does a submission timestamp stop being text and become a moment?

Type: grilling
Status: claimed
Blocked by:

## Question

Report findings C1 and C2.

`Application.submitted_at` is stored exactly as the CSV wrote it: `9/12/2025 18:22:56`.
Two things read it, and both are wrong on that shape.

`_as_magnitude` (`back-end/assignment/assignment.py:23`) ends in `datetime.fromisoformat`, whose
docstring says "an ISO timestamp sorts correctly as text". Google Forms does not write ISO, so the
call raises, the function returns `None`, and `_magnitude_score` returns `math.inf` for **every**
imported applicant. The organizer's "when the application arrived, earliest first" rule contributes
nothing to the ordering, silently. Verified inside the running container.

Ordering then falls through to the tiebreak at `assignment.py:386`, which compares `submitted_at`
as a raw string. Unpadded hours alone put 111 of the fixture's 232 rows in the wrong position:
`"9/27/2025 9:04:01"` sorts after `"9/27/2025 23:49:25"`.

Decide **where the conversion belongs**, because that is the part that is not obvious:

- **At import**, normalising to ISO-8601 on the way into the document. Everything downstream then
  compares one shape and the tiebreak becomes chronological for free. Costs a migration for rows
  already stored, and makes the import responsible for a format it does not own.
- **At read**, teaching `_as_moment` the formats a form export may carry. No migration, but the
  stored document keeps a shape nothing else in the system uses, and every future reader has to
  know about it.
- Something else: a parsed field beside the raw one, or a value type that owns its own parsing.

And decide what happens to a timestamp that cannot be parsed **at all**. Today it silently scores
`inf` alongside everyone else. Whether an unreadable timestamp should refuse the import, refuse the
run the way `IncompleteApplicationsError` does, or be surfaced to the organizer as "this rule is
ordering nothing" is the same decision seen from the other end.

Note the invariant `AGENTS.md` already states: "a CSV-imported row must carry its own
`submitted_at`, or first-come-first-served decides nothing." The row does carry it. It decides
nothing anyway. Whatever this ticket settles should make that sentence true rather than aspirational.
