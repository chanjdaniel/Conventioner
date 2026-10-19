---
id: E33/F01/S01
title: The tab is a sequence of steps
type: story
status: ready
blocked_by: []
pr: []
---

## What to build

The Application Form tab becomes four steps, each taking the whole width:

1. **Essential questions** - read-only, saying what every applicant is asked and why.
2. **Your questions** - the form builder.
3. **Preview** - the form exactly as an applicant sees it, full width, inside the tab. Not a new browser tab: a draft has no public page to open.
4. **Review setup** - what a reviewer reads first (and, from `F03`, the automatic rejections).

A step header names all four and can be clicked at any time; Next and Back move one step.
Saving works as it does today; moving between steps never loses unsaved work.

## Acceptance criteria

- [ ] The builder and the preview are never side by side.
- [ ] Next and Back move one step; the header reaches any step.
- [ ] Moving between steps keeps unsaved edits.
- [ ] Each step and control is named, and the step header says which step is current to assistive technology.
- [ ] The application-form and every-control-is-named specs walk all four steps.
