---
id: E32/F03/S04
title: The doubled verification email
type: story
status: ready
blocked_by: []
pr: []
---

## What to build

On 2026-10-18 one address was sent two "Verify your email address" emails 150 ms apart, which looks like a signup submitted twice.
Reproduce it first, as a person signing up would hit it (a double click, Enter then click).
If it reproduces: the signup control is disabled while its request is in flight, and the server ignores a repeat signup for the same address within a few seconds, sending one email.
If it does not reproduce, close this story as `wontfix` with what was tried.

## Acceptance criteria

- [ ] The reproduction is recorded in this story, either way.
- [ ] If fixed: a double click and an Enter-then-click each send one verification email.
