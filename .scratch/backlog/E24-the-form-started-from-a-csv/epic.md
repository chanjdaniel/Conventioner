---
id: E24
title: The form started from a CSV
type: epic
status: ready
blocked_by: []
pr: []
---

## Outcome

An organizer who already collects applications with their own Google Form uploads its responses CSV and gets a market set up from it: the plan's dates and tiers, the ceiling on days per vendor, an application form that asks what their form asked, and the mapping their later import will use.
Each is a **proposal** they review in one ledger, in their file's order, and nothing is written until they confirm; the first import of that form's responses then opens already mapped.

## Why now

From the 2026-09-26 brain dump: today a CSV-intake organizer retypes their Google Form's questions into ours so the import has somewhere to put each column, then maps every column again at import.
Saying what each column is should happen once.

Charted in [the-form-started-from-a-csv](../../wayfinding/the-form-started-from-a-csv/map.md).
The map is closed: every question is resolved there, with the measurements behind them, and the four features below are the whole of the work.
The decisions live in the map's tickets; each story links the ones it rests on.

## Features

- `F01` - the corpus as fixtures: five anonymised Google Form exports every test here reads. Startable now.
- `F02` - the proposal: the server reads a CSV and proposes what each column is and what the plan is, with the rules and, when a key is configured, hosted Jev for the two judgements the rules leave.
- `F03` - review and confirm: the proposal ledger, and one confirm that writes the plan facts, the form, the ceiling and the import mapping.
- `F04` - where it starts: "I already have a Google Form" at market creation, and an action on a draft's Market Setup.

## Order inside this epic

`F01/S01` first: every later story tests against its files.
`F02` runs `S01`, then `S02`; `S03` needs `S01`.
`F03` runs `S01`, `S02`, `S03`, after `F02/S01` and `F02/S02`; it does not wait on `F02/S03`, since hosted Jev only turns some "check this" marks off.
`F04` follows `F03/S01`, which gives it somewhere to land.

## Out of scope

Settled on the map: carrying the organizer's old review decisions over (a relic column, left out), proposing priority rules, and writing text (help text and labels are the Google Form's own words).
A local model is not part of this epic; Kev-0.8B is bookmarked on [04](../../wayfinding/the-form-started-from-a-csv/issues/04-does-a-model-beat-the-rules.md) should one be wanted.
