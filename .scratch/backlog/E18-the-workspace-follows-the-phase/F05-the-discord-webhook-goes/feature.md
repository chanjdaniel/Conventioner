---
id: E18/F05
title: The Discord webhook goes
type: feature
status: done
blocked_by: []
pr: []
---

## Outcome

The Discord integration is gone from the product: from the market document, the API, both screens that carried it, the tests, the fixtures and the docs.

## Why now

It is a tack-on.
It was never part of the market lifecycle this epic is putting in order, and it is spread across exactly the two surfaces this epic rebuilds - a webhook URL row on the plan, and a "post to Discord" action on assignment results.

Removing it **before** the restructure means neither `F01/S01` (the draft page) nor `F02/S04` (the assignment surface) has to decide where to put a feature that is being deleted, and `F02/S01` (the prefactor) has less to carry through the extraction.
Doing it afterwards means moving it twice.

## The second field, which is worth knowing about

There are **two** Discord fields on the market, not one.

`discordWebhookUrl` is the live one: it has a UI, an endpoint and an action.

`discordGuildId` is not. It is stored, deliberately preserved across market updates, typed on both sides, covered by tests - and **read by nothing at all**. It is a placeholder for an integration that never arrived, annotated in the model as an "integration seam".

Both go.
A field nobody reads is a field that will be wrong when somebody finally does.

## Stories

- `S01` - the Discord webhook goes.
