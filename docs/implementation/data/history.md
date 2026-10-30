---
layer: implementation
kind: data
describes:
  - back-end/history.py
  - back-end/api/markets.py#get_placement_history
  - back-end/api/markets.py#get_permission_history
  - back-end/migrations/migrate_placement_history.py
  - back-end/tests/test_every_write_records.py
verified: 2026-10-30
sources:
  - wayfinding/readable-journey/08
  - E40/F01/S01
  - E40/F01/S02
  - E39/F01/S03
  - E39/F01/S04
  - E41/F01/S01
  - E38/F04/S02
  - E44/F01/S01
  - E44/F01/S02
---

# The market's history

The `history` collection: every change on a market, who made it, and when.
[`back-end/history.py`](../../../back-end/history.py) owns it, and every reader and writer goes through it.
It began as the placement history, because a placement that differs from what the solver produced is a fact someone will later ask about, and a flag saying "hand-placed" cannot answer it.

**Every change, in one history.**
The placement history kept placements only, on the view that a narrow trail that gets read beats a general one that gets ignored.
Daniel widened it (T92, Q23: "yes every change is logged"): an organizer investigating a problem or a mistake asks who did what on the market, whatever it was, and one history answers that where several partial records would each answer part of it.
The decision, and what stays state and what stays apart, is [ADR 0017](../../adr/0017-one-history-for-every-change.md).
Every write that changes a market, its applications or its vendors records one entry into it (E40/F01/S02), once its change has landed, under the E39 action its check asked; [what each write records](#what-each-write-records) lists them.

The glossary concepts: [Assignment](../../business/concepts/assignment.md) and [Placement and pin](../../business/concepts/placement-and-pin.md).

## An entry

Stored snake_case with the market foreign key `market_id`, like applications and unlike markets:

| Field | What it is |
| --- | --- |
| `id` | a UUID |
| `market_id` | the market |
| `actor` | the address of the signed-in person who made the change; an applicant's own when they submit or edit their application; null for a check-in made on the vendors' public check-in page, which asks only an address and a date and so proves nobody (its detail says `via: check_in_page`) |
| `at` | ISO 8601, UTC |
| `action` | the id of the [E39 action](../modules/market-actions.md) the change was, the verb its check asked: `assign` for a placement; `apply` for an applicant's own change, which no row asks |
| `kind` | the finer kind where one action covers several changes, else null: a placement's is `placed`, `freed`, `swapped` or `assigned` |
| `vendors` | the lowercased addresses the entry is about, empty for a run |
| `subject` | what else the entry is about; a placement's is its table-day, `{date, table_codes}`, and a run's is empty |
| `detail` | structured, per kind: the date, table code and table choice placed, and the seat left; the date and table freed; the date and both seats swapped; how many placements a run wrote and how many pins it kept |

`record(market_id, actor, action, kind=, vendors=, subject=, detail=)` writes one, and `record_applicant` writes an applicant's own; the placement writes call `record_placed`, `record_freed`, `record_swapped` and `record_assignment_run`, which build the detail and its subject (`placement_subject`).
Every other kind of change gives its detail the changed fields before and after, never a whole document: `changes(before, after)` keeps the fields that differ, and answers None when none does; a detail that builds to None records nothing, so a write that restates what is stored (the plan's autosave, a note saved unchanged, a vendor checked in again) records nothing.
An import, the start from a CSV and a run record their counts instead, and a verdict is recorded whole each time it is given, since each one is.
**The placement kinds are the one exception**: their details keep the shapes they had before the history widened, because the entries moved from `placement_history` have no before to give and the placement endpoint answers as it did.
A `placed` entry written since adds one key, `before`: the seat the vendor left on that date (`table_code`, `table_choice`), null when they had none, so a move reads from one seat to the other; an older `placed` entry has no `before` key at all, which says the seat left is unknown, not that there was none.

**A run is one entry**, not none and not one per placement.
Leaving runs out would make the history lie by omission, since a placement changed between two hand edits would have no explanation; one entry per placement would drown the hand edits, which are the entries anyone reads.
A swap is one entry too, because it was one action.

## What each write records

The kinds are constants in `history.py`; a dash is an empty list or subject.

| Action | Kind | The write | Vendors | Subject | Detail |
| --- | --- | --- | --- | --- | --- |
| `change-setup` | `renamed` | renaming a draft | - | - | `name` |
| `change-setup` | `plan` | a Market Setup card, or the intake mode (`PUT /markets/:id/plan`) | - | - | whichever of `market_dates`, `tiers`, `locations`, `sections`, `floorplans` and `intake_mode` changed |
| `change-setup` | `pricing` | the Pricing card, in the same plan write ([a price follows the table](../../business/rules/a-price-follows-the-table.md)) | - | - | whichever of `currency`, `half_table_percent` and `everyone_else` (each tier's `{tier, cents}`) changed; every one null before on a market never priced |
| `change-setup` | `floorplan` | saving a floorplan to the market | - | `floorplan_id` | whichever of `sections`, `locations` and `floorplan_ids` changed |
| `change-setup` | `floorplan_image_deleted` | deleting a floorplan image | - | `image_id` | `image_id`, then null |
| `change-form` | `form` | the form builder | - | - | the changed questions by key, null on the side where a question is absent, and `order` and `unasked_essentials` when they changed; and `rejected`, `returned`: what the rules decided as the form landed |
| `change-form` | `review_highlights` | the [review highlights](../../business/rules/review-highlights.md) | - | - | `review_highlights` |
| `change-form` | `rejection_rules` | the [automatic rejections](../../business/rules/automatic-rejections.md) | - | - | `rejection_rules`, and `rejected`, `returned`: how many applications the rules rejected, and returned to undecided, as they were saved |
| `import-applications` | `imported` | an import, one entry however many rows; a draft's first import, which takes the market into Review, records that move too, as `move-phase` under the importer | - | - | `row_count`, `created`, `updated`, `unchanged`, `skipped`, `returned_to_review`, `rejected_by_rules`, `returned_by_rules` |
| `import-applications` | `started` | the start from a CSV | - | - | `row_count`, `column_count`, `question_count` |
| `give-verdicts` | `verdict` | one verdict, or a follow-up | the applicant | `application_id` | `status`, and `follow_up_owner` (an address) while there is one |
| `give-verdicts` | `verdicts` | a selection's verdict, one entry | each applicant decided | `application_ids` | by application id, its `status`, and its `follow_up_owner` while there is one, before and after |
| `give-verdicts` | `follow_up_owner` | handing a follow-up on | the applicant | `application_id` | `follow_up_owner` |
| `move-phase` | null | a phase move, by whoever made it | - | - | `phase`, and `swept` on the move from offers to market days: how many unanswered offers it turned to refusals; the [phase record](../modules/phase-record.md) stays the state the guards read |
| `stop-applications` | null | [stopping applications, or taking them again](../../business/flows/taking-applications.md), only when it changed whether they are taken | - | - | `applications_stopped` |
| `publish-results` | null | [publishing results](../../business/rules/publish-results-waits-for-the-allocation.md) | - | - | `results_published` |
| `add-vendor` | null | [adding a vendor who never applied](../../business/rules/adding-a-vendor-who-never-applied.md) | the vendor | `application_id` | `name` and `status`, null before |
| `update-vendor-info` | null | [updating a vendor's info](../../business/rules/an-update-is-kept-beside-the-vendors-answer.md), one entry however many answers | the vendor | `application_id` | the answers it changed by form field key, as the organizer read them before and after; and `rejected_by_rules`, `returned_by_rules`, as for `apply` |
| `write-vendor-notes` | `note` | the organizer's [note](../../business/rules/vendor-notes.md) | the vendor | - | `note` |
| `write-vendor-notes` | `request_handled` | marking a request handled, or not | the vendor | - | `handled` |
| `assign` | `placed`, `freed`, `swapped`, `assigned` | a placement, a freed seat, a swap, a run | as above | the table-day | as above, `placed` with the seat left as `before` |
| `assign` | `rules` | the assignment rules, which ride in the plan | - | - | `priority` or `assignment_options` |
| `record-payment` | null | [recording a vendor's payment](payments.md) | the vendor | `payment_id` | `cents`, `method`, `paid_on` and `note` (when there is one), null before |
| `change-owed` | `owed_set`, `owed_calculated` | setting a table-day's amount owed, a free's deduction included, or using the calculated price again, only when it changed what the day owes | the vendor | `date` | `owed_cents` |
| `adjust-paid` | `refund_recorded`, `payment_edited`, `payment_removed` | a refund, or an edit or a removal of an entry | the vendor | `payment_id` | the entry's `cents` (negative for a refund), `method`, `paid_on` and `note` that changed: null before for a refund, null after for a removal |
| `check-in` | `checked_in`, `check_in_undone` | a check-in or its undo, at the organizer's door or the public check-in page, only when it changed whether the vendor is here | the vendor | `date` | `checked_in`, and `via: check_in_page` from the public page, whose actor is null |
| `manage-editors-and-viewers`, or `manage-admins` when an Admin or Owner role is either side | `role_given`, `role_changed`, `role_taken` | Manage market's people | - | `user_id`, `email` | `role` |
| `change-the-table` | `permission_set`, `permission_reset` | the market's owner setting a row of [its table](../modules/market-actions.md#a-markets-own-rows), or returning it to its built-in default | - | `action`: the row | `role` and `source` (`built-in`, `organization` or `market`), both always, so a reset that keeps the role still says it |
| `change-the-table` | `permission_table_reset` | the market's owner returning every row it holds to its built-in default, one entry for the one act | - | - | by row id, every row it returned, each its `role` and `source` before and after |
| `apply` | `submitted`, `edited` | an applicant's own application ([a vendor signs in before applying](../../business/rules/a-vendor-signs-in-before-applying.md)) | the applicant | `application_id` | the answers that changed, with their values; `rejected_by_rules` and `returned_by_rules`: whether the rules rejected it, or returned it to undecided, as it landed |

No rule is a person, so a rule's verdict is never an entry of its own: the write that judged counts what the rules did in its own entry, as the form, the rules, an applicant's save and an import (`rejected_by_rules`, `returned_by_rules`) do, and a move counts the offers it swept.

Not recorded, each for its reason in `NOT_A_CHANGE` and `NOT_RECORDED` of [`back-end/tests/test_every_write_records.py`](../../../back-end/tests/test_every_write_records.py): a review claim ([ADR 0014](../../adr/0014-reviewers-claim-and-a-verdict-is-a-conditional-write.md)), which is who holds a card open and not a change; reads and exports; a vendor signing in; a market's creation, whose history starts empty; its deletion, which takes the history with it while the [deletion trail](../modules/market-deletion.md) records it; and the floorplan routes that keep nothing, or an upload the market uses only once a floorplan is saved.
That test sends every write route as the screen sends it and asserts its one entry; it fails on a market write route, or a row of the table, that records nothing without saying why there, and on an entry Mongo could not store.

**Entries are stored structured, never as a sentence**: the wording belongs to the surface showing it, [`front-end/src/utils/placementHistory.ts`](../../../front-end/src/utils/placementHistory.ts) for the placements, and must be changeable without a migration.

**Writing an entry never fails the change it records.**
Every write records after its change has landed (the placement writes in `api/placements.py`, [placements](../modules/placements.md), after the seat is taken), and `record` logs and swallows its own failure: telling an organizer their change did not land when it did is worse than a missing entry.
A subject or a detail that reads or computes anything is given to `record` as a builder, a callable it runs inside the same guard as the insert, since one that raised before it got there would answer the change with a 500 just the same.
The failure is logged by the error's type, the kind and the market's id only, never its message: a driver's message can quote the document it refused, and an entry holds answers and addresses.

**Recording who** attaches an organizer's identity to a market that may be exported, shared or handed to a successor organizer.
That was weighed and accepted for the placements when the trail was decided, and widened to every change on Daniel's word (Q23).

## Reading it

`GET /markets/:id/placement-history` (`get_placement_history` in [`back-end/api/markets.py`](../../../back-end/api/markets.py)) serves `placement_entries`: the history narrowed to the `assign` action's placement kinds, newest first, each entry with only the fields it had before the widening (`id`, `market_id`, `actor`, `at`, `kind`, `vendors`, `detail`), so the drawer's History tab reads exactly what it always did.
It is read at VIEWER: anyone who may see where vendors sit may see how they came to sit there.
`?vendor=` narrows it to the entries naming one person, for their detail panel; a run names nobody, so it is never in a vendor's list.
The answer carries the vendors' names against their addresses, so the trail reads as people.
`market_id` is a [lookup index](lookup-indexes.md).

**Every reader of the history is one of the market's readers**, behind its Read row, never a vendor's own: an entry names a vendor in `vendors` whether or not it is one they may see (a verdict before results are published, the organizer's note, a follow-up's owner), so reading by vendor is the organizer's view of that vendor, and no applicant endpoint reads the history.

`GET /markets/:id/permission-history` (`get_permission_history`) serves `permission_entries`: the history narrowed to the changes to the market's table ([what each role may do](../../business/rules/what-each-role-may-do.md)), newest first, each with `id`, `market_id`, `actor`, `at`, `action`, `kind`, `subject` and `detail`, read at VIEWER like the placements; Manage market's Permissions section words it ([`front-end/src/utils/permissionTable.ts`](../../../front-end/src/utils/permissionTable.ts)).

A market's history is deleted with the market (`delete_for_market`, called by [`back-end/market_deletion.py`](../../../back-end/market_deletion.py)).
The organizer reads the placements as [the assignment history](../../business/flows/placing-by-hand.md#j13-assignment-history).

## The move from `placement_history`

Until E40 the entries lived in the `placement_history` collection, without `action` or `subject`.
[`back-end/migrations/migrate_placement_history.py`](../../../back-end/migrations/migrate_placement_history.py) moves each into `history` with every field it had (its `_id` too), adds `action: assign` and the subject read from its detail, and drops the old collection once it is empty.
It writes each entry by its `_id` before deleting it from the old collection, so a second run, or one after a run that stopped part-way, moves only what is left and doubles nothing; `--dry-run` reports the count and writes nothing.
Run it after the release that carries `history.py` is deployed, so the old build writes nothing behind it ([RELEASING.md](../../RELEASING.md#pre-deploy-database-migrations)), whenever is convenient.
Until it runs, `placement_entries` reads `placement_history` beside `history` (the same narrowing without `action`, which the old entries lack, and the same fields), merged newest first, so the History tab answers as before from the deploy on.
An entry can be in both for a moment, since the migration writes each one to `history` before deleting it from the old collection and a run can stop between the two, so an old entry whose `id` `history` already holds is left out.
`delete_for_market` deletes a market's entries from both.
A later release removes the fallback once every database is moved.
