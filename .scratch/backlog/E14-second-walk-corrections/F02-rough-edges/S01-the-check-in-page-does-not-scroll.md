---
id: E14/F02/S01
title: The check-in page does not scroll when it has nothing to scroll
type: story
status: ready
blocked_by: []
pr: []
---

## What to build

`/<slug>/check-in` at 1920x1080 holds roughly 350px of content and shows a scrollbar on every load.

Measured: `documentElement.scrollHeight` **1134** vs `clientHeight` **1080**.
The overflowing element is `.attendance-view`, height 1080, top 54 - `min-height: 100vh` (`AttendanceCheckinView.vue:277`) inside a layout that already has a 54px header.

The identical bug was found and fixed in `VendorsView.vue`, which still carries the comment explaining it: *"`min-height: 100vh` here double-counted the 5vh banner and left the page..."*.
The check-in view was not updated.

Apply the same fix.

## Acceptance criteria

- [ ] `/<slug>/check-in` does not scroll when its content fits, at 1920x1080 and at 390x844.
- [ ] It still scrolls when a vendor has enough dates to need it.

## Notes

Finding F12 in `.lavish/qc-2026-09-20.html`.
This is the vendor-facing page on market day, usually on a phone, where a phantom scroll is felt most.

Deliberately not part of map ticket 01 (how an organizer screen sizes itself): the check-in page is not an organizer screen and keeps its phone requirement, carved out explicitly on the previous map.
