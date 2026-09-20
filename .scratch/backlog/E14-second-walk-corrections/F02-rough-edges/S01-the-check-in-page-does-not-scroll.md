---
id: E14/F02/S01
title: The check-in page does not scroll when it has nothing to scroll
type: story
status: done
blocked_by: []
pr: [75]
---

## What to build

`/<slug>/check-in` at 1920x1080 holds roughly 350px of content and shows a scrollbar on every load.

Measured: `documentElement.scrollHeight` **1134** vs `clientHeight` **1080**.
The overflowing element is `.attendance-view`, height 1080, top 54 - `min-height: 100vh` (`AttendanceCheckinView.vue:277`) inside a layout that already has a 54px header.

The identical bug was found and fixed in `VendorsView.vue`, which still carries the comment explaining it: *"`min-height: 100vh` here double-counted the 5vh banner and left the page..."*.
The check-in view was not updated.

Apply the same fix.

## Acceptance criteria

- [x] `/<slug>/check-in` does not scroll when its content fits, at 1920x1080 and at 390x844.
      Reproduced first at 1920x1080, failing with the ticket's own number: 54px past the window.
- [x] It still scrolls when a vendor has enough dates to need it.
      Driven by squeezing the viewport rather than by seeding more dates, since what the fix could
      break is the page's ability to exceed the window at all, and the viewport is the same lever
      from the layout's point of view.

## Notes

Finding F12 in `.lavish/qc-2026-09-20.html`.
This is the vendor-facing page on market day, usually on a phone, where a phantom scroll is felt most.

Deliberately not part of map ticket 01 (how an organizer screen sizes itself): the check-in page is not an organizer screen and keeps its phone requirement, carved out explicitly on the previous map.

## What the second criterion is really guarding

`height: 100%` is the fix, and the way it could go wrong is clipping: a page that reports overflow
while holding its content inside a box the viewer cannot scroll to.
So the test scrolls to the bottom and asserts the bottom of the card is on screen, rather than
settling for `scrollHeight > clientHeight`, which a clipped page also satisfies.

240px was chosen for that case deliberately.
An earlier draft used 360px, where the content overflows by only 9px - close enough that a font
loading differently would decide the result.
The card is a little over 320px, so at 240 the margin is 129px and nothing marginal is being
measured.

Also checked by hand, because `height: 100%` is how you would introduce a white band below the
fold: `.attendance-view` still reaches the bottom of the viewport exactly, at 390x844 and at
1920x1080, so the grey still covers the page.
