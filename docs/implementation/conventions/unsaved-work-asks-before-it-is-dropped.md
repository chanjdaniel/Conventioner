---
layer: implementation
kind: convention
describes:
  - front-end/src/utils/useUnsavedWork.ts
  - front-end/src/components/UnsavedWorkDialog.vue
  - front-end/src/__tests__/useUnsavedWork.test.ts
  - front-end/e2e/unsaved-questions-ask-first.spec.ts
  - front-end/src/__tests__/theImportAsksBeforeItDropsAMapping.test.ts
  - front-end/e2e/the-import-asks-before-it-drops-a-mapping.spec.ts
  - front-end/src/__tests__/theFloorplanAsksBeforeItDropsADrawing.test.ts
verified: 2026-11-11
sources:
  - T271
  - T244
---

# Unsaved work asks before it is dropped

**A screen that holds work the server does not have yet asks before that work is dropped**, by one call, `useUnsavedWork({ unsaved, sentence, inApp })` ([`useUnsavedWork.ts`](../../../front-end/src/utils/useUnsavedWork.ts)).
A screen whose work an in-app move never drops passes `inApp: false` and no sentence, since only the browser asks for it, in its own words.
The form builder kept unsaved questions in the open tab, and opening Plan, a link or Back dropped them with no word (T271, from the T244 review).

## What counts as leaving

- **A reload or closing the tab**: a `beforeunload` listener, while the screen is mounted, calls `preventDefault()` and sets `returnValue` when `unsaved()` answers true, so the browser asks in its own words; nothing of the app's can be shown there.
- **A move in the app**, with `inApp` (the default): the router's `onBeforeRouteLeave`, and `onBeforeRouteUpdate` for a move to another path of the same route, since Market Setup's pages are one route with a `:page` param.
  It asks while `unsaved()` answers true, and the router reads the answer as "go on" or "stay".
