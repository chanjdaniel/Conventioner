---
layer: implementation
kind: data
describes:
  - back-end/api/applications.py
  - back-end/datatypes.py#Application
  - back-end/datatypes.py#ApplicationStatus
  - back-end/datatypes.py#ApplicationType
  - back-end/datatypes.py#VerdictGiver
  - back-end/datatypes.py#MarketPerson
  - back-end/datatypes.py#AnswerUpdate
  - back-end/migrations/create_applications_collection.py
  - back-end/migrations/migrate_submitted_at_to_iso.py
verified: 2026-10-30
sources:
  - wayfinding/v0-1-0/map
  - wayfinding/real-market-readiness/01
  - E01/F04/S02
  - E26/F07/S01
  - E33/F03/S02
  - E34/F01/S01
  - E34/F02/S01
  - E34/F03/S02
  - E36/F03/S01
  - E41/F01/S01
  - E41/F01/S02
---

# The application document

One document per application in the `applications` collection: a vendor's answers to one market's form, and where review has got to with them.
[`back-end/api/applications.py`](../../../back-end/api/applications.py) is the single owner of the collection, and every reader and writer goes through it, so the storage contract lives in one place.
The model is `Application` in [`back-end/datatypes.py`](../../../back-end/datatypes.py).

The glossary concepts: [Application](../../business/concepts/application.md) and [Essential question](../../business/concepts/essential-question.md).

## Key spelling

**Applications are stored snake_case**, unlike markets, which are camelCased on write ([the market document](market-document.md#key-spelling)).
The market foreign key is `market_id`, NOT `marketId`.
A writer that stored the market reference under any other key would silently disable [the application form lock](../../business/rules/the-form-locks-at-the-first-application.md): the count it reads (`count_applications_for_market`) would just return 0.
The organizer's and the applicant's views camel-case an application on the way out; the stored document never is.

## The fields that matter

| Field | What it is |
| --- | --- |
| `id` | a UUID, the primary key |
| `market_id` | the market it belongs to |
| `applicant_email` | the applicant, stored lowercased and trimmed by every writer ([users and email](users-and-email.md)); proven by a sign-in code on the online path, asserted by the file on an import, and nothing here says which ([an imported email is asserted](../../business/rules/an-imported-email-is-asserted.md)) |
| `application_type` | `main`, or `waitlist` for a second application beside it (`main_application_id` names the main one) |
| `form_data` | the answers, keyed by form field key; the essential questions' answers under their reserved `essential_*` keys |
| `answer_updates` | an organizer's updates of the answers, by form field key ([below](#an-organizers-update-of-an-answer)); absent or empty where none was made |
| `status` | where review has got to (below) |
| `submitted_at` | ISO 8601; the first save's time, kept through later edits |
| `updated_at` | when the answers last changed; a verdict is conditioned on it |
| `verdict_by`, `verdict_at`, `verdict_reason` | who gave the verdict (`{kind: person, user_id, email}` or `{kind: rule, rule}`), when, and a rule's reason in the organizer's words, never shown to the applicant |
| `follow_up_owner` | who is reaching out, while the status is `needs_follow_up` |
| `held_by`, `held_until` | the reviewer looking at it, and until when: a five-minute lease, renewed while the card stays open |
| `added_by`, `added_at` | who recorded a vendor who never applied, and when |
| `assigned_reviewer_id` | carried on the model; nothing writes it |

A vendor's names are answers in `form_data` too; `vendor_names_for_market` reads them as one map from address to the name to call each vendor ([a vendor is called by their chosen name](../../business/rules/a-vendor-is-called-by-their-chosen-name.md)).

Form field keys are held to `^[a-z0-9_]+$` (`FORM_FIELD_KEY_PATTERN` in `datatypes.py`) because they become keys inside `form_data`, where a dot or a leading `$` cannot be addressed by Mongo update operators.

**`submitted_at` is what first come, first served orders by**, and the review queue's arrival order too.
An applicant's first valid save stamps it ([`back-end/application_write.py`](../../../back-end/application_write.py)); **a CSV-imported row must carry its own**, or it gets the time of the import and first-come-first-served decides nothing.
**A submission time becomes a moment at import**: the import normalises the form's timestamp to ISO 8601 at the boundary (`normalized_submitted_at` in [the CSV import](../modules/csv-import.md)), so every reader compares one stored shape.
The applicant's own save already wrote ISO; only the import disagreed, and converting at each reader instead would keep two stored shapes alive and fix only the reader someone remembered.
A mapped timestamp that is not a time refuses its row, naming the value, rather than sorting last in silence; an unmapped one refuses nothing, since the column is optional, and the import warns instead when a priority rule orders by arrival.
[`migrate_submitted_at_to_iso.py`](../../../back-end/migrations/migrate_submitted_at_to_iso.py) rewrote the raw `9/12/2025 18:22:56` values imported before that, which sorted wrongly as strings and scored every vendor alike in the solver.
It has no boot marker: a raw timestamp misorders in plain sight, and the marker is for a hazard nobody can see.

## An organizer's update of an answer

**An update is stored beside the vendor's answer, never over it** ([an update is kept beside the vendor's answer](../../business/rules/an-update-is-kept-beside-the-vendors-answer.md)): `answer_updates` maps a form field key to an `AnswerUpdate`, `{value, by, at, over}`, the value read, who made it (`{user_id, email}`), when, and the vendor's answer it was made over.
`form_data` stays the vendor's: only their own save and an import write it, so a re-import writes the file's answers there and leaves every update standing.
Writing over `form_data` instead would last until the next re-import.
`write_answer_updates` sets and unsets each update by its own dotted path, so two organizers updating different answers at once both land; an update does not move `updated_at`, which is the vendor's answers' time a verdict is conditioned on.

