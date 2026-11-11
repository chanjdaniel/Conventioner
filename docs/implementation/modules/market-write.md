---
layer: implementation
kind: module
describes:
  - back-end/market_write.py
  - back-end/market_documents.py#market_from_document
  - back-end/api/markets.py#rename_market
  - back-end/api/markets.py#save_review_highlights
  - back-end/api/markets.py#save_rejection_rules
  - back-end/api/markets.py#set_permission
  - back-end/api/markets.py#reset_permission
  - back-end/api/markets.py#reset_permissions
  - back-end/api/markets.py#copy_organization_default
  - back-end/api/markets.py#add_market_role
  - back-end/api/markets.py#remove_market_role
  - back-end/api/markets.py#update_market_role
  - back-end/api/markets.py#apply_phase_transition
  - back-end/api/markets.py#write_application_form
  - back-end/api/markets.py#save_plan
  - back-end/api/floorplans_save.py#save_floorplan_to_market
  - back-end/api/placements.py#_store_vendor_assignments
  - back-end/api/applicants.py#publish_results
  - back-end/api/applicants.py#set_applications_stopped
  - back-end/api/door.py#make_door_code
  - back-end/api/discord_connection.py#RolesGivenOnAChangedMarket
  - back-end/csv_import.py#save_mapping
  - back-end/csv_start.py#confirm
  - back-end/tests/test_every_market_write_holds_what_it_read.py
  - back-end/tests/test_the_market_write.py
  - back-end/tests/real_mongo/test_the_market_write.py
  - back-end/tests/real_mongo/test_a_judged_write_lands_only_on_the_market_it_judged.py
  - back-end/tests/real_mongo/test_every_held_write_is_refused_on_a_changed_market.py
  - back-end/tests/real_mongo/test_roles_written_per_person.py
  - back-end/tests/real_mongo/test_an_assignment_write_holds_the_market_it_read.py
  - back-end/tests/real_mongo/test_the_form_holds_its_revision.py
  - back-end/tests/real_mongo/test_the_plan_holds_its_revision.py
  - front-end/src/utils/api.ts#isMarketChanged
  - front-end/src/utils/api.ts#onMarketChanged
  - front-end/src/stores/market.ts#installMarketChanged
  - front-end/src/utils/savedOnTheMarket.ts#useSavedOnTheMarket
  - front-end/src/__tests__/aMarketThatChangedUnderAWrite.test.ts
  - front-end/src/__tests__/manageMarketMeetsAChangedMarket.test.ts
  - front-end/src/views/ResultView.vue#runPlacementChange
  - front-end/src/components/MarketPermissions.vue
  - front-end/src/views/ManageMarketOverlay.vue#handleRename
  - front-end/src/__tests__/aPlacementThatMetAChangedMarket.test.ts
  - front-end/src/__tests__/aFormSaveThatMetAChangedMarket.test.ts
  - front-end/src/__tests__/aStartThatMetAChangedMarket.test.ts
  - front-end/e2e/helpers/saveApplicationForm.ts
  - front-end/e2e/helpers/savePlan.ts
  - front-end/e2e/a-plan-save-from-an-older-tab.spec.ts
verified: 2026-11-11
sources:
  - T244
  - T274
---

# The market write

[`back-end/market_write.py`](../../../back-end/market_write.py) is the one place a judged write to a market is made: `write_market` lands only on the market as the request read it, or stores nothing and answers one 409.
A request reads a market, judges a rule on it (the phase allows this, the review is open), then writes; a write by id alone stored whatever it carried over whatever changed in between, so a rename judged on a draft could land on a market that had opened applications a moment before.
The decision, and why one helper: [ADR 0024](../../adr/0024-a-market-write-holds-what-it-read.md).

## The interface

```python
write_market(as_read, update, *, holds=(), revisions=None, counts=()) -> Written
```

- `as_read` is the market as the request read it: a `Market` a loader parsed, or a raw document a caller read itself.
- `update` is the update document, as `update_one` would take it.
- `holds` names stored keys, in their canonical spelling (`market_doc_key`), dotted for a nested one.
- `revisions` maps a counter key to the revision the writer stood on; `counts` names counter keys counted up and not held.
- `Written.revisions` is every key of `revisions` and `counts` as the server stored it after the write.

