---
id: E33/F03/S02
title: The rules reject, with a reason
type: story
status: ready
blocked_by: [E33/F03/S01, E34/F01/S01]
pr: []
---

## What to build

An undecided application whose answers meet a rule is stored rejected, with the reason ("Answered No to the no-show agreement") and the rule as its giver rather than a person.
Rules are applied when an application arrives, online or by import, and again to every undecided application whenever a rule changes; a rule that no longer matches returns its own automatic rejections to undecided.
A verdict a person gave is never touched.
A reviewer sees the reason on the card and in the bulk view, and can overturn it like any verdict, which makes it theirs.
The reason is shown to the organizer, never to the applicant.

## Acceptance criteria

- [ ] An import of the real export rejects every row that did not agree to the no-show terms, each with the reason.
- [ ] Changing a rule re-judges only undecided and automatically rejected applications.
- [ ] A person's verdict is never changed by a rule.
- [ ] Overturning records the reviewer.
- [ ] The applicant's view never shows the reason.
