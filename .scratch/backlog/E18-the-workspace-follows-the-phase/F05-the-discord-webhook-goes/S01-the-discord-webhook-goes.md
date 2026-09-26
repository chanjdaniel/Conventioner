---
id: E18/F05/S01
title: The Discord webhook goes
type: story
status: done
blocked_by: []
pr: []
---

## What to build

Nothing.
This story removes a feature.

An organizer no longer sees a Discord webhook field on their plan, and no longer sees an action offering to post the assignment to Discord.
Nothing else about their market changes.

## What has to come out

Both Discord fields on the market, and everything hanging off them:

- The **webhook URL field** and the **guild id field** on the market document and on the schema contract model.
- The endpoint that posts an assignment summary to a market's webhook, and the API method behind it.
- The **webhook row** on the plan, and the **post-to-Discord action** on assignment results, along with the derived state that decides whether that action is available.
- The field's presence in the shared market type, the market-decoding helper - which currently accepts the guild id under two spellings - and the end-to-end page objects.
- The preservation of the guild id across market updates, which is the only reason that field survives a write today.

## The second field

`discordGuildId` is stored, preserved across updates, typed on both sides and covered by tests, and **read by nothing**.
It is annotated in the model as an integration seam for something that never arrived.
It goes with the webhook. A field nobody reads is a field that will be wrong when somebody finally does.

## Acceptance criteria

- [ ] Neither Discord field exists on the market model or the schema contract model.
- [ ] The notify endpoint and its API method are gone; nothing serves that route.
- [ ] The webhook row is gone from the plan and the post-to-Discord action is gone from assignment results, along with the state that gated it.
- [ ] The shared market type, the market-decoding helper and the e2e page objects carry no Discord references.
- [ ] The guild id is removed from the list of fields preserved across a market update, and the **other** field on that line is left exactly as it is.
- [ ] Every test that asserted Discord behaviour is deleted rather than skipped - the back-end statistics-API test, the preserved-fields tests, the model tests, the front-end market decoding test, and the three e2e specs that reference it.
- [ ] The published schema is **regenerated** with the project's generator, not hand-edited.
- [ ] The example market-schema input, the object-relationships doc, the testing doc and the startup doc no longer describe it.
- [ ] `CHANGELOG.md` is **not** touched - it is generated.
- [ ] The project's agent notes are updated if they mention it.
- [ ] A market document that still carries either field in the database is decoded without error. **Verify this rather than assuming it**: the market decoder is strict in places and a stored key nobody expects has taken down a list before.
- [ ] Full suite green: back-end tests, front-end unit tests, e2e, lint, format and type check.

## Why it is first

This is deletion work on exactly the two surfaces the rest of this epic rebuilds.
Taken before `F02/S01`, the prefactor has less to extract; taken before `F01/S01` and `F02/S04`, neither has to decide where a deleted feature goes.
Taken afterwards, it is moved twice.
