---
id: E01/F01/S03
title: Stub table type to a single type
type: story
status: done
blocked_by: []
pr: [#51]
---

## What to build

Table type stops deriving from the market's latest floorplan, and the applicant is not asked to rank a list of one.

Table type is a property of an **individual table, not of its section** - any table in any section may be any type - so only a floorplan can truly describe it, and the floorplan GUI is out of MVP scope. Until it ships, a market has one table type.

The field and the solver's eventual handling of it stay in place. Only a real offering is missing. This is a deliberate stub, not an oversight.

## Acceptance criteria

- [ ] Table type no longer derives from the latest floorplan
- [ ] A market's offering is a single hard-coded table type
- [ ] The table-type question is not asked when fewer than two types exist, and stores its empty value
- [ ] The suppression rule generalises the existing empty-offering behaviour rather than special-casing table type
- [ ] The organizer's essential-questions panel does not present an empty or single-option ranking
- [ ] The shared market contract declaration is regenerated
- [ ] Backend tests cover: no types, one type, and two or more types offered

## Notes

The existing behaviour already suppresses a question whose offering is empty; extending that to "fewer than two options" reads correctly for the real case too, since a market with genuinely one table type has nothing to ask.

Removing the floorplan derivation also removes a fragile coupling: the offering depended on *the latest* floorplan, and saving a floorplan overwrites sections.
