---
id: E08/F01/S03
title: The Applications tab renders inside its panel
type: story
status: done
blocked_by: []
pr: [04215fc0]
---

## What to build

On the Applications tab, `.settings-container` holds only the header and tabs, and
`.applications-toolbar` is a **sibling** outside the bordered panel. The result is an empty 302px
card taking the top third of the screen, then the heading, the import button and the empty-state
text at three different alignments with no container.

The other two tabs render their content inside the panel. This one should too.

## Acceptance criteria

- [x] The Applications tab's content is inside the same bordered panel as the other two tabs.
- [x] No empty panel renders above it.
- [x] The heading, the Import from CSV button and the list share one alignment.
