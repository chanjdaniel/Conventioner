# 06: Which path, and how far?

Type: grilling
Status: resolved
Blocked by: 03

## Question

Which route through `docs/USER_FLOWS.md` does the run take, and where does it stop?

- **Intake:** P2 (start the market from this file's Google Form, then import the same file) or P1 (build the form by hand, then import). P2 is the path built for exactly this file and the one the organizer would take.
- **Rules:** which priority rules decide who is placed when demand exceeds tables: first come first served on the timestamp, club membership (one of the organizer's questions), current students before alumni, or something else.
- **The end:** stop at the assignment; or go on to publish, walk the three market days through check-in on a phone, and archive. Archiving is final for that market, but only in the local database.
- **Online stragglers (P4):** add a late vendor through the market's own page, with an invented address, or leave online intake out.
- **Re-import:** import a later export of the same form over the first (the real organizer will), or not.

**Recommendation:** P2, first come first served unless the organizer has a rule, through publish and a simulated market day, no archive, and one re-import of the same file to check it is idempotent.
P3 and P4 were walked on 2026-10-03 and this file adds nothing to them.

## Answer

Decided with the user on 2026-10-09.

- **Intake: P2.** Start the market from this file (the CSV proposal), confirm, then import the same file.
- **Every one of the 212 rows must import.** On the proposal, every trimmed question is kept whole ("keep all"), so no applicant loses their only answer. Any row the import refuses stops the run: it is recorded and brought to the user to decide.
- **Re-import:** the identical file is imported a second time; nothing may change (no duplicates, verdicts kept).
- **Priority rules, in order:** current UBC students before alumni and staff; then members of any listed club (AMS Artelier, UBC Ani, UBC PRINT Arts and Crafts, VASA, all equal) before non-members; then first come, first served on the timestamp.
  The solver's built-in "fewest dates so far go first on each date" stays ahead of the rules: the user confirmed spreading tables across vendors is the market's real behaviour.
- **The end:** assign, publish the results, publish the market, then walk check-in on a phone for **all three days** (typing vendors' addresses into the local check-in page, which sends nothing), and read Attendance. No archive.
- **Online intake (P3, P4) is not walked**: it was walked on 2026-10-03 and this file adds nothing to it.
