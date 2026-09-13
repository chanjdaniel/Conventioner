---
id: E03/F02/S02
title: A CSV market's applicant endpoints answer as if it did not exist
type: story
status: done
blocked_by: [E03/F02/S01]
pr: [#65]
---

## What to build

A stranger who guesses the public slug of a CSV market and calls any applicant-intake endpoint gets the same answer as a stranger who invents a slug: not found.
Not a message explaining that the market is not accepting online applications, which would confirm to anyone guessing that the market exists.

Five endpoints are gated: applicant login request-code, applicant login verify-code, the public application form, and the applicant's own application read and save.

The two check-in endpoints are not gated and must keep working for CSV markets.
Check-in concerns vendors who are already assigned, and how they entered the market has no bearing on whether they can scan in on the day.

The gate is one lookup, not five checks.
A second lookup helper sits beside `published_market_by_slug` and adds the intake requirement to it; the five endpoints resolve their market through that helper and nothing else.
Five separate checks would be five chances to forget the sixth endpoint.

## Acceptance criteria

- [ ] Each of the five applicant-intake endpoints answers 404 for a published CSV market
- [ ] Each of them still serves a published form-intake market exactly as it does today
- [ ] A 404 from a gated market is indistinguishable from a 404 for an unknown slug: same status, same body
- [ ] Both check-in endpoints serve a published CSV market unchanged
- [ ] A draft market is still unreachable through the new lookup, in either intake mode
- [ ] The new lookup is the only place the intake requirement is expressed, and it keeps the caller-named field projection that bounds the decoded document
- [ ] Back-end tests cover every gated endpoint in both modes, both check-in endpoints against a CSV market, and the draft case

## Notes

`published_market_by_slug` cannot itself carry the requirement, because check-in shares it and must stay open.

`AGENTS.md` records that no Mongo condition can answer the draft question and that `phase_from_market_document` decides it in Python.
The intake decision belongs in the same place for the same reason: the prefilter prunes, it does not judge.
