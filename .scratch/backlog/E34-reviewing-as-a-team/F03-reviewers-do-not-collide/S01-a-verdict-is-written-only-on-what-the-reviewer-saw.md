---
id: E34/F03/S01
title: A verdict is written only on what the reviewer saw
type: story
status: done
blocked_by: []
pr: [#111]
---

## What to build

A verdict carries the status the reviewer saw, and is written only if the application still has it.
Otherwise nothing is written, and the reviewer is told who changed it and to what, with the application refreshed so they can decide again.

## As built

- The review sends `seen` with every verdict: the status, the verdict time and the answers' time (`updatedAt`) it showed.
  `review_application` writes through `update_application_status(if_unchanged_since=seen)`, the conditioned write the automatic rejections use too.
- A refused verdict answers 409 with who changed it and to what, and the application as it stands.
  The words are "alex@market.test approved this application since you opened it.", an automatic rejection's, "Its answers changed since you opened it." for an applicant's edit or a re-import, or plainly "changed".
- The review keeps that application on the card, as it stands, saying so, until the reviewer decides again or presses Back to the queue.

## Acceptance criteria

- [x] Two verdicts on the same application from two sessions: the first is written, the second is refused and names the first's giver.
- [x] A refused verdict leaves the reviewer on that application with its current status shown.
- [x] Covered by a back-end test of the race and an E2E spec with two organizer sessions.
