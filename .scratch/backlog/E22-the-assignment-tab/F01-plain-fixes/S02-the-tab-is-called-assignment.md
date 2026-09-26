---
id: E22/F01/S02
title: The tab is called Assignment
type: story
status: done
blocked_by: []
pr: [#83]
---

## What to build

A market's fourth tab reads **Assignment**, not "Assignment Results".

`CONTEXT.md` defines Assignment as the solver's output, so "Assignment results" named one thing twice; the glossary now lists it under _Avoid_.
The label, and the names in tests and docs that repeat it, follow the glossary.
The component and page-object names that describe the *result* (as opposed to the tab) are left for the split, which decides whether a "result" page exists to name.

## Acceptance criteria

- [x] The tab's label is "Assignment" on every market, in every phase.
- [x] Tests, the page objects' tab accessors and the docs that name the tab say "Assignment"; nothing user-facing says "Assignment Results".
- [x] The retired `/assignment-results` path still redirects to the markets list.
