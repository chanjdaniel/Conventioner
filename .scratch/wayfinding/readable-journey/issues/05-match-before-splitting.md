# 05: Can the importer match against the offering before it splits?

Type: grilling
Status: resolved
Blocked by: -

## Question

Multi-value columns are split on commas, unconditionally, with no way to change it.
Google Forms date labels contain commas.

A cell reading `"Saturday, November 21, 2026; Sunday, November 22, 2026"` becomes six fragments: `Saturday`, `November 21`, `2026; Sunday`, `November 22`, `2026`, `Sunday`.
All six are then reported as "did not match your market" and the organizer hand-maps each one, four of them to "Ignore this value".
The mapping screen states "values split on commas" as a fact, which it is; what it does not say is that this guarantees a Google Forms multi-date column will shred, on the screen that says "Bring in the responses your Google Form collected."

**The insight worth testing** is that splitting happens *before* matching, when matching could inform the split.
The product already knows the exact set of valid strings for that target - it is the offering, and it is what populates the resolution dropdown.
Greedily matching those labels against the raw cell finds both dates exactly and leaves `"; "` as the residue.

The options:

1. **Detect the separator per column** - if every cell contains `;`, split on that.
2. **Let the organizer choose the delimiter** on the mapping row.
3. **Match before splitting** - match the offering's labels against the raw cell, split only the remainder.
4. **Leave it** and document that multi-value columns must be semicolon-free.

(3) needs no configuration and no guessing, but it has a real failure mode: **one offering label being a substring of another**.
This product lets organizers name tiers and sections freely, so `Gold` inside `Gold Plus` is not hypothetical.
Longest-match-first handles the simple case; whether it handles every case an organizer can create is what this ticket has to establish, and it may conclude (1) is enough.

**Not part of this ticket** - two adjacent import problems that are plain bugs and are `E09` work:

- Table choice values are compared against the stored key (`full`) rather than the label the applicant saw, so `A whole table to myself` is reported unmatched and resolvable only to the identical string.
- The resolution dropdown offers market dates as `2026-11-21`, a format the product shows the organizer nowhere else.

**Also verified and not a bug**, so that no session re-opens them: the limited auto-mapping is a documented decision in `suggested_mapping()` with a stated rationale, and the absence of a "Section preference" import target is correct for a market with one section, because a ranking of one is not asked.

Report finding: **H3**.

## Answer

**No - do not match before splitting. Detect the ambiguity and say so.**

### The finding was mostly self-inflicted

The importer has two shapes, and `_raw_values` branches on how many columns map to a target:

- **A grid** - several columns, one per option, the option carried in the header.
  **No splitting happens at all.**
- **A single column** - one column whose cell is comma-split by `_split_multi`.

**The real Fall 2025 export uses the grid.**
Columns 20-24 are five columns sharing one stem, each carrying a date in brackets, with tiers in the
cell (`_tier_grid`). The date comes from the header; the only comma-split is on tier names, which
contain no commas.
The organizer's actual file never hits this bug.

The fixture that produced the finding was mine: a single column holding
`"Saturday, November 21, 2026; Sunday, November 22, 2026"`, which is not a shape Google Forms
produces for that question.
The previous map warned that synthetic fixtures hide blockers; this is the mirror image, where a
synthetic fixture invented one.

### But the failure mode is real, and unparseable in principle

A Google Forms **checkbox question** - not a grid - exports one column with the selected option
labels **comma-joined**.
If those labels contain commas, and `Saturday, November 21, 2026` does, the export is ambiguous.
Not ambiguous to this product: ambiguous to any reader, because Google threw the information away.

So the case cannot be parsed correctly. It can only be detected.

### Detect, warn, and let the existing screen do its job

**When a target's offering contains any label with a comma, and the column mapped to it is a single
comma-split column, the product cannot know what the cell means - and says so at the mapping step.**

Not greedy matching against the offering, which was this ticket's hypothesis.
That is a parser guessing at ambiguous data, and it has the substring problem the ticket already
named: organizers name tiers and sections freely, so `Gold` inside `Gold Plus` breaks longest-match,
and the failure is silent and wrong rather than loud and right.

**It warns rather than blocks.**
The value-reconciliation screen already refuses to advance until every unmatched value is resolved
by hand, so nothing wrong imports silently either way.
Blocking would strand an organizer whose only copy of the data is that file.
A warning naming the cause - the date labels contain commas, so this column cannot be split
reliably - turns nine mystery fragments into an explained choice, and the organizer's fixes are real
ones: re-export as a grid, or rename the options.

### What survives untouched from the original finding

**The reconciliation dropdown offers ISO dates.**
It lists `2026-11-21`, a format the product shows the organizer nowhere else - every other surface
says `Saturday, November 21, 2026` or `Nov 21, 2026`.
Independent of everything above, true on the path every CSV market walks, and one line.
It belongs to `E09/F04/S02`, which already owns canonical date rendering.

**Table choice compares against the stored key.**
`A whole table to myself` is reported unmatched and the only correct resolution offered is the
identical string, because the comparison is against `full`.
Entirely unaffected by any of this; already `E09/F04/S01`.

### Already verified as correct, so no session re-opens them

- The limited auto-mapping is a documented decision in `suggested_mapping()` with a stated
  rationale.
- The absence of a "Section preference" import target is correct for a market with one section: a
  ranking of one is not asked.

Buildable work: `.scratch/backlog/E09-legible-screens/F04-copy-and-naming-tell-the-truth/`.
