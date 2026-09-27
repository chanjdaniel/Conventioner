---
id: E24/F02
title: The proposal
type: feature
status: ready
blocked_by: [E24/F01]
pr: []
---

## Outcome

The server reads a Google Form's responses CSV for a draft market and returns a **proposal**: what each column is, what the form would ask, and what the file says about the plan, with a reason on every guess it is unsure of.
It writes nothing.

## Why now

This is the floor the review stands on.
The rules alone got every column's kind right on the corpus, and rules that read values survived other organizers' wording where header keywords did not ([03](../../../wayfinding/the-form-started-from-a-csv/issues/03-how-good-are-the-rules-alone.md)); hosted Jev earned a place for the two judgements they leave ([04](../../../wayfinding/the-form-started-from-a-csv/issues/04-does-a-model-beat-the-rules.md)).

## Stories

- `S01` - the rules propose what each column is.
- `S02` - the file proposes the plan.
- `S03` - hosted Jev settles what the rules cannot.
