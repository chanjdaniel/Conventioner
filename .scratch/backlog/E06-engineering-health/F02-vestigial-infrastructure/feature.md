---
id: E06/F02
title: Vestigial infrastructure removed
type: feature
status: done
blocked_by: []
pr: [#66]
---

## Outcome

Infrastructure the product no longer uses is gone, so nobody maintains, documents, or reasons
around it.

## Why now

Each piece is small and harmless on its own, which is exactly why it survives. The cost is paid by
readers: a directory the Dockerfile creates and the compose file mounts reads as load-bearing, so
the next person to touch it has to prove it is not before they may delete it.
