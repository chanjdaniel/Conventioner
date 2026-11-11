---
layer: implementation
kind: data
describes:
  - back-end/market_documents.py
  - back-end/datatypes.py#Market
  - back-end/datatypes.py#MarketPermission
  - back-end/datatypes.py#MarketPhase
  - back-end/datatypes.py#phase_from_market_document
  - back-end/datatypes.py#applications_stopped_from_market_document
  - back-end/datatypes.py#intake_mode_from_market_document
  - back-end/datatypes.py#market_name_slug
  - back-end/datatypes.py#MarketSchemaContract
  - back-end/api/markets.py#create_market
  - back-end/api/markets.py#public_address_refusal
  - back-end/api/markets.py#load_market_context
  - back-end/api/markets.py#_readable_market
  - back-end/api/markets.py#_stamp_effective_market_state
  - back-end/api/markets.py#_normalized_application_form
  - back-end/api/markets.py#_strip_persisted_assignment_statistics
  - back-end/migrations/migrate_market_keys.py
  - back-end/migrations/migrate_phase.py
  - back-end/migrations/migrate_is_draft_consistency.py
  - back-end/migrations/migrate_publishing_to_market_days.py
  - docs/schema.d.ts
  - back-end/db_config.py#get_mongodb_client
  - back-end/tests/test_db_config.py
  - back-end/migrations/migrate_layouts.py
  - back-end/datatypes.py#fill_plan_ids
  - back-end/datatypes.py#SetupObject
  - back-end/datatypes.py#FloorplanObject
  - back-end/datatypes.py#TableTypeObject
verified: 2026-11-11
sources:
  - E02
  - E03/F03
  - E21/F03/S03
  - E21/F03/S06
  - E26/F06/S03
  - E01/F06
  - E38/F02/S01
  - E39/F01/S03
  - E39/F02/S01
  - E43/F01/S01
  - E38/F07/S02
  - E46/F01/S02
  - E46/F01/S05
  - E46/F01/S04
  - T181
  - T206
  - T213
  - T263
  - T273
  - T257
  - T270
---

# The market document

One document per market in the `markets` collection, holding the market's plan, its form, its stored assignment and its lifecycle.
[`back-end/market_documents.py`](../../../back-end/market_documents.py) owns its canonical form and every raw read of it; the model is `Market` in [`back-end/datatypes.py`](../../../back-end/datatypes.py), and the writes are in [`back-end/api/markets.py`](../../../back-end/api/markets.py) and the modules it names.
Applications, check-ins, the market's history and vendor notes are their own collections, keyed by `market_id`; see [the application document](application-document.md) and [the market's history](history.md), and [market deletion](../modules/market-deletion.md) for how they go with the market.

The glossary concepts: [Market](../../business/concepts/market.md), [Phase](../../business/concepts/phase.md), [Intake mode](../../business/concepts/intake-mode.md), [Essential question](../../business/concepts/essential-question.md) and [Review highlight](../../business/concepts/review-highlight.md).

## Key spelling

**Market documents are stored camelCase, and that is the only spelling reads may name.**
Every write camel-cases the whole document (`convert_keys_to_camel_case` in [`back-end/assignment/utils.py`](../../../back-end/assignment/utils.py), called by `create_market` and every named write), so `organization_id` is persisted as `organizationId`, and a hand-written filter on `organization_id` matches nothing.
Anything touching a raw document or a Mongo filter goes through `market_documents.py`: `market_doc_key`, `market_doc_field`, `market_doc_filter`, `market_doc_set`, `market_doc_projection` and `market_from_document`, so the spelling is decided in one place.

**Do not add a read-time fallback that accepts both spellings.**
Writes only refresh the camelCase key, so a legacy snake_case key holds a value that is stale for ever, and any filter matching it acts on data no write has refreshed since.
[`front-end/e2e/access-control.spec.ts`](../../../front-end/e2e/access-control.spec.ts) pins the visibility that depends on this: a snake_case filter in the organization-scoped market query is exactly the bug that once hid every member's markets, and the spec's positive assertions catch it.

