---
id: E32
title: Every step leads to the next
type: epic
status: ready
blocked_by: [E31]
pr: []
---

## Outcome

On each intake path, the organizer always sees one obvious next step.
While it cannot be taken, the main button is the work that unblocks it; once taken, it lands the organizer on the page where the next step's work happens.
The Google Form path reads as its own sequence, Plan, Import, Review, Assign, Market days, and a Google Form market shows no applicant surface at all.

## Why now

The [2026-10-19 brain dump](../../brain-dump/2026-10-19.md), a manual UX/UI pass: E31 made the rail say what to do, but every forward step still leaves the organizer where they were (Begin Review, Begin Assignment, Publish), the Google Form path asks for "Start Collecting" and "Done Collecting" from an organizer who already holds the responses, and the review still offers an import the server refuses.
Settled in the same day's grilling (decisions 1-4, 19, 20, 26, 31 in the dump).
Builds on E31's guide table and rail, so it starts once E31 merges; it is feature work, so it waits for the November 2026 market window to close (2026-11-21).

## Features

- `F01` - each move lands where its work is.
- `F02` - the Google Form path reads Plan, Import, Review.
- `F03` - a Google Form market has no applicant surface, and the sign-in code is sent.

## Order inside this epic

`F01` first: `F02`'s "Import responses" is a move that lands on the import, and the blocked-step button is `F01/S02`.
`F03` is independent of both.

## Out of scope

- The server's phases and transition table: unchanged. The Google Form path is a different face on the same phases.
