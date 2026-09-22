---
id: E19/F03/S01
title: Review highlights lead the card
type: story
status: ready
blocked_by: []
pr: []
---

## What to build

An organizer marks, in the form builder, which answers a reviewer needs.
The review card then leads with those answers and collapses the rest behind a disclosure.

A reviewer working a queue reads two or three things and decides, instead of scanning nine.

## Where the mark lives, and why it matters

**A list of answer keys on the market, beside the application form and never inside it.**

The form freezes at the first application, and an organizer learns which answers they needed *while reviewing* - after that moment.
A flag on a form field would freeze exactly when it becomes knowable.

Off the form it also gains something a field property could never have: it can name **essential** answers, which are not form fields at all. The walk's complaint was specifically that an essential availability answer can be the whole decision.

A **flag**, not a rank.
Most markets want two or three answers at the top and are not making finer distinctions; ranking is more to author for a distinction nobody is drawing.

## What it replaces

The card currently orders the organizer's own questions before the essential ones, on the reasoning that custom questions "are what distinguish applicants from each other".
That heuristic was standing in for this mark all along.
**It goes** - replaced by the stated list, with the ordering *within* each group unchanged so nothing else moves at the same time.

## The disclosure, and the tax it must not levy

Hiding the unmarked answers is the strongest focus and the shortest card, and it has a real cost: **at card forty, a click to reach an unmarked answer is a tax.**
Three things follow, and they are criteria, not suggestions.

## Acceptance criteria

- [ ] The market carries a list of answer keys naming what a reviewer reads first. It is server-owned: a market update body cannot set it, and an update re-applies the stored value.
- [ ] An organizer marks and unmarks answers from the form builder, and can mark **essential** answers as well as their own custom fields.
- [ ] The review card renders marked answers first and prominently; the rest collapse behind a disclosure.
- [ ] The disclosure **names its count**, so a reviewer knows what is hidden without opening it.
- [ ] The disclosure's open state **persists across cards within a review session**, so a reviewer who opens it once is not reopening it forty times.
- [ ] A market that has marked nothing renders the card as it does today - every answer visible, no disclosure. An empty list is not a reason to hide an application.
- [ ] The custom-fields-first heuristic is removed; ordering within the marked and unmarked groups is otherwise unchanged.
- [ ] Absent list means nothing marked; no migration.
- [ ] **The glossary gains all three notions, kept apart**: an answer the applicant must give, an answer whose change invalidates a completed review, and an answer a reviewer reads first. They are independent - a required answer may be noise on a card, and a highlighted answer may be optional - and without naming them apart the builder grows two controls an organizer cannot tell apart.
- [ ] Verified end-to-end: mark two answers, open the queue, confirm the card leads with them and the disclosure holds the rest.
