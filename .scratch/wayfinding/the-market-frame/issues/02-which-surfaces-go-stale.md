# 02: Which surfaces go stale, and on what?

Type: task
Status: resolved
Blocked by: -

## Question

Before deciding where the market's truth lives, find out how far the problem reaches.
The form builder is the reported case; charting found a second (the Applications tab's advisory) and a third copy of the market in `localStorage`.
This ticket measures; it decides nothing.

1. **Reproduce the reported bug end to end first**, as an organizer would hit it: open the form builder, open applications from the rail, and see that "add a field" still behaves as if the form were editable (and the reverse on reopening) until the tab is left and re-entered. Record the exact steps and what is wrong on screen.
2. **Audit every surface in the frame**: the four Market Setup tabs, Tables, Attendance, Vendors, and the rail itself.
   For each, list every value it shows or gates on that is
   - read once at mount,
   - published by a sibling that may not be mounted, or
   - read from `localStorage` rather than from the market in hand,
   together with the same-tab change that makes it wrong: a phase transition, an assignment run, a plan edit, a placement, an import, or a review verdict.
3. Note which of those are already guarded, and how (`handlePhaseAdvanced` keeps the unsaved plan over a fresh market, `assignedAt` tells the results to re-read).

The answer is a table, surface by change, that ticket 03 can decide against.
AFK: nothing here needs the human.

## Answer

**Three surfaces go stale, all for one reason: a fact the market holds is published by the form tab, which only exists while it is open.**
Everything else in the frame either derives from the market it is handed or reloads when that market changes.

### 1. The reported bug, reproduced

At 1920x1080 on the primary stack, as an organizer, with a throwaway Playwright walk (deleted after):

| Step | Rail says | Form builder shows |
| --- | --- | --- |
| Draft, form tab open | Draft | Add field enabled, no lock notice. Correct. |
| Open Applications from the rail, stay on the tab | Applications Open | **Add field still enabled, no lock notice.** Wrong: any edit made now is refused by the server on save. |
| Switch to Applications and back | Applications Open | Lock notice, no Add field. Correct. |
| Reopen (More -> Draft), stay on the tab | Draft | **Lock notice reading "Current phase: Applications Open", no Add field.** Wrong, and the notice contradicts the rail directly above it. |
| Switch to Applications and back | Draft | Add field enabled. Correct. |

Cause: `MarketFormTab` asks the server for the lock (`GET /application-form`, which returns `lock_reason`) once, on mount.
The market prop it is handed does change on a transition; nothing watches it.

### 2. The audit

"Market in hand" below means the market object the screen holds and passes down (`MarketSetupView`'s ref, or `useRailMarket` on Tables and Attendance).

| Surface | Value | How it is read | Goes wrong on | Reproduced |
| --- | --- | --- | --- | --- |
| Form builder | the lock, and so Add field, editing, Save | fetched once on mount | a transition from the rail | **yes**, both directions |
| Assignment tab, priority rules | "Your questions", the market's own fields a rule can target | `formFields`, published **only** by the form tab; `[]` until it has mounted | opening the Assignment tab without having opened the form tab on this visit, which is the ordinary way to arrive (Assign lands there, and so do links back from Tables and Vendors) | **yes**: a market with a `Category` dropdown offers only the built-in targets, and the hint tells the organizer to "add a question with a fixed set of answers" it already has. Visit the form tab and come back, and `Category` appears. |
| Applications tab, the "nothing to judge" advisory | whether to say "add a question" or "the form is frozen" | `formEditable`, published **only** by the form tab; `false` until it has mounted | the same | no, and it cannot show wrong today: the advisory only renders once applications exist, and by D9 a market with applications has a locked form. **Right by accident**: the input is stale by construction, and the "add a question" branch is unreachable. |

**Not stale, and why** (so ticket 03 knows what already works):

- **The rail, the tab bar's "current" dot, Assign's and Import's refusals, the plan's intake-mode control**: all computed from the market in hand, which a transition replaces.
- **The plan**: `handlePhaseAdvanced` deliberately keeps the organizer's unsaved plan over the fresh market, because the server copy is as last *saved*.
- **Assignment results**: read the market from `localStorage` at setup rather than from the prop, but are remounted by `:key="assignedAt"` after a run and by `v-if` on every tab change. Nothing they show depends on phase.
- **The review queue**: reloads its applications whenever the market in hand changes, and keeps its own list in step after each verdict.
- **Tables, Attendance, Vendors**: load their rows on mount, and gate nothing on phase in the client (placements are refused by the server). A transition from their rail replaces their market.

### 3. The copies of the market

There is one market in hand per screen, plus a copy in `localStorage` key `market`.

- **Written by**: `MarketSetupView` (plan edits, assign), `MarketFormTab` (form saves), `PhaseRail` (after a transition), `useRailMarket`.
- **Read by**: `MarketSetupView` and `VendorsView` at setup, which is how they know which market is open at all (`/market-setup` carries no id), and `AssignmentResults`.

No bug in this audit comes from it.
It is where a screen learns which market is open, and a second place the same facts are written.

### What this means for 03

The problem is narrower than "every tab keeps its own copy": **the form is the one fact about the market that a surface fetches for itself, and two siblings borrow it rather than reading the market.**
The market in hand already carries `applicationForm`, which is where both borrowed values could come from.
The lock needs the server (whether an application exists), and that is the one input that is genuinely not on the market.

