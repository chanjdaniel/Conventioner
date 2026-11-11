---
layer: implementation
kind: data
describes:
  - back-end/history.py
  - back-end/api/markets.py#get_history
  - front-end/src/utils/marketHistory.ts
  - front-end/src/utils/historyReaders/
  - back-end/tests/test_reading_the_history.py
  - back-end/api/markets.py#get_permission_history
  - back-end/migrations/migrate_placement_history.py
  - back-end/tests/test_every_write_records.py
  - back-end/api/organizations.py#get_history
  - back-end/tests/test_the_organizations_history.py
  - back-end/api/organizations.py#get_default_permission_history
verified: 2026-11-11
sources:
  - wayfinding/readable-journey/08
  - E40/F01/S01
  - E40/F01/S02
  - E40/F01/S03
  - E40/F01/S04
  - E39/F01/S03
  - E39/F01/S04
  - E41/F01/S01
  - E38/F04/S02
  - E40/F02/S01
  - E38/F06/S01
  - E38/F07/S02
  - E38/F07/S03
  - E39/F02/S01
  - E46/F01/S02
  - E46/F01/S03
  - E44/F01/S01
  - E44/F01/S02
  - E46/F01/S05
  - E46/F01/S04
  - E38/F10/S01
  - T206
  - T224
  - T217
  - T263
---

# The market's history

