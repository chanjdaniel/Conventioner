---
id: E32/F03/S01
title: A Google Form market's sign-in page renders as an absent market
type: story
status: in-progress
blocked_by: []
pr: []
---

## What to build

A Google Form market's applicant sign-in page today shows the sign-in form without the market's name (its form fetch is refused) and answers "sent" to a code request it never sends.
It should render exactly as the page for a market that does not exist, as the apply page already does.
The two applicant-login endpoints keep their uniform responses: the page decides from what it was already told, and no endpoint gains a new answer.

## As built

The two already rendered alike, as the intake gate requires: both drew a sign-in form under the typed slug and answered "sent". What changed is what they render: the sign-in page now asks the public form first, as the market's own home does, and shows the not-found page when there is none. A request that fails in transit still shows the sign-in.

## Acceptance criteria

- [x] A Google Form market's sign-in address renders identically to an absent slug's.
- [x] A form market's sign-in page is unchanged.
- [x] The intake-mode spec asserts the gated and absent sign-in renders are identical, as it does for the apply page.
