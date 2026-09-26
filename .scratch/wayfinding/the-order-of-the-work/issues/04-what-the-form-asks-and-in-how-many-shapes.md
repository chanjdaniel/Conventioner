# 04: What does the application form ask, and in how many shapes may it ask it?

Type: grilling
Status: resolved
Blocked by: -

## Question

Two gaps in the essential-questions contract, which is one contract and should be decided once.

**The form asks dates and tiers exactly one way; real CSVs ask them several.**
The asymmetry runs the opposite way to what you would guess.
`csv_import.py`'s `_assembled_rows` already accepts **two** shapes and normalises both at the boundary: a per-date tier grid - one column per market date, tiers in the cell, which answers availability too because "the dates you named tiers for are the dates you are available" - and a flat tier list, widened to those tiers on every available date.
The applicant validator in `essential_fields.py` accepts a `dict` only, and requires a non-empty entry for **every** available date.
One input method, and a CSV whose real shape differs has nowhere to land on the form side.

**Preferred name is a column the acceptance fixture carries and the contract has no key for.**
`readable-journey` ticket 02 (built as `E13`, PR #70) chose `essential_full_name` and *saw this column*: the committed Fall 2025 export carries **Full Legal Name** and **Preferred Name** as columns 4 and 5, and the ticket says outright that Conventioner "drops both because it has nowhere to put them."
It built a home for column 4 only.
What it explicitly deferred was a *trading name* (`Paper & Pine` rather than `Ana Rivera`), which is a different thing and does not cover this.

### What to decide

**Which input methods the form offers for dates and tiers, who chooses them, and whether preferred name joins the essential set.**

On input methods:

- **Which methods?** Per-date tier grid, one flat tier question plus a separate dates question, or both.
- **Who chooses?** An organizer setting in the form builder, or does the shape follow the plan - one date and one tier means never ask a grid?
- **Where does normalisation live so it is not written twice?**
  `csv_import.py` has its widening logic inline.
  CLAUDE.md's rule is that `essential_fields.py` is the single owner and `essentialFields.ts` its mirror; a third copy in the import path is the drift to avoid.

On preferred name - the walk already made the call, so these are the consequences:

- **Essential, not required.** The contract already draws that distinction: `TABLE_SHARE_EMAIL_KEY` is essential-but-optional, omitted from `REQUIRED_ESSENTIAL_KEYS` on purpose.
- **Which name does a screen show?** `VendorIdentity.vue` is the one component every vendor-facing screen renders through, so the rule lands in one place.
- **Gated on nothing**, following `full_name`, which the ticket records is "asked unconditionally, which is a first".
- **Out of `SOLVER_RELEVANT_KEYS`**, so correcting a spelling does not invalidate a completed review.
- **Not addable to `UNASKABLE_ESSENTIAL_KEYS`**, which admits rankings only.
- **CSV import must be able to map it**, or the export's column 5 still has nowhere to go.

### Notes

**Storage stays canonical; input methods vary.**
Both CSV shapes converge on `{date: [tier, ...]}`, tiers in the market plan's order, before anything downstream reads them.
Whatever methods the form gains should normalise at *its* boundary the same way, so the solver, the review card, the applicant dashboard and the importer keep reading one shape.
Backwards compatibility means the storage contract does not move; it does not mean the form keeps its one control.

**Reproduce before designing.**
The report records the structural gap, not the specific failure.
The importer handles more shapes than it looks like, so the real failing case against the CSV in hand may be narrower or wider than "dates and tiers".

**No migration is needed for preferred name**, for the same reason `E13` needed none: `_solver_vendor` names the keys it reads explicitly rather than looping over `asked_essential_keys()`, and stored applications are not re-validated.

**One fix rides on this ticket.**
`F12` - the "Ask this" toggle sitting inline with the ranking badge - is on the panel this ticket may redesign.
Fix it on its own if this ticket sits.

**Mechanics:** changing the contract means regenerating `docs/schema.d.ts` (`python generate_market_schema.py --output ../docs/schema.d.ts` from `back-end/`, pinned by `tests/test_generate_market_schema.py`) and keeping `front-end/src/utils/essentialFields.ts` in step.

Findings: `Q8`, `F18`, `F12` in `.scratch/qc/2026-09-21-manual-qc.md`.

## Answer

**One input method, not two - and it is the one a real form already uses. Storage does not move.**

### The incompatibility, reproduced rather than assumed

The repo carries the real export: `back-end/tests/test_data/google_forms_export.csv`, 232 rows, 31 columns, with `tests/test_real_export_shapes.py` already asserting its shapes.

**That form asks ONE question.**
Columns 20-24 are a single grid - *"For each day, choose all table tiers that you would like to be considered for. Choose None if you are not available."* - one column per date, the date in the header as `[Monday, November 17]`, tiers in the cell, `None` meaning that day is out.
Availability is implicit in the tier answer.

**Conventioner's applicant form asks TWO.**
`EssentialApplicationFields.vue` renders a date checklist, then one tier row per ticked date.
Availability is explicit and comes first.

That is the whole of the mismatch.
The import path is not the problem: `_tier_grid` reads the bracketed date, drops `None`, omits empty dates, and `_assembled_rows` derives availability from what is left - with a comment that already names the real form's shape as the reason.
**The applicant form is the half that cannot ask the question the way an organizer's own form asks it.**

### Decisions

**1. The applicant form asks dates and tiers as one grid.**
A row per market date, tier checkboxes, plus an explicit **Not available** choice.
The two-question shape is replaced, not joined - an organizer setting would mean two applicant UIs, two sets of validation messages and two e2e paths alive forever, to express something the storage cannot tell apart.

**2. Storage is unchanged, and that is what backwards compatibility means here.**
`{date: [tier, ...]}` with tiers in the market plan's order, availability stored separately and derived from the grid.
The importer already proves this shape maps losslessly from the combined question, so the solver, the review card, the applicant dashboard and the importer keep reading exactly one shape.
Backwards compatibility is a property of the stored contract, not of the control.

**3. The derivation lives in `essential_fields.py`, and `csv_import.py` calls it.**
Today the widening is inline in `_assembled_rows`.
Once the form produces the same shape, two callers need the same rule, and CLAUDE.md's standing rule for this contract is that `essential_fields.py` is its single owner with `essentialFields.ts` as the mirror.
A third copy in the import path is the drift to avoid.

**4. Preferred name joins the essential set as essential-but-not-required**, taking the shape `TABLE_SHARE_EMAIL_KEY` already has: asked of everyone, omitted from `REQUIRED_ESSENTIAL_KEYS`.
Asked unconditionally, following `full_name` - identity does not depend on the plan.
Out of `SOLVER_RELEVANT_KEYS`, so correcting a spelling does not invalidate a completed review.
Not addable to `UNASKABLE_ESSENTIAL_KEYS`, which admits rankings only.
The importer must be able to map it, or the export's column 5 still has nowhere to go.

**5. `VendorIdentity.vue` renders preferred name when present, full legal name otherwise.**
One rule, one component, every vendor-facing screen.
The legal name stays stored and stays visible on the review card, where an organizer is deciding about a person rather than reading a list.

### Consequences

- **The validator's message changes with the control.** "Choose at least one tier for every date you are available, or remove that date" describes two questions. With one grid, an unanswered row is simply unanswered.
- **No migration.** `_solver_vendor` names the keys it reads explicitly rather than looping over `asked_essential_keys()`, and stored applications are not re-validated - so existing applications keep assigning, and an existing per-date answer is already in the target shape.
- **Contract regeneration.** `python generate_market_schema.py --output ../docs/schema.d.ts` from `back-end/`, pinned by `tests/test_generate_market_schema.py`; `front-end/src/utils/essentialFields.ts` kept in step.
- **`F12`** - the "Ask this" toggle's placement - is unaffected by this answer and stays a plain fix. Move it to `E17`.
