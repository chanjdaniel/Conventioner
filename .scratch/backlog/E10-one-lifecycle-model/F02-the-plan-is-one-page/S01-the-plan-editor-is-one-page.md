---
id: E10/F02/S01
title: The plan editor is one page
type: story
status: ready
blocked_by: []
pr: []
---

## What to build

`MarketSetupView`'s Market Setup tab becomes a single scrolling page with three sections - Market
Dates, then Tier / Location / Section, then Assignment Priority and Assignment Options - replacing
the `pageIdx` paging and the Back / Next buttons.

`Assign` and `Done` do not move here; they are `E10/F03`.

This deletes three things rather than fixing them:

- **`setupPageIdx`**, a single global localStorage key with no market id in it, which is why a
  second market opens wherever the organizer left the first and therefore skips Market Dates.
  Supersedes that half of `E09/F05/S02`.
- **The dead space** on the dates page (one panel in an 1100px card) and the options page.
- **The paging state** that the setup-path chooser had to reason about.

## Acceptance criteria

- [ ] One page, three sections, no Back or Next.
- [ ] `setupPageIdx` is gone from the codebase and from localStorage handling.
- [ ] A newly created market shows Market Dates without any navigation.
- [ ] Changing a market date updates the max-assignments clamp visibly, without navigating.
- [ ] The page holds at 1920x1080 without a second scroll context, per `E09/F02/S02`.
- [ ] The existing setup unit tests and `market-journey.spec.ts` are updated, not deleted.
