---
id: E18/F03/S01
title: Finalizing is recorded
type: story
status: done
blocked_by: []
pr: []
---

## What to build

The product records when a market's application form was opened to applicants.

Leaving draft **is** finalizing: the forward transition stamps the form's publication time, and returning to draft - which stays legal only while no application exists - clears it.
There is no new act for an organizer to discover and no new button.

The two front-end components that already read this field start receiving real values instead of null on every market.

## Why no new guard is needed

The gate already exists and already checks both halves.
The guard on opening applications counts **plan-derived** asked keys, so its own reasoning is that a market with no dates, no tiers and fewer than two sections genuinely asks nothing and is genuinely blocked.
A plan that offers nothing cannot produce a form that asks anything.
Only the stamp was missing.

## Why the field is not just a restatement of the phase

Stamped on leaving draft and cleared on returning, it looks like `phase != draft`.
It is not, because a market can also be published **straight from draft**, and that path does **not** stamp it - such a market never opened its form to anybody.

So the two fields answer different questions: the phase says where the market is now; this says whether the form was ever opened to applicants.

**Record this in the code**: if that direct publish path is ever retired, this field becomes derivable and should be deleted rather than maintained. Leave that as a note where the next person will find it.

## Acceptance criteria

- [ ] Opening applications from draft stamps the form's publication time.
- [ ] Returning to draft clears it.
- [ ] Publishing straight from draft does **not** stamp it.
- [ ] The stamp and the phase change are written in **one atomic update**. A failure between them would leave a market whose stamp and phase disagree, which is the class of bug the existing consistency migration exists to repair.
- [ ] The transition endpoint is the only writer. A market update body can never set it, and an update re-applies the stored value - the same treatment the phase and the assignment object already get.
- [ ] A decision on existing markets is made **deliberately and recorded in the PR**: either a one-off migration stamps every market past draft that was not published directly, or history is left blank on purpose. Do not let this default.
- [ ] Back-end tests cover all four paths: open from draft, return to draft, publish straight from draft, and the atomicity of the phase-plus-stamp write.
- [ ] The two components that read the field are verified to render correctly with a real value, with null, and after a return to draft.
