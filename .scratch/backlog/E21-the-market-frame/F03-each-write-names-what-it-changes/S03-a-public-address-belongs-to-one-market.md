---
id: E21/F03/S03
title: A public address belongs to one market
type: story
status: done
blocked_by: []
pr: []
---

## What to build

No two markets can ever answer the same public address.

A market's slug, derived from its name, is the unauthenticated address its applicant links and check-in page are served under.
Today uniqueness is checked on the exact **name**, and only at creation:

- Renaming a market onto another market's exact name is accepted (reproduced: 200, both markets then store the same slug).
- Two different names with one slug ("Café Market" and "Cafe Market") are both accepted at creation, because `market_name_slug` folds accents and punctuation.

An organizer who creates or renames a market onto a slug already taken is refused, with a message naming the clash in their terms (another market already uses this web address).
The slug index becomes unique, so the database refuses what the application check misses.
The migration that builds it stops with an error naming every set of colliding markets, for the operator to rename, the way `migrate_market_keys.py` fails loud; the boot check records its marker like the others.

## Acceptance criteria

- [x] Reproduced first as failing pytest: a rename onto an existing name, and a creation whose name differs only by accent or punctuation, both succeed today.
- [x] Creation and rename both refuse a taken slug, through one check.
- [x] The slug index is unique; a migration builds it and, when collisions exist, refuses and names them.
- [x] The back end refuses to boot until that migration's marker is recorded, and `docs/RELEASING.md` names the step.
- [x] The create-market dialog shows the refusal where the name field is.
