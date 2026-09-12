---
id: E01/F02/S02
title: Import a CSV whose targets map one-to-one
type: story
status: ready
blocked_by: [E01/F02/S01]
pr: []
---

## What to build

The tracer bullet for the whole epic: an organizer uploads a Google Forms CSV, maps each column to the question it answers, confirms, and sees the imported vendors as applications awaiting review.

Deliberately narrow so it can land whole. This story handles a CSV where **every target is served by exactly one column** - the shape a Google Form produces when each question is asked once, with multi-answer questions exporting as one comma-separated column - and where **every cell value already matches the market exactly**. Checkbox grids and mismatched values are the next two stories.

The flow is upload, map, preview, confirm, laid out full width rather than in a dialog. The mapping screen lists one row per CSV column in file order, each with a "Maps to" control, alongside a running account of which required targets are still unserved. A required target left unmapped means nothing imports.

## Acceptance criteria

- [ ] An organizer reaches the import flow from the market's applications area
- [ ] Uploading a CSV shows every column in file order with sample values from the first rows
- [ ] Each column can be mapped to an essential question, a custom form field, `submitted_at`, or left ignored
- [ ] The `Timestamp` column is auto-detected as `submitted_at`, and an unmapped `submitted_at` warns rather than blocks
- [ ] Confirming with any required target unmapped imports nothing and says which are missing
- [ ] A successful import creates one `Application` per row at status `open`, through the shared write path
- [ ] Imported applications appear in the organizer's review view and are indistinguishable in shape from form-submitted ones
- [ ] `submitted_at` holds the applicant's real submission time, not the time of import
- [ ] The preview states how many rows will be imported before anything is written
- [ ] Backend tests cover the mapping validation and the created document shape
- [ ] An e2e story drives the whole flow through the real UI and asserts the applications exist

## Notes

`submitted_at` must be genuine: if every row receives the import timestamp they are all identical, and a first-come-first-served priority rule silently does nothing.

**The first import locks the application form.** The D9 lock counts applications, so once any exist the form is frozen - and with it the set of mapping targets. That is coherent, but it means an organizer who imports and then wants one more custom question is stuck. Make sure the flow says so before committing.
