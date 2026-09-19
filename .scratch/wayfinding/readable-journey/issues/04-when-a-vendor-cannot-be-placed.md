# 04: What does the product say when a vendor cannot be placed?

Type: grilling
Status: resolved
Blocked by: -

## Question

The payoff screen lists unassigned vendors by email under a heading and says nothing else.

In a run I walked: 5 applications, 5 approved, **3 assigned, 19 of 24 table-slots free, 2 vendors unplaced**.
Nineteen empty tables and two people who could not be given one, with no explanation of the contradiction anywhere on screen.
The reason was that both asked for Silver and the market's only section is Gold - a **planning** mistake made three screens earlier, surfaced as an assignment outcome.

**The solver does not know why.**
`get_assignment_statistics` builds `unassigned_vendors` as a list of email strings from `num_assignments == 0`.
`best_table_for` returns bare `None` when `is_valid_vendor` has emptied the candidate list.
The reason is knowable - `is_valid_vendor` is the filter that excluded every table - but nothing captures which clause rejected, or on which date.
So this ticket designs new structure rather than surfacing existing structure.

Three depths, and the choice is not obvious:

1. **A count per date** - "no table available on 21 Nov".
   Cheapest and frequently wrong: there were nineteen.
2. **The clause that excluded them** - "no Gold table on any date they chose".
   Requires `is_valid_vendor` to report which check failed, per (vendor, date, table).
3. **A full diagnosis including the near miss** - "wanted Silver; this market has no Silver section".

The trap is that (3) is what my single run needed, and my single run is also the most flattering case for the most expensive option.
**A tier that exists in the plan but in no section is arguably a planning-time warning, not an assignment-time one.**
If that is right, (2) plus a validator on the market plan beats (3) and costs less, and the Per Tier panel showing Silver at zero rather than omitting it would have told the story before the solver ran.

So the ticket's real question is: **which failures does an organizer need to distinguish, and which of them should never have reached the solver?**

Report finding: **H5**.

## Answer

**Four reasons, computed on read, shown on the vendor's own date cards - and the worst case is
caught before the solver ever runs.**

### The ticket's premise was wrong, in a useful way

This ticket said the solver keeps no reason and therefore "designs new structure rather than
surfacing existing structure".
The first half is true; the conclusion is not.
**No solver code changes.**

`is_valid_vendor` has exactly five clauses, and two of them - `is_vendor_max_assigned` and
`is_date_assigned` - describe a vendor who already holds tables, so they cannot apply to an unplaced
one.
`best_table_for` filters on `not table.assignment` before any of them.
And table choice is not a rejection path at all: it runs in `get_valid_vendors` *after* a table is
chosen, deciding whether one vendor or two occupy it.

That leaves a closed set of three, all of which are **derivable after the fact** from the
application, the assignment and the plan.

### The reasons

Per `(vendor, date)`, an enum - so the wording lives in the front end and changes without a
migration:

- **Not available** - they did not tick that date. Their answer, not a failure.
- **No table of a tier they accept** - the plan has no section at any tier they named.
- **The tables they accept were taken** - such tables exist and none is free.
- **Free, and they could be placed** - such tables exist and one *is* free.

The fourth exists only because the reason is computed rather than recorded, and it is the one that
turns a report into an action.

### Computed on read, not recorded during the run

A recorded reason is a fact about a moment, and it goes stale the instant the plan changes - or, more
pointedly, the instant a manual placement lands, which
[08](08-where-a-manual-placement-lives.md) is about to make possible.
A vendor recorded as "tables were taken" who is now looking at a free seat because an organizer
unplaced someone is being told something false.

A computed reason is always true of the current state.
It also leaves `assign()` and `back-end/tests/test_assignment_behaviour.py` alone, which is worth
something on the one part of this codebase that had no behavioural suite before E02.

### Partial placements are covered

Not only vendors with `num_assignments == 0`.
A vendor who asked for two dates and got one is shown a bare em dash under the date they missed, in
the same green-bordered card as the dates they got.
"Why did I not get Sunday" is the same question, asked by someone the product currently answers with
punctuation.
The reason is computed per date either way, so covering them costs nothing.

### A tier with no tables is caught before the solver runs

Sections are a flat list carrying a tier each, and tables are generated from sections, so **a tier
with no section has no tables on any date**.
That is a property of the plan alone - no applications, no assignment needed.

- **A warning in the plan editor, always.** An empty tier nobody asked for is harmless; an organizer
  mid-build has one constantly.
- **A blocker on `-> assignment` when an approved applicant asked for that tier.** Five approved
  applicants wanting Silver in a market with no Silver tables is five guaranteed rejections, and the
  organizer is about to press Assign without knowing.
  Blocking is the difference between preventing the mistake and reporting it.
  It is an entry in `guards.py` and nothing new in the UI, since `BlockerPanel` renders
  `PreconditionResult` generically.

This is the case that produced the finding: 5 approved, 3 placed, **19 of 24 tables free**, two
vendors unplaced because they asked for Silver and the market has only Gold.
Under this answer they never reach the solver.

### One surface, three states

The vendor detail panel's **per-date cards**, which already exist and already have the hole in them.
Today each shows a date and a placement, or a date and a bare dash - and gives both the same green
left border, so an unplaced date looks placed at a glance.

It becomes one component with three states:

1. **Placed.**
2. **Placed against their stated preference** - the pin override from
   [08](08-where-a-manual-placement-lives.md).
3. **Not placed, because —** one of the four reasons.

That settles something 08 left implicit: **the override marking is not a separate feature with its
own UI.** It is the second of three states on a card this ticket is already rebuilding. Build the
card once.

The payoff screen's "Unassigned Vendors" panel stops being a list of bare email addresses and
becomes the way into that panel.

### Not this ticket

`Per Tier` omitting a tier with no assignments, and `Satisfaction Score` having no definition, are
`E09/F06/S02`.
They share a screen with this and nothing else.

Buildable work: `.scratch/backlog/E12-say-why/`.
