---
id: E31/F03/S04
title: Each path offers only its own actions
type: story
status: in-progress
blocked_by: [E31/F02/S02]
pr: []
---

## What to build

- **Import is the CSV path's.** A form market shows no "Import from CSV", and the import endpoints refuse a form market.
- **Publish Results is the form path's**, a secondary action on Applications from the first decision on, with "Tells every decided applicant their verdict on their application page". The rail never names it.
- **Review is rolling, and says so**: in `applications_open` the statement is "Review applications as they arrive"; the review phase says "Nothing more is coming in - finish deciding".

## Acceptance criteria

- [x] A form market cannot import, through the UI or the API.
- [x] Publish Results appears only on form markets, with its line.