- **Never asked**: a move that changes only the query or the hash, which stays on the work (the form's `?step=`), and a move to the sign-in page (route name `login`): a sign-out and an ended session forget the session before they move, so nothing could be saved from the page any more.

`unsaved` is read when someone tries to leave, never cached, so the screen states its own rule once.
The guards only reach a component a routed view rendered, so a unit test of a screen using them mounts it under a `RouterView` on a real router, or adds `onBeforeRouteLeave` and `onBeforeRouteUpdate` to its `vue-router` mock.

## The question

**One dialog, [`UnsavedWorkDialog.vue`](../../../front-end/src/components/UnsavedWorkDialog.vue), mounted once in `App.vue` beside the routed view**, since the move it answers may unmount the screen that asked.
It is a short [dialog](dialogs.md) on `AppDialog`: title "Leave without saving?", the screen's sentence as its body, "Stay" and a destructive "Leave", `testid` "unsaved-work", the narrow width and `scroll="window"`.
Leave answers "go"; Stay, the close control, Escape and the scrim answer "stay"; being destructive, it opens on Stay.
Focus, the page held inert and focus given back to the control that started the move are the shell's.
`askToLeave(sentence)` holds one question in a module-level `shallowRef`, shallow so the question held is the very one its answer looks for; a second question while one is open answers the first "stay" and takes its place.

## Each screen using it

| Screen                                                                                                            | `unsaved`                                                                          | `inApp` | Sentence                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------ |
| The form builder ([`MarketFormTab.vue`](../../../front-end/src/components/market/MarketFormTab.vue))              | the working copy's fields differ from the fields as last taken from the server     | true    | "Your changes to the form's questions are not saved. Leaving drops them."                                          |
| Market Setup's plan ([`MarketSetupView.vue`](../../../front-end/src/views/MarketSetupView.vue))                   | the plan's autosave holds an edit the server does not, or a save is out            | false   | none: the browser asks in its own words                                                                            |
| The CSV import ([`CsvImportView.vue`](../../../front-end/src/views/CsvImportView.vue))                            | the step is Map columns, or Preview with no import running                         | true    | "Nothing from this file is imported yet. Leaving drops the column mapping and every value you settled."            |
| The floorplan beta ([`FloorplanWorkflow.vue`](../../../front-end/src/components/floorplan/FloorplanWorkflow.vue)) | a floorplan uploaded in this visit of the wizard and not saved to the market since | true    | "This floorplan is not saved to the market yet. Leaving drops the upload, the scale, the tables and the sections." |

The form builder's rule is its own ([building the application form](../../business/flows/form-tab.md#leaving-with-questions-not-yet-saved)): only the fields count, since "Ask this" saves itself as it is ticked and the key flags are intent, never sent; opening a step without an edit, or a form just saved, is not unsaved.
It also reports the flag to Market Setup, whose phase move refuses while it holds.

The CSV import's rule is its own ([importing a Google Form's responses](../../business/flows/import.md#h2a-first-import-everything-maps)): a file read and nothing of it written; Upload holds no file, the done step has written it, and an import running is not stopped by leaving, so none of those asks.
"Cancel import" leaves by the router, so it asks through the same guard.

The floorplan's rule is its own ([floorplan placement](../modules/floorplan-placement.md#sharp-edges)): the upload, the scale, the tables and the sections live in the page until the save, so before an upload nothing asks, and from it on every step does.
The wizard marks the floorplan saved before it hands the save on, so the save's own move back to Market Setup never asks.
The wizard's own Back and Next stay on the route, so they never ask either.

Market Setup's plan asks on unload alone ([the plan's autosave](../modules/plan-autosave.md#the-queue)): an in-app move unmounts the view, whose flush sends the edit, and nothing cancels it.

## How it is enforced

- [`useUnsavedWork.test.ts`](../../../front-end/src/__tests__/useUnsavedWork.test.ts) drives the guards through a real router and `RouterView` with the dialog beside it: the question on a move to another route and to another path of the same route, Stay, Escape, the close and the scrim staying, Leave going, no question on a query or hash change, a move to `login`, nothing unsaved or `inApp: false`; `beforeunload` prevented only while unsaved and never once the screen is gone; and one question at a time.
- [`planAutosave.test.ts`](../../../front-end/src/__tests__/planAutosave.test.ts) holds Market Setup's `beforeunload` prevented only while an edit is unsaved, a failed save included, and [`the-plan-saves-one-at-a-time.spec.ts`](../../../front-end/e2e/the-plan-saves-one-at-a-time.spec.ts) the browser's question on a reload inside the pause.
- [`theImportAsksBeforeItDropsAMapping.test.ts`](../../../front-end/src/__tests__/theImportAsksBeforeItDropsAMapping.test.ts) reads the import's guards and `beforeunload` at each step: none on Upload, on the done step, while an import runs or after the import's own Back; the question on Map columns, on Preview, after a failed import and on a jump to another market's import; none on a move to `login`.
  [`the-import-asks-before-it-drops-a-mapping.spec.ts`](../../../front-end/e2e/the-import-asks-before-it-drops-a-mapping.spec.ts) walks it in a browser: a tab, "Cancel import", Back and the app bar asking, Stay keeping the mapping and the values settled, Leave going and writing nothing, the browser's question on a reload, and Upload, an import running and the done step leaving without a question.
- [`theFloorplanAsksBeforeItDropsADrawing.test.ts`](../../../front-end/src/__tests__/theFloorplanAsksBeforeItDropsADrawing.test.ts) reads the wizard's guards and `beforeunload`: none before an upload, the question in the floorplan's words from the upload to the save step, none once saved or once the wizard is gone.
  No spec walks it in a browser any more: the wizard's address lands on a location's layout page (T257), so nothing reaches the wizard until it is removed.
- [`unsaved-questions-ask-first.spec.ts`](../../../front-end/e2e/unsaved-questions-ask-first.spec.ts) walks the form builder in a browser: the question on a tab with focus on Stay and `expectAccessible`, each way of staying and Leave, the steps and a saved form asking nothing, Back asking, the browser's own question on a reload, Sign out never stopping on it, the move refused, and "Ask this" saving only its choice.

## What breaks it

- A screen holding unsaved work with no `useUnsavedWork` call, or a hand-rolled `beforeunload` or route guard beside it.
- A second leave dialog, or the dialog mounted inside a screen that a Leave unmounts.
- An `unsaved` that reads true with nothing to lose, which asks about nothing on every move.
