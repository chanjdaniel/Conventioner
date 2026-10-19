---
id: E33/F01/S01
title: The tab is a sequence of steps
type: story
status: in-progress
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

## As built

- `MarketFormTab` holds the step; `components/StepHeader.vue` draws the header, a named `nav` whose current step is `aria-current="step"`.
- Back and Next move one step and start it at the top of the page.
- The steps on each path are the guide's (`formSteps` in `utils/marketGuide.ts`).
- Save Form sits on Your questions and on Preview; the status of any save shows on every step, since Ask this on the essentials saves the moment it is ticked.
- The preview is drawn at the applicant's own column width (`--applicant-max`, which the apply page reads too).
- The essential questions panel lost its own heading, which the step's title now gives.
- A spec opens the step it asserts on through `ApplicationFormPage.openStep`.

## Acceptance criteria

- [x] The builder and the preview are never side by side.
- [x] Next and Back move one step; the header reaches any step.
- [x] Moving between steps keeps unsaved edits.
- [x] Each step and control is named, and the step header says which step is current to assistive technology.
- [x] The application-form and every-control-is-named specs walk all four steps.
