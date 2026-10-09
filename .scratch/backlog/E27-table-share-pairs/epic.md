---
id: E27
title: A table-share request finds its partner
type: epic
status: done
blocked_by: []
pr: []
---

## Outcome

Two applicants who asked to share a table are seated together whenever the market's rule allows it, whatever words the request was written in.
A request that can pair nobody is shown to the organizer instead of quietly becoming a stranger pairing.

## Why now

The November 2026 rehearsal ([Map: November 2026 dry run](../../wayfinding/november-2026-dry-run/map.md)) measured the real export: of 55 table-share answers, only 29 can pair today.
Four give the address in different case and eight put it inside a sentence; the solver compares the stored text exactly, so all twelve pair nobody.
The solver also never checks the partner's own table choice, so a vendor who wants a full table can be put on half of one.

The rules were decided with the user on 2026-10-09 in [08: How is a table-share request read?](../../wayfinding/november-2026-dry-run/issues/08-how-table-share-pairs-are-read.md), which is the authority for every story here.
The rehearsal waits on this epic, so that it walks the pairing the market wants.

## Features

- `F01` - the pairs the market asked for.
