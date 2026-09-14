---
id: E08/F02
title: Copy and navigation tell the truth
type: feature
status: in-progress
blocked_by: []
pr: [04215fc0]
---

## Outcome

No control points somewhere it does not go, and no hint refers to something that is not on screen.

## Why now

First-contact damage, all of it cheap, all of it found by walking the journey on 2026-09-14
(`.lavish/mvp-findings.html`).

## Done

- **Four of six sidebar links pointed at `/vendors`.**
  "View Tables", "Discord Tools" and "View Change Log" all landed on the vendors page, and "Manage
  Tables" opened `/init`, the new-or-existing market chooser.
  The two with no page at all are gone rather than re-pointed; Organizations was added because it is
  a real page that was reachable only from the dashboard.
- "Set both assignment options above to run the assignment" no longer appears on wizard pages that
  have no assignment options.
- The Assign and Next buttons no longer overlap on the last page.
  Next was `v-else` on the assignment-error banner, so it rendered beside Assign and vanished
  whenever an assignment failed.
- The market's name is the settings page title, instead of "Settings" on every market.
- The form builder no longer tells an organizer their essential-only form cannot be saved.
  The back end accepts one and the phase transition succeeds, so the hint contradicted the product.
- The import rail no longer shows a red "Still unmapped:" with an empty list directly under the
  green "All required questions are mapped."
- The import preview names the columns behind a grid-mapped target instead of showing a blank at the
  moment the organizer confirms 232 writes.
- Unmatched table-choice values offer "A whole table to myself" rather than the contract's `full`.

## Done 2026-09-14, second pass

- **The Preview step shows the organizer's own rows**, the first three read through the mapping
  they just chose, rather than a second recap of the mapping. Confirming 232 writes on a restated
  mapping means trusting that the mapping means what you think it means, which is the one thing a
  preview exists to check. The mapping recap stays, under a heading that says what it is.
- **Upload is a drop zone that names the market it writes into.** It was a bare file input on a
  page that never said which market an import lands in. A file dragged and a file picked now take
  the same path, and anything that is not a CSV is refused by name.
- **The priority rule row fits its own sentences.** The question select clipped to "When the
  application" and the direction to "Earliest", which is the half of each that carries no meaning.
  The grid also declared five columns for four controls; it declares four now, and the headings
  and the row share one definition so a heading always sits over the control it names.
- **Section Setup rows fit their own content.** The name field was a fifth narrower than its
  column and the location dropdown truncated "Nest Ballroom"; the columns now follow what each
  holds, and a value that still will not fit ends in an ellipsis rather than mid-word.
- **A row's remove control is visible.** It was hidden until the pointer happened to be over its
  row, so every setup screen read as though only the last row could be removed. It is dimmed now,
  in all six places that shared the rule.
- **The setup-path modal has its icons.** `primeicons` was a dependency whose stylesheet nothing
  imported, so every `pi` icon rendered as nothing - the two grey circles were the empty wells
  they sit in.
- **Floorplan AI is the quieter of the two paths.** Manual setup is marked as recommended, and the
  floorplan card says the thing an organizer needs before choosing it: this release places one
  table type, so a floorplan's table variety does not reach the assignment. Reachable, not sold.
  It is a polish item, per the map, not an invitation to build the floorplan out.
- **The first-run dashboard offers the step it was describing.** "Open a market to get started" was
  an instruction the organizer could not follow, on a page with no market and no way to make one.
  It now says no market is set up yet, says a market belongs to an organization, and carries the
  button that starts one. Sign out is no longer a black slab the size of the two real
  destinations.

## Still to do

- The vendors table shows "Cost" as an em-dash for all 199 vendors, and identifies vendors by email
  with no business name.
  **Blocked, not deferred**: the map's **Not yet specified** holds "Price per tier" - whether a
  price belongs on a tier at all, or whether the column should go - and building either way would
  settle it by accident. The business name half is the same shape of question: a name lives in a
  custom field the market may not ask, and which field holds it is a decision, not a lookup. The
  Fall 2025 import mapped no custom fields at all, so there would be nothing to show.
