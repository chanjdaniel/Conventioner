---
id: E02/F02/S02
title: Prioritise by when the application arrived
type: story
status: ready
blocked_by: [E02/F02/S01]
pr: []
---

## What to build

An organizer picks "when the application was submitted" as a priority rule and gets first come, first served.

A rule's target may be a built-in attribute of the application itself, not only a question the organizer asked.
These appear in the picker as their own group, distinct from the market's form questions.

First come, first served is probably the most common tiebreaker there is, and no form question can supply it.
A design that allowed only form fields would force organizers to fake it with a "what time is it" question, which is why built-in attributes exist at all.

This story also completes the set of orderings.
Beyond the arranged answers of S01, a rule may order by number, by date, and by yes/no, each derived from the target's type.

## Acceptance criteria

- [ ] Submission time is selectable as a priority target and orders vendors earliest-first
- [ ] Application type is selectable as a priority target
- [ ] Built-in attributes appear in the picker as their own group, separate from the organizer's form questions
- [ ] Number, date, and yes/no orderings all work, with their direction derived from the target's type
- [ ] A market can combine a form-question rule and a built-in-attribute rule, applied in rule order
- [ ] An imported application carries its real submission time, not the time of import, proven by a test that imports and then asserts distinct ordering
- [ ] Frontend and backend tests cover each ordering shape

## Notes

**Submission time must hold real submission time.**
It is optional on an application, and if every imported row carried the import timestamp they would all be identical and this rule would silently do nothing for exactly the markets this MVP serves.
That would be the fourth silent no-op found in this area.

E01 owns how the organizer maps the Google Forms timestamp column.
This story owns asserting that the value arriving is real, and should fail loudly if it is not.
