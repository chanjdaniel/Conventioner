# 01: Where does a submission timestamp stop being text and become a moment?

Type: grilling
Status: resolved
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

## Settled so far

Given in grilling on 2026-09-14. **Not a resolution** - this ticket stays open until the whole
round is closed, because a later answer can still reshape it.

- **The conversion happens at import**, normalising to ISO-8601 on the way into the document.
  The deciding fact: the *public applicant form already writes ISO*
  (`application_write.py:124`), so only the CSV path stores a raw `M/D/YYYY`. Converting at read
  would mean maintaining two stored shapes forever and hoping every future reader knows.
- **It fixes more than the solver.** `api/applications.py:166` sorts the review queue by the same
  raw string, so the order an organizer reviews 232 applications in is wrong too. Converting at
  import fixes both; teaching `_as_moment` would fix only the reader you remembered.
- **An unparseable timestamp refuses the row**, naming it, the way `IncompleteApplicationsError`
  refuses rather than silently placing someone.
- **The refusal applies only when the column is mapped.** `submitted_at` is an optional target
  (`csv_import.py:195`) and stays optional: the import validates what it was given and does not
  reach into the setup object to find out whether a priority rule cares. Coupling them would let a
  rule added later retroactively invalidate an import that already succeeded.
- **But say something** when no timestamp column is mapped *and* a `submitted_at` priority rule
  exists - that combination is the silent no-op in a new disguise.
- **Migrate with a plain script, no boot marker.** The marker pattern exists for hazards that are
  *invisible* (an unmigrated market simply does not appear). A raw timestamp misorders visibly, so
  paying a boot refusal for it teaches operators the refusal is noise.

## Answer

**A submission timestamp becomes a moment at import.** It is normalised to ISO-8601 on the way into
the document, and every reader downstream compares one shape.

### Why there, not at read

The public applicant form **already writes ISO** (`application_write.py:124`). Only the CSV path
stored the form's raw `M/D/YYYY H:MM:SS`. So this was never "pick a format" - it was "make the CSV
path agree with the path that was already right". Converting at read would mean maintaining two
stored shapes for the life of the product and trusting every future reader to know.

It also fixes more than the solver. `api/applications.py:166` sorts the review queue by the same raw
string, so the order an organizer reviewed 232 applications in was wrong too. One conversion at the
boundary fixes both; teaching `_as_moment` would have fixed only the reader someone remembered.

### What happens to a value that will not parse

**The row is refused and named**, the way `IncompleteApplicationsError` refuses rather than quietly
placing someone. Silently scoring `math.inf` - today's behaviour - is what made this invisible.

**The refusal applies only when the column is mapped.** `submitted_at` stays an optional target
(`csv_import.py:195`): a market with no time-based priority genuinely does not need it. The import
validates what it was given and does not reach into the setup object to discover whether a rule
cares - coupling them would let a priority rule added later retroactively invalidate an import that
had already succeeded.

**But say something** when no timestamp column is mapped *and* a `submitted_at` priority rule
exists. That combination is the original silent no-op wearing a different hat, and the ledger is
where it is visible.

### Migration

A plain script, no boot marker. The marker pattern (`migrate_market_keys.py`) exists for a hazard
that is *invisible* - an unmigrated market simply does not appear anywhere. A raw timestamp
misorders in plain sight. Paying a boot refusal for a loud failure teaches operators that the
refusal is noise.

Buildable work: `.scratch/backlog/E01-csv-vendor-intake/F04-real-export-shapes/`.
