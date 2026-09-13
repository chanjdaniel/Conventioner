---
id: E04/F01/S03
title: A market whose form is only the essential questions can receive an application
type: story
status: done
blocked_by: []
pr: [#66]
---

## What to build

A market that asks only the essential questions accepts applications, by CSV import and by an
applicant submitting, exactly as one with custom fields does.

## Why this exists

Found by E04/F01/S02 on its first run. It is not a refactor artifact: it is a product defect that
no slice test could see, because no slice walked from opening applications to receiving one.

An organizer who plans a market, opens applications and imports their CSV got **"0 of 3 rows will
be imported"**, with every row refused as *"This market does not have an application form
configured."*

The two halves of the product disagreed about what a form is:

- `FormHasFieldsGuard` counts the essential questions, so a market whose plan has dates, tiers or
  two sections may leave `draft` with no custom field at all. That is E03/F01/S01, and it is
  deliberate: in MVP the essential questions *are* the form.
- The write path counted only the custom fields, so the same market refused every application it
  received.

The result was a market that could open applications and then never receive one. It applied to the
public applicant form too, not only to import - both go through the same write path, which is what
that module exists to guarantee.

This is the drift `AGENTS.md` warns about under Essential Form Fields, arriving from the direction
nobody had checked: not the solver rejecting what the form accepted, but the form rejecting what
the phase machine had just allowed.

## Acceptance criteria

- [x] A market with dates, tiers and sections but no custom field accepts an imported row
- [x] The same market accepts a submission through the applicant write path
- [x] The import dry run agrees with the save, so a preview never refuses what a confirm accepts
- [x] A market that genuinely asks nothing - no custom field, and a plan with no dates, no tiers
      and fewer than two sections - is still refused, with the same message
- [x] A custom field, where one exists, is still validated as before
- [x] The rule is read from `asked_essential_keys()`, the same function the guard and the solver's
      input translation read, rather than a fourth copy of "what does this market ask"