## What a write holds

**Always the market's `id` and its stored `phase` as read**, `{"$exists": false}` when the read had none, so a write a phase rule judged never lands after a move, an archive or a return to draft.

**Each key in `holds` at its value as read**: equal to it, `{"$exists": false}` when the read had no such key (a key written null since is a change), and a null matching null or missing, as the server reads an equality.
A key under a null or scalar parent reads as absent, as the server reads it.
A sub-document is held by equality, which the server reads in field order; that is safe because the value is the server's own, read back in the order it is stored.
A path through a list is refused with `RuntimeError`: a dotted filter matches any element there, so equality would not hold it.

**Each key in `revisions` at the revision the writer stood on**, `{"$in": [null, 0]}` for 0 or none, so a market that never stored one matches; the write counts it up by one.
Each key in `counts` is counted up by one and not held.
An update that counts one of those keys itself is refused with `RuntimeError`.

**One round trip**: the write is one `find_one_and_update` answering the document after it, projected to the counted keys, so no other request lands between a check and a write.

## What it answers

- A write that matched answers `Written`.
- No match, and the market is gone: `MarketNotFoundError`, "Market not found", 404.
  The class lives here, and `api/markets.py` imports it, since `market_write` cannot import the markets API.
- No match, and the market is there: `MarketChanged`, a `ConflictError`, carrying `latest`, the market as it now stands.
  Its body is `{"error": MARKET_CHANGED, "code": "market_changed"}`, status 409 ([an exception never reaches a client](../conventions/an-exception-never-reaches-a-client.md#the-types)).
- `MARKET_CHANGED` is the one sentence: "This market changed while you were working on it, so your change was not saved. Reload to see the latest, then make your change again."

A refused write stores nothing and records no history entry, since each writer calls `History.record` after `write_market` returns ([the market's history](../data/history.md)).

## The market as read

`market_from_document` ([`back-end/market_documents.py`](../../../back-end/market_documents.py)) keeps the stored document it parsed on the `Market`, as the private attribute `_stored_document`, which `model_copy` carries and no dump serves ([the market document](../data/market-document.md#parsing-a-stored-market)).
It is the document itself, not a copy, so a caller must never change a document a loader handed it.
`document_as_read(as_read)` hands it back, for a writer that decides what it holds by what was stored: the permission rows ask it whether the stored rows are a map.
A `Market` built in code has none, and `write_market` given one raises `RuntimeError`, which answers 500 and is logged: it is a programming error, never a client's.

A hermetic test that replaces `api.markets.markets_collection` with a fake replaces `market_write.markets_collection` too, since the helper holds its own handle.
A test that hands a write a `Market` built in code, and was not testing the write, stubs `write_market` where it once stubbed `update_one`.
The shared markets fakes answer `find_one_and_update` as the server does ([the real-MongoDB suite](../testing/real-mongo-suite.md)).

## Who writes through it

In [`back-end/api/markets.py`](../../../back-end/api/markets.py):

- The rename (`rename_market`), holding the phase alone: a rename landing after the market left draft would move the public address it handed out.
  The unique slug index still settles two renames to one address, answered as the address clash.
- The review highlights (`save_review_highlights`) and the automatic rejections (`save_rejection_rules`), holding the phase alone, since the review's open state is the phase.
  A rules save refused stores no rules and judges no application again.
- The four writes to the market's permission table (`set_permission`, `reset_permission`, `reset_permissions`, `copy_organization_default`), each holding every row it changes, `permissions.<row id>`, as read, so a row the owner changed in another tab meanwhile is not overwritten and the history's "before" is the row that stood.
  Where the stored `permissions` is not a map (null, a string), a set or a copy replaces it whole, so it is held whole; the market as read answers which, with no read of its own.
- The three role writes (`add_market_role`, `update_market_role`, `remove_market_role`), each setting or unsetting one person's key, `roles.<user id>`, never the whole map, and holding, beside the phase, that person's role and the requester's as read (absent when the requester's right comes through the organization), so an admin taking someone's access while another gives a third person access both land, and a role taken never comes back ([what each role may do](../../business/rules/what-each-role-may-do.md)).
  A decision that counted the owners (giving or changing to Owner, taking an Owner) holds `roles` whole; no route reaches such a write today, since the market model refuses a market with no owner or two, and the Admin row and "Market already has an owner" refuse every give of Owner.
  A take refused because the person's role is already gone answers the 404 "They no longer have a role on this market.", which Manage market reads as done.
- The form write (`write_application_form`), holding the form's revision, see [the form's revision](#the-forms-revision) below.
- The plan write (`save_plan`), holding the plan's revision and `resultsPublished`, see [the plan's revision](#the-plans-revision) below.
- The phase move (`apply_phase_transition`), holding the facts its guards passed on that another write changes without moving the phase (`_what_the_move_stood_on`: `resultsPublished` for Back to review, `formRevision` and `planRevision` for Open applications).
  The rail shows a refused move as a blocker beside the phase the market is in, so the move answers `MarketChanged` in those terms, read from its `latest`: `PhaseChangedUnderRequest` when the phase moved, `MoveBlockedUnderRequest` with the blockers the move meets now when it did not, or, when the move's guards pass on the market as it now stands, one blocker `market_changed` in the one sentence ([the guards](guards.md)).

Elsewhere:

- Publish results (`publish_results` in [`back-end/api/applicants.py`](../../../back-end/api/applicants.py)), holding `resultsPublished` and `assignmentObject.revision`: an allocation stored after Publish judged the one it read current refuses the publish, and Back to review, which moves the phase, never crosses it ([Publish results waits for the allocation](../../business/rules/publish-results-waits-for-the-allocation.md)).
- Stop or take applications (`set_applications_stopped`), holding `intakeMode`.
- The door code (`make_door_code` in [`back-end/api/door.py`](../../../back-end/api/door.py)), holding the phase alone, so a market archived since it was loaded gets no code.
- The Discord connection ([`back-end/api/discord_connection.py`](../../../back-end/api/discord_connection.py), [the Discord connection](discord.md)): the check and the run hold the server, the role and the username question they read the members against (the check its `checkedAt` too), declining a possible match holds the server, and the card's save and a connection hold each field they change, or `discord` whole on a market never connected.
  The run gives its roles in Discord before it writes, so its refusal, `RolesGivenOnAChangedMarket`, is a `MarketChanged` in its own words: "The Discord card changed while roles were being given. The roles given are in the market's history; check Discord again."
- The import's saved mapping (`save_mapping` in [`back-end/csv_import.py`](../../../back-end/csv_import.py)), holding `importMapping`, written before any row, so an import meeting a market that moved, or another import's mapping saved since, writes no application ([the CSV import](csv-import.md)).
- The start from a CSV (`confirm` in [`back-end/csv_start.py`](../../../back-end/csv_start.py)), holding `applicationForm` as read, which the start judged had no questions of its own, and counting `formRevision`, since it writes the questions; it writes the plan too, built on the plan as read, so it holds `planRevision` at its value as read and counts it ([the CSV proposal and start](csv-proposal-and-start.md)).
- The floorplan save (`save_floorplan_to_market` in [`back-end/api/floorplans_save.py`](../../../back-end/api/floorplans_save.py)), which writes the plan through the plan's own judge, holding the phase and `planRevision` as read and counting it ([floorplan placement](floorplan-placement.md)).
- Every write of the assignment, a run, a placement, a free and a swap (`_store_vendor_assignments` in [`back-end/api/placements.py`](../../../back-end/api/placements.py)), counting `assignmentObject.revision` from the one read; a run also holds `resultsPublished`, so an allocation never lands after Publish results, and no placement lands on a market archived a moment before ([placements](placements.md#the-four-doors)).
  The Tables page reads its grid again on the refusal and says the sentence in the seat's dialog ([placing by hand](../../business/flows/placing-by-hand.md)).

## The form's revision

The market document keeps `formRevision`, a count of the writes of the form's questions (absent reads as 0), served as `Market.form_revision` and by the form read, `GET /markets/<id>/application-form`, as `formRevision` ([the market document](../data/market-document.md#the-fields-that-matter)).
A form save's body (`PUT /markets/<id>/application-form`) carries `formRevision`, the revision its copy of the form was read at, and the answer carries the revision now stored, for the next save.
A body naming none, the page from before the revision existed still open after a deploy, is answered `MarketChanged`, so it reloads; one naming anything but a whole number from 0 (`true` included) is answered 400 "formRevision must be a whole number.".
The lock and the form's own refusals are judged first, so a locked form still says why it is locked.

The write sets `applicationForm.fields` and `applicationForm.unaskedEssentials` only, never `publishedAt`, which Open applications stamps, or `essentialOptions`, which the first application freezes, and holds the phase, `applicationForm.essentialOptions` as read and the revision.
So a save from an older copy is refused rather than replacing the questions another person saved, and a save crossing Open applications or the first application is refused rather than erasing the stamp or the frozen offering; a market whose vendors arrive by import takes its first row in draft, so there only the offering's hold tells the save it crossed it.
A market with no form yet gets it whole, with `publishedAt` and `essentialOptions` null, holding `applicationForm` absent as read.

The CSV start counts the revision without holding a client's, since no page sent one; Open applications holds it at its value as read and does not count it, nor does the freeze, since neither changes a question.

## The plan's revision

The market document keeps `planRevision`, a count of the plan's writes (absent reads as 0), served as `Market.plan_revision` and by the market read, `GET /markets/<id>`, as `planRevision` ([the market document](../data/market-document.md#the-fields-that-matter)).
A plan save's body (`PUT /markets/<id>/plan`) carries `planRevision`, the revision its copy of the plan was read at, beside `setupObject` and `intakeMode`, and the answer is `{"message": "Plan saved", "planRevision": <new>}`, for the next save.
A body naming none, the page from before the revision existed still open after a deploy, is answered `MarketChanged`, so it reloads; one naming anything but a whole number from 0 (`true` included) is answered 400 "planRevision must be a whole number.".
The plan's own refusals are judged first, so a settled setup still says why it is settled.

The plan is sent whole, so the write holds the revision: a save from an older copy is refused rather than putting back what another person saved since.
It holds the phase, so an edit judged in draft that lands after Open applications is refused and [the setup settles on leaving draft](../../business/rules/the-setup-settles-on-leaving-draft.md) holds against a move in flight, and `resultsPublished`, which the assignment rules' lock reads, so a rules change crossing Publish results is refused.

Every other writer of `setupObject` counts it: the CSV start and the floorplan save, each holding it as read since each builds on the plan it read, and the seeder, which saves through the plan write from the revision it read.
So a Market Setup page holding a copy from before any of them is refused too.
Open applications holds it at its value as read and does not count it, since a move changes no part of the plan.

Every other write to the markets collection is a permanent exception, listed in the guard below with its reason.

## The guard

[`back-end/tests/test_every_market_write_holds_what_it_read.py`](../../../back-end/tests/test_every_market_write_holds_what_it_read.py) walks every `.py` file under `back-end/` by AST, but `tests/`, hidden directories and installed packages (a virtual environment kept there).
It finds each call of `insert_one`, `insert_many`, `update_one`, `update_many`, `replace_one`, `find_one_and_update`, `find_one_and_replace`, `delete_one`, `delete_many` or `bulk_write` whose receiver is the markets collection: a name or attribute ending in `markets_collection` or `markets`, or a subscript of `"markets"` or `MARKETS_COLLECTION`.
Each must be in `market_write.py` or in `EXCEPTIONS`, keyed by module and function.
A receiver the walk cannot name (a call's result, a subscript of a variable) may be the markets collection too, so it fails naming its file and line until it is listed the same way.
An exception whose site no longer writes fails too, so the list holds only writes that stand.
Every exception is permanent: a write waiting to move onto the helper is no reason to stay outside it, so a reason naming a ticket, or one of fewer than four words, fails the list.

The exceptions, each with its reason in the list:

- the market's creation (an insert: no market as read, and the unique slug index settles an address race);
- its deletion (it keeps no rule beyond the right to delete, and deletes in its own order, [market deletion](market-deletion.md));
- the dealing lease's writes in `review_team.py` (a lease protocol of their own, [ADR 0020](../../adr/0020-an-application-is-dealt-to-one-reviewer.md));
- the essential offering's freeze (the first writer wins, held by no snapshot stored yet, [essential fields](essential-fields.md));
- the key migration in `market_documents.py` and the migrations under `migrations/`, each run once by an operator outside any request;
- `reset_database.py`, an operator script emptying every collection of a local database, whose receiver is a variable.

A migration that reaches the markets collection by a name the walk does not read as markets (`collection`) is not seen; the walk reads names, not data flow.

## On the screen

`isMarketChanged(err)` in [`front-end/src/utils/api.ts`](../../../front-end/src/utils/api.ts) is a 409 whose body's `code` is `market_changed`.
`onMarketChanged(handler)` is a response interceptor beside `onSessionEnded`: the request still fails, so the screen's own catch runs and shows the server's sentence through `getApiErrorMessage`.
`installMarketChanged()` in [`front-end/src/stores/market.ts`](../../../front-end/src/stores/market.ts), installed from `main.ts` beside the session's interceptor, re-reads the open market through the store's `refresh`, so every screen reading [the market store](market-store.md) follows.

The Tables page reads the market from the store, but its grid and an open vendor's details are reads of their own, so on that refusal from a placement it reads those again, as after a success, and the sentence stands in the seat dialog's error line (`runPlacementChange` in [`front-end/src/views/ResultView.vue`](../../../front-end/src/views/ResultView.vue)).

The form tab ([F2](../../business/flows/form-tab.md#f2-custom-questions)) keeps the `formRevision` its form read answered, sends it with Save and with the unasked-essentials toggle, and takes the one each save answers.
On a 409, the market changed or the form locked, it shows the server's sentence where a save's error shows and reads the form again, so the questions on screen are the ones stored, with their revision for the next save (`rereadAfterARefusal` in [`MarketFormTab.vue`](../../../front-end/src/components/market/MarketFormTab.vue)).
Market Setup keeps the `planRevision` it took with the plan from the market, sends it with every plan save (the autosave, the keepalive write on leaving, and Allocate tables' save of the plan before a run, which goes through the same queue), and takes the one each save answers; the saves go one at a time ([the plan's autosave](plan-autosave.md)), so each carries the revision the last one answered.
On that refusal the autosave drops the unsaved edits, the page takes the store's plan and its revision, and the server's sentence stands where the plan's status line shows a refusal (`MarketSetupView.vue`, [planning the market](../../business/flows/planning.md)).
A seed or spec writes the plan through [`e2e/helpers/savePlan.ts`](../../../front-end/e2e/helpers/savePlan.ts), which reads the revision first.

The import's form dialog sends the revision of the form it read the same way, and on that refusal stays open on the sentence while the import reads the form again ([the form amendment](form-amendment.md), [the import](../../business/flows/import.md)).
A seed or spec writes the form through [`e2e/helpers/saveApplicationForm.ts`](../../../front-end/e2e/helpers/saveApplicationForm.ts), which reads the revision first.

Manage market keeps a copy of the market of its own, so on that refusal from adding, changing or taking a role, from a change to the permission table (a row, Reset or Copy), or from a rename, it re-reads that copy, and the sentence stands where that action's refusal always has: under the add form, in the removal's confirmation, under the person's row, in the table change's confirmation, under the name ([ending and managing a market](../../business/flows/ending-and-managing-a-market.md)).
The permission dialog ([`MarketPermissions.vue`](../../../front-end/src/components/MarketPermissions.vue)) asks [`ManageMarketOverlay.vue`](../../../front-end/src/views/ManageMarketOverlay.vue) for the re-read with its `marketChanged` event, and an open confirmation follows the table read again: a row's change takes the row as it now stands, and one with nothing left to change, or a reset with no row left to return, closes, its sentence then on the Permissions dialog's own error line; after a refused rename (`handleRename`) the re-read market may be past draft, so the name field gives way to why the name is fixed.

A list saved on the market a click at a time (`useSavedOnTheMarket` in [`front-end/src/utils/savedOnTheMarket.ts`](../../../front-end/src/utils/savedOnTheMarket.ts), the highlights and the automatic rejections) takes the store's list back on that refusal, not the list from before the click: the re-read may land before the refusal reaches the screen, while the write still counts as in flight and the list's watch skips it.

## How it is tested

- [`tests/real_mongo/test_the_market_write.py`](../../../back-end/tests/real_mongo/test_the_market_write.py), on the server: the phase held always, a key held at its value, absent or null, a held sub-document and a dotted part of one, a revision held at 0 on a market with none and at a stored one, counts, and a market deleted in between.
- [`tests/real_mongo/test_a_judged_write_lands_only_on_the_market_it_judged.py`](../../../back-end/tests/real_mongo/test_a_judged_write_lands_only_on_the_market_it_judged.py), through the routes on the server: a rename crossing Open applications, a rules save crossing the review's close and a highlights save crossing an archive, each landed between the read and the write by `interleave`, answer the 409 with the sentence, store nothing and record nothing.
- [`tests/real_mongo/test_every_held_write_is_refused_on_a_changed_market.py`](../../../back-end/tests/real_mongo/test_every_held_write_is_refused_on_a_changed_market.py), the same way for Publish results crossing a new allocation, Stop and the door code crossing an archive, each Discord write, the import crossing another import, the start crossing another start, and each permission-row write crossing the same row set in another tab: each refused write leaves the market as the other change left it, with only that change's history; a card save and a row set beside another field or row changed meanwhile still land.
- [`tests/real_mongo/test_roles_written_per_person.py`](../../../back-end/tests/real_mongo/test_roles_written_per_person.py): a take, an add and a change each landing after another role change it did not read, through the routes: both land, the person taken stays without access, the one added keeps it, and the history replayed over the starting roles gives the roles stored; a second take of one person answers the 404, and a change after a take, or an add after the requester's own role changed, is refused.
- [`tests/real_mongo/test_an_assignment_write_holds_the_market_it_read.py`](../../../back-end/tests/real_mongo/test_an_assignment_write_holds_the_market_it_read.py), through the routes: Allocate tables with Publish results landing after its solver ran, and a placement, a free and a swap with the market archived after their read, each answer the 409 with the sentence and leave the stored assignment and its revision as they were, with only the other change's history.
  The phase move's two answers over a changed market are [`test_the_market_side_races.py`](../../../back-end/tests/real_mongo/test_the_market_side_races.py)'s, and two assignment writes from one revision land one there, the other a `MarketChanged`.
- [`tests/real_mongo/test_the_form_holds_its_revision.py`](../../../back-end/tests/real_mongo/test_the_form_holds_its_revision.py), through the routes: a form save crossing Open applications, the first application on a market taking applications, and the first imported row on a draft, each answering the 409 and leaving the published stamp, the frozen offering and the questions as the other change left them; two saves from one revision landing one; a body with no revision or a malformed one; a first save on a market with no form; the start counting the revision; and Open applications with a form save landed in its window refused with the `market_changed` blocker, the market still a draft.
- [`tests/real_mongo/test_the_plan_holds_its_revision.py`](../../../back-end/tests/real_mongo/test_the_plan_holds_its_revision.py), through the routes: a plan save crossing Open applications and one crossing Publish results, each answering the 409 and leaving the plan as it stood; two saves from one revision landing one; a save from the revision answered; the CSV start and the floorplan save counting the revision, so a Market Setup page read before is refused, and each refused over a plan saved while it built its own; a move not counting it; a body with no revision or a malformed one; and Open applications with a plan save landed in its window refused with the `market_changed` blocker, the market still a draft.
- [`tests/test_every_market_write_holds_what_it_read.py`](../../../back-end/tests/test_every_market_write_holds_what_it_read.py), without a server: the guard over the back end as it stands, and over writes it plants in a temporary tree, each named by its file, line and function, every way of naming the markets collection, a receiver it cannot name, and a reason naming a ticket refused.
- [`tests/test_the_market_write.py`](../../../back-end/tests/test_the_market_write.py), without a server: the stored document a `Market` keeps and `model_copy` carries, the `RuntimeError`s, and the 409's body.
- [`src/__tests__/aMarketThatChangedUnderAWrite.test.ts`](../../../front-end/src/__tests__/aMarketThatChangedUnderAWrite.test.ts): `isMarketChanged`, the interceptor, the store's re-read, and a refused rules save putting the server's rules on screen with the sentence, the re-read landing before the refusal and after it.
- [`src/__tests__/manageMarketMeetsAChangedMarket.test.ts`](../../../front-end/src/__tests__/manageMarketMeetsAChangedMarket.test.ts): Manage market re-reading its own copy of the market after a refused add, take and change of a role, a refused change of a table row, Reset and Copy, and a refused rename, each with the sentence where that action's refusal stands and the re-read on screen, a row's confirmation then asking about the row as it now stands and Cancel leaving its role, and a row's change or a reset left with nothing to change closing, the sentence in Permissions, and reading nothing again after an add or a row's change refused for another reason.
- [`src/__tests__/aFormSaveThatMetAChangedMarket.test.ts`](../../../front-end/src/__tests__/aFormSaveThatMetAChangedMarket.test.ts): the form tab sending the revision its form was read at, then each one a save answered, with Save and the toggle, and after a refused Save reading the form again, showing the sentence and the questions stored; `amendFormDialog.test.ts` the dialog's revision, its refusal, and its next save sending the form read again, its questions turned off included.
- `e2e/application-form.spec.ts`: two tabs of one organizer on one draft's form, the later save from the older copy refused in the sentence, its tab showing the question the other saved, and nothing of its own stored.
- `src/__tests__/planAutosave.test.ts`, "the plan's revision": Market Setup sending the revision it read, then each one a save answered, a wanted save taking the answer's without a re-read, Allocate tables' save sending it, a refused save dropping the edit and showing the plan as it now stands with the sentence, and the keepalive of an edit made while a save is out refused, the save that was out kept.
- [`e2e/a-plan-save-from-an-older-tab.spec.ts`](../../../front-end/e2e/a-plan-save-from-an-older-tab.spec.ts): two tabs of one organizer on Market Setup of one draft, A adding a market date, B, opened before, renaming a section: B's save refused in the sentence, B showing A's date, B's rename not stored.
- [`src/__tests__/aPlacementThatMetAChangedMarket.test.ts`](../../../front-end/src/__tests__/aPlacementThatMetAChangedMarket.test.ts): the Tables page, after a refused placement, reading the tables and an open vendor's details again with the sentence in the seat's dialog, leaving the market to the interceptor; after a seat taken meanwhile, reading the tables and the market again with the refusal in the dialog; and reading nothing again after a refusal that is not a 409.
- [`src/__tests__/aStartThatMetAChangedMarket.test.ts`](../../../front-end/src/__tests__/aStartThatMetAChangedMarket.test.ts): the start from a CSV, refused with the sentence, showing it on the review step and going nowhere.

## Why

- [ADR 0024](../../adr/0024-a-market-write-holds-what-it-read.md): one helper, so the safe write is the default for the next one anyone adds.
- [ADR 0008](../../adr/0008-each-write-names-what-it-changes.md): each write names what it changes, and now holds what it read.
- [Review highlights](../../business/rules/review-highlights.md) and [automatic rejections](../../business/rules/automatic-rejections.md): the two lists written through it, the rules closing with the review.
- [The form locks at the first application](../../business/rules/the-form-locks-at-the-first-application.md): the form write holds the frozen offering and the phase, so no save changes the questions under an applicant.
- [The setup settles on leaving draft](../../business/rules/the-setup-settles-on-leaving-draft.md): the plan write holds the phase, so no edit judged in draft lands after it.
