---
layer: implementation
kind: data
describes:
  - back-end/market_documents.py
  - back-end/datatypes.py#Market
  - back-end/datatypes.py#MarketPermission
  - back-end/datatypes.py#MarketPhase
  - back-end/datatypes.py#phase_from_market_document
  - back-end/datatypes.py#intake_mode_from_market_document
  - back-end/datatypes.py#market_name_slug
  - back-end/datatypes.py#MarketSchemaContract
  - back-end/api/markets.py#create_market
  - back-end/api/markets.py#public_address_refusal
  - back-end/api/markets.py#load_market_context
  - back-end/api/markets.py#_stamp_effective_market_state
  - back-end/api/markets.py#_normalized_application_form
  - back-end/api/markets.py#_strip_persisted_assignment_statistics
  - back-end/migrations/migrate_market_keys.py
  - back-end/migrations/migrate_phase.py
  - back-end/migrations/migrate_is_draft_consistency.py
  - back-end/migrations/migrate_publishing_to_market_days.py
  - docs/schema.d.ts
verified: 2026-10-30
sources:
  - E02
  - E03/F03
  - E21/F03/S03
  - E21/F03/S06
  - E26/F06/S03
  - E01/F06
  - E38/F02/S01
  - E39/F01/S03
  - E43/F01/S01
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

| Field (stored) | What it is |
| --- | --- |
| `id` | a UUID, the primary key; the name is a mutable display field |
| `name` | the market's name; it decides the slug, so it may change only while the market is a draft |
| `slug` | derived from the name, persisted and uniquely indexed (below) |
| `organizationId` | the one organization the market belongs to, fixed at creation; see [the organization document](organization-document.md) |
| `roles` | a map from user id to `owner`, `admin`, `editor` or `viewer`, with exactly one `owner` |
| `phase` | the lifecycle, one of the eight `MarketPhase` values; the single source of truth ([ADR 0005](../../adr/0005-phase-is-the-only-lifecycle-state.md)), written only by [the phase move](../modules/guards.md); an `archived` market is [read-only](../../business/rules/an-archived-market-is-read-only.md) |
| `isDraft` | a persisted view of `phase`, kept only as its fallback (below) |
| `phaseHistory` | every phase the market entered, `{phase, enteredAt, by}`, written in the update that moves it ([`back-end/phase_record.py`](../../../back-end/phase_record.py)) |
| `permissions` | the rows of [the table](../modules/market-actions.md#a-markets-own-rows) this market differs on: a map from action id to `{role, source}`, `source` being `market` or `organization`; a row it does not hold reads its built-in default, so absent or `{}` is the built-in table and needs no migration; written only by its owner's write, `{}` at creation ([ADR 0019](../../adr/0019-a-markets-permissions-are-a-table.md)) |
| `intakeMode` | `csv` or `form`; absence means `csv` ([ADR 0006](../../adr/0006-intake-mode-fails-closed.md)); it [decides how vendors arrive](../../business/rules/intake-mode-decides-how-vendors-arrive.md), and a market it gates [answers as absent](../../business/rules/a-gated-market-answers-as-absent.md) through `applicant_intake_market_by_slug` |
| `setupObject` | the plan: dates, tiers, locations, sections, priority rules, assignment options, floorplans and `pricing`; null on a market whose plan was never saved |
| `applicationForm` | the custom fields, `publishedAt`, the frozen `essentialOptions` and `unaskedEssentials` |
| `assignmentObject` | the stored assignment: `vendorAssignments` (each a seat on a date, `handPlaced` for a pin), `assignmentDate` and `madeFrom` (what the run read); its statistics are derived on every read and never stored (`_strip_persisted_assignment_statistics`); its one writer is [placements](../modules/placements.md) |
| `importMapping` | the CSV import's saved column mapping, server-owned, in [the import's one format](../modules/csv-import.md) |
| `exampleColumns` | what [the start from a Google Form's responses](../modules/csv-proposal-and-start.md) kept of each question and left-out column of its file: label, key and the options at least 3 applicants gave that name nobody; server-owned, absent on any other market |
| `reviewHighlights`, `rejectionRules` | which answers a reviewer reads first ([review highlights](../../business/rules/review-highlights.md)), and which answers reject automatically; on the market, not the form, so they stay editable after the form locks |
| `resultsPublished` | whether applicants may see their outcome |
| `formAmendment` | present only while [a form amendment](../modules/form-amendment.md) is walking the phases, naming where it returns |
| `creationDate`, `modificationList`, `theme`, `reviewConfig` | carried on every market; `modificationList` is always empty, and nothing writes or applies `theme` or `reviewConfig` |

Each field's own rules are with the module that writes it; this node is the document's shape and the rules about the document itself.

**The prices are `setupObject.pricing`**, null on a market never priced: `currency` (`CAD` unless the organizer picked another of `PRICING_CURRENCIES`), `halfTablePercent` (a whole number from 0 to 100, 50 unless changed) and `everyoneElse`, a list of `{tier, cents}`, each a full table's price for one day in whole cents.
A list rather than a map keyed by tier name, because every write camel-cases the document's keys and a tier's name is the organizer's text; a half price rounds half up to the cent.
What they mean and how an assignment is priced is [a price follows the table](../../business/rules/a-price-follows-the-table.md).

**The application form is stored as one validator returns it.**
Every writer of `applicationForm` passes it through `_normalized_application_form` (`api/markets.py`), so a stored form never differs from the form that was checked; the writes on an existing market go through `prepared_application_form`, which asks [the form lock](../../business/rules/the-form-locks-at-the-first-application.md) first:

- A field's `key` is non-blank, unique in the form, matches `^[a-z0-9_]+$` (it becomes a key inside an application's answers) and does not start with the reserved `essential_` or name one of the import's own targets (`applicant_email`, `submitted_at`, `sheet_note`, which would hold the wrong column).
- Its `label` is non-blank, and its `type` is one of `text`, `number`, `select`, `multi_select`, `checkbox`, `date` and `email`.
- A `select` or `multi_select` has at least one option, each trimmed, non-blank and unique, since options are the stored answers; every other type's options are emptied.
- `order` is rewritten to the field's position in the list.
- `publishedAt` and `essentialOptions` are the server's, carried over from the stored form whatever the payload says; `unaskedEssentials` is the organizer's, and may name only a ranking.
  `publishedAt` is stamped when the market moves from `draft` to `applications_open` and cleared when it returns to `draft`, in the update that moves the phase; `essentialOptions` is frozen by the first application's answers.
