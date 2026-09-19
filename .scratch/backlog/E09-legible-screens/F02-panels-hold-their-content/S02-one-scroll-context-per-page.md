---
id: E09/F02/S02
title: One scroll context per page
type: story
status: ready
blocked_by: []
pr: []
---

## What to build

A page has one thing that scrolls, so the wheel does the same thing wherever the pointer is.

Today Vendors scrolls the document 945/900 *and* the list inside it 14,374/540.
Markets and Organizations do the same.
The Application Form tab stacks three: the page, the Form Builder panel and the Preview panel, with both panels artificially short - 484px and 519px inside a 900px window with 300px of empty page below them.

Assignment Results is the pattern to copy: a single inner scroller with a fixed header and action bar.

## Acceptance criteria

- [ ] On Vendors, Markets, Organizations and the Application Form tab, exactly one element scrolls vertically.
- [ ] The Form Builder and Preview panels use the height the page has rather than a fixed value, so neither scrolls until the content genuinely exceeds the window.
- [ ] Scrolling with the pointer over an open modal does not scroll the list behind it.
