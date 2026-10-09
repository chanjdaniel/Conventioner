# 04: What is the market's real plan?

Type: grilling
Status: resolved
Blocked by: 03

## Question

The file says the dates and the tiers.
It does not say what the market has to give, and the solver cannot run without it:

- **Locations and sections**: one room (the AMS Nest) or several; how the sections are named.
- **Tables per tier, per section**: how many Gold and how many Silver, and whether that differs by day.
- **Half tables**: the form says a half table costs half and may be shared with a stranger. What share of tables may be split, and is "Either" placed as full first or half first?
- **Market ceiling** (`max_assignments_per_vendor`): none, or a number below 3.
- **Whether any day is at risk**: the form warns days can be cancelled. Plan all three, or rehearse a cancellation too?

If 03 says product test, a stand-in plan is enough and this ticket closes with it written down.

## Answer

Decided with the user on 2026-10-09.
The layout is the one the Spring 2025 table allocation used (`.scratch/examples/attendance/`, git-ignored), the same on all three days:

| Section | Location | Tier | Tables |
| --- | --- | --- | --- |
| A | Lower atrium | Gold | 53 |
| B | Level 1 - North | Silver | 37 |
| C | Level 1 - Centre | Silver | 6 |
| D | Level 1 - South | Silver | 5 |

101 tables a day: 53 Gold, 48 Silver.

- **C and D are Bronze in reality, planned as Silver.** The November form offers only Gold and Silver, and tier is a hard filter, so Bronze tables would sit empty every day; the user ruled that Silver applicants take them.
- **Section names are the letters**, so table codes come out A1 to A53, B1 to B37, C1 to C6 and D1 to D5, matching the organizer's own sheet.
- **Half tables:** the plan leaves the setting unset, and the solver's 30% per section applies.
- **No market ceiling:** each vendor's own "maximum number of days" (1 to 3) is their limit.
- **All three days are planned**; no cancellation is rehearsed.
