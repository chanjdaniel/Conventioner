---
layer: implementation
kind: adr
describes:
  - .github/workflows/promote.yml
  - scripts/promote_check.py
verified: 2026-11-14
sources:
  - T317
status: accepted
---

# `main` moves only through Promote

The node it constrains: [the release process](../RELEASING.md#how-a-promotion-proves-itself).

## Context

`main` is what Deploy ships, and it was moved by an admin's push to it, a fast-forward to a `dev` commit typed by hand.
`main`'s classic branch protection did not bind admins, since the Release PR, which gets no CI, is merged by an admin, so that push bypassed every rule `main` had.
A wrong sha, a typo, a pull request's head or a commit whose `dev` run failed went through as easily as the right one, and nothing but the person pushing checked which it was.
The agents act as Daniel's GitHub account, so GitHub could not tell an agent's push from Daniel's either.

## Decision

**A GitHub App is the only actor that pushes to `main`, and only the Promote workflow holds its key.**
The App is installed on this repository alone, with Contents read and write and no webhook.
Each run of [`.github/workflows/promote.yml`](../../.github/workflows/promote.yml) mints a token that lasts an hour and may write this repository's contents and nothing else, and only the step that moves `main` holds it.

**Promote checks the sha before it moves anything.**
Daniel starts it by hand from `dev` with a commit's full sha, and [`scripts/promote_check.py`](../../scripts/promote_check.py) refuses unless the commit's Test run on a push to `dev` passed, the commit is on `dev`, and `main` is its ancestor.
The move itself is a fast-forward GitHub refuses to force, so a `main` that moved since the check is refused, never rewritten.
The App's key is a secret of the `promote` environment, whose deployment branches are `dev` alone, so a branch with an edited copy of the workflow cannot reach it.

**An admin changes `main` only through a pull request.**
Two rulesets hold `main`: one takes a change only through a pull request, except from the App; the other requires `main`'s six checks, a linear history, and no force push or deletion.
An admin may bypass both for a pull request only, which is how the Release PR, which gets no CI, is merged; a `hotfix/` pull request into `main` gets its CI and merges as before, and no one, an admin included, pushes to `main` directly.

## Alternatives

- **A deploy key**, an SSH key with write access, as the only pusher.
  Rejected: the key never expires, it can push any branch of the repository, and a run would need the key on the runner as a file and a `git push`, where the App's token lasts an hour, can do only what the run asks of it, and needs neither.
- **The admin push, with a local script that checks the sha first.**
  Rejected: the check would be advice, since the push still bypasses every rule; a push made without the script, or with a typo after it, would go through as before.
- **A merge queue, with a pull request from `dev` into `main` for each promotion.**
  Rejected: every way GitHub merges a pull request makes new commits, so `main` would carry a commit no `dev` run tested instead of the one that passed, and a pull request per promotion is a ritual for a move that is always a fast-forward.

## Consequences

- The App's private key never expires on its own, so it is a secret to rotate: generate a new key in the App's settings, replace `PROMOTE_APP_PRIVATE_KEY` in the `promote` environment, and delete the old key.
- An emergency push to `main` means editing a ruleset first, a deliberate step GitHub records.
- The App's push starts the Test and release-please workflows on `main`, which a push with a workflow run's own token would not, so Deploy reads a Test run on `main` as before.
- GitHub still cannot tell who started Promote, since the agents act as Daniel's account; who may start it is the team's rule, not this repository's.
- The decision holds only once the rulesets replace `main`'s classic branch protection, a settings step of Daniel's; until then an admin's push still bypasses the rules.
