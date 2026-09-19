---
id: E13/F02
title: The name on every surface
type: feature
status: ready
blocked_by: []
pr: []
---

## Outcome

Wherever the product shows a vendor, it shows their name first and their email beside it.

## Why now

`F01` puts the name in the data. This puts it on the screen, which is the finding.

## The rule

**Name primary, email secondary. Never name instead of email.**
Two vendors can share a name; the email is guaranteed unique and guaranteed present, it is what
check-in matches on, and it is what ties a vendor back to their CSV row. At a door someone is
reading it off a phone.

**A vendor with no name falls back to the email**, and looks exactly like the product does today.
That is the floor: this ships without making any existing market look worse, and no vendor is
decorated with "Unnamed vendor".
