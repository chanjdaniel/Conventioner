# 03: Vendor notes

Type: grilling
Status: resolved
Blocked by: -

## Question

A vendor may need something beyond their table (an extra chair, an outlet, a spot near the door), and the organizer needs somewhere to record what they know and did about a vendor.
Settled: these are two separate kinds of note, the vendor's own request and the organizer's notes, not one field with two authors.

Open:

- How the vendor's request arrives on each path: a question on the market's own form, and a column of a CSV import.
- Whether a Google Sheet's own organizer columns (which the form started from a CSV already recognises and leaves out) become organizer notes on import.
- The shape of an organizer note: one editable text per vendor, or dated entries.
- Who can see each kind; the vendor never sees the organizer's.
- Where each kind shows (applications review, the assignment's Vendors page, the attendance roster at the door), and where it can be written.
- Whether a request can be marked handled, so the door sees what is still outstanding.

## Answer

Resolved 2026-10-18, in one grilling round.

**Two kinds, kept apart.**

- **The vendor's request** is a built-in optional question on the application ("Anything else you need from us?"), asked by default and switchable off by the organizer, like the essential questions the plan asks.
  On the CSV path the import offers it as a target, so a Google Form's "anything else" column maps onto it.
  It is the vendor's answer: they see it, the organizer reads it and does not edit it.
- **The organizer's note** is one editable text per vendor, shared by the market's organizers, carrying who last edited it and when.
  A dated log was rejected: "extra chair arranged" is one current fact, and a log makes the reader find the latest line.
  Every role on the market reads it, EDITOR and up write it (the bar every market write has, which a door volunteer with EDITOR meets), and the vendor never sees it.
- **A sheet's own organizer column** (which the form started from a CSV already recognises and leaves out) can be mapped on import to a third, read-only line, "From your sheet".
  Each import replaces it, and it never touches the note written in the app, so a re-import neither clobbers the app's note nor ignores the sheet's.

**A request can be marked handled**, once, so the door can tell "needs a chair" from "already got one" without reading every note.

**Where they show**: the applications review, the assignment's Vendors page, and the attendance roster at the door.
A vendor's row carries a compact marker when any kind exists, and expanding it shows each kind under its own label; the roster shows each request as outstanding or handled.
The organizer's note is written wherever it is shown.

Built by [E31/F04](../../../backlog/E31-what-to-show-and-when/F04-vendor-notes/feature.md).
