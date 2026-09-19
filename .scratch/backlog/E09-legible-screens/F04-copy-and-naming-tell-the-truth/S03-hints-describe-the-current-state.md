---
id: E09/F04/S03
title: Hints describe the state the market is actually in
type: story
status: done
blocked_by: []
pr: [69]
---

## What to build

- **The triage panel's amber note does not adapt.**
  It still advises "adding a question of your own is possible while the market is a draft and nobody has applied" after applications exist and the form is locked.
- **"Bring in the responses your Google Form collected"** appears twice and names one form product as though it were a requirement.
- **"Send to Discord" is disabled with no visible reason.**
  The explanation lives in a `title` attribute, invisible on touch and slow anywhere.
- **The Discord webhook field is unexplained.**
  It sits at the same level as Back and Next on the setup wizard with no label beyond its own name, no "optional" marker, and no statement of what it sends or when.
  It is a real, wired feature - `post_assignment_to_discord` posts the assignment to a channel - which makes the silence worse, not better.
- **Assignment Options repeats its own title**: the panel header says "Assignment Options" and the first thing inside it is a subheading reading "Assignment options".

## Acceptance criteria

- [ ] No hint refers to a state the market is not in.
- [ ] A disabled control states its reason visibly, not only in a `title`.
- [ ] The Discord field says what it does and that it is optional.
- [ ] The import copy does not name a single form product as a requirement.