The `history` collection: every change on a market, who made it, and when, and every change to an organization itself ([what an organization records](#what-an-organization-records)).
[`back-end/history.py`](../../../back-end/history.py) owns it, and every reader and writer goes through it.
It began as the placement history, because a placement that differs from what the solver produced is a fact someone will later ask about, and a flag saying "hand-placed" cannot answer it.

**Every change, in one history.**
The placement history kept placements only, on the view that a narrow trail that gets read beats a general one that gets ignored.
Daniel widened it (T92, Q23: "yes every change is logged"): an organizer investigating a problem or a mistake asks who did what on the market, whatever it was, and one history answers that where several partial records would each answer part of it.
The decision, and what stays state and what stays apart, is [ADR 0017](../../adr/0017-one-history-for-every-change.md).
Every write that changes a market, its applications or its vendors records its entry into it (E40/F01/S02), once its change has landed, under the E39 action its check asked; [what each write records](#what-each-write-records) lists them.

The glossary concepts: [Assignment](../../business/concepts/assignment.md) and [Placement and pin](../../business/concepts/placement-and-pin.md).

## An entry

Stored snake_case with the market foreign key `market_id` (an organization's own change holds `organization_id` instead), like applications and unlike markets:

| Field       | What it is                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`        | a UUID                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `market_id` | the market; an organization's own change holds `organization_id` in its place, and no `market_id`                                                                                                                                                                                                                                                                                                                             |
| `actor`     | the address of the signed-in person who made the change; an applicant's own when they submit or edit their application; null for a vendor's own check-in or undo, on their vendor page, which names the vendor among its `vendors` and says how in its detail (`via`), and for one made on the public check-in page before it was removed, which asked only an address and a date and so proved nobody (`via: check_in_page`) |
| `at`        | ISO 8601, UTC                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `action`    | the id of the [E39 action](../modules/market-actions.md) the change was, the verb its check asked: `assign` for a placement; `apply` for an applicant's own change, which no row asks; an organization's own change uses one of the history's own verbs instead, since an organization has no table, except a market deleted from it, which keeps the table's `delete-market` ([below](#what-an-organization-records))        |
| `kind`      | the finer kind where one action covers several changes, else null: a placement's is `placed`, `freed`, `swapped` or `assigned`                                                                                                                                                                                                                                                                                                |
| `vendors`   | the lowercased addresses the entry is about, empty for a run                                                                                                                                                                                                                                                                                                                                                                  |
| `subject`   | what else the entry is about; a placement's is its table-day, `{date, table_codes}`, and a run's is empty                                                                                                                                                                                                                                                                                                                     |
| `detail`    | structured, per kind: the date, table code and table choice placed, and the seat left; the date and table freed; the date and both seats swapped; how many placements a run wrote and how many pins it kept                                                                                                                                                                                                                   |

`record(market_id, actor, action, kind=, vendors=, subject=, detail=)` writes one, and `record_applicant` writes an applicant's own; the placement writes call `record_placed`, `record_freed`, `record_swapped` and `record_assignment_run`, which build the detail and its subject (`placement_subject`).
Every other kind of change gives its detail the changed fields before and after, never a whole document: `changes(before, after)` keeps the fields that differ, and answers None when none does; a detail that builds to None records nothing, so a write that restates what is stored (the plan's autosave, a note saved unchanged, a vendor checked in again) records nothing.
An import, the start from a CSV and a run record their counts instead, and a verdict is recorded whole each time it is given, since each one is.
**The placement kinds are the one exception**: their details keep the shapes they had before the history widened, because the entries moved from `placement_history` have no before to give.
A `placed` entry written since adds one key, `before`: the seat the vendor left on that date (`table_code`, `table_choice`), null when they had none, so a move reads from one seat to the other; an older `placed` entry has no `before` key at all, which says the seat left is unknown, not that there was none.

**A run is one entry**, not none and not one per placement.
Leaving runs out would make the history lie by omission, since a placement changed between two hand edits would have no explanation; one entry per placement would drown the hand edits, which are the entries anyone reads.
A swap is one entry too, because it was one action.

## What each write records

The kinds are constants in `history.py`; a kind with no Vendors or Subject line has an empty list or subject.
One block per action, in the order of [the actions table](../modules/market-actions.md#each-routes-row), then the history's own `apply`; a new kind is one item at the end of its action's block, and a new action a block in its row's place ([two features never share a line](../conventions/two-features-never-share-a-line.md#the-markets-history)).

**`change-setup`**

- `renamed`: renaming a draft
  - Detail: `name`
- `plan`: a Market Setup card, or the intake mode (`PUT /markets/:id/plan`)
  - Detail: whichever of `market_dates`, `tiers`, `locations`, `sections` and `intake_mode` changed; never the layouts or the table types, which the plan write keeps as stored and their own writes record (an entry written before T257 may name `floorplans`)
- `pricing`: the Pricing card, in the same plan write ([a price follows the table](../../business/rules/a-price-follows-the-table.md))
  - Subject: `currency`, the market's, so the prices can be written in it
  - Detail: whichever of `currency`, `half_table_percent`, `groups` (each `{name, conditions, prices}`, the whole list) and `everyone_else` (each tier's `{tier, cents}`) changed; a market never priced is the card's defaults before (CAD, 50, no group, no price), so its first price records only the prices typed
- `floorplan`: saving a location's layout (T257)
  - Subject: `floorplan_id`, and `location`, its location's name
  - Detail: what the save changed, `layout.describe_change`'s fields, with no before and after: `started` (its first save), `added` and `removed` (tables counted per section name), `moved`, `turned` (the short way round, so 359.999° to 0° is no turn) and `retyped` (given another table type; how many tables), `renumbered` (section names), `zones` (added, changed and removed counted), `image` (`"replaced"`), `scale` (metres across to the millimetre, `before` and `after`), `colours` and `labels` (section names); never a table itself, and a save that changes nothing records nothing
  - An entry the beta's save wrote, before this, has `before` and `after`: whichever of `sections`, `locations` and `floorplan_ids` changed, and the saved floorplan's `tables` and `no_go_zones` counted and its `layout_digest`, and earlier still `walls` and `table_types`; it reads as it did
- `floorplan_image_deleted`: deleting a floorplan image
  - Subject: `image_id`
  - Detail: `image_id`, then null
- `floorplan_removed`: a location's layout taken with its location by a plan write or the CSV start, its image deleted with it (T257)
  - Subject: `floorplan_id`, and `location`, its name as the market last held it
  - Detail: `tables`, the layout's table count, then null
- `table_types`: the market's table types replaced by `PUT /markets/:id/table-types` (T257)
  - Detail: `table_types`, before and after, each type `{id, name, size}` with its size in words ("122 x 122 cm"); a write that restates the types records nothing

**`change-form`**

- `form`: the form builder
  - Detail: the changed questions by key, null on the side where a question is absent, and `order` and `unasked_essentials` when they changed; and `rejected`, `returned`: what the rules decided as the form landed
- `review_highlights`: the [review highlights](../../business/rules/review-highlights.md)
  - Detail: `review_highlights`, and `nothing_leads_the_card` when it changed (T206); read "decided nothing leads the card" when it turned true
- `rejection_rules`: the [automatic rejections](../../business/rules/automatic-rejections.md)
  - Detail: `rejection_rules`, and `rejected`, `returned`: how many applications the rules rejected, and returned to undecided, as they were saved
  - Detail: `no_automatic_rejections` when it changed (T206); read "decided no automatic rejections" when it turned true

**`import-applications`**

- `imported`: an import, one entry however many rows; a draft's first import, which takes the market into Review, records that move too, as `move-phase` under the importer
  - Detail: `row_count`, `created`, `updated`, `unchanged`, `skipped`, `returned_to_review`, `rejected_by_rules`, `returned_by_rules`
- `started`: the start from a CSV
  - Detail: `row_count`, `column_count`, `question_count`

**`give-verdicts`**

- `verdict`: one verdict, or a follow-up, on an application not yet approved or rejected
  - Vendors: the applicant
  - Subject: `application_id`
  - Detail: `status`, and `follow_up_owner` (an address) while there is one; and `dealt_to`, the address of the reviewer it was dealt to, when it has one ([the review is dealt among chosen reviewers](../../business/rules/the-review-is-dealt-among-chosen-reviewers.md))
- `verdicts`: a selection's verdict, one entry; `change-verdicts` when any application it wrote was already approved or rejected
  - Vendors: each applicant decided
  - Subject: `application_ids`
  - Detail: by application id, its `status`, and its `follow_up_owner` while there is one, before and after; and `dealt_to` by application id for those that have a reviewer
- `verdict_undone`: its giver taking back their own verdict, or follow-up, within the window ([what each role may do](../../business/rules/what-each-role-may-do.md#why), E38/F10/S01); the verdict keeps its own entry
  - Vendors: the applicant
  - Subject: `application_id`
  - Detail: as a verdict: `status`, and `follow_up_owner` while there is one, before and after, and `dealt_to`
- `verdicts_undone`: a selection's verdict taken back, one entry for what it undid
  - Vendors: each applicant undone
  - Subject: `application_ids`
  - Detail: as a selection's verdict
- `follow_up_owner`: handing a follow-up on
  - Vendors: the applicant
  - Subject: `application_id`
  - Detail: `follow_up_owner`

**`change-verdicts`**

- `verdict`: one verdict, or a follow-up, on an application already approved or rejected, a rule's rejection included (E38/F06/S01)
  - Vendors: the applicant
  - Subject: `application_id`
  - Detail: as `give-verdicts`' `verdict`

**`choose-reviewers`**

- `reviewers`: [choosing or changing the reviewers](../../business/rules/the-review-is-dealt-among-chosen-reviewers.md), only when the set changed
  - Detail: `reviewers`: their addresses, in the order they are dealt to
- `dealt`: the deal a change of reviewers made, one entry, only when it moved any application
  - Vendors: each applicant dealt, in the order of `application_ids`
  - Subject: `application_ids`
  - Detail: `cause: reviewers_changed`; by application id, its `reviewer` (an address, null when undealt), and a removed reviewer's follow-up's `follow_up_owner` beside it, before and after

**`apply`, `import-applications`, `change-form`, `update-vendor-info`**

- `dealt`: the arrivals a write dealt, after that write's own entry, one entry for each actor and action a round of dealing dealt for, and only when it dealt any: an applicant's save (the applicant its actor, their own application alone), an import, and saving the rules or the form, or updating a vendor's info, when the rules returned an application to open
  - Vendors: each applicant dealt, in the order of `application_ids`
  - Subject: `application_ids`
  - Detail: `cause: arrived`; by application id, its `reviewer` before (null) and after

**`move-phase`**

- null: a phase move, by whoever made it
  - Detail: `phase`, and `swept` on the move from offers to market days: how many unanswered offers it turned to refusals; the [phase record](../modules/phase-record.md) stays the state the guards read

**`stop-applications`**

- null: [stopping applications, or taking them again](../../business/flows/taking-applications.md), only when it changed whether they are taken
  - Detail: `applications_stopped`

**`publish-results`**

- null: [publishing results](../../business/rules/publish-results-waits-for-the-allocation.md)
  - Detail: `results_published`

**`add-vendor`**

- null: [adding a vendor who never applied](../../business/rules/adding-a-vendor-who-never-applied.md)
  - Vendors: the vendor
  - Subject: `application_id`
  - Detail: `name`, `status` and `answers`, the price answers given as `{question key: answer}`, null before

**`write-vendor-notes`**

- `note`: the organizer's [note](../../business/rules/vendor-notes.md)
  - Vendors: the vendor
  - Detail: `note`
- `request_handled`: marking a request handled, or not
  - Vendors: the vendor
  - Detail: `handled`

**`update-vendor-info`**

- null, or `kept` when the save only kept updates: [updating a vendor's info](../../business/rules/an-update-is-kept-beside-the-vendors-answer.md), one entry however many answers
  - Vendors: the vendor
  - Subject: `application_id`
  - Detail: the answers it changed by form field key, an essential one by its stored key (the table-share answer's words and the addresses read out of them), as the organizer read them before and after; `kept`, the updates saved as they stood over an answer the vendor changed since, by key with their value, and `kept_over` beside it, what the vendor wrote that each was kept over, by the same keys (a map of its own, so an entry from before it still reads, with the kept rows alone); `matched`, the updates taken away because the answer the vendor changed to is the update itself, by key with that value; and `rejected_by_rules`, `returned_by_rules`, as for `apply`
- `discord_match_declined`: ["Not them"](../modules/discord.md#possible-matches): a member a check offered as a vendor's possible match, said not to be them; confirming one is the update of their answer, recorded as above
  - Vendors: the vendor
  - Subject: `application_id`
  - Detail: the member's `username`, `display_name` and `nick` (each null when none), and the `answer` it was offered for; no before or after, since the vendor's answers are unchanged

**`assign`**

- `placed`, `freed`, `swapped`, `assigned`: a placement, a freed seat, a swap, a run
  - Vendors: as above
  - Subject: the table-day
  - Detail: as above, `placed` with the seat left as `before`
- `rules`: the assignment rules, which ride in the plan
  - Detail: `priority` or `assignment_options`
- `owed_taken_back`: a day seated again, by hand or by a run, taking back the $0 a free's deduction set ([payments](payments.md)), by whoever seated them
  - Vendors: the vendor
  - Subject: `date`, `currency`
  - Detail: `owed_cents`: the $0 taken back, then what the day owes now

**`record-payment`**

- null: [recording a vendor's payment](payments.md)
  - Vendors: the vendor
  - Subject: `payment_id`, `payment_kind` (`payment`), and the market's `currency` (the default, CAD, on a market never priced), which its money reads in
  - Detail: `cents`, `method`, `paid_on` and `note` (when there is one), null before

**`change-owed`**

- `owed_set`, `owed_calculated`: setting a table-day's amount owed, a free's deduction included, or using the calculated price again, only when it changed what the day owes
  - Vendors: the vendor
  - Subject: `date`, `currency`
  - Detail: `owed_cents`

**`adjust-paid`**

- `refund_recorded`, `payment_edited`, `payment_removed`: a refund, or an edit or a removal of an entry
  - Vendors: the vendor
  - Subject: `payment_id`, `payment_kind` (`payment` or `refund`, so an edit that changed no amount still says which), `currency`
  - Detail: the entry's `cents` (negative for a refund), `method`, `paid_on` and `note` that changed: null before for a refund, null after for a removal

**`check-in`**

- `checked_in`, `check_in_undone`: a check-in or its undo, at the organizer's door or by the vendor on their vendor page, only when it changed whether the vendor is here
  - Vendors: the vendor
  - Subject: `date`
  - Detail: `checked_in`, and for the vendor's own, whose actor is null, `via`: `door_code` for a check-in, `vendor_page` for an undo, and `check_in_page` on an entry from the removed public page; the readers word them "with the door code", "on their vendor page" and "on the check-in page"
- `door_code_made`: a new [door code](../modules/attendance-and-door.md#sharp-edges), the first or one that ended the old
  - Detail: `replaced`, whether a code stood before it; never the code

**`connect-discord`**

- `discord_connected`, `discord`, `discord_disconnected`: [the Discord card](../modules/discord.md): connecting, a choice, disconnecting
  - Detail: whichever of `guild_id`, `guild_name`, `role_id`, `role_name`, `username_question`, `username_question_label` (the question's label on the form then, null when none) and `invite_link` changed; the history reads the names and the label, never an id or the key
- `discord_checked`: ["Check Discord"](../modules/discord.md#who-is-in-the-server), one entry a check, even one that changed nobody
  - Vendors: each vendor whose state it changed, in the order of `application_ids`
  - Subject: `application_ids`
  - Detail: by application id, each changed vendor's state (`has_role`, `in_server`, `not_found`, `no_username`) before, null when never checked, and after; `addresses`, each changed vendor's address by application id, since `vendors` leaves out an empty one and so does not pair with the ids by position; and `counts`, how many it found in each state
- `discord_roles_given`: ["Give roles"](../modules/discord.md#giving-the-role), one entry a run, even one that gave nobody the role
  - Vendors: each vendor it gave the role or whose state it changed, in the order of `application_ids`
  - Subject: `application_ids`
  - Detail: `role_name`, the role by its name then; `given`, the application ids it gave the role; by application id, each named vendor's state before and after, and `addresses`, as a check's; and `counts`, how many assigned vendors ended in each outcome (`given`, `already_had`, `not_found`, `no_username`, `not_yet`, `failed`)

**`manage-editors-and-viewers`, or `manage-admins` when an Admin or Owner role is either side**

- `role_given`, `role_changed`, `role_taken`: Manage market's people
  - Subject: `user_id`, `email`
  - Detail: `role`

**`change-the-table`**

- `permission_set`, `permission_reset`: the market's owner setting a row of [its table](../modules/market-actions.md#a-markets-own-rows), or returning it to its built-in default
  - Subject: `action`: the row
  - Detail: `role` and `source` (`built-in`, `organization` or `market`), both always, so a reset that keeps the role still says it
- `permission_table_reset`: the market's owner returning every row it holds to its built-in default, one entry for the one act
  - Detail: by row id, every row it returned, each its `role` and `source` before and after
- `permission_table_copied`: the market's owner copying its organization's default again, one entry for the one act
  - Detail: by row id, every row it changed, each its `role` and `source` before and after

**`apply`**

- `submitted`, `edited`: an applicant's own application ([a vendor signs in before applying](../../business/rules/a-vendor-signs-in-before-applying.md))
  - Vendors: the applicant
  - Subject: `application_id`
  - Detail: the answers that changed, with their values; `rejected_by_rules` and `returned_by_rules`: whether the rules rejected it, or returned it to undecided, as it landed

An undo reads "<actor> undid their verdict on <vendor>: Rejected back to Open", a selection's "undid their verdicts on N applications: …".
A verdict on someone else's share reads "…, dealt to <address>", and nothing is added when its reviewer decided it or it was never dealt; an entry written before reviewers existed reads as it always did.
A `dealt` entry is worded by its kind, whichever action dealt it (an applicant's own arrival as their application dealt, never as their deal), and its vendors and application ids are in the same order, so one vendor's History tab reads that vendor's own line of a deal of many.

### What an organization records

An organization's own changes are entries keyed by `organization_id` (E40/F02/S01), written by `record_for_organization`, which [`back-end/api/organizations.py`](../../../back-end/api/organizations.py), market creation and deletion and [`back-end/api/floorplans_templates.py`](../../../back-end/api/floorplans_templates.py) call once the change has landed, under the same guard as `record`.
An organization has no table of its own, so its actions are the history's own verbs, constants in `history.py`, but for a market deleted from it, which is the table's own row `delete-market`, the verb its check asked; the kinds and details are a market's where the change is the same.
None names a vendor.

One block per action, in the order its constants stand in `history.py`; a new kind is one item at the end of its action's block, and a new verb a block at the end ([two features never share a line](../conventions/two-features-never-share-a-line.md#the-markets-history)); a kind with no Subject line has an empty subject.

**`change-organization`**

- `renamed`: renaming the organization
  - Detail: `name`

**`manage-organization-admins`**

- `role_given`, `role_changed`, `role_taken`: an admin added, a member made an admin, an admin removed
  - Subject: `user_id`, `email`
  - Detail: `role`: `admin`, `member`, or null

**`manage-organization-members`**

- `role_given`, `role_taken`: a member added or removed
  - Subject: `user_id`, `email`
  - Detail: `role`: `member`, or null

**`transfer-organization`**

- null: ownership handed on, one entry for the one act
  - Subject: `user_id`, `email` of the new owner
  - Detail: `owner`: the old owner's address and the new one's

**`create-market`**

- null: a market created in the organization
  - Subject: `market_id`
  - Detail: `name`, null before

**`delete-market`**

- null: a market of the organization deleted (Manage market's Delete), only by the deletion that took it; its own history goes with it, so its organization's keeps that it went
  - Subject: `market_id`
  - Detail: `name`, null after

**`manage-floorplan-templates`**

- `template_added`, `template_changed`, `template_removed`; `template_moved_out` and `template_moved_in`: a floorplan template filed under the organization; one filed under another organization, or none, records leaving in the one it left and arriving in the one it is filed under, neither naming the other
  - Subject: `template_id`, `name` as it is after (as it was, for one removed)
  - Detail: `name` added or removed; the changed fields of `name`, `table_types` and `aisles`, never an organization's id; a move that changed nothing else, empty

**`change-the-default`**

- `permission_set`, `permission_reset`: its owner or an admin setting a row of [the organization's default table](organization-document.md#its-default-table), or returning it to its built-in default
  - Subject: `action`: the row
  - Detail: `role` and `source` (`built-in` or `organization`)
- `permission_table_reset`: every row of the default returned to its built-in default, one entry for the one act
  - Detail: by row id, every row it returned, each its `role` and `source` before and after

[`back-end/tests/test_the_organizations_history.py`](../../../back-end/tests/test_the_organizations_history.py) makes each change and asserts its one entry (a template's in [`back-end/tests/test_floorplan_template_access.py`](../../../back-end/tests/test_floorplan_template_access.py)), and fails on a write route under `/organizations` or `/floorplans/templates` that neither records nor says why not; creating an organization and deleting one record nothing.

No rule is a person, so a rule's verdict is never an entry of its own: the write that judged counts what the rules did in its own entry, as the form, the rules, an applicant's save and an import (`rejected_by_rules`, `returned_by_rules`) do, and a move counts the offers it swept.

Not recorded, each for its reason in `NOT_A_CHANGE` and `NOT_RECORDED` of [`back-end/tests/test_every_write_records.py`](../../../back-end/tests/test_every_write_records.py): a review claim ([ADR 0014](../../adr/0014-reviewers-claim-and-a-verdict-is-a-conditional-write.md)), which is who holds a card open and not a change; reads and exports; a vendor signing in or out; a market's creation, whose own history starts empty and which [its organization's history](#what-an-organization-records) records; its deletion, which takes the history with it while its organization's history keeps that it went (the [deletion trail](../modules/market-deletion.md) records a market only when its organization is deleted); the floorplan routes that keep nothing, or an upload the market uses only once a layout is saved; and starting Discord's approval screen, which keeps a state in the person's session and nothing on the market.
Two rows record nothing of their own: "Update info the assignment or price reads", asked beside "Update a vendor's info" by the same write, which records it under that row, and who may be chosen as a reviewer, which changes nothing itself.
That test sends every write route as the screen sends it and asserts its one entry; it fails on a market write route, or a row of the table, that records nothing without saying why there, and on an entry Mongo could not store.

**Entries are stored structured, never as a sentence**: the wording belongs to the surface showing it, [`front-end/src/utils/marketHistory.ts`](../../../front-end/src/utils/marketHistory.ts), which composes each area's words from its own file under [`historyReaders/`](../../../front-end/src/utils/historyReaders/) ([two features never share a line](../conventions/two-features-never-share-a-line.md#the-historys-words)), a placement's among them, and must be changeable without a migration.

**Writing an entry never fails the change it records.**
Every write records after its change has landed (the placement writes in `api/placements.py`, [placements](../modules/placements.md), after the seat is taken), and `record` logs and swallows its own failure: telling an organizer their change did not land when it did is worse than a missing entry.
A subject or a detail that reads or computes anything is given to `record` as a builder, a callable it runs inside the same guard as the insert, since one that raised before it got there would answer the change with a 500 just the same.
The failure is logged by the error's type, the kind and the market's id only, never its message: a driver's message can quote the document it refused, and an entry holds answers and addresses.

**Recording who** attaches an organizer's identity to a market that may be exported, shared or handed to a successor organizer.
That was weighed and accepted for the placements when the trail was decided, and widened to every change on Daniel's word (Q23).

## Reading it

**Every reader asks the row "Read the market's history"** (`read-history`, Viewer by default, [the market's actions](../modules/market-actions.md)): by default, anyone who may read the market may read who changed it.

**The whole history is read a page at a time**: `GET /markets/:id/history` (`get_history` in [`back-end/api/markets.py`](../../../back-end/api/markets.py)) serves `entries_page`, the newest `PAGE_SIZE` (25, since the box the list stands in, not the page, keeps the section short) entries and `next`, a cursor naming the last one (`<at>|<id>`), which `?before=` hands back for the page after it.
Entries are ordered by `at`, then `id`, both descending, so a page boundary between two entries of one instant neither loses nor repeats either, and the [lookup index](lookup-indexes.md) on (`market_id`, `at`, `id`) is that order read backwards: the first page of a market with thousands of entries is one query that walks a page of index keys and stops (`TestThousandsOfEntries` in [`back-end/tests/test_reading_the_history.py`](../../../back-end/tests/test_reading_the_history.py) seeds 5,000).
It narrows by `?actor=`, `?group=` (a group of the table's rows, its actions' ids; an applicant's own `apply` is an Applications change, a free's $0 taken back (`assign`, `owed_taken_back`) is a Payments change too, beside the `change-owed` it undoes (`_HISTORY_GROUP_ALSO_READS`), and the Reading group is never one), `?vendor=`, `?since=` and `?until=` (ISO instants of when the change was made, the first kept and the second not), and `?day=` (a market day, `YYYY-MM-DD`: the entries whose `subject.date` is that day and the entries about no one day, a run and the rules, which have none); a filter it cannot read answers 400, a `day` that is not a calendar day in that spelling with "The history's dates could not be read."
A filter on anything but the market and the time is applied as Mongo walks the index, so a narrow filter on a long history reads further than one page, and `day` has no index of its own for that reason, as `actor` and `group` have none; it asks Mongo for one entry past the page, to know whether another follows, and answers no more than `PAGE_SIZE`.
The first page also answers what the filters may offer: `actors`, everyone who changed something as an organizer, the unmoved placements' organizers too (an applicant's own change is found by the vendor it names, and a check-in from the public page names nobody), and `groups`, the table's groups with their rows' ids and labels, but for who may be chosen as a reviewer (`review-when-chosen`, `history_groups`), a row nothing is recorded under; `delete-market` and `update-assignment-or-price-info`, which no market entry is recorded under either, are still offered.
Only an entry's own fields are recased to camelCase; its `subject` and `detail` are served as stored, since their keys are data (a question's key, an application's id).
Until a database has run the migration, its unmoved placements are read beside the history here too, each given `action: assign` and its subject, merged by the same order, and an entry in both read once; having no stored subject, they are narrowed to a market day by their `detail.date`.
A list that shows the market day above each sentence sets `dayLeads` in its `HistoryContext`, so `sentence()`'s `onDay` says no day and `entryDay` in [`marketHistory.ts`](../../../front-end/src/utils/marketHistory.ts) draws it, "Every market day" for an entry with no `subject.date`; Assignment history is the one that does.
Organizers read it in Manage market's History section, one vendor's, `?vendor=` and no other filter, in that vendor's drawer ([reading the market's history](../../business/flows/reading-the-markets-history.md)), and the Assignment group in Assignment history, `?group=Assignment` on every read, so the dialog and Manage market's History narrowed to that group answer alike; a run names nobody, so it is never in a vendor's list.

There was a second read of the placements, `GET /markets/:id/placement-history`, until T224 retired it ([ADR 0017](../../adr/0017-one-history-for-every-change.md)).

**Every reader of the history is one of the market's readers**, behind its history's row, never a vendor's own: an entry names a vendor in `vendors` whether or not it is one they may see (a verdict before results are published, the organizer's note, a follow-up's owner), so reading by vendor is the organizer's view of that vendor, and no applicant endpoint reads the history.

`GET /markets/:id/permission-history` (`get_permission_history`) serves `permission_entries`: the history narrowed to the changes to the market's table ([what each role may do](../../business/rules/what-each-role-may-do.md)), newest first, each with `id`, `marketId`, `actor`, `at`, `action`, `kind`, `subject` and `detail`, the whole entry camelCased, its subject and detail too; it asks the same row, the history's, and Manage market's Permissions dialog words it ([`front-end/src/utils/permissionTable.ts`](../../../front-end/src/utils/permissionTable.ts)).

An organization's own history is read the same way, a page at a time, newest first, by `organization_entries_page` on the [lookup index](lookup-indexes.md) (`organization_id`, `at`, `id`), served by `GET /organizations/:id/history` to the organization's owner, admins and members ([the organization document](organization-document.md#the-organizations-history)); Manage organization's History section words it with the same `marketHistory.ts`.
`GET /organizations/:id/default-permission-history` (`get_default_permission_history`) serves `default_permission_entries`, the organization's history narrowed to `change-the-default`, newest first, to the same people, for the default table's own changes in Manage organization.

A market's history is deleted with the market (`delete_for_market`, called by [`back-end/market_deletion.py`](../../../back-end/market_deletion.py)), and an organization's own with the organization (`delete_for_organization`, called by `delete_organization` after the deletion trail is written and the organization's markets are deleted).
The organizer reads the placements as [the assignment history](../../business/flows/placing-by-hand.md#j13-assignment-history).

## The move from `placement_history`

Until E40 the entries lived in the `placement_history` collection, without `action` or `subject`.
[`back-end/migrations/migrate_placement_history.py`](../../../back-end/migrations/migrate_placement_history.py) moves each into `history` with every field it had (its `_id` too), adds `action: assign` and the subject read from its detail, and drops the old collection once it is empty.
It writes each entry by its `_id` before deleting it from the old collection, so a second run, or one after a run that stopped part-way, moves only what is left and doubles nothing; `--dry-run` reports the count and writes nothing.
Run it after the release that carries `history.py` is deployed, so the old build writes nothing behind it ([RELEASING.md](../../RELEASING.md#pre-deploy-database-migrations)), whenever is convenient.
Until it runs, `entries_page` reads `placement_history` beside `history` ([reading it](#reading-it)), so the older placements still show from the deploy on.
An entry can be in both for a moment, since the migration writes each one to `history` before deleting it from the old collection and a run can stop between the two, so an old entry whose `id` `history` already holds is read once.
`delete_for_market` deletes a market's entries from both.
A later release removes the fallback once every database is moved.
