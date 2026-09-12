---
id: E01/F02/S04
title: Resolve unmatched cell values
type: story
status: done
blocked_by: [E01/F02/S02]
pr: [#56]
---

## What to build

A cell saying `Gold Tier` resolves to the market's tier named `Gold`, without the organizer editing their spreadsheet.

Section, tier, and table-choice answers arrive as the organizer's own free text and must match the market's configured names exactly or the solver sees nothing. Values that match are accepted silently; the organizer is shown **only** the ones that could not be placed, and maps each to a configured value.

The fixes appear in the row that owns them, not in a separate panel away from the column they concern.

## Acceptance criteria

- [ ] Values matching a configured name are accepted without asking
- [ ] Only unmatched values are surfaced, each with the count of rows affected
- [ ] An unmatched value can be mapped to a configured value, or explicitly ignored
- [ ] Unresolved values block the import and say so plainly
- [ ] Resolutions are applied consistently to every row carrying that value
- [ ] Matching tolerates incidental whitespace and case differences before declaring a mismatch
- [ ] Backend tests cover matched, unmatched, and resolved-then-imported cases
- [ ] An e2e story imports a CSV containing a mismatched value and resolves it through the UI

## Notes

The distinct values in a column are a small enumerable set, which is what makes this cheap: the organizer audits three values rather than forty rows.

Whether value resolutions are stored alongside the column mapping for re-import is decided in F03/S01. Keep them in a shape that can be persisted.
