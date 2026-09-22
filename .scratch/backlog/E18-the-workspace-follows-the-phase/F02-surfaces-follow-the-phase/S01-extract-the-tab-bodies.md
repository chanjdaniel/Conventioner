---
id: E18/F02/S01
title: Extract the four tab bodies into components
type: story
status: ready
blocked_by: []
pr: []
---

## What to build

Nothing changes for an organizer.
This is the prefactor that makes every later story in this epic small: "make the change easy, then make the easy change."

The market workspace view is one file of roughly 1300 lines - 490 of script, 390 of template, 430 of style - holding all four tab bodies inline along with plan autosave, form saving, the assign action and the Discord webhook row.
Each tab's content becomes its own component, and the view becomes a thin container that chooses between them.

The DOM an organizer sees, and every `data-testid` on it, is unchanged.

## Why it has to come first

Fifteen end-to-end specs drive this view by tab.
Without this extraction, `S02` is a whole-file rewrite **and** a fifteen-spec migration in one sitting, which is more than one context can hold and more than one reviewer can check.

## Acceptance criteria

- [ ] Each of the four tab bodies - the application form, the plan, applications, assignment results - lives in its own component.
- [ ] The view that remains is a container: it chooses which body to render and owns the state genuinely shared between them, and nothing else.
- [ ] Where state is shared - the market, the plan object and its autosave, the form and its save status, the assign action - it is passed explicitly rather than reached for, so a later story can move a body to a different parent without rewriting it.
- [ ] **No `data-testid` is added, removed or renamed**, and the rendered DOM structure is equivalent.
- [ ] Every existing unit test passes unchanged - in particular the plan autosave, form, phase-advance and assignment-options tests.
- [ ] **All fifteen e2e specs that drive this view pass with no edits.** If any spec needs a change, the extraction has altered behaviour and has gone too far.
- [ ] `npm run format:check`, `npm run lint:css` and the type check pass.

## One thing that should already be gone

If `E18/F05/S01` has landed, the Discord webhook row is no longer on the plan and there is that much less to extract.
If it has not, **do not extract the row into a component that is about to be deleted** - leave it where it is and let `F05/S01` remove it.

## Explicitly out of scope

Do not change layout, do not fix any styling, and do not alter what any tab shows.
A styling fix bundled into this story is a styling fix nobody can review, because the diff is already large and mechanical.
