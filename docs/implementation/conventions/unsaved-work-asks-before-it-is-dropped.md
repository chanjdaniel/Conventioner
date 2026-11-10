---
layer: implementation
kind: convention
describes:
  - front-end/src/utils/useUnsavedWork.ts
  - front-end/src/components/UnsavedWorkDialog.vue
  - front-end/src/__tests__/useUnsavedWork.test.ts
  - front-end/e2e/unsaved-questions-ask-first.spec.ts
verified: 2026-11-10
sources:
  - T271
  - T244
---

# Unsaved work asks before it is dropped

**A screen that holds work the server does not have yet asks before that work is dropped**, by one call, `useUnsavedWork({ unsaved, sentence, inApp })` ([`useUnsavedWork.ts`](../../../front-end/src/utils/useUnsavedWork.ts)).
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

| Screen                                                                                               | `unsaved`                                                                      | `inApp` | Sentence                                                                  |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------- | ------------------------------------------------------------------------- |
| The form builder ([`MarketFormTab.vue`](../../../front-end/src/components/market/MarketFormTab.vue)) | the working copy's fields differ from the fields as last taken from the server | true    | "Your changes to the form's questions are not saved. Leaving drops them." |

The form builder's rule is its own ([building the application form](../../business/flows/form-tab.md#leaving-with-questions-not-yet-saved)): only the fields count, since "Ask this" saves itself as it is ticked and the key flags are intent, never sent; opening a step without an edit, or a form just saved, is not unsaved.
It also reports the flag to Market Setup, whose phase move refuses while it holds.

## How it is enforced

- [`useUnsavedWork.test.ts`](../../../front-end/src/__tests__/useUnsavedWork.test.ts) drives the guards through a real router and `RouterView` with the dialog beside it: the question on a move to another route and to another path of the same route, Stay, Escape, the close and the scrim staying, Leave going, no question on a query or hash change, a move to `login`, nothing unsaved or `inApp: false`; `beforeunload` prevented only while unsaved and never once the screen is gone; and one question at a time.
- [`unsaved-questions-ask-first.spec.ts`](../../../front-end/e2e/unsaved-questions-ask-first.spec.ts) walks the form builder in a browser: the question on a tab with focus on Stay and `expectAccessible`, each way of staying and Leave, the steps and a saved form asking nothing, Back asking, the browser's own question on a reload, Sign out never stopping on it, the move refused, and "Ask this" saving only its choice.

## What breaks it

- A screen holding unsaved work with no `useUnsavedWork` call, or a hand-rolled `beforeunload` or route guard beside it.
- A second leave dialog, or the dialog mounted inside a screen that a Leave unmounts.
- An `unsaved` that reads true with nothing to lose, which asks about nothing on every move.
