---
id: E32/F03/S01
title: A Google Form market's sign-in page renders as an absent market
type: story
status: ready
blocked_by: []
pr: []
---

## What to build

A Google Form market's applicant sign-in page today shows the sign-in form without the market's name (its form fetch is refused) and answers "sent" to a code request it never sends.
It should render exactly as the page for a market that does not exist, as the apply page already does.
The two applicant-login endpoints keep their uniform responses: the page decides from what it was already told, and no endpoint gains a new answer.

## Acceptance criteria

- [ ] A Google Form market's sign-in address renders identically to an absent slug's.
- [ ] A form market's sign-in page is unchanged.
- [ ] The intake-mode spec asserts the gated and absent sign-in renders are identical, as it does for the apply page.
