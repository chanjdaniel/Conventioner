# 05: How do the fields a reviewer needs reach a form that is already frozen?

Type: grilling
Status: resolved
Blocked by:

<!-- 04 resolved 2026-09-14. This is on the frontier, and the dependency has inverted: 04's answer
     (triage, one card at a time, no bulk action) cannot be BUILT until this is resolved, because a
     form that asks only the essential questions gives every card the same answers. -->

## Question

Report finding W1.

Three rules combine into a one-way door with no sign on it:

1. The application form is editable **only in `draft`** (`application_form_lock_reason`).
2. CSV import is allowed **only in `applications_open` / `applications_closed`**.
3. **No transition returns to `draft`** - `back-end/guards.py:174` lists every edge and nothing
   points back.

So an organizer must define every custom field they will ever want before clicking "Open
Applications", having never seen the import screen or their own columns. One click later the form is
frozen permanently, before a single applicant exists. The lock message names the phase as the reason,
not the applications, so it fires even on an empty market.

For the real file this means Business Name, what they are selling, the portfolio link, UBC
affiliation, club membership and Discord handle are unrecoverable. Which is why ticket 04's reviewer
has only an email address.

Decide the escape:

- **An `applications_open -> draft` edge, guarded on no application existing.** Restores the
  organizer's ability to go back exactly while going back is safe. Adds an edge to a state machine
  whose whole design is that every precondition lives in one file, so the cost is small and visible.
- **Let the import wizard create a custom field from an unmapped column**, in place. Puts the
  decision where the organizer is actually looking at their columns, and removes the need to
  anticipate anything. But it writes the form from a surface that is not `PUT /markets/<id>/application-form`,
  which `AGENTS.md` is emphatic is the form's only writer on an existing market - the thing that makes
  the D9 lock unbypassable.
- **Both**, if they answer different moments.

Take this after ticket 04, which decides what a reviewer actually needs to see; that set is the thing
this ticket has to get onto the form.

Whatever is decided must not weaken the D9 lock's actual purpose: once an applicant has submitted,
the form they answered can never move under them.

## Answer

**A market may return to `draft` while no application exists, and the form is corrected there.**

One new edge, `applications_open -> draft`, carrying a guard that no application exists for the
market. `PUT /markets/<id>/application-form` remains the form's only writer.

### The fact that decided it

The lock has two independent gates (`api/markets.py:112`): the phase must be `draft`, **and** no
application may exist. The second is the D9 invariant that actually protects applicants. The first
looks like belt-and-braces that could simply be deleted - and it is not.

Applicant submission is gated to `applications_open` (`api/applicants.py:290`). So in `draft`, a
count of zero is **stable**; in `applications_open` it is a read-then-write race, where an applicant
can submit between the count check and the form write. The phase gate is what makes the D9 count
check race-free.

That rules out dropping the phase gate outright, and it damages the more attractive-looking option
badly.

### Why not let the import wizard create a field in place

It reads well - the organizer is looking at their own unmapped column at that moment - and it loses
on two counts. It runs in `applications_open`, so it carries the same race; and it would write the
application form from a surface that is not `PUT /markets/<id>/application-form`, which `AGENTS.md`
is emphatic is what makes the D9 lock unbypassable.

### The UI consequence, accepted deliberately

The import wizard gets a **dead end** rather than a fix in place: an unmapped column the organizer
wants to keep says *"this column has nowhere to go - return the market to draft to add a field for
it"*. That is a worse moment-to-moment experience than creating the field inline, and it is the
price of keeping one writer and no race.

### What returning to draft also unfreezes

`intake_mode` is organizer-settable in `draft` and frozen thereafter, so a market that returns to
draft can have it changed again. That is benign **because the guard permits the return only while no
application exists**: there is nothing yet that depends on how vendors were going to arrive. The
market's public surfaces close on the way back, which is correct - a draft market is not published.

### Relationship to ticket 04

The dependency runs the other way now. [Ticket 04](04-what-a-reviewer-needs-to-decide.md) chose
triage with no bulk action, so every application is looked at individually - which is only humane if
the cards differ. **This answer is what makes them differ**, and `E08/F04` is blocked until it is
built.

Buildable work: `.scratch/backlog/E03-mvp-market-lifecycle/F04-correcting-a-form-before-anyone-applies/`.
