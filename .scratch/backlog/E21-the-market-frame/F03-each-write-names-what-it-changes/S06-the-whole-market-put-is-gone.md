---
id: E21/F03/S06
title: The whole-market PUT is gone
type: story
status: ready
blocked_by: [E21/F03/S02, E21/F03/S04, E21/F03/S05]
pr: []
---

## What to build

`PUT /markets/:id` is deleted, because nothing calls it any more and a client sending its whole copy of a market is a client claiming to be the truth.

It goes with everything that existed only to defend against it: `_preserve_server_owned_fields`, the re-application of phase, application form, assignment, intake mode, review highlights and the other server-owned fields, and the rule that every new server-owned field must be added there.
Each of those fields keeps exactly one writer, which is already true of all of them.

AGENTS.md carries several warnings of the form "a market PUT stores nothing, because a stale client copy..." (the assignment, the application form, the phase, intake mode, the Security and Phase Transitions entries).
Each is rewritten to state the rule as it now stands, not deleted and not left describing a route that is gone.
`docs/schema.d.ts` is regenerated if the contract changes.

## Acceptance criteria

- [ ] `PUT /markets/:id` answers 405 (or 404), and a test pins that.
- [ ] `_preserve_server_owned_fields` and its tests are gone; each server-owned field's one writer is still covered by its own tests.
- [ ] No front-end or e2e code calls the route.
- [ ] AGENTS.md no longer describes defending against a market PUT, and each affected entry states the rule as it now stands.
