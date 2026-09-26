# 03: What is the one market every surface reads?

Type: grilling
Status: resolved
Blocked by: 02

## Question

Every surface in the frame must follow the market the moment it changes in this browser tab.
Given the staleness [02](02-which-surfaces-go-stale.md) measured, where does the market's truth live, and how does a change reach every surface that depends on it?

02 narrowed it: the only surface that fetches a fact about the market for itself is the form tab, and the Assignment and Applications tabs borrow what it publishes.
The lock is the one input genuinely not on the market, because it depends on whether an application exists.

The branches this has to settle:

- **One holder.** Market Setup keeps the market in a view-level ref, passes it down as a prop, and also writes a copy to `localStorage` from several places. Tables, Attendance and Vendors get theirs from `useRailMarket`. Is there one holder for all of them, and what becomes of the `localStorage` copy?
- **Derived or fetched.** The form lock depends on the phase, which the client holds, and on whether an application exists, which only the server knows. Is the lock derived on the client, re-fetched when the market changes, or carried on the market itself?
- **Who owns a derived fact.** `formEditable` is published by the form tab and read by the Applications tab. Should a fact one surface needs ever be owned by a sibling surface?
- **The trigger.** After a transition, the rail re-reads the whole market and emits it. After an assignment, the view bumps `assignedAt`. Are these one mechanism or two, and what does a placement or a review verdict do?

## Answer

Grilled 2026-09-26.
**The scope grew in the grilling, on purpose**: the organizer asked to stop keeping the market in the browser at all and make the back end the only source of truth.
The map's destination was amended to match.

**The model: one store holds the market exactly as the server last reported it, every market screen is addressed by id, every write is followed by a re-fetch, and an editor's unsaved work lives in the editor.**

### Decisions

1. **Identity is in the URL.**
   Every market screen is `/markets/:marketId/...`: `setup?tab=...`, `vendors`, `import`, `floorplan`, beside the existing `tables` and `attendance`.
   The id-less paths (`/market-setup`, `/vendors`, `/import-applications`, `/floorplan-editor?marketId=`) send the organizer to the Markets list: they never held an id to preserve.
2. **One holder.**
   A Pinia store holds the open market, keyed by the route's id.
   Every market screen, the rail and every tab read it; `useRailMarket` becomes a thin reader of it.
   It fetches on every arrival at a market screen, and again when the organizer returns to the browser tab (`visibilitychange`).
   What it holds is shown only while that fetch is in flight, and only for the same id.
3. **A write is followed by a re-fetch.**
   After any write that changes the market, the store re-reads `GET /markets/:id` and takes what it says.
   Nothing patches the held market locally, so nothing needs a list of which fields a write touched.
   The rail merging a phase, the form tab assigning `applicationForm` in place, and Assign replacing the market all go.
4. **Unsaved work belongs to the editor.**
   The plan and the form builder each keep a working copy apart from the store.
   The store only ever holds server truth; the editor writes, the store re-fetches, and the working copy is reset from it.
   A re-fetch never touches an unsaved working copy.
   (The rail already flushes pending plan edits before a transition, so the plan's copy is clean when one lands.)
5. **The form lock is on the market.**
   `GET /markets/:id` carries the lock reason, computed by `application_form_lock_reason()` and stamped like `isDraft`; nothing can write it.
   The form builder reads it from the store and treats it as unknown until the arrival fetch has landed.
   In a browser tab the lock only changes on a transition (no application can be created in draft), which the re-fetch in 3 already covers.
6. **Nothing borrows from a sibling.**
   The priority rules' "Your questions" come from the stored market's form, not from the form tab.
   The Applications advisory loses `formEditable` and its unreachable "add a question" branch.
7. **Nothing about a market is stored in the browser.**
   Every read and write of `localStorage` `market` goes.
   The dashboard's "continue where you left off" keeps only `lastMarketId`, a pointer, fetched fresh and silently forgotten when it is gone or no longer reachable.
   A unit test fails if any source file touches `localStorage` `market` again.
8. **Arrival states.**
   A hard reload draws the frame with a loading state inside it.
   A failed fetch offers a retry; a missing market and one the organizer cannot reach read identically.
   Signing out clears the store, so one account is never shown another's market.
9. **Each write names what it changes.**
   The plan's autosave sends only what the plan screen owns (the plan and the intake mode; the name is edited in Manage Market) through a write that accepts nothing else, rather than the whole market.
   A whole-document PUT is a client asserting its copy is the truth, and it is why `update_market()` re-applies five server-owned fields one bug at a time.
   What becomes of the whole-market PUT for its other callers is [04](04-what-becomes-of-the-whole-market-put.md).
10. **Tests move with it.**
    The 18 e2e specs and page objects that seed by writing `localStorage` navigate by URL through one helper instead; no compatibility layer that would keep the stored market alive where nobody looks.

### Found while grilling

**A market PUT moves a market to no organization, or to any organization id, and the server accepts it.**
Reproduced on the primary stack: PUT with `organizationId: null` answered 200 and stored null; PUT with `"not-a-real-org"` answered 200 and stored that.
`POST /markets` refuses both (AGENTS.md: "a market belonging to nothing is a state `POST /markets` refuses to produce"), and `update_market()` checks neither, nor membership of the target organization, while `$addToSet`-ing the market onto whatever organization it names.
Manage Market's "remove organization" is a button that does the first.
It is a plain fix, so it went straight to the backlog.

### Buildable work

- [E21/F02 One market, from the server](../../../backlog/E21-the-market-frame/F02-one-market-from-the-server/feature.md): decisions 1-8 and 10.
- [E21/F03 Each write names what it changes](../../../backlog/E21-the-market-frame/F03-each-write-names-what-it-changes/feature.md): decision 9 and the organization finding.

