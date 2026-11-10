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
[`front-end/src/views/MarketSetupView.vue`](../../../front-end/src/views/MarketSetupView.vue) gives it the write (`PUT /markets/<id>/plan` with `setupObject` and `intakeMode`), the re-read after it (the [market store](market-store.md)'s `refresh`), and who may write (`mayTake(market, MarketAction.ChangeSetup)`).

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

**A failure keeps the edits unsaved** and shows its sentence (`market-setup-plan-save-error`, "Could not save the plan. Retry in a moment." when the failure has none of its own).
Nothing retries on a timer; the next edit, or a flush, sends the whole working copy again.

**A person who may not write sends nothing, and their edits are not counted**, so nothing stays unsaved for them and the server's re-reads still reach their screen (bug 30: a plan that cannot change is never sent).

**The hold** (`hold`): the Pricing card holds the autosave while a price or the half table's share shows text that is not a value, or a group's name is missing or another's ([a price follows the table](../../business/rules/a-price-follows-the-table.md), E43/F01/S01), so "Plan saved" never stands beside text that was not kept.
While held no pause runs; an edit made meanwhile, or a save wanted when an answer finds the plan held, waits, and is sent a pause after the hold ends.

**The flush** (`flush`) stops the pause, waits for a save out, and sends while anything is unsaved, a held edit as kept: the working copy holds the value from before the text that is not one.
It answers null once the server holds the last edit, or the sentence of the failure that stopped it; with nothing unsaved it answers null at once, sending nothing.
Market Setup flushes before a phase move (the frame's `beforeTransition`), before Allocate tables and before the start from a CSV; none of them reads the answer.
The intake mode is saved at once, an edit and a flush, so it goes through the same queue.
Allocate tables sends the plan only when an edit is unsaved: the server already holds the working copy otherwise.

**Leaving the page flushes without waiting**, on the view's unmount, and a save out when it unmounts still sends a later edit once it answers.

## The view's side

**The working copy** is `setupObject` and `planIntakeMode`, taken from the market when it arrives and again whenever a re-read lands while nothing is `unsaved` (`adoptPlan`).

**The echo rule** (`serverPlan`, bug 25): the plan cards deep-watch the working copy and report every change to it, the page's own adoption of a re-read included, so a report that leaves the plan as the server sent it, while nothing is unsaved, is not an edit.
Without it one edit saved every 625 ms until the page was left (`plan-saves-once.spec.ts`).

**The saves write to the market the working copy was taken from** (`planMarket`), never the store's market at the time of the write.
A save sent on leaving, or after a save out answers, can run once the store holds the next page's market, or none while it reads it, since a route's new view sets up before the old one's unmount hooks run.

## Why

An organizer is told the plan is saved, and moves on: a "Plan saved" beside a plan the server does not hold is how an edit is lost with no word.
The plan is the market's setup, which settles on leaving Draft ([planning the market](../../business/flows/planning.md#e7-edit-the-plan-after-draft)), so a date that silently did not save becomes a market that runs without it.
