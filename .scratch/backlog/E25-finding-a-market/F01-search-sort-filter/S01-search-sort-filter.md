---
id: E25/F01/S01
title: Search, sort and filter the Markets page
type: story
status: done
blocked_by: []
pr: [87]
---

## What to build

Above the list on the Markets page, four controls that act together on the markets the organizer can reach:

- **Search**: filters as each character is typed, with no debounce and no submit.
  A market matches when its name contains the text, ignoring case, accents and surrounding whitespace - "tes" finds "Test Market", "cafe" finds "Café Market".
  Name only; the organization name is not searched.
- **Organization**: one choice, "All organizations" by default, listing every organization the organizer belongs to (the same list the Organizations page shows), whether or not it holds any markets.
  A market reached through a direct role in an organization the organizer is not a member of appears only under "All".
- **Phase**: several choices at once, none meaning every phase, listing all eight phases in lifecycle order under the labels the row's phase badge uses.
  This is the "state" filter from the request; the glossary's term is Phase.
- **Sort**: Market date (default), Name, Created.
  Market date puts the soonest upcoming market first, then past markets most recent first, then markets with no dates; Name is A-Z; Created is newest first.

Search, both filters and the sort compose: the list is the markets matching every active control, in the chosen order.
An "All phases" toggle leads the phase toggles and is on while none is, and a line above the list says how many markets are shown ("2 of 4 markets" while anything narrows it).
The logic is one pure function over the market list, kept out of the view, so the Dashboard and the Load Market dialog can adopt it later.

All four live in the page's address (query parameters), so Back from an opened market returns to the same narrowed list and the view can be bookmarked or shared.
Nothing is kept in browser storage.
The defaults leave the address clean; an unknown or stale value in the address (an organization the organizer has left, a phase this build does not know) is ignored rather than producing an empty list.

When the organizer has markets but none match, the page says "No markets match these filters" with a control that clears search and both filters; "No markets found" stays for an organizer with no markets at all.

Settled in the 2026-09-30 grilling: phase rather than a coarser grouping, since a coarser one would bring in a term the glossary does not have; single-select organization and multi-select phase; the date sort as default because an organizer identifies a market by when it runs; the address rather than storage, because the address is how this app remembers where you are.

Out of scope: the same controls on the Dashboard and the Load Market dialog; server-side search or pagination.

## Acceptance criteria

- [x] Typing "tes" narrows the list to markets whose name contains "tes" in any case, as it is typed; clearing the box restores the list.
- [x] Search ignores accents ("cafe" matches "Café Market") and leading or trailing spaces.
- [x] The Organization filter lists every organization the organizer belongs to, including one with no markets, and narrows the list to that organization's markets.
- [x] The Phase filter accepts several phases and shows markets in any of them.
- [x] Sort by Market date, Name and Created each order the list as described; markets with no dates sort last under Market date.
- [x] Search, filters and sort compose: e.g. search "fair" + one organization + phases Review and Assignment, sorted by Name.
- [x] Every control round-trips through the address: reloading, and Back after opening a market, restore the same view.
- [x] An address naming an unknown organization or phase is ignored, not an empty list.
- [x] No match shows "No markets match these filters" with a working Clear filters; an organizer with no markets still sees "No markets found".
- [x] The controls use the shared primitives and tokens, pass `lint:css` as a migrated file, and fit the app's narrowest supported window without scrolling sideways (the shell's 1000px floor; the product is not laid out for a phone).
- [x] Vitest: the pure filter/sort function covers matching, accents, composition, date ordering and stale values.
- [x] Playwright: an organizer with several seeded markets across two organizations and several phases searches, filters, sorts, opens a market, goes Back, and finds the same view.