- A form with no custom fields is a form: whether it asks enough to open applications is the phase guard's question, counting the essential questions too.

[`front-end/src/utils/applicationForm.ts`](../../../front-end/src/utils/applicationForm.ts) (`applicationFormError`) mirrors these rules so the builder refuses a save before sending it; the back end is the authority.
Ownership of a market cannot be handed on: no write changes the `owner` entry of `roles`.

## The slug

**`Market.slug` is a computed field**, derived from the name by `market_name_slug` (`datatypes.py`), the same rule the front end builds its links from (`marketNameToKebabSlug` in [`front-end/src/utils/marketSlug.ts`](../../../front-end/src/utils/marketSlug.ts)): accents folded, anything else to `-`.
It is persisted and indexed (`market_slug`, **unique** over non-empty slugs) so the public slug lookup (`published_market_by_slug`, and `market_by_slug` beneath it) is one indexed query rather than a decode of every market on every unauthenticated request.
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
Until it runs, such a market reads as finished: its check-in page takes no check-in, and is served at all only once someone has checked in there ([an archived market that ran stays a record](../../business/rules/an-archived-market-that-ran-stays-a-record.md)).
`load_market_context()` (`api/markets.py`) is the shared market, organization and permission load every endpoint uses.

**`market_from_document()` withholds `phase` and `intake_mode` from the Pydantic parse** and takes both from their document readers, `phase_from_market_document()` and `intake_mode_from_market_document()`.
Pydantic validates an enum on construction, before any later assignment can degrade it, so a stored value this build does not recognize used to raise, taking down every list that included that one market.
Do not "simplify" this by letting the model parse either field.
The intake mode reads only `intakeMode`, absent or unrecognized meaning `csv`.

## The boot refusal and the migration

**The back end refuses to boot** unless [`back-end/migrations/migrate_market_keys.py`](../../../back-end/migrations/migrate_market_keys.py) has recorded every marker in `MARKET_MIGRATION_IDS` (`market_document_keys`, `market_slugs`, `market_slugs_unique`) in the `schema_migrations` collection (`assert_market_key_migration_recorded`, run from `app.py` at import).
Each marker is one document read by `_id`, with an `appliedAt` time, through a connection whose server selection gives up after three seconds (`MIGRATION_PROBE_TIMEOUT_MS` in [`back-end/db_config.py`](../../../back-end/db_config.py)), so a database blip cannot hang the boot.
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
- [`migrate_is_draft_consistency.py`](../../../back-end/migrations/migrate_is_draft_consistency.py) repairs documents whose `isDraft` and `phase` disagree, in *opposite* directions depending on which build wrote them.
  A market the old build published (`phase: "draft"` with `isDraft: false`) reads back as a draft, since `draft` is a phase this build takes at face value; its `isDraft` was the only publish signal it ever had, so its **phase** is advanced to `archived`, because confirming it as a draft would take a live market's public check-in URL off the air.
  A market with a non-draft `phase` and a stale `isDraft: true` has its `isDraft` recomputed.
  Documents with **no** `phase` are left alone; they are `migrate_phase.py`'s to backfill.
  Every repair is a conditioned `$set` whose filter Mongo re-checks as it writes, so a market the live app moves mid-run is not written back to its old state.
- [`migrate_publishing_to_market_days.py`](../../../back-end/migrations/migrate_publishing_to_market_days.py) moves markets published by the old `draft -> archived` path on to `market_days`, telling published from abandoned by whether an assignment is stored; run it after `migrate_phase.py`.
- `migrate_table_code_separator.py`, `migrate_roles.py` and `migrate_to_uuid.py` brought older documents to today's table codes, roles map and UUID ids.

## The schema contract

[`docs/schema.d.ts`](../../schema.d.ts) is the market as the front end receives it, as TypeScript, generated from `MarketSchemaContract` in `datatypes.py`.
After changing a contract model, regenerate it from `back-end/` with `python generate_market_schema.py --output ../docs/schema.d.ts` ([`back-end/generate_market_schema.py`](../../../back-end/generate_market_schema.py)); `tests/test_generate_market_schema.py` fails while the checked-in file differs.
Do not pass `--input`: that infers the declaration from the sample markets in [`docs/market-schema-input.example.json`](../../market-schema-input.example.json), which still carry the removed spreadsheet fields, and produces a different file.
The front end's own types are [`front-end/src/assets/types/datatypes.ts`](../../../front-end/src/assets/types/datatypes.ts).
