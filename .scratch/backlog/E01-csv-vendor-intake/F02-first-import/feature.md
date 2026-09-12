---
id: E01/F02
title: First import
type: feature
status: ready
blocked_by: [E01/F01]
pr: []
---

## Outcome

An organizer uploads the CSV their Google Form produced, maps its columns onto the market's essential questions, previews what will happen, and confirms - and the rows become `Application` records awaiting review.

## Why now

This is the MVP's answer to "set up the vendors". Today there is no way at all to get vendors into a market through the product: the CSV upload UI was deleted as the last step of the intake cutover, and the application form it was replaced by never became a working path to assignment.

## Shape

Governed by [ticket 04](../../../wayfinding/v0-1-0/issues/04-csv-mapping-ux.md): a dedicated full-width upload/map/preview/confirm flow, reached from the market's applications area. Structure follows the column-ledger prototype variant, taking explicit multi-column shape labels and inline unmatched-value fixes from the target-board one.

The variants are on the unmerged `prototype/csv-mapping` branch. Drive them before building; do not lift the code.