The other collections differ: applications and the placement trail are stored snake_case, and an organization's keys are single words, so no spelling question arises there.

## The fields that matter

| Field (stored)                                 | What it is                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                           | a UUID, the primary key; the name is a mutable display field                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `name`                                         | the market's name; it decides the slug, so it may change only while the market is a draft; a create and a rename refuse one over `MARKET_NAME_MAX` (100) characters or holding a control character or a line or paragraph separator (`market_name_refusal`, [D6](../../business/flows/creating-a-market.md#d6-a-name-of-at-most-100-characters-on-one-line)), and a name stored before that rule is read as it is                                                                                                                                                                                                                                                                                                                                                                 |
| `slug`                                         | derived from the name, persisted and uniquely indexed (below)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `organizationId`                               | the one organization the market belongs to, fixed at creation; see [the organization document](organization-document.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `roles`                                        | a map from user id to `owner`, `admin`, `editor` or `viewer`, with exactly one `owner`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `phase`                                        | the lifecycle, one of the six `MarketPhase` values; the single source of truth ([ADR 0005](../../adr/0005-phase-is-the-only-lifecycle-state.md)), written only by [the phase move](../modules/guards.md); an `archived` market is [read-only](../../business/rules/an-archived-market-is-read-only.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `isDraft`                                      | a persisted view of `phase`, kept only as its fallback (below)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `phaseHistory`                                 | every phase the market entered, `{phase, enteredAt, by}`, written in the update that moves it ([`back-end/phase_record.py`](../../../back-end/phase_record.py))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `permissions`                                  | the rows of [the table](../modules/market-actions.md#a-markets-own-rows) this market differs on: a map from action id to `{role, source}`, `source` being `market` or `organization`; a row it does not hold reads its built-in default, so absent or `{}` is the built-in table and needs no migration; a new market starts with [its organization's default rows](organization-document.md#its-default-table), each `source: "organization"`, or `{}` when it has no organization or the organization sets none; after that only its owner's writes change it, copying the organization's default again among them ([ADR 0019](../../adr/0019-a-markets-permissions-are-a-table.md))                                                                                            |
| `intakeMode`                                   | `csv` or `form`; absence means `csv` ([ADR 0006](../../adr/0006-intake-mode-fails-closed.md)); it [decides how vendors arrive](../../business/rules/intake-mode-decides-how-vendors-arrive.md), and a market it gates [answers as absent](../../business/rules/a-gated-market-answers-as-absent.md) through `vendor_page_market_by_slug` (the vendor page) and `applicant_intake_market_by_slug` (applying)                                                                                                                                                                                                                                                                                                                                                                       |
| `setupObject`                                  | the plan: dates, tiers, locations, sections, priority rules, assignment options, floorplans (each [a location's layout](#a-locations-layout)), `tableTypes` and `pricing`; null on a market whose plan was never saved                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `applicationForm`                              | the custom fields, `publishedAt`, the frozen `essentialOptions` and `unaskedEssentials`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `assignmentObject`                             | the stored assignment: `vendorAssignments` (each a seat on a date, `handPlaced` for a pin), `assignmentDate`, `madeFrom` (what the run read) and `revision` (how many times its rows were written, which each write is conditional on); its statistics are derived on every read and never stored (`_strip_persisted_assignment_statistics`); its one writer is [placements](../modules/placements.md)                                                                                                                                                                                                                                                                                                                                                                            |
| `importMapping`                                | the CSV import's saved column mapping, server-owned, in [the import's one format](../modules/csv-import.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `exampleColumns`                               | what [the start from a Google Form's responses](../modules/csv-proposal-and-start.md) kept of each question and left-out column of its file: label, key, the options at least 3 applicants gave that name nobody and, unless its answers are mostly different, every answer less what `_names_someone` catches (`answers`, [ADR 0023](../../adr/0023-every-answer-for-an-option-to-offer.md)), which the read serves only to someone who may change the form while it can still change; server-owned, absent on any other market, so [the market guide](../modules/market-guide.md) reads a list, an empty one included, as the start having run                                                                                                                                  |
| `reviewHighlights`, `rejectionRules`           | which answers a reviewer reads first ([review highlights](../../business/rules/review-highlights.md)), and which answers reject automatically; on the market, not the form, so they stay editable after the form locks, the rules only while the review is open (`review_is_open`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `nothingLeadsTheCard`, `noAutomaticRejections` | whether the organizer chose that nothing leads the card, and that no answer rejects (T206), each beside its list because an absent and an empty list both mean nothing is marked and neither says anyone chose it; true only while its list is empty, written only by its list's own write ([review highlights](../../business/rules/review-highlights.md#where-it-is-kept), [automatic rejections](../../business/rules/automatic-rejections.md#where-it-is-kept)), false at creation and never set by a create body; absent is false, so no migration, and the read serves both                                                                                                                                                                                                 |
| `resultsPublished`                             | whether vendors may read their outcome, on either path ([Publish results waits for the allocation](../../business/rules/publish-results-waits-for-the-allocation.md)); on a `csv` market it also opens the vendor page (`vendor_page_market_by_slug`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `discord`                                      | the Discord server the market is connected to; see [the Discord connection is `discord`](#the-discord-connection-is-discord)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `applicationsStopped`                          | whether the organizer has stopped taking applications inside the stage (E38/F04/S02), a fact about the form; absent is false; written by `set_applications_stopped`, and by the phase move into the stage (`taking_applications_update`), which clears it on entering draft or the stage from draft, and sets it on a form market back from Assignment                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `reviewTeam`                                   | the reviewers chosen for the review, `{reviewers: [{userId, email}], turn}`, in the order they are dealt to (by address), and how many applications were dealt since they last changed, and while a deal runs `dealing` (`{by, until}`), the lease by which every deal holds the market, so the turn has one writer at a time ([ADR 0020](../../adr/0020-an-application-is-dealt-to-one-reviewer.md)); absent is none chosen, so no migration; written only by [`back-end/review_team.py`](../../../back-end/review_team.py), null at creation, and never by a market update body ([the review is dealt among chosen reviewers](../../business/rules/the-review-is-dealt-among-chosen-reviewers.md)); the read serves every reader `{reviewers: [{email, able}]}`, never the turn |
| `doorCode`                                     | the market's live [door code](../modules/attendance-and-door.md#sharp-edges), `{code, madeAt, madeBy}`; absent before the first; written only by `api/door.py`, and never served by a market read (`leave_out_what_no_read_serves`, which takes `NEVER_SERVED_FIELDS` off the read and every Markets list entry)                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `creationDate`, `modificationList`, `theme`    | carried on every market; `modificationList` is always empty, and nothing writes or applies `theme`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

Each field's own rules are with the module that writes it; this node is the document's shape and the rules about the document itself.

**The prices are `setupObject.pricing`**, null on a market never priced: `currency` (`CAD` unless the organizer picked another of `PRICING_CURRENCIES`), `halfTablePercent` (a whole number from 0 to 100, 50 unless changed), `groups`, the organizer's price groups, each `{name, conditions: [{key, answers}], prices}` with `prices` shaped as `everyoneElse` (absent on a card saved before there were groups, which has none), and `everyoneElse`, a list of `{tier, cents}`, each a full table's price for one day in whole cents.
A list rather than a map keyed by tier name, because every write camel-cases the document's keys and a tier's name is the organizer's text; a half price rounds half up to the cent.
What they mean and how an assignment is priced is [a price follows the table](../../business/rules/a-price-follows-the-table.md).

<a id="a-locations-layout"></a>
**A location's layout is a floorplan of `setupObject.floorplans`**, one per location (T257); "layout" is what the organizer reads, "floorplan" what the code and routes say.
Lengths are millimetres, angles degrees clockwise, positions from the floorplan image's top-left corner at the floorplan's scale:

- every location and section has an `id`, a UUID string stable across renames, since a layout names its location and a table its section by it; every other reader, the solver and the form's offering among them, still matches sections and locations by name
  - Section Setup and Location Setup mint one as they add a row (`crypto.randomUUID()`), and every parse of a plan fills a missing one (`fill_plan_ids` in `datatypes.py`), so the CSV start and the seeds need nothing of their own
  - a missing id is derived from the row's names and its place among rows of the same names (a UUID version 5 in `PLAN_ID_NAMESPACE`), never drawn at random, so a market stored before ids reads with the same ids on every read and a Market Setup tab writes back the ids it read
  - a section's copy of its location carries that location's id: its own, when it names one of the plan's locations by id, else the id of the location of its name, set on every parse
  - a plan write sending a row with no id, as a page of the bundle before ids does, is refused (409, `PAGE_FROM_BEFORE_IDS` in `api/markets.py`) on a market with a layout when that row would read with an id the market does not hold, since the layout's location or a table's section would be written away
- a floorplan (`FloorplanObject`): its `id`, `locationId`, `revision`, the image (`imageGridfsId`, `imageWidth`, `imageHeight`, `pdfPage`), the scale (`scalePxPerUnit`, image pixels per millimetre, and the reference line it was drawn from), and:
  - `tables`, each `{id, sectionId, number, tableTypeId, xMm, yMm, rotation}`, `xMm` and `yMm` its centre, `sectionId` and `number` null on a table in no section; numbers run 1 to N in each section, so `table_code_for(section.name, number)` names the same table everywhere
  - `zones`, the no-table zones, each `{id, label, xMm, yMm, widthMm, depthMm}` from its top-left corner
  - `sectionStyles`, each `{sectionId, color, labelAt}`, `color` an index 1 to 8 of the section palette and `labelAt` null where the drawing places the label
  - `startingCounts`, each `{sectionId, count}`, what Section Setup had when the layout began
- `setupObject.tableTypes`: the market's table types, each `{id, name, widthMm, depthMm}`, with no colour, since the section colours a table; the form and the solver do not read them yet ([essential fields](../modules/essential-fields.md))

The model reads leniently, as stored models do: every new field has a default, and the floorplan beta's fields (`walls`, `obstacles`, `placedTables`, `sections`, a floorplan's own `tableTypes`, `scaleUnit`) are dropped as a stored one parses, so a floorplan the beta saved reads as one of no location (`locationId` null), shown nowhere and counted by no section.
The market read serves the stored document, so such a floorplan's stored keys, and a stored row with no id, reach the front end as stored until a write or the migration rewrites them.
A laid-out location's sections store the count of their layout's tables, derived on every write, and only the layout's own writes change `floorplans` and `tableTypes`; how is [floorplan placement](../modules/floorplan-placement.md#sharp-edges).

**A change of reviewers is unfinished while `reviewTeam.unfinishedChoice` stands** (T270): its team write sets it to `{removed: [address]}`, the reviewers the change removed, and its last write, the turn's, unsets it, so the same choice again finishes a change that stopped between them and hands on those reviewers' follow-ups too, and a different choice over it counts them removed beside those it removes itself, unless it chooses them ([the review is dealt among chosen reviewers](../../business/rules/the-review-is-dealt-among-chosen-reviewers.md)).
Like `dealing`, it is beside the team on the document and not on the `ReviewTeam` model, and the read never serves it.
Every write a deal makes to the market under `dealing` names the lease and reads whether it matched, so one whose lease ran out is refused or logged, never written as if it held the market ([ADR 0020](../../adr/0020-an-application-is-dealt-to-one-reviewer.md)).
A lease nobody let go, from a deal the host ended, runs out on its own, and the applications still marked `arriving` are dealt by the next deal, which a reviewer's next card starts (`deal_waiting`).

<a id="the-discord-connection-is-discord"></a>
**The Discord connection is `discord`**; absent is not connected.
Each list here is in the order `DiscordConnection` (`datatypes.py`) declares its subfields, so a new subfield is one line in its place in each list it belongs in ([two features never share a line](../conventions/two-features-never-share-a-line.md)):

- the Discord server the market is connected to and what [its card](../modules/discord.md) chose:
  - `guildId`
  - `guildName`
  - `roleId`
  - `roleName`
  - `usernameQuestion`
  - `inviteLink`
- what ["Check Discord"](../modules/discord.md#who-is-in-the-server) last found:
  - `checkedAt`
  - `vendorStates`, each `applicationId` with:
    - its `state`
    - the `answer` it was read for
    - for a vendor not found, the `possibleMatches` offered and `moreMatches`, how many more looked alike
- the last ["Give roles"](../modules/discord.md#giving-the-role) run's report, `roleRun`:
  - `ranAt`
  - `roleName`
  - `outcomes`, each `applicationId` with its `outcome` and, for a failure or a vendor not given it yet, its `reason`
- the members declined as a vendor's possible match, `declinedMatches`: member usernames by application id, [possible matches](../modules/discord.md#possible-matches)

It is written only by these routes, who connected it and when being the history's:

- the card's
- the check's
- the run's
- the decline's

A market disconnected keeps only `usernameQuestion`, and one connected to another server forgets:

- its role
- its invite link
- its check
- its run
- what was declined

Choosing another username question forgets:

- its check
- its run

The `discordGuildId` and `discordWebhookUrl` some old documents carry are E18/F05's removed fields, read by nothing.

**The application form is stored as one validator returns it.**
Every writer of `applicationForm` passes it through `_normalized_application_form` (`api/markets.py`), so a stored form never differs from the form that was checked; the writes on an existing market go through `prepared_application_form`, which asks [the form lock](../../business/rules/the-form-locks-at-the-first-application.md) first:

- A field's `key` is non-blank, unique in the form, matches `^[a-z0-9_]+$` (it becomes a key inside an application's answers) and does not start with the reserved `essential_` or name one of the import's own targets (`applicant_email`, `submitted_at`, `sheet_note`, which would hold the wrong column).
- Its `label` is non-blank, and its `type` is one of `text`, `number`, `select`, `multi_select`, `checkbox`, `date` and `email`.
- A `select` or `multi_select` has at least one option, each trimmed, non-blank and unique, since options are the stored answers; every other type's options are emptied.
- `order` is rewritten to the field's position in the list.
- `publishedAt` and `essentialOptions` are the server's, carried over from the stored form whatever the payload says; `unaskedEssentials` is the organizer's, and may name only a ranking.
  `publishedAt` is stamped when the market moves from `draft` to `applications` and cleared when it returns to `draft`, in the update that moves the phase; `essentialOptions` is frozen by the first application's answers.
- A form with no custom fields is a form: whether it asks enough to open applications is the phase guard's question, counting the essential questions too.

[`front-end/src/utils/applicationForm.ts`](../../../front-end/src/utils/applicationForm.ts) (`applicationFormError`) mirrors these rules so the builder refuses a save before sending it; the back end is the authority.
Ownership of a market cannot be handed on: no write changes the `owner` entry of `roles`.

## The slug

**`Market.slug` is a computed field**, derived from the name by `market_name_slug` (`datatypes.py`), the same rule the front end builds its links from (`marketNameToKebabSlug` in [`front-end/src/utils/marketSlug.ts`](../../../front-end/src/utils/marketSlug.ts)): accents folded, anything else to `-`.
It is persisted and indexed (`market_slug`, **unique** over non-empty slugs) so the public slug lookup (`market_by_slug`, beneath the vendor page's and applying's gates) is one indexed query rather than a decode of every market on every unauthenticated request.
It is never independently writable: no request body can name it, and every write recomputes it from the name.
The stored slug narrows the query but does not decide it: `market_by_slug` re-checks each candidate's name against `market_name_slug`.

**One address, one market.**
Creation and rename both ask `public_address_refusal()` (`api/markets.py`), so "Cafe Market" is refused beside "Café Market"; uniqueness on the exact name alone let two markets share a public URL.
The unique index is the database's refusal of the same thing, for two creations that race past the check.
The organizer meets it as the create-market dialog's refusal ([a name that is already someone's address](../../business/flows/creating-a-market.md#d5-a-name-that-is-already-someones-address)).

## The phase, and `isDraft`

**`phase` is the single source of truth for the market lifecycle; `is_draft` is derived from it.**
`Market.is_draft` is a Pydantic `@computed_field` (true iff `phase == draft`) and is never independently writable: no request body can set it, and it is recomputed from the stored phase on every write.
Nothing reads the stored value for a market whose `phase` this build understands.
It is still persisted, and every writer keeps it in agreement with `phase`: `create_market` stamps both, the transition endpoint sets both in one atomic update, and no other write touches either.
It is kept only because it is the fallback `phase_from_market_document()` drops to when `phase` is missing or unrecognized, and a fallback that contradicted the phase would answer confidently and wrongly.
**Do not delete `is_draft` from the model, and do not make it writable again.**
The two endpoints that serve a raw document rather than a parsed `Market`, the market read and the market list, re-stamp `isDraft` from the effective phase before responding (`_stamp_effective_market_state`).

**No Mongo condition can answer "is this market published?"**
`{"phase": {"$ne": "draft"}}` also matches a document with no `phase`, which is exactly what a legacy draft looks like, so a filter like that would put an unpublished market on a public check-in URL.
The public slug lookup prunes with `non_draft_market_prefilter()` and makes the draft decision in Python through `phase_from_market_document()`.
The prefilter prunes; it does not judge.
Keep it that way.

## Parsing a stored market

**Parse stored markets with `market_from_document()`, never `Market(**snake_dict)`.**
`Market.phase` defaults to `draft`, so a raw parse silently mislabels every market written before the field existed.
`phase_from_market_document()` (`datatypes.py`) is the one source of truth for that mapping: a document with no `phase`, or one this build does not recognize, reads as `draft` when `isDraft` (or the older `is_draft`) is true or absent and `archived` when it is false.
The fallback stays `archived` though the old build's publishing meant a running market: redefining it as `market_days` would contradict `migrate_phase.py` and `migrate_is_draft_consistency.py`, which define a legacy published market as `archived` too, so one definition is kept and [`migrate_publishing_to_market_days.py`](../../../back-end/migrations/migrate_publishing_to_market_days.py) does the moving.
Until it runs, such a market reads as finished: it takes no check-in, and reads as a market that ran, its vendor page the record, only once someone has checked in there ([an archived market that ran stays a record](../../business/rules/an-archived-market-that-ran-stays-a-record.md)).
For one release it also reads the three phases E38/F04 folded into `applications` (`LEGACY_STAGE_PHASES`) as `migrate_to_one_stage.py` would leave them: `applications`, or `draft` for a Google Form market that imported nothing; and `applications_stopped_from_market_document()` reads a form market still stored in `applications_closed` or `review` as stopped, unless `applicationsStopped` says otherwise ([ADR 0016](../../adr/0016-one-stage-for-applications-and-review.md)).
`market_from_document()` takes `applications_stopped` from it, and nothing is written back; a later release drops the aliases.
`load_market_context()` (`api/markets.py`) is the shared market, organization and permission load every endpoint uses.
**A document the model refuses is served to no one**: the read and the Markets list both parse it through `_readable_market`, which logs the market's id and why (`_log_unreadable_market`, never what the document held); the read answers it 404 and the list leaves it out and lists the rest ([the organization document](organization-document.md#what-a-person-may-do-on-a-market), T181).

**`market_from_document()` withholds `phase` and `intake_mode` from the Pydantic parse** and takes both from their document readers, `phase_from_market_document()` and `intake_mode_from_market_document()`.
Pydantic validates an enum on construction, before any later assignment can degrade it, so a stored value this build does not recognize used to raise, taking down every list that included that one market.
Do not "simplify" this by letting the model parse either field.
The intake mode reads only `intakeMode`, absent or unrecognized meaning `csv`.

## The boot refusal and the migration

**The back end refuses to boot** unless [`back-end/migrations/migrate_market_keys.py`](../../../back-end/migrations/migrate_market_keys.py) has recorded every marker in `MARKET_MIGRATION_IDS` (`market_document_keys`, `market_slugs`, `market_slugs_unique`) in the `schema_migrations` collection (`assert_market_key_migration_recorded`, run from `app.py` at import).
Each marker is one document read by `_id`, with an `appliedAt` time, through a connection whose server selection gives up after three seconds (`MIGRATION_PROBE_TIMEOUT_MS` in [`back-end/db_config.py`](../../../back-end/db_config.py)), so a database blip cannot hang the boot; it keeps every other bound below.
The migration establishes a market document's canonical form: camelCase keys (no legacy snake_case, the camelCase value winning where a document has both), a stored slug derived from the name, and a UNIQUE slug index.
There are several markers because the canonical form grew; one run records them all, and the refusal names every missing one at once, so the operator never discovers them one restart at a time.
A database migrated by an older build carries only the earlier markers, which is the state the check exists to catch.
When stored markets already share a public address, the migration stops and names them.
A marker that cannot be read at all refuses too: an unknown migration state is not a migrated one.
**Do not "fix" either refusal by softening the check**: it fails closed because an unmigrated market is invisible, not broken - missing from check-in, from its public URL and from organization lists, with nothing logged.
The operator's fix is in [Operations](../../OPERATIONS.md#when-the-back-end-refuses-to-boot).

A fresh database needs no migration: [`back-end/mongo-init.js`](../../../back-end/mongo-init.js) (a new Docker volume) and [`back-end/init_database.py`](../../../back-end/init_database.py) build the slug index and record every marker, there being nothing to rewrite; `init_database.py` records them only when no market needs rewriting.

The other market migrations carry no boot marker, because what they repair fails visibly:

- [`migrate_phase.py`](../../../back-end/migrations/migrate_phase.py) backfills `phase` onto documents written before it existed, with the mapping `phase_from_market_document()` applies on read, so a market behaves the same before and after.
- [`migrate_is_draft_consistency.py`](../../../back-end/migrations/migrate_is_draft_consistency.py) repairs documents whose `isDraft` and `phase` disagree, in _opposite_ directions depending on which build wrote them.
  A market the old build published (`phase: "draft"` with `isDraft: false`) reads back as a draft, since `draft` is a phase this build takes at face value; its `isDraft` was the only publish signal it ever had, so its **phase** is advanced to `archived`, because confirming it as a draft would take a live market's public check-in URL off the air.
  A market with a non-draft `phase` and a stale `isDraft: true` has its `isDraft` recomputed.
  Documents with **no** `phase` are left alone; they are `migrate_phase.py`'s to backfill.
  Every repair is a conditioned `$set` whose filter Mongo re-checks as it writes, so a market the live app moves mid-run is not written back to its old state.
- [`migrate_publishing_to_market_days.py`](../../../back-end/migrations/migrate_publishing_to_market_days.py) moves markets published by the old `draft -> archived` path on to `market_days`, telling published from abandoned by whether an assignment is stored; run it after `migrate_phase.py`.
- `migrate_table_code_separator.py`, `migrate_roles.py` and `migrate_to_uuid.py` brought older documents to today's table codes, roles map and UUID ids.
- [`migrate_layouts.py`](../../../back-end/migrations/migrate_layouts.py) brings every plan to [the layout's shape](#a-locations-layout) (T257): every section and location without an id given the one `fill_plan_ids` derives, the one every read already serves, every floorplan with no `locationId` (each the beta saved) removed, and every file in the `floorplan_images` bucket no floorplan names deleted, read again from every market just before it deletes, but one uploaded after the run began, and none on a run that met a market changed under it; each market is written conditional on the plan it read, `--dry-run` writes and deletes nothing, and a run with no market changed under it records `layouts_v1` in `schema_migrations`.
  It runs after the deploy, since the build reads an unmigrated market without failing, so the marker is not a boot refusal.

## The database client's bounds

Every client the back end builds, through `get_mongodb_client` in [`back-end/db_config.py`](../../../back-end/db_config.py), carries five bounds, module constants with one comment saying why each value:

| Option                     | Value                          | Why                                                                                                                                                                                         |
| -------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `serverSelectionTimeoutMS` | 5 seconds (the boot probe's 3) | finds a healthy Atlas server many times over and fails a blip fast, where the driver's default held a request 30 seconds on a database that is not there                                    |
| `connectTimeoutMS`         | 5 seconds                      | a new connection's handshake, not the driver's default 20                                                                                                                                   |
| `socketTimeoutMS`          | 30 seconds                     | any one wait on the server's reply (a find, a batch of an import's bulk write, an index build at boot), far above what any takes on today's sizes and far below the host's 300-second limit |
| `maxPoolSize`              | 20                             | well above one instance's concurrent use, and bounds the Flex cluster's 500 connections at about 19 saturated instances rather than the default 100's five                                  |
| `maxIdleTimeMS`            | 60 seconds                     | an instance a burst grew gives its connections back                                                                                                                                         |

They are passed as keywords, which PyMongo lets win over the same option in `MONGODB_URI`, so the code is the one place they are set: a URI carrying `maxPoolSize=100` still gets 20.

**There is no client-wide `timeoutMS`, and `None` is passed for it, turning off one a URI carries.**
In PyMongo 4.18 that operation timeout replaces `serverSelectionTimeoutMS`, so server selection waits out whatever is left of it: with `timeoutMS=30000`, a find at a closed port failed after 30.1 seconds, and the boot probe too, rather than after 5 and 3 (T273).
So a hung reply fails after 30 seconds, but a whole operation of several round trips has no overall deadline.
A caller that needs one wraps its operations in `pymongo.timeout`, as `/healthz` does: its ping runs inside `pymongo.timeout(5)`, so a server that is found but does not answer fails the check within about 5 seconds too.
A timed-out operation raises a `PyMongoError`, which a route answers as any other failure ([an exception never reaches a client](../conventions/an-exception-never-reaches-a-client.md)).

[`test_db_config.py`](../../../back-end/tests/test_db_config.py) reads the bounds from the real driver's `options` and times a find at a closed loopback port; [`test_healthz.py`](../../../back-end/tests/test_healthz.py) times `/healthz` there and reads the ping's deadline.

## The schema contract

[`docs/schema.d.ts`](../../schema.d.ts) is the market as the front end receives it, as TypeScript, generated from `MarketSchemaContract` in `datatypes.py`.
It has no `userRole`: the read names no role, and a screen reads what the person may do from `actionRefusals` ([what the screens read](../modules/market-actions.md#what-the-screens-read)).
After changing a contract model, regenerate it from `back-end/` with `python generate_market_schema.py --output ../docs/schema.d.ts` ([`back-end/generate_market_schema.py`](../../../back-end/generate_market_schema.py)); `tests/test_generate_market_schema.py` fails while the checked-in file differs.
Do not pass `--input`: that infers the declaration from the sample markets in [`docs/market-schema-input.example.json`](../../market-schema-input.example.json), which still carry the removed spreadsheet fields, and produces a different file.
The front end's own types are [`front-end/src/assets/types/datatypes.ts`](../../../front-end/src/assets/types/datatypes.ts).
