---
layer: implementation
kind: module
describes:
  - front-end/src/utils/useAutosave.ts
  - front-end/src/views/MarketSetupView.vue
verified: 2026-11-10
sources:
  - T271
  - T244
  - E21/F02/S02
  - E26/F04/S01
  - E43/F01/S01
  - bug/25
  - bug/30
---

# The plan's autosave

Market Setup's plan saves itself as it is edited ([planning the market](../../business/flows/planning.md)).
[`front-end/src/utils/useAutosave.ts`](../../../front-end/src/utils/useAutosave.ts) owns the order of the saves of one working copy, and knows nothing of markets.
[`front-end/src/views/MarketSetupView.vue`](../../../front-end/src/views/MarketSetupView.vue) gives it the write (`PUT /markets/<id>/plan` with `setupObject` and `intakeMode`), the same write as a keepalive request for the way out of the page, the re-read after it (the [market store](market-store.md)'s `refresh`), and who may write (`mayTake(market, MarketAction.ChangeSetup)`).

## The queue

**One save is out at a time.**
An edit starts a 600 ms pause; when it ends with no save out, the working copy is sent as it stands at that moment.
A pause that ends while a save is out marks a save as wanted, and when the save out answers, the wanted save goes at once with the working copy as it then stands.
An edit whose pause is still running when the answer comes is sent by its pause.
The plan used to send a save at every pause whether or not one was out, and answers are not promised in order: a slow first save reaching the server last stored the older plan, and its re-read put that plan back on screen beside "Plan saved" (T271, `the-plan-saves-one-at-a-time.spec.ts`).

**Edits are counted, and an answered save marks stored only the edits it carried.**
`unsaved` is true while an edit is not yet stored or a save is out.
The status is `saving` while a save is out, and `saved` ("Plan saved") only when an answer leaves no edit unsaved, for 2 s; the next edit hides it.
A wanted save is sent before the re-read of the answer that freed it, so that re-read lands while an edit is unsaved, and the view ignores it.

**A refusal and a failure are told apart** by the answer's status, in one function, `isRefusal`: an answer from 400 to 499 other than 401, 408 and 429 is the server saying no, and anything else (no answer, a 401, 408, 429 or 5xx) is the save not getting through.
The plan's write refuses with a 400 (an invalid plan, a price, the intake mode after draft, the setup settled on leaving draft, the rules settled) or a 403 (archived, the person's role); a stale-write 409 would read as a refusal too.

