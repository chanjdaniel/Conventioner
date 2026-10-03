# 05: What does the dialog tell you before you override a vendor's answer?

Type: grilling
Status: resolved
Blocked by: -

## Question

`E11/F03/S01` says a change that alters a vendor's answer says so **before** it is made, and it does - for two of the three ways a hand placement can contradict an application.

Placing Dev Patel - available 2026-11-22 only, "number of dates you want: 1" - into Front Row 3 on 2026-11-21:

| what the placement overrides | said? |
| --- | --- |
| "They did not say they were available on this date." | warned |
| "They asked for a whole table. This gives them half of one." | warned |
| Dev now holds **two** seats against a stated ceiling of **one** | silent |

The warning could not have been written: `GET /markets/:id/tables` sends `{email, availableDates, tableChoice}` per vendor and leaves `maxDates` out, so `placementWarnings()` has nothing to check.

The same dialog has a second problem at the other end.
On Saturday 21 November the **only** candidate the dropdown offered was Dev Patel - the one applicant who had said he could not attend that day.
Every vendor who *was* available was correctly excluded for already holding a seat.
The list is "applicants minus those already seated on this date"; availability arrives afterwards, as a warning.
On a market of 200 vendors it mixes the two freely.

### What to decide

These are one question because they are the same moment in the same dialog: **what the organizer is shown, and told, at the instant they override an applicant's stated answer.**

**On the ceiling.**
Overriding is allowed by design - ticket 08 on the previous map settled that admins edit without restriction, and the solver honours the ceiling while the hand path is free of it.
So the decision is not whether to permit it but whether it joins the warned set, and if so what it says.
Worth checking whether there is a fourth: the market-wide `max_assignments_per_vendor` is a different ceiling from the vendor's own `essential_max_dates`, and a hand placement can cross either.

**On the list.**
Mark, group, sort down, or filter with a reveal.
The constraint is that overriding must stay *possible* - hiding the unavailable would make the deliberate override unreachable, which is the opposite of what ticket 08 decided.

A question that may collapse both: **is the candidate list the right shape at all?**
It is a `<select>` of every unplaced applicant. At 200 vendors that is a 200-item dropdown whether or not it is grouped, and the organizer usually already knows who they are placing.

### Notes

Do not re-open whether an override is allowed - settled, and the warnings plus the marking on the vendor's date card are the agreed mechanism.
This is about completeness and legibility of that mechanism, not its existence.

Findings: F9, F10 in `.lavish/qc-2026-09-20.html`.

## Answer

Decided 2026-10-02, with the user. Built as [E26/F05/S03](../../../backlog/E26-the-user-flows-hold/F05-placements-tell-the-truth/S03-overrides-are-warned.md).

**Every answer a hand change can cross is said before it is made, and the list is grouped, never filtered.**

### On the ceiling, and what else joins the warned set

Both ceilings join, as separate sentences, because they are separate promises:

- "This gives them 2 dates; they asked for at most 1." - the vendor's own answer.
- "This gives them 2 dates; the market allows at most 1 per vendor." - the organizer's rule for everyone.

The usage run of 2026-09-30 found a third missing warning, and it is the one that costs money: **tier** (bug 32).
"They did not accept the Silver tier on this date, which sets their price." is said on the same terms as `placement_reasons._overrides_of` - only on a date the vendor offered, since a date they never offered carries no tier answer.

A **swap** warns too, for each of the two vendors (bug 18), but only about what a seat can override: its tier and its size.
A swap trades tables on one date, so it never changes whether a vendor is there that day or how many dates they hold.

### On the list

**Group**, as two `<optgroup>`s in the existing `<select>`: "Fits this seat", then "Would override their answers".
A vendor fits when placing them overrides nothing; on a table that is wholly free, a sharing vendor fits, because the organizer can give them half of it.
Overriding stays one pick away, which is what ticket 08 of the previous map requires.

A searchable picker was weighed against the 200-vendor case and not taken: it is a shared control the product does not have, and a native `<select>` already jumps to a name as it is typed.
Revisit it only if a real market shows the grouped list is unworkable.

The dialog moved to `AppDialog`'s `wide` size: a real name and address, with a table and a side, did not fit in 26rem.
