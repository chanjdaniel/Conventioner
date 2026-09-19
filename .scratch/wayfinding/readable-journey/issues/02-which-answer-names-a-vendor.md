# 02: Which answer names a vendor on screen?

Type: grilling
Status: resolved
Blocked by: -

## Question

Every surface that shows a vendor shows an email address and nothing else.
The vendor list, its search box ("Filter by email..."), the vendor detail panel, the Unassigned Vendors panel on the payoff screen, and the occupied tables on the Tables view.
A market of 232 vendors is a list of 232 gmail addresses.

This was raised in `E08/F02`'s "Still to do" and correctly called **blocked, not deferred**, on the grounds that "a name lives in a custom field the market may not ask, and which field holds it is a decision, not a lookup."
That is still the question.

The shape of the problem:

- **The essential questions do not include a name.**
  `essential_fields.py` owns email, available dates, max dates, table choice, table-share partner, tier preference, section ranking and table-type ranking.
  None of them is an identity beyond the email address.
- **A name would be a custom field**, which a market may or may not ask, and which the organizer names freely.
  Nothing marks one custom field as "this is what to call them".
- **CSV markets may carry one and lose it.**
  My fixture had a `Business Name` column; the import offered no target for it, so it was dropped.
  The Fall 2025 import mapped no custom fields at all.
- **`CONTEXT.md` distinguishes Applicant from Vendor** by whether they have been placed, but identifies both by email.

So: does a market *declare* which field names its vendors, and if so where - on the form, on the import mapping, or as a new essential question?
Or does the product stop pretending and show the email everywhere, with the name as a secondary detail when a field happens to hold one?
What does a market that asks no name show?

Note that the **price half of `E08/F02`'s "Still to do" is now out of scope** on this map: whether a price belongs on a tier is a billing question.
The vendors table's Cost column stays an em-dash, and `E09` says so rather than leaving it looking broken.

Report finding: **M10**.

## Answer

**A vendor's name is an essential question: `essential_full_name`, one field, required, asked
unconditionally. Person only.**

### Not a custom field, and not first + last

The ticket assumed a name would live in a custom field, and the codebase encouraged that reading:
`FormField`'s docstring uses `key: "business_name"` as its example, and the `SOLVER_RELEVANT_KEYS`
comment names "a corrected business name" as the canonical custom answer.
That is overturned.
Every market needs to know who it is placing, and every organizer's form already asks - the
committed Fall 2025 export carries **Full Legal Name** and **Preferred Name** as columns 4 and 5,
and Conventioner drops both because it has nowhere to put them.

**One field, not two.**
First + last was the first shape considered and it fails on the product's own acceptance fixture:
both of that export's name columns are *whole* names, so a required first-name field would receive
`Ana Rivera` for all 232 rows.
Splitting on whitespace is a guess the product would make 232 times and get wrong on every
`van der Berg`, `Maria del Carmen` and mononym - and this is identity, where being confidently wrong
is worse than being incomplete.
`full_name` takes `Full Legal Name` directly, with no parsing and no guess.

**Person only, for now.**
A trading name (`Paper & Pine` rather than `Ana Rivera`) is a real thing a table map might want, and
the Fall 2025 export has no column for one.
It is additive and does not disturb this, so it waits.

### It redefines "essential"

`CONTEXT.md` said an essential question is "one of the questions the assignment solver reads
directly", and that rule held with **no exception** - there is no `EMAIL_KEY`; the email is
`Application.applicant_email`, the record's primary key, rendered in the form as a read-only note
rather than asked.

A name is not solver-read, so the term widens: **a question the product owns and every form asks.**
Most are solver inputs, which is why they cannot be removed; the name is the one that is essential
because identity is, not because the solver needs it.
`CONTEXT.md` is updated as part of this.

Two consequences in the contract:

- **`REQUIRED_ESSENTIAL_KEYS` stops being derived from `SOLVER_RELEVANT_KEYS`.**
  It is currently `tuple(key for key in SOLVER_RELEVANT_KEYS if key != TABLE_SHARE_EMAIL_KEY)` -
  required-ness *defined as* solver-relevance-minus-one. The two lists separate.
- **The name stays out of `SOLVER_RELEVANT_KEYS`**, so correcting a spelling does not invalidate a
  review. The existing comment there already asserts exactly this.

### Asked unconditionally, which is a first

Every other essential question is gated on the plan offering something: dates gate availability,
max dates, table choice and table-share; tiers gate tier preference; two-or-more sections gate the
section ranking.
A name is gated on nothing, because identity does not depend on the plan.
It is therefore also not declarable unasked - `UNASKABLE_ESSENTIAL_KEYS` admits only rankings, and
that rule is unchanged.

### No migration, and I checked rather than assumed

Adding a required essential key looked like it would break every existing market, because an
approved application missing a required answer refuses the whole assignment run.
It does not.
`_solver_vendor` names the keys it needs explicitly - availability, tiers, table choice - rather
than looping over everything `asked_essential_keys` returns, so a missing name is invisible to the
solver.
Stored applications are not re-validated, so they keep assigning.
The validator requires a name on new saves only.

### `FormHasFieldsGuard` has to be adjusted or it dies

The guard fails only when `custom_fields == 0 and essential_questions == 0`.
A name asked unconditionally means the essential count is never zero, so **the guard could never
fail again** - and its docstring states what it protects: "a market with no dates, no tiers and
fewer than two sections genuinely asks nothing, and is genuinely blocked".
That is the last thing stopping an organizer opening applications on a market with nothing to
assign.

**The guard counts only plan-derived essential questions**, excluding identity, so it keeps meaning
exactly what it means today.

Noted for whoever touches it next: the honest shape is to rename the guard for what it actually
protects - the market plan offers something to apply for - because "does the form ask anything" was
always a proxy for that. Not taken here; rewriting a precondition is a bigger act than this ticket
should carry, and the two are not in conflict.

### On screen: name primary, email secondary

Every surface that shows a vendor shows the name first and the email beside it.
Not the name instead of the email: two vendors can share a name, the email is guaranteed unique and
guaranteed present, it is what check-in matches on, and it is what ties a vendor back to their CSV
row. At a door someone is reading it off a phone.

A market whose applications carry no name **falls back to the email and looks exactly like the
product does today** - so this can ship without making any existing market look worse, and no
vendor is ever decorated with "Unnamed vendor".

The vendor search currently reads "Filter by email..." and must match both and say so.

### Consequences elsewhere

- **The importer gains a target for free-ish** - `import_targets` builds from a hardcoded
  `essential_order` tuple, so the key is added there. `Full Legal Name` then maps straight to it.
- **`E08/F02`'s "Still to do" is closed by this** on the business-name half, which is what
  graduated here. The price half remains out of scope.
- **The vendor date card** (`E12/F02/S01`) shows a vendor's name in its heading rather than an
  email address.

Buildable work: `.scratch/backlog/E13-a-vendor-has-a-name/`.