**A refusal drops every edit made so far** and takes the server's plan back: the plan is written whole, so every later edit builds on the refused one, and none of them is kept.
The status is `refused`, and the line (`market-setup-plan-refused`, in the error's red, with no Retry) says the server's sentence and then "The plan is back as it was last saved."
A sentence the server left without a full stop ("Market not found", from a market deleted in another tab) is given one, so the two read as two sentences.
The view's `afterRefusal` re-reads the market and then adopts it itself, so the server's plan comes back even when the re-read failed or handed back the market the page already had, which leaves the market watch silent.
Nothing is unsaved after it, so later re-reads reach the screen again; until T271 a refused save left the page skipping every re-read, the refused plan on screen until a reload.

**A failure keeps the edits unsaved** and shows its sentence (`market-setup-plan-save-error`): the app's offline sentence for no answer, the server-fault sentence for a 5xx, and "The plan was not saved." for a failure with no sentence of its own.
A "Retry" button beside it (`market-setup-plan-retry-button`, `retry`) sends the whole working copy again; so do the next edit and a flush, and nothing retries on a timer.
A 401 also ends the session through the app's interceptor.

**A person who may not write sends nothing, and their edits are not counted**, so nothing stays unsaved for them and the server's re-reads still reach their screen (bug 30: a plan that cannot change is never sent).

**The hold** (`hold`): the Pricing card holds the autosave while a price or the half table's share shows text that is not a value, or a group's name is missing or another's ([a price follows the table](../../business/rules/a-price-follows-the-table.md), E43/F01/S01), so "Plan saved" never stands beside text that was not kept.
While held no pause runs; an edit made meanwhile, or a save wanted when an answer finds the plan held, waits, and is sent a pause after the hold ends.

**The flush** (`flush`) stops the pause, waits for a save out, and sends while anything is unsaved, a held edit as kept: the working copy holds the value from before the text that is not one.
It answers null once the server holds the last edit, or the sentence of the failure or refusal that stopped it, a save out it waited for included (a refusal's own sentence, without "The plan is back as it was last saved."); with nothing unsaved it answers null at once, sending nothing.
Market Setup flushes before a phase move (the frame's `beforeTransition`), before Allocate tables and before the start from a CSV, and each stops on a sentence:
the move posts nothing and the [phase rail](phase-rail.md) says "The market did not move, because the plan did not save. " and the sentence; [Allocate tables](../../business/flows/assignment-and-result.md#j3-allocate-tables) posts no run and shows the sentence as its error; the start from a CSV stays on the plan, whose status line says why.
Before the flush, a phase move refuses while the form tab reports questions not yet saved, and sends nothing of the plan ([building the application form](../../business/flows/form-tab.md#leaving-with-questions-not-yet-saved)).
The intake mode is saved at once, an edit and a flush, so it goes through the same queue.
Allocate tables sends the plan only when an edit is unsaved: the server already holds the working copy otherwise.

**Leaving the view flushes without waiting**, on the view's unmount, and a save out when it unmounts still sends a later edit once it answers; when that save fails or is refused, the flush stops there and the later edit is not sent.

**Leaving the page tries once more, on `pagehide`** (a reload, a closed tab, a link out of the app), since none of these unmounts the view and an edit still in its pause was lost (T271).
It calls the view's `sendOnUnload` when an edit is unsaved and no save is out (in its pause, held by the Pricing card, or after a failure), and when a save is out and a later edit is not in it: the save out was sent first and most likely lands first, and waiting would lose the later edit for sure.
With a save out carrying every edit it sends nothing, and leaves that save to land.
`sendOnUnload` is a `fetch` `PUT` of the plan with `keepalive: true` and `credentials: 'include'`, since axios's browser adapter is XHR, which has no `keepalive`; it answers false when `fetch` throws (a body over the browser's 64 KiB keepalive limit does), and its answer is never read.
The try changes nothing of the autosave's own state: a page the browser keeps and shows again (its back-forward cache) still counts the edit unsaved, and sends it as it would have.

**The try is a best effort, and the browser's question is the guard.**
The view calls [`useUnsavedWork`](../conventions/unsaved-work-asks-before-it-is-dropped.md) with `inApp: false`, so a reload or a close asks in the browser's words while `unsaved` is true, and an in-app move asks nothing, since the unmount's flush sends the edit and an in-app move does not cancel it.
On a stack the keepalive write reaches the back end through the front end's `/api` proxy, on the page's own origin, which is where it is proven (`the-plan-saves-one-at-a-time.spec.ts`).
Production calls `https://api.conventioner.io` from `https://conventioner.io`, so the `PUT` needs a CORS preflight, and whether every browser sends a keepalive request that needs one is not settled by any source found: that path is unproven.

## The view's side

**The status line** is [`PlanSaveStatus.vue`](../../../front-end/src/components/market/PlanSaveStatus.vue), at the foot of the plan tab: "Saving…", "Plan saved", the failed line with Retry, or the refused line.
On Settings, where the assignment rules ride in the plan, the failed and refused lines show too, through `MarketAssignmentTab`'s `planStatus` slot, above the allocation's own error, and in a row of their own when there is no allocation to offer.

**The working copy** is `setupObject` and `planIntakeMode`, taken from the market when it arrives and again whenever a re-read lands while nothing is `unsaved` (`adoptPlan`).

**The echo rule** (`serverPlan`, bug 25): the plan cards deep-watch the working copy and report every change to it, the page's own adoption of a re-read included, so a report that leaves the plan as the server sent it, while nothing is unsaved, is not an edit.
Without it one edit saved every 625 ms until the page was left (`plan-saves-once.spec.ts`).

**The saves write to the market the working copy was taken from** (`planMarket`), never the store's market at the time of the write.
A save sent on leaving, or after a save out answers, can run once the store holds the next page's market, or none while it reads it, since a route's new view sets up before the old one's unmount hooks run.

## Why

An organizer is told the plan is saved, and moves on: a "Plan saved" beside a plan the server does not hold is how an edit is lost with no word.
The plan is the market's setup, which settles on leaving Draft ([planning the market](../../business/flows/planning.md#e7-edit-the-plan-after-draft)), so a date that silently did not save becomes a market that runs without it.
