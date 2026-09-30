---
id: E26/F01/S01
title: Reset and verification links work signed out
type: story
status: done
blocked_by: []
pr: []
---


## What to build

A signed-out person opening a real password-reset link sees the form and can set a new password; a real verification link shows its confirmation; the reset-request page loads directly and shows no navigation menu.
The app has one statement of which pages are public, read by both the router and the shell.

Closes bugs 22 in `docs/MVP_BUGS.md`; each one's reproduction there is the starting E2E.

## Acceptance criteria

- [x] Signed out, with no stubbed session, a real reset link shows the form, a new password works, and sign-in with it succeeds.
- [x] Signed out, a real verification link shows its confirmation.
- [x] `/reset-password-request` loads directly, with no menu button.
- [x] The reset spec no longer stubs `/check-session`.
