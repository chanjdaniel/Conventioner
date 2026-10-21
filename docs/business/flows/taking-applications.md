---
layer: business
kind: flow
verified: 2026-10-22
sources:
  - wayfinding/the-order-of-the-work/11
  - E18/F02/S03
  - E18/F04
  - E31/F01/S01
  - E31/F02
  - E31/F03/S04
  - E32/F01/S01
  - E32/F02/S01
  - E18
  - bug/11
---

# Taking applications

**Who:** the market's Admin or owner, who moves the market on the phase rail ([what each role may do](../rules/what-each-role-may-do.md)).
**Where they start:** the phase rail of a market whose vendors apply on its own page.

These are the online path's moves ([the online path](the-online-path.md)): its applications open, close and reopen.
A market whose vendors apply on the organizer's own Google Form leaves Draft with "Import responses" instead, which lands on [the import](import.md), and has no Close or Reopen Applications ([the Google Form path](the-google-form-path.md)).
How vendors apply while applications are open is [applying online](applying-online.md).

**One Applications page serves Applications Open, Applications Closed and Review**, and says in words, at its top, which of them the market is in ("This market is no longer taking applications. No new ones will arrive."; in Review, how many are still to decide).
The three phases differ too little for three pages: a verdict can be given from the first application, and Review is the phase after which reviewing must be finished, not the one in which it happens ([review](review.md)).
Hiding a control is not saying the state: a page whose only difference is a missing button teaches an organizer that the phases are arbitrary.
The phases are not merged either: for a market taking applications online, "applications have closed" is a real state, since its public form stops accepting, and the phase machine stays as it is.

## H1. Open applications

**Status:** Works (walked live; where the move lands, and its refusal before the click, read from the code as of E32/F01/S01 and E31/F02: `front-end/src/utils/marketGuide.ts`, `every-move-lands.spec.ts`).

1. Rail: "Open Applications", the main button in Draft once the setup is complete ([the setup settles on leaving draft](../rules/the-setup-settles-on-leaving-draft.md)); until then it is disabled and the rail names the first thing missing.
2. Expect Applications Open, landing on the Applications page, which carries the dot; the form is locked from now on ([F4](form-tab.md#f4-the-form-lock)).
3. The rail shows "Application page" with the public address and "Copy" on one line, shortening the address rather than wrapping (bug 11); it stays there in every phase after Draft until the market is archived.
4. The rail says "Applications are open on your application page. Review them as they arrive, and close applications when you stop taking them."

Covered by: `phase-state-machine.spec.ts`, `phase-rail.spec.ts`, `every-move-lands.spec.ts`.

## H1a. Refused: the form asks nothing

**Status:** Works (code); not reached through the product since E31/F01/S01 (read from `back-end/guards.py` and `phase-state-machine.spec.ts`).
The guard still stands on every move into Applications Open: with no custom field, and a plan offering no dates, no tiers and fewer than 2 sections, the move is refused with "The application form asks nothing. …".
Leaving Draft now needs market dates first, and a plan with dates always asks the available-dates question, so a plan that offers nothing is refused by the setup's first blocker instead: the rail reads "To open applications: This market has no market dates. Pick them on Market Setup's calendar."
Covered by: `phase-state-machine.spec.ts` ("a market whose plan offers nothing is blocked, and told to add dates").

## H4. Close applications

**Status:** Works (walked live; the landing read from the code as of E32/F01/S01).
From Applications Open, the rail's main button "Close Applications": vendors can no longer apply or change their answers, though each can still sign in and read their application ([H3c](applying-online.md#h3c-a-vendor-checks-their-application)).
It lands on Applications, which says "This market is no longer taking applications. No new ones will arrive."
Covered by: `phase-state-machine.spec.ts`, `vendors-see-their-application-after-close.spec.ts`.

## H5. Reopen applications

**Status:** Works (walked live).
From Applications Closed, More…, "Reopen Applications"; the form guard runs again (H1a).
Covered by: `phase-state-machine.spec.ts`.

## Superseded

- The Applications page was to offer Import in Applications Open and Applications Closed on any market, dropping it in Review (wayfinding/the-order-of-the-work/11); importing is the Google Form path's alone, which never stops in Applications Closed, and from Review it is one move back, "Import more responses" (E31/F03/S04, E32/F02).

## The rules it obeys

- [The setup settles on leaving draft](../rules/the-setup-settles-on-leaving-draft.md): Open Applications waits for dates, a location and tables at every tier.
- [The form locks at the first application](../rules/the-form-locks-at-the-first-application.md): past Draft the form is fixed.
- [Intake mode decides how vendors arrive](../rules/intake-mode-decides-how-vendors-arrive.md): these moves are the online path's.
- [What each role may do](../rules/what-each-role-may-do.md): moving the market is an Admin's.

How the rail draws each move, and says no before the click, is [the phase rail](../../implementation/modules/phase-rail.md); the moves themselves are in [the lifecycle](lifecycle.md).
Its specs and gaps are in [walking the flows](../../implementation/testing/walking-the-flows.md#coverage-map).
