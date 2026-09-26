---
id: E21/F03/S04
title: Renaming is its own write, and only while the market is a draft
type: story
status: done
blocked_by: [E21/F03/S03]
pr: []
---

## What to build

Manage Market renames a market through a write that carries only the name, and the rename is refused once the market has left draft.

The name decides the slug, and the slug is the public address: the applicant link while applications are open, the check-in page and any printed QR code once published.
Renaming after that moves an address that has already been shared, so it is refused with that reason rather than silently breaking the links.
Decided in [the-market-frame ticket 04](../../../wayfinding/the-market-frame/issues/04-what-becomes-of-the-whole-market-put.md); decoupling the slug from the name was considered and held back.

In Manage Market, the rename control is available for a draft, and past draft it says why the name can no longer change instead of offering a control that will be refused.
The rename goes through the slug check from `S03`, and the market store re-fetches afterwards (F02).

## Acceptance criteria

- [x] A rename write accepts only the name, requires the same role renaming requires today, and refuses a taken slug.
- [x] Outside draft it is refused with the reason, and pytest covers draft (allowed) and each later phase (refused).
- [x] Manage Market no longer renames through `PUT /markets/:id`.
- [x] Past draft, Manage Market shows why the name is fixed and offers no rename control; e2e covers both states.
