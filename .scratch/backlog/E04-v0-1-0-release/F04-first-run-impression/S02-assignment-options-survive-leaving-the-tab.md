---
id: E04/F04/S02
title: Assignment options typed in the wizard survive leaving the tab
type: story
status: done
blocked_by: []
pr: [#66]
---

## What to build

Assignment options an organizer has typed are still there when they come back to the Setup tab,
or the wizard tells them what it discarded.

## What was actually wrong

The original diagnosis here - "the wizard only persists on Back, Next and Assign" - was true but
was not the mechanism. The real one is broader, and worse.

`handlePhaseAdvanced` replaced the **whole local market** with the server's copy returned by the
transition endpoint. A transition changes the phase and nothing else, but the server's copy carries
the setup as it was last *saved* - so **every unsaved edit was discarded** the moment the organizer
advanced a phase. Silently, with nothing to notice.

The assignment options were simply the most likely victim, because they live on the wizard's last
page, which has no Next to save them. Anything else typed and not yet saved went the same way.

Two symptoms that do not look related: the fields empty themselves, and Assign is then disabled for
a reason the screen never stated. The MVP journey spec sat waiting thirty seconds on that button,
which is how this was found.

## What was done

`handlePhaseAdvanced` now takes the new phase from the server and keeps the organizer's plan, then
persists the result. The disabled Assign button says what is missing in visible text, not only in a
`title` attribute nobody hovers.

## Acceptance criteria

- [x] Edits typed and not yet saved survive a phase advance - `marketSetupPhaseAdvance.test.ts`
- [x] A disabled Assign button says what is missing, rather than only being grey
- [x] Covered by a test that reproduces the loss. The first version of that test **passed against
      the broken code**, because it asserted on local storage, which the old handler never wrote -
      so the untouched original still carried the options. It now asserts on what the next save
      sends, and two of its three cases fail against the old handler. A test that cannot fail pins
      nothing.
