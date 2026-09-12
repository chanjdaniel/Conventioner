# 02: The solver's native vendor input model

Type: grilling
Status: resolved
Blocked by: none

## Question

What replaces `source_data` as the solver's input?

`MarketAssignment.__init__` took `(setup_object, source_data)` where `source_data["data"]` is a 2D array with headers in row 0.
`_get_vendor_rows()` (`assignment.py:327-341`) flattened it into `List[Dict[str, str]]` keyed by `setup_object.col_names`, and `Vendor.__init__` then did `setattr(self, toAttrString(key), value)` for every column - so every later read was a `getattr` by a name derived from a spreadsheet heading.

Ticket 01 fixed the field set; this ticket decides the model and the plumbing.

## Answer

### The model

**A typed `SolverVendor`** carrying ticket 01's seven fields as named attributes, replacing the dynamic-attribute bag.

Chosen over keeping `Dict[str, str]` because the dynamic form has no failure signal: `getattr(vendor, x, '')` returns `''` for any name that does not exist, so a typo or a renamed field reads as "the vendor answered nothing" and the market simply assigns oddly.
Both defects below are that failure mode.
Typing also lets `max_dates` be an `int` and `available_dates` a list of dates, instead of strings re-parsed at each use.

The dynamic surface is small: seven access sites (`assignment.py` lines 52-54, 71, 265, 352-353, 405, 596).

**The translation lives in its own module under `assignment/`** (e.g. `assignment/vendor_input.py`), taking applications and returning `SolverVendor`s.
The solver package owns its own input contract, and the mapping is unit-testable without constructing a `MarketAssignment` or touching Mongo.
Rejected: putting it in `ApplicationsApi`, which owns application *storage* and should not carry solver knowledge; and a method on `MarketAssignment`, which would make it untestable except through the solver.

### Semantics

- **`date_flexibility` becomes the number of available dates.** It is a `sort_vendors` tiebreaker - lowest first, so the most constrained vendors are placed first - and days are what a vendor is actually scarce in.
  Today it sums comma-separated tier tokens across dates, conflating "how many days" with "how many tiers"; that number was an artifact of the CSV encoding, not a designed quantity.
- **A missing required answer is rejected before the solver runs**, as a precondition with a blocker naming the offending applications, following the `guards.py` pattern.
  Rejected: skipping the vendor, which produces an assignment that looks complete with someone silently missing.
  In practice this catches *imported* rows, since form applicants are validated at submission.
- **Only `reviewer_approved` applications feed the solver.** This is what `NoApprovedApplicationsGuard` already implies. `ApplicationsApi` has counts by status but no status-filtered list, so one query method is added.

### The four-day ceiling

**`MAX_VENDING_DAYS = 4` is replaced by a per-market setting - which already exists and is already wired to the UI.**

The cap is a legitimate organizer-configured ceiling, not an accident, so it stays a concept.
But `AssignmentOptionObject.max_assignments_per_vendor` is already that setting: `ElementAssignmentOptions.vue` renders a "Max assignments per vendor" input, clamps it to the market's date count, and persists it through `schema.d.ts` into the market document.

**The solver never reads it.** Zero occurrences of `max_assignments_per_vendor` in `assignment/`; the hard-coded `MAX_VENDING_DAYS = 4` wins at lines 75, 310 and 601, and is duplicated in `validator.py:8`.
An organizer can set that field to 6 today, watch it save, and get 4.

So this is not new configuration - it is connecting a control that currently lies, and deleting the constant.

### Defects to fix in the same work

1. **`max_days` reads one character.** `int(max_days_val[0])` (`assignment.py:72`) truncates `"12"` to `1`.
   Note the trap when typing this: #45 stores `essential_max_dates` as an `int`, and `int(5)[0]` raises `TypeError`, which the bare `except` on line 73 swallows into the global default - so a naive port replaces one wrong answer with a different wrong answer.
2. **The four-day ceiling above**, including the duplicate constant in `validator.py`.

### Sequencing

**The loop inversion for section preference is a separate slice** from the input-model change.
The solver is table-driven (`get_valid_vendor:430`); honouring a vendor's own section ranking means inverting that loop or adding a pre-pass, and it will move assignment outputs.
Keeping the two apart means an output diff is never ambiguous between "we changed where the data comes from" and "we changed how placement decides".

Unblocks tickets 03 and 04.
