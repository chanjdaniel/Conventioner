---
id: E06/F04
title: A real-shaped acceptance fixture
type: feature
status: done
blocked_by: []
pr: [60c177f5]
---

## Outcome

The suite asserts against a CSV with the properties a real Google Forms export has, and that fixture
carries no real person's data.

## Why now

Three blockers found on 2026-09-14 came from data *shape*, not from logic, and every existing CSV
test uses short single-line stems like `"Which days can you attend?"`. That is why grid detection
failing on multi-line headers survived to production.

This narrowly overturns the v0.1.0 map's "no organizer's specifics steer the roadmap". The point is
not to serve one organizer; it is that a fixture invented by the same people who wrote the parser
tests only what they already thought of.

The source file is 232 real applicants' names and email addresses, so it cannot be committed as it
stands.

## What must survive anonymisation

These are the properties that actually caught bugs. A fixture missing any of them is not doing the job.

- Grid question stems spanning **multiple lines**, with the bracketed option last (this alone is finding B1).
- Timestamps in `M/D/YYYY H:MM:SS` with **unpadded** months and hours (findings C1 and C2).
- Grid cells carrying a *set* of values, plus a `None` cell meaning "not available" (finding B2).
- Free-text spellings that do not match the contract's values: "Full table", "Half table", "Either".
- Duplicate column headers, and a trailing empty column.
- Roughly 232 rows, so scale behaviour is exercised.

## Acceptance criteria

- [ ] The committed fixture contains no real name or email address.
- [ ] The anonymiser is committed beside it, so the transformation is auditable and re-runnable.
- [ ] A back-end test asserts grid detection on a multi-line stem.
- [ ] `docs/TESTING.md` says where the fixture came from and what it is protecting.
