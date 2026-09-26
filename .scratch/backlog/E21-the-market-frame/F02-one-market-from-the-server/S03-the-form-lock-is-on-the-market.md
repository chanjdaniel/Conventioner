---
id: E21/F02/S03
title: The form lock is on the market
type: story
status: done
blocked_by: [E21/F02/S02]
pr: []
---

## What to build

The form builder, the Assignment tab's priority rules and the Applications advisory all read the form from the market in the store, so the form builder follows a phase change the moment it lands.
This is the story that fixes the brain dump's reported bug and the one ticket 02 found beside it.

**The lock rides on the market.**
`GET /markets/:id` carries the form's lock reason, computed by the existing single rule (`application_form_lock_reason`) and stamped the way `isDraft` is. No request can write it.
The form builder reads the lock from the store, and treats it as unknown (nothing editable) until the arrival fetch has landed.

**Nothing borrows from a sibling.**
The priority rules offer the market's own questions from the stored market's form, whether or not the form tab has been opened.
The Applications advisory drops its `formEditable` input and the "add a question" branch that can never render: it only shows once applications exist, and by then the form is always locked.

## Acceptance criteria

- [x] `GET /markets/:id` returns the lock reason, and pytest covers draft with no applications (unlocked), draft with an application (locked, D9), and each non-draft phase (locked).
- [x] The form builder is locked the moment Open Applications lands from the rail, and unlocked the moment a reopen to draft lands, with no tab switch; its notice never names a phase other than the one the rail shows.
- [x] Opening the Assignment tab directly on a market with a dropdown question offers that question as a priority target, and the empty-state hint does not appear.
- [x] `MarketApplicationsTab` and `ApplicationMonitor` no longer take `formEditable`, and `MarketFormTab` no longer emits `formEditable` or `formFields`.
- [x] An e2e spec pins both reproduced bugs: the form builder across open and reopen without leaving the tab, and the priority targets on direct arrival at the Assignment tab.

## Found while building

`parseMarketFromApi` rebuilt `setupObject` from a fixed list of keys and dropped `intakeMode` and `resultsPublished`.
Harmless while the screens read the unparsed `localStorage` copy; once every screen read the parsed market (S01, S02), the plan's autosave sent a working copy without `floorplans`, so the next edit to a plan erased the market's floorplan.
Reproduced by the floorplan e2e spec (it fails without the fix), and fixed here: the parser spreads what it does not name, carries the two fields, and a unit test pins that it keeps everything the server sends.
