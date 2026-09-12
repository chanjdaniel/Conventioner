---
id: E01/F03/S01
title: Persist the mapping and pre-fill it on re-import
type: story
status: done
blocked_by: [E01/F02/S02]
pr: [#58]
---

## What to build

A second import opens with last time's mapping already applied, so the organizer confirms rather than redoes.

The mapping is stored on the market. On re-import it is restored and each restored decision is marked as such, so the organizer can see what was assumed. Headers that changed or vanished since the last import are flagged rather than silently re-matched by position - a column that moved is a column that would otherwise be mapped to the wrong target without a word.

## Acceptance criteria

- [ ] A completed import stores its column mapping, and any value resolutions, on the market
- [ ] A subsequent import restores them and marks each restored decision visibly
- [ ] A header present last time and absent now is flagged, and its target shown as unserved
- [ ] A header that is new since last time is flagged as unmapped rather than guessed
- [ ] Matching is by header text, never by column position
- [ ] The organizer can override any restored decision
- [ ] Backend tests cover: unchanged headers, a renamed header, a removed header, an added header
- [ ] An e2e story imports twice and asserts the second run opens pre-filled

## Notes

This decision is what made the column-ledger layout win the prototype: a pre-filled ledger is scannable, so the eye goes to the exceptions. Both assignment-driven variants opened with nothing left to assign and their central affordance invisible. Keep the restored state legible - it is the layout's whole justification.
