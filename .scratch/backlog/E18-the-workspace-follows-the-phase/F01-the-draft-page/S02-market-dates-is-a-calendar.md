---
id: E18/F01/S02
title: Market dates is a calendar
type: story
status: ready
blocked_by: [E18/F01/S01]
pr: []
---

## What to build

An organizer picks their market's days on a calendar with those days marked, clicking a day to add or remove it.

It replaces the row-per-date control, which grows downwards one date at a time while sitting alone in the widest section on the page.

## Why a calendar

It uses the width the ordered page gives it, and it reads the same for a two-day market and a twelve-day one, which a stacked list does not.

It also **dissolves a known defect rather than fixing it**: the current control lays an invisible native date input across the whole row and calls the browser's picker, which opens anchored to that input's left edge - the wrong side of the field. With no native date input there is no popup to position and no invisible overlay to work around. That finding is closed by this story, not by a separate fix.

## The sharp edge this must respect

**A market date is a calendar day, not an instant.**
A stored date must render as the same day for every viewer regardless of their timezone, and the project formats market dates with pure UTC arithmetic for exactly this reason - a market date must never be parsed through a local-offset date constructor.

A calendar widget does **month arithmetic**, not just formatting, which makes it the most likely place in the entire product to reintroduce the calendar-day-versus-instant bug.
There is an existing end-to-end spec that pins this across Honolulu, Los Angeles and Tokyo.
Build against it.

## Acceptance criteria

- [ ] Market dates are chosen by clicking days on a calendar; selected days are visibly marked.
- [ ] A selected day can be deselected. The set of chosen dates is visible without opening anything.
- [ ] The control reads well at both two dates and twelve, and at a market whose dates span more than one month.
- [ ] The existing timezone spec passes unchanged, and is **extended** to cover the new control's month navigation and day selection in the same three timezones.
- [ ] No market date is constructed or compared through a local-offset date path anywhere in the new control; the project's UTC formatting helper is used for display.
- [ ] Dates still save into the plan object in the same stored form; this story changes the control, not the contract.
- [ ] The dependent essential question - available dates - still offers exactly the dates chosen here.
- [ ] Keyboard selection works: a calendar that only responds to a mouse is not finished.
