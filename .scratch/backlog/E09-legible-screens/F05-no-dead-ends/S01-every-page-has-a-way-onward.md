---
id: E09/F05/S01
title: Every page has a way onward
type: story
status: ready
blocked_by: []
pr: []
---

## What to build

- **The import button on a draft market navigates to a wall.**
  The Applications tab offers a prominent "Import from CSV" on a draft market; clicking it lands on a page that only explains why it cannot be used.
  The gate is correct; the button should be disabled with the reason, before the click.
- **And the wall's advice points the wrong way.**
  "Move the market back to **applications closed** and you can import again."
  From `draft` the organizer needs to move *forward*, and `applications_closed` is not one of the two transitions the phase strip offers them from there.
  The message is written for one direction and shown for both.
- **The import wizard has no exit** at Upload, Map columns, Preview or the value reconciliation - no Cancel, no "back to market", no breadcrumb.
  Only the final confirmation screen has one.
- **The 404 has no link home**, and still renders the organizer hamburger.
- **The public header's hamburger is a dead control.**
  Signed out on the vendor check-in page it renders, is clickable, and there is no nav element in the DOM at all.

## Acceptance criteria

- [ ] Import is disabled, with its reason visible, in any phase where it would be refused.
- [ ] The blocked-import message names an action available from the phase the market is actually in.
- [ ] Every step of the import wizard can be left without the browser back button.
- [ ] The 404 offers a link to somewhere real.
- [ ] The menu button is absent when there is no menu, and the public check-in page does not offer organizer navigation.
