---
id: E17/F04
title: The top bar never scrolls away
type: feature
status: done
blocked_by: []
pr: []
---

## Outcome

The navigation is reachable from anywhere on any page, at any scroll position.

## Why now

The top bar is an ordinary in-flow element at the top of the shell, so on any page tall enough to scroll it scrolls off and the navigation menu becomes unreachable without scrolling back up.

This is one implementation site, but it is a product-wide rule: the behaviour must be identical on authenticated screens and public pages alike.

## Stories

- `S01` - the top bar never scrolls away.
