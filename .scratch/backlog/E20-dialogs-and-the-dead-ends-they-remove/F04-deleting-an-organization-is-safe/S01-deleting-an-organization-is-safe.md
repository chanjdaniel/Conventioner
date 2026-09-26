---
id: E20/F04/S01
title: Deleting an organization is safe
type: story
status: done
blocked_by: [E20/F01/S01]
pr: []
---

## What to build

Deleting an organization is refused while it holds a market that is mid-lifecycle, and the refusal names those markets and their phases so the organizer can act rather than guess.

Draft and archived markets are deleted along with it - and the confirmation says exactly what that destroys, per market, before anything happens.

No market is ever left belonging to nothing.

## The partition

- **Blocks the deletion**: any market that is open for applications, closed for them, in review, in assignment, sending offers, or running.
- **Deleted with the organization**: drafts and archived markets.

Owner-only stays as the **authority** rule.
This adds the **safety** rule it never had.

## The risk this carries, and what the story owes it

A market that has been archived is **still publicly served**, and it holds the placement record of a market that actually ran.
Deleting one takes a live check-in URL off the air and destroys that record, with no undo.

This was raised during charting and reaffirmed.
It is why the two criteria below are criteria and not suggestions.

## What stops existing

The update that sets a market's organization to nothing is **removed outright, not kept as a fallback**.
A fallback would preserve the exact state this story exists to prevent - a market in a state the create endpoint refuses to produce, invisible to everyone who reached it through the organization.

## Acceptance criteria

- [x] Deleting an organization is refused while it holds a market in any mid-lifecycle phase; the refusal names each such market and its phase.
- [x] Drafts and archived markets are deleted with the organization.
- [x] **The confirmation names what each deletion destroys**, per market: its name, its phase, whether it ran, how many placements it holds, and the public URL that will stop resolving. A count of markets does not satisfy this.
- [x] **The deletion leaves a trail** recording what was deleted and by whom. Nothing records this today; the placement history covers placements only.
- [x] The update that orphans markets is removed from the code entirely.
- [x] Removing the organization from each member's list is unchanged.
- [x] The check lives with the organization API, which already owns that collection - **not** in the phase-transition guard registry, which is validated against the transition table and is for transitions only.
- [x] The confirmation dialog is built on the shell from `E20/F01/S01` and is **opened and screenshotted** in the PR. It is one of the two irreversible actions in the product.
  Opened and looked at: it names each market, its phase, and - for the archived one - the `/slug/check-in` URL that stops resolving, in red.
  It opens focused on Cancel, as every destructive dialog does.
  Opening it also found that a dialog opened FROM a dialog was marked inert by the one beneath it, so the confirmation rendered, read correctly and could not be clicked.
- [x] Back-end tests cover: refusal for each blocking phase, deletion of a draft, deletion of an archived market, and that no market is ever written with no organization.
