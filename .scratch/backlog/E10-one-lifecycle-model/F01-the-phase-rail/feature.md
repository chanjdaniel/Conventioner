---
id: E10/F01
title: The phase rail
type: feature
status: in-progress
blocked_by: []
pr: []
---

## Outcome

Every market screen carries a rail below the header showing where the market is in its lifecycle and
what happens next, and it is the only place a market advances.

## Why now

The control that advances a market today is an unlabelled row of pills floating above the page card,
whose "Current Phase:" label is white text on a white page and therefore invisible.
Under ticket 01 that control becomes primary navigation, so it has to carry the weight.

## Shape, settled by prototype

[Ticket 06](../../../wayfinding/readable-journey/issues/06-where-the-check-in-url-lives.md) is
resolved: three variants were built on the real route and **variant A won**.
The prototype is on the throwaway branch named in that ticket; the artifact is
`.lavish/proto-06-phase-rail.html`.

- A band **below the market header**, inside the card, on every market screen.
- The **lifecycle spine**: seven phases in order, current position marked, completed ones filled.
  `offers` is out of scope and is not on it.
- **One prominent forward action** at the right.
- Back and destructive edges - `Reopen for Editing`, `Reopen Applications`,
  `Return to Applications Closed`, `Archive Market` - in a **secondary menu**.
  This fixes `transitionVariant()`'s fall-through by construction: `draft` is the one unambiguously
  backwards edge and currently falls through to `advance`.
- When published, a **check-in URL chip** between the spine and the action.
- A market that leaves the spine **freezes** it at the last stage reached.

## Measured

At **1920x1080**, with a 69-character check-in URL - longer than anything in the repo's fixtures -
the spine sits at its natural width with **31px between labels** and 24px clear of the actions.
The layout breaks between 1366 and 1440, which is below the target and therefore not a constraint.
