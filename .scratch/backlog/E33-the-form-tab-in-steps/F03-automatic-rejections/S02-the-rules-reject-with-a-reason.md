---
id: E33/F03/S02
title: The rules reject, with a reason
type: story
status: in-progress
blocked_by: [E33/F03/S01, E34/F01/S01]
pr: []
---

## What to build

An undecided application whose answers meet a rule is stored rejected, with the reason ("Answered No to the no-show agreement") and the rule as its giver rather than a person.
Rules are applied when an application arrives, online or by import, and again to every undecided application whenever a rule changes; a rule that no longer matches returns its own automatic rejections to undecided.
A verdict a person gave is never touched.
A reviewer sees the reason on the card and in the bulk view, and can overturn it like any verdict, which makes it theirs.
The reason is shown to the organizer, never to the applicant.

## As built

- `rejection_rules.judge` applies the market's rules to its undecided applications and to those a rule rejected; a person's verdict is never read. An application a rule meets is stored `reviewer_rejected` with `verdict_by` `{kind: "rule", rule}` and `verdict_reason`; one no rule meets any longer returns to `open`.
- It runs when a rule changes (`save_rejection_rules`), when an application is saved online (that application alone), and at the end of an import (the market, after any approval the import sent back to review). The import's result says how many the rules rejected.
- The reason is served to the organizer (`verdictReason`) and never in the applicant's response.
- The decided list says "Rejected automatically: answered “Half a table, shared” to “Table choice”"; "Approve instead" overturns it, and the verdict becomes the reviewer's. The bulk view is E34/F04.
- The real November 2026 export is not in the repository: the import criterion is held by `test_an_import_writes_its_rows` and `e2e/automatic-rejections.spec.ts` on a rule over the table choice, and the no-show checkbox by `test_an_unticked_agreement`.

## Acceptance criteria

- [x] An import of the real export rejects every row that did not agree to the no-show terms, each with the reason.
- [x] Changing a rule re-judges only undecided and automatically rejected applications.
- [x] A person's verdict is never changed by a rule.
- [x] Overturning records the reviewer.
- [x] The applicant's view never shows the reason.