**`effective_answers` is the one reader of the answers as the organizer reads them**: `form_data` with each update's value in its place.
The organizer's views (`formData` in `_application_response_organizer`, beside `answerUpdates`), the results search and the names (`_answers_by_address`), the vendor export (`Vendor.answers` in `api/vendor_export.py`), the Stats tab's answer counts (`market_stats.py`), the price groups (`vendor_answers_for_market`, [a price follows the table](../../business/rules/a-price-follows-the-table.md#price-groups)), the [automatic rejections](../../business/rules/automatic-rejections.md), the solver's input (`_solver_vendor` in `assignment/vendor_input.py`, and so the placement warnings and what a run was made from), the empty-tier check (`NoAskedForTierWithoutTablesGuard`), the table-share notice (`_share_request` in `api/applicants.py`) and the vendor's request beside the notes (`get_vendor_notes`) read through it, and so does any reader added later that calls it.
The applicant's own view serves `form_data`, what they wrote, and no update.
A re-import still compares the file with `form_data` (`csv_import._would_return_to_review`): whether the vendor's own answer changed is the question there, not how it reads.

`answerUpdates` serves each update with `theyWrote`, the vendor's answer now, and `changedSince`, whether that differs from `over`: a re-import or their own edit changed it after the update, which the drawer says.
[`back-end/api/vendor_info.py`](../../../back-end/api/vendor_info.py) makes the update (`PUT /markets/:id/applications/:app_id/answers`): it validates each answer as the form does (`validated_answer` in `application_write.py`, and `validated_essential_update` in `essential_fields.py` for an essential question), refuses a key the form does not ask, takes an update away when its answer is set back to what the vendor wrote, and keeps an update restated as it stands, with who made it; restated over an answer the vendor changed since, the update is kept over what they wrote now, by whoever saved it, and recorded as kept.

## Statuses

The applicant never reads a status: their page reads "Submitted" until results are published, then an outcome read off the stored seats ([an applicant never reads a verdict early](../../business/rules/an-applicant-never-reads-a-verdict-early.md)).

`ApplicationStatus` names eleven values, and five are in use:

- `open`: nobody has decided yet, the status every application is created with (an applicant's first save, or an import row), and the one a re-import returns an approved application to when the row's answers, normalised, have changed.
- `reviewer_approved`, `reviewer_rejected`: the verdicts, written with their giver and time in the same update; a rule's rejection also carries its reason ([automatic rejections](../../business/rules/automatic-rejections.md)).
- `needs_follow_up`: undecided, and owned by a person on the market who must reach out first ([needs follow-up](../../business/rules/needs-follow-up.md)).
- `vendor_refused`: written only by `sweep_unanswered_offers`, which moves every `assignment_sent` application to it.

`under_review` is read as undecided but never written; `unassigned`, `assigned`, `assignment_sent`, `vendor_accepted` and `cancelled` belong to the offers stage, which nothing enters, and no write sets them.
`update_application_status` refuses a verdict or follow-up without a giver, and clears the giver, the reason, the follow-up owner and any reviewer's hold with every other status.
Verdicts are given while the market can still reach review, and settle when it enters assignment ([verdicts settle on entering assignment](../../business/rules/verdicts-settle-on-entering-assignment.md)).
Given the application as the caller read it (`if_unchanged_since`), it writes only if the status, the verdict's time and `updated_at` are still those, so neither another reviewer's verdict nor a re-import's new answers are written over ([ADR 0014](../../adr/0014-reviewers-claim-and-a-verdict-is-a-conditional-write.md)).

A vendor added by hand is stored `reviewer_approved` with `added_by`, holding only their name in `form_data`; the solver run never reads them, and they are seated by hand ([adding a vendor who never applied](../../business/rules/adding-a-vendor-who-never-applied.md)).
An application is also what a seat needs: a placement names an applicant or is refused ([a seat only for an applicant](../../business/rules/a-seat-only-for-an-applicant.md)).

**Each verdict or follow-up a person gives, each follow-up handed on, each vendor added, each update of a vendor's answers and each change an applicant makes to their own application records into [the market's history](history.md)**: the verdict fields here stay the state the review reads, and the history keeps every verdict a person gives, not only the latest.
A rule's verdict is not an entry of its own: the write that judged counts it in its entry (the form, the rules, an applicant's save, an import).

## Indexes

**`(market_id, applicant_email, application_type)` identifies an application, and the database enforces it:** the unique index `market_applicant_type_unique`, built by `ensure_application_indexes()`.
Creating one is a read-then-insert on a public endpoint, so two concurrent saves for a new address would otherwise both insert, leaving an orphan that sits on the organizer's list and double-counts through review, assignment and the form lock.
`find_or_create_application()` is one conditional upsert against that index, and returns the winner's document when it loses the race; an applicant's first valid save creates theirs through it ([a vendor signs in before applying](../../business/rules/a-vendor-signs-in-before-applying.md)), and so does an import row.
`app.py` builds the index at boot and refuses to start when it cannot (`verify_application_indexes`); the likeliest cause is duplicates already stored, which have to be merged by hand ([Operations](../../OPERATIONS.md#when-the-back-end-refuses-to-boot)).
The index's `market_id` prefix serves every read of a market's applications; `id` is a [lookup index](lookup-indexes.md).

[`migrations/create_applications_collection.py`](../../../back-end/migrations/create_applications_collection.py) creates the collection, a `market_id` index and the identity index on an older deployed database, and with `--dry-run` names any applicant holding two applications.
`mongo-init.js` creates the collection and the `market_id` index on a fresh volume.
Two migrations reshape stored answers for the essential questions: `migrate_tier_preference_per_date.py` and `migrate_table_share_answer.py`.

## With its market

An application belongs to its market for life: `delete_applications_for_market` takes every one with the market ([`back-end/market_deletion.py`](../../../back-end/market_deletion.py), [market deletion](../modules/market-deletion.md)), and `delete_application` exists only to undo a create whose answers were then refused.
